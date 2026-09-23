import fs from 'node:fs'
import path from 'node:path'
import { loadSettings } from '../settings.js'
import * as vault from '../vault.js'
import { graphSummary } from '../graph.js'
import { buildManagerSystem, buildRouterMessages, buildDirectMessages, AGENT_WORKBENCH, MEMORY_NOTE, PLAN_NOTE } from './prompt.js'
import { toolDefs, executeTool } from './tools.js'
import { netErrInfo, isTransientNetErr, withRetry, sleep } from './netutil.js'
import * as sessions from './sessions.js'
import { runSubAgent, subAgentLabel } from './subagent.js'
import { zcodeAvailable, zcodeChatOnce, zcodeStreamText, runZcodeTurn, getZcodeSessionId, setZcodeSessionId, ensureZcodeMcp } from './zcode.js'
import { goalContextBlock } from '../goals.js'

const MAX_TOOL_ROUNDS = 30
const COMPACTION_THRESHOLD = 60 // 消息数超过该值触发压缩
const COMPACTION_KEEP = 24 // 压缩时保留最近的消息数
const MODES = ['教学', '探索', '目标', '写作']
// 管理 Agent 的工具集：规划/委派/知识网络/向用户提问——不亲自写内容与上网检索
const MANAGER_TOOLS = ['delegate', 'ask_user', 'read_graph', 'update_graph', 'read_note', 'list_notes', 'search_knowledge']

// ── 提问挂起（ask_user） ────────────────────────────────────────────────────

let pendingQuestion = null // { id, resolve, event }

export function resolvePendingAnswer(id, value) {
  if (pendingQuestion && pendingQuestion.id === id) {
    const resolve = pendingQuestion.resolve
    pendingQuestion = null
    resolve(value ?? { skipped: true })
    return true
  }
  return false
}

/** 新 SSE 客户端接入时重放未回答的问题（页面刷新恢复） */
export function replayPendingQuestion(emit) {
  if (pendingQuestion) emit(pendingQuestion.event)
}

export function cancelPendingQuestion() {
  if (pendingQuestion) {
    const resolve = pendingQuestion.resolve
    pendingQuestion = null
    resolve({ cancelled: true })
  }
}

// ── 会话历史 ────────────────────────────────────────────────────────────────

export function listSessionsApi() {
  return sessions.listSessions()
}

export function getActiveSession() {
  const id = sessions.ensureActive()
  const meta = sessions.listSessions().find((s) => s.id === id)
  return meta ?? { id, title: '新对话' }
}

export function createSessionApi() {
  if (isRunning()) throw new Error('agent 正在工作中')
  return sessions.createSession()
}

export function activateSessionApi(id) {
  if (isRunning()) throw new Error('agent 正在工作中')
  sessions.ensureActive()
  sessions.setActiveId(id)
  return { ok: true }
}

export function deleteSessionApi(id) {
  if (isRunning()) throw new Error('agent 正在工作中')
  sessions.deleteSession(id)
  return { ok: true }
}

export function renameSessionApi(id, title) {
  return sessions.renameSession(id, title)
}

/** 持久化瘦身：较早轮次的工具结果截断为前 200 字 */
function slimHistory(messages, oldCount) {
  return messages.map((m, i) => {
    if (i < oldCount && m.role === 'tool' && typeof m.content === 'string' && m.content.length > 220) {
      return { ...m, content: m.content.slice(0, 200) + '…[已截断]' }
    }
    return m
  })
}

/**
 * 清洗会话历史：旧版本压缩边界可能把 assistant(tool_calls)↔tool 结果组从中间切开，
 * 留下孤立 tool 消息或残缺调用组，模型服务会直接 400。加载时修复：
 * - 完整组（tool_calls 与结果一一对应）保留
 * - 残缺组降级为纯文本 assistant（保留其文字），孤立 tool 结果丢弃
 */
function sanitizeHistory(messages) {
  const out = []
  let i = 0
  while (i < messages.length) {
    const m = messages[i]
    if (m && m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const ids = new Set(m.tool_calls.map((t) => t.id).filter(Boolean))
      const results = []
      let j = i + 1
      while (j < messages.length && messages[j] && messages[j].role === 'tool') {
        if (ids.has(messages[j].tool_call_id)) results.push(messages[j])
        j++
      }
      if (ids.size > 0 && results.length === ids.size) {
        out.push(m)
        for (const r of results) out.push(r)
      } else if (typeof m.content === 'string' && m.content.trim()) {
        out.push({ role: 'assistant', content: m.content })
      }
      i = j
      continue
    }
    if (m && m.role === 'tool') {
      i++ // 孤立 tool 结果（前面没有对应的 tool_calls），丢弃
      continue
    }
    out.push(m)
    i++
  }
  return out
}

// ── 记忆笔记 ────────────────────────────────────────────────────────────────

function readMemoryNote() {
  try {
    return vault.readFile(MEMORY_NOTE).slice(0, 2000)
  } catch {
    return ''
  }
}

function readPlanNote() {
  try {
    return vault.readFile(PLAN_NOTE).slice(0, 1500)
  } catch {
    return ''
  }
}

// ── write_note 参数增量解析 ──────────────────────────────────────────────────

/** 从未完结的 JSON 参数串中尽力提取 path 与 content 的当前内容 */
function extractPartialArgs(raw) {
  const out = { path: undefined, content: undefined }
  if (!raw) return out
  const pathMatch = raw.match(/"path"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  if (pathMatch) {
    try {
      out.path = JSON.parse('"' + pathMatch[1] + '"')
    } catch {
      /* ignore */
    }
  }
  const contentStart = raw.match(/"content"\s*:\s*"/)
  if (contentStart) {
    const rest = raw.slice(contentStart.index + contentStart[0].length)
    out.content = decodeJsonFragment(rest)
  }
  return out
}

/** 解码 JSON 字符串片段（可能截断在任意位置，包括转义序列中间） */
function decodeJsonFragment(s) {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c !== '\\') {
      out += c
      continue
    }
    const n = s[i + 1]
    if (n === undefined) break
    switch (n) {
      case '"':
        out += '"'
        i++
        break
      case '\\':
        out += '\\'
        i++
        break
      case '/':
        out += '/'
        i++
        break
      case 'n':
        out += '\n'
        i++
        break
      case 't':
        out += '\t'
        i++
        break
      case 'r':
        out += '\r'
        i++
        break
      case 'b':
        out += '\b'
        i++
        break
      case 'f':
        out += '\f'
        i++
        break
      case 'u': {
        const hex = s.slice(i + 2, i + 6)
        if (hex.length < 4) return out // 截断的 unicode 转义，丢弃尾部
        const code = parseInt(hex, 16)
        if (Number.isNaN(code)) return out
        out += String.fromCharCode(code)
        i += 5
        break
      }
      default:
        out += n
        i++
    }
  }
  return out
}

// ── OpenAI 兼容调用 ─────────────────────────────────────────────────────────

function apiConfig() {
  const { apiBaseURL, apiKey, model } = loadSettings()
  return { base: apiBaseURL.replace(/\/+$/, ''), apiKey, model }
}

function usingZcode() {
  return loadSettings().engine === 'zcode' && zcodeAvailable()
}

/** OpenAI messages 数组 → ZCode 单轮提示词（纯文本辅助任务：直答/压缩/翻译/修复） */
function messagesToPrompt(messages) {
  const roleTag = { system: '背景与要求', user: '任务', assistant: '你此前的回复' }
  const body = messages
    .map((m) => `【${roleTag[m.role] || m.role}】\n${typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')}`)
    .join('\n\n')
  return body + '\n\n【输出要求】直接以文本回答（markdown），不要调用任何工具，不要读写任何文件。'
}

export async function* streamChat({ messages, signal, tools = toolDefs }) {
  // ZCode 引擎：无工具直答流式（主智能体在 zcode 模式下不走本函数的工具循环）
  if (usingZcode()) {
    for await (const text of zcodeStreamText(messagesToPrompt(messages), { signal })) {
      yield { delta: { content: text }, finishReason: undefined }
    }
    return
  }
  const { base, apiKey, model } = apiConfig()
  let received = false // 是否已向调用方流出内容：流出后不能静默重试（会重复输出）
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(base + '/chat/completions', {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        body: JSON.stringify({
          model,
          messages,
          tools: (tools ?? []).filter(Boolean), // 防御：稀疏数组空洞会被序列化成 null，严格网关直接 400
          stream: true,
          temperature: 0.7,
        }),
      })
      if (!res.ok) {
        let detail = ''
        try {
          detail = (await res.text()).slice(0, 500)
        } catch {
          /* ignore */
        }
        const err = new Error(`AI 服务返回 ${res.status}：${detail}`)
        if (attempt < 3 && (res.status === 429 || res.status >= 500)) {
          console.warn(`[net] 模型服务 ${res.status}，${800 * attempt}ms 后重试（第 ${attempt + 1} 次）`)
          await sleep(800 * attempt)
          continue
        }
        throw err
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim()
          buf = buf.slice(idx + 1)
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') return
          try {
            const json = JSON.parse(payload)
            const delta = json.choices?.[0]?.delta
            if (delta) {
              received = true
              yield { delta, finishReason: json.choices?.[0]?.finish_reason }
            }
          } catch {
            /* 忽略无法解析的心跳/注释行 */
          }
        }
      }
      return
    } catch (e) {
      // 用户主动停止：绝不重试
      if (signal?.aborted || e?.name === 'AbortError') throw e
      if (received) {
        // 流已输出一半才断线：不能重放，说明情况让用户重试
        throw new Error('模型流式响应中断（' + netErrInfo(e) + '），本轮回答不完整，请重新发送')
      }
      if (attempt < 3 && isTransientNetErr(e)) {
        console.warn(`[net] streamChat 第 ${attempt} 次失败（${netErrInfo(e)}），${600 * attempt}ms 后重试`)
        await sleep(600 * attempt)
        continue
      }
      throw new Error('连接模型服务失败：' + netErrInfo(e))
    }
  }
}

/** 非流式单次调用（历史压缩、mermaid 修复等辅助任务） */
export async function chatOnce(messages, opts = {}) {
  // ZCode 引擎：单轮无头问答（无工具、纯文本回复）
  if (usingZcode()) {
    return zcodeChatOnce(messagesToPrompt(messages))
  }
  const { base, apiKey, model } = apiConfig()
  return withRetry(
    async () => {
      const res = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          temperature: opts.temperature ?? 0.3,
          max_tokens: opts.maxTokens ?? 800,
        }),
      })
      if (!res.ok) {
        const err = new Error('AI 服务返回 ' + res.status)
        err.status = res.status
        throw err
      }
      const json = await res.json()
      return json.choices?.[0]?.message?.content ?? ''
    },
    { tries: 3, label: '辅助调用', signal: undefined },
  )
}

// ── 滚动压缩 ────────────────────────────────────────────────────────────────

async function compactIfNeeded(messages, summary, emit) {
  if (messages.length <= COMPACTION_THRESHOLD) return { messages, summary }
  let cut = messages.length - COMPACTION_KEEP
  // 边界对齐：keep 的开头不能是 tool 消息——它的 tool_calls 搭档会被切进旧段，
  // 下一轮请求会 400（"tool' must be a response to a preceding message with 'tool_calls'"）
  while (cut > 0 && messages[cut] && messages[cut].role === 'tool') cut--
  const oldPart = messages.slice(0, cut)
  const keep = messages.slice(cut)
  const transcript = oldPart
    .map((m) => {
      const role = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : '工具'
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? m.tool_calls ?? '')
      return `${role}: ${text.slice(0, 400)}`
    })
    .join('\n')
  emit({ type: 'agent-status', stage: 'thinking', message: '正在整理长期记忆…' })
  try {
    const text = await chatOnce([
      {
        role: 'user',
        content:
          `你是学习助手。下面是一段较早的对话片段，请把它压缩成要点式长期记忆，` +
          `必须保留：用户的学习目标与达成标准、学习计划及当前进度、已掌握/薄弱的知识点、用户偏好、未决问题。` +
          `用短句列表输出，不要寒暄。\n\n` +
          `【现有长期记忆摘要】\n${summary || '（无）'}\n\n【对话片段】\n${transcript.slice(0, 24000)}\n\n` +
          `【输出】合并后的长期记忆要点（500 字以内）：`,
      },
    ])
    const merged = ((summary ? summary + '\n' : '') + text).slice(-4000)
    console.log(`[agent] 已压缩 ${oldPart.length} 条历史为长期记忆`)
    return { messages: keep, summary: merged }
  } catch (e) {
    console.error('[agent] 压缩失败，保留原历史', e.message)
    return { messages, summary }
  }
}

// ── 运行器 ──────────────────────────────────────────────────────────────────

let currentRun = null // { controller: AbortController, writeActivity: Map<path, ts> }

/** 某笔记是否正被 agent 写入（含结束后 2.5s 冷却，供 mermaid 自动修复等旁路任务避让） */
export function isPathStreaming(path) {
  const rec = currentRun?.writeActivity
  if (!rec) return false
  const key = String(path).replace(/\\/g, '/')
  let last = rec.get(key)
  if (last == null) {
    // writeActivity 可能以反斜杠路径记录，兜底再查一次
    for (const [k, v] of rec) if (k.replace(/\\/g, '/') === key) last = v
  }
  return last != null && Date.now() - last < 2500
}

export function stopAgent() {
  cancelPendingQuestion()
  if (currentRun) currentRun.controller.abort()
}

export function isRunning() {
  return Boolean(currentRun)
}

/** 当前任务的 abort signal（ZCode MCP 桥接的 ask_user 挂起随停止而取消） */
export function activeRunSignal() {
  return currentRun?.controller?.signal ?? null
}

/**
 * 运行明细记录器：累积思考过程与工具调用，节流快照推给前端
 * （状态行点击展开的「思考 / 工具调用」面板数据源）。
 */
function makeDetailRecorder(emit) {
  const d = { thought: '', tools: [] }
  let lastEmit = 0
  const push = (force) => {
    const now = Date.now()
    if (!force && now - lastEmit < 400) return
    lastEmit = now
    try {
      emit({ type: 'agent-detail', thought: d.thought.slice(-4000), tools: d.tools.slice(-20) })
    } catch {
      /* 推送失败不影响运行 */
    }
  }
  return {
    clear() {
      d.thought = ''
      d.tools = []
      push(true)
    },
    addThought(text) {
      if (!text) return
      d.thought += text
      push()
    },
    addTool(name, detail) {
      d.tools.push({ name: String(name || 'tool'), detail: String(detail ?? '').slice(0, 220), ts: Date.now() })
      if (d.tools.length > 30) d.tools.shift()
      push(true)
    },
  }
}

/** 工具入参摘要（状态面板一行显示用） */
function summarizeToolInput(name, args = {}) {
  const pick = (...keys) => {
    for (const k of keys) {
      const v = args[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return ''
  }
  switch (name) {
    case 'write_note':
      return '写入 ' + pick('path')
    case 'read_note':
      return '读取 ' + pick('path') + (args.chapter ? ` 「${args.chapter}」` : args.page ? ` 第${args.page}页` : '')
    case 'web_search':
    case 'webSearch':
      return '搜索: ' + pick('query')
    case 'search_knowledge':
      return 'RAG: ' + pick('query')
    case 'search_images':
      return '搜图: ' + pick('query')
    case 'download_image':
      return '下载图 → ' + pick('path')
    case 'download_paper':
      return '下载论文 ' + pick('dir')
    case 'web_fetch':
    case 'webFetch':
      return '抓取 ' + pick('url')
    case 'ask_user':
      return pick('question')
    case 'delegate':
      return `委派 ${pick('role')}：` + pick('task')
    case 'Read':
    case 'Write':
    case 'Edit':
      return `${name === 'Read' ? '读取' : '写入'} ${pick('file_path')}`
    case 'Bash':
      return pick('command')
    case 'Grep':
      return '搜索 ' + pick('pattern')
    case 'Glob':
      return '列出 ' + pick('pattern')
    default: {
      const j = JSON.stringify(args)
      return j.length > 160 ? j.slice(0, 160) + '…' : j
    }
  }
}

/**
 * 发出提问卡片并挂起等待用户作答（API 模式 ask_user 工具与 ZCode MCP ask_user 共用）。
 * 回答会记录到工作台并关闭卡片。answer: {value}|{files}|{cancelled}|{skipped}
 */
export async function suspendForQuestion({ emit, args = {}, signal, contextFiles = [] }) {
  let qType = ['single', 'multi', 'judge', 'text', 'file'].includes(args.type) ? args.type : 'text'
  let options = Array.isArray(args.options)
    ? args.options
        .map((o) => (typeof o === 'string' ? o : String(o?.label ?? o?.text ?? o?.value ?? JSON.stringify(o))))
        .filter(Boolean)
        .slice(0, 8)
    : []
  if ((qType === 'single' || qType === 'multi') && options.length < 2) {
    qType = 'text' // 兜底：没有选项降级为简答
    options = []
  }
  const id = 'q-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
  const question = String(args.question ?? '').slice(0, 2000)
  console.log('[agent] ask_user 挂起', id, qType)
  const answer = await new Promise((resolve) => {
    const questionEvent = {
      type: 'agent-question',
      id,
      question,
      qType,
      options,
      allowCustom: args.allowCustom !== false,
      fileHint: String(args.fileHint ?? ''),
      fileMultiple: Boolean(args.fileMultiple),
      code: String(args.code ?? '').slice(0, 4000),
      contextFiles,
    }
    pendingQuestion = { id, resolve, event: questionEvent }
    const onAbort = () => {
      if (pendingQuestion?.id === id) {
        pendingQuestion = null
        resolve({ cancelled: true })
      }
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
    emit(questionEvent)
  })
  console.log('[agent] ask_user 收到回答:', JSON.stringify(answer).slice(0, 100))
  appendWorkbench(`**问**：${question}\n\n**答**：${formatAnswer(answer)}`)
  emit({ type: 'agent-question-closed', id })
  return answer
}

function safeParse(s) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function appendWorkbench(text) {
  try {
    let prev = ''
    try {
      prev = vault.readFile(AGENT_WORKBENCH)
    } catch {
      prev = '# 工作台\n\n与 agent 的交流记录（提问、反馈、确认）都会追加在这里。\n'
    }
    vault.writeFile(AGENT_WORKBENCH, prev.replace(/\s*$/, '') + '\n\n' + text + '\n')
    vault.notifyWrite(AGENT_WORKBENCH, 'change')
  } catch {
    /* 工作台写入失败不阻断 */
  }
}

function formatAnswer(answer) {
  if (!answer || typeof answer !== 'object') return String(answer)
  if (answer.cancelled) return '（用户停止了本次任务）'
  if (answer.skipped) return '（用户跳过了这个问题）'
  if (Array.isArray(answer.value)) return answer.value.join('；')
  if (Array.isArray(answer.files)) return '上传了文件：' + answer.files.map((f) => f.path).join('、')
  return String(answer.value ?? '')
}

/** 附件上下文块（API / ZCode 引擎共用） */
function buildAttachBlock(attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return ''
  return (
    '\n【附带资料】（[重点]=笔记核心依据；[次要]=补充对照）\n' +
    attachments
      .map((a) => {
        const role = a.primary === false ? '[次要]' : '[重点]'
        const sc = a.scope || {}
        const parts = []
        if (sc.chapter) parts.push(`章节「${sc.chapter}」`)
        if (sc.from || sc.to) parts.push(`第 ${sc.from ?? '?'}–${sc.to ?? '?'} 页`)
        const scopeText = parts.length
          ? '建议范围：' + parts.join('，')
          : '建议范围：未指定（先定位相关章节/页码，禁止全文读入）'
        return `- ${role} ${a.path} ｜ ${scopeText}`
      })
      .join('\n') +
    '\n'
  )
}

// ── ZCode 引擎：主智能体（本机 ZCode CLI 全权执行） ─────────────────────────

const ZCODE_MODE_HINT = {
  教学: '以教会用户为目标：先摸底评估已掌握程度（依据知识图谱与已有笔记），再讲解与出题练习，并把掌握度变化写进知识网络。',
  探索: '用户在自由探索：答疑、推荐、延伸皆可，有价值的新知识点顺手沉淀进知识网络。',
  目标: '对齐 Agent/目标与计划.md 推进目标：拆解、执行、更新计划进度与知识网络。',
  写作: '基于附带资料撰写或完善笔记：先读资料相关部分，引用落到具体文件与页码/章节。',
}

function buildZcodePrompt({ userMessage, mode, attachments, goalBlock = '' }) {
  const safeMode = MODES.includes(mode) ? mode : '教学'
  return `你是用户本机的学习智能体。当前工作目录就是用户的知识库（Obsidian vault）根目录，你的所有读写都发生在其中。

## 目录约定
- 笔记/<领域>/<知识点>/note/ ：讲解类笔记
- 知识图谱/<知识点>.md ：知识点主笔记。frontmatter 必须含 id（英文 kebab-case）、tags（首个为领域）、mastery（0~10）、status（mastered/learning/learnable）、related（[[相关知识点标题]] 列表，可选）、date；该目录的文件变化会被系统自动同步进知识图谱.json
- 知识图谱.json ：知识网络主档案（节点 id/title/field/mastery/status/note + 边 depends-on/leads-to/relates-to）。需要更新时先 Read 再 Edit，保持 JSON 合法
- 资料/ ：课程 PDF、论文（reference/papers/）、网页存档（reference/web/）
- Agent/记忆.md、Agent/目标与计划.md ：若存在先读——里面是用户的长期记忆、目标与计划进度，主动衔接，不要让用户重复说过的话

## 工作纪律
- 笔记要详实完整：概念、推导、例子、易错点、自测题都应覆盖，宁可长而透，不要薄而空。图用 mermaid，语法不要混用（例如 Note over 只能出现在 sequenceDiagram 中）
- 需要向用户提问（摸底测评、出题检查掌握程度、候选路径选择）时，用 ask_user 工具：用户会在界面上看到提问卡片并作答，工具结果就是用户的回答（answer.value；被跳过/取消也要得体处理）。每次只问一个问题；题目涉及用户看不到的内容时放进 code 参数
- 出题测评纪律：一道一问，跨层级搭配（概念判断 judge → 识记 single → 理解/应用 text）；「不会就是不会」——答错或答「不会」只简短确认并记录薄弱点，立即下一题，测评环节不讲解；所有题型用户都可能自定义回答，按内容严肃判定，空洞/抄题面视为未通过
- 动笔/回答前**必须先调用 search_knowledge** 语义检索用户知识库（覆盖全部笔记、PDF 原文、用户在 PDF 里的标注与卡片——这些深层内容 Grep/Glob 搜不到）；检索命中后只用 Read 读取它给出的具体文件，不要用 Grep/Glob 大范围翻找笔记正文
- 新学的知识点要沉淀进知识网络：写 知识图谱/<知识点>.md（带规范 frontmatter），并直接编辑 知识图谱.json 补节点与边；从已掌握节点向外推演一层（新节点 status=learnable、mastery=0）
- 不要修改 .obsidian、.agent 与 Agent/工作台.md（工作台由系统写入）
- 只操作上述 vault 内的文件，不要动用户电脑上的其他东西

## 当前目标（用户本轮选定，优先服务它）
${goalBlock}

## 当前任务
模式：【${safeMode}】${ZCODE_MODE_HINT[safeMode] || ''}
用户消息：
${userMessage}${buildAttachBlock(attachments)}
完成后，最后用一段简短的中文总结回复（做了什么、新写了/修改了哪些文件、下一步建议），不要把笔记全文粘进回复。`
}

/** 绝对路径 → vault 相对路径（越出 vault 返回 null） */
function relFromVault(absPath) {
  try {
    const rel = path.relative(vault.getVaultRoot(), absPath)
    if (!rel || rel.startsWith('..')) return null
    return rel.replace(/\\/g, '/')
  } catch {
    return null
  }
}

/**
 * ZCode 引擎的主智能体：整个任务交给本机 ZCode CLI 无头执行，
 * 事件流映射回 LearnAgent 的 SSE 协议（agent-status / agent-write / agent-done）。
 */
export async function runZcodeAgent({ emit, userMessage, mode, attachments = [], goalId = '' }) {
  if (currentRun) throw new Error('已有任务在进行中')
  if (!zcodeAvailable()) throw new Error('未找到本机 ZCode CLI，请在设置中检查路径，或切回 API 引擎')
  const abort = new AbortController()
  currentRun = { controller: abort, writeActivity: new Map() }
  const runDetail = makeDetailRecorder(emit)
  runDetail.clear()
  const settings = loadSettings()
  const sessionId = sessions.ensureActive()

  const ZCODE_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

  const state = { reply: '', lastStreamEmit: 0, lastThinkEmit: 0, pendingFiles: new Map() }
  const onEvent = (e) => {
    if (e.type === 'reasoning-delta') {
      runDetail.addThought(e.text || '')
      const now = Date.now()
      if (now - state.lastThinkEmit > 4000) {
        state.lastThinkEmit = now
        emit({ type: 'agent-status', stage: 'thinking', message: 'ZCode 思考中…' })
      }
      return
    }
    if (e.type === 'text-delta') {
      state.reply += e.text
      const now = Date.now()
      if (now - state.lastStreamEmit > 300) {
        state.lastStreamEmit = now
        emit({ type: 'agent-write', path: AGENT_WORKBENCH, content: state.reply, done: false })
      }
      return
    }
    if (e.type === 'tool-start') {
      const fp = String(e.input?.file_path || '')
      const rel = fp && ZCODE_WRITE_TOOLS.has(e.name) ? relFromVault(fp) : null
      if (rel && /\.md$/i.test(rel)) {
        state.pendingFiles.set(e.callId, rel)
        if (typeof e.input?.content === 'string') {
          // Write：参数里带全文，先流式预览
          currentRun?.writeActivity?.set(rel, Date.now())
          emit({ type: 'agent-write', path: rel, content: e.input.content, done: false })
          emit({ type: 'agent-status', stage: 'writing', path: rel, message: '正在写入 ' + rel })
          return
        }
      }
      runDetail.addTool(e.name, summarizeToolInput(e.name, e.input || {}))
          emit({ type: 'agent-status', stage: 'tool', tool: e.name || 'tool', message: 'ZCode 调用工具 ' + (e.name || '…') })
      return
    }
    if (e.type === 'tool-end') {
      const rel = state.pendingFiles.get(e.callId)
      state.pendingFiles.delete(e.callId)
      if (rel && e.ok !== false && !abort.signal.aborted) {
        try {
          const content = vault.readFile(rel)
          currentRun?.writeActivity?.set(rel, Date.now())
          emit({ type: 'agent-write', path: rel, content, done: true })
          emit({ type: 'agent-status', stage: 'written', path: rel, message: '已写入 ' + rel })
        } catch {
          /* 文件可能被删除 */
        }
      }
      return
    }
    if (e.type === 'turn-end' && e.response && e.response.trim()) {
      state.reply = e.response // 以回合完整回复为准（覆盖增量累积）
      emit({ type: 'agent-write', path: AGENT_WORKBENCH, content: state.reply, done: false })
    }
  }

  try {
    emit({ type: 'agent-status', stage: 'thinking', message: 'ZCode 引擎启动中…' })
    ensureZcodeMcp() // 桥接工具（ask_user / search_knowledge）挂载配置
    const prompt = buildZcodePrompt({ userMessage, mode, attachments, goalBlock: goalContextBlock(goalId).block })
    const maxTurns = settings.zcodeMaxTurns || 30
    const resume = getZcodeSessionId(sessionId)
    let r
    try {
      r = await runZcodeTurn({ prompt, cwd: vault.getVaultRoot(), resumeSessionId: resume, signal: abort.signal, maxTurns, onEvent })
    } catch (e) {
      if (abort.signal.aborted) throw e
      if (!resume) throw e
      console.warn('[zcode] 续会话失败，改用新会话重试：', e?.message || e)
      emit({ type: 'agent-status', stage: 'thinking', message: 'ZCode 会话已失效，重新开始…' })
      r = await runZcodeTurn({ prompt, cwd: vault.getVaultRoot(), signal: abort.signal, maxTurns, onEvent })
    }
    if (r.sessionId) setZcodeSessionId(sessionId, r.sessionId)

    const finalText = (r.response || '').trim() || state.reply.trim()
    if (finalText) {
      appendWorkbench(finalText)
      let full = ''
      try {
        full = vault.readFile(AGENT_WORKBENCH)
      } catch {
        full = finalText
      }
      emit({ type: 'agent-write', path: AGENT_WORKBENCH, content: full, done: true })
    }

    // 会话标题 + 保留 API 引擎的既有历史（对话记忆由 ZCode --resume 承担）
    const { messages: hist, summary } = sessions.loadSession(sessionId)
    let title
    const meta = sessions.listSessions().find((s) => s.id === sessionId)
    if (meta && meta.title === '新对话') {
      const cleaned = String(userMessage).replace(/[\uFFFD\u0000-\u001F]/g, '').trim()
      const weird = (cleaned.match(/[\u00C0-\u01FF\u0250-\u036F]/g) || []).length
      const cjk = (cleaned.match(/[\u4E00-\u9FFF]/g) || []).length
      title = weird >= 2 || (!cjk && /\u00C0-\u01FF/.test(cleaned) && cleaned.length > 0) ? undefined : cleaned.slice(0, 20) || undefined
    }
    sessions.saveSession(sessionId, hist, summary, title)
    emit({ type: 'agent-done' })
  } finally {
    currentRun = null
  }
}

/**
 * 运行一轮 agent 对话。
 * @param emit (event: object) => void  SSE 推送回调
 * @param userMessage 用户输入
 * @param mode '教学' | '探索' | '目标' | '写作'
 * @param attachments 写作模式附带的资料路径（vault 相对路径，md/pdf）
 */
export async function runAgent({ emit, userMessage, mode, attachments = [], goalId = '' }) {
  if (currentRun) throw new Error('已有任务在进行中')
  const abort = new AbortController()
  currentRun = { controller: abort, writeActivity: new Map() }
  const runDetail = makeDetailRecorder(emit)
  runDetail.clear()
  const settings = loadSettings()
  if (!settings.apiKey) {
    currentRun = null
    throw new Error('尚未配置 API Key，请点击左下角设置图标填写')
  }

  const sessionId = sessions.ensureActive()
  const loaded = sessions.loadSession(sessionId)
  const history = sanitizeHistory(loaded.messages) // 修复旧版本压缩切坏的残缺组
  const summary = loaded.summary

  const attachBlock = buildAttachBlock(attachments)
  const userEntry = {
    role: 'user',
    content: `【模式：${MODES.includes(mode) ? mode : '教学'}】${userMessage}${attachBlock}`,
  }
  // ── 路由 Agent：快问直答，学习任务交管理 Agent ──
  const safeMode = MODES.includes(mode) ? mode : '教学'
  emit({ type: 'agent-status', stage: 'thinking', message: '路由中…' })
  let route = 'manage'
  try {
    const txt = await chatOnce(buildRouterMessages(userMessage, safeMode), { temperature: 0, maxTokens: 60 })
    // 模型可能输出转义包裹的 JSON，直接关键词匹配最稳
    if (/direct/.test(txt)) route = 'direct'
    else if (/manage/.test(txt)) route = 'manage'
  } catch {
    /* 路由失败默认 manage */
  }

  let messages
  if (route === 'direct') {
    messages = buildDirectMessages(userMessage, safeMode)
  } else {
    messages = [
      {
        role: 'system',
        content: buildManagerSystem({
          vaultPath: vault.getVaultRoot(),
          graphSummary: graphSummary(),
          memoryNote: readMemoryNote(),
          planNote: readPlanNote(),
          sessionSummary: summary,
          turnCount: history.filter((m) => m.role === 'user').length + 1,
          mode: safeMode,
          goalBlock: goalContextBlock(goalId).block,
        }),
      },
      ...history,
      userEntry,
    ]
  }
  try {
    emit({ type: 'agent-status', stage: 'thinking', message: '正在思考…' })
    let wroteAny = false
    let finalText = ''
    const runUploads = [] // 本次运行中用户上传的文件（内容预览），后续提问自动附带展示

    if (route === 'direct') {
      // 快问直答：无工具流式回答，结尾由工作台兜底落档
      emit({ type: 'agent-status', stage: 'thinking', message: '快速回答…' })
      for await (const { delta } of streamChat({ messages, signal: abort.signal, tools: [] })) {
        if (delta.content) finalText += delta.content
      }
    } else {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      emit({ type: 'agent-status', stage: 'thinking', message: '管理 Agent 规划与委派中…' })
      const assistant = { role: 'assistant', content: '', tool_calls: [] }
      const callAcc = new Map() // index -> {id, name, args}
      let lastStreamEmit = 0
      let lastContent = ''
      let lastEmittedPath = ''
      let finishReason = null

      // 空回合重试：免费模型偶尔返回空流（只有 reasoning 或被截断）
      let emptyRetries = 0
      while (true) {
        emit({ type: 'agent-status', stage: 'thinking', message: '正在思考与生成…' })
        for await (const { delta, finishReason: fr } of streamChat({ messages, signal: abort.signal })) {
          finishReason = fr
          if (delta.content) {
            assistant.content += delta.content
          }
          // 思考模式（DeepSeek 等）：reasoning_content 必须累积并在下一轮回传，
          // 否则带 tool_calls 的 assistant 消息回传时服务端返回 400
          const reasoning = delta.reasoning_content ?? delta.reasoning
          if (reasoning) {
            assistant.reasoning_content = (assistant.reasoning_content || '') + reasoning
            runDetail?.addThought(reasoning)
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const i = tc.index ?? 0
              if (!callAcc.has(i)) {
                callAcc.set(i, { id: tc.id || '', name: '', args: '' })
              }
              const acc = callAcc.get(i)
              if (tc.id) acc.id = tc.id
              if (tc.function?.name) acc.name += tc.function.name
              if (tc.function?.arguments) acc.args += tc.function.arguments
              // write_note 流式：路径确定后立刻通知前端开始展示
              if (acc.name === 'write_note') {
                const now = Date.now()
                const full = safeParse(acc.args)
                const partial = full ?? extractPartialArgs(acc.args)
                if (partial.path && now - lastStreamEmit > 250) {
                  lastStreamEmit = now
                  const content = full ? full.content : (partial.content ?? '')
                  if (content !== lastContent || partial.path !== lastEmittedPath) {
                    lastContent = content
                    lastEmittedPath = partial.path
                    currentRun.writeActivity.set(partial.path, Date.now())
                    emit({
                      type: 'agent-write',
                      path: partial.path,
                      content,
                      done: false,
                    })
                  }
                }
                if (!assistant._writingNoted) {
                  assistant._writingNoted = true
                  emit({ type: 'agent-status', stage: 'writing', path: partial.path, message: '正在写入 ' + partial.path })
                }
              }
            }
          }
        }
        const hasCalls = callAcc.size > 0
        console.log(
          `[agent] round ${round} finish=${finishReason} text=${assistant.content.length}ch tools=${[...callAcc.values()].map((c) => c.name).join(',') || '-'}`,
        )
        if (hasCalls || assistant.content.trim() || emptyRetries >= 2) break
        emptyRetries++
        console.log('[agent] 空回合，重试', emptyRetries)
        emit({ type: 'agent-status', stage: 'thinking', message: '模型返回为空，重试中…' })
      }

      const toolCalls = [...callAcc.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => ({ id: v.id, name: v.name, args: v.args }))

      if (toolCalls.length > 0) {
        assistant.tool_calls = toolCalls.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: t.args },
        }))
        const assistantEntry = {
          role: 'assistant',
          content: assistant.content || null,
          tool_calls: assistant.tool_calls,
        }
        // 思考模式要求把上轮 reasoning_content 原样回传
        if (assistant.reasoning_content) assistantEntry.reasoning_content = assistant.reasoning_content
        messages.push(assistantEntry)
        for (const tc of toolCalls) {
          emit({
            type: 'agent-status',
            stage: 'tool',
            tool: tc.name,
            message: tc.name === 'ask_user' ? '等待你的回答…' : '调用工具 ' + tc.name,
          })
          const args = safeParse(tc.args) ?? {}
          runDetail?.addTool(tc.name, summarizeToolInput(tc.name, args))

          if (tc.name === 'ask_user') {
            // 结构化提问：挂起等用户作答（卡片/停止/自定义回答共用逻辑见 suspendForQuestion）
            try {
              const answer = await suspendForQuestion({
                emit,
                args,
                signal: abort.signal,
                // 自动附带本轮用户上传过的文件内容，保证用户能看到被讨论的代码
                contextFiles: runUploads.map((u) => ({ path: u.path, name: u.name, content: u.content })),
              })
              // 记录本轮上传的文件（含内容预览），供后续提问展示
              if (answer && Array.isArray(answer.files)) {
                for (const f of answer.files) {
                  runUploads.push({ path: f.path, name: f.name, content: f.preview?.content ?? '' })
                }
              }
              messages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: JSON.stringify(answer),
              })
              continue
            } catch (e) {
              console.error('[agent] ask_user 分支异常', e)
              messages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: JSON.stringify({ error: String(e?.message || e) }),
              })
            }
          }

          const result = await executeTool(tc.name, args, {
            onWrite: (rel, content) => {
              currentRun?.writeActivity?.set(rel, Date.now())
              wroteAny = true
              emit({ type: 'agent-write', path: rel, content, done: true })
              emit({ type: 'agent-status', stage: 'written', path: rel, message: '已写入 ' + rel })
            },
            delegate: async (p) => {
              emit({ type: 'agent-status', stage: 'tool', message: subAgentLabel(p.role) + ' 工作中：' + String(p.task || '').slice(0, 40) })
              const r = await runSubAgent({
                role: p.role,
                task: p.task,
                context: p.context || '',
                emit,
                signal: abort.signal,
                streamChat,
                executeTool,
                hooks: {
                  onWrite: (rel, content) => {
                    currentRun?.writeActivity?.set(rel, Date.now())
                    wroteAny = true
                    emit({ type: 'agent-write', path: rel, content, done: true })
                    emit({ type: 'agent-status', stage: 'written', path: rel, message: '已写入 ' + rel })
                  },
                },
              })
              emit({ type: 'agent-status', stage: 'tool', message: subAgentLabel(p.role) + ' 完成' })
              return r.result
            },
          })
          messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
        }
        continue // 继续下一轮，让模型看到工具结果
      }

      // 没有工具调用 → 本轮结束
      finalText = assistant.content
      break
    }

    }
    // 兜底：模型输出了纯文字但没写任何文件 → 自动落到工作台
    if (!wroteAny && finalText && finalText.trim()) {
      appendWorkbench(finalText.trim())
      emit({ type: 'agent-write', path: AGENT_WORKBENCH, done: true })
    }

    // 持久化：当前会话（旧轮次工具结果瘦身）
    const newMessages = messages.filter((m) => m.role !== 'system')
    let toSave = slimHistory(newMessages, history.length)
    let title
    const firstUser = toSave.find((m) => m.role === 'user')
    const meta = sessions.listSessions().find((s) => s.id === sessionId)
    if (meta && meta.title === '新对话' && firstUser) {
      // 去掉模式前缀与乱码字符；GBK 误码会产生大量生僻拉丁字母，一并视为乱码回退
      const cleaned = String(firstUser.content)
        .replace(/^【模式：.+?】/, '')
        .replace(/[\uFFFD\u0000-\u001F]/g, '')
        .trim()
      const weird = (cleaned.match(/[\u00C0-\u01FF\u0250-\u036F]/g) || []).length
      const cjk = (cleaned.match(/[\u4E00-\u9FFF]/g) || []).length
      title = weird >= 2 || (!cjk && /\u00C0-\u01FF/.test(cleaned) && cleaned.length > 0) ? undefined : cleaned.slice(0, 20) || undefined
    }
    // 滚动压缩
    let summaryNow = summary
    try {
      const r = await compactIfNeeded(toSave, summaryNow, emit)
      toSave = r.messages
      summaryNow = r.summary
    } catch {
      /* 压缩失败不影响保存 */
    }
    sessions.saveSession(sessionId, toSave, summaryNow, title)
    emit({ type: 'agent-done' })
  } finally {
    currentRun = null
    cancelPendingQuestion()
  }
}

/** 测试 AI 服务连通性 */
export async function testConnection() {
  const { base, apiKey, model } = apiConfig()
  if (!apiKey) throw new Error('请先填写 API Key')
  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: '回复"OK"两个字母即可' }],
      max_tokens: 8,
      stream: false,
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`服务返回 ${res.status}：${detail.slice(0, 200)}`)
  }
  const json = await res.json()
  return { ok: true, reply: json.choices?.[0]?.message?.content ?? '' }
}
