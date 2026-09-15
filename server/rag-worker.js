// RAG embedding 专用 worker 线程：transformers.js 的 ONNX 推理非常吃 CPU，
// 若在 HTTP 主线程执行会把事件循环饿死（所有接口延迟数秒）。独立线程跑推理，
// 主线程通过 {type:'embed', id, texts, modelKey} RPC 调用，向量经结构化克隆返回。
import { parentPort } from 'node:worker_threads'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RAG_MODELS } from './rag-models.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MODEL_CACHE_DIR = path.join(__dirname, '..', '.learn-agent', 'models')

let tf = null
let extractor = null
let extractorModel = ''
const fails = new Map() // modelKey -> 失败原因（避免反复重试坏模型）

const post = (m) => parentPort.postMessage(m)

async function getExtractor(key) {
  if (extractor && extractorModel === key) return extractor
  if (fails.has(key)) throw new Error(fails.get(key))
  if (!tf) {
    tf = await import('@huggingface/transformers')
    tf.env.cacheDir = MODEL_CACHE_DIR
    tf.env.allowLocalModels = false
  }
  const cfg = RAG_MODELS[key]
  post({ type: 'status', status: 'loading', model: key, downloadProgress: 0 })
  const progress_callback = (p) => {
    if (p.status === 'progress' && typeof p.file === 'string' && p.file.includes('model')) {
      post({ type: 'status', status: 'loading', model: key, downloadProgress: Math.round(p.progress || 0) })
    }
  }
  // 限制 ONNX 推理线程数：不设限会用满全部核心，整台机器（含浏览器）都会卡死
  const session_options = { intraOpNumThreads: 2, interOpNumThreads: 1, executionProviders: ['cpu'] }
  try {
    try {
      extractor = await tf.pipeline('feature-extraction', cfg.id, { dtype: 'q8', progress_callback, session_options })
    } catch {
      extractor = await tf.pipeline('feature-extraction', cfg.id, { progress_callback, session_options })
    }
    extractorModel = key
    post({ type: 'status', status: 'ready', model: key, downloadProgress: 100 })
    return extractor
  } catch (e) {
    extractor = null
    const msg = 'embedding 模型加载失败：' + String(e.message || e) + '（首次使用需联网下载模型，请检查网络/代理）'
    fails.set(key, msg)
    post({ type: 'status', status: 'error', model: key, error: msg })
    throw new Error(msg)
  }
}

/** 文本数组 → 归一化向量数组 */
async function embed(texts, key) {
  const pipe = await getExtractor(key)
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

parentPort.on('message', async (msg) => {
  if (msg?.type !== 'embed') return
  try {
    const vectors = await embed(msg.texts ?? [], msg.modelKey)
    post({ id: msg.id, vectors }, vectors.map((v) => v.buffer))
  } catch (e) {
    post({ id: msg.id, error: String(e?.message || e) })
  }
})
