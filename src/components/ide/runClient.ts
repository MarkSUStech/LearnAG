// 编译/运行客户端：WebSocket 流式通道（配套 server/run.js）
export interface ToolchainInfo {
  id: string
  name: string
  available: boolean
  version: string
  command: string
  winget: string
}

type Handlers = {
  onOut?: (stream: 'out' | 'err', text: string) => void
  onStarted?: (desc: string) => void
  onExit?: (code: number) => void
  onError?: (message: string) => void
  onToolchains?: (toolchains: ToolchainInfo[]) => void
  onInstalled?: (id: string, code: number) => void
  onDown?: () => void
}

class RunClient {
  private ws: WebSocket | null = null
  private connecting: Promise<void> | null = null
  handlers: Handlers = {}

  private ensure(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve()
    if (this.connecting) return this.connecting
    this.connecting = new Promise<void>((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/api/run/ws`)
      this.ws = ws
      const timeout = setTimeout(() => reject(new Error('运行服务连接超时')), 15000)
      ws.onopen = () => {
        clearTimeout(timeout)
        this.connecting = null
        resolve()
      }
      ws.onmessage = (ev) => {
        let m: any
        try {
          m = JSON.parse(ev.data as string)
        } catch {
          return
        }
        const h = this.handlers
        if (m.type === 'out') h.onOut?.(m.stream, m.text)
        else if (m.type === 'started') h.onStarted?.(m.desc)
        else if (m.type === 'exit') h.onExit?.(m.code)
        else if (m.type === 'error') h.onError?.(m.message)
        else if (m.type === 'toolchains') h.onToolchains?.(m.toolchains)
        else if (m.type === 'installed') h.onInstalled?.(m.id, m.code)
      }
      ws.onerror = () => {
        clearTimeout(timeout)
        reject(new Error('运行服务连接失败'))
      }
      ws.onclose = () => {
        this.ws = null
        this.handlers.onDown?.()
      }
    })
    return this.connecting
  }

  private send(msg: unknown) {
    this.ws?.send(JSON.stringify(msg))
  }

  async fetchToolchains(): Promise<ToolchainInfo[]> {
    const r = await fetch(`/api/run/toolchains?_=${Date.now()}`)
    const j = await r.json()
    return j.toolchains as ToolchainInfo[]
  }

  async run(path: string, lang: string) {
    await this.ensure()
    this.send({ type: 'run', path, lang })
  }

  async kill() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.send({ type: 'kill' })
  }

  async install(id: string) {
    await this.ensure()
    this.send({ type: 'install', id })
  }
}

export const runClient = new RunClient()
export type { Handlers }
