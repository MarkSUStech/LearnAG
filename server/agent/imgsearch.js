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
import { fileURLToPath } from 'node:url'
import * as vault from '../vault.js'

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
    encodeURIComponent(query + ' filetype:bitmap') +
    '&gsrlimit=' +
    Math.min(15, limit * 2) +
    '&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1024'
  const res = await fetch(url, { headers: UA, signal: timeout(10000) })
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
  tf.env.cacheDir = MODEL_CACHE_DIR
  tf.env.allowLocalModels = false
  // SigLIP 的对齐嵌入必须由组合图（model.onnx）同时吃 input_ids + pixel_values
  // 才能得到（logits_per_image / text_embeds / image_embeds）——拆分的
  // text_model / vision_model 的 pooler 不在同一投影空间，余弦全为 0。
  // 国内网络 HF 直连常不可达：先走 hf-mirror，失败再回默认（有 VPN 的环境）。
  const session_options = { intraOpNumThreads: 2, interOpNumThreads: 1 }
  const load = async () => {
    const [model, tokenizer, processor] = await Promise.all([
      tf.AutoModel.from_pretrained(IMAGE_MODEL, { dtype: 'q8', session_options }),
      tf.AutoTokenizer.from_pretrained(IMAGE_MODEL),
      tf.AutoProcessor.from_pretrained(IMAGE_MODEL),
    ])
    return { model, tokenizer, processor }
  }
  let r
  try {
    tf.env.remoteHost = 'https://hf-mirror.com'
    r = await load()
  } catch {
    tf.env.remoteHost = 'https://huggingface.co'
    r = await load()
  }
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
      const res = await fetch(c.thumb_url, { headers: UA, signal: timeout(10000) })
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

/** 多源搜索 + 语义重排。返回 [{title, image_url, thumb_url, page_url, license, author, source, score}] */
export async function searchImages(query, count = 6) {
  const settled = await Promise.allSettled([search360(query, 30), searchOpenverse(query, 20), searchWikimedia(query, 15)])
  const byUrl = new Map()
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue
    for (const c of s.value) {
      if (!byUrl.has(c.image_url)) byUrl.set(c.image_url, c)
    }
  }
  let cands = [...byUrl.values()].filter((c) => c.thumb_url || c.image_url)
  const sourceStat = { so360: 0, openverse: 0, wikimedia: 0 }
  settled.forEach((s, i) => {
    if (s.status === 'rejected') console.log(`[imgsearch] ${['so360', 'openverse', 'wikimedia'][i]} 不可用:`, String(s.reason?.message || s.reason).slice(0, 80))
  })
  for (const c of cands) sourceStat[c.source] = (sourceStat[c.source] ?? 0) + 1
  // 控制重排规模：优先混合来源，最多 16 张下载缩略图参与推理
  const ranked = cands.length ? await rerank(query, cands.slice(0, 16)).catch((e) => {
    console.error('[imgsearch] SigLIP 重排失败，按原序返回:', e?.message || e)
    rankerFailed = '' // 失败不永久禁用（可能是单次网络抖动）
    return null
  }) : []
  const result = (ranked ?? cands).slice(0, Math.max(1, Math.min(10, count)))
  console.log(`[imgsearch] "${query}" 候选 ${cands.length}（${JSON.stringify(sourceStat)}）→ 返回 ${result.length}${ranked ? '（已语义重排）' : '（未重排）'}`)
  return result
}

/** 下载一张图进 vault（默认 assets/images/），返回可嵌入笔记的相对路径 */
export async function downloadImageToVault({ url, path: relPath }) {
  if (!/^https?:\/\//.test(String(url || ''))) throw new Error('url 必须是 http(s) 链接')
  const res = await fetch(url, { headers: UA, signal: timeout(20000) })
  if (!res.ok) throw new Error('下载失败 HTTP ' + res.status)
  const type = String(res.headers.get('content-type') || '')
  if (!type.startsWith('image/')) throw new Error('链接不是图片（' + (type || '未知类型') + '）')
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > 15 * 1024 * 1024) throw new Error('图片超过 15MB')
  if (buf.length < 200) throw new Error('图片内容异常（过小）')
  const extFromType = (type.split('/')[1] || 'jpg').split('+')[0].replace('jpeg', 'jpg')
  let p = String(relPath || '').trim().replace(/\\/g, '/')
  if (!p) {
    const slug = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
    p = `assets/images/${slug}.${extFromType}`
  }
  if (!/\.(jpe?g|png|webp|gif|svg)$/i.test(p)) p += '.' + extFromType
  vault.writeFile(p, buf)
  vault.notifyWrite(p, 'add')
  return { path: p, bytes: buf.length }
}
