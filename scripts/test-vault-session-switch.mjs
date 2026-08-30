// vault 切换时会话跟随验证（临时脚本）
async function api(method, url, body) {
  const res = await fetch('http://127.0.0.1:3001' + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

const DEMO = 'C:\\Dev\\net\\learn-agent\\server\\demo-vault'
const USER = 'C:\\Users\\mark0\\Documents\\Obsidian Vault'
const base = (p) => p.split('\\').pop()

async function showSessions(label) {
  const s = await api('GET', '/api/sessions')
  console.log(label, '→ 会话:', s.sessions.map((x) => `${x.title}(${x.messageCount})`).join(', ') || '(空)', '| 活跃:', s.activeId)
}

let j = await api('PUT', '/api/settings', { vaultPath: DEMO })
console.log('切到演示库:', base(j.vaultPath))
await showSessions('  ')
await new Promise((r) => setTimeout(r, 500))

j = await api('PUT', '/api/settings', { vaultPath: USER })
console.log('切回用户库:', base(j.vaultPath))
await showSessions('  ')
await new Promise((r) => setTimeout(r, 500))

console.log('=== 最终确认留在用户库 ===')
const fin = await api('GET', '/api/settings')
console.log('当前 vault:', base(fin.vaultPath))
