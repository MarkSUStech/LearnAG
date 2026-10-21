import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { exec } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadSettings, saveSettings, publicSettings } from './settings.js'
import * as vault from './vault.js'
import { readGraph } from './graph.js'
import {
  runAgent,
  runZcodeAgent,
  stopAgent,
  isRunning,
  activeRunSignal,
  suspendForQuestion,
  testConnection,
  resolvePendingAnswer,
  replayPendingQuestion,
  listSessionsApi,
  sessionConversation,
  getActiveSession,
  createSessionApi,
  activateSessionApi,
  deleteSessionApi,
  renameSessionApi,
} from './agent/runner.js'
import { runTutor, stopTutor, isTutorRunning, loadTutorSession, clearTutorSession } from './agent/tutor.js'
import {
  runTeacher,
  stopTeacher,
  isTeacherRunning,
  listTeacherSessionsApi,
  createTeacherSessionApi,
  activateTeacherSessionApi,
  deleteTeacherSessionApi,
  renameTeacherSessionApi,
  loadTeacherHistory,
  clearTeacherHistory,
  ensureAllChatFiles,
  archiveTeacherSession,
  onChatFileRenamed,
} from './agent/teacher.js'
import { zcodeAvailable, zcodeCliPath, zcodeVersion, ensureZcodeMcp } from './agent/zcode.js'
import { searchImages, downloadImageToVault } from './agent/imgsearch.js'
import { runZcodeSubAgent } from './agent/runner.js'
import { subAgentLabel } from './agent/subagent.js'
import { extractPdfImages } from './agent/pdfimages.js'
import { imagePaths, validateImageAttachments } from './agent/vision.js'
import { findImages } from './agent/imageLibrary.js'
import { inspectImage } from './agent/imageAssets.js'
import { imageSourceStatus } from './agent/imageSources.js'
import { syncNoteToGraph } from './agent/tools.js'
import { generateOutline } from './pdfoutline.js'
import { clearGeneratedOutline } from './pdfstudy.js'
import { renderDiagram } from './render.js'
import { streamChat } from './agent/runner.js'
import { reportMermaidFailure } from './agent/mermaidfix.js'
import * as pdfstudy from './pdfstudy.js'
import { keyFor, getOutlineTree } from './pdfdoc.js'
import * as rag from './rag.js'
import { lspRoutes, handleLspConnection } from './lsp.js'
import { listGoals } from './goals.js'
import { runRoutes, handleRunConnection } from './run.js'
import { setupWebSocket } from './ws.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3001

// 崩溃防护：本地单用户工具，记录日志并保持存活
// stdout/stderr 管道断开（启动它的终端被关闭）时 EPIPE 不能变成致命错误——
// 曾因「崩溃处理器里 console.error 抛 EPIPE → 又触发崩溃处理器」的同步循环写出 55GB 日志
process.stdout?.on?.('error', () => {})
process.stderr?.on?.('error', () => {})

// 控制台代码页切 UTF-8：cmd 默认 936(GBK) 时，ZCode CLI 子进程内部的 ANSI 编码环节
// 会把中文任务提示词解成乱码；顺带让本进程的中文日志在控制台正常显示
if (process.platform === 'win32') {
  try {
    exec('chcp 65001 >nul 2>&1', () => {})
  } catch {
    /* 无控制台（后台服务）时静默跳过 */
  }
}

const CRASH_LOG = path.join(__dirname, '..', '.learn-agent', 'crash.log')
let lastCrashLine = ''
let lastCrashAt = 0

function appendCrashLog(line) {
  try {
    const now = Date.now()
    if (line === lastCrashLine && now - lastCrashAt < 1000) return // 同一错误限速
    lastCrashLine = line
    lastCrashAt = now
    // 大小上限 10MB：超过则只保留最后 1MB
    try {
      if (fs.existsSync(CRASH_LOG) && fs.statSync(CRASH_LOG).size > 10 * 1024 * 1024) {
        const tail = fs.readFileSync(CRASH_LOG).slice(-1024 * 1024)
        fs.writeFileSync(CRASH_LOG, tail)
      }
    } catch {
      /* ignore */
    }
    fs.appendFileSync(CRASH_LOG, line)
  } catch {
    /* 日志写入失败绝不二次抛出 */
  }
}

process.on('uncaughtException', (err) => {
  const line = `[uncaughtException] ${new Date().toISOString()} ${err?.stack || err}\n`
  try {
    console.error(line)
  } catch {
    /* stdout 可能已断开 */
  }
  appendCrashLog(line)
})
process.on('unhandledRejection', (err) => {
  const line = `[unhandledRejection] ${new Date().toISOString()} ${err instanceof Error ? err.stack : err}\n`
  try {
    console.error(line)
  } catch {
    /* stdout 可能已断开 */
  }
  appendCrashLog(line)
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
  // 知识图谱目录的笔记被外部写入（如 ZCode 引擎直接写文件）→ 自动同步进图谱
  if (evt.kind !== 'unlink' && /^知识图谱\/.+\.md$/i.test(String(evt.path || ''))) {
    try {
      syncNoteToGraph(evt.path, vault.readFile(evt.path))
    } catch {
      /* frontmatter 不规范等情况静默跳过 */
    }
  }
  // RAG 索引联动：md/pdf 新增或变化入队，删除即清除
  const p = String(evt.path || '')
  if (/\.md$/i.test(p)) {
    if (evt.kind === 'unlink') rag.removeFile(p)
    else if (evt.kind === 'add' || evt.kind === 'change') rag.enqueue(p)
  } else if (/\.pdf$/i.test(p)) {
    if (evt.kind === 'unlink') rag.removeFile(p)
    else if (evt.kind === 'add' || evt.kind === 'change') rag.enqueue(p)
  }
  // 仅目录结构变化时刷新文件树
  if (['add', 'unlink', 'add-dir', 'unlink-dir'].includes(evt.kind)) {
    emit({ type: 'tree-changed' })
  }
})
rag.initRag()
// 教学对话文件迁移：给还没有 vault 文件的旧会话补建 教学对话/<标题>.md
try {
  ensureAllChatFiles()
} catch (e) {
  console.error('[teacher] 对话文件迁移失败:', e?.message || e)
}

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
    const prevRagModel = loadSettings().ragModel
    const next = saveSettings(patch)
    if (next.engine === 'zcode') ensureZcodeMcp() // 提前挂载桥接工具配置
    if (path.resolve(next.vaultPath) !== path.resolve(prevVault)) {
      initVault()
      emit({ type: 'vault-changed', vaultPath: next.vaultPath })
      rag.initRag()
    }
    if (next.ragModel && next.ragModel !== prevRagModel) {
      void rag.onModelChange().catch((e) => console.error('[rag] 换模型重索引失败:', e.message))
    }
    res.json(publicSettings())
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.post('/api/settings/test', async (req, res) => {
  try {
    // ZCode 引擎：测的是本机 CLI 可用性（不发起模型调用）
    if (loadSettings().engine === 'zcode') {
      if (!zcodeAvailable()) throw new Error('未找到 ZCode CLI（' + zcodeCliPath() + '）')
      const v = await zcodeVersion()
      return res.json({ ok: true, reply: `ZCode 引擎就绪（CLI v${v || '?'}）` })
    }
    const r = await testConnection()
    res.json(r)
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

// ZCode 引擎状态（设置页探测）
app.get('/api/zcode/status', async (req, res) => {
  try {
    const found = zcodeAvailable()
    const version = found ? await zcodeVersion() : ''
    res.json({ found, version, path: zcodeCliPath() })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// ── 文件 API ────────────────────────────────────────────────────────────────

app.get('/api/tree', (req, res) => {
  try {
    // ?all=1：全部文件类型（IDE 资源管理器）；默认仅 md（学习模式文件树）
    const all = req.query.all === '1' || req.query.all === 'true'
    res.json({ tree: vault.getTree({ all }), vaultPath: vault.getVaultRoot() })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// ── IDE 模式 ────────────────────────────────────────────────────────────────

app.get('/api/ide/search', (req, res) => {
  try {
    res.json(vault.searchText(String(req.query.q ?? '')))
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
  const p = String(req.query.path || '')
  // 教学对话文件被删除（任意目录，frontmatter 识别）：同步归档其会话存储（避免重启迁移时复活文件）
  if (/\.md$/i.test(p)) {
    try {
      const raw = vault.readFile(p)
      const sid = raw.match(/^session:\s*(t-[a-z0-9-]+)\s*$/m)?.[1]
      if (sid && /^type:\s*teaching-chat\s*$/m.test(raw)) archiveTeacherSession(sid)
    } catch {
      /* 文件不存在或非对话文件，忽略 */
    }
  }
  try {
    res.json(vault.deleteEntry(p))
    if (/\.pdf$/i.test(p)) {
      pdfstudy.removeDoc(p)
      rag.removeFile(p)
    } else if (/\.md$/i.test(p)) {
      rag.removeFile(p)
    }
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.post('/api/rename', (req, res) => {
  try {
    const { from, to } = req.body
    res.json(vault.renameEntry(from, to))
    // PDF 改名：迁移标注 sidecar/资产，并重建 RAG 索引键
    if (/\.pdf$/i.test(String(from)) && /\.pdf$/i.test(String(to))) {
      pdfstudy.migrateDoc(from, to)
      rag.removeFile(from)
      rag.enqueue(to)
    } else if (/\.md$/i.test(String(from))) {
      rag.removeFile(from)
      rag.enqueue(to)
    }
    // 教学对话文件改名（任意目录，靠 frontmatter 识别）：同步会话标题与文件内标题/frontmatter
    if (/\.md$/i.test(String(to))) {
      try {
        const raw = vault.readFile(String(to))
        if (/^type:\s*teaching-chat\s*$/m.test(raw) && /^session:\s*t-[a-z0-9-]+\s*$/m.test(raw)) {
          onChatFileRenamed(String(to))
        }
      } catch {
        /* 非对话文件忽略 */
      }
    }
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
  const { message, mode, attachments, goalId } = req.body ?? {}
  if (typeof message !== 'string' || (!message.trim() && !imagePaths(Array.isArray(attachments) ? attachments : []).length)) {
    return res.status(400).json({ error: '消息不能为空' })
  }
  if (isRunning()) return res.status(409).json({ error: 'agent 正在工作中，请稍候' })
  // 附带资料归一化：string 或 {path, primary, scope:{chapter,from,to}}
  const normScope = (sc) => {
    if (!sc || typeof sc !== 'object') return undefined
    const out = {}
    if (typeof sc.chapter === 'string' && sc.chapter.trim()) out.chapter = sc.chapter.trim()
    for (const k of ['from', 'to']) {
      const n = parseInt(sc[k], 10)
      if (Number.isFinite(n) && n > 0) out[k] = n
    }
    return Object.keys(out).length ? out : undefined
  }
  const normAtt = (a) => {
    if (typeof a === 'string' && a.trim()) return { path: a.trim().replace(/\\/g, '/'), primary: true }
    if (a && typeof a === 'object' && typeof a.path === 'string' && a.path.trim()) {
      return { path: a.path.trim().replace(/\\/g, '/'), primary: Boolean(a.primary), scope: normScope(a.scope) }
    }
    return null
  }
  const normalizedAttachments = Array.isArray(attachments) ? attachments.map(normAtt).filter(Boolean) : []
  if (normalizedAttachments.length > 20) return res.status(400).json({ error: '每次最多附带20个文件（含图片）' })
  try { validateImageAttachments(normalizedAttachments) } catch (e) { return res.status(400).json({ error: String(e.message || e) }) }
  res.json({ started: true })
  // 引擎选择：设置里选了 ZCode 且本机 CLI 可用 → 整个任务交给 ZCode 无头执行；
  // CLI 缺失则回落 API 引擎并提示
  const useZcode = loadSettings().engine === 'zcode'
  if (useZcode && !zcodeAvailable()) {
    emit({ type: 'agent-status', stage: 'thinking', message: '未找到 ZCode CLI，本次回落 API 引擎' })
  }
  const run = useZcode && zcodeAvailable() ? runZcodeAgent : runAgent
  run({
    emit,
    userMessage: message.trim() || '请看我发送的图片。',
    goalId: typeof goalId === 'string' ? goalId : '',
    mode: typeof mode === 'string' ? mode : '教学',
    attachments: normalizedAttachments,
  }).catch((e) => {
    if (e.name === 'AbortError') {
      emit({ type: 'agent-done', stopped: true })
    } else {
      console.error('[agent] 运行失败:', e?.stack || e)
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

// ── ZCode 引擎桥接回调（本机 MCP 桥接进程 → 主服务，仅 localhost） ───────────

// ask_user：发出提问卡片并挂起等待作答（与 API 模式同一套卡片/停止/自定义回答机制）
app.post('/internal/zcode/ask', async (req, res) => {
  if (!isRunning()) return res.status(409).json({ error: '当前没有进行中的任务' })
  try {
    const answer = await suspendForQuestion({ emit, args: req.body ?? {}, signal: activeRunSignal() })
    res.json(answer ?? { value: '' })
  } catch (e) {
    console.error('[zcode-mcp] ask 挂起失败:', e?.stack || e)
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// search_knowledge：本地 RAG 语义检索
app.post('/internal/zcode/search', async (req, res) => {
  try {
    const q = String(req.body?.query ?? '').trim()
    if (!q) return res.status(400).json({ error: 'query 不能为空' })
    console.log('[zcode-mcp] search_knowledge:', q.slice(0, 80))
    res.json(await rag.search(q, Math.min(12, Number(req.body?.max_results) || 6)))
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// search_images：联网搜图 + SigLIP 语义重排
app.get('/api/image-sources', (_req, res) => res.json({ sources: imageSourceStatus() }))
app.post('/internal/zcode/img-search', async (req, res) => {
  try {
    const q = String(req.body?.query ?? '').trim()
    if (!q) return res.status(400).json({ error: 'query 不能为空' })
    console.log('[zcode-mcp] search_images:', q.slice(0, 80))
    res.json(await findImages({ ...req.body, query: q }))
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// download_image：下载图片进 vault
app.post('/internal/zcode/img-download', async (req, res) => {
  try {
    console.log('[zcode-mcp] download_image:', String(req.body?.url || '').slice(0, 80))
    res.json(await downloadImageToVault(req.body ?? {}))
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

app.post('/internal/zcode/img-read', async (req, res) => {
  try {
    const result = await inspectImage(req.body ?? {})
    res.json({ ...result, base64: fs.readFileSync(vault.resolveInVault(result.path)).toString('base64') })
  } catch (error) { res.status(500).json({ error: String(error?.message || error) }) }
})
// extract_pdf_images：提取 PDF 内嵌图片与指定页面
// delegate：把专项任务委派给按角色聚焦的 ZCode 子进程（与主任务同一 signal，停止时一并终止）
app.post('/internal/zcode/delegate', async (req, res) => {
  if (!isRunning()) return res.status(409).json({ error: '当前没有进行中的任务' })
  const role = String(req.body?.role ?? '')
  const task = String(req.body?.task ?? '').trim()
  if (!task) return res.status(400).json({ error: 'task 不能为空' })
  console.log('[zcode-mcp] delegate:', role, '|', task.slice(0, 80))
  try {
    const result = await runZcodeSubAgent({ emit, role, task, context: String(req.body?.context ?? ''), signal: activeRunSignal() })
    res.json({ result })
  } catch (e) {
    console.error('[zcode-mcp] delegate 失败:', e?.message || e)
    res.status(500).json({ error: String(e?.message || e) })
  }
})

app.post('/internal/zcode/pdf-images', async (req, res) => {
  try {
    console.log('[zcode-mcp] extract_pdf_images:', String(req.body?.path || '').slice(0, 80))
    res.json(await extractPdfImages({ path: String(req.body?.path ?? ''), min_size: req.body?.min_size, force: Boolean(req.body?.force), pages: req.body?.pages, mode: req.body?.mode }))
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// ── 目标库（多目标，用户每轮可选） ────────────────────────────────────────────

app.get('/api/goals', (req, res) => {
  try {
    res.json({ goals: listGoals() })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// ── 会话 ────────────────────────────────────────────────────────────────────

app.get('/api/sessions', (req, res) => {
  try {
    res.json({ sessions: listSessionsApi(), activeId: getActiveSession().id })
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

app.get('/api/sessions/:id/messages', (req, res) => {
  try {
    const messages = sessionConversation(req.params.id)
    if (!messages) return res.status(404).json({ error: '会话不存在' })
    res.json({ messages })
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
    const safeName = rawName.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120)
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
  const { notePath, role, message, page } = req.body ?? {}
  if (typeof notePath !== 'string' || !(notePath.endsWith('.md') || /\.pdf$/i.test(notePath))) {
    return res.status(400).json({ error: '需要 notePath（.md 或 .pdf）' })
  }
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: '消息不能为空' })
  }
  if (isTutorRunning()) return res.status(409).json({ error: '答疑助手正在回复中' })
  try {
    res.json({ started: true })
    await runTutor({
      emit,
      notePath,
      role: typeof role === 'string' ? role : 'quick',
      message: message.trim(),
      page: Number(page) || 0,
    })
  } catch (e) {
    if (e.name === 'AbortError') {
      emit({ type: 'tutor-done', path: notePath, stopped: true })
    } else {
      console.error('[tutor] 运行失败:', e?.stack || e)
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

// ── 教学模式（对话式引导学习 agent，独立会话存储） ──────────────────────────

app.post('/api/teacher', async (req, res) => {
  const { message, sessionId } = req.body ?? {}
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: '消息不能为空' })
  }
  if (isTeacherRunning()) return res.status(409).json({ error: '教学助手正在回复中' })
  // 附带文件（vault 相对路径，前端先经 /api/upload 上传）：图片走 vision，其余以路径告知
  const attachments = Array.isArray(req.body?.attachments)
    ? req.body.attachments
        .filter((a) => typeof a === 'string' && a.trim())
        .map((a) => a.trim().replace(/\\/g, '/'))
        .slice(0, 6)
    : []
  try {
    res.json({ started: true })
    await runTeacher({ emit, message: message.trim(), sessionId: typeof sessionId === 'string' ? sessionId : '', attachments })
  } catch (e) {
    if (e?.name === 'AbortError') {
      emit({ type: 'teacher-done', stopped: true })
    } else {
      console.error('[teacher] 运行失败:', e?.stack || e)
      emit({ type: 'teacher-done', error: String(e.message || e) })
    }
  }
})

app.post('/api/teacher/stop', (req, res) => {
  stopTeacher()
  res.json({ ok: true })
})

app.get('/api/teacher/sessions', (req, res) => {
  try {
    res.json(listTeacherSessionsApi())
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

app.post('/api/teacher/sessions', (req, res) => {
  try {
    res.json(createTeacherSessionApi(String(req.body?.dir || ''))) // { session, path：vault 内对话文件（任意目录） }
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.post('/api/teacher/sessions/:id/activate', (req, res) => {
  try {
    res.json(activateTeacherSessionApi(req.params.id))
  } catch (e) {
    res.status(409).json({ error: String(e.message || e) })
  }
})

app.put('/api/teacher/sessions/:id/title', (req, res) => {
  try {
    res.json(renameTeacherSessionApi(req.params.id, req.body?.title))
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.delete('/api/teacher/sessions/:id', (req, res) => {
  try {
    res.json(deleteTeacherSessionApi(req.params.id))
  } catch (e) {
    res.status(409).json({ error: String(e.message || e) })
  }
})

app.get('/api/teacher/session', (req, res) => {
  try {
    res.json({ id: String(req.query.id || ''), messages: loadTeacherHistory(String(req.query.id || '')) })
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.delete('/api/teacher/session', (req, res) => {
  try {
    res.json(clearTeacherHistory(String(req.query.id || '')))
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

// 教学模式运行状态（页面刷新恢复按钮态用）
app.get('/api/teacher/status', (req, res) => {
  res.json({ running: isTeacherRunning() })
})

// 原始文件输出（资料预览器：PDF/图片/文本等）
app.get('/api/raw', (req, res) => {
  try {
    const abs = vault.resolveInVault(String(req.query.path || ''))
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return res.status(404).json({ error: '文件不存在' })
    }
    // sendFile 支持 Range/206 分段请求：pdf.js 对大 PDF 增量拉取，无需整本下载完才渲染。
    // no-store + 关闭 ETag/Last-Modified：本地文件随时会被 agent 改写，浏览器缓存没有价值，
    // 且一旦缓存体损坏（Windows 下 ERR_CACHE_READ_FAILURE 常见），no-cache 的 304 重校验
    // 仍会复用坏缓存体导致 pdf.js 稳定 network error——干脆永不缓存，每次直读本地文件
    res.sendFile(abs, {
      headers: { 'Content-Type': mimeOf(abs), 'Cache-Control': 'no-store' },
      acceptRanges: true,
      etag: false,
      lastModified: false,
    })
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

// ── PDF 学习器（标注/卡片/大纲/贴图资产） ───────────────────────────────────

app.get('/api/pdf-study/doc', (req, res) => {
  try {
    const p = String(req.query.path || '')
    vault.resolveInVault(p) // 路径校验
    res.json(pdfstudy.loadDoc(p))
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.put('/api/pdf-study/doc', (req, res) => {
  try {
    const p = String(req.query.path || '')
    vault.resolveInVault(p)
    const { annotations, cards } = req.body ?? {}
    if (!Array.isArray(annotations) || !Array.isArray(cards)) {
      return res.status(400).json({ error: '需要 annotations 与 cards 数组' })
    }
    res.json(pdfstudy.saveDoc(p, { annotations, cards }))
    // 标注/卡片变化 → 重索引该 PDF 的标注块（后台）
    void rag.reindexAnnotations(p).catch(() => undefined)
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.get('/api/pdf-study/outline', async (req, res) => {
  try {
    const p = String(req.query.path || '')
    const abs = vault.resolveInVault(p)
    if (!fs.existsSync(abs)) return res.status(404).json({ error: '文件不存在' })
    let outline = await getOutlineTree(keyFor(p), abs, p)
    let outlineMeta = null
    if (outline.length) {
      // 书签优先；无书签时 getOutlineTree 已回退 AI 大纲，这里带出其元信息供前端展示
      try {
        outlineMeta = pdfstudy.loadDoc(p).outlineMeta
      } catch {
        /* ignore */
      }
    }
    res.json({ outline, outlineMeta })
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

// AI 生成大纲：无书签的 PDF 由用户指定目录所在页，LLM 解析 + 页码偏移校准
app.post('/api/pdf-study/outline/generate', async (req, res) => {
  const p = String(req.body?.path || '')
  try {
    vault.resolveInVault(p)
    if (!/\.pdf$/i.test(p)) throw new Error('仅支持 PDF 文件')
    res.json(await generateOutline({ relPath: p, ranges: req.body?.ranges }))
  } catch (e) {
    console.error('[pdf-outline] 生成失败:', e?.message || e)
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.delete('/api/pdf-study/outline', (req, res) => {
  try {
    const p = String(req.query.path || '')
    vault.resolveInVault(p)
    res.json(clearGeneratedOutline(p))
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.post('/api/pdf-study/asset', (req, res) => {
  try {
    const { path: p, dataB64, mime } = req.body ?? {}
    vault.resolveInVault(String(p || ''))
    res.json(pdfstudy.saveAsset(String(p), String(dataB64 || ''), String(mime || 'image/png')))
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.get('/api/pdf-study/asset/:key/:file', (req, res) => {
  try {
    const abs = pdfstudy.assetAbsolutePath(req.params.key, req.params.file)
    if (!fs.existsSync(abs)) return res.status(404).json({ error: '资产不存在' })
    const ext = path.extname(abs).toLowerCase()
    const map = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }
    res.setHeader('Content-Type', map[ext] || 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-store') // 贴图资产会被重新提取覆盖，避免陈旧/损坏的缓存体
    fs.createReadStream(abs).pipe(res)
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

// ── 本地 RAG（知识库语义检索） ──────────────────────────────────────────────

app.get('/api/rag/status', (req, res) => {
  try {
    res.json(rag.status())
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// 语义检索（引用角标点击打开来源文件等场景复用）
app.get('/api/rag/search', async (req, res) => {
  try {
    const q = String(req.query.query ?? req.query.q ?? '').trim()
    if (!q) return res.status(400).json({ error: 'query 不能为空' })
    const k = Math.min(12, Number(req.query.k) || 6)
    res.json(await rag.search(q, k))
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

app.post('/api/rag/reindex', async (req, res) => {
  try {
    res.json({ started: true })
    void rag.reindexAll().catch((e) => console.error('[rag] 全量重索引失败:', e.message))
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) })
  }
})

// ── mermaid 渲染失败自动修复（前端上报，只修坏掉的那段代码块） ──────────────

app.post('/api/mermaid-fix', async (req, res) => {
  const { path: p, code, error, force } = req.body ?? {}
  if (typeof p !== 'string' || typeof code !== 'string') {
    return res.status(400).json({ error: '需要 path 与 code' })
  }
  try {
    const result = await reportMermaidFailure({ path: p, code, error: String(error ?? ''), force: Boolean(force) })
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// ── 翻译（选区翻译，SSE 流式） ──────────────────────────────────────────────

app.post('/api/translate', async (req, res) => {
  const { text, to } = req.body ?? {}
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: '需要 text' })
  }
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders()
  const send = (obj) => {
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`)
    } catch {
      /* ignore */
    }
  }
  const target = String(to) === 'en' ? '英文' : '中文'
  try {
    for await (const { delta } of streamChat({
      messages: [
        {
          role: 'system',
          content:
            `你是专业的学术翻译引擎。把用户提供的文本翻译为${target}：` +
            '术语准确、语句通顺；数学公式、代码、专有名词保留原文。只输出译文，不要任何解释或前缀。',
        },
        { role: 'user', content: text.slice(0, 6000) },
      ],
    })) {
      if (delta?.content) send({ delta: delta.content })
    }
    send({ done: true })
  } catch (e) {
    send({ error: String(e.message || e) })
  }
  res.end()
})

// ── vault 静态托管：笔记内 vault 相对路径的图片（![](assets/x.png)）按原路径直接加载 ──
// 放在 dist 静态之前；/api/ 与点开头文件除外，文件不存在则透传（走 dist 静态）
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next()
  if (req.path.startsWith('/api/')) return next()
  try {
    // 浏览器把非 ASCII 路径百分号编码后才进 Express，先解码再定位 vault 文件
    const decoded = decodeURIComponent(req.path)
    const abs = vault.resolveInVault(decoded)
    if (path.basename(abs).startsWith('.')) return next()
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      return res.sendFile(abs, {
        headers: { 'Content-Type': mimeOf(abs), 'Cache-Control': 'no-store' },
        acceptRanges: true,
        etag: false,
        lastModified: false,
      })
    }
  } catch {
    /* 越出 vault 或路径非法 → 透传 */
  }
  next()
})

// ── 生产模式静态托管 ────────────────────────────────────────────────────────

const distDir = path.join(__dirname, '..', 'dist')
if (fs.existsSync(distDir)) {
  // index.html 禁止缓存（避免浏览器拿着旧 bundle 与新版本不一致）；
  // 带哈希的静态资源可长期缓存
  app.use(
    express.static(distDir, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store')
        else res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      },
    }),
  )
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

const server = app.listen(PORT, '127.0.0.1', () => {
  const s = loadSettings()
  console.log(`[learn-agent] 服务已启动 http://127.0.0.1:${PORT}`)
  console.log(`[learn-agent] vault: ${s.vaultPath}`)
  console.log(`[learn-agent] 模型: ${s.model} @ ${s.apiBaseURL}`)
})

// IDE 语言服务器 / 编译运行：REST 路由 + 统一 WebSocket 通道
lspRoutes(app)
runRoutes(app)
setupWebSocket(server)
