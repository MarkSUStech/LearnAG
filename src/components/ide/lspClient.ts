// 极简 LSP 客户端：JSON-RPC over WebSocket（配套 server/lsp.js）
// 服务端负责 LSP 初始化握手并对未就绪消息排队，因此 socket open 即视为可发送。
export class LspClient {
  private ws: WebSocket | null = null
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private queue: string[] = []
  private nextId = 1
  ready = false
  onDiagnostics: ((params: any) => void) | null = null
  onDown: ((reason?: string) => void) | null = null

  constructor(public readonly lang: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/api/lsp?lang=${encodeURIComponent(this.lang)}`)
      this.ws = ws
      const timeout = setTimeout(() => {
        if (!this.ready) reject(new Error('LSP 连接超时'))
      }, 20000)
      ws.onopen = () => {
        clearTimeout(timeout)
        this.ready = true
        for (const m of this.queue.splice(0)) ws.send(m)
        resolve()
      }
      ws.onmessage = (ev) => {
        let m: any
        try {
          m = JSON.parse(ev.data as string)
        } catch {
          return
        }
        if (m.id !== undefined) {
          const p = this.pending.get(m.id)
          if (p) {
            this.pending.delete(m.id)
            if (m.error) p.reject(new Error(m.error.message || 'LSP 请求失败'))
            else p.resolve(m.result)
          }
          return
        }
        if (m.method === 'textDocument/publishDiagnostics') {
          this.onDiagnostics?.(m.params)
        } else if (m.method === 'lsp/exit') {
          this.markDown((m.params as { reason?: string })?.reason)
        }
      }
      ws.onerror = () => {
        clearTimeout(timeout)
        if (!this.ready) reject(new Error('LSP 连接失败'))
      }
      ws.onclose = () => {
        clearTimeout(timeout)
        this.markDown()
      }
    })
  }

  private markDown(reason?: string) {
    const was = this.ready
    this.ready = false
    const pendings = [...this.pending.values()]
    this.pending.clear()
    for (const p of pendings) p.reject(new Error(reason || 'LSP 已断开'))
    if (was) this.onDown?.(reason)
  }

  request(method: string, params: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('LSP 未连接'))
        return
      }
      const id = this.nextId++
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  notify(method: string, params: unknown) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({ method, params }))
  }

  close() {
    this.ready = false
    this.ws?.close()
    this.ws = null
  }
}
