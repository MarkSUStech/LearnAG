// Opt-in: one short real global-agent turn with the configured provider.
// Uses an isolated vault; never rewrites the user's notes, sessions or settings.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { build } from 'esbuild'
import { loadSettings } from '../server/settings.js'
import * as vault from '../server/vault.js'
import { runAgent, stopAgent } from '../server/agent/runner.js'
import * as sessions from '../server/agent/sessions.js'

if (!process.argv.includes('--run')) {
  console.log('Opt-in: node scripts/check-global-images-live.mjs --run --image <absolute PNG/JPEG/WebP/GIF path>')
  process.exit(0)
}
const imageAt = process.argv.indexOf('--image')
const image = process.argv[imageAt + 1]
if (imageAt < 0 || !image || !path.isAbsolute(image)) throw new Error('需要 --image 绝对路径')
const settings = loadSettings()
if (settings.engine !== 'api' || !settings.apiKey) throw new Error('需要已配置的API引擎')
const original = { ...settings }, originalRoot = vault.getVaultRoot(), realFetch = globalThis.fetch
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-agent-vision-live-'))
const requests = []
const timer = setTimeout(() => stopAgent(), 90000)
try {
  const rel = 'question' + path.extname(image)
  fs.copyFileSync(image, path.join(temp, rel))
  Object.assign(settings, { vaultPath: temp })
  vault.setVaultRoot(temp)
  globalThis.fetch = async (url, init) => {
    if (!String(url).endsWith('/chat/completions')) throw new Error('实测只允许当前模型调用')
    if (requests.length >= 3) throw new Error('实测请求次数上限为3，停止额外调用')
    const body = JSON.parse(init.body)
    requests.push({ images: body.messages.flatMap(m => Array.isArray(m.content) ? m.content.filter(p => p.type === 'image_url') : []).length })
    return realFetch(url, { ...init, signal: AbortSignal.any([init.signal, AbortSignal.timeout(60000)]), body: JSON.stringify({ ...body, max_tokens: 2200 }) })
  }
  await runAgent({ emit(event) { if (event.type === 'agent-question') throw new Error('实测不接受额外提问') }, mode: '写作',
    userMessage: '讲解图片中的算法题。说明最小代价结论和计算步骤，用 [3,1,2] 走查。用 C++ 思路但无需完整代码，总长400字以内。直接回答，不查库、不保存笔记、不提问。', attachments: [{ path: rel }] })
  const content = sessions.loadSession(sessions.ensureActive()).messages.findLast(m => m.role === 'assistant' && !m.tool_calls?.length)?.content?.trim() || ''
  const bundled = await build({ entryPoints: ['src/noteui/parser.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
  const { planNoteUI } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))
  const components = planNoteUI(content).blocks.map(block => block.name)
  fs.writeFileSync('doc/noteui-algorithm-generated.md', content, 'utf8')
  const passed = requests.every(r => r.images === 1) && components.length >= 2 && /逆序|inversion/i.test(content)
  console.log(JSON.stringify({ model: settings.model, requests, components, passed, sample: 'doc/noteui-algorithm-generated.md' }, null, 2))
  if (!passed) process.exitCode = 1
} finally {
  clearTimeout(timer)
  Object.assign(settings, original)
  vault.setVaultRoot(originalRoot)
  globalThis.fetch = realFetch
  const absolute = path.resolve(temp)
  if (path.dirname(absolute) === path.resolve(os.tmpdir()) && path.basename(absolute).startsWith('learn-agent-vision-live-')) fs.rmSync(absolute, { recursive: true, force: true })
}
