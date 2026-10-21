// 搜图 + 本地图文语义重排 + 下载入库，供可视化/内容 Agent 的 search_images / download_image 工具使用。
//
// 图源（按当前网络可达性自适应，全部无 Key）：
// - Bing 图片     —— 覆盖面最广、国内可达；无授权元数据（引用时以来源页为准）
// - Openverse     —— CC 授权过滤、学术友好；被墙时自动跳过
// - Wikimedia Commons —— 百科学术图；被墙时自动跳过
//
// 语义重排：本地 SigLIP 图文模型（transformers.js ONNX，与 RAG 共用缓存目录）。
// 注：transformers.js（至 4.3.0）尚未支持 SigLIP 2 架构，这里用同家族的
// SigLIP v1；待其支持后把 IMAGE_MODEL 换成 siglip2 模型 id 即可。
// HF 直连不可达的网络自动走 hf-mirror.com 镜像。
import path from 'node:path'
import fs from 'node:fs'
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import * as vault from '../vault.js'
import { imageHash, saveImageSource } from './imageAssets.js'
import { EXTRA_IMAGE_PROVIDERS, chooseImageProviders, recordImageSourceStatus } from './imageSources.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MODEL_CACHE_DIR = path.join(__dirname, '..', '..', '.learn-agent', 'models')
const IMAGE_MODEL = 'Xenova/siglip-base-patch16-224'
const UA = {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  },
}
function timeout(ms) {
  return AbortSignal.timeout(ms)
}

// ── 源：360 图片（国内可达、无需 Key、查询词生效） ───────────────────────────

async function search360(query, limit) {
  const url = 'https://image.so.com/j?q=' + encodeURIComponent(query) + '&src=srp&correct=&pn=' + Math.min(50, limit * 2) + '&sn=0'
  const res = await fetch(url, { ...UA, headers: { ...UA.headers, Referer: 'https://image.so.com/' }, signal: timeout(12000) })
  if (!res.ok) throw new Error('so360 ' + res.status)
  const json = await res.json()
  return (json.list ?? []).slice(0, limit).map((r) => ({
    title: String(r.title || '(无标题)').replace(/<[^>]*>/g, '').slice(0, 160),
    image_url: r.img,
    thumb_url: r.thumb || r.img,
    page_url: r.link || '',
    license: '',
    author: r.site || '',
    source: 'so360',
    width: Number(r.width) || 0,
    height: Number(r.height) || 0,
  }))
}

// ── 源：Openverse（CC 授权） ─────────────────────────────────────────────────

async function searchOpenverse(query, limit) {
  const url = 'https://api.openverse.org/v1/images/?q=' + encodeURIComponent(query) + '&page_size=' + Math.min(20, limit * 2) + '&license_type=all'
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: timeout(10000) })
  if (!res.ok) throw new Error('openverse ' + res.status)
  const json = await res.json()
  return (json.results ?? []).slice(0, limit).map((r) => ({
    title: String(r.title || '(无标题)').slice(0, 160),
    image_url: r.url,
    thumb_url: r.thumbnail || r.url,
    page_url: r.foreign_landing_url || '',
    license: [r.license, r.license_version].filter(Boolean).join(' ').toUpperCase(),
    author: String(r.creator || '').slice(0, 80),
    source: 'openverse',
  }))
}

// ── 源：Wikimedia Commons ────────────────────────────────────────────────────

async function searchWikimedia(query, limit) {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrsearch=' +
    encodeURIComponent(query) +
    '&gsrlimit=' +
    Math.min(15, limit * 2) +
    '&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1024'
  const res = await fetch(url, { ...UA, signal: timeout(10000) })
  if (!res.ok) throw new Error('wikimedia ' + res.status)
  const json = await res.json()
  const pages = json?.query?.pages ?? {}
  return Object.values(pages)
    .slice(0, limit)
    .map((p) => {
      const info = p.imageinfo?.[0] ?? {}
      const strip = (s) => String(s ?? '').replace(/<[^>]*>/g, '').slice(0, 80)
      return {
        title: String(p.title || '').replace(/^File:/, ''),
        image_url: info.url,
        thumb_url: info.thumburl || info.url,
        page_url: info.descriptionurl || '',
        license: strip(info.extmetadata?.LicenseShortName?.value),
        author: strip(info.extmetadata?.Artist?.value),
        source: 'wikimedia',
      }
    })
    .filter((r) => r.image_url)
}

// ── SigLIP 图文语义重排 ──────────────────────────────────────────────────────

let ranker = null // { model, tokenizer, processor }
let rankerFailed = ''

async function getRanker() {
  if (ranker) return ranker
  if (rankerFailed) throw new Error(rankerFailed)
  const tf = await import('@huggingface/transformers')
  // SigLIP 的对齐嵌入必须由组合图（model.onnx）同时吃 input_ids + pixel_values
  // 才能得到（logits_per_image / text_embeds / image_embeds）——拆分的
  // text_model / vision_model 的 pooler 不在同一投影空间，余弦全为 0。
  // 国内网络 HF 直连常不可达：先走 hf-mirror，失败再回默认（有 VPN 的环境）。
  const session_options = { intraOpNumThreads: 2, interOpNumThreads: 1 }
  const load = async () => {
    const [model, tokenizer, processor] = await Promise.all([
      tf.AutoModel.from_pretrained(IMAGE_MODEL, { dtype: 'q8', session_options, local_files_only: true, cache_dir: MODEL_CACHE_DIR }),
      tf.AutoTokenizer.from_pretrained(IMAGE_MODEL, { local_files_only: true, cache_dir: MODEL_CACHE_DIR }),
      tf.AutoProcessor.from_pretrained(IMAGE_MODEL, { local_files_only: true, cache_dir: MODEL_CACHE_DIR }),
    ])
    return { model, tokenizer, processor }
  }
  const r = await load()
  ranker = r
  return r
}

/** 对候选图按与 query 的图文相似度重排；模型加载/推理失败时返回 null（调用方保留原序） */
async function rerank(query, candidates) {
  const { model, tokenizer, processor } = await getRanker()
  const { RawImage } = await import('@huggingface/transformers')
  // 下载缩略图（失败条目剔除）
  const images = []
  const kept = []
  for (const c of candidates) {
    try {
      const res = await fetch(c.thumb_url, { ...UA, signal: timeout(5000) })
      if (!res.ok) continue
      const buf = await res.arrayBuffer()
      if (buf.byteLength < 500) continue
      images.push(await RawImage.fromBlob(new Blob([buf])))
      kept.push(c)
    } catch {
      /* 单张下载失败跳过 */
    }
  }
  if (!images.length) return null
  // 逐张成对前向：SigLIP 组合导出图的 B>1 批处理存在乱序 bug（B=1 排序正确），
  // 每次前向 = 查询文本 + 一张候选图，logits_per_image[0] 即该图的匹配分
  const textInputs = await tokenizer([query], { padding: true, truncation: true })
  const scored = []
  for (let i = 0; i < images.length; i++) {
    try {
      const imgInputs = await processor(images[i])
      const out = await model({ ...textInputs, ...imgInputs })
      scored.push({ ...kept[i], score: Math.round((out.logits_per_image?.data?.[0] ?? -99) * 100) / 100 })
    } catch {
      /* 单张推理失败跳过 */
    }
  }
  scored.sort((a, b) => b.score - a.score)
  return scored
}

// ── 对外入口 ─────────────────────────────────────────────────────────────────

/** Provider failures are visible. A search never starts a large model download. */
export async function searchWebImages(query, count = 6, options = {}) {
  const registry = { so360: search360, openverse: searchOpenverse, wikimedia: searchWikimedia, ...EXTRA_IMAGE_PROVIDERS }
  const ids = [...new Set(options.providers?.length ? options.providers : chooseImageProviders(query))]
  if (ids.some(id => !Object.prototype.hasOwnProperty.call(registry, id))) throw new Error('不支持的图库 providers')
  const settled = await Promise.allSettled(ids.map(id => registry[id](query, Math.min(12, Math.max(3, count * 2)))))
  settled.forEach((s, i) => recordImageSourceStatus(ids[i], s.status === 'fulfilled' ? 'ok' : 'error', s.status === 'fulfilled' ? s.value.length : 0, s.status === 'rejected' ? String(s.reason?.message || s.reason) : ''))
  if (!options.providers?.length && settled.every(s => s.status === 'rejected' || !s.value.length)) { ids.push('so360'); settled.push(...await Promise.allSettled([search360(query, 12)])) }
  const pools = settled.map(s => s.status === 'fulfilled' ? s.value : [])
  const mixed = []
  for (let i = 0; i < Math.max(...pools.map(p => p.length)); i++) for (const pool of pools) if (pool[i]) mixed.push(pool[i])
  const seen = new Set()
  const terms = String(query).toLowerCase().match(/[a-z0-9]+|[\u3400-\u9fff]{2,}/g) ?? []
  const equivalents = { poisson: '泊松', distribution: '分布', probability: '概率', normal: '正态', binomial: '二项', neural: '神经', network: '网络', architecture: '结构', diagram: '示意', derivative: '导数', matrix: '矩阵', vector: '向量' }
  const keywords = [...terms, ...terms.map(term => equivalents[term]).filter(Boolean)]
  const cands = mixed.filter(c => /^https?:\/\//i.test(c.image_url ?? '') && !seen.has(c.image_url) && seen.add(c.image_url))
    .filter(c => /竞彩|博彩|投注|赌博|casino|betting/i.test(query) || !/竞彩|博彩|投注|赌博|casino|betting/i.test(c.title))
    .map(c => ({ ...c, metadata_score: keywords.reduce((s, word) => s + (`${c.title} ${c.page_url}`.toLowerCase().includes(word) ? 1 : 0), 0) }))
    .sort((a, b) => b.metadata_score - a.metadata_score)
  const warnings = settled.flatMap((s, i) => s.status === 'rejected' ? [`${ids[i]}：${String(s.reason?.message || s.reason).slice(0, 160)}`] : [])
  const sourceStat = {}
  settled.forEach((s, i) => {
    if (s.status === 'rejected') console.log(`[imgsearch] ${ids[i]} 不可用:`, String(s.reason?.message || s.reason).slice(0, 80))
  })
  for (const c of cands) sourceStat[c.source] = (sourceStat[c.source] ?? 0) + 1
  // 控制重排规模：优先混合来源，最多 16 张下载缩略图参与推理
  const cachedModel = fs.existsSync(path.join(MODEL_CACHE_DIR, 'Xenova', 'siglip-base-patch16-224', 'onnx'))
  const ranked = cands.length && cachedModel && options.rerank !== false ? await rerank(query, cands.slice(0, 6)).catch((e) => {
    console.error('[imgsearch] SigLIP 重排失败，按原序返回:', e?.message || e)
    rankerFailed = '' // 失败不永久禁用（可能是单次网络抖动）
    warnings.push('本地图文重排不可用，保留检索排序')
    return null
  }) : null
  const result = (ranked?.length ? ranked : cands).slice(0, Math.max(1, Math.min(10, count)))
  console.log(`[imgsearch] "${query}" 候选 ${cands.length}（${JSON.stringify(sourceStat)}）→ 返回 ${result.length}${ranked ? '（已语义重排）' : '（未重排）'}`)
  return { results: result, warnings, providers: ids, ranking: ranked?.length ? 'SigLIP' : 'provider' }
}
export async function searchImages(query, count = 6) { return (await searchWebImages(query, count)).results }

/** 下载一张图进 vault（默认 assets/images/），返回可嵌入笔记的相对路径 */
export async function downloadImageToVault({ url, path: relPath, page_url = '', title = '', author = '', license = '', license_url = '', provider = '', caption = '', rights_note = '' }) {
  if (!/^https?:\/\//.test(String(url || ''))) throw new Error('url 必须是 http(s) 链接')
  const parsed = new URL(url)
  if (parsed.username || parsed.password || /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[::1\])/i.test(parsed.hostname)) throw new Error('网络图片须使用公网URL；本地图片请用read_image')
  const res = await fetch(url, { ...UA, signal: timeout(20000) })
  if (!res.ok) throw new Error('下载失败 HTTP ' + res.status)
  const type = String(res.headers.get('content-type') || '')
  if (!type.startsWith('image/')) throw new Error('链接不是图片（' + (type || '未知类型') + '）')
  const declared = Number(res.headers.get('content-length'))
  if (declared > 15 * 1024 * 1024) { await res.body?.cancel(); throw new Error('图片超过15MB') }
  const chunks = []; let bytes = 0
  for await (const chunk of res.body) { bytes += chunk.length; if (bytes > 15 * 1024 * 1024) throw new Error('图片超过15MB'); chunks.push(chunk) }
  const buf = Buffer.concat(chunks)
  if (buf.length > 15 * 1024 * 1024) throw new Error('图片超过 15MB')
  const decoded = await sharp(buf, { limitInputPixels: 16000000, animated: false }).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true })
  if (decoded.data.length > 10 * 1024 * 1024) throw new Error('解码后图片超过10MB')
  let p = String(relPath || '').trim().replace(/\\/g, '/')
  if (!p) {
    p = `assets/images/${imageHash(decoded.data)}.png`
  }
  p = p.replace(/\.(jpe?g|png|webp|gif|svg)$/i, '') + '.png'
  if (fs.existsSync(vault.resolveInVault(p)) && !fs.readFileSync(vault.resolveInVault(p)).equals(decoded.data)) p = p.slice(0, -4) + '-' + imageHash(decoded.data) + '.png'
  vault.writeFile(p, decoded.data)
  saveImageSource(p, { url: String(url), page_url: String(page_url).slice(0, 2000), title: String(title).slice(0, 300), author: String(author).slice(0, 200), license: String(license).slice(0, 200), license_url: String(license_url).slice(0, 2000), provider: String(provider).slice(0, 40), caption: String(caption).slice(0, 1800), rights_note: String(rights_note).slice(0, 500), width: decoded.info.width, height: decoded.info.height })
  vault.notifyWrite(p, 'add')
  return { path: p, bytes: decoded.data.length, width: decoded.info.width, height: decoded.info.height, page_url, author, license, hint: '已成功解码入库。用read_image核对内容后嵌入，并保留来源页；未提供授权不表示可自由使用。' }
}
