// StudyContext 编码器：把 PDF 文本（行级坐标/阅读顺序）与用户标注、卡片
// 序列化为结构化纯文本，供 tutor 答疑与主 agent 章节提取使用。
// 移植自 pdf-study/server/pdf-context.js（去掉实验台评测部分）。
import * as vault from './vault.js'
import { keyFor, getPdf, getPageData } from './pdfdoc.js'

const TYPE_LABEL = {
  highlight: '荧光',
  underline: '下划线',
  squiggly: '波浪线',
  strikethrough: '删除线',
  'tag-anchor': '标签锚点',
  mask: '遮罩',
  image: '贴图',
}

const PURPOSE_LABEL = { supplement: '补充', explain: '解释', question: '提问', reflect: '自主思考' }

/** 给标注分配稳定短编号：A=文字标注 M=遮罩 T=标签锚点 G=贴图 */
function assignIds(annotations) {
  const sorted = [...annotations].sort(
    (a, b) => a.page - b.page || String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id),
  )
  const counters = { A: 0, M: 0, T: 0, G: 0 }
  const idOf = new Map()
  for (const a of sorted) {
    const prefix = a.type === 'mask' ? 'M' : a.type === 'image' ? 'G' : a.type === 'tag-anchor' ? 'T' : 'A'
    counters[prefix] += 1
    idOf.set(a.id, `${prefix}${counters[prefix]}`)
  }
  return idOf
}

function lineRangeOf(ann, pageLines) {
  if (!ann.quads?.length || !pageLines) return null
  const ys = ann.quads.map((q) => [q.y1, q.y2])
  const top = Math.min(...ys.map((p) => p[0]))
  const bottom = Math.max(...ys.map((p) => p[1]))
  const hit = []
  pageLines.forEach((l, i) => {
    if (l.y >= top - 2 && l.y <= bottom + 3) hit.push(i)
  })
  if (!hit.length) return null
  return hit.length === 1 ? `${hit[0] + 1}` : `${hit[0] + 1}-${hit[hit.length - 1] + 1}`
}

/** 遮罩框遮住的页面文本（几何相交提取，无需 OCR） */
function maskedText(ann, pageLines) {
  if (!pageLines) return ''
  const { x, y, w, h } = ann.rect
  const hit = pageLines.filter((l) => l.y >= y - 3 && l.y <= y + h + 6 && l.x1 > x && l.x0 < x + w)
  return hit.map((l) => l.text).join(' ')
}

/** markdown → 保结构纯文本 */
export function mdToPlainText(md) {
  const out = []
  let inCode = false
  for (const raw of String(md ?? '').split('\n')) {
    let line = raw
    if (/^\s*```/.test(line)) {
      inCode = !inCode
      out.push(inCode ? '[代码]' : '')
      continue
    }
    if (inCode) {
      out.push('  ' + line)
      continue
    }
    line = line
      .replace(/^(\s*)#{1,6}\s+/, '$1')
      .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt) => `[图片${alt ? ':' + alt : ''}]`)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => (url === text || /^#/.test(url) ? text : `${text}(${url})`))
      .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^\s*>\s?/, '')
      .replace(/^(\s*)[-*+]\s+/, '$1• ')
      .replace(/\s+$/, '')
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function range(a, b) {
  const out = []
  for (let i = a; i <= b; i++) out.push(i)
  return out
}

function colorName(hex) {
  const names = { '#fef08a': '黄', '#fde68a': '橙', '#bbf7d0': '绿', '#bfdbfe': '蓝', '#fbcfe8': '粉', '#e9d5ff': '紫' }
  return names[(hex || '').toLowerCase()] ?? hex
}

/**
 * 编码主入口
 * @param opts {relPath, title, annotations, cards}
 * @param enc {strategy:'full'|'pages'|'anchor', from,to, page, radius, maxChars,
 *             lineNumbers, inlineAnchors, annotationIndex, maskedText, includeCards}
 */
export async function buildStudyContext(opts, enc = {}) {
  const {
    strategy = 'full',
    from = 1,
    to,
    page,
    radius = 2,
    lineNumbers = true,
    inlineAnchors = true,
    annotationIndex = true,
    maskedText: showMasked = true,
    includeCards = true,
    maxChars = 24000,
  } = enc

  const abs = vault.resolveInVault(opts.relPath)
  const key = keyFor(opts.relPath)
  const pdf = await getPdf(key, abs)
  const pageCount = pdf.numPages

  let pages = []
  if (strategy === 'pages') {
    pages = range(Math.max(1, from), Math.min(pageCount, to || from))
  } else if (strategy === 'anchor' && page) {
    pages = range(Math.max(1, page - radius), Math.min(pageCount, page + radius))
  } else {
    pages = range(1, pageCount)
  }

  const idOf = assignIds(opts.annotations ?? [])
  const pageData = new Map()
  for (const p of pages) pageData.set(p, await getPageData(key, abs, pdf, p))

  const parts = []
  const firstVp = pageData.get(pages[0])?.viewport
  const title = opts.title || opts.relPath.split('/').pop().replace(/\.pdf$/i, '')
  parts.push(
    `【文档】${title}.pdf ｜ 共 ${pageCount} 页${firstVp ? ` ｜ 页面约 ${Math.round(firstVp.width)}×${Math.round(firstVp.height)} pt` : ''}` +
      (pages.length < pageCount ? ` ｜ 本次提供第 ${pages[0]}–${pages[pages.length - 1]} 页` : ''),
  )
  parts.push(
    '【图例】行号格式 [页.行]；⟦A1⟧⟦M2⟧ 等记号标记标注/卡片在原文中的位置；标注与卡片详情见文末索引。A=文字标注 M=遮罩 T=标签锚点 G=贴图 C=卡片。',
  )

  const annsByPage = new Map()
  for (const a of opts.annotations ?? []) {
    if (!annsByPage.has(a.page)) annsByPage.set(a.page, [])
    annsByPage.get(a.page).push(a)
  }

  for (const p of pages) {
    const { lines } = pageData.get(p) ?? { lines: [] }
    parts.push(`\n===== 第 ${p} 页 =====`)
    if (!lines.length) {
      parts.push('（本页无文本层，可能是扫描图）')
      continue
    }
    const anns = annsByPage.get(p) ?? []
    const marksByLine = new Map()
    if (inlineAnchors) {
      for (const a of anns) {
        const lr = lineRangeOf(a, lines)
        if (!lr) continue
        const firstLine = parseInt(lr, 10) - 1
        if (!marksByLine.has(firstLine)) marksByLine.set(firstLine, [])
        marksByLine.get(firstLine).push(idOf.get(a.id))
      }
    }
    lines.forEach((l, i) => {
      const marks = marksByLine.get(i)
      const num = lineNumbers ? `[${p}.${i + 1}] ` : ''
      const anchor = marks?.length ? `⟦${marks.join('⟧⟦')}⟧ ` : ''
      parts.push(`${num}${anchor}${l.text}`)
    })
  }

  if (annotationIndex) {
    const rows = []
    for (const a of opts.annotations ?? []) {
      if (!pages.includes(a.page)) continue
      const short = idOf.get(a.id)
      const tagStr = a.tags?.length ? ` #${a.tags.join(' #')}` : ''
      const lines = pageData.get(a.page)?.lines
      if (a.type === 'mask') {
        const hidden = maskedText(a, lines)
        rows.push(
          `- ${short} [遮罩] 第${a.page}页 y≈${Math.round(a.rect.y)}–${Math.round(a.rect.y + a.rect.h)}${tagStr} ｜ 遮住的内容: ${showMasked && hidden ? `"${hidden}"` : '【已隐藏】'}`,
        )
      } else if (a.type === 'image') {
        rows.push(`- ${short} [贴图] 第${a.page}页 (${Math.round(a.rect.x)},${Math.round(a.rect.y)}) 尺寸 ${Math.round(a.rect.w)}×${Math.round(a.rect.h)}${tagStr}`)
      } else {
        const lr = lineRangeOf(a, lines)
        const quote = a.text ? `"${a.text.slice(0, 400)}${a.text.length > 400 ? '…' : ''}"` : '(无引文)'
        rows.push(`- ${short} [${TYPE_LABEL[a.type] ?? a.type}${a.color ? '·' + colorName(a.color) : ''}] 第${a.page}页${lr ? ` 行${lr}` : ''}${tagStr} ｜ 引文: ${quote}`)
      }
    }
    if (rows.length) {
      parts.push(`\n===== 标注索引 =====`)
      parts.push(...rows)
    }
  }

  if (includeCards && opts.cards?.length) {
    const rows = []
    for (const c of opts.cards) {
      const anchorPage = c.anchor?.page
      if (anchorPage && !pages.includes(anchorPage)) continue
      const anchorRef =
        c.anchor?.kind === 'annotation' && idOf.get(c.anchor.annotationId)
          ? `锚点:${idOf.get(c.anchor.annotationId)}/第${anchorPage}页`
          : anchorPage
            ? `锚点:第${anchorPage}页整页`
            : '锚点:无'
      const tagStr = c.tags?.length ? ` #${c.tags.join(' #')}` : ''
      const body = mdToPlainText(c.markdown)
      const bodyTrimmed = body.length > 1600 ? body.slice(0, 1600) + '…' : body
      rows.push(`- C:${c.id.slice(0, 6)} [${PURPOSE_LABEL[c.purpose] ?? c.purpose}${tagStr} | ${anchorRef}] ${c.title || '(无标题)'}\n  内容: ${bodyTrimmed || '(空)'}`)
    }
    if (rows.length) {
      parts.push(`\n===== 卡片笔记 =====`)
      parts.push(...rows)
    }
  }

  parts.push(
    `\n===== 回答要求 =====\n引用原文时给出行号（如 [3.5]）；谈论标注/卡片时使用其编号（如 A1、C1）；标注与卡片内容以上文索引为准。`,
  )

  let text = parts.join('\n')
  let truncated = false
  if (text.length > maxChars) {
    text = text.slice(0, maxChars)
    truncated = true
    text += `\n\n（注意：上下文因长度限制被截断）`
  }
  return {
    text,
    chars: text.length,
    approxTokens: Math.round(text.length / 1.8),
    pages,
    pageCount,
    truncated,
  }
}
