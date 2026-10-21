import config from '../shared/image-attachments.json'

export const MAX_IMAGES = config.maxImages
export const MAX_IMAGE_BYTES = config.maxBytes
const mimeByExtension: Record<string, string> = config.mimeByExtension
export const IMAGE_ACCEPT = Object.keys(mimeByExtension).join(',')
export const isImagePath = (path: string) => Boolean(mimeByExtension[/\.[^.\/]+$/.exec(path.toLowerCase())?.[0] || ''])
export const isImageFile = (file: File) => isImagePath(file.name) || Object.values(mimeByExtension).includes(file.type)

/** Clipboard images can have an extensionless filename; the server needs a durable image path. */
export function imageUploadFile(file: File) {
  const extension = /\.[^.\/]+$/.exec(file.name.toLowerCase())?.[0]
  const ext = extension && mimeByExtension[extension] ? extension : Object.keys(mimeByExtension).find(key => mimeByExtension[key] === file.type)
  if (!ext) throw new Error('支持 PNG、JPEG、WebP、GIF 图片')
  const stem = file.name.replace(/\.[^.]+$/, '').slice(0, 96) || 'image'
  const name = stem + ext
  return file.name === name ? file : new File([file], name, { type: file.type, lastModified: file.lastModified })
}
