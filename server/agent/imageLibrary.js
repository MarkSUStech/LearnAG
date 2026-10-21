import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import * as vault from '../vault.js'
import { isLibraryImage, imageSource, markdownImageReferences } from './imageAssets.js'
import { searchWebImages } from './imgsearch.js'

const ignored = new Set(['node_modules', '.git', '.obsidian', '.agent', '.trash', '.learn-agent'])
let cache = null
export function invalidateImageLibrary() { cache = null }
function catalog() {
  const root = vault.getVaultRoot()
  if (cache?.root === root && Date.now() - cache.at < 15000) return cache
  const images = [], notes = [], manifests = [], warnings = []
  let visited = 0
  function walk(dir, prefix = '') {
    if (visited >= 16000) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (++visited > 16000) { warnings.push('本地扫描达到16000项上限，可用folder缩小范围'); break }
      if (entry.isSymbolicLink()) continue
      const rel = prefix ? prefix + '/' + entry.name : entry.name
      if (entry.isDirectory()) { if (!ignored.has(entry.name) && !entry.name.startsWith('.')) walk(path.join(dir, entry.name), rel) }
      else if (isLibraryImage(rel)) images.push(rel)
      else if (/\.md$/i.test(rel) && notes.length < 600) notes.push(rel)
      else if (rel.startsWith('assets/pdf/') && /^manifest.*\.json$/.test(entry.name) && manifests.length < 200) manifests.push(rel)
    }
  }
  walk(root)
  const indexed = new Map(images.map(rel => [rel, { path: rel, text: rel.replace(/[-_/]/g, ' '), references: [] }]))
  for (const rel of notes) {
    try {
      if (fs.statSync(vault.resolveInVault(rel)).size > 200000) continue
      const text = fs.readFileSync(vault.resolveInVault(rel), 'utf8')
      for (const ref of markdownImageReferences(text)) {
        if (/^[a-z]+:/i.test(ref.target)) continue
        let target; try { target = decodeURIComponent(ref.target) } catch { continue }
        const candidate = indexed.get(target) ?? indexed.get(path.posix.normalize(path.posix.join(path.posix.dirname(rel), target)))
        if (!candidate) continue
        candidate.text += ' ' + ref.alt + ' ' + rel
        if (candidate.references.length < 3) candidate.references.push({ note: rel, caption: ref.alt.slice(0, 160) })
      }
    } catch { /* A single unreadable file cannot break local search. */ }
  }
  for (const rel of manifests) {
    try {
      const manifest = JSON.parse(fs.readFileSync(vault.resolveInVault(rel), 'utf8'))
      for (const img of manifest.images ?? []) {
        const candidate = indexed.get(img.file)
        if (candidate) { candidate.text += ' ' + manifest.source + ' page ' + img.page; candidate.pdf = { path: manifest.source, page: img.page, kind: img.kind ?? 'embedded' } }
      }
    } catch { /* Old or incomplete extraction manifests are optional. */ }
  }
  cache = { root, at: Date.now(), items: [...indexed.values()], warnings }; return cache
}
function words(query) {
  const normalized = String(query).toLowerCase().normalize('NFKC')
  const parts = normalized.match(/[a-z0-9]+|[\u3400-\u9fff]+/g) ?? []
  return [...new Set(parts.flatMap(w => /[\u3400-\u9fff]/.test(w) && w.length > 2 ? [w, ...Array.from({ length: w.length - 1 }, (_, i) => w.slice(i, i + 2))] : [w]))].slice(0, 32)
}
export async function searchLocalImages(query, count = 6, folder = '') {
  const index = catalog(), tokens = words(query), q = String(query).toLowerCase().trim()
  if (folder) vault.resolveInVault(folder)
  const prefix = folder.replace(/\\/g, '/').replace(/\/$/, '')
  const candidates = index.items.filter(c => !prefix || c.path.startsWith(prefix + '/')).map(c => {
    const source = imageSource(c.path), text = `${c.text} ${source.title ?? ''} ${source.caption ?? ''} ${source.original ?? ''}`.toLowerCase()
    const score = (text.includes(q) ? 8 : 0) + tokens.reduce((value, token) => value + (text.includes(token) ? 1 : 0) + (path.posix.basename(c.path).toLowerCase().includes(token) ? 2 : 0), 0)
    return { ...c, source, score }
  }).filter(c => c.score > 0).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, count)
  const results = []
  for (const candidate of candidates) {
    try {
      const abs = vault.resolveInVault(candidate.path), stat = fs.statSync(abs)
      if (stat.size > 20 * 1024 * 1024) continue
      const metadata = await sharp(abs, { limitInputPixels: 16000000, animated: false }).metadata()
      results.push({ title: candidate.source.title || candidate.references[0]?.caption || path.posix.basename(candidate.path), path: candidate.path, source: 'local', ranking: 'filename/caption/source', score: candidate.score, width: metadata.width, height: metadata.height, bytes: stat.size, references: candidate.references, ...(candidate.pdf ? { pdf: candidate.pdf } : {}), ...(candidate.source.page_url ? { page_url: candidate.source.page_url, license: candidate.source.license || '', author: candidate.source.author || '' } : {}) })
    } catch { /* Missing, corrupt or oversized files are not returned as usable images. */ }
  }
  return { results, warnings: index.warnings, ranking: 'metadata' }
}
export async function findImages({ query, count = 6, source = 'auto', folder = '', providers }) {
  query = String(query || '').trim()
  if (!query || query.length > 300) throw new Error('query 须为1–300字符')
  if (!['auto', 'local', 'web'].includes(source)) throw new Error('source 只能是 auto/local/web')
  if (providers !== undefined && (!Array.isArray(providers) || providers.length > 7 || providers.some(p => typeof p !== 'string'))) throw new Error('providers 须为最多7个图库ID的数组')
  if (providers?.length && source === 'auto') source = 'web'
  count = Math.max(1, Math.min(10, Math.trunc(Number(count) || 6)))
  const local = source !== 'web' ? await searchLocalImages(query, count, String(folder)) : { results: [], warnings: [] }
  // Local-first means no unnecessary network request and no local filenames sent to a provider.
  const remote = source === 'web' || (source === 'auto' && local.results.length === 0) ? await searchWebImages(query, count, { providers }) : { results: [], warnings: [] }
  return { results: [...local.results, ...remote.results].slice(0, count), warnings: [...local.warnings, ...remote.warnings], searched: remote.results.length || source === 'web' || (source === 'auto' && !local.results.length) ? source === 'web' ? ['web'] : ['local', 'web'] : ['local'], hint: '本地图用read_image核对；网络候选须download_image后read_image核对实际内容，再引用返回path。匹配分不是正确性或授权证明；保留来源与图注。' }
}
