// 本地 RAG：transformers.js(ONNX) 中英双语 embedding + 纯文件向量库 + 串行索引队列。
// 索引来源：vault 内全部 md 笔记、PDF 文本（按页）、用户在 PDF 学习器里的标注与卡片。
// 存储在 <vault>/.agent/rag/（index.json + vectors.bin），换 embedding 模型自动全量重索引。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as vault from './vault.js'
import { loadSettings } from './settings.js'
import { extractPdfPages } from './agent/pdf.js'
import { loadDoc } from './pdfstudy.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MODEL_CACHE_DIR = path.join(__dirname, '..', '.learn-agent', 'models')

// ── 模型预设 ────────────────────────────────────────────────────────────────

export const RAG_MODELS = {
  'jina-v2-base-zh': {
    id: 'Xenova/jina-embeddings-v2-base-zh',
    dim: 768,
    label: 'Jina v2 base zh（中英双语 · 推荐）',
    queryPrefix: 'Query: ',
    size: '~160MB',
  },
  'bge-m3': {
    id: 'Xenova/bge-m3',
    dim: 1024,
    label: 'BGE-M3（最强多语 · 较慢）',
    queryPrefix: '',
    size: '~600MB',
  },
  'm-e5-small': {
    id: 'Xenova/multilingual-e5-small',
    dim: 384,
    label: 'Multilingual E5 small（轻量）',
    queryPrefix: 'query: ',
    size: '~120MB',
  },
}

export function currentModelKey() {
  const s = loadSettings()
  return RAG_MODELS[s.ragModel] ? s.ragModel : 'jina-v2-base-zh'
}

// ── embedding 管线（懒加载单例） ─────────────────────────────────────────────

let tf = null
let extractor = null
let extractorModel = ''
let failModel = ''
let failError = ''

async function getExtractor() {
  const key = currentModelKey()
  if (extractor && extractorModel === key) return extractor
  if (failModel === key) throw new Error(failError)
  if (!tf) {
    tf = await import('@huggingface/transformers')
    tf.env.cacheDir = MODEL_CACHE_DIR
    tf.env.allowLocalModels = false
  }
  const cfg = RAG_MODELS[key]
  state.status = 'loading'
  state.model = key
  state.downloadProgress = 0
  const progress_callback = (p) => {
    if (p.status === 'progress' && typeof p.file === 'string' && p.file.includes('model')) {
      state.downloadProgress = Math.round(p.progress || 0)
    }
  }
  try {
    try {
      extractor = await tf.pipeline('feature-extraction', cfg.id, { dtype: 'q8', progress_callback })
    } catch {
      extractor = await tf.pipeline('feature-extraction', cfg.id, { progress_callback })
    }
    extractorModel = key
    failModel = ''
    failError = ''
    state.status = 'ready'
    state.error = ''
    state.downloadProgress = 100
    return extractor
  } catch (e) {
    failModel = key
    failError = 'embedding 模型加载失败：' + String(e.message || e) + '（首次使用需联网下载模型，请检查网络/代理）'
    state.status = 'error'
    state.error = failError
    throw new Error(failError)
  }
}

/** 文本数组 → 归一化向量数组 */
async function embed(texts) {
  const pipe = await getExtractor()
  const out = []
  const BATCH = 8
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH).map((t) => t.slice(0, 2000))
    const res = await pipe(batch, { pooling: 'mean', normalize: true })
    if (Array.isArray(res)) {
      for (const t of res) out.push(Float32Array.from(t.data))
    } else {
      const dims = res.dims ?? []
      const dim = dims[dims.length - 1] || Math.floor(res.data.length / batch.length)
      for (let j = 0; j < batch.length; j++) {
        out.push(Float32Array.from(res.data.slice(j * dim, (j + 1) * dim)))
      }
    }
  }
  return out
}

// ── 向量存储（<vault>/.agent/rag/） ──────────────────────────────────────────

let store = { model: '', dim: 0, chunks: [], vectors: new Float32Array(0), count: 0 }
let storeLoaded = false
let saveTimer = null

function ragDir() {
  return vault.resolveInVault('.agent/rag')
}

function loadStore() {
  storeLoaded = true
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(ragDir(), 'index.json'), 'utf8'))
    if (Array.isArray(meta.chunks)) {
      store.model = meta.model || ''
      store.dim = meta.dim || 0
      store.chunks = meta.chunks
      store.count = meta.chunks.length
      const bin = path.join(ragDir(), 'vectors.bin')
      if (fs.existsSync(bin) && store.dim > 0 && store.count > 0) {
        const buf = fs.readFileSync(bin)
        const expect = store.count * store.dim * 4
        if (buf.length >= expect) store.vectors = new Float32Array(buf.buffer, buf.byteOffset, store.count * store.dim)
      }
      if (!store.vectors) store.vectors = new Float32Array(store.count * store.dim)
    }
  } catch {
    store = { model: '', dim: 0, chunks: [], vectors: new Float32Array(0), count: 0 }
  }
}

function saveStore() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const dir = ragDir()
      fs.mkdirSync(dir, { recursive: true })
      const tmpJson = path.join(dir, 'index.json.tmp')
      fs.writeFileSync(tmpJson, JSON.stringify({ model: store.model, dim: store.dim, chunks: store.chunks }, null, 1), 'utf8')
      fs.renameSync(tmpJson, path.join(dir, 'index.json'))
      if (store.vectors && store.count > 0 && store.dim > 0) {
        const buf = Buffer.from(store.vectors.buffer, store.vectors.byteOffset, store.count * store.dim * 4)
        const tmpBin = path.join(dir, 'vectors.bin.tmp')
        fs.writeFileSync(tmpBin, buf)
        fs.renameSync(tmpBin, path.join(dir, 'vectors.bin'))
      }
    } catch (e) {
      console.error('[rag] 保存索引失败:', e.message)
    }
  }, 500)
}

/** 用新的全量块集合替换 store（重建向量矩阵） */
function rebuild(chunks, vecs, dim) {
  const v = new Float32Array(chunks.length * dim)
  vecs.forEach((x, i) => v.set(x, i * dim))
  store.chunks = chunks
  store.vectors = v
  store.count = chunks.length
  store.dim = dim
  store.model = currentModelKey()
  saveStore()
}

/** 替换某文件的全部块（保留其他文件的向量） */
function replaceChunksForPath(rel, newChunks, newVectors) {
  const dim = store.dim || newVectors[0]?.length || 0
  const keepChunks = []
  const keepVecs = []
  for (let i = 0; i < store.chunks.length; i++) {
    const c = store.chunks[i]
    if (c.path === rel) continue
    keepChunks.push(c)
    keepVecs.push(store.vectors.subarray(i * dim, (i + 1) * dim))
  }
  rebuild([...keepChunks, ...newChunks], [...keepVecs, ...newVectors], dim || newVectors[0]?.length || 0)
}

function removeChunksForPath(rel) {
  if (!store.chunks.some((c) => c.path === rel)) return
  replaceChunksForPath(rel, [], [])
}

// ── 分块 ────────────────────────────────────────────────────────────────────

function chunkMarkdown(rel, content) {
  const fm = content.match(/^---\r?\n[\s\S]*?\r?\n---/)?.[0] ?? ''
  const body = content.slice(fm.length)
  const docTitle = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || rel.split('/').pop().replace(/\.md$/i, '')
  const chunks = []
  let head = docTitle
  let buf = []
  let len = 0
  const push = () => {
    const text = buf.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    if (text.length > 30) chunks.push({ path: rel, kind: 'md', title: head, text: `《${docTitle}》· ${head}\n${text}` })
    buf = []
    len = 0
  }
  for (const line of body.split('\n')) {
    const h = line.match(/^(#{1,6})\s+(.+)/)
    if (h && (len > 450 || h[1].length <= 2)) {
      push()
      head = h[2].trim()
    }
    buf.push(line)
    len += line.length + 1
    if (len > 1400) push()
  }
  push()
  return chunks
}

function chunkPdfPages(rel, pages) {
  const docTitle = rel.split('/').pop().replace(/\.pdf$/i, '')
  const chunks = []
  let buf = []
  let startPage = 1
  let len = 0
  const push = (endPage) => {
    const text = buf.join('\n').trim()
    if (text.length > 30) {
      chunks.push({
        path: rel,
        kind: 'pdf',
        title: docTitle + (startPage === endPage ? `（第${startPage}页）` : `（第${startPage}–${endPage}页）`),
        page: startPage,
        pageEnd: endPage,
        text: `《${docTitle}》第${startPage}${startPage === endPage ? '' : '–' + endPage}页\n${text}`,
      })
    }
    buf = []
    len = 0
  }
  pages.forEach((t, i) => {
    if (!len) startPage = i + 1
    buf.push(`【第${i + 1}页】${(t || '').replace(/\s+/g, ' ').trim()}`)
    len += (t || '').length
    if (len > 1400) push(i + 1)
  })
  if (len) push(pages.length)
  return chunks
}

const TYPE_LABEL_SHORT = { highlight: '荧光笔', underline: '下划线', squiggly: '波浪线', strikethrough: '删除线', 'tag-anchor': '标签' }

function chunkAnnotations(rel, doc) {
  const docTitle = rel.split('/').pop().replace(/\.pdf$/i, '')
  const chunks = []
  for (const a of doc.annotations) {
    if (a.type === 'image') continue
    const tags = a.tags?.length ? ' 标签:' + a.tags.map((t) => '#' + t).join(' ') : ''
    let text = ''
    if (a.type === 'mask') text = `【用户遮挡自测框】（该处内容被用户遮住，用于自查提问）`
    else if (a.text) text = `【用户${TYPE_LABEL_SHORT[a.type] ?? '标注'}】"${a.text}"${tags}`
    else continue
    chunks.push({ path: rel, kind: 'ann', title: `标注·第${a.page}页`, page: a.page, text: `《${docTitle}》${text}` })
  }
  for (const c of doc.cards) {
    const body = String(c.markdown ?? '').slice(0, 1200)
    if (!body && !c.title) continue
    chunks.push({
      path: rel,
      kind: 'card',
      title: c.title || '卡片',
      page: c.anchor?.page,
      text: `《${docTitle}》【用户卡片·${c.purpose}】${c.title || ''}\n${body}`,
    })
  }
  return chunks
}

// ── 索引队列 ────────────────────────────────────────────────────────────────

export const state = {
  status: 'idle', // idle | loading | ready | error
  model: '',
  error: '',
  downloadProgress: 0,
  queue: [],
  processed: 0,
}

const pendingTimers = new Map()
const mtimeCache = new Map() // rel -> {mtimeMs, size}
let draining = false

function fileStat(rel) {
  try {
    const st = fs.statSync(vault.resolveInVault(rel))
    return { mtimeMs: Math.floor(st.mtimeMs), size: st.size }
  } catch {
    return null
  }
}

/** 防抖入队（agent 流式写入/连续保存只触发一次） */
export function enqueue(rel, delayMs = 2500) {
  const k = String(rel).replace(/\\/g, '/')
  const prev = pendingTimers.get(k)
  if (prev) clearTimeout(prev)
  const timer = setTimeout(() => {
    pendingTimers.delete(k)
    if (!state.queue.includes(k)) state.queue.push(k)
    void drain()
  }, delayMs)
  pendingTimers.set(k, timer)
}

export function removeFile(rel) {
  const k = String(rel).replace(/\\/g, '/')
  const i = state.queue.indexOf(k)
  if (i >= 0) state.queue.splice(i, 1)
  removeChunksForPath(k)
  mtimeCache.delete(k)
}

async function drain() {
  if (draining) return
  draining = true
  try {
    while (state.queue.length) {
      const rel = state.queue.shift()
      state.processed++
      try {
        await indexFile(rel)
      } catch (e) {
        console.error('[rag] 索引失败:', rel, e.message)
      }
    }
  } finally {
    draining = false
    if (state.status === 'loading') state.status = extractor ? 'ready' : state.status
  }
}

async function chunkSpecsFor(rel) {
  if (/\.pdf$/i.test(rel)) {
    const { pages } = await extractPdfPages(rel)
    const specs = chunkPdfPages(rel, pages)
    specs.push(...chunkAnnotations(rel, loadDoc(rel)))
    return specs
  }
  const content = fs.readFileSync(vault.resolveInVault(rel), 'utf8')
  return chunkMarkdown(rel, content)
}

async function indexFile(rel) {
  if (!/\.md$|\.pdf$/i.test(rel)) return
  const stat = fileStat(rel)
  if (!stat) return
  const prev = mtimeCache.get(rel)
  const hasChunks = store.chunks.some((c) => c.path === rel)
  if (prev && prev.mtimeMs === stat.mtimeMs && prev.size === stat.size && hasChunks) return // 未变化
  const specs = await chunkSpecsFor(rel)
  if (!specs.length) {
    if (hasChunks) removeChunksForPath(rel)
    mtimeCache.set(rel, stat)
    return
  }
  const vectors = await embed(specs.map((s) => s.text))
  replaceChunksForPath(rel, specs, vectors)
  mtimeCache.set(rel, stat)
}

/** 全量扫描入库 */
export async function fullScan() {
  const files = [...vault.listAllNotes(), ...vault.listAllFiles(['.pdf'])]
  for (const f of files) enqueue(f, 300)
}

export async function reindexAll() {
  state.queue = []
  for (const t of pendingTimers.values()) clearTimeout(t)
  pendingTimers.clear()
  store = { model: '', dim: 0, chunks: [], vectors: new Float32Array(0), count: 0 }
  mtimeCache.clear()
  saveStore()
  await getExtractor().catch(() => undefined)
  await fullScan()
}

/** 换模型 → 全量重索引 */
export async function onModelChange() {
  const key = currentModelKey()
  if (store.model === key && store.count) return
  await reindexAll()
}

/** 标注/卡片变化后重索引该 PDF 的标注块（不动文本块） */
export async function reindexAnnotations(rel) {
  if (!store.chunks.some((c) => c.path === rel)) {
    enqueue(rel) // PDF 文本块还没入库，交给常规队列一起处理
    return
  }
  try {
    const dim = store.dim
    if (!dim) return
    const specs = chunkAnnotations(rel, loadDoc(rel))
    const keepChunks = []
    const keepVecs = []
    for (let i = 0; i < store.chunks.length; i++) {
      const c = store.chunks[i]
      if (c.path === rel && (c.kind === 'ann' || c.kind === 'card')) continue
      keepChunks.push(c)
      keepVecs.push(store.vectors.subarray(i * dim, (i + 1) * dim))
    }
    const vectors = specs.length ? await embed(specs.map((s) => s.text)) : []
    rebuild([...keepChunks, ...specs], [...keepVecs, ...vectors], dim)
  } catch (e) {
    console.error('[rag] 重索引标注失败:', e.message)
  }
}

// ── 检索 ────────────────────────────────────────────────────────────────────

export async function search(query, k = 8) {
  if (!storeLoaded) loadStore()
  if (store.model !== currentModelKey()) void onModelChange() // 模型换了：后台重索引
  if (!store.count) return { results: [], note: '知识库索引为空，正在后台建立索引，请稍后再试' }
  const cfg = RAG_MODELS[currentModelKey()]
  const [qv] = await embed([cfg.queryPrefix + query])
  if (!qv || qv.length !== store.dim) return { results: [], note: '向量维度与当前模型不匹配，正在重索引，请稍后再试' }
  const scored = []
  for (let i = 0; i < store.count; i++) {
    let dot = 0
    const base = i * store.dim
    for (let d = 0; d < store.dim; d++) dot += store.vectors[base + d] * qv[d]
    scored.push([i, dot])
  }
  scored.sort((a, b) => b[1] - a[1])
  const results = scored.slice(0, k).map(([i, score]) => {
    const c = store.chunks[i]
    return {
      path: c.path,
      kind: c.kind,
      page: c.page,
      pageEnd: c.pageEnd,
      title: c.title,
      score: Number(score.toFixed(4)),
      text: c.text.slice(0, 900),
    }
  })
  return { results }
}

export function status() {
  if (!storeLoaded) loadStore()
  const key = currentModelKey()
  return {
    model: key,
    modelId: RAG_MODELS[key].id,
    modelLabel: RAG_MODELS[key].label,
    modelSize: RAG_MODELS[key].size,
    status: state.status,
    error: state.error,
    downloadProgress: state.downloadProgress,
    chunks: store.count,
    files: new Set(store.chunks.map((c) => c.path)).size,
    queue: state.queue.length + pendingTimers.size,
    vaultFiles: vault.listAllNotes().length + vault.listAllFiles(['.pdf']).length,
  }
}

/** 服务启动时调用：载入索引 + 延迟全量扫描 */
export function initRag() {
  loadStore()
  if (store.model && store.model !== currentModelKey()) {
    void onModelChange().catch(() => undefined)
    return
  }
  setTimeout(() => void fullScan().catch(() => undefined), 4000)
}
