import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { noteUIRegistry, parameterChoices, componentGuide } from '../shared/noteuiRegistry.js'
import { NOTEUI_PROMPT } from '../server/agent/noteuiPrompt.js'
const bundle = async path => { const result = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false }); return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')) }
const { planNoteUI, definitions, parseDirective } = await bundle('src/noteui/parser.ts')
const { catalog } = await bundle('src/noteui/catalog.ts')
const { compositionExample } = await bundle('src/noteui/galleryExamples.ts')
const wrap = (name, body) => `<!-- ui:${name} -->\n\n${body}\n\n<!-- ui:end -->`

test('all 38 parser, catalog and prompt entries use the same schema, defaults and metadata', async () => {
  assert.equal(Object.keys(noteUIRegistry).length, 38)
  assert.deepEqual(Object.keys(noteUIRegistry).sort(), Object.keys(definitions).sort())
  assert.deepEqual(Object.keys(noteUIRegistry).sort(), Object.keys(catalog).sort())
  for (const [name, spec] of Object.entries(noteUIRegistry)) {
    assert.deepEqual(definitions[name].params, parameterChoices(name), name)
    assert.equal(spec.category, catalog[name].category, name)
    for (const p of Object.values(spec.params)) if (p.default && p.values) assert.ok(p.values.includes(p.default), name)
    assert.ok(NOTEUI_PROMPT.includes(componentGuide().split('\n').find(s => s.startsWith(name + '：') || s.startsWith(name + ' '))), name)
    assert.ok(spec.label && spec.description && Array.isArray(spec.state) && Array.isArray(spec.slots))
  }
  const declaration = await readFile('shared/noteuiRegistry.d.ts', 'utf8')
  for (const name of Object.keys(noteUIRegistry)) assert.ok(declaration.includes(`  ${name}: ComponentSpec`))
})
test('paired composition consumes only its own Markdown, with explicit cell boundaries', () => {
  const body = wrap('grid columns=2', '### 甲\n\n左侧正文\n\n<!-- ui:cell -->\n\n### 乙\n\n右侧正文')
  const source = `前文\n\n${body}\n\n后文`
  const plan = planNoteUI(source)
  assert.equal(plan.blocks.length, 1)
  assert.equal(plan.blocks[0].name, 'grid')
  assert.deepEqual(plan.blocks[0].data.cells, ['### 甲\n\n左侧正文', '### 乙\n\n右侧正文'])
  assert.ok(plan.markdown.includes('前文') && plan.markdown.includes('后文'))
  assert.equal(plan.blocks[0].source.trim(), body)
})
test('nested layout and teaching widgets keep local boundaries and mathematical source', () => {
  const plan = planNoteUI(compositionExample)
  assert.deepEqual(plan.blocks.map(b => b.name), ['grid', 'code', 'steps'])
  const left = planNoteUI(plan.blocks[0].data.cells[0]), right = planNoteUI(plan.blocks[0].data.cells[1])
  assert.equal(left.blocks[0].name, 'distribution')
  assert.deepEqual(right.blocks.map(b => b.name), ['concept', 'popover'])
  assert.equal(plan.blocks[1].data.annotations.length, 4)
})
test('unclosed, empty and invalid nested layouts fall back entirely without swallowing later valid content', () => {
  for (const body of [wrap('grid columns=9', '原文'), wrap('grid', '<!-- ui:cell -->\n\n内容'), wrap('grid', wrap('row gap=999', '内容')), '<!-- ui:grid -->\n\n正文']) {
    const plan = planNoteUI(body, true)
    assert.equal(plan.blocks.length, 0, body)
    assert.equal(plan.markdown, body)
  }
  const invalid = wrap('grid columns=9', '原文')
  const valid = catalog.stats.source
  const plan = planNoteUI(invalid + '\n\n' + valid)
  assert.equal(plan.blocks[0].name, 'stats')
  assert.ok(plan.markdown.includes('原文'))
})
test('four nested levels, twelve cells and bounded composition sizes are enforced', () => {
  let body = '内容'; for (let i = 0; i < 4; i++) body = wrap('box', body)
  assert.equal(planNoteUI(body).blocks.length, 1)
  assert.equal(planNoteUI(wrap('box', body)).blocks.length, 0)
  assert.equal(planNoteUI(wrap('row', Array(12).fill('内容').join('\n\n<!-- ui:cell -->\n\n'))).blocks.length, 1)
  assert.equal(planNoteUI(wrap('row', Array(13).fill('内容').join('\n\n<!-- ui:cell -->\n\n'))).blocks.length, 0)
  assert.equal(planNoteUI(wrap('box', 'a'.repeat(100001))).blocks.length, 0)
})
test('partial streaming layouts wait for an entire close marker and preserve plain source', () => {
  const source = wrap('grid', '正文\n\n<!-- ui:cell -->\n\n另一格')
  for (let i = 0; i < source.length; i++) {
    const partial = source.slice(0, i), plan = planNoteUI(partial, true)
    assert.equal(plan.blocks.length, 0, String(i)); assert.equal(plan.markdown, partial)
  }
  assert.equal(planNoteUI(source, true).blocks.length, 1)
})
test('layout boundaries inside fences, inline code, blockquotes and lists are never interpreted', () => {
  for (const source of ['~~~md\n' + wrap('row', '内容') + '\n~~~', '`<!-- ui:row -->`', '> <!-- ui:row -->\n> 内容\n> <!-- ui:end -->', '- <!-- ui:row -->\n  内容\n  <!-- ui:end -->']) assert.equal(planNoteUI(source).blocks.length, 0)
})
test('layout parameters cannot inject styles, HTML, events or code', () => {
  for (const directive of ['row style="color:red"', 'grid columns="calc(2)"', 'box tone=red', 'card onclick=alert(1)', 'row gap=32', 'popover title="<script>" bad=yes']) assert.equal(parseDirective(`<!-- ui:${directive} -->`), null)
})
test('CRLF source and stable React keys survive layout rendering and unrelated appended prose', () => {
  const source = wrap('row', '甲\n\n<!-- ui:cell -->\n\n乙').replace(/\n/g, '\r\n')
  const first = planNoteUI(source).blocks[0], second = planNoteUI(source + '\r\n\r\n新正文').blocks[0]
  assert.equal(first.source, source); assert.equal(first.key, second.key)
})
test('code annotation order follows actual line numbers including blank lines', () => {
  const source = '<!-- ui:code -->\n\n~~~python\nx=1\n\ny=x+1\n~~~\n\n|行号|讲解|\n|---|---|\n|3|使用x|\n|1|初始化x|'
  const data = planNoteUI(source).blocks[0].data
  assert.deepEqual(data.annotations.map(a => a.line), [1, 3]); assert.equal(data.code.split('\n')[1], '')
})

const { parseDrawing, validDrawingPath } = await bundle('src/noteui/svgModel.ts')
test('SVG primitives validate coordinates, shapes, paths and dimensions without accepting markup', () => {
  const data = planNoteUI(catalog.svg.source).blocks[0].data
  assert.equal(data.shapes.length, 7)
  assert.equal(data.width, 640); assert.equal(data.height, 260)
  assert.ok(validDrawingPath('M 10 10 L 40 20 Q 30 40 50 60 C 10 20 30 40 50 60 Z'))
  for (const path of ['<svg onload=alert(1)>', 'M 0 0 L Infinity 2', 'M 0 0 L 1', 'M 0 0 A 1 2 3', 'M 0 0 Q 1 2', 'M 0 0 L 999999 1', 'm 0 0', 'M 0 0 L 1 2'.repeat(40)]) assert.equal(validDrawingPath(path), false, path)
  const table = rows => ({ headers: ['形状', '位置', '尺寸', '文字', '颜色'], rows })
  for (const row of [['script', '0,0', '10,10', 'x', 'ink'], ['rect', '0,0', '-1,10', '', 'ink'], ['arrow', '0,0', '10', '', 'ink'], ['text', '0,0', '50', '大字', 'ink'], ['polygon', '0,0;10,10', '', '', 'ink'], ['circle', '0,0', '10', '', 'url(https://x)'], ['path', 'M 0 0 Z onclick=x', '', '', 'ink']]) assert.equal(parseDrawing(table([row]), {}), null)
  assert.equal(parseDrawing(table([['circle', '20,20', '10', 'A', 'blue']]), { width: '900000' }), null)
  assert.equal(parseDrawing(table(Array(81).fill(['circle', '20,20', '10', 'A', 'blue'])), {}), null)
})
