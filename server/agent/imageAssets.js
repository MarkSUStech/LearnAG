import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { marked } from 'marked'
import * as vault from '../vault.js'

export const imageHash = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 20)
export const isLibraryImage = value => /\.(png|jpe?g|webp|gif|svg)$/i.test(value)
const metadataFile = rel => vault.resolveInVault(`.agent/image-sources/${imageHash(rel)}.json`)
export function imageSource(rel) {
  try { return JSON.parse(fs.readFileSync(metadataFile(rel), 'utf8')) } catch { return {} }
}
export function saveImageSource(rel, source) {
  const file = metadataFile(rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ ...source, path: rel, savedAt: new Date().toISOString() }, null, 1))
}
export async function inspectImage({ path: rel, crop }) {
  rel = String(rel || '').replace(/\\/g, '/')
  if (!isLibraryImage(rel)) throw new Error('仅支持 PNG/JPEG/WebP/GIF/SVG 图片')
  const abs = vault.resolveInVault(rel), stat = fs.statSync(abs)
  if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('图片不是文件或超过20MB')
  let image = sharp(abs, { limitInputPixels: 16000000, animated: false }).rotate()
  const metadata = await image.metadata()
  if (!metadata.width || !metadata.height) throw new Error('无法解码图片')
  // Rotation must happen before a crop; export the orientation-correct frame first.
  if (crop) {
    if (!Array.isArray(crop) || crop.length !== 4 || crop.some(v => typeof v !== 'number' || !Number.isFinite(v)) || crop[0] < 0 || crop[1] < 0 || crop[2] <= 0 || crop[3] <= 0 || crop[0] + crop[2] > 1 || crop[1] + crop[3] > 1) throw new Error('crop 应为归一化 [x,y,width,height]，完整位于0–1范围')
    const frame = await image.toBuffer({ resolveWithObject: true })
    const width = frame.info.width, height = frame.info.height
    const left = Math.min(width - 1, Math.floor(crop[0] * width)), top = Math.min(height - 1, Math.floor(crop[1] * height))
    image = sharp(frame.data).extract({ left, top, width: Math.min(width - left, Math.max(1, Math.round(crop[2] * width))), height: Math.min(height - top, Math.max(1, Math.round(crop[3] * height))) })
  }
  const output = await image.resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true })
  if (output.data.length > 10 * 1024 * 1024) throw new Error('图片处理后仍超过10MB')
  const target = `assets/images/inspect-${imageHash(output.data)}.png`
  if (!fs.existsSync(vault.resolveInVault(target))) { vault.writeFile(target, output.data); vault.notifyWrite(target, 'add') }
  const source = imageSource(rel)
  saveImageSource(target, { ...source, original: rel, ...(crop ? { crop } : {}), kind: crop ? 'crop' : 'preview' })
  return { path: target, original: rel, image: true, width: output.info.width, height: output.info.height, bytes: output.data.length, source, ...(crop ? { crop } : {}), hint: '图片将作为图像输入随本组工具结果提供；核对实际内容再使用，不能仅凭文件名声称看到了细节。可引用原图或当前裁切图，保留来源。' }
}
export function markdownImageReferences(content) {
  const result = []
  function visit(tokens) {
    for (const token of tokens || []) {
      if (token.type === 'image') result.push({ target: token.href, alt: token.text || '' })
      if (token.tokens) visit(token.tokens)
      if (token.items) token.items.forEach(item => visit(item.tokens))
      if (token.type === 'table') { token.header.forEach(c => visit(c.tokens)); token.rows.flat().forEach(c => visit(c.tokens)) }
    }
  }
  try { visit(marked.lexer(String(content))) } catch { /* Markdown parsing failure is handled by the note renderer. */ }
  return result
}
export function checkNoteImages(content, notePath) {
  const warnings = []
  for (const { target } of markdownImageReferences(content).slice(0, 40)) {
    if (!target) { warnings.push('图片引用路径为空'); continue }
    if (/^https?:\/\//i.test(target)) { warnings.push(`外链图片尚未入库校验：${target.slice(0, 200)}`); continue }
    if (/^(?:data:|javascript:|file:)/i.test(target)) { warnings.push('不支持的图片引用协议'); continue }
    let rel
    try { rel = decodeURIComponent(target.split('#')[0]) } catch { warnings.push('图片路径编码无效'); continue }
    const candidates = [rel, path.posix.join(path.posix.dirname(notePath), rel)]
    if (!candidates.some(candidate => { try { return fs.statSync(vault.resolveInVault(candidate)).isFile() } catch { return false } })) warnings.push(`图片文件不存在：${rel}`)
  }
  return [...new Set(warnings)]
}
