export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'folder'
  children?: TreeNode[]
}

export interface GraphNode {
  id: string
  title: string
  field: string
  mastery: number
  status: 'mastered' | 'learning' | 'learnable'
  note: string
  updatedAt: string
  /** 微观层（按需）：薄弱子点 */
  weakPoints?: (string | { name: string; mastery?: number })[]
  /** 微观层（按需）：常见错误模式 */
  commonMistakes?: string[]
}

export interface GraphEdge {
  from: string
  to: string
  type: 'depends-on' | 'leads-to' | 'relates-to'
}

export interface GraphData {
  version: number
  updatedAt: string
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export type Tab = { kind: 'note'; path: string } | { kind: 'pdf'; path: string } | { kind: 'graph' } | { kind: 'refs' }

export interface PlanInfo {
  exists: boolean
  goal: string
  standard: string
  currentPath: string
  currentStage: string
  path: string
}

export interface Settings {
  vaultPath: string
  apiBaseURL: string
  model: string
  ragModel: string
  hasApiKey: boolean
  apiKeyMasked: string
}

export interface RagStatus {
  model: string
  modelId: string
  modelLabel: string
  modelSize: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  downloadProgress: number
  chunks: number
  files: number
  queue: number
  vaultFiles: number
}

export type AgentStage = 'idle' | 'thinking' | 'writing' | 'tool' | 'written' | 'done'

export interface AgentStatus {
  running: boolean
  stage: AgentStage
  message: string
}

export interface SSEEvent {
  type: string
  [key: string]: unknown
}

export interface FrontMeta {
  tags: string[]
  mastery?: number
  status?: string
  date?: string
  id?: string
}

export interface ToastItem {
  id: number
  text: string
  error?: boolean
}

export type QuestionType = 'single' | 'multi' | 'judge' | 'text' | 'file'

export interface PendingQuestion {
  id: string
  question: string
  type: QuestionType
  options: string[]
  allowCustom: boolean
  fileHint: string
  fileMultiple: boolean
  code?: string
  contextFiles?: { path: string; name: string; content: string }[]
}

export interface SessionMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export interface UploadedFilePayload {
  path: string
  name: string
  preview?: { content: string; truncated: boolean; totalChars: number }
}

export type AnswerValue = string | string[] | { skipped: true } | { files: UploadedFilePayload[] }
