// 答疑助手三角色后端验证（临时脚本）
const VAULT = 'C:/Users/mark0/Documents/Obsidian Vault'
const NOTE = '笔记/并行计算/编程模型/note/并行计算基础.md'
const SCRATCH = '笔记/测试/答疑助手测试.md'

async function api(method, url, body) {
  const res = await fetch('http://127.0.0.1:3001' + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

async function awaitReply(notePath, prevLen) {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    const h = await api('GET', `/api/tutor/session?path=${encodeURIComponent(notePath)}`)
    const msgs = h.json.messages || []
    const last = msgs[msgs.length - 1]
    if (msgs.length > prevLen && last?.role === 'assistant' && last.content.length > 5) {
      await new Promise((r) => setTimeout(r, 6000))
      const h2 = await api('GET', `/api/tutor/session?path=${encodeURIComponent(notePath)}`)
      if ((h2.json.messages || []).length === msgs.length) return last.content
    }
  }
  return '(超时无回复)'
}

// ① 苏格拉底：应只提问不给答案
console.log('== ① 苏格拉底 ==')
let r = await api('POST', '/api/tutor', { notePath: NOTE, role: 'socratic', message: '我想搞懂什么是并行加速' })
console.log('启动:', r.status)
let reply = await awaitReply(NOTE, 0)
console.log('回复:', reply.slice(0, 220))
console.log('只问不答(含问号且无长解释):', reply.includes('？') && reply.length < 400)

// ② 费曼：给出错误理解，应扮小白追问
console.log('\n== ② 费曼 ==')
r = await api('POST', '/api/tutor', { notePath: NOTE, role: 'feynman', message: '我来给你讲讲什么是并行加速：就是把程序代码的每一行分别打印到多个显示器上，这样看起来就快了。' })
console.log('启动:', r.status)
reply = await awaitReply(NOTE, 2)
console.log('回复:', reply.slice(0, 220))

// ③ 快讲 + 笔记补充
console.log('\n== ③ 快讲 + 补充（写入临时笔记）==')
r = await api('POST', '/api/file', { path: SCRATCH, kind: 'file' })
console.log('创建临时笔记:', r.status)
r = await api('POST', '/api/tutor', { notePath: SCRATCH, role: 'quick', message: '什么是 CPU 缓存？讲完后把要点补充到这篇笔记里' })
console.log('启动:', r.status)
reply = await awaitReply(SCRATCH, 0)
console.log('回复(前200):', reply.slice(0, 200))
// 等待可能的笔记写入
await new Promise((res) => setTimeout(res, 15000))
const fs = await import('node:fs')
const scratchFull = VAULT + '/' + SCRATCH
const content = fs.readFileSync(scratchFull, 'utf8')
console.log('笔记已补充:', content.includes('答疑补充'), '| 行数:', content.split('\n').length)

// 清理：删临时笔记 + 清会话
await api('DELETE', `/api/file?path=${encodeURIComponent(SCRATCH)}`)
await api('DELETE', `/api/tutor/session?path=${encodeURIComponent(SCRATCH)}`)
await api('DELETE', `/api/tutor/session?path=${encodeURIComponent(NOTE)}`)
console.log('\n清理完成（临时笔记与测试会话已删除；并行计算基础笔记的测试会话也已清）')
