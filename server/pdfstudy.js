// PDF 学习器：标注/卡片 sidecar 存储 + 贴图资产。
// 数据全部存 <vault>/.agent/pdf-study/，PDF 文件本身永不修改。
import fs from 'node:fs'
import path from 'node:path'
import { resolveInVault } from './vault.js'
import { keyFor } from './pdfdoc.js'

function dataDir() {
  return resolveInVault('.agent/pdf-study')
}

function docFile(relPath) {
  const dir = dataDir()
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, keyFor(relPath) + '.json')
}

function assetsDir(key) {
  return path.join(dataDir(), 'assets', key)
}

const saveTimers = new Map() // key -> timer

function writeDocNow(file, data) {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

export function loadDoc(relPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(docFile(relPath), 'utf8'))
    return {
      annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
      cards: Array.isArray(parsed.cards) ? parsed.cards : [],
    }
  } catch {
    return { annotations: [], cards: [] }
  }
}

/** 防抖保存（250ms，tmp+rename 原子写） */
export function saveDoc(relPath, data) {
  const key = keyFor(relPath)
  const file = docFile(relPath)
  const payload = { annotations: data.annotations ?? [], cards: data.cards ?? [] }
  const prev = saveTimers.get(key)
  if (prev) clearTimeout(prev)
  const timer = setTimeout(() => {
    saveTimers.delete(key)
    try {
      writeDocNow(file, payload)
    } catch (e) {
      console.error('[pdf-study] 保存标注失败:', e.message)
    }
  }, 250)
  saveTimers.set(key, timer)
  return { ok: true }
}

/** 立即落盘（rename/删除前调用） */
export function flushDoc(relPath) {
  const key = keyFor(relPath)
  const timer = saveTimers.get(key)
  if (timer) {
    clearTimeout(timer)
    saveTimers.delete(key)
  }
}

/** 贴图资产上传：base64 → .agent/pdf-study/assets/<key>/<file> */
export function saveAsset(relPath, dataB64, mime) {
  const key = keyFor(relPath)
  const dir = assetsDir(key)
  fs.mkdirSync(dir, { recursive: true })
  const extMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' }
  const ext = extMap[mime] || (String(mime).includes('/') ? String(mime).split('/')[1].replace(/[^a-z0-9]/gi, '') : 'bin')
  const name = cryptoName() + '.' + ext
  fs.writeFileSync(path.join(dir, name), Buffer.from(String(dataB64 || ''), 'base64'))
  return { url: `/api/pdf-study/asset/${key}/${name}` }
}

export function assetAbsolutePath(key, file) {
  const safe = path.basename(String(file || ''))
  const abs = path.join(assetsDir(key), safe)
  if (!abs.startsWith(path.join(dataDir(), 'assets') + path.sep)) throw new Error('非法资产路径')
  return abs
}

function cryptoName() {
  return Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

/** PDF 改名/移动时迁移 sidecar 与资产，保证标注不丢 */
export function migrateDoc(from, to) {
  try {
    const fromKey = keyFor(from)
    const toKey = keyFor(to)
    if (fromKey === toKey) return
    const fromFile = path.join(dataDir(), fromKey + '.json')
    if (fs.existsSync(fromFile)) {
      flushDoc(from)
      fs.renameSync(fromFile, path.join(dataDir(), toKey + '.json'))
    }
    const fromAssets = assetsDir(fromKey)
    if (fs.existsSync(fromAssets)) {
      fs.renameSync(fromAssets, assetsDir(toKey))
    }
  } catch (e) {
    console.error('[pdf-study] 迁移标注失败:', e.message)
  }
}

/** 删除 PDF 时清理 sidecar 与资产 */
export function removeDoc(relPath) {
  try {
    const key = keyFor(relPath)
    flushDoc(relPath)
    fs.rmSync(path.join(dataDir(), key + '.json'), { force: true })
    fs.rmSync(assetsDir(key), { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}
