import type { AnswerValue, GraphData, RagStatus, Settings, TreeNode } from './types'

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error || `请求失败 ${res.status}`)
  return json as T
}

export interface UploadPreview {
  content: string
  truncated: boolean
  totalChars: number
}

export const api = {
  getSettings: () => http<Settings>('/api/settings'),
  saveSettings: (patch: Partial<Record<'vaultPath' | 'apiBaseURL' | 'apiKey' | 'model' | 'ragModel', string>>) =>
    http<Settings>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  testConnection: () => http<{ ok: boolean; reply: string }>('/api/settings/test', { method: 'POST' }),
  getTree: () => http<{ tree: TreeNode[]; vaultPath: string }>('/api/tree'),
  getFile: (path: string) =>
    http<{ path: string; content: string }>(`/api/file?path=${encodeURIComponent(path)}`),
  saveFile: (path: string, content: string) =>
    http<{ path: string }>('/api/file', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content }),
    }),
  createEntry: (path: string, kind: 'file' | 'folder') =>
    http<{ path: string }>('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, kind }),
    }),
  deleteEntry: (path: string) => http<{ ok: boolean }>(`/api/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  rename: (from: string, to: string) =>
    http<{ path: string }>('/api/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    }),
  getGraph: () => http<GraphData>('/api/graph'),
  sendAgent: (message: string, mode: string, attachments?: string[]) =>
    http<{ started: boolean }>('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, mode, attachments }),
    }),
  stopAgent: () => http<{ ok: boolean }>('/api/agent/stop', { method: 'POST' }),
  answerQuestion: (id: string, value: AnswerValue) =>
    http<{ ok: boolean }>('/api/agent/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, value }),
    }),
  uploadFile: async (file: File): Promise<{ path: string; name: string; size: number; preview?: UploadPreview }> => {
    const buf = await file.arrayBuffer()
    const res = await fetch(`/api/upload?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buf,
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((json as { error?: string }).error || '上传失败')
    return json as { path: string; name: string; size: number; preview?: UploadPreview }
  },
  listSessions: () => http<{ sessions: SessionMetaApi[]; activeId: string }>('/api/sessions'),
  createSession: () => http<{ session: SessionMetaApi }>('/api/sessions', { method: 'POST' }),
  activateSession: (id: string) => http<{ ok: boolean }>(`/api/sessions/${id}/activate`, { method: 'POST' }),
  deleteSession: (id: string) => http<{ ok: boolean }>(`/api/sessions/${id}`, { method: 'DELETE' }),
  renameSession: (id: string, title: string) =>
    http<{ ok: boolean }>(`/api/sessions/${id}/title`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }),
  tutorSend: (notePath: string, role: string, message: string, page?: number) =>
    http<{ started: boolean }>('/api/tutor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notePath, role, message, page }),
    }),
  tutorStop: () => http<{ ok: boolean }>('/api/tutor/stop', { method: 'POST' }),
  tutorHistory: (path: string) =>
    http<{ messages: { role: 'user' | 'assistant'; content: string }[] }>(
      `/api/tutor/session?path=${encodeURIComponent(path)}`,
    ),
  tutorClear: (path: string) =>
    http<{ ok: boolean }>(`/api/tutor/session?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  ragStatus: () => http<RagStatus>('/api/rag/status'),
  reindexRag: () => http<{ started: boolean }>('/api/rag/reindex', { method: 'POST' }),
}

export type { RagStatus } from './types'

interface SessionMetaApi {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}
