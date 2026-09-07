// IDE 语言服务器（LSP）插件系统：浏览器编辑器 ↔ 本机语言服务器子进程
//
// 可插拔设计：
// - 内置插件表 BUILTIN_PLUGINS（pyright 随项目安装，其余按本机 PATH 自动探测）
// - 用户扩展/覆盖：编辑 .learn-agent/lsp-plugins.json（无需改代码），格式见 doc/ide-lsp.md
// - GET /api/lsp/plugins 返回插件清单与本机可用性；/api/lsp?lang=xx 建立编辑器通道
//
// 完全本地运行：语言服务器是本机进程，运行期不访问网络。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as vault from './vault.js'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IS_WIN = process.platform === 'win32'

// ── 内置插件表 ──────────────────────────────────────────────────────────────
// id → { name, languages, command, args, bundled?, installHint }
const BUILTIN_PLUGINS = {
  pyright: {
    name: 'Pyright',
    languages: ['python'],
    command: 'pyright-langserver',
    args: ['--stdio'],
    bundled: true,
    installHint: '随项目内置，无需安装',
  },
  clangd: {
    name: 'clangd',
    languages: ['c', 'cpp'],
    command: 'clangd',
    args: [],
    installHint: '安装 LLVM/Clangd 并加入 PATH（winget install LLVM.LLVM）',
  },
  gopls: {
    name: 'gopls',
    languages: ['go'],
    command: 'gopls',
    args: [],
    installHint: 'go install golang.org/x/tools/gopls@latest',
  },
  'rust-analyzer': {
    name: 'rust-analyzer',
    languages: ['rust'],
    command: 'rust-analyzer',
    args: [],
    installHint: 'rustup component add rust-analyzer',
  },
  jdtls: {
    name: 'jdtls',
    languages: ['java'],
    command: 'jdtls',
    args: [],
    installHint: '安装 Eclipse JDT Language Server 并加入 PATH',
  },
  'lua-language-server': {
    name: 'lua-language-server',
    languages: ['lua'],
    command: 'lua-language-server',
    args: [],
    installHint: '安装 sumneko lua-language-server 并加入 PATH',
  },
}

// ── 插件表加载（用户配置覆盖内置） ─────────────────────────────────────────
function userPluginFile() {
  return path.join(PROJECT_ROOT, '.learn-agent', 'lsp-plugins.json')
}

function loadPlugins() {
  const merged = JSON.parse(JSON.stringify(BUILTIN_PLUGINS))
  try {
    const file = userPluginFile()
    if (fs.existsSync(file)) {
      const user = JSON.parse(fs.readFileSync(file, 'utf8'))
      for (const [id, conf] of Object.entries(user)) {
        if (conf === null) {
          delete merged[id] // 置 null 表示停用该插件
        } else {
          merged[id] = { name: id, languages: [], command: '', args: [], ...conf }
        }
      }
    }
  } catch (e) {
    console.error('[lsp] 用户插件配置解析失败（忽略用户文件）:', e.message)
  }
  return merged
}

function resolvePluginFor(lang) {
  const plugins = loadPlugins()
  for (const [id, p] of Object.entries(plugins)) {
    if ((p.languages || []).includes(lang)) {
      let command = p.command
      if (p.bundled) {
        command = path.join(PROJECT_ROOT, 'node_modules', '.bin', IS_WIN ? p.command + '.cmd' : p.command)
      }
      return { id, command, args: p.args || [] }
    }
  }
  return null
}

// ── 可用性探测（扫描 PATH，5 分钟缓存） ────────────────────────────────────
let statusCache = { at: 0, list: null }

function findOnPath(cmd) {
  const dirs = (process.env.PATH || '').split(IS_WIN ? ';' : ':')
  const names = IS_WIN ? [cmd, cmd + '.exe', cmd + '.cmd', cmd + '.bat'] : [cmd]
  for (const dir of dirs) {
    if (!dir) continue
    for (const name of names) {
      try {
        if (fs.existsSync(path.join(dir, name))) return true
      } catch {
        /* ignore */
      }
    }
  }
  return false
}

function pluginStatusList() {
  if (statusCache.list && Date.now() - statusCache.at < 60_000) return statusCache.list
  const plugins = loadPlugins()
  const list = Object.entries(plugins).map(([id, p]) => ({
    id,
    name: p.name,
    languages: p.languages || [],
    available: p.bundled ? true : findOnPath(p.command),
    installHint: p.installHint || '',
  }))
  statusCache = { at: Date.now(), list }
  return list
}

// ── stdio JSON-RPC 分帧 ─────────────────────────────────────────────────────
function createFramer(onMessage) {
  let buf = Buffer.alloc(0)
  return (chunk) => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      const sep = buf.indexOf('\r\n\r\n')
      if (sep < 0) return
      const m = buf.slice(0, sep).toString().match(/Content-Length: (\d+)/i)
      const len = m ? Number(m[1]) : 0
      if (buf.length < sep + 4 + len) return
      const body = buf.slice(sep + 4, sep + 4 + len).toString()
      buf = buf.slice(sep + 4 + len)
      try {
        onMessage(JSON.parse(body))
      } catch {
        /* 非法消息忽略 */
      }
    }
  }
}

export function lspRoutes(app) {
  // 插件清单（供前端状态面板与提供器注册）
  app.get('/api/lsp/plugins', (req, res) => {
    res.json({ plugins: pluginStatusList() })
  })
}

export function handleLspConnection(ws, req) {
  {
    const lang = new URL(req.url, 'http://localhost').searchParams.get('lang') || ''
    const conf = resolvePluginFor(lang)
    if (!conf) {
      ws.close(1008, 'no plugin for language: ' + lang)
      return
    }

    let proc
    try {
      proc = spawn(conf.command, conf.args, {
        cwd: PROJECT_ROOT,
        shell: IS_WIN, // Windows 下 .cmd 入口必须经 shell
        stdio: ['pipe', 'pipe', 'ignore'],
      })
    } catch (e) {
      console.error(`[lsp:${lang}] spawn 失败:`, e.message)
      send({ method: 'lsp/exit', params: { reason: String(e.message || e) } })
      ws.close()
      return
    }
    console.log(`[lsp:${lang}] 进程已启动 pid=${proc.pid} (plugin: ${conf.id})`)
    proc.on('error', (e) => {
      // PATH 上找不到（clangd/gopls 等未安装）：通知前端回落
      send({ method: 'lsp/exit', params: { reason: `${lang} 语言服务器不可用：${e.message}` } })
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    })

    const send = (msg) => {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(JSON.stringify(msg))
        } catch {
          /* ignore */
        }
      }
    }
    const write = (msg) => {
      try {
        const body = JSON.stringify(msg)
        proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
      } catch {
        /* ignore */
      }
    }

    const pending = new Map() // LSP 自增 id → 前端请求 id
    let nextId = 1
    let ready = false
    const queue = []

    const rootUri = pathToFileURL(vault.getVaultRoot()).href
    const rootName = path.basename(vault.getVaultRoot())

    const handleFromLsp = (msg) => {
      if (msg.id !== undefined && msg.method) {
        // 服务器 → 客户端方向的反向请求：统一回空，避免 Pyright 等待卡住
        if (msg.method === 'workspace/configuration') {
          write({ jsonrpc: '2.0', id: msg.id, result: (msg.params?.items || []).map(() => ({})) })
        } else {
          write({ jsonrpc: '2.0', id: msg.id, result: null })
        }
        return
      }
      if (msg.id === 'init') {
        ready = true
        console.log(`[lsp:${lang}] 初始化完成，flush 队列 ${queue.length} 条`)
        write({ jsonrpc: '2.0', method: 'initialized', params: {} })
        for (const m of queue.splice(0)) {
          forwardToLsp(m)
        }
        return
      }
      if (msg.id !== undefined) {
        const clientId = pending.get(msg.id)
        if (clientId !== undefined) {
          pending.delete(msg.id)
          send({ id: clientId, result: msg.result, error: msg.error })
        }
        return
      }
      if (msg.method) {
        // 通知：诊断推给前端；内部进度/日志不上抛
        if (msg.method.startsWith('$/') || msg.method.startsWith('window/')) return
        send(msg)
      }
    }

    const forwardToLsp = (m) => {
      if (m.id !== undefined) {
        const id = 'c' + nextId++
        pending.set(id, m.id)
        write({ jsonrpc: '2.0', id, method: m.method, params: m.params })
      } else {
        write({ jsonrpc: '2.0', method: m.method, params: m.params })
      }
    }

    proc.stdout.on('data', createFramer(handleFromLsp))
    // stderr 为 'ignore'（null），无需消费；如改为 pipe 必须消费以防背压

    // LSP 初始化握手（workspace = vault 根）
    write({
      jsonrpc: '2.0',
      id: 'init',
      method: 'initialize',
      params: {
        processId: process.pid,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: rootName }],
        capabilities: {
          textDocument: {
            synchronization: { didSave: false, willSave: false },
            completion: {
              completionItem: {
                snippetSupport: true,
                documentationFormat: ['markdown'],
                resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] },
              },
            },
            hover: { contentFormat: ['markdown'] },
            signatureHelp: { signatureInformation: { documentationFormat: ['markdown'] } },
            publishDiagnostics: { relatedInformation: true },
          },
          workspace: { workspaceFolders: true, configuration: false },
        },
      },
    })

    ws.on('message', (raw) => {
      let m
      try {
        m = JSON.parse(String(raw))
      } catch {
        return
      }
      if (!m.method) return
      if (!ready) {
        queue.push(m)
        return
      }
      forwardToLsp(m)
    })

    const kill = () => {
      try {
        proc.kill()
      } catch {
        /* ignore */
      }
    }
    proc.on('exit', (code) => {
      console.log(`[lsp:${lang}] 进程退出 code=${code}`)
      send({ method: 'lsp/exit', params: {} })
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    })
    ws.on('close', kill)
  }
}
