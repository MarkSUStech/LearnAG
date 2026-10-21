import fs from 'node:fs'
import * as vault from '../vault.js'

const config = JSON.parse(fs.readFileSync(new URL('../../shared/image-attachments.json', import.meta.url), 'utf8'))
export const MAX_IMAGES = config.maxImages
export const MAX_IMAGE_BYTES = config.maxBytes
export const isImagePath = (path) => Boolean(config.mimeByExtension[/\.[^.\/]+$/.exec(String(path).toLowerCase())?.[0]])
export const attachmentPath = (a) => typeof a === 'string' ? a : String(a?.path || '')
export const imagePaths = (attachments = []) => [...new Set((Array.isArray(attachments) ? attachments : []).map(attachmentPath).filter(isImagePath))]

// Recover only our old attachment envelope, never arbitrary paths mentioned in prose/code.
function userImages(message) {
  if (Array.isArray(message.images)) return imagePaths(message.images)
  if (message.role !== 'user' || typeof message.content !== 'string') return []
  const block = message.content.split('\n【附带资料】')[1]
  if (!block) return []
  const paths = []
  for (const line of block.split('\n').slice(1)) {
    if (!line.trim()) break
    const match = /^- \[(?:重点|次要)\] (.+?) ｜ 建议范围：/.exec(line)
    if (!match) break
    if (isImagePath(match[1])) paths.push(match[1])
  }
  return imagePaths(paths)
}

// Tool responses remain contiguous. A verified image read becomes a user image
// after the whole tool group, shared by manager, specialists and Q&A callers.
function withImageSources(messages) {
  const result = []
  let calls = new Map(), readImages = []
  for (const message of messages) {
    if (message.role === 'assistant' && message.tool_calls?.length) {
      calls = new Map(message.tool_calls.map(call => [call.id, call]))
      readImages = []
    }
    const images = userImages(message)
    result.push(images.length ? { ...message, images } : message)
    if (message.role !== 'tool') continue
    const call = calls.get(message.tool_call_id)
    if (['read_note', 'read_image'].includes(call?.function?.name)) {
      try {
        const data = JSON.parse(message.content)
        const args = JSON.parse(call.function.arguments)
        const sameSource = call.function.name === 'read_image' ? data.original === String(args.path).replace(/\\/g, '/') : data.path === args.path
        if (data.image === true && sameSource && isImagePath(data.path) && !data.error) readImages.push(data.path)
      } catch { /* A text/PDF response is not an image. */ }
    }
    calls.delete(message.tool_call_id)
    if (!calls.size && readImages.length) {
      result.push({ role: 'user', content: '这是工具读取的图片，请根据图像内容继续。', images: imagePaths(readImages).slice(-MAX_IMAGES) })
      readImages = []
    }
  }
  return result
}

function imageInfo(rel) {
  const abs = vault.resolveInVault(rel)
  const size = fs.statSync(abs).size
  if (!size || size > MAX_IMAGE_BYTES) throw new Error(`图片为空或超过10MB：${rel}`)
  const fd = fs.openSync(abs, 'r')
  const buf = Buffer.alloc(12)
  try { fs.readSync(fd, buf, 0, buf.length, 0) } finally { fs.closeSync(fd) }
  let mime
  if (buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mime = 'image/png'
  else if (buf[0] === 255 && buf[1] === 216 && buf[2] === 255) mime = 'image/jpeg'
  else if (/^GIF8[79]a$/.test(buf.subarray(0, 6).toString('ascii'))) mime = 'image/gif'
  else if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') mime = 'image/webp'
  if (!mime) throw new Error(`无法识别图片，请使用PNG、JPEG、WebP或GIF：${rel}`)
  return { abs, mime }
}

export function validateImageAttachments(attachments) {
  const paths = imagePaths(attachments)
  if (paths.length > MAX_IMAGES) throw new Error('每次最多发送4张图片')
  paths.forEach(imageInfo)
  return paths
}

function imagePart(rel) {
  const { abs, mime } = imageInfo(rel)
  const buf = fs.readFileSync(abs)
  return { type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}` } }
}

/** Bound repeated vision costs to the most recent four images, while retaining every source path. */
export function recentImagePaths(messages) {
  return selectRecentImages(withImageSources(messages))
}

function selectRecentImages(messages) {
  const paths = []
  for (let i = messages.length - 1; i >= 0 && paths.length < MAX_IMAGES; i--) {
    for (const rel of imagePaths(messages[i].images || []).reverse()) {
      if (!paths.includes(rel)) paths.unshift(rel)
      if (paths.length === MAX_IMAGES) break
    }
  }
  return paths
}

/** Convert storage metadata to OpenAI vision parts only at the API boundary. Never persist data URLs. */
export function prepareVisionMessages(messages) {
  const sources = withImageSources(messages)
  const selected = new Set(selectRecentImages(sources))
  const parts = new Map()
  // Send each image only once, in its latest message; the full conversation still keeps its text.
  const sent = new Set()
  return sources.map((m, i) => ({ m, i })).reverse().map(({ m, i }) => {
    const { images, ...message } = m
    if (!images?.length) return { message, i }
    const paths = imagePaths(images)
    const visible = paths.filter(rel => selected.has(rel) && !sent.has(rel))
    const omitted = paths.filter(rel => !selected.has(rel))
    let content = message.content ?? ''
    if (omitted.length) {
      const hint = `\n[历史图片路径：${omitted.join('、')}；本次未重复传图，需要细节时请用户重新附图。]`
      content = typeof content === 'string' ? content + hint : [...content, { type: 'text', text: hint }]
    }
    if (visible.length) {
      const unavailable = []
      const vision = visible.flatMap(rel => {
        try {
          if (!parts.has(rel)) parts.set(rel, imagePart(rel))
        } catch {
          unavailable.push(rel)
          return []
        }
        sent.add(rel)
        return [parts.get(rel)]
      })
      content = [...(typeof content === 'string' ? [{ type: 'text', text: content }] : content), ...vision,
        ...(unavailable.length ? [{ type: 'text', text: `图片无法读取或已被删除：${unavailable.join('、')}。本次未提供这些图像，需说明并请用户重新附图。` }] : [])]
    }
    return { message: { ...message, content }, i }
  }).sort((a, b) => a.i - b.i).map(({ message }) => message)
}
