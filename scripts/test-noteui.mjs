import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { NOTEUI_PROMPT } from '../server/agent/noteuiPrompt.js'
import { buildTeacherSystemPrompt } from '../server/agent/teacherPrompts.js'
import { buildTutorPrompt } from '../server/agent/tutorPrompts.js'

// Bundle the real TypeScript parser with Vite's existing esbuild. No test runtime dependency.
const result = await build({ entryPoints: ['src/noteui/parser.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { planNoteUI, parseDirective, numeric, hasNoteUIMarker } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
const mathBuild = await build({ entryPoints: ['src/markdown/math.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { protectMathPipes } = await import('data:text/javascript;base64,' + Buffer.from(mathBuild.outputFiles[0].text).toString('base64'))
const table = '| year | count | loss |\n|---|---:|---:|\n| 2024 | 126 | 0.68 |\n| 2025 | 273 | 0.43 |'
const block = (directive, data = table) => `<!-- ui:${directive} -->\n\n${data}`

test('math pipes are masked with exact offsets and restore TeX delimiters without doubling escapes', () => {
  for (const formula of ['$P(A|B)$', String.raw`$f_Y(y)=f_X(h(y))\big\|h'(y)\big\|$`, String.raw`$$\left|x\right|+\|v\|$$`, String.raw`\(P(A|B)\)`, String.raw`\[\begin{matrix}|x| & \|v\|\\a&b\end{matrix}\]`, '$f(x)=\n|x|$']) {
    const source = '|公式|说明|\n|---|---|\n|' + formula + '|原文|'
    const masked = protectMathPipes(source)
    assert.equal(masked.markdown.length, source.length)
    assert.equal(masked.restore(masked.markdown), source)
    assert.equal((masked.markdown.match(/\|/g) || []).length, 9)
  }
})

test('pipe masking leaves code, escapes, incomplete math and existing private-use text untouched', () => {
  for (const source of ['```md\n$P(A|B)$\n```', '~~~~markdown\n$P(A|B)$\n~~~~', '    $P(A|B)$', '`$P(A|B)$`', '`` `$P(A|B)$` ``', String.raw`\$P(A|B)`, '$P(A|B)', '普通 | 表格']) assert.equal(protectMathPipes(source).markdown, source)
  const source = '\ue000\n$P(A|B)$'
  const masked = protectMathPipes(source)
  assert.ok(masked.markdown.startsWith('\ue000'))
  assert.equal(masked.restore(masked.markdown), source)
})

test('NoteUI formula tables retain raw/bare/escaped pipes and exact CRLF source slices', () => {
  const data = String.raw`|类型|动作|公式|
|---|---|---|
|单调|雅可比|$f_Y(y)=f_X(h(y))\big\|h'(y)\big\|$|
|分段|求和|$f_Y(y)=\sum_j f_X(h_j(y))|h'_j(y)|$|`
  for (const name of ['compare', 'table', 'concept', 'derivation']) {
    const source = block(name, data).replace(/\n/g, '\r\n')
    const plan = planNoteUI(source)
    assert.equal(plan.blocks.length, 1, name)
    assert.equal(plan.blocks[0].source, source)
    assert.equal(plan.blocks[0].data.rows[0][2], String.raw`$f_Y(y)=f_X(h(y))\big\|h'(y)\big\|$`)
    assert.equal(plan.blocks[0].data.rows[1].length, 3)
    assert.equal(planNoteUI(block(name, data.replace('|单调|雅可比|', '|单调|雅可比|多余列|'))).blocks.length, 0)
  }
})

test('all four chart types and multiple series normalize real table tokens', () => {
  for (const type of ['line', 'bar', 'pie', 'scatter']) {
    const plan = planNoteUI(block(`chart type=${type} x=year y=count`))
    assert.equal(plan.blocks[0]?.data.type, type)
    assert.deepEqual(plan.blocks[0].data.series[0].values, [126, 273])
    if (type === 'scatter') assert.deepEqual(plan.blocks[0].data.numericX, [2024, 2025])
  }
  assert.equal(planNoteUI(block('chart x=year y=count,loss')).blocks[0].data.series.length, 2)
})

test('strict parameters: quoted titles, duplicate/unknown/restricted keys and components', () => {
  assert.equal(parseDirective('<!-- ui:chart x="学习 年份" y=count title="年度 记录" -->').params.title, '年度 记录')
  for (const directive of ['chart x=year y=count onclick=evil', 'stats style=red', 'stats title=A title=B', 'chart x=year y=count type=area', 'html', 'constructor', 'tostring', 'stats title="unterminated', 'stats title=', 'stats title=""']) {
    assert.equal(planNoteUI(block(directive)).blocks.length, 0, directive)
  }
})

test('malformed and unclosed directives safely remain unchanged', () => {
  for (const text of ['<!-- ui:', '<!-- ui:stats', '<!-- ui:stats -->', '<!-- ui:stats -->\n\nnot a table', '<!-- ui:stats -->\n\n<!-- another comment -->\n\n' + table]) {
    assert.equal(planNoteUI(text).markdown, text)
  }
})

test('fenced code, tilde fences, inline code, blockquotes, list nesting and HTML containers never activate', () => {
  const text = block('stats')
  const examples = ['```md\n' + text + '\n```', '~~~md\n' + text + '\n~~~', '`<!-- ui:stats -->`\n\n' + table, text.split('\n').map(l => '> ' + l).join('\n'), '- item\n\n' + text.split('\n').map(l => '    ' + l).join('\n'), '<div>\n' + text + '\n</div>']
  examples.forEach(example => assert.equal(planNoteUI(example).blocks.length, 0, example))
})

test('plain Markdown and unknown directives are byte-for-byte unchanged', () => {
  for (const text of ['# Hello\r\n\r\n$E=mc^2$\r\n\r\n' + table, block('future color=red'), '> quote\n\n```mermaid\ngraph LR\nA-->B\n```']) assert.equal(planNoteUI(text).markdown, text)
})

test('only actual block comments select source editing, while incomplete directives stay protected', () => {
  assert.equal(hasNoteUIMarker('```md\n' + block('stats') + '\n```'), false)
  assert.equal(hasNoteUIMarker('`<!-- ui:stats -->`'), false)
  assert.equal(hasNoteUIMarker('普通文字 <!-- ui:stats -->'), false)
  assert.equal(hasNoteUIMarker('<!-- ui:sta'), true)
  assert.equal(hasNoteUIMarker(block('future')), true)
})

test('escaped table pipes and blank statistics have predictable validation', () => {
  const data = '|指标|值|\n|---|---|\n|A \\| B|42|'
  assert.equal(planNoteUI(block('stats', data)).blocks.length, 1)
  for (const row of ['|A||', '||42|']) assert.equal(planNoteUI(block('stats', '|指标|值|\n|---|---|\n' + row)).blocks.length, 0)
})

test('source slices retain CRLF, prose, links, footnotes and data without mutation', () => {
  const ui = block('stats').replace(/\n/g, '\r\n')
  const source = '# 标题\r\n\r\n[^1]: 来源\r\n\r\n[link]: https://example.com\r\n\r\n' + ui + '\r\n\r\n后续正文 [link] [^1]\r\n'
  const plan = planNoteUI(source)
  assert.equal(plan.blocks.length, 1)
  assert.equal(plan.blocks[0].source.trimEnd(), ui)
  assert.ok(plan.markdown.includes('后续正文 [link] [^1]'))
  assert.ok(plan.markdown.includes('[^1]: 来源'))
  assert.ok(plan.markdown.includes('[link]: https://example.com'))
  assert.equal(plan.markdown.includes('| 2024 |'), false)
  assert.equal(source.includes(ui), true)
})

test('mixed components replace only their data source and have stable independent state keys', () => {
  const source = '# 标题\n\n' + block('stats') + '\n\n正文\n\n' + block('compare layout=cards')
  const a = planNoteUI(source), b = planNoteUI(source + '\n\n新段落')
  assert.deepEqual(a.blocks.map(x => x.name), ['stats', 'compare'])
  assert.deepEqual(a.blocks.map(x => x.key), b.blocks.map(x => x.key))
  const duplicates = planNoteUI(block('stats') + '\n\n' + block('stats'))
  assert.equal(new Set(duplicates.blocks.map(x => x.key)).size, 2)
})

test('streaming waits for the final block to close and activates on completion', () => {
  const source = block('chart x=year y=count')
  assert.equal(planNoteUI(source, true).blocks.length, 0)
  assert.equal(planNoteUI(source + '\n', true).blocks.length, 0)
  assert.equal(planNoteUI(source + '\n\n', true).blocks.length, 1)
  assert.equal(planNoteUI(source + '\n\n## 下一段', true).blocks.length, 1)
  assert.equal(planNoteUI(source, false).blocks.length, 1)
  assert.equal(planNoteUI(block('chart x=year y=count', '|year|count|\n|---|---|\n|2024|'), false).blocks.length, 0)
})

test('invalid numbers, missing columns, duplicate headers and ragged rows fall back', () => {
  for (const data of [table.replace('126', 'NaN'), table.replace('126', 'Infinity'), table.replace('126', '1.2kg'), '|year|count|\n|---|---|\n|2024|', '|year|count|\n|---|---|\n|2024|12|extra|', '|year|count|count|\n|---|---|---|\n|2024|1|2|']) assert.equal(planNoteUI(block('chart x=year y=count', data)).blocks.length, 0, data)
  assert.equal(planNoteUI(block('chart x=missing y=count')).blocks.length, 0)
  assert.equal(planNoteUI(block('chart x=year y=count,count')).blocks.length, 0)
})

test('numeric normalization supports zero, negatives, scientific notation, percentage and strict grouping', () => {
  for (const [s, value] of [['0', 0], ['-2.7', -2.7], ['.5', .5], ['1e-3', .001], ['1,234.5', 1234.5], ['87.3%', 87.3]]) assert.equal(numeric(s), value)
  for (const s of ['', ' ', '12,34', '1e999', '0x10', '5px', '1.2.3']) assert.equal(numeric(s), null)
})

test('pie rejects negative/zero totals and scatter rejects nonnumeric x', () => {
  assert.equal(planNoteUI(block('chart type=pie x=year y=count', table.replace('126', '-126'))).blocks.length, 0)
  assert.equal(planNoteUI(block('chart type=pie x=year y=count', table.replace('126', '0').replace('273', '0'))).blocks.length, 0)
  assert.equal(planNoteUI(block('chart type=pie x=year y=count,loss')).blocks.length, 0)
  assert.equal(planNoteUI(block('chart type=scatter x=year y=count', table.replace('2024', '一月'))).blocks.length, 0)
})

test('stats and compare preserve original values and Markdown cells', () => {
  const data = '|指标|值|说明|\n|---|---|---|\n|**准确率**|87.3%|$a$|'
  assert.deepEqual(planNoteUI(block('stats', data)).blocks[0].data.rows[0], ['**准确率**', '87.3%', '$a$'])
  assert.equal(planNoteUI(block('compare layout=auto', data)).blocks[0].params.layout, 'auto')
  assert.equal(planNoteUI(block('stats', '|a|b|\n|---|---|')).blocks.length, 0)
})

test('steps use ordered-list tokens and preserve nested explanations', () => {
  const data = '1. **准备**\n\n    读取数据。\n\n    - 检查字段\n\n2. 评估\n\n    对照验证集。'
  const plan = planNoteUI(block('steps mode=timeline', data))
  assert.equal(plan.blocks[0].data[0].title, '**准备**')
  assert.ok(plan.blocks[0].data[0].body.includes('检查字段'))
  assert.ok(plan.blocks[0].data[1].body.includes('对照验证集'))
  assert.equal(planNoteUI(block('steps', '- unordered')).blocks.length, 0)
})

test('steps and tree titles preserve exact inline math, code and emphasis for the renderer', () => {
  for (const [name, marker] of [['steps', '1.'], ['tree', '-'], ['accordion', '-']]) {
    const rich = '**库存 $a_i$** 与 \\(b_i\\)，`cur` 和 `(`'
    const data = `${marker} ${rich}\n\n    最多配对 $\\min(cur,a_i)$ 次。`
    const source = block(name, data)
    const plan = planNoteUI(source)
    assert.equal(plan.blocks[0].data[0].title, rich)
    assert.match(plan.blocks[0].data[0].body, /\\min\(cur,a_i\)/)
    assert.equal(plan.blocks[0].source, source)
  }
  const compact = block('steps', '1. 进串\n    `cur` 个库存与 $a_i$ 个需求。')
  const step = planNoteUI(compact).blocks[0].data[0]
  assert.ok(step.title.includes('`cur`') && step.title.includes('$a_i$'))
})

test('quiz consumes only question, options and optional explanation', () => {
  const quiz = '选哪个？\n\n- A. 甲\n- B. **乙**\n\n> 乙是答案。\n\n后续正文'
  const plan = planNoteUI(block('quiz answer=B', quiz))
  assert.equal(plan.blocks[0].data.answer, 'B')
  assert.equal(plan.blocks[0].data.explanation, '乙是答案。')
  assert.ok(plan.markdown.includes('后续正文'))
  for (const [directive, data] of [['quiz answer=C', quiz], ['quiz answer=B', quiz.replace('B.', 'A.')], ['quiz answer=B', '题干\n\n- no id\n- missing id'], ['quiz answer=Z', quiz]]) assert.equal(planNoteUI(block(directive, data)).blocks.length, 0)
})

test('graph normalizes relationships to generated node IDs and enforces bounds', () => {
  const data = '|source|target|\n|---|---|\n|A|B|\n|A|C|\n|C|B|'
  assert.deepEqual(planNoteUI(block('graph from=source to=target', data)).blocks[0].data, { nodes: ['A', 'B', 'C'], edges: [[0, 1], [0, 2], [2, 1]] })
  const huge = '|source|target|\n|---|---|\n' + Array.from({ length: 61 }, (_, i) => `|n${i}|root|`).join('\n')
  assert.equal(planNoteUI(block('graph', huge)).blocks.length, 0)
})

test('oversized datasets and documents have bounded activation without truncating source', () => {
  const huge = '|metric|value|\n|---|---|\n' + Array.from({ length: 501 }, (_, i) => `|a${i}|${i}|`).join('\n')
  const source = block('stats', huge)
  assert.equal(planNoteUI(source).markdown, source)
  const many = Array.from({ length: 102 }, () => block('stats')).join('\n\n')
  const plan = planNoteUI(many)
  assert.equal(plan.blocks.length, 100)
  assert.ok(plan.markdown.includes('<!-- ui:stats -->'))
})

test('shared AI rules reach teacher/tutor without changing ask_user or persistence', () => {
  assert.ok(buildTeacherSystemPrompt().includes(NOTEUI_PROMPT))
  assert.ok(buildTutorPrompt({ role: 'quick', noteTitle: 'test', notePath: 'test.md', noteContent: '', graphSummary: '' }).includes(NOTEUI_PROMPT))
  assert.ok(NOTEUI_PROMPT.includes('ask_user'))
})

test('the runnable sample contains all components and four chart types, with intentional fallback', async () => {
  const sample = await readFile('server/demo-vault/笔记/NoteUI/note/NoteUI交互示例.md', 'utf8')
  const plan = planNoteUI(sample)
  assert.deepEqual([...new Set(plan.blocks.map(b => b.name))].sort(), ['chart', 'compare', 'graph', 'quiz', 'stats', 'steps'])
  assert.deepEqual(plan.blocks.filter(b => b.name === 'chart').map(b => b.data.type), ['line', 'bar', 'pie', 'scatter'])
  assert.equal(plan.blocks.length, 9)
  assert.ok(plan.markdown.includes('不存在的列'))
  assert.ok(plan.markdown.includes('```mermaid'))
})

test('the complete learning example activates all twenty registered component types', async () => {
  const text = await readFile('server/demo-vault/笔记/NoteUI/note/NoteUI学习全场景示例.md', 'utf8')
  const plan = planNoteUI(text)
  assert.equal(plan.blocks.length, 20)
  assert.equal(new Set(plan.blocks.map(b => b.name)).size, 20)
  assert.equal(plan.blocks.find(b => b.name === 'quiz').data.multiple, true)
  assert.equal(plan.blocks.find(b => b.name === 'derivation').data.rows.length, 5)
})

test('table-based learning components retain definitions, answers and extra fields', () => {
  const data = '|术语|解释|例子|\n|---|---|---|\n|梯度|偏导组成的向量|$2rx$|'
  for (const name of ['concept', 'flashcards', 'derivation', 'tabs', 'table']) {
    const result = planNoteUI(block(name, data))
    assert.equal(result.blocks[0].name, name)
    assert.deepEqual(result.blocks[0].data.rows[0], ['梯度', '偏导组成的向量', '$2rx$'])
  }
})

test('knowledge trees and accordions retain all nesting and explanatory paragraphs', () => {
  const data = '- 总览\n\n    总体说明。\n\n    - 子概念\n        - 叶子\n\n            深层说明。'
  for (const name of ['tree', 'accordion']) {
    const result = planNoteUI(block(name, data)).blocks[0].data
    assert.equal(result[0].title, '总览')
    assert.ok(result[0].body.includes('总体说明'))
    assert.equal(result[0].children[0].children[0].title, '叶子')
    assert.ok(result[0].children[0].children[0].body.includes('深层说明'))
  }
})

test('task checklist preserves initial checks and rejects nested or non-task lists', () => {
  const plan = planNoteUI(block('checklist', '- [x] 阅读\n- [ ] 练习'))
  assert.deepEqual(plan.blocks[0].data.map(i => i.checked), [true, false])
  for (const data of ['- 普通项目', '- [ ] 父任务\n    - [ ] 子任务']) assert.equal(planNoteUI(block('checklist', data)).blocks.length, 0)
})

test('code walkthroughs accept only closed code fences and valid annotation lines', () => {
  const code = '```python\nx = 1\ny = x + 1\n```'
  const annotation = '|行号|讲解|\n|---|---|\n|2|计算下一项|'
  const plan = planNoteUI(block('code', code + '\n\n' + annotation + '\n\n后续正文'))
  assert.equal(plan.blocks[0].data.language, 'python')
  assert.equal(plan.blocks[0].data.annotations[0].line, 2)
  assert.ok(plan.markdown.includes('后续正文'))
  assert.equal(planNoteUI(block('code', code)).blocks.length, 1)
  for (const data of ['```python\nx=1', code + '\n\n' + annotation.replace('|2|', '|3|'), code + '\n\n' + annotation.replace('|2|', '|0|'), code.replace('python', 'mermaid')]) assert.equal(planNoteUI(block('code', data)).blocks.length, 0)
})

test('cloze answers come from exactly one inline-code span per list item', () => {
  const data = '- 梯度下降沿 `负梯度` 方向更新。\n- 评估使用 `验证集`。'
  const plan = planNoteUI(block('cloze', data))
  assert.deepEqual(plan.blocks[0].data.map(i => i.answer), ['负梯度', '验证集'])
  assert.equal(plan.blocks[0].data[0].after, ' 方向更新。')
  for (const data of ['- 没有答案', '- `两个` 与 `答案`', '- `答案`\n\n    多余段落', '- `答案`\n    - 子项']) assert.equal(planNoteUI(block('cloze', data)).blocks.length, 0, data)
})

test('matching requires two unique columns and bounded pairs', () => {
  const data = '|术语|用途|\n|---|---|\n|训练集|拟合参数|\n|验证集|选择配置|'
  assert.equal(planNoteUI(block('match', data)).blocks[0].data.rows.length, 2)
  for (const invalid of [data.replace('验证集', '训练集'), data.replace('选择配置', '拟合参数'), '|术语|用途|\n|---|---|\n|训练集|拟合参数|']) assert.equal(planNoteUI(block('match', invalid)).blocks.length, 0)
})

test('self-assessment and progress reject misleading ranges instead of clamping', () => {
  const rubric = '|维度|满分|标准|\n|---|---|---|\n|解释|5|独立说清|'
  assert.equal(planNoteUI(block('rubric', rubric)).blocks[0].data[0].max, 5)
  for (const value of ['0', '101', '1.5', '-1', 'NaN']) assert.equal(planNoteUI(block('rubric', rubric.replace('|5|', `|${value}|`))).blocks.length, 0)
  const progress = '|项目|完成|总量|\n|---|---|---|\n|练习|3|8|'
  assert.equal(planNoteUI(block('progress', progress)).blocks[0].data[0].value, 3)
  for (const row of ['|练习|9|8|', '|练习|-1|8|', '|练习|0|0|']) assert.equal(planNoteUI(block('progress', '|项目|完成|总量|\n|---|---|---|\n' + row)).blocks.length, 0)
})

test('learning schedules require real ISO calendar dates and sort chronologically', () => {
  const source = '|日期|任务|\n|---|---|\n|2026-11-02|延迟复习|\n|2026-10-19|首次阅读|'
  assert.equal(planNoteUI(block('schedule', source)).blocks[0].data[0].date, '2026-10-19')
  for (const date of ['2026-02-29', '2026-13-01', '2026-04-31', '下周二', '2026-1-2']) assert.equal(planNoteUI(block('schedule', '|日期|任务|\n|---|---|\n|' + date + '|复习|')).blocks.length, 0)
  assert.equal(planNoteUI(block('schedule', '|日期|任务|\n|---|---|\n|2028-02-29|复习|')).blocks.length, 1)
})

test('multiple-choice quizzes require exact unique answer IDs', () => {
  const data = '哪些正确？\n\n- A. 甲\n- B. 乙\n- C. 丙'
  const plan = planNoteUI(block('quiz type=multi answer=A,C', data))
  assert.equal(plan.blocks[0].data.multiple, true)
  assert.equal(plan.blocks[0].data.answer, 'A,C')
  for (const directive of ['quiz type=multi answer=A,A', 'quiz type=multi answer=A,D', 'quiz type=multi answer=A', 'quiz answer=A,C']) assert.equal(planNoteUI(block(directive, data)).blocks.length, 0)
})
