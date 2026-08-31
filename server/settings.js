import fs from 'node:fs'
import path from 'node:path'
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
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8')
  cache = next
  return next
}

export function publicSettings() {
  const s = loadSettings()
  return {
    vaultPath: s.vaultPath,
    apiBaseURL: s.apiBaseURL,
    model: s.model,
    ragModel: s.ragModel,
    hasApiKey: Boolean(s.apiKey),
    apiKeyMasked: s.apiKey ? s.apiKey.slice(0, 3) + '***' + s.apiKey.slice(-4) : '',
  }
}

export function dataDir() {
  return DATA_DIR
}
