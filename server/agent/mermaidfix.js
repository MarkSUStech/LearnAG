// mermaid 渲染失败自动修复 / 手动 AI 重写：前端上报后，只把坏掉的那一段
// 代码块交给 LLM 修正，并精确替换文件中的该块——不重写整篇笔记。
// 带防抖 / 频率限制 / agent 写入避让；force=true（手动按钮）绕过防抖与限流。
import * as vault from '../vault.js'
import { isPathStreaming, isRunning, chatOnce } from './runner.js'

const FENCE_OPEN = '```mermaid\n'
const FENCE_CLOSE = '\n```'

const WINDOW_MS = 5 * 60 * 1000
const MAX_ATTEMPTS = 3 // 每篇笔记每 5 分钟最多自动修 3 次（手动触发不受限）
const DEBOUNCE_MS = 3000

const attempts = new Map() // path -> { count, resetAt }
const lastReport = new Map() // path -> ts

const SYSTEM = `你是 Mermaid 语法修复器。用户会给你一段渲染失败（或渲染异常）的 mermaid 代码和错误信息。
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

export async function reportMermaidFailure({ path, code, error, force = false }) {
  try {
    if (typeof path !== 'string' || !/\.md$/i.test(path)) return { ok: false, reason: 'invalid path' }
    if (typeof code !== 'string' || !code.trim()) return { ok: false, reason: 'empty code' }
    if (isPathStreaming(path)) return { ok: false, reason: 'agent 正在写入该笔记，跳过' }
    if (!force && isRunning()) return { ok: false, reason: 'agent 运行中，自动修复暂停' }

    const now = Date.now()
    if (!force) {
      if (now - (lastReport.get(path) ?? 0) < DEBOUNCE_MS) return { ok: false, reason: '请求过于频繁' }
      if (!allow(path)) return { ok: false, reason: '自动修复次数已达上限，请稍后再试' }
    }
    lastReport.set(path, now)

    // 在文件里定位这段代码块（整块匹配；兼容 CRLF 行尾笔记）
    const content = vault.readFile(path)
    let fence = FENCE_OPEN + code + FENCE_CLOSE
    let idx = content.indexOf(fence)
    let crlf = false
    if (idx < 0) {
      fence = fence.replace(/\n/g, '\r\n')
      idx = content.indexOf(fence)
      crlf = idx >= 0
    }
    if (idx < 0) return { ok: false, reason: '原文块未找到（笔记内容可能已变化，请刷新后重试）' }

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
      return { ok: false, reason: '模型未能给出不同修复（图表语法本身没有问题）' }
    }

    // 写回：保持笔记原有行尾风格
    const nl = crlf ? '\r\n' : '\n'
    const newBlock = (FENCE_OPEN + fixed + FENCE_CLOSE).replace(/\n/g, nl)
    const updated = content.slice(0, idx) + newBlock + content.slice(idx + fence.length)
    vault.writeFile(path, updated)
    vault.notifyWrite(path, 'change')
    console.log(`[mermaid-fix] 已修复 ${path} 中的一段 mermaid（${code.length} → ${fixed.length} 字符）`)
    return { ok: true }
  } catch (e) {
    console.error('[mermaid-fix] 修复失败:', e?.message || e)
    return { ok: false, reason: String(e?.message || e) }
  }
}
