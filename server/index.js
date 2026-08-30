import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSettings, saveSettings, publicSettings } from './settings.js'
import * as vault from './vault.js'
import { readGraph } from './graph.js'
import {
  runAgent,
  stopAgent,
  isRunning,
  testConnection,
  resolvePendingAnswer,
  replayPendingQuestion,
  listSessionsApi,
  getActiveSession,
  createSessionApi,
  activateSessionApi,
  deleteSessionApi,
  renameSessionApi,
} from './agent/runner.js'
import { runTutor, stopTutor, isTutorRunning, loadTutorSession, clearTutorSession } from './agent/tutor.js'
import { renderDiagram } from './render.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3001

// 崩溃防护：本地单用户工具，记录日志并保持存活
process.on('uncaughtException', (err) => {
  const line = `[uncaughtException] ${new Date().toISOString()} ${err.stack || err}\n`
  console.error(line)
  try {
    fs.appendFileSync(path.join(__dirname, '..', '.learn-agent', 'crash.log'), line)
  } catch {
    /* ignore */
  }
})
process.on('unhandledRejection', (err) => {
  const line = `[unhandledRejection] ${new Date().toISOString()} ${err instanceof Error ? err.stack : err}\n`
  console.error(line)
  try {
    fs.appendFileSync(path.join(__dirname, '..', '.learn-agent', 'crash.log'), line)
  } catch {
    /* ignore */
  }
})

const app = express()
app.use(express.json({ limit: '10mb' }))

// ── SSE 事件总线 ────────────────────────────────────────────────────────────

const sseClients = new Set()

function emit(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`
  for (const res of sseClients) {
    try {
      res.write(data)
    } catch {
      sseClients.delete(res)
    }
  }
}

app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.flushHeaders()
  res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`)
  sseClients.add(res)
  replayPendingQuestion((event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    } catch {
      /* ignore */
    }
  })
  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      /* ignore */
    }
  }, 25000)
  req.on('close', () => {
    clearInterval(ping)
    sseClients.delete(res)
  })
})

// ── vault 初始化与切换 ──────────────────────────────────────────────────────

function initVault() {
  const s = loadSettings()
  vault.setVaultRoot(s.vaultPath)
  fs.mkdirSync(s.vaultPath, { recursive: true })
}

initVault()
vault.watchVault((evt) => {
  emit({ type: 'file-changed', ...evt })
  if (evt.path === '知识图谱.json' && evt.kind !== 'unlink') {
    emit({ type: 'graph-changed' })
  }
  // 仅目录结构变化时刷新文件树
  if (['add', 'unlink', 'add-dir', 'unlink-dir'].includes(evt.kind)) {
    emit({ type: 'tree-changed' })
  }
})

// ── 设置 ────────────────────────────────────────────────────────────────────

app.get('/api/settings', (req, res) => {
  res.json(publicSettings())
})

app.put('/api/settings', (req, res) => {
  try {
    const patch = { ...req.body }
    // 未填写新 key 时保留旧 key（前端回传的是打码值）
    if (typeof patch.apiKey === 'string' && patch.apiKey.includes('***')) {
      delete patch.apiKey
    }
    const prevVault = loadSettings().vaultPath
    const next = saveSettings(patch)
    if (path.resolve(next.vaultPath) !== path.resolve(prevVault)) {
      initVault()
      emit({ type: 'vault-changed', vaultPath: next.vaultPath })
    }
    res.json(publicSettings())
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.post('/api/settings/test', async (req, res) => {
  try {
    const r = await testConnection()
    res.json(r)
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

// ── 文件 API ────────────────────────────────────────────────────────────────

app.get('/api/tree', (req, res) => {
  try {
    res.json({ tree: vault.getTree(), vaultPath: vault.getVaultRoot() })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

app.get('/api/file', (req, res) => {
  try {
    const content = vault.readFile(req.query.path)
    res.json({ path: req.query.path, content })
  } catch (e) {
    res.status(404).json({ error: String(e.message || e) })
  }
})

app.put('/api/file', (req, res) => {
  try {
    const { path: p, content } = req.body
    if (typeof p !== 'string' || typeof content !== 'string') {
      return res.status(400).json({ error: '需要 path 与 content' })
    }
    res.json(vault.writeFile(p, content))
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.post('/api/file', (req, res) => {
  try {
    const { path: p, kind } = req.body
    res.json(vault.createEntry(p, kind === 'folder' ? 'folder' : 'file'))
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.delete('/api/file', (req, res) => {
  try {
    res.json(vault.deleteEntry(req.query.path))
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.post('/api/rename', (req, res) => {
  try {
    const { from, to } = req.body
    res.json(vault.renameEntry(from, to))
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

// ── 知识图谱 ────────────────────────────────────────────────────────────────

app.get('/api/graph', (req, res) => {
  try {
    res.json(readGraph())
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// ── Agent ───────────────────────────────────────────────────────────────────

app.post('/api/agent', async (req, res) => {
  const { message, mode } = req.body
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: '消息不能为空' })
  }
  if (isRunning()) return res.status(409).json({ error: 'agent 正在工作中，请稍候' })
  res.json({ started: true })
  runAgent({
    emit,
    userMessage: message.trim(),
    mode: typeof mode === 'string' ? mode : '教学',
  }).catch((e) => {
    if (e.name === 'AbortError') {
      emit({ type: 'agent-done', stopped: true })
    } else {
      emit({ type: 'agent-done', error: String(e.message || e) })
    }
  })
})

app.post('/api/agent/stop', (req, res) => {
  stopAgent()
  res.json({ ok: true })
})

app.post('/api/agent/answer', (req, res) => {
  const { id, value } = req.body ?? {}
  if (!id) return res.status(400).json({ error: '缺少问题 id' })
  const ok = resolvePendingAnswer(id, value)
  if (!ok) return res.status(404).json({ error: '问题不存在或已回答' })
  res.json({ ok: true })
})

// ── 会话 ────────────────────────────────────────────────────────────────────

app.get('/api/sessions', (req, res) => {
  try {
    res.json({ sessions: listSessionsApi(), activeId: getActiveSession().id })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

app.post('/api/sessions', (req, res) => {
  try {
    res.json({ session: createSessionApi() })
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.post('/api/sessions/:id/activate', (req, res) => {
  try {
    res.json(activateSessionApi(req.params.id))
  } catch (e) {
    res.status(409).json({ error: String(e.message || e) })
  }
})

app.put('/api/sessions/:id/title', (req, res) => {
  try {
    res.json(renameSession(req.params.id, req.body?.title))
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.delete('/api/sessions/:id', (req, res) => {
  try {
    res.json(deleteSessionApi(req.params.id))
  } catch (e) {
    res.status(409).json({ error: String(e.message || e) })
  }
})

// ── 文件上传（供 agent 向用户索要文件） ─────────────────────────────────────

const TEXT_EXTS = new Set([
  'md', 'txt', 'json', 'csv', 'log', 'yml', 'yaml', 'toml', 'ini',
  'py', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'java', 'c', 'h', 'cpp', 'hpp', 'cc',
  'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'scala', 'sh', 'bat', 'ps1',
  'html', 'htm', 'css', 'scss', 'less', 'vue', 'sql', 'r', 'm', 'pl', 'lua', 'dart',
])

app.post('/api/upload', express.raw({ type: '*/*', limit: '20mb' }), (req, res) => {
  try {
    const rawName = String(req.query.filename || 'file.bin')
    const safeName = rawName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120)
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? '')
    const stamp = Date.now().toString(36)
    const rel = `附件/${stamp}-${safeName}`
    vault.writeFile(rel, buf)
    const ext = safeName.split('.').pop()?.toLowerCase() ?? ''
    let preview
    if (TEXT_EXTS.has(ext)) {
      const content = buf.toString('utf8')
      preview = {
        content: content.slice(0, 12000),
        truncated: content.length > 12000,
        totalChars: content.length,
      }
    }
    res.json({ path: rel, name: safeName, size: buf.length, preview })
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.get('/api/agent/status', (req, res) => {
  res.json({ running: isRunning() })
})

// 图表渲染服务：D2 / gnuplot → SVG（WASM，服务端渲染，前端免装）
app.post('/api/render', async (req, res) => {
  const { lang, code } = req.body ?? {}
  console.log('[render] 收到请求:', lang, '| code 长度:', (code || '').length)
  if (typeof lang !== 'string' || typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({ error: '需要 lang 与 code' })
  }
  try {
    const t0 = Date.now()
    const svg = await renderDiagram(lang.toLowerCase(), code)
    console.log('[render] 完成:', lang, Date.now() - t0, 'ms')
    res.json({ svg })
  } catch (e) {
    console.error('[render] 失败:', lang, String(e.message || e).slice(0, 120))
    res.status(400).json({ error: String(e.message || e).slice(0, 500) })
  }
})

// ── 笔记答疑助手（独立于主 agent，会话绑定笔记） ────────────────────────────

app.post('/api/tutor', async (req, res) => {
  const { notePath, role, message } = req.body ?? {}
  if (typeof notePath !== 'string' || !notePath.endsWith('.md')) {
    return res.status(400).json({ error: '需要 notePath（.md）' })
  }
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: '消息不能为空' })
  }
  if (isTutorRunning()) return res.status(409).json({ error: '答疑助手正在回复中' })
  try {
    res.json({ started: true })
    await runTutor({ emit, notePath, role: typeof role === 'string' ? role : 'quick', message: message.trim() })
  } catch (e) {
    if (e.name === 'AbortError') {
      emit({ type: 'tutor-done', path: notePath, stopped: true })
    } else {
      emit({ type: 'tutor-done', path: notePath, error: String(e.message || e) })
    }
  }
})

app.post('/api/tutor/stop', (req, res) => {
  stopTutor()
  res.json({ ok: true })
})

app.get('/api/tutor/session', (req, res) => {
  try {
    res.json({ messages: loadTutorSession(String(req.query.path || '')) })
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.delete('/api/tutor/session', (req, res) => {
  try {
    res.json(clearTutorSession(String(req.query.path || '')))
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

// 原始文件输出（资料预览器：PDF/图片/文本等）
app.get('/api/raw', (req, res) => {
  try {
    const abs = vault.resolveInVault(String(req.query.path || ''))
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return res.status(404).json({ error: '文件不存在' })
    }
    res.setHeader('Content-Type', mimeOf(abs))
    fs.createReadStream(abs).pipe(res)
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

function mimeOf(p) {
  const ext = path.extname(p).toLowerCase()
  const map = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
  }
  return map[ext] || 'application/octet-stream'
}

// 目标与计划状态板（计划芯片数据源）
app.get('/api/plan', (req, res) => {
  try {
    let raw = ''
    try {
      raw = vault.readFile('Agent/目标与计划.md')
    } catch {
      return res.json({ exists: false })
    }
    const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    const fields = {}
    if (fm) {
      for (const line of fm[1].split(/\r?\n/)) {
        const kv = line.match(/^(\w+)\s*:\s*(.+)$/)
        if (kv) fields[kv[1]] = kv[2].trim()
      }
    }
    res.json({
      exists: true,
      goal: fields.goal || '',
      standard: fields.standard || '',
      currentPath: fields.current_path || '',
      currentStage: fields.current_stage || '',
      path: 'Agent/目标与计划.md',
    })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// ── 生产模式静态托管 ────────────────────────────────────────────────────────

const distDir = path.join(__dirname, '..', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.listen(PORT, '127.0.0.1', () => {
  const s = loadSettings()
  console.log(`[learn-agent] 服务已启动 http://127.0.0.1:${PORT}`)
  console.log(`[learn-agent] vault: ${s.vaultPath}`)
  console.log(`[learn-agent] 模型: ${s.model} @ ${s.apiBaseURL}`)
})
