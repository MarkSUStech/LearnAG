import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { resolveInVault } from '../vault.js'

// 会话存储：vault/.agent/sessions/<id>.json + index.json；activeId 在 state.json

function sessionsDir() {
  return path.join(path.dirname(resolveInVault('.agent/sessions/x')))
}

function agentDir() {
  return path.dirname(sessionsDir())
}

function ensureDirs() {
  fs.mkdirSync(sessionsDir(), { recursive: true })
}

function indexFile() {
  return path.join(sessionsDir(), 'index.json')
}

function stateFile() {
  return path.join(agentDir(), 'state.json')
}

function sessionFile(id) {
  // id 只允许安全字符，防止路径穿越
  if (!/^[a-z0-9-]{6,40}$/i.test(id)) throw new Error('非法会话 id')
  return path.join(sessionsDir(), id + '.json')
}

function readIndex() {
  try {
    const arr = JSON.parse(fs.readFileSync(indexFile(), 'utf8'))
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function writeIndex(list) {
  ensureDirs()
  fs.writeFileSync(indexFile(), JSON.stringify(list, null, 1), 'utf8')
}

export function listSessions() {
  return readIndex().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export function getActiveId() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
    return s.activeSessionId || null
  } catch {
    return null
  }
}

export function setActiveId(id) {
  ensureDirs()
  fs.writeFileSync(stateFile(), JSON.stringify({ activeSessionId: id }), 'utf8')
}

export function loadSession(id) {
  try {
    const s = JSON.parse(fs.readFileSync(sessionFile(id), 'utf8'))
    return { messages: Array.isArray(s.messages) ? s.messages : [], summary: s.summary || '' }
  } catch {
    return { messages: [], summary: '' }
  }
}

export function saveSession(id, messages, summary, title) {
  ensureDirs()
  const now = new Date().toISOString()
  let meta = readIndex().find((s) => s.id === id)
  if (!meta) {
    meta = { id, title: (title || '新对话').slice(0, 24), createdAt: now, updatedAt: now, messageCount: messages.length }
  } else {
    meta.updatedAt = now
    meta.messageCount = messages.length
    if (title) meta.title = String(title).slice(0, 24)
  }
  const data = { id, title: meta.title, createdAt: meta.createdAt, updatedAt: now, messages, summary }
  fs.writeFileSync(sessionFile(id), JSON.stringify(data, null, 1), 'utf8')
  const index = readIndex().filter((s) => s.id !== id)
  index.push(meta)
  writeIndex(index)
}

export function createSession() {
  const id = 's-' + crypto.randomBytes(6).toString('hex')
  const now = new Date().toISOString()
  saveSession(id, [], '', '新对话')
  setActiveId(id)
  return { id, title: '新对话', createdAt: now, updatedAt: now, messageCount: 0 }
}

/** 删除会话：归档到 .agent/archive/ 而非硬删 */
export function deleteSession(id) {
  const file = sessionFile(id)
  if (fs.existsSync(file)) {
    const archiveDir = path.join(agentDir(), 'archive')
    fs.mkdirSync(archiveDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    fs.renameSync(file, path.join(archiveDir, `${id}-${stamp}.json`))
  }
  writeIndex(readIndex().filter((s) => s.id !== id))
  if (getActiveId() === id) {
    const rest = listSessions()
    if (rest.length) {
      setActiveId(rest[0].id)
    } else {
      createSession()
    }
  }
}

/** 重命名会话 */
export function renameSession(id, title) {
  const clean = String(title ?? '').trim().slice(0, 24)
  if (!clean) throw new Error('标题不能为空')
  const index = readIndex()
  const meta = index.find((s) => s.id === id)
  if (!meta) throw new Error('会话不存在')
  meta.title = clean
  writeIndex(index)
  const file = sessionFile(id)
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      data.title = clean
      fs.writeFileSync(file, JSON.stringify(data, null, 1), 'utf8')
    } catch {
      /* 会话文件损坏时只更新索引 */
    }
  }
  return { ok: true }
}

/** 确保至少存在一个活跃会话，返回 activeId */
export function ensureActive() {
  const index = readIndex()
  if (!index.length) {
    createSession()
    return getActiveId()
  }
  const active = getActiveId()
  if (active && index.some((s) => s.id === active)) return active
  setActiveId(index[0].id)
  return index[0].id
}
