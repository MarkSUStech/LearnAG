// AI 生成 PDF 大纲：无书签的 PDF（扫描/自制讲义）由用户指定目录所在页，
// LLM 解析出「标题 + 正文页码 + 层级」，再用正文首章标题在后续页面中定位
// 「印刷页码 → PDF 物理页码」的偏移量，最终把大纲存入 pdf-study sidecar。
import { getPdf, keyFor, getPageData } from './pdfdoc.js'
import { resolveInVault } from './vault.js'
import { saveGeneratedOutline } from './pdfstudy.js'
import { chatOnce } from './agent/runner.js'

const MAX_TOC_CHARS = 16000
const MAX_ENTRIES = 300

const SYSTEM = [
  '你是教材目录解析器。输入是 PDF 目录页的文本（可能含 OCR 噪声、点线引导符、断行）。',
  '只输出一个 JSON 数组，不要解释、不要代码围栏。数组元素格式：',
  '{"title":"条目标题","page":正文起始页码(整数),"level":1|2|3}',
  '规则：',
  '- level 1 = 章/单元/Part/讲，level 2 = 节，level 3 = 小节；按编号与缩进判断',
  '- title 保留原始标题文字（含「第1章」「1.1」等编号），去掉行尾点线、页码与多余空白',
  '- page 取该条目在目录中标注的页码（正文印刷页码）；没有标注页码的条目直接跳过',
  '- 与正文无关的条目（附录致谢可视情况保留）按目录原样解析，不要发明不存在的条目',
].join('\n')

/** "3-5, 8" | [[3,5],[8,8]] | [3,4,5] → 去重排序的物理页码数组 */
function parseRanges(ranges, total) {
  let list = []
  if (typeof ranges === 'string') {
    for (const part of ranges.split(/[,，;；\s]+/)) {
      const m = /^(\d+)(?:[-–—~](\d+))?$/.exec(part.trim())
      if (!m) continue
      const from = parseInt(m[1], 10)
      const to = m[2] ? parseInt(m[2], 10) : from
      for (let p = Math.min(from, to); p <= Math.max(from, to); p++) list.push(p)
    }
  } else if (Array.isArray(ranges)) {
    for (const r of ranges) {
      if (typeof r === 'number') list.push(r)
      else if (Array.isArray(r) && r.length >= 2) for (let p = r[0]; p <= r[1]; p++) list.push(p)
    }
  }
  list = [...new Set(list.map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n) && n >= 1 && n <= total))]
  return list.sort((a, b) => a - b)
}

/** LLM 输出 → [{title, page(印刷页码), level}]；容忍输出被 maxTokens 截断（回退到最后一个完整对象）；失败返回 [] */
function parseEntries(raw, total) {
  let t = String(raw ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const start = t.indexOf('[')
  if (start < 0) return []
  const end = t.lastIndexOf(']')
  const candidates = []
  if (end > start) candidates.push(t.slice(start, end + 1))
  // 截断修复：JSON 不完整时，截到最后一个完整对象再闭合数组
  let probe = end > start ? t.slice(start) : t.slice(start)
  const lastObj = probe.lastIndexOf('}')
  if (lastObj > 0) candidates.push(probe.slice(0, lastObj + 1) + ']')
  for (const c of candidates) {
    try {
      const arr = JSON.parse(c)
      if (!Array.isArray(arr)) continue
      const out = []
      for (const it of arr) {
        if (!it || typeof it !== 'object') continue
        const title = String(it.title ?? '').replace(/\s+/g, ' ').trim()
        const page = Math.round(Number(it.page))
        if (!title || !Number.isFinite(page)) continue
        const level = Math.min(3, Math.max(1, Math.round(Number(it.level)) || 1))
        out.push({ title: title.slice(0, 120), page, level })
        if (out.length >= MAX_ENTRIES) break
      }
      if (out.length) return out.filter((e) => e.page >= -total && e.page <= total * 2)
    } catch {
      /* 尝试下一个候选 */
    }
  }
  console.error('[pdf-outline] LLM 输出解析失败，前 300 字符:', String(raw ?? '').slice(0, 300))
  return []
}

/** 目录条目标题 → 用于正文定位的关键词（剥编号，取较长的一端） */
function titleKeyword(title) {
  return String(title)
    .replace(/^[第卷篇][\d一二三四五六七八九十百千万]+[章篇部讲单元节回]?[\s.·:：、]*/, '')
    .replace(/^\d+(\.\d+)*[\s.·:：、]*/, '')
    .replace(/[\s:：]+$/, '')
    .trim()
}

/**
 * 生成并保存大纲。
 * @param relPath vault 内 PDF 相对路径
 * @param ranges 目录所在页（"3-5,8" 或 [[3,5],[8,8]]）
 */
export async function generateOutline({ relPath, ranges }) {
  const abs = resolveInVault(relPath)
  const key = keyFor(relPath)
  const pdf = await getPdf(key, abs)
  const total = pdf.numPages
  const pages = parseRanges(ranges, total)
  if (!pages.length) throw new Error(`未指定有效的目录页（1~${total}）`)

  // 2) 逐目录页调用 LLM 解析（每页输出量小，不会被 maxTokens 截断；跨页合并）
  const entries = []
  const seen = new Set()
  let extracted = 0
  for (const p of pages) {
    const { lines } = await getPageData(key, abs, pdf, p)
    const pageText = lines.map((l) => l.text).join('\n').slice(0, MAX_TOC_CHARS)
    extracted += pageText.trim().length
    if (pageText.trim().length < 20) continue
    const raw = await chatOnce(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `PDF 共 ${total} 页。以下是第 ${p} 页目录文本：\n\n${pageText}` },
      ],
      { temperature: 0.1, maxTokens: 8000 },
    )
    for (const e of parseEntries(raw, total)) {
      const k = e.title + '@' + e.page
      if (seen.has(k)) continue
      seen.add(k)
      entries.push(e)
    }
  }
  entries.sort((a, b) => a.page - b.page || a.level - b.level)
  if (extracted < 20) throw new Error('所选页面几乎没有文本（可能是扫描版 PDF 无文字层），无法解析目录')
  if (!entries.length) throw new Error('未能从所选页面解析出目录条目，请确认这些页面确实是目录')

  // 3) 全文内容锚定：逐条在正文中搜索标题的真实物理页。
  // 重排/OCR 版 PDF 的印刷页码与物理页之间没有固定偏移（漂移累积），必须按内容定位。
  const tocEnd = Math.max(...pages)
  const flat = await anchorByContent(pdf, key, abs, entries.map((e) => ({ ...e, printed: e.page })), tocEnd)
  if (!flat.length) throw new Error('内容定位失败，请重试')
  const meta = { source: 'ai', pages, count: flat.length, generatedAt: new Date().toISOString() }
  saveGeneratedOutline(relPath, flat, meta)
  console.log(`[pdf-outline] ${relPath}: ${flat.length} 条（全文锚定，目录页 ${pages.join('、')}）`)
  return { ok: true, count: flat.length, meta }
}

/** 归一化：小写、非字母数字（含换行）压成单空格、首尾加空格（保证词边界匹配） */
/**
 * 内容锚定：为每个目录条目在正文（目录之后）搜索其真实物理页。
 * 匹配（行级，抗 OCR/重排的单词粘连）：
 *  - 软匹配：整行或连续 2~3 行拼接（保空格）恰好等于/以标题结尾；
 *  - 硬匹配：同窗口去空格后以去空格标题结尾。
 * 选择（尺度健全性）：按目录顺序单调向后取候选；相邻锚点的「物理页增量 / 印刷页增量」
 * 必须落在 [0, 10]（重排/原版书每印刷页至多摊开成十几页 PDF 页），否则视为
 * 前言概述/书末书签清单/导航行的误匹配，换下一候选或弃权。
 * 弃权条目在前后已锚定条目之间线性插值。
 */
async function anchorByContent(pdf, key, abs, entries, tocEnd) {
  const total = pdf.numPages
  const normLine = (s) => s.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, ' ').trim()
  const normHard = (s) => s.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '')
  const soft = new Array(total + 1) // 每页 1~3 连续行拼接的归一化变体
  const hard = new Array(total + 1) // 每页 1~3 连续行拼接的去空格变体
  for (let p = tocEnd + 1; p <= total; p++) {
    try {
      const { lines } = await getPageData(key, abs, pdf, p)
      const ls = lines.map((l) => l.text)
      const v = []
      const h = []
      for (let i = 0; i < ls.length; i++) {
        let accS = ''
        let accH = ''
        for (let k = 0; k < 3 && i + k < ls.length; k++) {
          accS = (accS + ' ' + ls[i + k]).trim()
          accH += ls[i + k]
          v.push(normLine(accS))
          h.push(normHard(accH))
        }
      }
      soft[p] = v
      hard[p] = h
    } catch {
      soft[p] = []
      hard[p] = []
    }
  }
  // 每条目的全部候选页（升序）
  const candidates = entries.map((e) => {
    const kwF = normLine(e.title)
    const kwH = normHard(e.title)
    const out = []
    if (kwH.length >= 4) {
      for (let p = tocEnd + 1; p <= total; p++) {
        let hit = false
        for (const t of soft[p]) {
          if ((t === kwF || t.endsWith(' ' + kwF)) && t.length <= kwF.length + 20) {
            hit = true
            break
          }
        }
        if (!hit) {
          for (const h of hard[p]) {
            if (h.endsWith(kwH) && h.length <= kwH.length + 15) {
              hit = true
              break
            }
          }
        }
        if (hit) out.push(p)
      }
    }
    return out
  })
  // 单调 + 尺度健全性选择
  const res = entries.map((e) => ({ title: e.title, page: 0, level: e.level, anchored: false, printed: e.page }))
  let lastPage = tocEnd + 1
  let lastPrinted = 0
  for (let i = 0; i < entries.length; i++) {
    const printed = entries[i].page
    const maxPage = lastPage + Math.max(6, 10 * Math.max(0, printed - lastPrinted))
    let chosen = 0
    for (let ci = 0; ci < candidates[i].length; ci++) {
      const p = candidates[i][ci]
      if (p < lastPage) continue
      if (p > maxPage) break
      // 同页摊开：与上一锚点同页、印刷页明显推进（≥3）时，跳过章首内容盒的重复匹配取更靠后的候选
      if (p === lastPage && printed - lastPrinted >= 3 && ci < candidates[i].length - 1) continue
      chosen = p
      break
    }
    if (chosen) {
      res[i].anchored = true
      res[i].page = chosen
      lastPage = chosen
      lastPrinted = printed
    }
  }
  // 尾部清单污染修正（必须在插值之前）：重排 PDF 常把目录/书签清单附在书末，
  // 条目会集中误锚在最后几页。判别特征：≥2 个锚点、彼此紧致（页跨度 ≤ 条目数）、
  // 位置在书末 10%（或印刷页进度还很低）——满足则按印刷页比例重排到正文区间，
  // 保持锚定状态，让其余条目参照修正后的锚点插值。合法的书末条目（附录/索引）
  // 分布松散（页跨度 > 条目数），不会误伤。
  const maxPrinted = Math.max(...entries.map((e) => e.page), 1)
  const suspicious = res.filter(
    (r) => r.anchored && (r.page >= total * 0.97 || (r.page >= total * 0.9 && r.printed / maxPrinted < 0.7)),
  )
  if (suspicious.length >= 2) {
    const minP = Math.min(...suspicious.map((r) => r.page))
    const maxP = Math.max(...suspicious.map((r) => r.page))
    if (maxP - minP <= suspicious.length) {
      const listingStart = minP - 3
      const span = Math.max(10, listingStart - tocEnd)
      for (const r of suspicious) {
        r.page = Math.min(listingStart, Math.max(tocEnd + 1, Math.round(tocEnd + span * (r.printed / maxPrinted))))
      }
    }
  }
  // 未锚定条目：前后已锚定条目之间线性插值（无后邻则局部差外推）
  for (let i = 0; i < res.length; i++) {
    if (res[i].anchored) continue
    let a = i - 1
    while (a >= 0 && !res[a].anchored) a--
    let b = i + 1
    while (b < res.length && !res[b].anchored) b++
    if (a >= 0 && b < res.length) {
      const t = (res[i].printed - res[a].printed) / Math.max(1, res[b].printed - res[a].printed)
      res[i].page = Math.round(res[a].page + t * (res[b].page - res[a].page))
      res[i].page = Math.min(res[b].page, Math.max(res[a].page, res[i].page))
    } else if (a >= 0) {
      res[i].page = Math.min(total, res[a].page + Math.max(1, res[i].printed - res[a].printed))
    } else if (b < res.length) {
      res[i].page = Math.max(1, res[b].page - Math.max(1, res[b].printed - res[i].printed))
    } else {
      res[i].page = Math.min(total, Math.max(1, res[i].printed))
    }
  }
  return res.map(({ title, page, level }) => ({ title, page, level }))
}