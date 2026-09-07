// 统一 WebSocket 入口：按路径分发到各子系统（/api/lsp → LSP 桥，/api/run/ws → 编译运行）
// 注意：同一 HTTP server 上挂多个带 path 的 WebSocketServer 会互相 400，必须单实例路由。
import { WebSocketServer } from 'ws'
import { handleLspConnection } from './lsp.js'
import { handleRunConnection } from './run.js'

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url, 'http://localhost').pathname
    if (pathname === '/api/lsp') {
      wss.handleUpgrade(req, socket, head, (ws) => handleLspConnection(ws, req))
    } else if (pathname === '/api/run/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => handleRunConnection(ws))
    } else {
      socket.destroy()
    }
  })
}
