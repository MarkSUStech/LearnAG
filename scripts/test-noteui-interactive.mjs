import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
const bundle = async path => {
  const result = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false })
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
}
const { planNoteUI, definitions, parseDirective } = await bundle('src/noteui/parser.ts')
const { sequenceFrames, distributionCurve, plotValue, vennSelection } = await bundle('src/noteui/interactiveModels.ts')
const { catalog } = await bundle('src/noteui/catalog.ts')
const md = (name, headers, rows) => `<!-- ui:${name} -->\n\n|${headers.join('|')}|\n|${headers.map(() => '---').join('|')}|\n${rows.map(r => '|' + r.join('|') + '|').join('\n')}`
const parse = (...args) => planNoteUI(md(...args)).blocks[0]?.data

test('28 learning types remain compatible alongside the nine layout primitives', async () => {
  const old = await readFile('server/demo-vault/笔记/NoteUI/note/NoteUI学习全场景示例.md', 'utf8')
  const fresh = await readFile('server/demo-vault/笔记/NoteUI/note/NoteUI可视化实验室.md', 'utf8')
  assert.equal(Object.keys(definitions).length, 38)
  const layouts = ['row', 'col', 'box', 'grid', 'card', 'divider', 'spacer', 'carousel', 'popover', 'svg']
  assert.deepEqual([...new Set(planNoteUI(old + '\n\n' + fresh).blocks.map(b => b.name))].sort(), Object.keys(definitions).filter(n => !layouts.includes(n)).sort())
  assert.equal(planNoteUI(fresh).blocks.length, 13)
})
test('every insertable catalog template activates exactly its registered type', () => {
  assert.deepEqual(Object.keys(catalog).sort(), Object.keys(definitions).sort())
  for (const [name, entry] of Object.entries(catalog)) {
    const blocks = planNoteUI(entry.source).blocks
    assert.equal(blocks.length, 1, name)
    assert.equal(blocks[0].name, name)
  }
})
test('directed bead cancellation removes newly adjacent pairs and preserves item identity/source', () => {
  const data = parse('sequence mode=cancel pair=R,B', ['元素', '说明'], 'BRRBBR'.split('').map(v => [v, '珠子']))
  const frames = sequenceFrames(data)
  assert.deepEqual(frames.at(-1).items.map(v => v.value), ['B', 'R'])
  assert.equal(frames.at(-1).removed, 2)
  assert.equal(data.items.length, 6)
  assert.deepEqual(frames[1].active, [2, 3])
  assert.deepEqual(frames.at(-1).items.map(v => v.id), [0, 5])
  assert.equal(sequenceFrames(parse('sequence mode=cancel', ['值', '说明'], [['B', ''], ['R', '']])).at(-1).removed, 0)
})
test('numeric adjacent sorting is stable and bounded, rejects non-numeric sort and invalid pairs', () => {
  const data = parse('sequence mode=sort', ['值', '说明'], [['3', 'a'], ['1', 'b'], ['3', 'c'], ['-2', 'd']])
  const frames = sequenceFrames(data)
  assert.deepEqual(frames.at(-1).items.map(v => v.id), [3, 1, 0, 2])
  assert.equal(data.items[0].value, '3')
  assert.ok(frames.length <= 4 * 3 / 2 + 2)
  for (const [name, rows] of [['sequence mode=sort', [['abc', '']]], ['sequence pair=X,Y', [['X', '']]], ['sequence mode=cancel pair=X,X', [['X', '']]]]) assert.equal(parse(name, ['值', '说明'], rows), undefined)
})
test('distribution parameters default missing values and validate bounds, integer trials, step alignment and whitelist', () => {
  assert.equal(parse('distribution type=binomial', ['参数', '值'], [['p', '0.4']]).parameters.find(p => p.name === 'n').value, 20)
  for (const [name, rows] of [
    ['distribution', [['lambda', '-1', '0', '20', '0.1']]], ['distribution', [['lambda', '7.55', '0', '20', '.1']]],
    ['distribution', [['lambda', '7', '0', '31', '1']]], ['distribution', [['lambda', '7', '0', '20', '0']]],
    ['distribution type=binomial', [['n', '1.5', '1', '100', '1']]], ['distribution type=normal', [['sigma', '0', '0', '10', '.1']]],
    ['distribution', [['__proto__', '1']]], ['distribution', [['lambda', '1'], ['lambda', '2']]],
  ]) assert.equal(parse(name, rows[0].length === 5 ? ['参数', '值', '最小', '最大', '步长'] : ['参数', '值'], rows), undefined)
  assert.equal(parseDirective('<!-- ui:distribution type=custom -->'), null)
})
test('Poisson mass/moments agree across zero and maximum lambda without factorial overflow', () => {
  for (const lambda of [0, .1, 7.5, 30]) {
    const curve = distributionCurve('poisson', { lambda })
    const mass = curve.points.reduce((v, p) => v + p.y, 0)
    const mean = curve.points.reduce((v, p) => v + p.x * p.y, 0)
    assert.ok(Math.abs(mass - 1) < 1e-5, String(lambda))
    assert.ok(Math.abs(mean - lambda) < .001, String(lambda))
    assert.equal(curve.mean, lambda); assert.equal(curve.variance, lambda)
    assert.ok(curve.points.every(p => p.y >= 0 && Number.isFinite(p.y)))
  }
})
test('binomial handles p=0/1 and normal uses density with the correct area and moments', () => {
  for (const p of [0, .4, 1]) {
    const c = distributionCurve('binomial', { n: 100, p })
    assert.ok(Math.abs(c.points.reduce((v, p) => v + p.y, 0) - 1) < 1e-10)
    assert.equal(c.mean, 100 * p); assert.equal(c.variance, 100 * p * (1 - p))
  }
  const normal = distributionCurve('normal', { mu: 3, sigma: 2 })
  const dx = normal.points[1].x - normal.points[0].x
  const area = normal.points.reduce((v, p, i) => v + p.y * dx * (i === 0 || i === normal.points.length - 1 ? .5 : 1), 0)
  assert.ok(Math.abs(area - 1) < .0001); assert.equal(normal.mean, 3); assert.equal(normal.variance, 4)
})
test('Venn uses disjoint membership masks and rejects duplicate, unknown, repeated and negative regions', () => {
  const d = parse('venn sets=A,B,C', ['区域', '标签', '数量'], [['A', '①', '4'], ['B&A', '④', '2'], ['A&B&C', '⑦', '1']])
  assert.deepEqual(d.regions.map(r => r.mask), [1, 3, 7]); assert.equal(d.regions.reduce((v, r) => v + r.count, 0), 7)
  assert.equal(vennSelection(3, 'intersection', 7), false); assert.equal(vennSelection(7, 'intersection', 7), true)
  assert.equal(vennSelection(4, 'exclusive', 7), true); assert.equal(vennSelection(5, 'exclusive', 7), false)
  for (const rows of [[['A', '1'], ['A', '2']], [['A&A', '1']], [['D', '1']], [['A', '1', '-1']]]) assert.equal(parse('venn sets=A,B', rows[0].length === 3 ? ['区域', '标签', '数量'] : ['区域', '标签'], rows), undefined)
  assert.equal(parse('venn sets=A,B,C,D', ['区域', '标签'], [['A', '1']]), undefined)
})
test('matrix preserves mathematical cells, geometry validates coordinates and numberline enforces open endpoints', () => {
  const matrix = parse('matrix', ['行', 'x', 'y'], [['r', '$a_i$', '0']])
  assert.equal(matrix.numeric, false); assert.equal(matrix.rows[0].values[0], '$a_i$')
  assert.equal(parse('matrix', ['行', 'x'], [['r', '']]), undefined)
  const points = [['A', '0', '0'], ['B', '4', '0'], ['C', '0', '3']]
  assert.equal(parse('geometry', ['点', 'x', 'y'], points).points.length, 3)
  assert.equal(parse('geometry', ['点', 'x', 'y'], points.slice(0, 2)), undefined)
  assert.equal(parse('geometry mode=vectors', ['点', 'x', 'y'], [['u', '1', 'NaN']]), undefined)
  for (const row of [['倒置', '3', '1', '[]'], ['空集', '2', '2', '()'], ['无限', '-Infinity', '2', '[]']]) assert.equal(parse('numberline', ['名', '左', '右', '开闭'], [row]), undefined)
  assert.equal(parse('numberline', ['名', '左', '右', '开闭'], [['单点', '2', '2', '[]']])[0].from, 2)
})
test('safe function families have predictable values; arbitrary expressions and playback indexes fail locally', () => {
  assert.equal(plotValue('quadratic', 2, { a: 1, b: 2, c: 3 }), 11)
  assert.equal(plotValue('linear', 2, { a: 3, b: 1 }), 7)
  assert.ok(Math.abs(plotValue('sine', Math.PI / 2, { a: 2, b: 1, c: 0 }) - 2) < 1e-10)
  assert.equal(parseDirective('<!-- ui:plot fn=eval -->'), null)
  const d = parse('playback', ['步', '状态', '解释', '高亮'], [['初始化', '1,2,3', '$i=0$', '0,2']])
  assert.deepEqual(d.frames[0].active, [0, 2]); assert.equal(d.frames[0].detail, '$i=0$')
  for (const active of ['3', '-1', '1.5', 'NaN']) assert.equal(parse('playback', ['步', '状态', '解释', '高亮'], [['a', '1,2', 'b', active]]), undefined)
})
test('new controls preserve exact source and streaming fallback; invalid blocks cannot break adjacent valid content', () => {
  const valid = md('distribution', ['参数', '值'], [['lambda', '7.5']]).replace(/\n/g, '\r\n')
  assert.equal(planNoteUI(valid).blocks[0].source, valid)
  assert.equal(planNoteUI(valid, true).blocks.length, 0)
  assert.equal(planNoteUI(valid + '\r\n\r\n', true).blocks.length, 1)
  const invalid = md('venn sets=A,B', ['区域', '标签'], [['C', '未知']])
  const plan = planNoteUI(invalid + '\n\n' + valid)
  assert.equal(plan.blocks.length, 1); assert.ok(plan.markdown.includes('|C|未知|'))
  assert.equal(planNoteUI(md('sequence mode=sort', ['值', '说明'], Array.from({ length: 61 }, (_, i) => [i, '']))).blocks.length, 0)
})
