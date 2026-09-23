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
  {
    name: 'search_images',
    description:
      '联网搜索真实图片并按图文语义相关度重排（本地 SigLIP 模型）。返回图片列表（标题/原图链接/缩略图/来源页/相关度）。' +
      '为笔记配真实图片（照片/实物/网络示意图）时使用；query 建议用英文。拿到结果后用 download_image 下载选中的图。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '图片检索词，英文效果最佳（对象+图类型，如 "transformer architecture diagram"）' },
        count: { type: 'number', description: '返回条数，默认 6，最多 10' },
      },
      required: ['query'],
    },
  },
  {
    name: 'download_image',
    description:
      '把一张网络图片下载进用户知识库（默认 assets/images/），返回可嵌入笔记的相对路径。' +
      '与 search_images 配合：选中后下载，再用 Write/Edit 在笔记里以 ![](返回的路径) 引用。',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '图片直链（search_images 结果里的 image_url；下载失败可改用缩略图 thumb_url）' },
        path: { type: 'string', description: '保存路径（vault 内相对路径）。默认自动命名到 assets/images/' },
      },
      required: ['url'],
    },
  },
  {
    name: 'extract_pdf_images',
    description:
      '提取用户知识库中一篇 PDF 的全部内嵌图片（教材插图/图表/照片），解码为 PNG 存入 assets/pdf/<PDF名>/ 并返回清单（文件/页码/尺寸）。' +
      '为笔记配教材原图时使用；重复提取直接返回已有清单。嵌入时注明来源 PDF 与页码。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'PDF 在 vault 内的相对路径' },
        min_size: { type: 'number', description: '图片最小边长（像素），默认 200，过滤小图标' },
        force: { type: 'boolean', description: '已提取过时是否强制重新提取' },
      },
      required: ['path'],
    },
  },
  {
    name: 'delegate',
    description:
      '把一项专项工作委派给专职子 Agent（在独立的 ZCode 会话中执行），完成后返回其总结。可选 role：' +
      'research（研究：检索笔记/PDF/知识网络，产出事实结论）、resource（资源：联网找学习资源）、' +
      'content（内容：撰写/修改笔记）、visualize（可视化：配图/图表）、scaffold（把内容产出按用户容易理解的方式重排与改写，并沉淀知识网络）。' +
      '复杂学习任务应拆解并依次委派；委派描述要写清楚目标、素材路径、输出路径。',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['research', 'resource', 'content', 'visualize', 'scaffold'], description: '子 Agent 类型' },
        task: { type: 'string', description: '具体任务：目标、素材路径、输出路径与要求' },
        context: { type: 'string', description: '可选。随任务附带的上下文（研究结果、用户要求原文等）' },
      },
      required: ['role', 'task'],
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
  if (name === 'search_images') {
    const res = await post('/internal/zcode/img-search', args, 120000).catch((e) => (e?.name === 'TimeoutError' ? { ok: false, timeout: true } : null))
    if (res && res.timeout) {
      return { isError: true, content: [{ type: 'text', text: '搜图超时。请放弃联网搜图，改用 mermaid 绘制示意图。' }] }
    }
    if (!res || !res.ok) return { isError: true, content: [{ type: 'text', text: '搜图服务不可用；请改用 mermaid 绘制示意图。' }] }
    const r = await res.json().catch(() => ({}))
    return { content: [{ type: 'text', text: JSON.stringify(r) }] }
  }
  if (name === 'download_image') {
    const res = await post('/internal/zcode/img-download', args, 60000).catch(() => null)
    if (!res || !res.ok) {
      const j = res ? await res.json().catch(() => ({})) : {}
      return { isError: true, content: [{ type: 'text', text: '下载失败：' + (j.error || '服务不可用') + '。可换用结果里的缩略图地址重试，或放弃配图。' }] }
    }
    const r = await res.json().catch(() => ({}))
    return { content: [{ type: 'text', text: JSON.stringify(r) }] }
  }
  if (name === 'extract_pdf_images') {
    const res = await post('/internal/zcode/pdf-images', args, 180000).catch(() => null)
    if (!res || !res.ok) return { isError: true, content: [{ type: 'text', text: 'PDF 图片提取失败；请确认 path 是 vault 内的 PDF，或放弃该方式。' }] }
    const r = await res.json().catch(() => ({}))
    return { content: [{ type: 'text', text: JSON.stringify(r) }] }
  }
  if (name === 'delegate') {
    const res = await post('/internal/zcode/delegate', args, 900000).catch((e) => (e?.name === 'TimeoutError' ? { ok: false, timeout: true } : null))
    if (res && res.timeout) {
      return { isError: true, content: [{ type: 'text', text: '子 Agent 委派超时（15 分钟）。请收回该任务自行完成，或换更小的委派粒度。' }] }
    }
    if (!res || !res.ok) {
      const j = res ? await res.json().catch(() => ({})) : {}
      return { isError: true, content: [{ type: 'text', text: '委派失败：' + (j.error || '服务不可用') + '。请收回该任务自行完成。' }] }
    }
    const r = await res.json().catch(() => ({}))
    return { content: [{ type: 'text', text: JSON.stringify({ result: r.result ?? '' }) }] }
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
