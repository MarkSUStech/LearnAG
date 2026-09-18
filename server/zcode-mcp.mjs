// LearnAgent MCP 桥接（stdio server）：把「向用户提问」与「知识库语义检索」暴露给
// ZCode 引擎。ZCode 经 vault 根的 .mcp.json 挂载本进程（协议：换行分隔 JSON-RPC 2.0），
// 工具调用通过 HTTP 回调 LearnAgent 主服务（127.0.0.1:$LEARN_AGENT_PORT）：
// - ask_user       → POST /internal/zcode/ask   ：挂起等待用户在提问卡片作答
// - search_knowledge → POST /internal/zcode/search ：本地 RAG 检索
// 主服务不可达时返回错误文本，由模型自行降级（改用文件检索/按假设继续）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = String(process.env.LEARN_AGENT_PORT || '3001')
const BASE = `http://127.0.0.1:${PORT}`

const ASK_TIMEOUT_MS = 6 * 60 * 1000 // 用户 6 分钟未作答则超时返回，避免回合卡死
const SEARCH_TIMEOUT_MS = 60 * 1000

const TOOLS = [
  {
    name: 'ask_user',
    description:
      '向用户提出结构化问题并等待回答，用户会在 LearnAgent 界面的提问卡片里作答（所有题型都自带「自定义回答」入口，用户可能用自由文本回答——按其内容严肃判定）。' +
      '适用场景：摸底测评（一道一问，type=text 简答或 judge 判断）、判断题确认（judge）、候选/路径选择（single）、多选（multi）。' +
      '提问时任务会暂停，直到用户作答（answer.value 即回答；用户可能跳过/取消）。每次只提一个问题。' +
      '注意：问题涉及用户看不到的内容时，必须把相关内容放进 code 参数展示给用户。',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '问题本身（展示给用户的完整题面）' },
        type: { type: 'string', enum: ['single', 'multi', 'judge', 'text'], description: '题型' },
        options: { type: 'array', items: { type: 'string' }, description: 'single/multi 的选项列表（2~6 个，每个尽量短）；judge 不需要' },
        allowCustom: { type: 'boolean', description: '是否允许自定义输入，默认允许' },
        code: { type: 'string', description: '可选。随问题一起展示的代码或内容原文（≤4000 字符）' },
      },
      required: ['question', 'type'],
    },
  },
  {
    name: 'search_knowledge',
    description:
      '语义检索用户的知识库（本地 RAG，中英双语 embedding）：覆盖全部笔记、PDF 教材/论文文本、以及用户在 PDF 学习器里的标注与卡片。' +
      '写笔记/讲解前先用它定位用户已有知识与资料，返回最相关片段（来源路径/页码/相关度/文本）。需要完整上下文时再用 Read 读取对应文件。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索查询（中英文皆可，描述要找的内容）' },
        max_results: { type: 'number', description: '返回条数，默认 6，最多 12' },
      },
      required: ['query'],
    },
  },
]

function post(pathName, body, timeoutMs) {
  return fetch(BASE + pathName, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(timeoutMs),
  })
}

async function callTool(name, args) {
  if (name === 'ask_user') {
    if (!args || typeof args.question !== 'string' || !args.question.trim()) {
      return { isError: true, text: '缺少 question' }
    }
    const res = await post('/internal/zcode/ask', args, ASK_TIMEOUT_MS).catch((e) => {
      if (e?.name === 'TimeoutError') return { ok: false, timeout: true }
      return null
    })
    if (res && res.timeout) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ timeout: true, note: '用户长时间未作答。请按最合理假设继续推进，或在后续再用更简单的方式确认。' }),
          },
        ],
      }
    }
    if (!res || !res.ok) {
      const detail = res && !res.ok ? ` HTTP ${res.status}` : ''
      return { isError: true, content: [{ type: 'text', text: `LearnAgent 服务不可用（${detail}），无法向用户提问；请改为按最合理假设继续。` }] }
    }
    const answer = await res.json().catch(() => ({}))
    return { content: [{ type: 'text', text: JSON.stringify(answer) }] }
  }
  if (name === 'search_knowledge') {
    const res = await post('/internal/zcode/search', args, SEARCH_TIMEOUT_MS).catch(() => null)
    if (!res || !res.ok) {
      return { isError: true, content: [{ type: 'text', text: '知识库检索服务不可用；请改用 Glob/Grep 直接检索文件。' }] }
    }
    const r = await res.json().catch(() => ({}))
    return { content: [{ type: 'text', text: JSON.stringify(r) }] }
  }
  return { isError: true, content: [{ type: 'text', text: '未知工具：' + name }] }
}

function reply(id, result) {
  if (id === undefined || id === null) return // 通知不回复
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function replyError(id, code, message) {
  if (id === undefined || id === null) return
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
}

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let idx
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim()
    buf = buf.slice(idx + 1)
    if (line) void handleLine(line)
  }
})
process.stdin.on('end', () => process.exit(0))

async function handleLine(line) {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  const { id, method, params } = msg
  try {
    switch (method) {
      case 'initialize':
        reply(id, {
          protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-04-04',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'learnagent', version: '1.0.0' },
        })
        return
      case 'ping':
        reply(id, {})
        return
      case 'tools/list':
        reply(id, { tools: TOOLS })
        return
      case 'tools/call': {
        const name = String(params?.name || '')
        const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {}
        const r = await callTool(name, args)
        reply(id, { content: r.content ?? [{ type: 'text', text: r.text ?? '' }], ...(r.isError ? { isError: true } : {}) })
        return
      }
      default:
        if (id !== undefined && id !== null) replyError(id, -32601, 'Method not found: ' + method)
      // 通知（notifications/*）静默忽略
    }
  } catch (e) {
    console.error('[zcode-mcp] 处理失败:', e?.message || e)
    if (id !== undefined && id !== null) replyError(id, -32603, String(e?.message || e))
  }
}
