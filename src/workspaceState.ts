import type { Tab } from './types'

export interface WorkspaceState {
  version: 1
  tabs: Tab[]
  activeKey: string
  splitTab: Tab | null
  splitRatio: number
  sidebarWidth: number
  assistantWidth: number
  sidebarCollapsed: boolean
  assistantOpen: boolean
  noteAssistant: boolean
  viewport: 'wide' | 'compact'
}

export function readLocal<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); return value ? (JSON.parse(value) ?? fallback) as T : fallback } catch { return fallback }
}
export function writeLocal(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true } catch { return false }
}
export const workspaceKey = (vault: string) => 'la-workspace:v1:' + vault.replace(/\\/g, '/').toLowerCase()
export const tabKey = (tab: Tab) => tab.kind === 'graph' || tab.kind === 'refs' ? tab.kind : tab.kind + ':' + tab.path
export const bounded = (value: unknown, min: number, max: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback

function parseTab(value: unknown): Tab | null {
  if (!value || typeof value !== 'object') return null
  const tab = value as Record<string, unknown>
  if (tab.kind === 'graph' || tab.kind === 'refs') return { kind: tab.kind }
  if (typeof tab.path !== 'string' || !tab.path || tab.path.length > 2000 || /^(?:[a-z]+:|[/\\])|(?:^|[/\\])\.\.(?:[/\\]|$)/i.test(tab.path)) return null
  if (tab.kind === 'pdf' && /\.pdf$/i.test(tab.path)) return { kind: 'pdf', path: tab.path }
  if (tab.kind === 'note' && /\.md$/i.test(tab.path)) return { kind: 'note', path: tab.path }
  if (tab.kind === 'teach' && /\.md$/i.test(tab.path) && typeof tab.sessionId === 'string' && /^t-[a-z0-9-]+$/.test(tab.sessionId)) return { kind: 'teach', path: tab.path, sessionId: tab.sessionId }
  return null
}

export function parseWorkspace(value: unknown): WorkspaceState | null {
  if (!value || typeof value !== 'object' || (value as { version?: number }).version !== 1) return null
  const raw = value as Record<string, unknown>
  if (!Array.isArray(raw.tabs)) return null
  const seen = new Set<string>()
  const tabs = raw.tabs.flatMap(value => { const tab = parseTab(value); if (!tab || seen.has(tabKey(tab))) return []; seen.add(tabKey(tab)); return [tab] }).slice(0, 40)
  const split = parseTab(raw.splitTab)
  return { version: 1, tabs, activeKey: typeof raw.activeKey === 'string' ? raw.activeKey : '',
    splitTab: split && !seen.has(tabKey(split)) ? split : null,
    splitRatio: bounded(raw.splitRatio,.25,.75,.55), sidebarWidth: bounded(raw.sidebarWidth,180,440,248), assistantWidth: bounded(raw.assistantWidth,300,640,400),
    sidebarCollapsed: raw.sidebarCollapsed === true, assistantOpen: raw.assistantOpen !== false, noteAssistant: raw.noteAssistant === true,
    viewport: raw.viewport === 'compact' ? 'compact' : 'wide' }
}

export interface PdfPosition { page: number; y: number }
export function parsePdfPosition(value: unknown): PdfPosition | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  return typeof raw.page === 'number' && Number.isInteger(raw.page) && raw.page >= 1 && typeof raw.y === 'number' && Number.isFinite(raw.y)
    ? { page: raw.page, y: Math.max(0,raw.y) } : null
}
/** Wait for the actual target page; a partially loaded long PDF must not consume its resume target. */
export function readyPdfPosition(value: PdfPosition | null, pageCount: number, loadedPages: number): PdfPosition | null {
  if (!value || pageCount < 1) return null
  const page = Math.min(value.page,pageCount)
  return loadedPages >= page ? { page, y: value.y } : null
}
