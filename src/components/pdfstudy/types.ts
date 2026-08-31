// PDF 学习器数据模型（与 server 端约定一致；坐标均为 top-left 原点的页面 pt，scale=1）

export type AnnotationType =
  | 'highlight'
  | 'underline'
  | 'squiggly'
  | 'strikethrough'
  | 'tag-anchor'
  | 'mask'
  | 'image'

export interface Quad {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface BaseAnn {
  id: string
  page: number
  tags: string[]
  createdAt: string
}

export interface TextAnnotation extends BaseAnn {
  type: 'highlight' | 'underline' | 'squiggly' | 'strikethrough' | 'tag-anchor'
  color: string
  quads: Quad[]
  text: string
}

export interface MaskAnnotation extends BaseAnn {
  type: 'mask'
  color: string
  rect: Rect
}

export interface ImageAnnotation extends BaseAnn {
  type: 'image'
  color: string
  rect: Rect
  src: string
}

export type Rect = { x: number; y: number; w: number; h: number }

export type Annotation = TextAnnotation | MaskAnnotation | ImageAnnotation

export type CardPurpose = 'supplement' | 'explain' | 'question' | 'reflect'

export const PURPOSES: { id: CardPurpose; label: string; color: string; icon: string }[] = [
  { id: 'supplement', label: '补充', color: '#3b82f6', icon: 'post_add' },
  { id: 'explain', label: '解释', color: '#10b981', icon: 'psychology' },
  { id: 'question', label: '提问', color: '#f59e0b', icon: 'help' },
  { id: 'reflect', label: '自主思考', color: '#a855f7', icon: 'self_improvement' },
]

export function purposeOf(id: CardPurpose) {
  return PURPOSES.find((p) => p.id === id) ?? PURPOSES[0]
}

export type CardAnchor = { kind: 'page'; page: number } | { kind: 'annotation'; annotationId: string; page: number }

export interface Card {
  id: string
  purpose: CardPurpose
  title: string
  markdown: string
  tags: string[]
  anchor: CardAnchor
  minimized: boolean
  /** 相对锚点默认位置的纵向偏移（pt），支持自由拖动摆放 */
  offsetY: number
  createdAt: string
  updatedAt: string
}

export interface OutlineNode {
  title: string
  page: number | null
  yInPage: number | null
  children: OutlineNode[]
}

export interface DocData {
  annotations: Annotation[]
  cards: Card[]
}

export interface TextSelectionInfo {
  page: number
  quads: Quad[]
  text: string
  clientX: number
  clientY: number
}

export type ToolMode = 'pointer' | 'select' | 'highlight' | 'underline' | 'squiggly' | 'strikethrough' | 'mask' | 'image'

export const TEXT_ANN_COLORS = ['#fef08a', '#fdba74', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#e9d5ff']
export const MASK_COLORS = ['#1f2430', '#f5f5f4', '#facc15', '#16a34a']

/** 标注默认色（按类型） */
export const DEFAULT_ANN_COLOR: Record<string, string> = {
  highlight: '#fef08a',
  underline: '#ef4444',
  squiggly: '#10b981',
  strikethrough: '#6b7280',
  'tag-anchor': '#8b5cf6',
  mask: '#1f2430',
}
