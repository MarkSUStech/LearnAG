// ZCode 引擎：把学习任务交给本机 ZCode CLI（桌面版内置内核）以子进程方式执行。
// 无头调用：node zcode.cjs -p <prompt> --cwd <目录> --output-format stream-json（NDJSON 事件流）
// 认证零配置：CLI 自动复用 ~/.zcode/v2/credentials.json 的已登录账号（coding plan 额度）。
//
// 事件形状按 CLI v0.16.5 实测校准（2026-09）：
// - 文本增量：{type:'model.streaming', payload:{kind:'text_delta', delta}}
// - 工具事件：{type:'tool.updated', payload:{kind:'scheduled'|'started'|'result', toolCallId, toolName?, input?}}
//   scheduled 带 toolName + 完整 input（Write 含全文 content 与 file_path）；result 无 input，需用 scheduled 记录的映射
// - 每轮完成：{type:'turn.completed', payload:{response, resultType, usage}}
// - 终止行：{type:'result', sessionId, response, usage, projection}
// 未文档化面，CLI 随桌面版更新可能变化：解析对未知事件宽容跳过，原始事件前 200 行落盘 zcode-sample.log 便于适配。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { loadSettings, defaultZcodePath, dataDir } from '../settings.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 把 LearnAgent 桥接（ask_user / search_knowledge）写入 ZCode 原生配置 mcp.servers
 *  （~/.zcode/cli/config.json；--settings 与工作目录 .mcp.json 在 v0.16.5 的严格解析器
 *  下均不可用）。保留配置中其他键；每次 ZCode 引擎运行前同步一次（脚本路径/端口可能变化）。 */
export function ensureZcodeMcp() {
  try {
    const cfgPath = path.join(os.homedir(), '.zcode', 'cli', 'config.json')
    let cfg = {}
    try {
      cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    } catch {
      /* 首次创建 */
    }
    cfg.mcp = cfg.mcp && typeof cfg.mcp === 'object' ? cfg.mcp : {}
    cfg.mcp.servers = cfg.mcp.servers && typeof cfg.mcp.servers === 'object' ? cfg.mcp.servers : {}
    cfg.mcp.servers.learnagent = {
      type: 'stdio',
      command: process.execPath,
      args: [path.join(__dirname, '..', 'zcode-mcp.mjs')],
      env: { LEARN_AGENT_PORT: String(process.env.PORT || 3001) },
    }
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true })
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8')
    return cfgPath
  } catch (e) {
    console.error('[zcode] 写入 ZCode 配置失败:', e?.message || e)
    return ''
  }
}

export function zcodeCliPath() {
  const s = loadSettings()
  return String(s.zcodePath || '').trim() || defaultZcodePath()
}

export function zcodeAvailable() {
  try {
    return fs.existsSync(zcodeCliPath())
  } catch {
    return false
  }
}

/** CLI 版本号（spawn --version，超时返回空串） */
export function zcodeVersion() {
  return new Promise((resolve) => {
    const cli = zcodeCliPath()
    if (!fs.existsSync(cli)) return resolve('')
    let child
    const timer = setTimeout(() => {
      try {
        child?.kill()
      } catch {
        /* ignore */
      }
      resolve('')
    }, 8000)
    try {
      child = spawn(process.execPath, [cli, '--version'], { windowsHide: true })
      let out = ''
      child.stdout?.on('data', (d) => (out += d))
      child.on('error', () => {
        clearTimeout(timer)
        resolve('')
      })
      child.on('close', () => {
        clearTimeout(timer)
        resolve(out.trim().split(/\r?\n/).filter(Boolean).pop() || '')
      })
    } catch {
      clearTimeout(timer)
      resolve('')
    }
  })
}

// ── 原始事件采样（版本适配用） ────────────────────────────────────────────────

const SAMPLE_MAX = 200
let sampleCount = 0

function maybeSample(line) {
  if (sampleCount >= SAMPLE_MAX) return
  sampleCount++
  try {
    fs.appendFileSync(path.join(dataDir(), 'zcode-sample.log'), line.slice(0, 4000) + '\n')
  } catch {
    /* 日志失败不影响运行 */
  }
}

// ── 子进程控制 ───────────────────────────────────────────────────────────────

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode) return
  try {
    child.kill()
  } catch {
    /* ignore */
  }
  if (process.platform === 'win32' && child.pid) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    } catch {
      /* ignore */
    }
  }
}

/** Windows 下 taskkill 异步脱离，主动卸载引用防止句柄悬挂 */
function detach(child) {
  child.removeAllListeners?.()
}

/**
 * 跑一次 ZCode 无头回合。
 * @param {string} prompt 完整任务提示词
 * @param {object} opts {cwd, resumeSessionId, signal, maxTurns, onEvent}
 * @param onEvent (e: {type:'text-delta',text}|{type:'tool-start',name,input,callId}|{type:'tool-end',name,input,ok,callId}|{type:'turn-end',response,resultType}) => void
 * @returns {Promise<{response, sessionId, usage, projection}>}
 */
export function runZcodeTurn({ prompt, cwd, resumeSessionId, signal, maxTurns = 30, onEvent } = {}) {
  const cli = zcodeCliPath()
  if (!fs.existsSync(cli)) {
    return Promise.reject(new Error('未找到本机 ZCode CLI：' + cli))
  }
  const args = [cli, '-p', prompt, '--output-format', 'stream-json', '--mode', 'yolo', '--no-color']
  // 注意：help 里列出的 --max-turns 在 v0.16.5 主解析器未注册（传了会报 Unknown option），
  // yolo 无头模式本身不限轮次；maxTurns 参数保留在签名里供未来版本恢复
  if (cwd) args.push('--cwd', cwd)
  if (resumeSessionId) args.push('--resume', resumeSessionId)

  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(process.execPath, args, { windowsHide: true })
    } catch (e) {
      return reject(new Error('ZCode CLI 启动失败：' + (e?.message || e)))
    }

    let stderrTail = ''
    let buf = ''
    let result = null // 终止行
    let settled = false
    const pendingTools = new Map() // toolCallId -> {toolName, input}

    const onAbort = () => {
      if (settled) return
      settled = true
      killTree(child)
      const err = new Error('已停止')
      err.name = 'AbortError'
      reject(err)
    }
    if (signal) {
      if (signal.aborted) return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
    }

    const finish = (err) => {
      if (settled) return
      settled = true
      if (signal) signal.removeEventListener('abort', onAbort)
      if (err) return reject(err)
      if (!result) {
        const tail = stderrTail.trim().split(/\r?\n/).filter(Boolean).slice(-3).join('；')
        return reject(new Error('ZCode 未返回结果' + (child.exitCode ? `（退出码 ${child.exitCode}）` : '') + (tail ? '：' + tail : '')))
      }
      resolve({
        response: String(result.response ?? ''),
        sessionId: result.sessionId || '',
        usage: result.usage || null,
        projection: result.projection || null,
      })
    }

    child.stdout?.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      let idx
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line) continue
        maybeSample(line)
        let ev
        try {
          ev = JSON.parse(line)
        } catch {
          continue // 心跳/非 JSON 行宽容跳过
        }
        try {
          if (ev.type === 'result') {
            result = ev
            continue
          }
          const p = ev.payload || {}
          if (ev.type === 'model.streaming') {
            if (p.kind === 'text_delta' && typeof p.delta === 'string' && p.delta) {
              onEvent?.({ type: 'text-delta', text: p.delta })
            }
          } else if (ev.type === 'tool.updated') {
            if (p.kind === 'scheduled' && p.toolCallId) {
              pendingTools.set(p.toolCallId, { toolName: p.toolName || '', input: p.input })
              onEvent?.({ type: 'tool-start', name: p.toolName || '', input: p.input, callId: p.toolCallId })
            } else if (p.kind === 'result' && p.toolCallId) {
              const rec = pendingTools.get(p.toolCallId)
              pendingTools.delete(p.toolCallId)
              onEvent?.({
                type: 'tool-end',
                name: rec?.toolName || '',
                input: rec?.input,
                ok: p.result?.success !== false,
                callId: p.toolCallId,
              })
            }
          } else if (ev.type === 'turn.completed') {
            onEvent?.({ type: 'turn-end', response: typeof p.response === 'string' ? p.response : '', resultType: p.resultType })
          } else if (ev.type === 'turn.failed') {
            finish(new Error('ZCode 回合失败：' + String(p.error ?? p.message ?? '未知错误').slice(0, 300)))
          }
        } catch {
          /* 单个事件处理失败不影响整体 */
        }
      }
    })
    child.stderr?.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-2000)
    })
    child.on('error', (e) => finish(new Error('ZCode CLI 进程错误：' + (e?.message || e))))
    child.on('close', (code) => {
      detach(child)
      if (!result && code !== 0) {
        const tail = stderrTail.trim().split(/\r?\n/).filter(Boolean).slice(-3).join('；')
        return finish(new Error(`ZCode CLI 异常退出（${code}）` + (tail ? '：' + tail : '')))
      }
      finish()
    })
  })
}

// ── 简化形态：流式文本 / 单轮问答 ────────────────────────────────────────────

/** 流式文本（tutor / 翻译等纯文本场景）：把 text-delta 串成 async generator */
export async function* zcodeStreamText(prompt, { signal, maxTurns = 4, cwd } = {}) {
  const queue = []
  let done = false
  let error = null
  let wake = null
  const running = runZcodeTurn({
    prompt,
    cwd,
    signal,
    maxTurns,
    onEvent: (e) => {
      if (e.type === 'text-delta') {
        queue.push(e.text)
        wake?.()
      }
    },
  }).then(
    () => {
      done = true
      wake?.()
    },
    (e) => {
      error = e
      done = true
      wake?.()
    },
  )
  while (true) {
    while (queue.length) yield queue.shift()
    if (done) break
    await new Promise((r) => (wake = r))
  }
  if (error) throw error
  await running.catch(() => {})
}

/** 单轮问答（mermaid 修复 / 历史压缩等纯文本辅助任务） */
export async function zcodeChatOnce(prompt, { signal, maxTurns = 4, cwd } = {}) {
  const r = await runZcodeTurn({ prompt, cwd, signal, maxTurns })
  return r.response
}

// ── 会话映射：LearnAgent 会话 id → ZCode sessionId（--resume 跨请求记忆） ────

function sessionsMapFile() {
  return path.join(dataDir(), 'zcode-sessions.json')
}

export function getZcodeSessionId(laSessionId) {
  try {
    const map = JSON.parse(fs.readFileSync(sessionsMapFile(), 'utf8'))
    const rec = map && map[String(laSessionId)]
    return rec && rec.zcodeSessionId ? String(rec.zcodeSessionId) : ''
  } catch {
    return ''
  }
}

export function setZcodeSessionId(laSessionId, zcodeSessionId) {
  try {
    let map = {}
    try {
      map = JSON.parse(fs.readFileSync(sessionsMapFile(), 'utf8'))
    } catch {
      /* 首次 */
    }
    map[String(laSessionId)] = { zcodeSessionId, updatedAt: Date.now() }
    // 只保留最近 50 条映射
    const entries = Object.entries(map).sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0)).slice(0, 50)
    fs.writeFileSync(sessionsMapFile(), JSON.stringify(Object.fromEntries(entries), null, 1), 'utf8')
  } catch {
    /* 映射失败只影响续记忆，不阻断 */
  }
}
