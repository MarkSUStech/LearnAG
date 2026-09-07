// IDE 编译/运行：工具链自动探测 + 进程托管（编译、运行、安装流式输出）
// 全部本机执行；缺失的工具链可通过 winget 一键安装（Windows 标准组件）。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as vault from './vault.js'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IS_WIN = process.platform === 'win32'
const RUN_TIMEOUT_MS = 120_000 // 单次运行/编译的硬超时

// ── 工具链定义：按顺序尝试探测，命中即用 ────────────────────────────────────
const TOOLCHAINS = [
  { id: 'python', name: 'Python', detect: [['python', '--version'], ['py', '-3', '--version'], ['python3', '--version']], versionRe: /^Python (3\.\d+\.\d+)/, winget: 'Python.Python.3.12' },
  { id: 'node', name: 'Node.js', detect: [['node', '--version']], versionRe: /^v(\d+\.\d+\.\d+)/ },
  { id: 'gcc', name: 'GCC (C)', detect: [['gcc', '--version']], versionRe: /(\d+\.\d+\.\d+)/ },
  { id: 'clang', name: 'Clang (C)', detect: [['clang', '--version']], versionRe: /version (\d+\.\d+\.\d+)/ },
  { id: 'gpp', name: 'G++ (C++)', detect: [['g++', '--version']], versionRe: /(\d+\.\d+\.\d+)/ },
  { id: 'clangpp', name: 'Clang++ (C++)', detect: [['clang++', '--version']], versionRe: /version (\d+\.\d+\.\d+)/ },
  { id: 'java', name: 'Java', detect: [['java', '--version']], versionRe: /(\d+(\.\d+)*)/, winget: 'Microsoft.OpenJDK.21' },
  { id: 'go', name: 'Go', detect: [['go', 'version']], versionRe: /^go version go(\d+\.\d+\.\d+)/, winget: 'GoLang.Go' },
  { id: 'rustc', name: 'Rust', detect: [['rustc', '--version']], versionRe: /rustc (\d+\.\d+\.\d+)/, winget: 'Rustlang.Rustup' },
]

const WINGET_IDS = Object.fromEntries(TOOLCHAINS.filter((t) => t.winget).map((t) => [t.id, t.winget]))

let cache = { at: 0, list: null }

function probe(cmd, args, timeout = 5000) {
  return new Promise((resolve) => {
    let out = ''
    let done = false
    let proc
    try {
      proc = spawn(cmd, args, { cwd: PROJECT_ROOT, shell: IS_WIN, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      resolve(null)
      return
    }
    const finish = (v) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        proc.kill()
      } catch {
        /* ignore */
      }
      resolve(v)
    }
    const timer = setTimeout(() => finish(null), timeout)
    proc.stdout.on('data', (c) => (out += c.toString()))
    proc.stderr.on('data', (c) => (out += c.toString()))
    proc.on('error', () => finish(null))
    proc.on('exit', () => finish(out))
  })
}

async function detectToolchains() {
  if (cache.list && Date.now() - cache.at < 60_000) return cache.list
  const list = []
  for (const t of TOOLCHAINS) {
    let found = null
    for (const [cmd, ...args] of t.detect) {
      const out = await probe(cmd, args)
      const line = (out || '').split('\n')[0] || ''
      const m = t.versionRe ? line.match(t.versionRe) : null
      if (out && m) {
        found = { args: [cmd, ...args.slice(1)], version: m[1] }
        break
      }
    }
    list.push({
      id: t.id,
      name: t.name,
      available: Boolean(found),
      version: found?.version ?? '',
      command: found ? found.args[0] : '',
      args: found ? found.args : [], // 完整基础 argv（如 ['py','-3']），运行时追加文件参数
      winget: t.winget ?? '',
    })
  }
  cache = { at: Date.now(), list }
  return list
}

/** 语言 id → 运行步骤；返回 { steps: [{cmd,args}] }，编译型为两步（编译→运行产物） */
async function buildRunner(lang, absFile) {
  const list = await detectToolchains()
  const get = (id) => list.find((t) => t.id === id && t.available)
  const outExe = path.join(os.tmpdir(), `la-run-${Date.now()}-${Math.floor(Math.random() * 1e5)}` + (IS_WIN ? '.exe' : ''))
  switch (lang) {
    case 'python': {
      const py = get('python')
      if (!py) return null
      return { steps: [{ cmd: py.args[0], args: [...py.args.slice(1), absFile] }] }
    }
    case 'node':
      if (!get('node')) return null
      return { steps: [{ cmd: 'node', args: [absFile] }] }
    case 'node-ts':
      if (!get('node')) return null
      return { steps: [{ cmd: 'node', args: ['--experimental-strip-types', absFile] }] }
    case 'c': {
      const cc = get('gcc') ? 'gcc' : get('clang') ? 'clang' : null
      if (!cc) return null
      return { steps: [{ cmd: cc, args: [absFile, '-o', outExe] }, { cmd: outExe, args: [] }] }
    }
    case 'cpp': {
      const cxx = get('gpp') ? 'g++' : get('clangpp') ? 'clang++' : null
      if (!cxx) return null
      return { steps: [{ cmd: cxx, args: ['-std=c++17', absFile, '-o', outExe] }, { cmd: outExe, args: [] }] }
    }
    case 'java':
      if (!get('java')) return null
      return { steps: [{ cmd: 'java', args: [absFile] }] }
    case 'go':
      if (!get('go')) return null
      return { steps: [{ cmd: 'go', args: ['run', absFile] }] }
    case 'rust': {
      if (!get('rustc')) return null
      return { steps: [{ cmd: 'rustc', args: [absFile, '-o', outExe] }, { cmd: outExe, args: [] }] }
    }
    default:
      return null
  }
}

export function runRoutes(app) {
  app.get('/api/run/toolchains', async (req, res) => {
    res.json({ toolchains: await detectToolchains() })
  })
}

export function handleRunConnection(ws) {
  {
    let current = null // 当前活动子进程
    const send = (msg) => {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(JSON.stringify(msg))
        } catch {
          /* ignore */
        }
      }
    }
    const killCurrent = () => {
      const p = current
      current = null
      if (!p) return
      try {
        if (IS_WIN) spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' })
        else p.kill()
      } catch {
        /* ignore */
      }
    }

    ws.on('message', async (raw) => {
      let m
      try {
        m = JSON.parse(String(raw))
      } catch {
        return
      }

      if (m.type === 'toolchains') {
        send({ type: 'toolchains', toolchains: await detectToolchains() })
        return
      }

      if (m.type === 'kill') {
        killCurrent()
        return
      }

      if (m.type === 'install') {
        const id = String(m.id || '')
        const wingetId = WINGET_IDS[id]
        if (!wingetId) {
          send({ type: 'error', message: `工具链 ${id} 没有可用的自动安装方式，请按提示手动安装` })
          return
        }
        killCurrent()
        const args = ['install', '-e', '--id', wingetId, '--accept-source-agreements', '--accept-package-agreements']
        const proc = spawn('winget', args, { cwd: PROJECT_ROOT, shell: IS_WIN, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
        current = proc
        proc.stdout.on('data', (c) => send({ type: 'out', stream: 'out', text: c.toString() }))
        proc.stderr.on('data', (c) => send({ type: 'out', stream: 'err', text: c.toString() }))
        proc.on('exit', (code) => {
          if (current === proc) current = null
          cache = { at: 0, list: null } // 安装后重新探测
          send({ type: 'installed', id, code })
          void detectToolchains().then((toolchains) => send({ type: 'toolchains', toolchains }))
        })
        return
      }

      if (m.type === 'run') {
        const relPath = String(m.path || '')
        const lang = String(m.lang || '')
        let absFile
        try {
          absFile = vault.resolveInVault(relPath)
        } catch (e) {
          send({ type: 'error', message: String(e.message || e) })
          return
        }
        if (!fs.existsSync(absFile)) {
          send({ type: 'error', message: '文件不存在' })
          return
        }
        killCurrent()
        const runner = await buildRunner(lang, absFile)
        if (!runner) {
          send({ type: 'error', message: `未检测到可运行「${relPath}」的工具链，请在插件面板中安装` })
          return
        }

        let idx = 0
        const runNext = () => {
          if (current) return // 已被 kill，终止推进
          const step = runner.steps[idx]
          const label = runner.steps.length > 1 ? (idx === 0 ? '编译' : '运行') : '运行'
          send({ type: 'started', desc: `${label}：${step.cmd} ${step.args.map((a) => (a === absFile ? relPath : a)).join(' ')}` })
          const timer = setTimeout(() => {
            send({ type: 'out', stream: 'err', text: `\n[learn-agent] 超时（${RUN_TIMEOUT_MS / 1000}s），进程已终止\n` })
            killCurrent()
            send({ type: 'exit', code: 124 })
          }, RUN_TIMEOUT_MS)
          let proc
          try {
            proc = spawn(step.cmd, step.args, { cwd: path.dirname(absFile), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
          } catch (e) {
            clearTimeout(timer)
            send({ type: 'out', stream: 'err', text: `${String(e.message || e)}\n` })
            send({ type: 'exit', code: -1 })
            return
          }
          current = proc
          proc.stdout.on('data', (c) => send({ type: 'out', stream: 'out', text: c.toString() }))
          proc.stderr.on('data', (c) => send({ type: 'out', stream: 'err', text: c.toString() }))
          proc.on('error', (e) => {
            clearTimeout(timer)
            if (current !== proc) return
            current = null
            send({ type: 'out', stream: 'err', text: `${String(e.message || e)}\n` })
            send({ type: 'exit', code: -1 })
          })
          proc.on('exit', (code) => {
            clearTimeout(timer)
            if (current !== proc) return // 被 kill 的流程不再推进
            current = null
            idx += 1
            if (code === 0 && idx < runner.steps.length) {
              runNext()
              return
            }
            send({ type: 'exit', code: code ?? -1 })
          })
        }
        runNext()
      }
    })

    ws.on('close', killCurrent)
  }
}
