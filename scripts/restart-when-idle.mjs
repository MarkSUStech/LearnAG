// 看门狗：等待 3001 服务空闲后，用新构建无缝重启（临时部署脚本）
import { execSync, spawn } from 'node:child_process'

const PORT = 3001
const CHECK_INTERVAL = 15000
const MAX_WAIT_MINUTES = 120

function isRunning() {
  try {
    const out = execSync(`curl -s http://127.0.0.1:${PORT}/api/agent/status`, { encoding: 'utf8', timeout: 8000 })
    return JSON.parse(out).running
  } catch {
    return false // 服务已死 → 视为空闲
  }
}

function killPort() {
  try {
    execSync(
      `powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`,
      { timeout: 15000 },
    )
  } catch {
    /* ignore */
  }
}

const deadline = Date.now() + MAX_WAIT_MINUTES * 60 * 1000
let waited = 0
while (Date.now() < deadline) {
  if (!isRunning()) {
    console.log(`[watchdog] 服务空闲（已等待 ${Math.round(waited / 1000)}s），执行重启`)
    killPort()
    await new Promise((r) => setTimeout(r, 2000))
    const child = spawn('node', ['server/index.js'], {
      cwd: 'C:/Dev/net/learn-agent',
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    await new Promise((r) => setTimeout(r, 3000))
    try {
      const out = execSync(`curl -s http://127.0.0.1:${PORT}/api/agent/status`, { encoding: 'utf8', timeout: 8000 })
      console.log('[watchdog] 重启完成:', out.trim())
    } catch {
      console.log('[watchdog] 重启后探测失败，请手动检查')
    }
    process.exit(0)
  }
  waited += CHECK_INTERVAL
  await new Promise((r) => setTimeout(r, CHECK_INTERVAL))
}
console.log('[watchdog] 超时退出（服务持续忙碌）')
