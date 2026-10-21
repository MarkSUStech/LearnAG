// 教学模式：对话式引导学习 agent（Gemini Guided Learning 范式）。
// 与主 agent（runner.js）和笔记答疑（tutor.js）并列的第三条运行循环：
// 每个会话对应 vault 里「教学对话/<标题>.md」一个文件（frontmatter.session 关联会话存储，
// 正文为对话实录，系统自动维护）——点开文件即进入对话，像打开笔记一样有标签栏。
// 每轮自动 RAG 检索 vault 资料注入上下文，可检索/下载真实图片在对话中展示，
// 可通过 delegate 调用知识库专职子 Agent。
import fs from 'node:fs'
import { streamChat } from './runner.js'
import { loadSettings } from '../settings.js'
import { buildTeacherSystemPrompt, buildRagHitBlock } from './teacherPrompts.js'
import { executeTool } from './tools.js'
import { TEACHER_TOOLS, executeScopedTool } from './toolProfiles.js'
import { runSubAgent, subAgentLabel } from './subagent.js'
import * as vault from '../vault.js'
import { graphSummary } from '../graph.js'
import { search as ragSearch, removeFile as ragRemove, enqueue as ragEnqueue } from '../rag.js'
import * as teacherSessions from './teacherSessions.js'
import { MEMORY_NOTE } from './prompt.js'

const MAX_TOOL_ROUNDS = 10
const HISTORY_MESSAGES = 40 // 保留最近 40 条（20 轮对话）

const TOOL_STATUS = {
  search_knowledge: '检索知识库…',
  read_note: '查阅你的笔记…',
  list_notes: '浏览笔记列表…',
  read_graph: '读取知识图谱…',
  search_images: '搜索配图…',
  read_image: '查看图片内容…',
  download_image: '下载配图…',
  extract_pdf_images: '提取 PDF 插图…',
}

// ── 对话文件（vault 内任意目录，一个会话一个 .md，靠 frontmatter 识别） ─────

/** frontmatter 标识：type: teaching-chat + session: t-xxx（两个都匹配才算对话文件） */
const FM_TYPE = /^type:\s*teaching-chat\s*$/m
const FM_SESSION = /^session:\s*(t-[a-z0-9-]+)\s*$/m

/** 会话 id → 对话文件相对路径（扫描 vault 全部笔记的 frontmatter 匹配；找不到返回 null） */
function chatFileFor(sessionId) {
  for (const p of vault.listAllNotes()) {
    try {
      const raw = vault.readFile(p)
      const m = raw.match(FM_SESSION)
      if (m && m[1] === sessionId && FM_TYPE.test(raw)) return p
    } catch {
      /* 跳过读不出的文件 */
    }
  }
  return null
}

/** 标题 → 安全文件名（去非法字符；无有效字符时用时间戳） */
function chatFileName(title) {
  const clean = String(title ?? '')
    .replace(/[\\/:*?"<>|#\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30)
  if (clean) return clean
  const d = new Date()
  const stamp = `${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
  return '对话 ' + stamp
}

/** 对话实录 markdown（frontmatter.session 是文件 ↔ 会话的关联键） */
function transcriptMarkdown(sessionId, title, messages) {
  const cleanTitle = String(title ?? '新对话').slice(0, 40)
  const body = (messages || [])
    .map((m) => {
      let text = `## ${m.role === 'user' ? '🧑 我' : '🎓 老师'}\n\n${String(m.content ?? '').trim()}`
      if (Array.isArray(m.images)) text += '\n' + m.images.map((p) => `![](${p})`).join('\n')
      if (Array.isArray(m.files)) text += '\n' + m.files.map((p) => `[附件：${p}]`).join('  ')
      return text + '\n'
    })
    .join('\n')
  return (
    `---\n` +
    `type: teaching-chat\n` +
    `session: ${sessionId}\n` +
    `title: "${cleanTitle.replace(/"/g, '')}"\n` +
    `date: ${new Date().toISOString().slice(0, 10)}\n` +
    `---\n\n` +
    `# ${cleanTitle}\n\n` +
    `> 🎓 教学模式对话记录：在 LearnAgent 中点击本文件即可继续对话。本文件由系统自动维护，请勿手工编辑消息内容。\n\n` +
    body
  )
}

/** 把会话当前内容写入其对话文件；文件不存在则在 dir（vault 相对目录，空 = 根目录）按标题创建（重名自动加后缀）。返回文件路径 */
function writeChatFile(sessionId, titleOverride, dir = '') {
  const meta = teacherSessions.listSessions().find((s) => s.id === sessionId)
  const title = titleOverride ?? meta?.title ?? '新对话'
  const { messages } = teacherSessions.loadSession(sessionId)
  let rel = chatFileFor(sessionId)
  if (!rel) {
    const name = chatFileName(title === '新对话' ? '' : title)
    const base = String(dir || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    rel = base ? `${base}/${name}.md` : `${name}.md`
    let i = 2
    while (fileExists(rel)) rel = base ? `${base}/${name} ${i++}.md` : `${name} ${i++}.md`
  }
  vault.writeFile(rel, transcriptMarkdown(sessionId, title, messages))
  return rel
}

function fileExists(rel) {
  try {
    return fs.existsSync(vault.resolveInVault(rel))
  } catch {
    return false
  }
}

/** 确保会话有对话文件（新建或补写实录），返回文件路径 */
function ensureChatFile(sessionId, dir = '') {
  return writeChatFile(sessionId, undefined, dir)
}

/** 首轮定题后把对话文件改名为标题（原目录内，重名加后缀），并刷新实录。返回新路径 */
function renameChatFileForTitle(sessionId, title) {
  const cur = chatFileFor(sessionId)
  if (!cur) return writeChatFile(sessionId, title)
  const name = chatFileName(title)
  const curName = cur.split('/').pop().replace(/\.md$/i, '')
  let rel = cur
  if (curName !== name) {
    const slash = cur.lastIndexOf('/')
    const dir = slash > 0 ? cur.slice(0, slash) : ''
    rel = dir ? `${dir}/${name}.md` : `${name}.md`
    let i = 2
    while (fileExists(rel)) rel = dir ? `${dir}/${name} ${i++}.md` : `${name} ${i++}.md`
    vault.renameEntry(cur, rel)
    ragRemove(cur)
    ragEnqueue(rel)
  }
  vault.writeFile(rel, transcriptMarkdown(sessionId, title, teacherSessions.loadSession(sessionId).messages))
  return rel
}

/** 启动迁移：给还没有对话文件的旧会话补建文件 */
export function ensureAllChatFiles() {
  for (const meta of teacherSessions.listSessions()) {
    try {
      if (!chatFileFor(meta.id)) writeChatFile(meta.id)
    } catch (e) {
      console.error('[teacher] 迁移对话文件失败:', meta.id, e?.message || e)
    }
  }
}

/** 用户在文件树里重命名了对话文件：同步会话标题与文件内 frontmatter/标题 */
export function onChatFileRenamed(rel) {
  try {
    const raw = vault.readFile(rel)
    if (!FM_TYPE.test(raw)) return
    const id = raw.match(FM_SESSION)?.[1]
    if (!id) return
    const name = rel.split('/').pop().replace(/\.md$/i, '')
    teacherSessions.renameSession(id, name)
    writeChatFile(id, name)
  } catch {
    /* 非对话文件或读取失败，静默跳过 */
  }
}

/** 文件被删除（文件树/外部）时归档会话存储（不涉及文件） */
export function archiveTeacherSession(sessionId) {
  try {
    teacherSessions.deleteSession(sessionId)
  } catch {
    /* ignore */
  }
}

let teacherRun = null // { controller, sessionId }

export function stopTeacher() {
  if (teacherRun) teacherRun.controller.abort()
}

export function isTeacherRunning() {
  return Boolean(teacherRun)
}

// ── 多模态：用户消息附带图片（vision） ──────────────────────────────────────

const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }
const MAX_IMAGES = 4 // 单条消息最多携带的图片数

/** vault 内图片路径 → OpenAI vision content part（data URI）；读取失败返回 null */
function imagePart(path) {
  try {
    const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
    const mime = IMAGE_MIME[ext] ?? 'image/png'
    const buf = fs.readFileSync(vault.resolveInVault(path))
    return { type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}` } }
  } catch {
    return null
  }
}

/** 存储态用户消息 → 模型态（带图的历史轮重建为 vision content） */
function toModelMessage(m, useZcode) {
  if (m.role !== 'user') return m
  let text = String(m.content ?? '')
  if (Array.isArray(m.files) && m.files.length) text += `\n[附件文件（可 read_note / Read 查看）：${m.files.join('、')}]`
  if (useZcode) {
    // ZCode 引擎走纯文本：图片以 vault 路径告知（CLI 可自行读取）
    if (Array.isArray(m.images) && m.images.length) text += `\n[用户附图（已存知识库，可用 Read 查看）：${m.images.join('、')}]`
    return { role: 'user', content: text }
  }
  if (Array.isArray(m.images) && m.images.length) {
    const parts = m.images.map(imagePart).filter(Boolean)
    if (parts.length) return { role: 'user', content: [{ type: 'text', text }, ...parts] }
  }
  return { role: 'user', content: text }
}

function readMemoryNote() {
  try {
    return vault.readFile(MEMORY_NOTE).slice(0, 1200)
  } catch {
    return ''
  }
}

/** 每轮消息自动 RAG：取用户输入做语义检索，命中作为上下文附在消息后（失败静默跳过） */
async function autoRetrieve(message) {
  try {
    const r = await ragSearch(String(message).slice(0, 300), 4)
    return Array.isArray(r?.results) ? r.results : []
  } catch {
    return []
  }
}

function safeParse(s) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/** 首条消息 → 会话标题（与主模式同款清洗：去掉乱码回退） */
function titleFrom(message) {
  const cleaned = String(message).replace(/[\uFFFD\u0000-\u001F]/g, '').trim()
  const weird = (cleaned.match(/[\u00C0-\u01FF\u0250-\u036F]/g) || []).length
  const cjk = (cleaned.match(/[\u4E00-\u9FFF]/g) || []).length
  if (weird >= 2 || (!cjk && cleaned.length > 0)) return undefined
  return cleaned.slice(0, 20) || undefined
}

/**
 * 运行一轮教学对话。
 * @param emit SSE 推送回调
 * @param message 用户消息
 * @param sessionId 教学模式会话 id（缺省用当前活跃会话）
 * @param attachments 附带文件（vault 相对路径；图片走 vision，其他文件以路径告知）
 */
export async function runTeacher({ emit, message, sessionId = '', attachments = [] }) {
  if (teacherRun) throw new Error('教学助手正在回复中')
  if (!message || !String(message).trim()) throw new Error('消息不能为空')

  const id = sessionId && /^[a-z0-9-]{6,40}$/i.test(sessionId) ? sessionId : teacherSessions.ensureActive()
  const controller = new AbortController()
  teacherRun = { controller, sessionId: id }

  try {
    emit({ type: 'teacher-status', sessionId: id, message: '思考中…' })

    // ── 附件归一化：图片（vision）与其余文件分列 ──
    const atts = (Array.isArray(attachments) ? attachments : [])
      .map((a) => String(a ?? '').trim().replace(/\\/g, '/'))
      .filter(Boolean)
      .slice(0, 6)
    const isImg = (p) => Boolean(IMAGE_MIME[p.slice(p.lastIndexOf('.')).toLowerCase()])
    const imageAtts = atts.filter(isImg).slice(0, MAX_IMAGES)
    const fileAtts = atts.filter((a) => !isImg(a))

    // ── 上下文组装：画像 + 历史 + 本轮自动 RAG + 多模态附件 ──
    const { messages: history } = teacherSessions.loadSession(id)
    const ragHits = await autoRetrieve(message)
    const te = loadSettings().tutorEngine || 'follow'
    const useZcode = (te === 'follow' ? loadSettings().engine : te) === 'zcode'
    const engine = te === 'follow' ? undefined : te

    let userText = String(message).trim()
    if (fileAtts.length) userText += `\n[附件文件（可 read_note / Read 查看）：${fileAtts.join('、')}]`
    const hitBlock = ragHits.length ? '\n\n' + buildRagHitBlock(ragHits) : ''

    let userContent
    if (!useZcode && imageAtts.length) {
      const parts = imageAtts.map(imagePart).filter(Boolean)
      userContent = [{ type: 'text', text: userText + hitBlock }, ...parts]
    } else {
      userContent = userText + hitBlock
      if (useZcode && imageAtts.length) {
        userContent += `\n[用户附图（已存知识库，可用 Read 查看）：${imageAtts.join('、')}]`
      }
    }

    const messages = [
      {
        role: 'system',
        content: buildTeacherSystemPrompt({ graphSummaryText: graphSummary(), memoryNote: readMemoryNote() }),
      },
      ...history.map((m) => toModelMessage(m, useZcode)),
      { role: 'user', content: userContent },
    ]

    // ── 工具循环：流式回复，工具调用后继续 ──
    let assistantText = ''
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const assistant = { role: 'assistant', content: '' }
      const callAcc = new Map()
      // 对话引擎跟随设置里的 tutorEngine（对话类助手共用；follow=跟随主引擎，建议 api）
      for await (const { delta, finishReason } of streamChat({ messages, signal: controller.signal, engine, tools: TEACHER_TOOLS })) {
        if (finishReason) break
        const reasoning = delta.reasoning_content ?? delta.reasoning
        if (reasoning) assistant.reasoning_content = (assistant.reasoning_content || '') + reasoning
        if (delta.content) {
          assistant.content += delta.content
          if (callAcc.size === 0) emit({ type: 'teacher-delta', sessionId: id, text: delta.content })
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const i = tc.index ?? 0
            if (!callAcc.has(i)) callAcc.set(i, { id: tc.id || '', name: '', args: '' })
            const acc = callAcc.get(i)
            if (tc.id) acc.id = tc.id
            if (tc.function?.name) acc.name += tc.function.name
            if (tc.function?.arguments) acc.args += tc.function.arguments
          }
        }
      }

      const toolCalls = [...callAcc.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => ({ id: v.id, name: v.name, args: v.args }))

      if (toolCalls.length > 0) {
        // 模型改用工具：作废已流出的正文
        assistant.content = ''
        assistant.tool_calls = toolCalls.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: t.args },
        }))
        messages.push(assistant)
        emit({ type: 'teacher-delta', sessionId: id, reset: true })
        for (const tc of toolCalls) {
          const args = safeParse(tc.args) ?? {}
          const status =
            tc.name === 'delegate'
              ? subAgentLabel(args.role) + ' 工作中：' + String(args.task || '').slice(0, 40)
              : TOOL_STATUS[tc.name] || '调用工具 ' + tc.name + '…'
          emit({ type: 'teacher-status', sessionId: id, message: status })
          const result = await executeScopedTool(TEACHER_TOOLS, tc.name, args, {
            onWrite: (rel, content) => {
              // 子 Agent 写笔记：照常推 agent-write，学习模式的编辑器实时刷新
              emit({ type: 'agent-write', path: rel, content, done: true })
              emit({ type: 'agent-status', stage: 'written', path: rel, message: '已写入 ' + rel })
            },
            delegate: async (p) => {
              const r = await runSubAgent({
                role: p.role,
                task: p.task,
                context: p.context || '',
                emit,
                signal: controller.signal,
                streamChat: (opts) => streamChat({ ...opts, engine }),
                executeTool,
                hooks: {
                  onWrite: (rel, content) => {
                    emit({ type: 'agent-write', path: rel, content, done: true })
                    emit({ type: 'agent-status', stage: 'written', path: rel, message: '已写入 ' + rel })
                  },
                },
              })
              return r.result
            },
          })
          messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
        }
        continue
      }

      // 纯文本回复 → 本轮结束
      if (!assistant.content.trim()) {
        assistant.content = '（我一时没组织好回复，请再说一次）'
        messages.push(assistant)
        emit({ type: 'teacher-delta', sessionId: id, text: assistant.content })
      } else {
        messages.push(assistant)
      }
      assistantText = assistant.content
      break
    }

    // 持久化：user/assistant 有效文本（images/files 随 user 轮存储，供历史重建 vision 消息与实录嵌图）
    const prevChat = history.filter(
      (m) =>
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim().length > 0,
    )
    const userTurn = { role: 'user', content: String(message).trim() }
    if (imageAtts.length) userTurn.images = imageAtts
    if (fileAtts.length) userTurn.files = fileAtts
    const chat = [...prevChat, userTurn, { role: 'assistant', content: assistantText }].slice(-HISTORY_MESSAGES)
    const meta = teacherSessions.listSessions().find((s) => s.id === id)
    const title = meta && meta.title === '新对话' ? titleFrom(message) : undefined
    teacherSessions.saveSession(id, chat, '', title)

    // ── 对话文件同步：定题改名 + 刷新实录（失败不阻断对话） ──
    try {
      const chatPath = title ? renameChatFileForTitle(id, title) : writeChatFile(id)
      emit({ type: 'teacher-file', sessionId: id, path: chatPath })
    } catch (e) {
      console.error('[teacher] 对话文件写入失败:', e?.message || e)
    }
    emit({ type: 'teacher-done', sessionId: id })
    return { text: assistantText }
  } finally {
    teacherRun = null
  }
}

// ── 会话 API（供 index.js 挂载） ────────────────────────────────────────────

export function listTeacherSessionsApi() {
  return { sessions: teacherSessions.listSessions(), activeId: teacherSessions.ensureActive() }
}

export function createTeacherSessionApi(dir = '') {
  if (isTeacherRunning()) throw new Error('教学助手正在回复中')
  const session = teacherSessions.createSession()
  let path = ''
  try {
    path = ensureChatFile(session.id, dir)
  } catch (e) {
    console.error('[teacher] 创建对话文件失败:', e?.message || e)
  }
  return { session, path }
}

export function activateTeacherSessionApi(id) {
  if (isTeacherRunning()) throw new Error('教学助手正在回复中')
  teacherSessions.ensureActive()
  if (!teacherSessions.listSessions().some((s) => s.id === id)) throw new Error('会话不存在')
  teacherSessions.setActiveId(id)
  return { ok: true }
}

export function deleteTeacherSessionApi(id) {
  if (isTeacherRunning()) throw new Error('教学助手正在回复中')
  // 连同对话文件一起删除（文件树删除则走 archiveTeacherSession，文件已由删除路由处理）
  const file = chatFileFor(id)
  if (file) {
    vault.deleteEntry(file)
    vault.notifyWrite(file, 'unlink')
  }
  teacherSessions.deleteSession(id)
  return { ok: true }
}

export function renameTeacherSessionApi(id, title) {
  const r = teacherSessions.renameSession(id, title)
  try {
    const path = writeChatFile(id)
    if (path) return { ...r, path }
  } catch {
    /* 文件同步失败不影响改名 */
  }
  return r
}

export function loadTeacherHistory(id) {
  const sid = id && /^[a-z0-9-]{6,40}$/i.test(id) ? id : teacherSessions.ensureActive()
  const { messages } = teacherSessions.loadSession(sid)
  return messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
}

export function clearTeacherHistory(id) {
  const sid = id && /^[a-z0-9-]{6,40}$/i.test(id) ? id : teacherSessions.ensureActive()
  if (!teacherSessions.listSessions().some((s) => s.id === sid)) throw new Error('会话不存在')
  const meta = teacherSessions.listSessions().find((s) => s.id === sid)
  teacherSessions.saveSession(sid, [], '', undefined)
  try {
    writeChatFile(sid)
  } catch {
    /* 文件同步失败不影响清空 */
  }
  return { ok: true, id: sid, title: meta?.title ?? '新对话' }
}
