// mermaid 渲染失败自动修复 / 手动 AI 重写：前端上报后，只把坏掉的那一段
// 代码块交给 LLM 修正，并精确替换文件中的该块——不重写整篇笔记。
// 带防抖 / 频率限制 / agent 写入避让；force=true（手动按钮）绕过防抖与限流。
// 支持传入失败尝试历史（attempts），让模型避开已失败的写法。
import * as vault from '../vault.js'
import { isPathStreaming, isRunning, chatOnce } from './runner.js'

const FENCE_OPEN = '```mermaid\n'
const FENCE_CLOSE = '\n```'
const BT3 = '```'

const WINDOW_MS = 5 * 60 * 1000
const MAX_ATTEMPTS = 3 // 每篇笔记每 5 分钟最多自动修 3 次（手动触发不受限）
const DEBOUNCE_MS = 3000

const attempts = new Map() // path -> { count, resetAt }
const lastReport = new Map() // path -> ts

const SYSTEM = [
  '你是 Mermaid 语法修复器。用户会给你一段渲染失败（或渲染异常）的 mermaid 代码和渲染错误信息。',
  '只输出修复后的完整 mermaid 代码本身：不带 ' + BT3 + ' 围栏、不带任何解释、前后缀或注释说明。',
  '保持图表类型、节点与连接的语义、展示文字不变，仅修正语法。',
  '',
  '常见错误模式（必须规避）：',
  '- 「Note over A,B:文字」「participant」「autonumber」「activate」是时序图（sequenceDiagram）专属语法，在 flowchart/graph 中必然解析失败——用普通节点或边标签表达同样的注释内容',
  '- 节点文字含 ()、[]、{}、:、引号等特殊字符时，必须用双引号包裹整段文字（如 A["文字(含括号)"]）',
  '- flowchart 中节点 id 不能用小写 end；subgraph 必须以 end 结束',
  '- 各图类型（flowchart/sequenceDiagram/classDiagram/mindmap/pie...）语法互不通用：先看代码第一行确认图表类型，再按该类型的语法修复',
  '- 若提供了「失败尝试记录」，其中每种写法都已被证明报错，禁止原样重复；可在展示文字不变的前提下调整结构（换节点 id、加引号、拆分标签、改用注释节点）',
  '输出前在脑中按该图类型的语法自检一遍。',
].join('\n')

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

export async function reportMermaidFailure({ path, code, error, force = false, attempts: failedAttempts = [] }) {
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

    // 组装用户提示词：错误信息 + 当前代码 + 失败尝试历史
    let userContent =
      'Mermaid 渲染错误信息：\n' +
      String(error || '（无详细信息）').slice(0, 600) +
      '\n\n当前代码：\n' +
      code
    if (Array.isArray(failedAttempts) && failedAttempts.length) {
      const history = failedAttempts
        .map((a, i) => {
          const t = a ? a.error || '渲染失败' : ''
          const c = a ? a.code || '' : ''
          const n = String.fromCharCode(65 + (i % 26))
          return '尝试' + (i + 1) + '（' + t + '）：\n' + c
        })
        .join('\n\n')
      userContent += '\n\n以下修复尝试均已失败（禁止重复其中被报错的写法）：\n' + history
    }

    const fixedRaw = await chatOnce(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userContent },
      ],
      { temperature: 0, maxTokens: 3000 },
    )
    const fixed = stripFences(fixedRaw)
    if (!fixed) return { ok: false, reason: '模型未返回内容' }
    if (fixed.replace(/\s+/g, ' ') === code.replace(/\s+/g, ' ')) {
      return { ok: false, reason: '模型未能给出不同修复' }
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
