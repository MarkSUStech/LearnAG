import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DATA_DIR = path.join(__dirname, '..', '.learn-agent')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')

const DEFAULTS = {
  vaultPath: path.join(__dirname, 'demo-vault'),
  apiBaseURL: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-chat',
  ragModel: 'jina-v2-base-zh',
  engine: 'api', // 'api' = OpenAI 兼容服务；'zcode' = 本机 ZCode CLI
  zcodePath: '', // 空 = 自动探测桌面版内置 CLI
  zcodeMaxTurns: 30,
}

/** 桌面版 ZCode 内置 CLI 的默认位置（随桌面版安装/更新而存在） */
export function defaultZcodePath() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  return path.join(base, 'Programs', 'ZCode', 'resources', 'glm', 'zcode.cjs')
}

let cache = null

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function loadSettings() {
  if (cache) return cache
  let stored = {}
  try {
    stored = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
  } catch {
    // 首次启动没有配置文件
  }
  cache = { ...DEFAULTS, ...stored }
  if (!fs.existsSync(cache.vaultPath)) {
    cache.vaultPath = DEFAULTS.vaultPath
  }
  return cache
}

export function saveSettings(patch) {
  ensureDataDir()
  const current = loadSettings()
  const next = { ...current }
  for (const key of ['vaultPath', 'apiBaseURL', 'apiKey', 'model', 'ragModel']) {
    if (typeof patch[key] === 'string' && patch[key].trim() !== '') {
      next[key] = patch[key].trim()
    }
  }
  // apiKey 允许显式清空
  if (patch.apiKey === '') next.apiKey = ''
  // 引擎：只接受合法取值
  if (patch.engine === 'api' || patch.engine === 'zcode') next.engine = patch.engine
  // zcodePath 允许显式清空（回到自动探测）
  if (typeof patch.zcodePath === 'string') next.zcodePath = patch.zcodePath.trim()
  if (patch.zcodeMaxTurns != null) {
    const n = parseInt(patch.zcodeMaxTurns, 10)
    if (Number.isFinite(n)) next.zcodeMaxTurns = Math.min(100, Math.max(3, n))
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8')
  cache = next
  return next
}

export function publicSettings() {
  const s = loadSettings()
  const autoPath = defaultZcodePath()
  const effPath = String(s.zcodePath || '').trim() || autoPath
  return {
    vaultPath: s.vaultPath,
    apiBaseURL: s.apiBaseURL,
    model: s.model,
    ragModel: s.ragModel,
    hasApiKey: Boolean(s.apiKey),
    apiKeyMasked: s.apiKey ? s.apiKey.slice(0, 3) + '***' + s.apiKey.slice(-4) : '',
    engine: s.engine || 'api',
    zcodePath: s.zcodePath || '',
    zcodeAutoPath: autoPath,
    zcodeMaxTurns: s.zcodeMaxTurns || 30,
    zcodeFound: fs.existsSync(effPath),
  }
}

export function dataDir() {
  return DATA_DIR
}
