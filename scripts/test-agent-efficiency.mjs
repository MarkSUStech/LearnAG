import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { selectRoute, buildDirectMessages, buildManagerSystem } from '../server/agent/prompt.js'
import { NOTEUI_PROMPT } from '../server/agent/noteuiPrompt.js'
import { buildTeacherSystemPrompt, buildRagHitBlock } from '../server/agent/teacherPrompts.js'
import { buildTutorPrompt } from '../server/agent/tutorPrompts.js'
import { prepareRequestMessages, applyCompaction } from '../server/agent/context.js'
import { MANAGER_TOOLS, TUTOR_TOOLS, TEACHER_TOOLS, executeScopedTool } from '../server/agent/toolProfiles.js'
import { toolDefs } from '../server/agent/tools.js'
import { runSubAgent, subAgentLabel } from '../server/agent/subagent.js'
import { SUB_AGENTS } from '../server/agent/roles.js'
import { loadSettings } from '../server/settings.js'
import { runAgent, resolvePendingAnswer, isRunning } from '../server/agent/runner.js'
import { prepareVisionMessages, recentImagePaths, validateImageAttachments, MAX_IMAGE_BYTES } from '../server/agent/vision.js'
import { runTutor, loadTutorSession } from '../server/agent/tutor.js'
import * as sessions from '../server/agent/sessions.js'
import * as vault from '../server/vault.js'

const names = (tools) => tools.map((t) => t.function.name)
const call = (name, args, id = 'c1') => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const toolGroup = (name, args, result) => [
  { role: 'assistant', reasoning_content: 'required-reasoning', content: null, tool_calls: [call(name, args)] },
  { role: 'tool', tool_call_id: 'c1', content: typeof result === 'string' ? result : JSON.stringify(result) },
]

test('social routing is local; attachments, goals, tasks and follow-ups stay on the tool path', () => {
  assert.equal(selectRoute('谢谢！'), 'direct')
  for (const [text, opts] of [['你好', { attachments: ['a.pdf'] }], ['好的', { goalId: 'g1' }], ['好的', { mode: '写作' }], ['继续', {}], ['你好，帮我改笔记', {}], ['对比梯度下降和牛顿法', {}]]) {
    assert.equal(selectRoute(text, opts), 'manage')
  }
  const history = [{ role: 'user', content: '上次的问题' }, { role: 'assistant', content: '上次的答案' }]
  const messages = buildDirectMessages('谢谢', '教学', history, '已有目标')
  assert.deepEqual(messages.slice(1, -1), history)
  assert.ok(messages[0].content.includes('已有目标'))
})

test('all generation entry points default to the same compact NoteUI grammar', () => {
  assert.ok(NOTEUI_PROMPT.includes('默认启用'))
  assert.ok(NOTEUI_PROMPT.length < 3200)
  assert.ok(buildManagerSystem({ mode: '写作' }).includes(NOTEUI_PROMPT))
  assert.ok(buildTeacherSystemPrompt().includes(NOTEUI_PROMPT))
  for (const role of ['quick', 'feynman', 'socratic']) assert.ok(buildTutorPrompt({ role, noteContent: '', notePath: 'a.md', noteTitle: 'a' }).includes(NOTEUI_PROMPT))
  assert.ok(buildTeacherSystemPrompt().length < 4500)
})

test('NoteUI output contract requires supported learning blocks and includes a complete unfenced example', () => {
  assert.match(NOTEUI_PROMPT, /必须添加对应指令/)
  assert.ok(NOTEUI_PROMPT.includes('<!-- ui:compare -->\n\n|类型|适用场景|\n|---|---|'))
  assert.ok(toolDefs.find(t => t.function.name === 'write_note').function.parameters.properties.content.description.includes('默认带对应NoteUI'))
  assert.match(NOTEUI_PROMPT, /算法题答疑/)
  assert.match(NOTEUI_PROMPT, /代码用code/)
  for (const role of ['content', 'visualize', 'scaffold']) assert.ok(SUB_AGENTS[role].system.includes(NOTEUI_PROMPT))
})

test('tool profiles retain supported operations and reject unexposed tools before execution', async () => {
  assert.deepEqual(names(TUTOR_TOOLS).sort(), ['read_graph', 'read_note', 'search_images', 'search_knowledge', 'write_note'])
  assert.ok(names(MANAGER_TOOLS).includes('write_note'))
  assert.ok(names(MANAGER_TOOLS).includes('delegate'))
  assert.equal(names(TEACHER_TOOLS).length, 9)
  assert.ok(JSON.stringify(MANAGER_TOOLS).length < JSON.stringify(toolDefs).length * 0.7)
  assert.ok(JSON.stringify(TUTOR_TOOLS).length < JSON.stringify(toolDefs).length * 0.30)
  const result = await executeScopedTool(TUTOR_TOOLS, 'delete_note', { path: 'do-not-delete.md' })
  assert.match(JSON.parse(result).error, /不可调用/)
})

test('old tool observations shrink without mutating source history or breaking call pairs', () => {
  const old = '原始资料'.repeat(3000)
  const messages = [{ role: 'user', content: '旧问题' }, ...toolGroup('read_note', { path: 'notes/a.md' }, old), { role: 'user', content: '当前问题保留' }]
  const snapshot = structuredClone(messages)
  const request = prepareRequestMessages(messages)
  assert.deepEqual(messages, snapshot)
  assert.deepEqual(request[1], messages[1])
  assert.equal(request[2].tool_call_id, request[1].tool_calls[0].id)
  assert.equal(JSON.parse(request[2].content).source, 'notes/a.md')
  assert.match(request[2].content, /不是完整文件/)
  assert.ok(request[2].content.length < 2000)
  assert.equal(request.at(-1).content, messages.at(-1).content)
})

test('mask successful historical file bodies only; current calls, reasoning and failed writes remain exact', () => {
  const content = '完整源文'.repeat(2000)
  const group = toolGroup('write_note', { path: 'a.md', content }, { ok: true, path: 'a.md' })
  const messages = [...group, { role: 'user', content: '下一个问题' }]
  const request = prepareRequestMessages(messages)
  assert.ok(JSON.parse(request[0].tool_calls[0].function.arguments).content.length < 200)
  assert.equal(request[0].reasoning_content, group[0].reasoning_content)
  assert.equal(JSON.parse(messages[0].tool_calls[0].function.arguments).content, content)
  const failed = toolGroup('write_note', { path: 'a.md', content }, { error: '失败'.repeat(3000) })
  assert.deepEqual(prepareRequestMessages([...failed, { role: 'user', content: '重试' }]).slice(0, 2), failed)
  assert.deepEqual(prepareRequestMessages([{ role: 'user', content: '请写笔记' }, ...group]).slice(1), group)
})

test('old retrieval source locations stay recoverable after observation masking', () => {
  const results = [{ path: 'book.pdf', page: 7, pageEnd: 8, text: '资料'.repeat(4000) }]
  const messages = [...toolGroup('search_knowledge', { query: '概念' }, { results }), { role: 'user', content: '继续' }]
  assert.deepEqual(JSON.parse(prepareRequestMessages(messages)[1].content).sources, [{ path: 'book.pdf', page: 7, pageEnd: 8 }])
})

test('providers can reuse call IDs across turns without mixing source paths or write outcomes', () => {
  const content = '完整源文'.repeat(2000)
  const failed = toolGroup('write_note', { path: 'failed.md', content }, { error: '拒绝写入' })
  const succeeded = toolGroup('write_note', { path: 'saved.md', content }, { ok: true, path: 'saved.md' })
  const messages = [...failed, { role: 'user', content: '下一轮' }, ...succeeded, { role: 'user', content: '继续' }]
  const request = prepareRequestMessages(messages)
  assert.deepEqual(request[0], failed[0])
  assert.match(JSON.parse(request[3].tool_calls[0].function.arguments).content, /saved.md/)
  const reads = [...toolGroup('read_note', { path: 'a.md' }, content), { role: 'user', content: '读取另一篇' }, ...toolGroup('read_note', { path: 'b.md' }, content), { role: 'user', content: '继续' }]
  const prepared = prepareRequestMessages(reads)
  assert.equal(JSON.parse(prepared[1].content).source, 'a.md')
  assert.equal(JSON.parse(prepared[4].content).source, 'b.md')
})

test('RAG keeps unique bounded snippets, source pages and marks truncation', () => {
  const hit = { path: 'book.pdf', page: 2, pageEnd: 3, text: '有用资料'.repeat(500), score: 0.8 }
  const block = buildRagHitBlock([hit, hit, { ...hit, page: 4 }, ...Array.from({ length: 9 }, (_, i) => ({ path: `n${i}.md`, text: '资料' }))])
  assert.equal((block.match(/book.pdf/g) || []).length, 2)
  assert.match(block, /第 2-3 页/)
  assert.match(block, /节选/)
  assert.ok(!block.includes('n2.md'))
  assert.equal(buildRagHitBlock([{ path: 'a.md', text: '' }]), '')
})

test('merged summaries replace old text and empty summaries retain full history', () => {
  const messages = [{ role: 'user', content: '全部历史' }]
  assert.deepEqual(applyCompaction(messages, '旧摘要', [], '合并摘要'), { messages: [], summary: '合并摘要' })
  assert.deepEqual(applyCompaction(messages, '旧摘要', [], '  '), { messages, summary: '旧摘要' })
})

test('subagent returns tool results in order, forwards reasoning and blocks tools outside its profile', async () => {
  let round = 0, executed = 0
  const replies = []
  const result = await runSubAgent({
    role: 'content', task: '创建笔记', emit() {}, signal: new AbortController().signal,
    async *streamChat({ messages, tools }) {
      replies.push(structuredClone(messages))
      assert.ok(names(tools).includes('write_note'))
      if (round++ === 0) yield { delta: { reasoning_content: '保留思考', tool_calls: [{ index: 0, id: 'c1', function: { name: 'delete_note', arguments: '{"path":"a.md"}' } }] } }
      else yield { delta: { content: '没有删除文件。' } }
    },
    async executeTool() { executed++; return '{}' },
  })
  assert.equal(executed, 0)
  assert.equal(result.result, '没有删除文件。')
  assert.equal(replies[1][2].reasoning_content, '保留思考')
  assert.match(replies[1][3].content, /不可调用/)
  assert.equal(subAgentLabel('content'), '内容 Agent')
})

function sse(delta, finish_reason = 'stop') {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
}

// Exercise the real runner/tutor using an isolated vault and a fake OpenAI endpoint.
// No paid API requests or writes to the user's vault/settings files.
async function isolated(run) {
  const settings = loadSettings()
  const original = { ...settings }, oldFetch = globalThis.fetch, originalRoot = vault.getVaultRoot()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-agent-efficiency-'))
  try {
    Object.assign(settings, { vaultPath: tmp, apiKey: 'test-only', engine: 'api', tutorEngine: 'api' })
    vault.setVaultRoot(tmp)
    const requests = []
    await run({ tmp, requests, respond(handler) {
      globalThis.fetch = async (url, init) => {
        assert.match(url, /\/chat\/completions$/)
        const body = JSON.parse(init.body)
        requests.push(body)
        return handler(body, requests.length)
      }
    } })
  } finally {
    Object.assign(settings, original)
    vault.setVaultRoot(originalRoot)
    globalThis.fetch = oldFetch
    const absolute = path.resolve(tmp)
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()))
    assert.ok(path.basename(absolute).startsWith('learn-agent-efficiency-'))
    fs.rmSync(absolute, { recursive: true, force: true })
  }
}

test('real main runner: one completion, no model router; direct reply preserves previous conversation', async () => {
  await isolated(async ({ requests, respond }) => {
    const session = sessions.createSession()
    sessions.saveSession(session.id, [{ role: 'user', content: '学习目标：概率论' }, { role: 'assistant', content: '从条件概率开始' }], '保留学习目标')
    respond(() => sse({ content: '不客气，下一次接着学条件概率。' }))
    const events = []
    await runAgent({ emit(event) { events.push(event) }, userMessage: '谢谢', mode: '教学' })
    assert.equal(events.filter(event => event.type === 'agent-reply' && !event.replace).map(event => event.text).join(''), '不客气，下一次接着学条件概率。')
    assert.ok(events.filter(event => event.type === 'agent-reply').every(event => event.sessionId === session.id))
    assert.equal(requests.length, 1)
    assert.equal(requests[0].stream, true)
    assert.ok(requests[0].messages.some((m) => m.content === '从条件概率开始'))
    assert.ok(requests[0].messages[0].content.includes('保留学习目标'))
    const saved = sessions.loadSession(session.id)
    assert.equal(saved.messages.length, 4)
    assert.match(saved.messages.at(-1).content, /条件概率/)
  })
})

test('real main runner: direct NoteUI write takes two completions; no forced delegation or source loss', async () => {
  await isolated(async ({ tmp, requests, respond }) => {
    const session = sessions.createSession()
    const content = '# 指标\n\n<!-- ui:stats -->\n\n|指标|值|\n|---|---:|\n|准确率|98%|\n'
    respond((body, n) => n === 1 ? sse({ reasoning_content: '需要保存笔记', tool_calls: [{ index: 0, id: 'write1', function: { name: 'write_note', arguments: JSON.stringify({ path: 'note.md', content }) } }] }, 'tool_calls') : sse({ content: '已保存 note.md。' }))
    await runAgent({ emit() {}, userMessage: '创建一篇指标笔记', mode: '写作' })
    assert.equal(requests.length, 2)
    assert.ok(requests.every((r) => r.stream))
    assert.ok(requests[0].messages[0].content.includes(NOTEUI_PROMPT))
    assert.deepEqual(names(requests[0].tools), names(MANAGER_TOOLS))
    assert.equal(requests[1].messages.at(-2).reasoning_content, '需要保存笔记')
    assert.equal(fs.readFileSync(path.join(tmp, 'note.md'), 'utf8'), content)
    const saved = sessions.loadSession(session.id)
    assert.equal(JSON.parse(saved.messages[1].tool_calls[0].function.arguments).content, content)
    assert.equal(saved.messages.at(-1).content, '已保存 note.md。')
  })
})

test('real note tutor: scoped tools, full file read and reasoning survive the tool continuation', async () => {
  await isolated(async ({ tmp, requests, respond }) => {
    const content = '# 笔记\n\n<!-- ui:concept -->\n\n|术语|定义|\n|---|---|\n|概率|事件的可能性|\n'
    fs.writeFileSync(path.join(tmp, 'a.md'), content)
    respond((body, n) => n === 1 ? sse({ reasoning_content: '查阅原文', tool_calls: [{ index: 0, id: 'read1', function: { name: 'read_note', arguments: '{"path":"a.md"}' } }] }, 'tool_calls') : sse({ content: '可以用抛硬币理解。' }))
    await runTutor({ emit() {}, notePath: 'a.md', role: 'quick', message: '解释概率' })
    assert.equal(requests.length, 2)
    assert.deepEqual(names(requests[0].tools), names(TUTOR_TOOLS))
    assert.equal(requests[1].messages.at(-2).reasoning_content, '查阅原文')
    assert.equal(requests[1].messages.at(-1).content, content)
    assert.equal(fs.readFileSync(path.join(tmp, 'a.md'), 'utf8'), content)
    assert.equal(loadTutorSession('a.md').at(-1).content, '可以用抛硬币理解。')
  })
})

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=', 'base64')
function imageFile(tmp, name = 'picture.png') {
  fs.writeFileSync(path.join(tmp, name), png)
  return name
}
const visionParts = (request) => request.messages.flatMap(m => Array.isArray(m.content) ? m.content.filter(p => p.type === 'image_url') : [])

test('global image input reaches the actual model request; history stores paths and supports follow-up', async () => {
  await isolated(async ({ tmp, requests, respond }) => {
    const session = sessions.createSession()
    const rel = imageFile(tmp, '截图 (1).png')
    respond(() => sse({ content: '图片是一个示例。' }))
    await runAgent({ emit() {}, userMessage: '解释图片', mode: '教学', attachments: [{ path: rel, primary: true }, { path: 'book.pdf', scope: { chapter: '第一章' } }] })
    assert.equal(requests.length, 1)
    assert.equal(visionParts(requests[0])[0].image_url.url, 'data:image/png;base64,' + png.toString('base64'))
    assert.match(requests[0].messages.at(-1).content[0].text, /第一章/)
    assert.ok(!requests[0].messages.at(-1).images)
    const saved = sessions.loadSession(session.id)
    assert.deepEqual(saved.messages[0].images, [rel])
    assert.equal(typeof saved.messages[0].content, 'string')
    assert.ok(!JSON.stringify(saved).includes('data:image'))
    assert.match(fs.readFileSync(path.join(tmp, 'Agent/工作台.md'), 'utf8'), /!\[用户图片\]\(<截图 \(1\).png>\)/)
    await runAgent({ emit() {}, userMessage: '继续解释刚才的图片', mode: '教学' })
    assert.equal(visionParts(requests[1]).length, 1)
    assert.deepEqual(sessions.loadSession(session.id).messages[0].images, [rel])
  })
})

test('vision history is bounded to four recent unique images without changing stored messages', async () => {
  await isolated(async ({ tmp }) => {
    const files = Array.from({ length: 6 }, (_, i) => imageFile(tmp, `image-${i}.png`))
    const messages = files.map(rel => ({ role: 'user', content: rel, images: [rel] }))
    messages.push({ role: 'user', content: '再看最后一张', images: [files[5]] })
    const snapshot = structuredClone(messages)
    const converted = prepareVisionMessages(messages)
    assert.deepEqual(recentImagePaths(messages), files.slice(-4))
    assert.equal(visionParts({ messages: converted }).length, 4)
    assert.match(converted[0].content, /历史图片路径/)
    assert.deepEqual(messages, snapshot)
  })
})

test('images reject corruption, excessive size/count and paths outside the vault before model use', async () => {
  await isolated(async ({ tmp }) => {
    fs.writeFileSync(path.join(tmp, 'invalid.png'), 'not an image')
    assert.throws(() => validateImageAttachments(['invalid.png']), /无法识别/)
    const large = path.join(tmp, 'large.png')
    fs.writeFileSync(large, png)
    fs.truncateSync(large, MAX_IMAGE_BYTES + 1)
    assert.throws(() => validateImageAttachments(['large.png']), /10MB/)
    assert.throws(() => validateImageAttachments(['../outside.png']), /vault/)
    assert.throws(() => validateImageAttachments(Array.from({ length: 5 }, (_, i) => `${i}.png`)), /最多发送4张/)
    assert.deepEqual(validateImageAttachments(['book.pdf']), [])
  })
})

test('image MIME comes from real bytes instead of a misleading extension', async () => {
  await isolated(async ({ tmp }) => {
    imageFile(tmp, 'picture.jpg')
    const request = prepareVisionMessages([{ role: 'user', content: '看图', images: ['picture.jpg'] }])
    assert.ok(request[0].content[1].image_url.url.startsWith('data:image/png;'))
  })
})

test('specialist delegation receives the same image without extra vision model calls', async () => {
  await isolated(async ({ tmp, requests, respond }) => {
    const rel = imageFile(tmp)
    sessions.createSession()
    respond((body, n) => n === 1
      ? sse({ tool_calls: [{ index: 0, id: 'delegate1', function: { name: 'delegate', arguments: JSON.stringify({ role: 'content', task: '解释图片' }) } }] }, 'tool_calls')
      : sse({ content: n === 2 ? '图片中的要点。' : '已解释。' }))
    await runAgent({ emit() {}, userMessage: '分析这张图', mode: '写作', attachments: [{ path: rel }] })
    assert.equal(requests.length, 3)
    assert.ok(requests.every(r => visionParts(r).length === 1))
    assert.ok(requests[1].messages[0].content.includes('内容 Agent'))
  })
})

test('answering a tool question with an image preserves adjacent tool-result groups', async () => {
  await isolated(async ({ tmp, requests, respond }) => {
    const rel = imageFile(tmp)
    fs.writeFileSync(path.join(tmp, 'note.md'), '# 资料')
    sessions.createSession()
    respond((body, n) => n === 1
      ? sse({ reasoning_content: '需要用户解答', tool_calls: [
        { index: 0, id: 'ask1', function: { name: 'ask_user', arguments: '{"question":"上传你的解题图","type":"text"}' } },
        { index: 1, id: 'read1', function: { name: 'read_note', arguments: '{"path":"note.md"}' } },
      ] }, 'tool_calls')
      : sse({ content: '收到解题图。' }))
    await runAgent({ emit(e) { if (e.type === 'agent-question') resolvePendingAnswer(e.id, { value: '这是我的解法', files: [{ path: rel, name: rel }] }) }, userMessage: '检查我的解法', mode: '教学' })
    const continuation = requests[1].messages
    const callIndex = continuation.findIndex(m => m.tool_calls?.[0]?.id === 'ask1')
    assert.equal(continuation[callIndex + 1].role, 'tool')
    assert.equal(continuation[callIndex + 2].role, 'tool')
    assert.equal(continuation[callIndex + 3].role, 'user')
    assert.match(continuation[callIndex + 1].content, /这是我的解法/)
    assert.equal(visionParts(requests[1]).length, 1)
  })
})

test('unsupported vision models fail clearly without silently dropping the image or retrying', async () => {
  await isolated(async ({ tmp, requests, respond }) => {
    const rel = imageFile(tmp)
    sessions.createSession()
    respond(() => new Response('{"error":"image_url not supported by this model"}', { status: 400 }))
    await assert.rejects(runAgent({ emit() {}, userMessage: '看图', mode: '教学', attachments: [{ path: rel }] }), /支持视觉/)
    assert.equal(requests.length, 1)
    assert.equal(isRunning(), false)
  })
})

test('legacy global attachments become image input on follow-up without rewriting stored history', async () => {
  await isolated(async ({ tmp, requests, respond }) => {
    const rel = imageFile(tmp, '旧图片 (1).png')
    const session = sessions.createSession()
    const old = { role: 'user', content: `【模式：写作】讲解这道题\n【附带资料】（[重点]=笔记核心依据；[次要]=补充对照）\n- [重点] ${rel} ｜ 建议范围：未指定（先定位相关章节/页码，禁止全文读入）\n` }
    sessions.saveSession(session.id, [old, { role: 'assistant', content: '以前未提供图像。' }], '')
    respond(() => sse({ content: '这次能收到原图。' }))
    await runAgent({ emit() {}, userMessage: '重新看刚才的题目图片', mode: '写作' })
    assert.equal(visionParts(requests[0]).length, 1)
    assert.deepEqual(sessions.loadSession(session.id).messages[0], old)
    assert.deepEqual(recentImagePaths([old]), [rel])
    assert.deepEqual(recentImagePaths([{ role: 'user', content: `提到一个图片文件 ${rel}` }]), [])
    assert.deepEqual(recentImagePaths([{ role: 'assistant', content: old.content }]), [])
  })
})

test('read_note images reach the model after the complete tool group, never as binary text', async () => {
  await isolated(async ({ tmp, requests, respond }) => {
    const rel = imageFile(tmp)
    fs.writeFileSync(path.join(tmp, 'a.md'), '文字资料')
    sessions.createSession()
    respond((body, n) => n === 1 ? sse({ tool_calls: [
      { index: 0, id: 'read-image', function: { name: 'read_note', arguments: JSON.stringify({ path: rel }) } },
      { index: 1, id: 'read-text', function: { name: 'read_note', arguments: '{"path":"a.md"}' } },
    ] }, 'tool_calls') : sse({ content: '已看到图像。' }))
    await runAgent({ emit() {}, userMessage: `请解释 ${rel} 中的题目`, mode: '写作' })
    assert.equal(requests.length, 2)
    const messages = requests[1].messages
    assert.deepEqual(messages.slice(-3).map(m => m.role), ['tool', 'tool', 'user'])
    assert.equal(JSON.parse(messages.at(-3).content).image, true)
    assert.equal(messages.at(-2).content, '文字资料')
    assert.equal(visionParts(requests[1]).length, 1)
    assert.deepEqual(recentImagePaths(sessions.loadSession(sessions.ensureActive()).messages), [rel])
  })
})

test('missing historical images give a clear hint instead of breaking the next turn', async () => {
  await isolated(async () => {
    const messages = [{ role: 'user', content: '已删除的旧截图', images: ['missing.png'] }, { role: 'user', content: '继续别的内容' }]
    const request = prepareVisionMessages(messages)
    assert.equal(visionParts({ messages: request }).length, 0)
    assert.match(request[0].content.at(-1).text, /已被删除/)
    assert.equal(request.at(-1).content, '继续别的内容')
  })
})

test('failed image reads and unverified tool output never create image parts', async () => {
  await isolated(async ({ tmp }) => {
    const rel = imageFile(tmp)
    const group = toolGroup('read_note', { path: rel }, { error: '没有权限' })
    assert.equal(visionParts({ messages: prepareVisionMessages(group) }).length, 0)
    const other = toolGroup('search_knowledge', {}, { path: rel, image: true })
    assert.equal(visionParts({ messages: prepareVisionMessages(other) }).length, 0)
  })
})
