// IDE 模式 PDF 阅读器：连续滚动 + 虚拟化页渲染 + 文本层 + 缩放锚点 + 书签大纲
// 改编自 pdfstudy/PdfViewer + PageView 的渲染内核，按需求去除全部标注/卡片/选区功能。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { TextLayer } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'
import { psApi } from '../pdfstudy/api'
import type { OutlineNode } from '../pdfstudy/types'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const PAGE_GAP = 16 // px，页间距
const VIEW_PAD = 24 // 上下留白

const clampScale = (v: number) => Math.min(4, Math.max(0.4, v))

interface PageDim {
  w: number
  h: number
}

interface ZoomAnchor {
  page: number
  xInPage: number // pt
  yInPage: number // pt
  clientDX: number // 相对滚动容器的目标横向位置
  clientDY: number
}

function pageOffsets(dims: PageDim[], scale: number): number[] {
  const out: number[] = []
  let y = VIEW_PAD
  for (const d of dims) {
    out.push(y)
    y += d.h * scale + PAGE_GAP
  }
  return out
}

let currentPdf: PDFDocumentProxy | null = null
let currentLoadToken = 0

export default function IdePdf({ path, dark }: { path: string; dark: boolean }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [dims, setDims] = useState<PageDim[]>([])
  const [scale, setScale] = useState(1.2)
  const [page, setPage] = useState(1)
  const [outline, setOutline] = useState<OutlineNode[] | null>(null)
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [error, setError] = useState('')

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(800)
  const [viewportW, setViewportW] = useState(1200)
  const pendingAnchor = useRef<ZoomAnchor | null>(null)

  // ── 加载文档 + 书签 ───────────────────────────────────────────────────────
  useEffect(() => {
    const myToken = ++currentLoadToken
    setDims([])
    setPdf(null)
    setPage(1)
    setError('')
    setOutline(null)
    async function load() {
      try {
        const doc = await pdfjsLib.getDocument({ url: `/api/raw?path=${encodeURIComponent(path)}` }).promise
        if (myToken !== currentLoadToken) {
          void doc.destroy().catch(() => undefined)
          return
        }
        void currentPdf?.destroy().catch(() => undefined)
        currentPdf = doc
        setPdf(doc)
        // 分块并行预取页面尺寸：大文档串行 await 会拖慢首屏；每块完成即渐进更新
        const ds: PageDim[] = []
        const CHUNK = 32
        for (let i = 1; i <= doc.numPages; i += CHUNK) {
          if (myToken !== currentLoadToken) return
          const end = Math.min(i + CHUNK - 1, doc.numPages)
          const pages = await Promise.all(
            Array.from({ length: end - i + 1 }, (_, k) => doc.getPage(i + k)),
          )
          for (const p of pages) {
            const vp = p.getViewport({ scale: 1 })
            ds.push({ w: vp.width, h: vp.height })
          }
          setDims([...ds])
        }
        if (myToken !== currentLoadToken) return
        setDims(ds)
      } catch (e) {
        if (myToken !== currentLoadToken) return
        setError('PDF 加载失败：' + String((e as Error).message || e))
      }
    }
    void load()
    psApi
      .getOutline(path)
      .then((r) => {
        if (myToken === currentLoadToken) setOutline(r.outline)
      })
      .catch(() => myToken === currentLoadToken && setOutline([]))
  }, [path])

  // ── 布局 ─────────────────────────────────────────────────────────────────
  const offsets = useMemo(() => pageOffsets(dims, scale), [dims, scale])
  const totalH = useMemo(
    () => (dims.length ? VIEW_PAD * 2 + dims.reduce((s, d) => s + d.h * scale + PAGE_GAP, 0) - PAGE_GAP : VIEW_PAD * 2),
    [dims, scale],
  )
  const contentW = useMemo(() => (dims.length ? Math.max(...dims.map((d) => d.w)) * scale : 0), [dims, scale])
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

  // ── 缩放锚点：scale 变化后把锚定文档点放回原屏幕位置 ─────────────────────
  useLayoutEffect(() => {
    const a = pendingAnchor.current
    const el = scrollRef.current
    if (!a || !el || !dims.length) return
    pendingAnchor.current = null
    const dim = dims[a.page - 1]
    if (!dim) return
    const offs = pageOffsets(dims, scale)
    const pageX = (boxW - dim.w * scale) / 2 + a.xInPage * scale
    const pageY = offs[a.page - 1] + a.yInPage * scale
    el.scrollTop = Math.max(0, pageY - a.clientDY)
    el.scrollLeft = Math.max(0, pageX - a.clientDX)
    setScrollTop(el.scrollTop)
    updateCurrentPage(el)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, dims])

  const docPointAt = useCallback(
    (clientDX: number, clientDY: number): ZoomAnchor | null => {
      const el = scrollRef.current
      if (!el || !dims.length) return null
      const px = clientDX + el.scrollLeft
      const py = clientDY + el.scrollTop
      let pg = 1
      for (let i = 0; i < offsets.length; i++) if (py >= offsets[i]) pg = i + 1
      const dim = dims[pg - 1]
      const pageLeft = (boxW - dim.w * scale) / 2
      return {
        page: pg,
        xInPage: (px - pageLeft) / scale,
        yInPage: (py - offsets[pg - 1]) / scale,
        clientDX,
        clientDY,
      }
    },
    [offsets, dims, boxW, scale],
  )

  function zoom(dir: 'in' | 'out', atCursor?: { x: number; y: number }) {
    const el = scrollRef.current
    if (!el || !dims.length) return
    const next = clampScale(dir === 'in' ? scale * 1.2 : scale / 1.2)
    if (next === scale) return
    const anchor = docPointAt(
      atCursor?.x ?? el.clientWidth / 2,
      atCursor?.y ?? el.clientHeight / 2,
    )
    if (!anchor) return
    pendingAnchor.current = anchor
    setScale(Number(next.toFixed(3)))
  }

  // Ctrl+滚轮以鼠标位置为锚
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      zoom(e.deltaY < 0 ? 'in' : 'out', {
        x: e.clientX - el.getBoundingClientRect().left,
        y: e.clientY - el.getBoundingClientRect().top,
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, dims, offsets, boxW, docPointAt])

  const updateCurrentPage = useCallback(
    (el: HTMLDivElement) => {
      const center = el.scrollTop + el.clientHeight / 2
      if (!dims.length) return
      const offs = pageOffsets(dims, scale)
      let pg = 1
      for (let i = 0; i < offs.length; i++) if (center >= offs[i]) pg = i + 1
      setPage(pg)
    },
    [dims, scale],
  )

  const scrollToY = useCallback(
    (y: number) => {
      const el = scrollRef.current
      if (!el) return
      const top = Math.max(0, y - el.clientHeight / 3)
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

  function jumpTo(pg: number, yInPage?: number) {
    if (!dims.length) return
    const offs = pageOffsets(dims, scale)
    const target = Math.min(Math.max(1, pg), dims.length)
    scrollToY(offs[target - 1] + (yInPage ?? 0) * scale - 28)
  }

  // ── 可见页（虚拟化） ─────────────────────────────────────────────────────
  const visible = useMemo(() => {
    const set = new Set<number>()
    if (!dims.length) return set
    const top = scrollTop - viewportH
    const bottom = scrollTop + viewportH * 2
    dims.forEach((d, i) => {
      const y0 = offsets[i]
      if (y0 + d.h * scale >= top && y0 <= bottom) set.add(i + 1)
    })
    return set
  }, [scrollTop, viewportH, dims, offsets, scale])

  return (
    <div className="pdf-study" data-theme={dark ? 'dark' : 'light'}>
      <div className="ps-topbar">
        <div className="ps-tb-left">
          <button className={`icon-btn ${outlineOpen ? 'active' : ''}`} title="大纲" onClick={() => setOutlineOpen((o) => !o)}>
            <span className="material-symbols-rounded">format_list_bulleted</span>
          </button>
          <span className="ps-tb-doc-title" title={path}>
            {path.split('/').pop()}
          </span>
        </div>
        <div className="ps-tb-tools">
          <button className="ps-tool-btn" title="缩小（Ctrl+滚轮 亦可）" onClick={() => zoom('out')}>
            <span className="material-symbols-rounded">remove</span>
          </button>
          <span className="ps-zoom-val">{Math.round(scale * 100)}%</span>
          <button className="ps-tool-btn" title="放大（Ctrl+滚轮 亦可）" onClick={() => zoom('in')}>
            <span className="material-symbols-rounded">add</span>
          </button>
        </div>
        <div className="ps-tb-right">
          <span className="ps-page-ind">
            <input
              defaultValue={String(page)}
              key={page}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = parseInt((e.target as HTMLInputElement).value, 10)
                  if (Number.isFinite(v)) jumpTo(v)
                }
              }}
              style={{ width: 44, padding: '3px 6px', textAlign: 'center', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)' }}
            />
            / {dims.length || '-'}
          </span>
        </div>
      </div>
      <div className="ps-body">
        {outlineOpen && (
          <aside className="ps-outline">
            <div className="ps-outline-head">
              <span className="material-symbols-rounded">menu_book</span>
              <span>大纲</span>
            </div>
            <OutlineList outline={outline} onJump={(pg, y) => jumpTo(pg, y)} />
          </aside>
        )}
        <div className="ps-center">
          <div className="ps-viewer">
            <div
              ref={scrollRef}
              className="ps-scroll"
              tabIndex={-1}
              onScroll={() => {
                const el = scrollRef.current
                if (!el) return
                setScrollTop(el.scrollTop)
                updateCurrentPage(el)
              }}
            >
              <div className="ps-content" style={{ height: totalH, width: boxW }}>
                {dims.map((d, i) => (
                  <div
                    key={i}
                    className="ps-page-slot"
                    style={{ top: offsets[i], left: (boxW - d.w * scale) / 2, width: d.w * scale, height: d.h * scale }}
                  >
                    {visible.has(i + 1) && <IdePage pdf={pdf} pageNumber={i + 1} dim={d} scale={scale} />}
                  </div>
                ))}
              </div>
            </div>
            {!dims.length && !error && (
              <div className="ps-loading">
                <span className="ps-spinner" /> 正在加载文档…
              </div>
            )}
            {error && <div className="ps-error-tip">{error}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

/** 单页渲染：canvas + 文本层（支持选择复制），无任何标注层 */
function IdePage({ pdf, pageNumber, dim, scale }: { pdf: PDFDocumentProxy | null; pageNumber: number; dim: PageDim; scale: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null)
  const textContentRef = useRef<any>(null)

  useEffect(() => {
    if (!pdf) return
    let cancelled = false
    ;(async () => {
      const pg = await pdf.getPage(pageNumber)
      if (cancelled) return
      const dpr = window.devicePixelRatio || 1
      const viewport = pg.getViewport({ scale: scale * dpr })
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width = `${dim.w * scale}px`
      canvas.style.height = `${dim.h * scale}px`
      const ctx = canvas.getContext('2d')!
      renderTaskRef.current?.cancel()
      const task = pg.render({ canvasContext: ctx, viewport })
      renderTaskRef.current = task
      try {
        await task.promise
      } catch {
        /* 被取消的渲染忽略 */
      }
    })()
    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
      renderTaskRef.current = null
    }
  }, [pdf, pageNumber, scale, dim.w, dim.h])

  useEffect(() => {
    if (!pdf) return
    let cancelled = false
    ;(async () => {
      const pg = await pdf.getPage(pageNumber)
      if (cancelled) return
      if (!textContentRef.current) textContentRef.current = await pg.getTextContent()
      const container = textRef.current
      if (!container) return
      container.replaceChildren()
      const tl = new TextLayer({
        textContentSource: textContentRef.current,
        container,
        viewport: pg.getViewport({ scale }),
      })
      await tl.render()
    })()
    return () => {
      cancelled = true
    }
  }, [pdf, pageNumber, scale])

  return (
    <div className="ps-page" style={{ '--scale-factor': scale } as React.CSSProperties}>
      <canvas ref={canvasRef} className="ps-page-canvas" />
      <div ref={textRef} className="textLayer" />
    </div>
  )
}

function OutlineList({ outline, onJump }: { outline: OutlineNode[] | null; onJump: (page: number, y?: number) => void }) {
  if (outline === null) {
    return (
      <div className="ps-side-empty">
        <span className="ps-spinner" />
        <p>正在解析大纲…</p>
      </div>
    )
  }
  if (!outline.length) {
    return (
      <div className="ps-side-empty">
        <span className="material-symbols-rounded">menu_book</span>
        <p>本文档没有书签大纲</p>
      </div>
    )
  }
  return (
    <div className="ps-outline-list">
      {outline.map((node, i) => (
        <OutlineItem key={i} node={node} level={0} onJump={onJump} />
      ))}
    </div>
  )
}

function OutlineItem({
  node,
  level,
  onJump,
}: {
  node: OutlineNode
  level: number
  onJump: (page: number, y?: number) => void
}) {
  const hasKids = node.children.length > 0
  const [open, setOpen] = useState(level < 1)
  return (
    <div className="ps-ol-branch">
      <div
        className={`ps-ol-item${node.page ? '' : ' disabled'}${level === 0 ? ' top' : ''}`}
        style={{ paddingLeft: 6 + level * 13 }}
        onClick={() => node.page && onJump(node.page, node.yInPage ?? undefined)}
        title={node.page ? `第 ${node.page} 页` : '无跳转目标'}
      >
        {hasKids ? (
          <button
            className="ps-ol-caret"
            onClick={(e) => {
              e.stopPropagation()
              setOpen(!open)
            }}
          >
            <span className="material-symbols-rounded">{open ? 'keyboard_arrow_down' : 'keyboard_arrow_right'}</span>
          </button>
        ) : (
          <span className="ps-ol-dot" />
        )}
        <span className="ps-ol-title">{node.title}</span>
        {node.page ? <span className="ps-ol-page">{node.page}</span> : null}
      </div>
      {hasKids && open && (
        <div className="ps-ol-children">
          {node.children.map((child, i) => (
            <OutlineItem key={i} node={child} level={level + 1} onJump={onJump} />
          ))}
        </div>
      )}
    </div>
  )
}
