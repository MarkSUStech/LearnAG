import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOMParser } from '@xmldom/xmldom'
import { imageHash } from './imageAssets.js'

export const IMAGE_SOURCES = [
  { id: 'wikimedia', name: 'Wikimedia Commons', kind: 'API', subjects: '全学科、地图、科学图解', url: 'https://commons.wikimedia.org/' },
  { id: 'openverse', name: 'Openverse', kind: 'API', subjects: '开放授权跨站图片', url: 'https://openverse.org/' },
  { id: 'europepmc', name: 'Europe PMC', kind: 'API + 全文图版', subjects: '生命科学与医学论文图表', url: 'https://europepmc.org/' },
  { id: 'openstax', name: 'OpenStax', kind: '官方教材源索引', subjects: '物理、数学、生物、化学教材图片', url: 'https://openstax.org/' },
  { id: 'servier', name: 'Servier Medical Art', kind: '官方站点搜索', subjects: '解剖、医学、疾病机制', url: 'https://smart.servier.com/' },
  { id: 'bioicons', name: 'Bioicons', kind: 'GitHub 元数据本地缓存', subjects: '科研仪器、细胞、蛋白质 SVG', url: 'https://bioicons.com/' },
  { id: 'wellcome', name: 'Wellcome Collection', kind: 'API + IIIF', subjects: '医学、科学史、历史图谱', url: 'https://wellcomecollection.org/' },
]
const UA = { 'User-Agent': 'LearnAgent/0.1 (educational image discovery)', Accept: 'application/json,text/xml,text/html' }
const cacheDir = fileURLToPath(new URL('../../.learn-agent/image-source-cache/', import.meta.url))
const memory = new Map(), health = new Map()
let transport = null
/** Injectable transport keeps adapter contract tests offline without changing production endpoints. */
export function setImageSourceTransport(value = null) { transport = value; memory.clear() }
export function imageSourceStatus() { return IMAGE_SOURCES.map(s => ({ ...s, ...(health.get(s.id) ?? { status: 'not_checked' }) })) }
export function recordImageSourceStatus(id, status, count = 0, error = '') { health.set(id, { status, count, checkedAt: new Date().toISOString(), ...(error ? { error: error.slice(0, 200) } : {}) }) }
export function clearImageSourceCache() { memory.clear() }
async function request(url, { persistent = false, json = true } = {}) {
  const key = imageHash(url), file = path.join(cacheDir, key + '.txt'), ttl = persistent ? 86400000 : 300000
  const old = memory.get(url)
  if (!transport && old && Date.now() - old.at < ttl) return json ? JSON.parse(old.text) : old.text
  if (!transport && persistent) try { const stat = fs.statSync(file); if (Date.now() - stat.mtimeMs < ttl) { const text = fs.readFileSync(file, 'utf8'); memory.set(url, { at: Date.now(), text }); return json ? JSON.parse(text) : text } } catch { /* Fetch the official metadata index when not cached. */ }
  const response = await (transport ?? fetch)(url, { headers: { ...UA, Accept: json ? 'application/json' : '*/*' }, signal: AbortSignal.timeout(12000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const parts = []; let size = 0
  for await (const chunk of response.body) { size += chunk.length; if (size > 5 * 1024 * 1024) throw new Error('图库元数据超过5MB上限'); parts.push(chunk) }
  const text = Buffer.concat(parts).toString('utf8')
  const value = json ? JSON.parse(text) : text
  if (memory.size > 80) memory.delete(memory.keys().next().value)
  memory.set(url, { at: Date.now(), text })
  if (!transport && persistent) { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(file, text) }
  return value
}
function xml(text) { return new DOMParser({ onError: () => {} }).parseFromString(text, 'text/xml') }
const nodes = (node, tag) => [...node.getElementsByTagName(tag)]
const textOf = (node, tag) => nodes(node, tag)[0]?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
const strip = s => String(s ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').slice(0, 1800)
const terms = query => String(query).toLowerCase().match(/[a-z0-9]+|[\u3400-\u9fff]{2,}/g) ?? []
function score(text, query) {
  const value = text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(), tokens = value.match(/[a-z0-9]+/g) ?? []
  return terms(query).reduce((sum, term) => sum + (/[\u3400-\u9fff]/.test(term) ? value.includes(term) ? 1 : 0 : tokens.some(word => word === term || word === term + 's' || word === term + 'es') ? 1 : 0), 0)
}
const encPath = value => value.split('/').map(encodeURIComponent).join('/')

export async function searchBioicons(query, limit, { author } = {}) {
  const icons = await request('https://raw.githubusercontent.com/duerrsimon/bioicons/main/static/icons/icons.json', { persistent: true })
  if (!Array.isArray(icons)) throw new Error('Bioicons 索引格式变化')
  const ranked = icons.filter(i => !author || i.author === author).map(i => ({ ...i, relevance: score(`${i.name} ${i.category} ${i.author}`, query) })).filter(i => i.relevance > 0).sort((a, b) => b.relevance - a.relevance).slice(0, limit)
  return ranked.map(i => {
    const rel = `static/icons/${i.license}/${i.category}/${i.author}/${i.name}.svg`
    const image_url = 'https://raw.githubusercontent.com/duerrsimon/bioicons/main/' + encPath(rel)
    return { title: i.name, image_url, thumb_url: image_url, page_url: 'https://github.com/duerrsimon/bioicons/blob/main/' + encPath(rel), license: i.license, license_url: `https://github.com/duerrsimon/bioicons/blob/main/static/icons/${encodeURIComponent(i.license)}/LICENSE`, author: i.author, source: 'bioicons', category: i.category }
  })
}
export async function searchWellcome(query, limit) {
  const data = await request(`https://api.wellcomecollection.org/catalogue/v2/images?query=${encodeURIComponent(query)}&pageSize=${Math.min(20, limit)}`)
  return (data.results ?? []).map(item => {
    const location = item.locations?.find(l => l.locationType?.id === 'iiif-image') ?? item.thumbnail
    const url = location?.url
    if (!url || !/\/info\.json$/.test(url)) return null
    return { title: item.source?.title || item.id, image_url: url.replace(/info\.json$/, 'full/!1600,1600/0/default.jpg'), thumb_url: url.replace(/info\.json$/, 'full/!400,400/0/default.jpg'), page_url: 'https://wellcomecollection.org/works/' + item.source.id, license: location.license?.label ?? '', license_url: location.license?.url ?? '', author: location.credit ?? '', source: 'wellcome', iiif: url }
  }).filter(Boolean)
}
export async function searchEuropePmc(query, limit) {
  const data = await request(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(`(${query}) AND OPEN_ACCESS:Y AND HAS_FT:Y`)}&format=json&pageSize=3`)
  const articles = (data.resultList?.result ?? []).filter(a => /^PMC\d+$/.test(a.pmcid)).slice(0, 3)
  const groups = await Promise.allSettled(articles.map(async article => {
    const source = await request(`https://www.ebi.ac.uk/europepmc/webservices/rest/${article.pmcid}/fullTextXML`, { json: false })
    const doc = xml(source), licenseNode = nodes(doc, 'license')[0]
    const licenseLink = licenseNode && (nodes(licenseNode, 'ext-link')[0]?.getAttribute('xlink:href') || licenseNode.getAttribute('xlink:href'))
    return nodes(doc, 'fig').map(figure => {
      const graphics = nodes(figure, 'graphic'), graphic = graphics.find(g => g.getAttribute('content-type') === 'image') ?? graphics[0]
      if (!graphic) return null
      const cloud = [...graphic.childNodes].find(n => n.nodeType === 7 && n.nodeName === 'cloudpmc-path')?.nodeValue?.trim()
      const href = graphic.getAttribute('xlink:href')
      const url = cloud && /^blobs\/[\w/.-]+$/.test(cloud) ? 'https://cdn.ncbi.nlm.nih.gov/pmc/' + cloud : /^https:\/\//.test(href) ? href : ''
      if (!url) return null // Never invent a /bin URL when the XML does not expose an actual asset.
      const caption = textOf(figure, 'caption'), thirdParty = /biorender|reprint|permission|copyright|©/i.test(caption)
      return { title: `${textOf(figure, 'label')} · ${article.title}`.slice(0, 220), caption: caption.slice(0, 1800), image_url: url, thumb_url: url, page_url: `https://europepmc.org/articles/${article.pmcid}#${encodeURIComponent(figure.getAttribute('id'))}`, author: article.authorString ?? '', license: thirdParty ? '' : licenseLink ?? '', article_license: licenseLink ?? '', ...(thirdParty ? { rights_note: '图注涉及第三方创作或转载，需按该图说明核对授权' } : {}), source: 'europepmc', pmcid: article.pmcid, figure: textOf(figure, 'label'), relevance: score(caption, query) }
    }).filter(Boolean)
  }))
  const all = groups.flatMap(g => g.status === 'fulfilled' ? g.value : [])
  if (!all.length && groups.some(g => g.status === 'rejected')) throw new Error('全文图版读取失败：' + groups.filter(g => g.status === 'rejected').map(g => g.reason?.message || g.reason).join('; ').slice(0, 160))
  return all.sort((a, b) => b.relevance - a.relevance).slice(0, limit)
}
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map(m => [m[1], strip(m[3])]))
}
export async function searchServier(query, limit) {
  const html = await request('https://smart.servier.com/?s=' + encodeURIComponent(query), { json: false })
  const cards = html.match(/<article\b[^>]*class=["'][^"']*result-thumbnail[^"']*["'][\s\S]*?<\/article>/gi) ?? []
  const result = cards.slice(0, limit).flatMap(card => {
    const img = card.match(/<img\b[^>]*wp-post-image[^>]*>/i)?.[0], link = card.match(/<a\b[^>]*result-thumbnail-image[^>]*>/i)?.[0]
    if (!img || !link) return []
    const meta = attributes(img), anchor = attributes(link)
    const variants = (meta.srcset || '').split(',').map(v => v.trim().split(/\s+/)).filter(v => /^https:\/\/smart\.servier\.com\//.test(v[0])).sort((a, b) => parseInt(b[1]) - parseInt(a[1]))
    const image_url = variants[0]?.[0] || meta.src
    if (!image_url?.startsWith('https://smart.servier.com/') || !anchor.href?.startsWith('https://smart.servier.com/smart_image/')) return []
    return [{ title: meta.alt || anchor.href.split('/').filter(Boolean).pop(), image_url, thumb_url: meta.src, page_url: anchor.href, author: 'Servier Medical Art', license: 'CC BY 4.0', license_url: 'https://smart.servier.com/using-smart-images-what-you-can-do/', source: 'servier' }]
  })
  return result
}
const BOOKS = [
  ['osbooks-physics', /physics|force|motion|energy|electric|物理|力学|运动|能量/i],
  ['osbooks-biology-bundle', /biology|cell|mitochond|protein|gene|生物|细胞|线粒体|蛋白|基因/i],
  ['osbooks-chemistry-bundle', /chem|atom|molecul|化学|原子|分子/i],
  ['osbooks-anatomy-physiology', /anatom|heart|organ|解剖|心脏|器官/i],
  ['osbooks-calculus-bundle', /math|calculus|derivative|integral|数学|微积分|导数|积分/i],
  ['osbooks-introductory-statistics-bundle', /statistic|probab|distribution|统计|概率|分布/i],
]
export async function searchOpenstax(query, limit) {
  const chosen = BOOKS.filter(([, match]) => match.test(query)).slice(0, 2)
  if (!chosen.length) chosen.push(BOOKS[0], BOOKS[1])
  const groups = await Promise.allSettled(chosen.map(async ([repo]) => {
    const tree = await request(`https://api.github.com/repos/openstax/${repo}/git/trees/main?recursive=1`, { persistent: true })
    if (!Array.isArray(tree.tree) || tree.truncated) throw new Error('OpenStax 教材目录不完整')
    let license = '', license_url = ''
    const collection = tree.tree.find(f => /^collections\/.*\.collection\.xml$/.test(f.path))
    if (collection) {
      const doc = xml(await request(`https://raw.githubusercontent.com/openstax/${repo}/main/${encPath(collection.path)}`, { persistent: true, json: false }))
      const licenses = nodes(doc, 'md:license'); license_url = licenses[0]?.getAttribute('url') || ''; license = licenses[0]?.textContent?.trim() || license_url
    }
    return tree.tree.filter(f => /^media\/.+\.(png|jpe?g|svg)$/i.test(f.path)).map(file => ({ file, relevance: score(file.path.replace(/[_-]/g, ' '), query) })).filter(f => f.relevance > 0).sort((a, b) => b.relevance - a.relevance).slice(0, limit).map(({ file }) => {
      const url = `https://raw.githubusercontent.com/openstax/${repo}/main/${encPath(file.path)}`
      return { title: file.path.split('/').pop().replace(/[_-]/g, ' '), image_url: url, thumb_url: url, page_url: `https://github.com/openstax/${repo}/blob/main/${encPath(file.path)}`, author: 'OpenStax / individual figure creator', license, license_url, rights_note: '教材级授权；仍需核对单图图注中的创作者和第三方声明。当前按文件名匹配，须读图确认。', source: 'openstax', book: repo }
    })
  }))
  const result = groups.flatMap(g => g.status === 'fulfilled' ? g.value : [])
  if (!result.length && groups.every(g => g.status === 'rejected')) throw new Error('OpenStax 官方教材索引暂不可达')
  return result.slice(0, limit)
}
export const EXTRA_IMAGE_PROVIDERS = { europepmc: searchEuropePmc, openstax: searchOpenstax, servier: searchServier, bioicons: searchBioicons, wellcome: searchWellcome }
export function chooseImageProviders(query) {
  const base = ['wikimedia', 'openverse']
  if (/history|historic|历史|科学史|古籍/i.test(query)) return [...base, 'wellcome']
  if (/cell|protein|gene|mitochond|细胞|蛋白|基因|线粒体|instrument|仪器/i.test(query)) return [...base, 'bioicons', 'europepmc']
  if (/anatom|heart|disease|medical|解剖|心脏|疾病|医学/i.test(query)) return [...base, 'servier', 'europepmc']
  return [...base, 'openstax']
}
