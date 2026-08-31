// mermaid 渲染失败自动修复：前端检测到某段 mermaid 语法错误后上报，
// 这里只把坏掉的那一段代码块交给 LLM 修正，并精确替换文件中的该块——
// 不重写整篇笔记。带防抖 / 频率限制 / agent 流式写入守卫，避免循环修复。
import * as vault from '../vault.js'
import { isPathStreaming, chatOnce } from './runner.js'

const WINDOW_MS = 5 * 60 * 1000
const MAX_ATTEMPTS = 3 // 每篇笔记每 5 分钟最多自动修 3 次
const DEBOUNCE_MS = 3000

const attempts = new Map() // path -> { count, resetAt }
const lastReport = new Map() // path -> ts

const SYSTEM = `你是 Mermaid 语法修复器。用户会给你一段渲染失败的 mermaid 代码和渲染错误信息。
只输出修复后的完整 mermaid 代码本身：不带 \`\`\` 围栏、不带任何解释、前后缀或注释说明。
保持图表类型、节点与连接的语义、文字内容完全不变，仅修正语法问题（括号/引号配对、箭头写法、
关键字拼写、非法字符、节点 id 非法、缺少 end 等）。若错误信息提示不支持的功能，改写为等价的受支持语法。`

function allow(path) {
  const now = Date.now()
  let rec = attempts.get(path)
  if (!rec || now > rec.resetAt) {
    rec = { count: 0, resetAt: now + WINDOW_MS }
    attempts.set(path, rec)
  }
  return rec.count < MAX_ATTEMPTS
}

function stripFences(s) {
  let t = String(s ?? '').trim()
  t = t.replace(/^```[a-zA-Z]*[ \t]*\r?\n?/, '').replace(/\r?\n?```[ \t]*$/, '')
  return t.trim()
}

export async function reportMermaidFailure({ path, code, error }) {
  try {
    if (typeof path !== 'string' || !/\.md$/i.test(path)) return { ok: false, reason: 'invalid path' }
    if (typeof code !== 'string' || !code.trim()) return { ok: false, reason: 'empty code' }
    if (isPathStreaming(path)) return { ok: false, reason: 'agent 正在写入该笔记，跳过' }

    const now = Date.now()
    if (now - (lastReport.get(path) ?? 0) < DEBOUNCE_MS) return { ok: false, reason: 'debounce' }
    if (!allow(path)) return { ok: false, reason: 'rate limit' }
    lastReport.set(path, now)

    // 在文件里定位这段代码块（以围栏块整体匹配）
    const content = vault.readFile(path)
    let fence = '```mermaid\n' + code + '\n```'
    let idx = content.indexOf(fence)
    if (idx < 0) {
      fence = fence.replace(/\n/g, '\r\n')
      idx = content.indexOf(fence)
    }
    if (idx < 0) return { ok: false, reason: 'block not found（笔记内容可能已变化）' }

    const fixedRaw = await chatOnce(
      [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `Mermaid 渲染错误信息：\n${String(error || '（无详细信息）').slice(0, 600)}\n\n当前代码：\n${code}`,
        },
      ],
      { temperature: 0, maxTokens: 3000 },
    )
    const fixed = stripFences(fixedRaw)
    if (!fixed) return { ok: false, reason: '模型未返回内容' }
    if (fixed.replace(/\s+/g, ' ') === code.replace(/\s+/g, ' ')) {
      return { ok: false, reason: '模型未能给出不同修复' }
    }

    const updated = content.slice(0, idx) + '```mermaid\n' + fixed + '\n```' + content.slice(idx + fence.length)
    vault.writeFile(path, updated)
    vault.notifyWrite(path, 'change')
    console.log(`[mermaid-fix] 已修复 ${path} 中的一段 mermaid（${code.length} → ${fixed.length} 字符）`)
    return { ok: true }
  } catch (e) {
    console.error('[mermaid-fix] 修复失败:', e?.message || e)
    return { ok: false, reason: String(e?.message || e) }
  }
}
