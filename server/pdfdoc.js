// 服务端 pdf.js 文档访问：文档缓存 / 行级文本提取 / 书签大纲。
// 移植自 pdf-study/server/pdf-context.js + outline.js（行坐标已翻转为 top-left 原点）。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STD_FONTS = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'standard_fonts')

const docCache = new Map() // key -> pdfjs document
const lineCache = new Map() // `${key}:${page}` -> {lines, viewport}

/** 以 key（md5(相对路径)）为缓存键加载 PDF 文档 */
export async function getPdf(key, absPath) {
  if (docCache.has(key)) return docCache.get(key)
  const data = new Uint8Array(fs.readFileSync(absPath))
  const pdf = await getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl: STD_FONTS + path.sep,
  }).promise
  if (docCache.size > 8) {
    const first = docCache.keys().next().value
    const old = docCache.get(first)
    docCache.delete(first)
    old.destroy?.()
  }
  docCache.set(key, pdf)
  return pdf
}

export function keyFor(relPath) {
  return crypto.createHash('md5').update(String(relPath).replace(/\\/g, '/')).digest('hex')
}

/** 一页 → 行列表 [{y, x0, x1, text}]（top-left 原点，向下增大） */
export async function extractPageLines(pdf, pageNum) {
  const page = await pdf.getPage(pageNum)
  const vp = page.getViewport({ scale: 1 })
  const tc = await page.getTextContent()
  const items = []
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue
    // pdf.js transform 是左下原点，必须翻转到 top-left 再参与几何计算
    items.push({ x: it.transform[4], y: vp.height - it.transform[5], w: it.width || 0, h: it.height || 10, str: it.str })
  }
  items.sort((a, b) => a.y - b.y || a.x - b.x)
  const clusters = []
  let cur = null
  for (const it of items) {
    const tol = Math.max(2, (it.h || 10) * 0.5)
    if (cur && Math.abs(cur.y - it.y) <= tol) cur.items.push(it)
    else {
      cur = { y: it.y, items: [it] }
      clusters.push(cur)
    }
  }
  const lines = clusters.map((c) => {
    c.items.sort((a, b) => a.x - b.x)
    let text = ''
    let prevEnd = null
    let avgH = 10
    for (const it of c.items) {
      if (prevEnd != null) {
        const gap = it.x - prevEnd
        if (gap > Math.max(1, avgH * 0.3) && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' '
      }
      text += it.str
      prevEnd = it.x + it.w
      avgH = (avgH + (it.h || 10)) / 2
    }
    text = text.replace(/\s+/g, ' ').trim()
    return { y: c.y, x0: c.items[0].x, x1: prevEnd, text }
  })
  return { lines: lines.filter((l) => l.text), viewport: { width: vp.width, height: vp.height } }
}

export async function getPageData(key, absPath, pdf, pageNum) {
  const k = `${key}:${pageNum}`
  if (lineCache.has(k)) return lineCache.get(k)
  const data = await extractPageLines(pdf, pageNum)
  if (lineCache.size > 400) {
    const first = lineCache.keys().next().value
    lineCache.delete(first)
  }
  lineCache.set(k, data)
  return data
}

/** 书签大纲 → {title, page, yInPage, children} 树 */
export async function getOutlineTree(key, absPath) {
  const pdf = await getPdf(key, absPath)
  const raw = await pdf.getOutline()
  if (!raw?.length) return []

  async function resolveDest(dest) {
    if (!dest) return null
    try {
      const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest
      if (!Array.isArray(explicit) || !explicit.length) return null
      const ref = explicit[0]
      if (!ref || typeof ref !== 'object' || !('num' in ref)) return null
      const page = (await pdf.getPageIndex(ref)) + 1
      // explicit[5] 为 PDF 用户空间 y（底部原点）；转成 top-left 页内坐标
      let yInPage = null
      if (typeof explicit[5] === 'number' && explicit[5] > 0) {
        const vp = (await pdf.getPage(page)).getViewport({ scale: 1 })
        yInPage = Math.max(0, Math.round(vp.height - explicit[5]))
      }
      return { page, yInPage }
    } catch {
      return null
    }
  }

  async function build(items) {
    const nodes = []
    for (const it of items) {
      if (!it.title) continue
      const target = it.dest ? await resolveDest(it.dest) : null
      nodes.push({
        title: String(it.title),
        page: target?.page ?? null,
        yInPage: target?.yInPage ?? null,
        children: it.items?.length ? await build(it.items) : [],
      })
    }
    return nodes
  }

  return build(raw)
}

/** 把大纲树拍平为 [{title, page, level}]，用于解析章节页码范围 */
export function flattenOutline(nodes, level = 0, out = []) {
  for (const n of nodes) {
    out.push({ title: n.title, page: n.page, level })
    if (n.children?.length) flattenOutline(n.children, level + 1, out)
  }
  return out
}

/** 按章节标题解析页码范围 [from, to]；找不到返回 null */
export function chapterRange(flat, chapter, pageCount) {
  const norm = (s) => String(s).toLowerCase().replace(/[\s：:·．.、，,]+/g, '').replace(/第|章/g, '')
  const target = norm(chapter)
  if (!target) return null
  const idx = flat.findIndex((n) => n.page && norm(n.title).includes(target))
  if (idx < 0) return null
  // 章节终点 = 下一个同级或更高级、且有有效页码的条目
  let to = pageCount
  for (let i = idx + 1; i < flat.length; i++) {
    if (flat[i].level <= flat[idx].level && flat[i].page) {
      to = Math.max(flat[idx].page, flat[i].page - 1)
      break
    }
  }
  return { from: flat[idx].page, to: Math.min(to, pageCount), title: flat[idx].title }
}

/** 按当前页码定位所在章节（文档序最后一个起始页 ≤ page 的条目即最深包含章节） */
export function chapterRangeAt(flat, page, pageCount) {
  let idx = -1
  for (let i = 0; i < flat.length; i++) {
    const n = flat[i]
    if (n.page && n.page <= page) idx = i
  }
  if (idx < 0) return null
  let to = pageCount
  for (let j = idx + 1; j < flat.length; j++) {
    if (flat[j].level <= flat[idx].level && flat[j].page) {
      to = Math.max(flat[idx].page, flat[j].page - 1)
      break
    }
  }
  return { from: flat[idx].page, to: Math.min(to, pageCount), title: flat[idx].title }
}
