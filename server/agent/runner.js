import fs from 'node:fs'
import path from 'node:path'
import { loadSettings } from '../settings.js'
import * as vault from '../vault.js'
import { graphSummary } from '../graph.js'
import { buildSystemPrompt, AGENT_WORKBENCH, MEMORY_NOTE, PLAN_NOTE } from './prompt.js'
import { toolDefs, executeTool } from './tools.js'
import * as sessions from './sessions.js'

const MAX_TOOL_ROUNDS = 30
const COMPACTION_THRESHOLD = 60 // 消息数超过该值触发压缩
const COMPACTION_KEEP = 24 // 压缩时保留最近的消息数
const MODES = ['教学', '探索', '目标']

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

export async function* streamChat({ messages, signal }) {  const { base, apiKey, model } = apiConfig()
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
      tools: toolDefs,
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
    throw new Error(`AI 服务返回 ${res.status}：${detail}`)
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
        if (delta) yield { delta, finishReason: json.choices?.[0]?.finish_reason }
      } catch {
        /* 忽略无法解析的心跳/注释行 */
      }
    }
  }
}

/** 非流式单次调用（用于历史压缩等辅助任务） */
async function chatOnce(messages) {
  const { base, apiKey, model } = apiConfig()
  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({ model, messages, stream: false, temperature: 0.3, max_tokens: 800 }),
  })
  if (!res.ok) throw new Error('压缩调用失败 ' + res.status)
  const json = await res.json()
  return json.choices?.[0]?.message?.content ?? ''
}

// ── 滚动压缩 ────────────────────────────────────────────────────────────────

async function compactIfNeeded(messages, summary, emit) {
  if (messages.length <= COMPACTION_THRESHOLD) return { messages, summary }
  const cut = messages.length - COMPACTION_KEEP
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

let currentRun = null // { controller: AbortController }

export function stopAgent() {
  cancelPendingQuestion()
  if (currentRun) currentRun.controller.abort()
}

export function isRunning() {
  return Boolean(currentRun)
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

/**
 * 运行一轮 agent 对话。
 * @param emit (event: object) => void  SSE 推送回调
 * @param userMessage 用户输入
 * @param mode '教学' | '探索' | '目标'
 */
export async function runAgent({ emit, userMessage, mode }) {
  if (currentRun) throw new Error('已有任务在进行中')
  const abort = new AbortController()
  currentRun = { controller: abort }
  const settings = loadSettings()
  if (!settings.apiKey) {
    currentRun = null
    throw new Error('尚未配置 API Key，请点击左下角设置图标填写')
  }

  const sessionId = sessions.ensureActive()
  const { messages: history, summary } = sessions.loadSession(sessionId)

  const userEntry = {
    role: 'user',
    content: `【模式：${MODES.includes(mode) ? mode : '教学'}】${userMessage}`,
  }
  const messages = [
    {
      role: 'system',
      content: buildSystemPrompt({
        vaultPath: vault.getVaultRoot(),
        graphSummary: graphSummary(),
        memoryNote: readMemoryNote(),
        planNote: readPlanNote(),
        sessionSummary: summary,
        turnCount: history.filter((m) => m.role === 'user').length + 1,
      }),
    },
    ...history,
    userEntry,
  ]

  try {
    emit({ type: 'agent-status', stage: 'thinking', message: '正在思考…' })
    let wroteAny = false
    let finalText = ''
    const runUploads = [] // 本次运行中用户上传的文件（内容预览），后续提问自动附带展示

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const assistant = { role: 'assistant', content: '', tool_calls: [] }
      const callAcc = new Map() // index -> {id, name, args}
      let lastStreamEmit = 0
      let lastContent = ''
      let lastEmittedPath = ''
      let finishReason = null

      // 空回合重试：免费模型偶尔返回空流（只有 reasoning 或被截断）
      let emptyRetries = 0
      while (true) {
        for await (const { delta, finishReason: fr } of streamChat({ messages, signal: abort.signal })) {
          finishReason = fr
          if (delta.content) {
            assistant.content += delta.content
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
        messages.push({
          role: 'assistant',
          content: assistant.content || null,
          tool_calls: assistant.tool_calls,
        })
        for (const tc of toolCalls) {
          emit({
            type: 'agent-status',
            stage: 'tool',
            tool: tc.name,
            message: tc.name === 'ask_user' ? '等待你的回答…' : '调用工具 ' + tc.name,
          })
          const args = safeParse(tc.args) ?? {}

          if (tc.name === 'ask_user') {
            // 结构化提问：挂起等用户作答
            try {
              console.log('[agent] ask_user 分支进入, args:', JSON.stringify(args).slice(0, 200))
              let qType = ['single', 'multi', 'judge', 'text', 'file'].includes(args.type) ? args.type : 'text'
              let options = Array.isArray(args.options)
                ? args.options
                    .map((o) =>
                      typeof o === 'string'
                        ? o
                        : String(o?.label ?? o?.text ?? o?.value ?? JSON.stringify(o)),
                    )
                    .filter(Boolean)
                    .slice(0, 8)
                : []
              if ((qType === 'single' || qType === 'multi') && options.length < 2) {
                qType = 'text' // 兜底：没有选项降级为简答
                options = []
              }
              const id = 'q-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
              const question = String(args.question ?? '').slice(0, 2000)
              console.log('[agent] ask_user 准备挂起', id, qType)
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
                  // 自动附带本轮用户上传过的文件内容，保证用户能看到被讨论的代码
                  contextFiles: runUploads.map((u) => ({ path: u.path, name: u.name, content: u.content })),
                }
                pendingQuestion = { id, resolve, event: questionEvent }
                const onAbort = () => {
                  if (pendingQuestion?.id === id) {
                    pendingQuestion = null
                    resolve({ cancelled: true })
                  }
                }
                abort.signal.addEventListener('abort', onAbort, { once: true })
                emit(questionEvent)
              })
              console.log('[agent] ask_user 收到回答:', JSON.stringify(answer).slice(0, 100))
              // 记录本轮上传的文件（含内容预览），供后续提问展示
              if (answer && Array.isArray(answer.files)) {
                for (const f of answer.files) {
                  runUploads.push({ path: f.path, name: f.name, content: f.preview?.content ?? '' })
                }
              }
            appendWorkbench(`**问**：${question}\n\n**答**：${formatAnswer(answer)}`)
            emit({ type: 'agent-question-closed', id })
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
              wroteAny = true
              emit({ type: 'agent-write', path: rel, content, done: true })
              emit({ type: 'agent-status', stage: 'written', path: rel, message: '已写入 ' + rel })
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
