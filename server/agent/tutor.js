// 笔记答疑助手：独立于主 agent 的运行循环，会话绑定笔记文件
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { streamChat } from './runner.js'
import { buildTutorPrompt, TUTOR_ROLES } from './tutorPrompts.js'
import { executeTool } from './tools.js'
import * as vault from '../vault.js'
import { graphSummary } from '../graph.js'

const MAX_TOOL_ROUNDS = 8
const HISTORY_MESSAGES = 30 // 保留最近 30 条消息（15 轮对话）

let tutorRun = null // { controller, notePath }

export function stopTutor() {
  if (tutorRun) tutorRun.controller.abort()
}

export function isTutorRunning() {
  return Boolean(tutorRun)
}

// ── 会话存储（按笔记路径绑定） ───────────────────────────────────────────────

function sessionFile(notePath) {
  const hash = crypto.createHash('md5').update(notePath).digest('hex')
  const dir = vault.resolveInVault('.agent/tutor')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, hash + '.json')
}

export function loadTutorSession(notePath) {
  try {
    const arr = JSON.parse(fs.readFileSync(sessionFile(notePath), 'utf8'))
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function saveTutorSession(notePath, messages) {
  fs.writeFileSync(sessionFile(notePath), JSON.stringify(messages.slice(-HISTORY_MESSAGES), null, 1), 'utf8')
}

export function clearTutorSession(notePath) {
  try {
    fs.rmSync(sessionFile(notePath), { force: true })
  } catch {
    /* ignore */
  }
  return { ok: true }
}

// ── 运行循环 ────────────────────────────────────────────────────────────────

function safeParse(s) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

export async function runTutor({ emit, notePath, role, message }) {
  if (tutorRun) throw new Error('答疑助手正在回复中')
  if (!TUTOR_ROLES[role]) throw new Error('未知角色：' + role)
  const noteContent = vault.readFile(notePath) // 不存在会抛错
  const noteTitle = path.basename(notePath).replace(/\.md$/i, '')

  const controller = new AbortController()
  tutorRun = { controller, notePath }
  const history = loadTutorSession(notePath)

  const messages = [
    {
      role: 'system',
      content: buildTutorPrompt({
        role,
        notePath,
        noteTitle,
        noteContent,
        graphSummary: graphSummary(),
      }),
    },
    ...history,
    { role: 'user', content: message },
  ]

  try {
    emit({ type: 'tutor-status', path: notePath, message: '思考中…' })

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const assistant = { role: 'assistant', content: '' }
      const callAcc = new Map()

      for await (const { delta, finishReason } of streamChat({ messages, signal: controller.signal })) {
        if (finishReason) break
        if (delta.content) {
          assistant.content += delta.content
          // 纯文本流式（工具调用阶段内容为空，不会误推）
          if (callAcc.size === 0) emit({ type: 'tutor-delta', path: notePath, text: delta.content })
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
        // 有工具调用：已流出的正文要作废（模型改用工具），从对话中移除已推送文本
        assistant.content = ''
        assistant.tool_calls = toolCalls.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: t.args },
        }))
        messages.push(assistant)
        emit({ type: 'tutor-delta', path: notePath, reset: true })
        for (const tc of toolCalls) {
          emit({
            type: 'tutor-status',
            path: notePath,
            message: tc.name === 'write_note' ? '正在补充笔记…' : '查阅资料中…',
          })
          const args = safeParse(tc.args) ?? {}
          const result = await executeTool(tc.name, args, {
            onWrite: (rel) => {
              emit({ type: 'tutor-delta', path: notePath, noteUpdated: rel })
            },
          })
          messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
        }
        continue
      }

      // 纯文本回复 → 本轮结束
      if (!assistant.content.trim()) {
        // 空回复保护
        assistant.content = '（我一时没组织好回复，请再问一次）'
        messages.push(assistant)
        emit({ type: 'tutor-delta', path: notePath, text: assistant.content })
      } else {
        messages.push(assistant)
      }
      break
    }

    // 持久化对话：只存 user/assistant 的有效文本（tool 结果与工具调用轮次不进会话，
    // 否则刷新后 read_note 的整篇笔记内容会被面板当成助手消息渲染）
    const chat = messages
      .filter(
        (m) =>
          (m.role === 'user' || m.role === 'assistant') &&
          typeof m.content === 'string' &&
          m.content.trim().length > 0,
      )
      .map((m) => ({ role: m.role, content: m.content }))
    saveTutorSession(notePath, chat)
    emit({ type: 'tutor-done', path: notePath })
  } finally {
    tutorRun = null
  }
}
