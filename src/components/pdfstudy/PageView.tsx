// 单页：canvas 渲染 + 文本层（选择）+ 标注/遮罩/贴图覆盖层 + 交互
import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { TextLayer } from 'pdfjs-dist'
import { useStore } from './store'
import { psApi, fileToB64, uid } from './api'
import type { Annotation, ImageAnnotation, MaskAnnotation, Quad, TextAnnotation } from './types'

interface Props {
  pdf: PDFDocumentProxy | null
  pageNumber: number
  dim: { w: number; h: number }
  scale: number
  active: boolean
}

interface Draft {
  x: number
  y: number
  w: number
  h: number
}

export default function PageView({ pdf, pageNumber, dim, scale, active }: Props) {
  const s = useStore()
  const pageElRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null)
  const textContentRef = useRef<any>(null)
  const [textReady, setTextReady] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const draftRef = useRef<Draft | null>(null)
  const [popover, setPopover] = useState<{ id: string; left: number; top: number } | null>(null)
  const [tagInputOpen, setTagInputOpen] = useState(false)
  const imgInputRef = useRef<HTMLInputElement>(null)
  const imgPlaceRef = useRef<{ x: number; y: number } | null>(null)

  const pageAnnotations = s.annotations.filter((a) => a.page === pageNumber)
  const shapeTool = s.tool === 'mask' || s.tool === 'image'

  // ── canvas 渲染 ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!active || !pdf) return
    let cancelled = false
    ;(async () => {
      const page = await pdf.getPage(pageNumber)
      if (cancelled) return
      const dpr = window.devicePixelRatio || 1
      const viewport = page.getViewport({ scale: scale * dpr })
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width = `${dim.w * scale}px`
      canvas.style.height = `${dim.h * scale}px`
      const ctx = canvas.getContext('2d')!
      renderTaskRef.current?.cancel()
      const task = page.render({ canvasContext: ctx, viewport })
      renderTaskRef.current = task
      try {
        await task.promise
      } catch {
        // 被取消的渲染忽略
      }
    })()
    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
      renderTaskRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pdf, pageNumber, scale])

  // ── 文本层 ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!active || !pdf) return
    let cancelled = false
    ;(async () => {
      const page = await pdf.getPage(pageNumber)
      if (cancelled) return
      if (!textContentRef.current) {
        textContentRef.current = await page.getTextContent()
        if (cancelled) return
      }
      const container = textLayerRef.current
      if (!container) return
      container.replaceChildren()
      const tl = new TextLayer({
        textContentSource: textContentRef.current,
        container,
        viewport: page.getViewport({ scale }),
      })
      await tl.render()
      if (!cancelled) setTextReady(true)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pdf, pageNumber, scale])

  // ── 选区 → quads ───────────────────────────────────────────────────────────
  function computeSelection(): { quads: Quad[]; text: string; clientX: number; clientY: number } | null {
    const pageEl = pageElRef.current
    const sel = window.getSelection()
    if (!pageEl || !sel || sel.isCollapsed || !sel.rangeCount) return null
    const range = sel.getRangeAt(0)
    if (!pageEl.contains(range.startContainer) || !pageEl.contains(range.endContainer)) return null
    const pageRect = pageEl.getBoundingClientRect()
    const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 1)
    if (!rects.length) return null
    // 合并同一行的 rect；并钳制到页面边界内——文本层偶发的缩放不同步
    // （span 布局与 scale 短暂不一致）会产生越界 rect，画出来会超出页面
    const lines: Quad[] = []
    for (const r of rects) {
      const q: Quad = {
        x1: Math.min(dim.w, Math.max(0, (r.left - pageRect.left) / scale)),
        y1: Math.min(dim.h, Math.max(0, (r.top - pageRect.top) / scale)),
        x2: Math.min(dim.w, Math.max(0, (r.right - pageRect.left) / scale)),
        y2: Math.min(dim.h, Math.max(0, (r.bottom - pageRect.top) / scale)),
      }
      if (q.x2 - q.x1 < 0.5 || q.y2 - q.y1 < 0.5) continue
      const last = lines[lines.length - 1]
      if (last) {
        const overlap = Math.min(last.y2, q.y2) - Math.max(last.y1, q.y1)
        const minH = Math.min(last.y2 - last.y1, q.y2 - q.y1)
        if (minH > 0 && overlap > minH * 0.5) {
          last.x1 = Math.min(last.x1, q.x1)
          last.x2 = Math.max(last.x2, q.x2)
          last.y1 = Math.min(last.y1, q.y1)
          last.y2 = Math.max(last.y2, q.y2)
          continue
        }
      }
      lines.push(q)
    }
    const rangeRect = range.getBoundingClientRect()
    return {
      quads: lines,
      text: sel.toString().replace(/\s+/g, ' ').trim(),
      clientX: pageRect.left + lines[0].x1 * scale,
      clientY: rangeRect.top,
    }
  }

  function applyTextAnnotation(type: TextAnnotation['type'], quads: Quad[], text: string) {
    s.addAnnotation({
      id: uid(),
      page: pageNumber,
      type,
      color: s.annotColor,
      quads,
      text,
      tags: [],
      createdAt: new Date().toISOString(),
    })
    window.getSelection()?.removeAllRanges()
  }

  function onMouseUp() {
    if (shapeTool) return
    if (s.tool === 'pointer') return // 指针工具只用于点选标注
    const info = computeSelection()
    if (!info || !info.text) return
    if (s.tool !== 'select') {
      // 直接标注工具：选中即应用
      applyTextAnnotation(s.tool as TextAnnotation['type'], info.quads, info.text)
      return
    }
    s.setSelection({ page: pageNumber, quads: info.quads, text: info.text, clientX: info.clientX, clientY: info.clientY })
  }

  // ── 遮罩拖绘 ───────────────────────────────────────────────────────────────
  function onOverlayPointerDown(e: React.PointerEvent) {
    if (s.tool !== 'mask') return
    const pageEl = pageElRef.current
    if (!pageEl) return
    e.preventDefault()
    const rect = pageEl.getBoundingClientRect()
    const startX = e.clientX - rect.left
    const startY = e.clientY - rect.top
    const draftState = { x: startX, y: startY, w: 0, h: 0 }
    draftRef.current = draftState
    setDraft({ ...draftState })
    const onMove = (ev: PointerEvent) => {
      const x = ev.clientX - rect.left
      const y = ev.clientY - rect.top
      draftState.x = Math.min(startX, x)
      draftState.y = Math.min(startY, y)
      draftState.w = Math.abs(x - startX)
      draftState.h = Math.abs(y - startY)
      setDraft({ ...draftState })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const d = draftRef.current
      draftRef.current = null
      setDraft(null)
      if (d && d.w > 10 && d.h > 8) {
        s.addAnnotation({
          id: uid(),
          page: pageNumber,
          type: 'mask',
          color: s.maskColor,
          rect: { x: d.x / scale, y: d.y / scale, w: d.w / scale, h: d.h / scale },
          tags: [],
          createdAt: new Date().toISOString(),
        })
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ── 贴图：点击选图 ─────────────────────────────────────────────────────────
  function onOverlayClickImage(e: React.MouseEvent) {
    if (s.tool !== 'image') return
    const pageEl = pageElRef.current
    if (!pageEl) return
    const rect = pageEl.getBoundingClientRect()
    imgPlaceRef.current = { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale }
    imgInputRef.current?.click()
  }

  async function onImagePicked(file: File) {
    const place = imgPlaceRef.current ?? { x: dim.w / 2 - 110, y: dim.h / 2 - 80 }
    try {
      const b64 = await fileToB64(file)
      const { url } = await psApi.uploadAsset(s.docPath, b64, file.type || 'image/png')
      const ann: ImageAnnotation = {
        id: uid(),
        page: pageNumber,
        type: 'image',
        color: '#8b5cf6',
        rect: { x: place.x, y: place.y, w: 220, h: 160 },
        src: url,
        tags: [],
        createdAt: new Date().toISOString(),
      }
      s.addAnnotation(ann)
      s.setTool('select')
    } catch (e) {
      s.toast('图片上传失败：' + String((e as Error).message || e), 'error')
    }
  }

  // ── 形状（遮罩/贴图）拖动/缩放 ────────────────────────────────────────────
  function beginShapeDrag(e: React.PointerEvent, ann: MaskAnnotation | ImageAnnotation, mode: 'move' | 'resize') {
    e.stopPropagation()
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const orig = { ...ann.rect }
    let moved = false
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / scale
      const dy = (ev.clientY - startY) / scale
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) moved = true
      if (mode === 'move') {
        s.updateAnnotation(ann.id, { rect: { ...orig, x: orig.x + dx, y: orig.y + dy } } as Partial<Annotation>)
      } else {
        s.updateAnnotation(ann.id, { rect: { ...orig, w: Math.max(14, orig.w + dx), h: Math.max(12, orig.h + dy) } } as Partial<Annotation>)
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (!moved && ann.type === 'mask') s.toggleMask(ann.id)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ── 标注点击弹层 ───────────────────────────────────────────────────────────
  function openAnnPopover(e: React.MouseEvent, id: string) {
    if (popover?.id === id) {
      setPopover(null)
      return
    }
    setPopover({ id, left: e.clientX, top: e.clientY + 10 })
    setTagInputOpen(false)
  }

  // 点击弹层/标注以外的空白处自动关闭
  useEffect(() => {
    if (!popover) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('.ps-ann-popover')) return
      if (t.closest('.ps-ann') && !(t as HTMLElement).classList.contains('ps-ann-del')) return
      setPopover(null)
      setTagInputOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [popover])

  const popAnn = pageAnnotations.find((a) => a.id === popover?.id)

  return (
    <div
      ref={pageElRef}
      className="ps-page"
      data-page={pageNumber}
      onMouseUp={onMouseUp}
      style={{ ['--scale-factor' as never]: String(scale) }}
    >
      <canvas ref={canvasRef} className="ps-page-canvas" />
      <div ref={textLayerRef} className="textLayer" style={{ opacity: textReady ? undefined : 0 }} />
      <div
        className={`ps-anno-layer${shapeTool ? ' interactive' : ''}`}
        onPointerDown={onOverlayPointerDown}
        onClick={onOverlayClickImage}
      >
        {pageAnnotations.map((ann) => (
          <AnnotationShape
            key={ann.id + '|' + (s.flash?.annIds.includes(ann.id) ? s.flash.ts : 0)}
            ann={ann}
            scale={scale}
            revealed={s.revealedMasks.has(ann.id)}
            selected={s.selectedAnnId === ann.id}
            flashing={s.flash?.annIds.includes(ann.id) ? s.flash.ts : 0}
            onClick={(e) => {
              if (s.tool === 'select' || s.tool === 'pointer') openAnnPopover(e, ann.id)
            }}
            onShapePointerDown={(e, mode) => beginShapeDrag(e, ann as MaskAnnotation | ImageAnnotation, mode)}
          />
        ))}
        {draft && (
          <div
            className="ps-mask-draft"
            style={{ left: draft.x, top: draft.y, width: draft.w, height: draft.h }}
          />
        )}
      </div>
      <input
        ref={imgInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onImagePicked(f)
          e.target.value = ''
        }}
      />
      {popover && popAnn && (
        <div
          className="ps-ann-popover"
          style={{ left: popover.left, top: popover.top }}
          onMouseLeave={() => {
            if (!tagInputOpen) setPopover(null)
          }}
        >
          <div className="ps-ann-popover-quote">{popAnn.type === 'mask' ? '遮罩框' : 'text' in popAnn ? popAnn.text.slice(0, 60) : '贴图'}</div>
          <div className="ps-ann-popover-actions">
            <button
              onClick={() => {
                const quote = 'text' in popAnn ? popAnn.text : ''
                s.setCardEditor({ draft: { anchor: { kind: 'annotation', annotationId: popAnn.id, page: popAnn.page }, quote } })
                setPopover(null)
              }}
            >
              <span className="material-symbols-rounded">note_add</span>卡片
            </button>
            <button onClick={() => setTagInputOpen((v) => !v)}>
              <span className="material-symbols-rounded">sell</span>标签
            </button>
            <button
              className="danger"
              onClick={() => {
                s.deleteAnnotation(popAnn.id)
                setPopover(null)
              }}
            >
              <span className="material-symbols-rounded">delete</span>删除
            </button>
          </div>
          {tagInputOpen && (
            <TagQuickInput
              knownTags={allTags(s.annotations, s.cards)}
              onSubmit={(tag) => {
                s.updateAnnotation(popAnn.id, { tags: [...new Set([...popAnn.tags, tag])] } as Partial<Annotation>)
                s.toast(`已打标签 #${tag}`, 'ok')
              }}
              onClose={() => {
                setTagInputOpen(false)
                setPopover(null)
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

function allTags(annotations: Annotation[], cards: import('./types').Card[]): string[] {
  const set = new Set<string>()
  for (const a of annotations) a.tags.forEach((t) => set.add(t))
  for (const c of cards) c.tags.forEach((t) => set.add(t))
  return [...set]
}

function TagQuickInput({ knownTags, onSubmit, onClose }: { knownTags: string[]; onSubmit: (t: string) => void; onClose: () => void }) {
  const [v, setV] = useState('')
  return (
    <div className="ps-tag-quick" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        list="la-known-tags"
        placeholder="输入标签回车"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && v.trim()) {
            onSubmit(v.trim())
            onClose()
          } else if (e.key === 'Escape') onClose()
        }}
      />
      <datalist id="la-known-tags">
        {knownTags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  )
}

// ── 单个标注形状 ──────────────────────────────────────────────────────────────
function AnnotationShape({
  ann,
  scale,
  revealed,
  selected,
  flashing,
  onClick,
  onShapePointerDown,
}: {
  ann: Annotation
  scale: number
  revealed: boolean
  selected: boolean
  flashing: number
  onClick: (e: React.MouseEvent) => void
  onShapePointerDown: (e: React.PointerEvent, mode: 'move' | 'resize') => void
}) {
  const s = useStore()
  const cls = `ps-ann ${ann.type}${selected ? ' selected' : ''}${flashing ? ' flashing' : ''}`
  const flashKey = flashing || undefined

  if ('quads' in ann) {
    return (
      <div style={{ position: 'absolute', inset: 0 }}>
        {ann.quads.map((q, i) => (
          <QuadShape key={i} ann={ann} quad={q} scale={scale} selected={selected} flashing={flashing} onClick={onClick} />
        ))}
      </div>
    )
  }
  if (ann.type === 'mask') {
    const r = ann.rect
    return (
      <div
        key={flashKey}
        className={cls}
        style={{
          left: r.x * scale,
          top: r.y * scale,
          width: r.w * scale,
          height: r.h * scale,
          background: ann.color,
          opacity: revealed ? 0.16 : 1,
        }}
        onPointerDown={(e) => onShapePointerDown(e, 'move')}
      >
        <span className={`ps-mask-eye${revealed ? ' on' : ''}`}>
          <span className="material-symbols-rounded">{revealed ? 'visibility' : 'visibility_off'}</span>
        </span>
        <button
          className="ps-ann-del"
          title="删除"
          onClick={(e) => {
            e.stopPropagation()
            s.deleteAnnotation(ann.id)
          }}
        >
          <span className="material-symbols-rounded">close</span>
        </button>
        <span className="ps-ann-resize" onPointerDown={(e) => onShapePointerDown(e, 'resize')} />
      </div>
    )
  }
  // image
  const r = ann.rect
  return (
    <div
      key={flashKey}
      className={cls}
      style={{ left: r.x * scale, top: r.y * scale, width: r.w * scale, height: r.h * scale }}
      onPointerDown={(e) => onShapePointerDown(e, 'move')}
    >
      <img src={ann.src} draggable={false} alt="贴图" />
      <button
        className="ps-ann-del"
        title="删除"
        onClick={(e) => {
          e.stopPropagation()
          s.deleteAnnotation(ann.id)
        }}
      >
        <span className="material-symbols-rounded">close</span>
      </button>
      <span className="ps-ann-resize" onPointerDown={(e) => onShapePointerDown(e, 'resize')} />
    </div>
  )
}

function QuadShape({
  ann,
  quad,
  scale,
  selected,
  flashing,
  onClick,
}: {
  ann: TextAnnotation
  quad: Quad
  scale: number
  selected: boolean
  flashing: number
  onClick: (e: React.MouseEvent) => void
}) {
  const left = quad.x1 * scale
  const top = quad.y1 * scale
  const width = (quad.x2 - quad.x1) * scale
  const height = (quad.y2 - quad.y1) * scale
  const style: React.CSSProperties = { left, top, width, height }
  const sel = selected ? ' selected' : ''
  const fla = flashing ? ' flashing' : ''

  if (ann.type === 'highlight') {
    return <div className={`ps-ann highlight${sel}${fla}`} onClick={onClick} style={{ ...style, background: ann.color }} />
  }
  if (ann.type === 'underline') {
    return (
      <div
        className={`ps-ann underline${sel}${fla}`}
        onClick={onClick}
        style={{ ...style, top: top + height - 1.5, height: Math.max(1.6, 1.2 * (scale / 1.2)), background: ann.color }}
      />
    )
  }
  if (ann.type === 'strikethrough') {
    return (
      <div
        className={`ps-ann strikethrough${sel}${fla}`}
        onClick={onClick}
        style={{ ...style, top: top + height / 2 - 1, height: Math.max(1.6, 1.2 * (scale / 1.2)), background: ann.color }}
      />
    )
  }
  if (ann.type === 'tag-anchor') {
    return (
      <div className={`ps-ann tag-anchor${sel}${fla}`} onClick={onClick} style={{ ...style, top: top + height - 2, height: 3 }}>
        <span className="ps-tag-dot" style={{ background: ann.color }} />
      </div>
    )
  }
  // squiggly：SVG 波浪线
  const amp = 2.4
  const step = 6
  const n = Math.max(2, Math.ceil(width / step))
  let d = `M0 ${amp}`
  for (let i = 1; i <= n; i++) {
    d += ` Q ${(i - 0.5) * step} ${i % 2 ? 0 : amp * 2}, ${i * step} ${amp}`
  }
  return (
    <svg
      className={`ps-ann squiggly${sel}${fla}`}
      onClick={onClick}
      style={{ ...style, top: top + height - 4, height: 6, overflow: 'visible' }}
    >
      <path d={d} fill="none" stroke={ann.color} strokeWidth={1.6} />
    </svg>
  )
}
