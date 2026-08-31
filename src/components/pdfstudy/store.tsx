// 全局状态：React Context + 集中 hook（数据、工具模式、UI 状态、跳转信号）
// 移植自 pdf-study store：去掉独立书库/主题/设置，文档由 path prop 绑定（vault 相对路径）。
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { psApi, uid } from './api'
import type { Annotation, Card, CardPurpose, OutlineNode, TextSelectionInfo, ToolMode } from './types'

export interface PageDim {
  w: number
  h: number
}

export interface JumpTarget {
  page: number
  annId?: string
  cardId?: string
  /** 页内 y（top-left pt），来自大纲书签 */
  y?: number
  /** 触发时间戳，用于重复跳转同一目标 */
  ts: number
}

export interface FlashTarget {
  annIds: string[]
  cardId?: string
  ts: number
}

export interface CardDraft {
  anchor: Card['anchor']
  quote?: string
  initialMarkdown?: string
}

export interface Toast {
  id: string
  text: string
  kind: 'info' | 'error' | 'ok'
}

function useStoreImpl(docPath: string) {
  // ── 数据 ──────────────────────────────────────────────────────────────────
  const [docTitle, setDocTitle] = useState('')
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [cards, setCards] = useState<Card[]>([])
  const [outline, setOutline] = useState<OutlineNode[] | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [pageDims, setPageDims] = useState<PageDim[]>([])
  const [docError, setDocError] = useState('')

  // ── 查看器 ────────────────────────────────────────────────────────────────
  const [scale, setScale] = useState(1.2)
  const [currentPage, setCurrentPage] = useState(1)
  /** 缩放请求（顶栏按钮/快捷键）：由 PdfViewer 消费，以视口中心为锚点 */
  const [zoomReq, setZoomReq] = useState<{ dir: 'in' | 'out'; ts: number } | null>(null)
  const requestZoom = useCallback((dir: 'in' | 'out') => setZoomReq({ dir, ts: Date.now() }), [])

  // ── 工具 ──────────────────────────────────────────────────────────────────
  const [tool, setTool] = useState<ToolMode>('select')
  const [annotColor, setAnnotColor] = useState('#fef08a')
  const [maskColor, setMaskColor] = useState('#1f2430')

  // ── UI ────────────────────────────────────────────────────────────────────
  const [rightOpen, setRightOpen] = useState(true)
  const [rightTab, setRightTab] = useState<'cards' | 'anns' | 'tags'>('cards')
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [selection, setSelection] = useState<TextSelectionInfo | null>(null)
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null)
  const [cardEditor, setCardEditor] = useState<{ card?: Card; draft?: CardDraft } | null>(null)
  const [revealedMasks, setRevealedMasks] = useState<Set<string>>(new Set())
  const [jumpTarget, setJumpTarget] = useState<JumpTarget | null>(null)
  const [cardFocus, setCardFocus] = useState<{ cardId: string; ts: number } | null>(null)
  const [flash, setFlash] = useState<FlashTarget | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = uid()
    setToasts((t) => [...t.slice(-3), { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600)
  }, [])

  // 当前页码 → window 事件（TutorPanel 据此让答疑助手定位当前章节）
  useEffect(() => {
    window.dispatchEvent(new MessageEvent('pdf-page', { data: JSON.stringify({ path: docPath, page: currentPage }) }))
  }, [docPath, currentPage])

  // ── 文档数据：加载 + 防抖保存 ─────────────────────────────────────────────
  const dataRef = useRef<{ annotations: Annotation[]; cards: Card[] }>({ annotations: [], cards: [] })
  dataRef.current = useMemo(() => ({ annotations, cards }), [annotations, cards])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void psApi
        .putDoc(docPath, dataRef.current)
        .catch((e) => toast('保存失败：' + String((e as Error).message || e), 'error'))
    }, 400)
  }, [docPath, toast])

  // 切换文档时加载标注 + 大纲（PDF 本体由 PdfViewer 直接加载）
  useEffect(() => {
    let alive = true
    setDocTitle(docPath.split('/').pop()?.replace(/\.pdf$/i, '') ?? docPath)
    setAnnotations([])
    setCards([])
    setOutline(null)
    setPageDims([])
    setPageCount(0)
    setCurrentPage(1)
    setSelection(null)
    setSelectedAnnId(null)
    setDocError('')
    psApi
      .getDoc(docPath)
      .then((d) => {
        if (!alive) return
        setAnnotations(d.annotations)
        setCards(d.cards)
      })
      .catch((e) => alive && setDocError(String((e as Error).message || e)))
    psApi
      .getOutline(docPath)
      .then((r) => alive && setOutline(r.outline))
      .catch(() => alive && setOutline([]))
    return () => {
      alive = false
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [docPath])

  // ── 标注 CRUD ─────────────────────────────────────────────────────────────
  const addAnnotation = useCallback(
    (ann: Annotation) => {
      setAnnotations((a) => [...a, ann])
      scheduleSave()
    },
    [scheduleSave],
  )
  const updateAnnotation = useCallback(
    (id: string, patch: Partial<Annotation>) => {
      setAnnotations((a) => a.map((x) => (x.id === id ? ({ ...x, ...patch } as Annotation) : x)))
      scheduleSave()
    },
    [scheduleSave],
  )
  const deleteAnnotation = useCallback(
    (id: string) => {
      setAnnotations((a) => a.filter((x) => x.id !== id))
      // 关联卡片的锚点降级为整页
      setCards((cs) =>
        cs.map((c) =>
          c.anchor.kind === 'annotation' && c.anchor.annotationId === id
            ? { ...c, anchor: { kind: 'page', page: c.anchor.page } as Card['anchor'] }
            : c,
        ),
      )
      setSelectedAnnId((s) => (s === id ? null : s))
      scheduleSave()
    },
    [scheduleSave],
  )

  // ── 卡片 CRUD ─────────────────────────────────────────────────────────────
  const addCard = useCallback(
    (card: Card) => {
      setCards((cs) => [...cs, card])
      scheduleSave()
    },
    [scheduleSave],
  )
  const updateCard = useCallback(
    (id: string, patch: Partial<Card>) => {
      setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c)))
      scheduleSave()
    },
    [scheduleSave],
  )
  const deleteCard = useCallback(
    (id: string) => {
      setCards((cs) => cs.filter((c) => c.id !== id))
      scheduleSave()
    },
    [scheduleSave],
  )

  /** 新建卡片（含默认值），返回 id */
  const createCard = useCallback(
    (anchor: Card['anchor'], purpose: CardPurpose, opts?: { quote?: string; markdown?: string; title?: string }) => {
      const card: Card = {
        id: uid(),
        purpose,
        title: opts?.title ?? '',
        markdown: opts?.markdown ?? (opts?.quote ? `> ${opts.quote.replace(/\n+/g, '\n> ')}\n\n` : ''),
        tags: [],
        anchor,
        minimized: false,
        offsetY: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      addCard(card)
      return card
    },
    [addCard],
  )

  // ── 跳转 / 闪光 ───────────────────────────────────────────────────────────
  const jumpTo = useCallback((page: number, opts?: { annId?: string; cardId?: string; y?: number }) => {
    setJumpTarget({ page, annId: opts?.annId, cardId: opts?.cardId, y: opts?.y, ts: Date.now() })
  }, [])
  const focusCard = useCallback((cardId: string) => {
    setCardFocus({ cardId, ts: Date.now() })
  }, [])
  const flashTargets = useCallback((annIds: string[], cardId?: string) => {
    setFlash({ annIds, cardId, ts: Date.now() })
  }, [])

  // ── 遮罩显隐（自查模式，瞬态） ────────────────────────────────────────────
  const toggleMask = useCallback((id: string) => {
    setRevealedMasks((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return {
    docPath,
    docTitle,
    annotations,
    cards,
    outline,
    pageCount,
    setPageCount,
    pageDims,
    setPageDims,
    docError,
    // 查看器
    scale,
    setScale,
    zoomReq,
    requestZoom,
    currentPage,
    setCurrentPage,
    // 工具
    tool,
    setTool,
    annotColor,
    setAnnotColor,
    maskColor,
    setMaskColor,
    // UI
    rightOpen,
    setRightOpen,
    rightTab,
    setRightTab,
    outlineOpen,
    setOutlineOpen,
    selection,
    setSelection,
    selectedAnnId,
    setSelectedAnnId,
    cardEditor,
    setCardEditor,
    revealedMasks,
    toggleMask,
    jumpTarget,
    cardFocus,
    flash,
    toasts,
    toast,
    // 动作
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    addCard,
    updateCard,
    deleteCard,
    createCard,
    jumpTo,
    focusCard,
    flashTargets,
  }
}

export type StudyStore = ReturnType<typeof useStoreImpl>

const StoreCtx = createContext<StudyStore | null>(null)

export function StudyProvider({ docPath, children }: { docPath: string; children: ReactNode }) {
  const store = useStoreImpl(docPath)
  return <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>
}

export function useStore(): StudyStore {
  const s = useContext(StoreCtx)
  if (!s) throw new Error('useStore 必须在 StudyProvider 内使用')
  return s
}

// ── 布局计算：页面纵向偏移（PDF 阅读区与右侧卡片面板共用的镜像映射） ─────────
export const PAGE_GAP = 16 // px
export const VIEW_PAD = 24 // 阅读区上下留白 px
export const BOTTOM_PAD = 110 // 底部悬浮输入栏避让

/** 每页在滚动内容中的起始 Y（px，随 scale） */
export function pageOffsets(dims: PageDim[], scale: number): number[] {
  const out: number[] = []
  let y = VIEW_PAD
  for (const d of dims) {
    out.push(y)
    y += d.h * scale + PAGE_GAP
  }
  return out
}

/** 滚动内容总高 */
export function contentHeight(dims: PageDim[], scale: number): number {
  if (!dims.length) return VIEW_PAD * 2 + BOTTOM_PAD
  return VIEW_PAD * 2 + BOTTOM_PAD + dims.reduce((s, d) => s + d.h * scale + PAGE_GAP, 0) - PAGE_GAP
}

/** 文档 pt 坐标 → 内容 px 坐标 */
export function docYToPx(dims: PageDim[], scale: number, page: number, yInPage: number): number {
  const offs = pageOffsets(dims, scale)
  const d = dims[page - 1]
  if (!d || !offs[page - 1]) return 0
  return offs[page - 1] + yInPage * scale
}
