// PDF 内嵌图片提取：把 PDF 里的图片元素（插图/图表/照片）解码成 PNG 存入
// vault 的 assets/pdf/<pdf名>/，供可视化 Agent 在笔记中引用。
// 原理：pdfjs getOperatorList 枚举 paintImageXObject（含 inline），拿到解码后的
// 原始像素（灰度/RGB/RGBA），用 sharp 转成 PNG；按内容哈希去重；过滤小于
// min_size 的图标与装饰元素。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import sharp from 'sharp'
import * as vault from '../vault.js'

const MIN_SIDE_DEFAULT = 200
const MAX_IMAGES_DEFAULT = 80

const docCache = new Map() // abs path -> pdfjs document

async function getPdf(abs) {
  if (docCache.has(abs)) return docCache.get(abs)
  const task = getDocument({ data: new Uint8Array(fs.readFileSync(abs)), isEvalSupported: false, disableFontFace: true })
  const pdf = await task.promise
  if (docCache.size > 4) {
    const first = docCache.keys().next().value
    docCache.delete(first)
  }
  docCache.set(abs, pdf)
  return pdf
}

function slugOf(pdfRel) {
  const base = path.basename(pdfRel).replace(/\.pdf$/i, '')
  return base.replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 40) || 'pdf'
}

/** 提取一个图片对象 → PNG Buffer（失败返回 null） */
async function imageObjectToPng(img) {
  try {
    if (!img || !img.data || !img.width || !img.height) return null
    const channels = img.kind === 1 ? 1 : img.kind === 3 ? 4 : 3
    const buf = await sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels } })
      .png({ compressionLevel: 8 })
      .toBuffer()
    return buf
  } catch {
    return null
  }
}

/**
 * 提取 PDF 内嵌图片。
 * @returns {dir, count, images: [{file, page, width, height}], reused}
 */
export async function extractPdfImages({ path: pdfRel, min_size: minSize = MIN_SIDE_DEFAULT, force = false }) {
  const rel = String(pdfRel || '').trim()
  const abs = vault.resolveInVault(rel)
  if (!/\.pdf$/i.test(abs) || !fs.existsSync(abs)) throw new Error('PDF 不存在：' + rel)
  const min = Math.max(50, Number(minSize) || MIN_SIDE_DEFAULT)

  const slug = slugOf(rel)
  const outDirRel = `assets/pdf/${slug}`
  const outDir = vault.resolveInVault(outDirRel)
  fs.mkdirSync(outDir, { recursive: true })

  // 幂等：已提取过（目录里有图且非 force）→ 直接返回已有清单
  const existing = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter((f) => f.endsWith('.png')) : []
  if (existing.length && !force) {
    const images = existing.sort().map((f) => {
      const m = f.match(/^p(\d+)-(\d+)/)
      return { file: `${outDirRel}/${f}`, page: m ? Number(m[1]) : 0, width: 0, height: 0 }
    })
    return { dir: outDirRel, count: images.length, images, reused: true }
  }

  const pdf = await getPdf(abs)
  const seenHash = new Set()
  const images = []
  let seq = 0

  for (let p = 1; p <= pdf.numPages && images.length < MAX_IMAGES_DEFAULT; p++) {
    let page
    try {
      page = await pdf.getPage(p)
    } catch {
      continue
    }
    let ops
    try {
      ops = await page.getOperatorList()
    } catch {
      continue
    }
    const pageSeen = new Set()
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (images.length >= MAX_IMAGES_DEFAULT) break
      const fn = ops.fnArray[i]
      try {
        let img = null
        if (fn === OPS.paintImageXObject) {
          const objId = ops.argsArray[i][0]
          if (pageSeen.has(objId)) continue
          pageSeen.add(objId)
          img = page.objs?.get?.(objId) ?? page.commonObjs?.get?.(objId)
        } else if (fn === OPS.paintInlineImageXObject) {
          img = ops.argsArray[i][0]
        }
        if (!img || !img.data) continue
        if (Math.min(img.width, img.height) < min) continue
        const png = await imageObjectToPng(img)
        if (!png || png.length < 800) continue
        const hash = crypto.createHash('md5').update(png).digest('hex').slice(0, 16)
        if (seenHash.has(hash)) continue // 同图多处引用只存一次
        seenHash.add(hash)
        seq++
        const file = `${outDirRel}/p${p}-${String(seq).padStart(2, '0')}.png`
        fs.writeFileSync(vault.resolveInVault(file), png)
        images.push({ file, page: p, width: img.width, height: img.height })
      } catch {
        /* 单个图片对象解码失败（如 JPX）跳过 */
      }
    }
  }

  // 写清单（供幂等返回与人工查看）
  try {
    fs.writeFileSync(
      path.join(outDir, 'manifest.json'),
      JSON.stringify({ source: rel.replace(/\\/g, '/'), min, count: images.length, images }, null, 1),
      'utf8',
    )
  } catch {
    /* ignore */
  }
  return { dir: outDirRel, count: images.length, images, reused: false }
}
