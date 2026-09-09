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

/** IDE 模式关注的文本/代码扩展名：文件树 all 模式、watcher、全局搜索共用 */
export const TEXT_EXTS = new Set([
  // 文本与标记
  '.md', '.markdown', '.txt', '.json', '.jsonc', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.xml', '.svg',
  '.html', '.htm', '.css', '.scss', '.less',
  // 脚本与语言
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx',
  '.py', '.pyi', '.rb', '.php', '.pl', '.lua',
  '.java', '.kt', '.kts', '.scala', '.groovy',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.hh', '.cs',
  '.go', '.rs', '.swift', '.m', '.dart', '.vue', '.svelte',
  '.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1',
  '.sql', '.r', '.ipynb', '.properties', '.gradle', '.proto',
])

/** 无扩展名但属文本的常见文件名 */
const TEXT_BASENAMES = new Set(['.gitignore', '.gitattributes', '.env', 'dockerfile', 'makefile', 'license', 'readme'])

/** 是否为可按文本读写的文件（IDE 编辑器/监听/搜索的判定基准） */
export function isTextFile(name) {
  const base = name.toLowerCase()
  if (TEXT_BASENAMES.has(base)) return true
  const i = name.lastIndexOf('.')
  if (i <= 0) return false
  return TEXT_EXTS.has(name.slice(i).toLowerCase())
}

function buildTree(absDir, relDir = '', all = false) {
  const out = []
  let entries = []
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true })
  } catch {
    return out
  }
  // 资料/（旧版）、附件/（上传目录）与 reference/（新版）目录下展示全部文件类型（PDF/图片等）
  const segs = relDir.split('/')
  const includeAll = all || segs[0] === '资料' || segs[0] === '附件' || segs.includes('reference') || segs.includes('papers') || segs.includes('web')
  for (const ent of entries) {
    if (ent.name.startsWith('.') && IGNORED_DIRS.has(ent.name)) continue
    const rel = relDir ? relDir + '/' + ent.name : ent.name
    if (ent.isDirectory()) {
      out.push({
        name: ent.name,
        path: rel,
        type: 'folder',
        children: buildTree(path.join(absDir, ent.name), rel, all),
      })
    } else if (ent.isFile() && (includeAll || ['.md', '.pdf'].includes(ent.name.toLowerCase().slice(ent.name.lastIndexOf('.')).toLowerCase()))) {
      out.push({ name: ent.name, path: rel, type: 'file' })
    }
  }
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  })
  return out
}

/** getTree({ all: true }) 返回全部文件类型（IDE 资源管理器）；默认 md + pdf（学习模式文件树，PDF 可在学习器中打开） */
export function getTree({ all = false } = {}) {
  return buildTree(vaultRoot, '', all)
}

export function listAllNotes() {
  return listAllFiles(['.md'])
}

/** 列出 vault 内指定扩展名（含点、小写比较）的全部文件（相对路径） */
export function listAllFiles(extensions) {
  const exts = new Set(extensions.map((e) => e.toLowerCase()))
  const out = []
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
      else if (ent.isFile() && exts.has(ent.name.slice(ent.name.lastIndexOf('.')).toLowerCase())) out.push(r)
    }
  }
  walk(vaultRoot, '')
  return out
}

// ── IDE 全文搜索 ────────────────────────────────────────────────────────────

const SEARCH_MAX_FILE = 2 * 1024 * 1024 // 超过 2MB 的文本文件跳过，避免卡顿

/** 跨文本/代码文件按行搜索，返回 [{ path, line, column, text }] */
export function searchText(query, { limit = 200, maxLine = 240, caseSensitive = false } = {}) {
  const q = String(query ?? '')
  if (!q.trim()) return { results: [], truncated: false }
  const needle = caseSensitive ? q : q.toLowerCase()
  const results = []
  let truncated = false
  function walk(dir, rel) {
    if (truncated) return
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (truncated) return
      if (ent.isDirectory()) {
        if (IGNORED_DIRS.has(ent.name)) continue
        walk(path.join(dir, ent.name), rel ? rel + '/' + ent.name : ent.name)
        continue
      }
      if (!ent.isFile() || !isTextFile(ent.name)) continue
      const relPath = rel ? rel + '/' + ent.name : ent.name
      let text = ''
      try {
        const abs = path.join(dir, ent.name)
        if (fs.statSync(abs).size > SEARCH_MAX_FILE) continue
        text = fs.readFileSync(abs, 'utf8')
      } catch {
        continue
      }
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const hay = caseSensitive ? lines[i] : lines[i].toLowerCase()
        const col = hay.indexOf(needle)
        if (col === -1) continue
        results.push({ path: relPath, line: i + 1, column: col + 1, text: lines[i].trim().slice(0, maxLine) })
        if (results.length >= limit) {
          truncated = true
          return
        }
      }
    }
  }
  walk(vaultRoot, '')
  return { results, truncated }
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
    ignored: (p, stats) => {
      const rel = path.relative(vaultRoot, p)
      if (!rel) return false
      const first = rel.split(path.sep)[0]
      if (IGNORED_DIRS.has(first)) return true
      // 目录不能剪枝，否则递归监听失效（关心 md、pdf、代码/文本文件与 知识图谱.json）
      if (stats ? stats.isDirectory() : fs.existsSync(p) && fs.statSync(p).isDirectory()) return false
      return (
        !rel.toLowerCase().endsWith('.pdf') &&
        !isTextFile(path.basename(rel)) &&
        path.basename(rel) !== '知识图谱.json'
      )
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
