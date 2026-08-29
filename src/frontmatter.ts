import type { FrontMeta } from './types'

export interface SplitResult {
  frontmatter: string | null
  body: string
  meta: FrontMeta
}

/** 把原始 markdown 拆成 frontmatter 与正文，并轻量解析常用字段用于展示 */
export function splitFrontmatter(raw: string): SplitResult {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return { frontmatter: null, body: raw, meta: { tags: [] } }
  const frontmatter = m[0]
  const body = raw.slice(m[0].length).replace(/^\r?\n/, '')
  return { frontmatter: m[0], body, meta: parseMeta(m[1]) }
}

function parseMeta(yaml: string): FrontMeta {
  const meta: FrontMeta = { tags: [] }
  let currentKey = ''
  for (const line of yaml.split(/\r?\n/)) {
    const list = line.match(/^\s*-\s+(.*)$/)
    if (list && currentKey === 'tags') {
      meta.tags.push(cleanWiki(list[1]))
      continue
    }
    const kv = line.match(/^(\w+)\s*:\s*(.*)$/)
    if (!kv) continue
    currentKey = kv[1]
    const value = kv[2].trim()
    switch (currentKey) {
      case 'tags':
        if (value) meta.tags.push(cleanWiki(value))
        break
      case 'mastery':
        meta.mastery = Number(value) || undefined
        break
      case 'status':
        meta.status = value
        break
      case 'date':
        meta.date = value
        break
      case 'id':
        meta.id = value
        break
    }
  }
  return meta
}

function cleanWiki(s: string) {
  return s.replace(/^["']|["']$/g, '').replace(/^\[\[|\]\]$/g, '')
}
