// Embedded raster extraction plus explicit, bounded page export for vector textbook figures.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { getDocument, OPS, ImageKind } from 'pdfjs-dist/legacy/build/pdf.mjs'
import sharp from 'sharp'
import * as vault from '../vault.js'

const PDFJS = fileURLToPath(new URL('../../node_modules/pdfjs-dist/', import.meta.url))
const digest = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 16)
const MAX_IMAGES = 80, MAX_EXPORT_PAGES = 12, MAX_PIXELS = 16000000

/** PDF 1-bit gray is bit-packed, with byte padding at the end of each row. */
export function decodedPixels(img) {
  if (!img?.data || !Number.isInteger(img.width) || !Number.isInteger(img.height) || img.width < 1 || img.height < 1 || img.width * img.height > MAX_PIXELS) throw new Error('图片尺寸无效或超过 1600 万像素')
  const { width, height } = img
  const source = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength)
  if (img.kind === ImageKind.GRAYSCALE_1BPP) {
    const stride = Math.ceil(width / 8)
    if (source.length < stride * height) throw new Error('1-bit 图片像素不完整')
    const data = Buffer.alloc(width * height)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = source[y * stride + (x >> 3)] & (128 >> (x & 7)) ? 255 : 0
    return { data, width, height, channels: 1 }
  }
  const channels = img.kind === ImageKind.RGBA_32BPP ? 4 : img.kind === ImageKind.RGB_24BPP ? 3 : source.length / (width * height)
  if (![1, 3, 4].includes(channels) || source.length !== width * height * channels) throw new Error('图片像素格式不完整')
  return { data: source, width, height, channels }
}
function imageObject(page, id) {
  const store = id.startsWith('g_') ? page.commonObjs : page.objs
  if (store.has(id)) return Promise.resolve(store.get(id))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待图片解码超时')), 5000)
    store.get(id, value => { clearTimeout(timer); resolve(value) })
  })
}
export function imageRequest(args, pageCount) {
  const mode = args.mode ?? 'auto'
  if (!['auto', 'embedded', 'page'].includes(mode)) throw new Error('mode 只能是 auto、embedded 或 page')
  const min = args.min_size === undefined ? 200 : Number(args.min_size)
  if (!Number.isFinite(min) || min < 1 || min > 10000) throw new Error('min_size 应为 1–10000')
  let pages
  if (args.pages !== undefined) {
    if (!Array.isArray(args.pages) || !args.pages.length || args.pages.length > MAX_EXPORT_PAGES || args.pages.some(p => !Number.isInteger(p) || p < 1 || p > pageCount)) throw new Error(`pages 须为 1–${pageCount} 内的页码数组，最多 ${MAX_EXPORT_PAGES} 页（PDF 页码，从 1 开始）`)
    pages = [...new Set(args.pages)].sort((a, b) => a - b)
  }
  if (mode === 'page' && !pages) throw new Error('整页导出必须指定 pages，避免导出整本教材')
  return { mode, min, pages, scan: pages ?? Array.from({ length: pageCount }, (_, i) => i + 1) }
}
async function renderPage(pdf, page) {
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(1.5, 2400 / Math.max(base.width, base.height), Math.sqrt(MAX_PIXELS / (base.width * base.height)))
  const viewport = page.getViewport({ scale })
  const factory = pdf.canvasFactory, surface = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height))
  try {
    await page.render({ canvasContext: surface.context, viewport, background: 'rgb(255,255,255)' }).promise
    return { png: surface.canvas.toBuffer('image/png'), width: surface.canvas.width, height: surface.canvas.height }
  } finally { factory.destroy(surface) }
}

export async function extractPdfImages(args) {
  const rel = String(args.path || '').trim().replace(/\\/g, '/')
  const abs = vault.resolveInVault(rel)
  if (!/\.pdf$/i.test(abs) || !fs.existsSync(abs)) throw new Error('PDF 不存在：' + rel)
  const stat = fs.statSync(abs)
  const task = getDocument({ data: new Uint8Array(fs.readFileSync(abs)), isEvalSupported: false, isOffscreenCanvasSupported: false, disableFontFace: true, standardFontDataUrl: path.join(PDFJS, 'standard_fonts') + path.sep, cMapUrl: path.join(PDFJS, 'cmaps') + path.sep, cMapPacked: true })
  try {
    const pdf = await task.promise, request = imageRequest(args, pdf.numPages)
    const slug = path.basename(rel, path.extname(rel)).replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 40) || 'pdf'
    const dir = `assets/pdf/${slug}-${digest(rel)}`
    const cacheKey = digest(JSON.stringify({ v: 2, source: abs, size: stat.size, modified: stat.mtimeMs, min: request.min, mode: request.mode, pages: request.pages }))
    const manifest = vault.resolveInVault(`${dir}/manifest-${cacheKey}.json`)
    if (!args.force && fs.existsSync(manifest)) {
      try {
        const cached = JSON.parse(fs.readFileSync(manifest, 'utf8'))
        if (['ok', 'no_images'].includes(cached.status) && cached.images.every(img => fs.existsSync(vault.resolveInVault(img.file)))) return { ...cached, reused: true }
      } catch { /* Recompute stale or damaged local manifests. */ }
    }
    fs.mkdirSync(vault.resolveInVault(dir), { recursive: true })
    const images = [], warnings = [], seen = new Set()
    let scannedPages = 0, limited = false
    const warn = message => { if (warnings.length < 20) warnings.push(message) }
    function save(png, page, width, height, kind) {
      const hash = digest(png)
      if (seen.has(hash)) return
      seen.add(hash)
      const file = `${dir}/p${page}-${kind}-${hash}.png`
      fs.writeFileSync(vault.resolveInVault(file), png)
      images.push({ file, page, width, height, kind })
    }
    for (const p of request.scan) {
      if (images.length >= MAX_IMAGES) { limited = true; break }
      const page = await pdf.getPage(p)
      scannedPages++
      let qualifying = 0
      try {
        if (request.mode !== 'page') {
          const ops = await page.getOperatorList(), pageSeen = new Set()
          for (let i = 0; i < ops.fnArray.length; i++) {
            if (images.length >= MAX_IMAGES) { limited = true; break }
            const fn = ops.fnArray[i]
            if (![OPS.paintImageXObject, OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObject].includes(fn)) continue
            try {
              let img
              if (fn === OPS.paintInlineImageXObject) img = ops.argsArray[i][0]
              else {
                const id = ops.argsArray[i][0]
                if (pageSeen.has(id)) continue
                pageSeen.add(id); img = await imageObject(page, id)
              }
              if (!img || Math.min(img.width, img.height) < request.min) continue
              const pixels = decodedPixels(img)
              const png = await sharp(pixels.data, { raw: { width: pixels.width, height: pixels.height, channels: pixels.channels } }).png({ compressionLevel: 8 }).toBuffer()
              qualifying++
              save(png, p, img.width, img.height, 'embedded')
            } catch (error) { warn(`第 ${p} 页图片：${error.message}`) }
          }
        }
        if (images.length < MAX_IMAGES && (request.mode === 'page' || (request.mode === 'auto' && request.pages && qualifying === 0))) {
          const rendered = await renderPage(pdf, page)
          save(rendered.png, p, rendered.width, rendered.height, 'page')
        }
      } catch (error) { warn(`第 ${p} 页：${error.message}`) }
      finally { page.cleanup() }
    }
    const status = images.length ? warnings.length || limited ? 'partial' : 'ok' : warnings.length ? 'error' : 'no_images'
    const result = { source: rel, dir, status, count: images.length, images, pageCount: pdf.numPages, scannedPages, ...(limited ? { limited: true } : {}), warnings, reused: false,
      hint: images.length ? '仅引用返回的 file，注明来源 PDF 和 page；kind=page 是含文字的整页导出，并非裁切插图。' : warnings.length ? '提取发生错误，按 warnings 报告具体原因，不能声称 PDF 中没有图。' : '未找到符合 min_size 的内嵌位图，不代表接口故障或页面没有插图；矢量图请指定 pages 并用 mode=page 导出相关整页（最多12页），或 mode=auto 在指定页回退整页。' }
    if (['ok', 'no_images'].includes(status)) fs.writeFileSync(manifest, JSON.stringify(result, null, 1), 'utf8')
    return result
  } finally { await task.destroy() }
}
