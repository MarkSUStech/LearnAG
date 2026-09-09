// PDF 查看器：连续滚动 + 逐页虚拟化渲染 + 文本层 + 标注/遮罩/贴图覆盖层 + 最小化标签轨
//
// 性能要点：PageView 只在滚入可视窗口（±1 视口滞后）时挂载，滚出即卸载——
// 长文档（数百页）下未可见的页面不产生任何组件订阅与渲染开销。
// 缩放以锚点为中心：Ctrl+滚轮以鼠标位置为锚，工具栏/快捷键以视口中心为锚。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'
import { useStore, pageOffsets, contentHeight, VIEW_PAD } from './store'
import { attachScrollSync } from './syncBus'
import PageView from './PageView'
import NoteTabRail from './NoteTabRail'
import type { Annotation, Card, Quad } from './types'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

let currentPdf: PDFDocumentProxy | null = null
let currentLoadToken = 0

const clampScale = (v: number) => Math.min(4, Math.max(0.4, v))

interface ZoomAnchor {
  mode: 'cursor' | 'center'
  page: number
  xInPage: number // pt
  yInPage: number // pt
  clientDX: number // 相对滚动容器的目标横向位置
  clientDY: number
}

export default function PdfViewer() {
  const s = useStore()
  const { docPath, scale, pageDims, pageCount } = s
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const scrollSyncRef = useRef(attachScrollSync('pdf'))
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(800)
  const [viewportW, setViewportW] = useState(1200)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const pendingAnchor = useRef<ZoomAnchor | null>(null)
  const lastJumpTs = useRef(0)
  const lastZoomTs = useRef(0)

  // ── 加载 PDF 文档 ──────────────────────────────────────────────────────────
  useEffect(() => {
    const myToken = ++currentLoadToken
    if (!docPath) {
      setPdf(null)
      void currentPdf?.destroy().catch(() => undefined)
      currentPdf = null
      return
    }
    async function load() {
      s.setPageDims([])
      try {
        const doc = await pdfjsLib.getDocument({ url: `/api/raw?path=${encodeURIComponent(docPath)}` }).promise
        if (myToken !== currentLoadToken) {
          void doc.destroy().catch(() => undefined)
          return
        }
        void currentPdf?.destroy().catch(() => undefined)
        currentPdf = doc
        setPdf(doc)
        s.setPageCount(doc.numPages)
        // 分块并行预取页面尺寸：大文档（上千页）串行 await 会拖慢首屏；
        // 每块完成即更新，页面槽位随之渐进可渲染
        const dims: { w: number; h: number }[] = []
        const CHUNK = 32
        for (let i = 1; i <= doc.numPages; i += CHUNK) {
          if (myToken !== currentLoadToken) return
          const end = Math.min(i + CHUNK - 1, doc.numPages)
          const pages = await Promise.all(
            Array.from({ length: end - i + 1 }, (_, k) => doc.getPage(i + k)),
          )
          for (const page of pages) {
            const vp = page.getViewport({ scale: 1 })
            dims.push({ w: vp.width, h: vp.height })
          }
          s.setPageDims([...dims])
        }
        if (myToken !== currentLoadToken) return
        s.setPageDims(dims)
      } catch (e) {
        if (myToken !== currentLoadToken) return
        s.toast('PDF 加载失败：' + String((e as Error).message || e), 'error')
      }
    }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docPath])

  // ── 布局 ───────────────────────────────────────────────────────────────────
  const offsets = useMemo(() => pageOffsets(pageDims, scale), [pageDims, scale])
  const totalH = useMemo(() => contentHeight(pageDims, scale), [pageDims, scale])
  const contentW = useMemo(() => (pageDims.length ? Math.max(...pageDims.map((d) => d.w)) * scale : 0), [pageDims, scale])
  // 内容盒宽度：内容窄于容器时撑满（页面保持居中），超出后随内容增长（可滚动，鼠标锚定缩放）
  const boxW = useMemo(() => Math.max(contentW + 96, viewportW), [contentW, viewportW])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setViewportH(el.clientHeight)
      setViewportW(el.clientWidth)
    })
    ro.observe(el)
    setViewportH(el.clientHeight)
    setViewportW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // ── 缩放锚点应用：scale 变化后的首次渲染里，把锚定的文档点放回原屏幕位置 ──
  useLayoutEffect(() => {
    const a = pendingAnchor.current
    const el = scrollRef.current
    if (!a || !el || !pageDims.length) return
    pendingAnchor.current = null
    const dim = pageDims[a.page - 1]
    if (!dim) return
    const offs = pageOffsets(pageDims, scale)
    const pageX = (boxW - dim.w * scale) / 2 + a.xInPage * scale
    const pageY = offs[a.page - 1] + a.yInPage * scale
    el.scrollTop = Math.max(0, pageY - a.clientDY)
    el.scrollLeft = Math.max(0, pageX - a.clientDX)
    setScrollTop(el.scrollTop)
    updateCurrentPage(el)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, pageDims])

  /** 计算某屏幕点（相对滚动容器）下的文档点（页码 + 页内 pt） */
  const docPointAt = useCallback(
    (clientDX: number, clientDY: number): Omit<ZoomAnchor, 'mode'> | null => {
      const el = scrollRef.current
      if (!el || !pageDims.length) return null
      const px = clientDX + el.scrollLeft
      const py = clientDY + el.scrollTop
      let page = 1
      for (let i = 0; i < offsets.length; i++) if (py >= offsets[i]) page = i + 1
      const dim = pageDims[page - 1]
      const pageLeft = (boxW - dim.w * scale) / 2
      return {
        page,
        xInPage: (px - pageLeft) / scale,
        yInPage: (py - offsets[page - 1]) / scale,
        clientDX,
        clientDY,
      }
    },
    [offsets, pageDims, boxW, scale],
  )

  // ── 缩放请求（顶栏按钮 / +/- 快捷键）：以视口中心为锚 ─────────────────────
  useEffect(() => {
    const z = s.zoomReq
    if (!z) return
    const el = scrollRef.current
    if (!el || !pageDims.length) return
    if (z.ts === lastZoomTs.current) return
    lastZoomTs.current = z.ts
    const next = clampScale(z.dir === 'in' ? scale * 1.2 : scale / 1.2)
    if (next === scale) return
    const anchor = docPointAt(el.clientWidth / 2, el.clientHeight / 2)
    if (!anchor) return
    pendingAnchor.current = { mode: 'center', ...anchor }
    s.setScale(Number(next.toFixed(3)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.zoomReq])

  // ── 缩放（Ctrl+滚轮）：以鼠标位置为锚 ─────────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const next = clampScale(scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12))
      if (next === scale) return
      const anchor = docPointAt(e.clientX - el.getBoundingClientRect().left, e.clientY - el.getBoundingClientRect().top)
      if (!anchor) return
      pendingAnchor.current = { mode: 'cursor', ...anchor }
      s.setScale(Number(next.toFixed(3)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [scale, pageDims, offsets, contentW, s, docPointAt])

  // ── 滚动：虚拟化窗口 + 当前页（同步由 syncBus 原生监听完成）─────────────
  const updateCurrentPage = useCallback(
    (el: HTMLDivElement) => {
      const center = el.scrollTop + el.clientHeight / 2
      if (!pageDims.length) return
      const offs = pageOffsets(pageDims, scale)
      let page = 1
      for (let i = 0; i < offs.length; i++) if (center >= offs[i]) page = i + 1
      s.setCurrentPage(page)
    },
    [pageDims, scale, s],
  )

  const scrollHandler = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setScrollTop(el.scrollTop)
    updateCurrentPage(el)
  }, [updateCurrentPage])

  const scrollToY = useCallback(
    (y: number) => {
      const el = scrollRef.current
      if (!el) return
      const top = Math.max(0, y - el.clientHeight / 3)
      // 跨页大跳距用瞬时滚动（smooth 在数千页文档上又慢又难定位）
      if (Math.abs(top - el.scrollTop) > 3000) {
        el.scrollTop = top
        setScrollTop(top)
        updateCurrentPage(el)
        return
      }
      el.scrollTo({ top, behavior: 'smooth' })
    },
    [updateCurrentPage],
  )

  // ── 跳转（ts 消费后不再重放，避免缩放时被旧目标拉回） ─────────────────────
  useEffect(() => {
    const t = s.jumpTarget
    if (!t || !pageDims.length) return
    if (t.ts === lastJumpTs.current) return
    lastJumpTs.current = t.ts
    const offs = offsets
    if (t.annId) {
      const ann = s.annotations.find((a) => a.id === t.annId)
      if (ann) {
        const yTop = 'quads' in ann && ann.quads.length ? Math.min(...ann.quads.map((q: Quad) => q.y1)) : 'rect' in ann ? ann.rect.y : 0
        scrollToY(offs[ann.page - 1] + yTop * scale - 24)
        s.flashTargets([ann.id])
        return
      }
    }
    if (t.y != null && pageDims[t.page - 1]) {
      // 大纲书签：页内精确 y
      scrollToY(offs[t.page - 1] + t.y * scale - 28)
      return
    }
    if (t.cardId) {
      const card = s.cards.find((c) => c.id === t.cardId)
      if (card) {
        const yIn = anchorYInPage(card, s.annotations)
        scrollToY(offs[card.anchor.page - 1] + yIn * scale - 40)
        const anchor = card.anchor
        if (anchor.kind === 'annotation') s.flashTargets([anchor.annotationId], card.id)
        else s.flashTargets([], card.id)
        return
      }
    }
    scrollToY(offs[t.page - 1] ?? 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.jumpTarget, pageDims, scale])

  // ── 可见页范围（虚拟化） ──────────────────────────────────────────────────
  const visible = useMemo(() => {
    if (!pageDims.length) return new Set<number>()
    const top = scrollTop - viewportH
    const bottom = scrollTop + viewportH * 2
    const set = new Set<number>()
    pageDims.forEach((d, i) => {
      const y0 = offsets[i]
      const y1 = y0 + d.h * scale
      if (y1 >= top && y0 <= bottom) set.add(i + 1)
    })
    return set
  }, [scrollTop, viewportH, pageDims, offsets, scale])

  // ── 渲染 ───────────────────────────────────────────────────────────────────
  if (!docPath) return null
  return (
    <div className="ps-viewer" style={{ cursor: s.tool === 'mask' || s.tool === 'image' ? 'crosshair' : undefined }}>
      <div
        ref={(el) => {
          scrollRef.current = el
          scrollSyncRef.current(el)
        }}
        className="ps-scroll"
        tabIndex={-1}
        onScroll={scrollHandler}
      >
        <div ref={contentRef} className="ps-content" style={{ height: totalH, width: boxW }}>
          {pageDims.map((d, i) => (
            <div
              key={i}
              className="ps-page-slot"
              style={{ top: offsets[i], left: (boxW - d.w * scale) / 2, width: d.w * scale, height: d.h * scale }}
            >
              {visible.has(i + 1) && <PageView pdf={pdf} pageNumber={i + 1} dim={d} scale={scale} active />}
            </div>
          ))}
        </div>
      </div>
      <NoteTabRail
        cards={s.cards.filter((c) => c.minimized || !s.rightOpen)}
        annotations={s.annotations}
        scrollTop={scrollTop}
        viewportH={viewportH}
        dims={pageDims}
        scale={scale}
      />
      {!pageDims.length && pageCount === 0 && (
        <div className="ps-loading">
          <span className="ps-spinner" /> 正在加载文档…
        </div>
      )}
    </div>
  )
}

/** 卡片锚点在页内的 Y（pt） */
export function anchorYInPage(card: Card, annotations: Annotation[]): number {
  const anchor = card.anchor
  if (anchor.kind === 'annotation') {
    const ann = annotations.find((a) => a.id === anchor.annotationId)
    if (ann) {
      if ('quads' in ann && ann.quads.length) return Math.max(0, Math.min(...ann.quads.map((q) => q.y1)) - 2)
      if ('rect' in ann) return Math.max(0, ann.rect.y - 2)
    }
  }
  return 4
}

export { VIEW_PAD }
