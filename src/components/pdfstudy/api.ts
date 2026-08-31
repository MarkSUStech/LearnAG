// PDF 学习器 REST 封装（端点全部以 vault 相对路径定位）
import type { Annotation, Card, DocData, OutlineNode } from './types'

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const j = await res.json()
      if (j.error) msg = j.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export const psApi = {
  getDoc: (path: string) => fetch(`/api/pdf-study/doc?path=${encodeURIComponent(path)}`).then((r) => json<DocData>(r)),
  putDoc: (path: string, data: { annotations: Annotation[]; cards: Card[] }) =>
    fetch(`/api/pdf-study/doc?path=${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => json<{ ok: boolean }>(r)),
  getOutline: (path: string) =>
    fetch(`/api/pdf-study/outline?path=${encodeURIComponent(path)}`).then((r) => json<{ outline: OutlineNode[] }>(r)),
  uploadAsset: (path: string, dataB64: string, mime: string) =>
    fetch('/api/pdf-study/asset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, dataB64, mime }),
    }).then((r) => json<{ url: string }>(r)),
}

/** 翻译流式（SSE）：onDelta 逐段回调 */
export function translateStream(text: string, onDelta: (t: string) => void, signal?: AbortSignal): Promise<void> {
  return fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  }).then(async (res) => {
    if (!res.ok || !res.body) {
      let msg = `HTTP ${res.status}`
      try {
        const j = await res.json()
        if (j.error) msg = j.error
      } catch {
        /* ignore */
      }
      throw new Error(msg)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const data = t.slice(5).trim()
        if (data === '[DONE]') continue
        try {
          const j = JSON.parse(data)
          if (j.delta) onDelta(j.delta)
          if (j.error) throw new Error(j.error)
        } catch (e) {
          if (e instanceof SyntaxError) continue
          throw e
        }
      }
    }
  })
}

/** File → base64（不含 data: 前缀） */
export function fileToB64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

export function uid(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
}
