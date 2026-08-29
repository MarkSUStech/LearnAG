import fs from 'node:fs'
import path from 'node:path'
import chokidar from 'chokidar'

// ── 路径安全 ────────────────────────────────────────────────────────────────

let vaultRoot = ''

export function setVaultRoot(dir) {
  vaultRoot = path.resolve(dir)
}

export function getVaultRoot() {
  return vaultRoot
}

/** 把 API 传来的相对路径解析为 vault 内的绝对路径，拒绝目录穿越 */
export function resolveInVault(relPath) {
  const clean = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '')
  const abs = path.resolve(vaultRoot, clean)
  const rootWithSep = vaultRoot.endsWith(path.sep) ? vaultRoot : vaultRoot + path.sep
  if (abs !== vaultRoot && !abs.startsWith(rootWithSep)) {
    throw new Error('路径越出 vault 范围：' + relPath)
  }
  return abs
}

// ── 文件树 ──────────────────────────────────────────────────────────────────

const IGNORED_DIRS = new Set(['.obsidian', '.agent', '.git', '.trash', 'node_modules', '.learn-agent'])

function buildTree(absDir, relDir = '') {
  const out = []
  let entries = []
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true })
  } catch {
    return out
  }
  // 资料/（旧版）与 reference/（新版）目录下展示全部文件类型（PDF/图片等供预览器使用）
  const segs = relDir.split('/')
  const includeAll = segs[0] === '资料' || segs.includes('reference') || segs.includes('papers') || segs.includes('web')
  for (const ent of entries) {
    if (ent.name.startsWith('.') && IGNORED_DIRS.has(ent.name)) continue
    const rel = relDir ? relDir + '/' + ent.name : ent.name
    if (ent.isDirectory()) {
      out.push({
        name: ent.name,
        path: rel,
        type: 'folder',
        children: buildTree(path.join(absDir, ent.name), rel),
      })
    } else if (ent.isFile() && (includeAll || ent.name.toLowerCase().endsWith('.md'))) {
      out.push({ name: ent.name, path: rel, type: 'file' })
    }
  }
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  })
  return out
}

export function getTree() {
  return buildTree(vaultRoot)
}

export function listAllNotes() {
  const notes = []
  function walk(dir, rel) {
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (IGNORED_DIRS.has(ent.name)) continue
      const r = rel ? rel + '/' + ent.name : ent.name
      if (ent.isDirectory()) walk(path.join(dir, ent.name), r)
      else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) notes.push(r)
    }
  }
  walk(vaultRoot, '')
  return notes
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export function readFile(relPath) {
  const abs = resolveInVault(relPath)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error('文件不存在：' + relPath)
  return fs.readFileSync(abs, 'utf8')
}

export function writeFile(relPath, content) {
  const abs = resolveInVault(relPath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  if (Buffer.isBuffer(content)) {
    fs.writeFileSync(abs, content)
  } else {
    fs.writeFileSync(abs, String(content ?? ''), 'utf8')
  }
  return { path: relPath.replace(/\\/g, '/') }
}

export function createEntry(relPath, kind) {
  const abs = resolveInVault(relPath)
  if (fs.existsSync(abs)) throw new Error('已存在：' + relPath)
  if (kind === 'folder') {
    fs.mkdirSync(abs, { recursive: true })
  } else {
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, '', 'utf8')
  }
  return { path: relPath.replace(/\\/g, '/') }
}

export function deleteEntry(relPath) {
  const abs = resolveInVault(relPath)
  if (abs === vaultRoot) throw new Error('不能删除 vault 根目录')
  fs.rmSync(abs, { recursive: true, force: true })
  return { ok: true }
}

export function renameEntry(from, to) {
  const absFrom = resolveInVault(from)
  const absTo = resolveInVault(to)
  if (!fs.existsSync(absFrom)) throw new Error('源不存在：' + from)
  if (fs.existsSync(absTo)) throw new Error('目标已存在：' + to)
  fs.mkdirSync(path.dirname(absTo), { recursive: true })
  fs.renameSync(absFrom, absTo)
  return { path: to.replace(/\\/g, '/') }
}

// ── 文件监听 ────────────────────────────────────────────────────────────────

let watcher = null
let onEvent = () => {}

export function watchVault(cb) {
  onEvent = cb
  startWatcher()
}

function startWatcher() {
  if (watcher) watcher.close()
  watcher = chokidar.watch(vaultRoot, {
    ignoreInitial: true,
    ignored: (p) => {
      const rel = path.relative(vaultRoot, p)
      if (!rel) return false
      const first = rel.split(path.sep)[0]
      if (IGNORED_DIRS.has(first)) return true
      // 只关心 md 与 知识图谱.json
      return !rel.endsWith('.md') && path.basename(rel) !== '知识图谱.json'
    },
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 80 },
  })
  const emit = (kind) => (absPath) => {
    const rel = path.relative(vaultRoot, absPath).replace(/\\/g, '/')
    if (!rel) return
    try {
      onEvent({ kind, path: rel })
    } catch {
      /* vault 切换瞬间可能解析失败，忽略 */
    }
  }
  watcher.on('add', emit('add')).on('change', emit('change')).on('unlink', emit('unlink'))
  watcher.on('addDir', (absDir) => {
    const rel = path.relative(vaultRoot, absDir).replace(/\\/g, '/')
    if (rel) onEvent({ kind: 'add-dir', path: rel })
  })
  watcher.on('unlinkDir', (absDir) => {
    const rel = path.relative(vaultRoot, absDir).replace(/\\/g, '/')
    if (rel) onEvent({ kind: 'unlink-dir', path: rel })
  })
  // OneDrive/杀软等造成的监听错误不能让进程崩溃
  watcher.on('error', (err) => {
    console.error('[watcher] 监听错误（已忽略）:', err.message)
  })
}

/** agent 主动写文件后立刻手动广播（chokidar 有延迟） */
export function notifyWrite(relPath, kind = 'change') {
  onEvent({ kind, path: relPath })
}
