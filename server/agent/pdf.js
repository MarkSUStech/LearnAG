// PDF 文本提取（unpdf / pdf.js），带缓存与按页读取
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { extractText, getDocumentProxy } from 'unpdf'
import { resolveInVault } from '../vault.js'

const MAX_CHARS = 50000

/** 提取全部页文本（带 md5 缓存），供 read_note 与 RAG 分块共用 */
export async function extractPdfPages(relPath) {
  const abs = resolveInVault(relPath)
  if (!fs.existsSync(abs)) throw new Error('文件不存在：' + relPath)
  const stat = fs.statSync(abs)

  // 缓存键：路径 + 大小 + 修改时间（文件变了自动失效）
  const key = crypto
    .createHash('md5')
    .update(relPath + ':' + stat.size + ':' + Math.floor(stat.mtimeMs / 1000))
    .digest('hex')
  const cacheDir = resolveInVault('.agent/pdf-cache')
  fs.mkdirSync(cacheDir, { recursive: true })
  const cacheFile = path.join(cacheDir, key + '.json')

  let pages
  if (fs.existsSync(cacheFile)) {
    try {
      pages = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
    } catch {
      pages = null
    }
  }
  if (!Array.isArray(pages)) {
    const buf = fs.readFileSync(abs)
    const pdf = await getDocumentProxy(new Uint8Array(buf))
    const res = await extractText(pdf)
    pages = (res.text || []).map((t) => (t || '').trim())
    fs.writeFileSync(cacheFile, JSON.stringify(pages), 'utf8')
  }
  return { pages, totalPages: pages.length }
}

/** read_note 用：可按页读取，超长截断 */
export async function extractPdfText(relPath, page) {
  const { pages, totalPages } = await extractPdfPages(relPath)

  const nonEmpty = pages.filter((t) => t.length > 0).length
  if (nonEmpty === 0) {
    return { totalPages, content: '（该 PDF 没有可提取的文本层，可能是扫描/图片型 PDF，无法读取内容）', truncated: true }
  }

  let content = ''
  let truncated = false
  if (page) {
    const idx = Math.max(1, Math.min(totalPages, Math.round(Number(page))))
    content = `── 第 ${idx} 页 / 共 ${totalPages} 页 ──\n` + (pages[idx - 1] || '（本页无文本）')
    if (content.length > MAX_CHARS) {
      content = content.slice(0, MAX_CHARS) + '\n[...本页内容过长已截断]'
      truncated = true
    }
  } else {
    const parts = []
    let used = 0
    for (let i = 0; i < totalPages; i++) {
      const t = pages[i] || ''
      if (used + t.length > MAX_CHARS) {
        parts.push(`\n[...后续第 ${i + 1}~${totalPages} 页已截断；可用 page 参数按页读取，共 ${totalPages} 页]`)
        truncated = true
        break
      }
      parts.push(`── 第 ${i + 1} 页 ──\n${t}`)
      used += t.length
    }
    content = parts.join('\n\n')
  }

  return { totalPages, content, truncated }
}
