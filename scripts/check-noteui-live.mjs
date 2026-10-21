// Explicit, one-request smoke check. Not part of automated tests; uses the configured API.
import fs from 'node:fs'
import { build } from 'esbuild'
import { loadSettings } from '../server/settings.js'
import { NOTEUI_PROMPT } from '../server/agent/noteuiPrompt.js'

if (!process.argv.includes('--run')) {
  console.log('Opt-in live check: node scripts/check-noteui-live.mjs --run (one configured model request)')
  process.exit(0)
}
const settings = loadSettings()
if (settings.engine !== 'api' || !settings.apiKey) throw new Error('此检查需要已配置的API引擎和密钥')
const response = await fetch(settings.apiBaseURL.replace(/\/+$/, '') + '/chat/completions', {
  method: 'POST', signal: AbortSignal.timeout(45000),
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.apiKey },
  body: JSON.stringify({ model: settings.model, stream: false, temperature: 0.2, max_tokens: 900,
    messages: [
      { role: 'system', content: '你是中文学习笔记助手。直接输出笔记正文。\n' + NOTEUI_PROMPT },
      { role: 'user', content: '写一篇100字左右的随机变量变换复习笔记，比较离散和连续两种情形，再出一道有两个选项和解析的单选自测题。' },
    ],
  }),
})
if (!response.ok) throw new Error('模型接口 HTTP ' + response.status)
const result = await response.json()
const content = result.choices?.[0]?.message?.content || ''
const bundled = await build({ entryPoints: ['src/noteui/parser.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { planNoteUI } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))
const components = planNoteUI(content).blocks.map(b => b.name)
fs.writeFileSync('doc/noteui-generated-sample.md', content, 'utf8')
console.log(JSON.stringify({ model: settings.model, finish: result.choices?.[0]?.finish_reason, components, usage: result.usage,
  sample: 'doc/noteui-generated-sample.md', passed: components.includes('compare') && components.includes('quiz') }, null, 2))
if (!components.includes('compare') || !components.includes('quiz')) process.exitCode = 1
