// Development-only integration fixture; never imported by the application or production build.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import RichText from '../src/components/RichText'
import EditorPane from '../src/components/EditorPane'
import NoteUIBlock from '../src/noteui/NoteUIBlock'
import { renderInlineMarkdown, renderRichMarkdown } from '../src/components/md'
import { splitFrontmatter } from '../src/frontmatter'
import sample from '../server/demo-vault/笔记/NoteUI/note/NoteUI交互示例.md?raw'
import extendedSample from '../server/demo-vault/笔记/NoteUI/note/NoteUI学习全场景示例.md?raw'
import generatedSample from '../doc/noteui-generated-sample.md?raw'
import algorithmSample from '../doc/noteui-algorithm-generated.md?raw'
import componentMathSample from '../server/demo-vault/笔记/NoteUI/note/NoteUI公式回归示例.md?raw'
import interactiveSample from '../server/demo-vault/笔记/NoteUI/note/NoteUI可视化实验室.md?raw'
import { compositionExample, legacyDefectExample } from '../src/noteui/galleryExamples'
import { catalog } from '../src/noteui/catalog'
import '../src/styles/index.css'
import 'katex/dist/katex.min.css'

const sleep = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms))
const initial = splitFrontmatter(sample).body
const extended = splitFrontmatter(extendedSample).body
const quotationSample = '# 引用与阅读宽度\n\n' + Array.from({ length: 8 }, (_, i) => `## ${i + 1}. 定义与讲解\n\n> **定义 ${i + 1}**：设 $X$ 是随机变量，$F_X(x)=P(X\\le x)$。\n\n这段正文应保持与开头一致的阅读宽度，不随前面的引用不断缩进。引用结束后，讲解、公式和下一节标题都回到正文列。\n\n`).join('') + '> [!tip] 阅读提示\n> 引用和提示各自完整闭合。\n\n> 外层普通引用\n>\n> > 嵌套引用只在本块内缩进。\n\n## 参考文献\n\n正文结束，阅读宽度仍与第一节相同。'
const formulaTable = String.raw`|类型|动作|公式|
|---|---|---|
|离散，任意 $g$|合并同值概率|$P(g(X)=y)=\sum_{x:g(x)=y}p(x)$|
|连续，单调 $g$|逆函数与雅可比|$f_Y(y)=f_X(g^{-1}(y))\big\|(g^{-1})'(y)\big\|$|
|连续，分段单调|各支逆函数求和|$f_Y(y)=\sum_j f_X(h_j(y))|h'_j(y)|$|`
const mathSample = '# 阅读公式与默认模式\n\n## 三种情形一览\n\n' + formulaTable + String.raw`

## 易错点

|误区|正确做法|
|---|---|
|漏掉 $\|\cdot\|$|保留绝对值 $\left|h'(y)\right|$|
|忽略条件概率 $P(A|B)$|注意 $P(B)>0$|

括号公式：\(\|v\|=\sqrt{v^Tv}\)。

\[P(A|B)=\frac{P(A\cap B)}{P(B)}\]

跨行公式：$f(x)=
|x|$。
` + '\n```latex\n\\lVert x\\rVert=\\sqrt{\\sum_i x_i^2}\n```\n\n`$P(A|B)$` 与 `\\(literal\\)` 保持代码原样。\n\n```text\n$P(A|B)$\n```'
  + '\n\n<details><summary>密度公式 $f_Y(y)=f_X(h(y))|h\'(y)|$ 从哪里来？</summary>\n\n由CDF求导。\n\n</details>'
let saved = ''
let openedLink = ''
function App() {
  const [text, setText] = useState(initial), [width, setWidth] = useState(860), [dark, setDark] = useState(false)
  const [editor, setEditor] = useState(false), [streaming, setStreaming] = useState(false), [results, setResults] = useState<string[]>([])
  const [broken, setBroken] = useState(false)
  const [fixturePath, setFixturePath] = useState('NoteUI-browser.md')
  const check = (pass: boolean, description: string) => {
    setResults(r => [...r, `${pass ? 'PASS' : 'FAIL'} ${description}`])
    if (!pass) throw new Error(description)
  }
  const click = (el: Element | null) => { if (!el) throw new Error('找不到交互元素'); (el as HTMLElement).click() }
  async function run() {
    setResults([])
    try {
      flushSync(() => { setEditor(false); setStreaming(false); setText(initial); setBroken(false) })
      await sleep(300)
      let host = document.querySelector('#fixture')!
      check(host.querySelectorAll('.noteui').length === 9, '混合示例激活 9 个组件，无重复源表格')
      check(host.querySelectorAll('.nui-plot svg').length === 4, '四种图表都生成 SVG')
      check(!!host.querySelector('.nui-graph svg'), '知识关系图复用 Mermaid 生成 SVG')
      check(!!host.querySelector('.katex') && !!host.querySelector('.mermaid svg'), '已有公式和 Mermaid 正常渲染')
      check(renderRichMarkdown(initial).mermaidSources[0]?.includes('flowchart LR') && !host.querySelector('.mermaid')!.textContent!.includes('Syntax error'), 'Mermaid 重绘始终保留原始代码')
      check(host.querySelectorAll('.rich-md-fragment > table').length === 1, '无效指令回退表格，其他源表格不重复显示')
      const point = host.querySelector<SVGElement>('.nui-plot circle[tabindex]')!
      point.focus(); await sleep()
      check(!host.querySelector('.nui-tooltip')!.textContent!.includes('悬停'), '键盘聚焦数据点显示 Tooltip')
      point.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await sleep()
      check(document.activeElement !== point && !!document.activeElement?.hasAttribute('data-series'), '左右方向键在数据点间导航')
      const legend = host.querySelector('.nui-legend button')!
      click(legend); await sleep()
      check(legend.getAttribute('aria-pressed') === 'false', '图例可切换序列')
      const compare = host.querySelector('.nui-compare[class*="nui-layout-"]')!
      click(host.querySelector('.nui-segmented button:nth-child(3)')); await sleep()
      check(compare.classList.contains('nui-layout-cards'), '对比组件切换卡片视图')
      const step = host.querySelector('.nui-steps details')!
      click(step.querySelector('summary')); await sleep()
      check(step.hasAttribute('open') && step.textContent!.includes('先明确任务'), '步骤解释可以展开')
      const quiz = host.querySelector('.nui-quiz')!
      check(!quiz.querySelector('.nui-feedback'), '练习提交前不显示答案解析')
      click(quiz.querySelector('input[value="B"]')); await sleep()
      click(quiz.querySelector('button')); await sleep()
      check(quiz.querySelector('.nui-feedback')!.textContent!.includes('回答正确'), '练习选择并即时反馈')
      setText(initial + '\n\n新追加的正文。'); await sleep()
      check(!!host.querySelector('.nui-feedback'), '追加正文保持已有作答状态')
      click(host.querySelector('.nui-quiz button')); await sleep()
      check(!host.querySelector('.nui-feedback'), '练习可以重试')
      click(host.querySelector('.nui-source summary')); await sleep()
      check(host.querySelector('.nui-source')!.hasAttribute('open') && host.querySelector('.nui-source code')!.textContent!.includes('<!-- ui:chart'), '随时查看原始 Markdown')
      for (const narrow of [360, 768, 1100]) {
        setWidth(narrow); await sleep()
        const fixture = host as HTMLElement
        check(fixture.scrollWidth <= fixture.clientWidth + 1, `${narrow}px 容器无横向溢出`)
      }
      setWidth(360); await sleep()
      click(host.querySelector('.nui-segmented button')); await sleep()
      check(getComputedStyle(host.querySelector('.nui-compare-cards')!).display === 'grid', '窄容器自动切换对比卡片')
      document.documentElement.dataset.theme = 'dark'; setDark(true); await sleep(200)
      check(getComputedStyle(host.querySelector('.noteui')!).backgroundColor === 'rgb(23, 26, 32)', '暗色主题采用现有 panel 变量')
      check(!!host.querySelector('.nui-graph svg'), '暗色主题切换后关系图正常')
      check(!host.querySelector('.mermaid')!.textContent!.includes('Syntax error'), '暗色主题切换后原生 Mermaid 正常')
      document.documentElement.dataset.theme = 'light'; setDark(false); await sleep()
      const payload = '<!-- ui:chart x=name y=value title="<img src=x onerror=alert(1)>" -->\n\n|name|value|\n|---|---|\n|<script>alert(1)</script>|12|'
      const rendered = renderRichMarkdown(payload, { noteUI: true })
      check(rendered.parts.some(p => 'block' in p) && !rendered.html.includes('<script'), '组件数据不进入可执行 HTML')
      const safe = renderRichMarkdown('<img src=x onerror="alert(1)">\n\n普通 Markdown', { noteUI: true })
      check(!safe.html.includes('onerror'), '普通 Markdown 仍经过 DOMPurify')
      const plain = '# 普通笔记\n\n段落 **强调** 与 $E=mc^2$。\n\n|名称|值|\n|---|---|\n|a|1|'
      check(renderRichMarkdown(plain).html === renderRichMarkdown(plain, { noteUI: true }).html, '普通 Markdown 的 HTML 渲染结果不变')
      setText(payload); await sleep()
      check(!host.querySelector('img') && !host.querySelector('script'), '恶意标题和图表标签以纯文本显示')
      setText('<!-- ui:graph -->\n\n|source|target|\n|---|---|\n|A"] --> evil["X|<img onerror=alert(1)>|'); await sleep()
      check(!!host.querySelector('.nui-graph svg') && !host.querySelector('[onerror]'), '关系图标签不能注入 Mermaid 指令或 HTML')
      setText('<!-- ui:stats -->\n\n|指标|值|\n|---|---|\n' + Array.from({ length: 8 }, (_, i) => `|指标${i}|${i}|`).join('\n')); await sleep()
      check(host.querySelectorAll('dl.nui-stats > div').length === 6, '大型指标默认逐步展开')
      click(host.querySelector('.nui-more')); await sleep()
      check(host.querySelectorAll('dl.nui-stats > div').length === 8, '展开保留全部原始指标')
      setBroken(true); await sleep()
      check(!!host.querySelector('.nui-fallback'), '组件运行异常局部回退为 Markdown')
      setBroken(false)
      const unfinished = '<!-- ui:stats -->\n\n|指标|值|\n|---|---|\n|loss|0.4|'
      setText(unfinished); setStreaming(true); await sleep()
      check(!host.querySelector('.noteui') && !!host.querySelector('table'), '流式末尾数据暂按普通 Markdown 显示')
      setStreaming(false); await sleep()
      check(!!host.querySelector('.noteui'), '流式结束激活完整组件')
      setWidth(860); setText(initial); setEditor(true); await sleep(150)
      click(host.querySelector('.note-mode-switch button:nth-child(2)'))
      // Monaco is an existing large lazy chunk; allow a cold dev-server load while Vite builds.
      for (let i = 0; i < 300 && !host.querySelector('.monaco-editor'); i++) await sleep(100)
      check(!!host.querySelector('.monaco-editor'), '主笔记源码模式复用 Monaco')
      const { default: monaco } = await import('../src/components/ide/monacoSetup')
      const model = monaco.editor.getModels().find(m => m.uri.path.includes('.noteui-source'))!
      check(model.getValue().includes('<!-- ui:chart'), '源码编辑器保留 NoteUI 注释')
      model.pushEditOperations([], [{ range: new monaco.Range(1, 1, 1, 1), text: '源码保存检查\n\n' }], () => null)
      await sleep()
      check(saved.startsWith('源码保存检查') && saved.includes('<!-- ui:chart'), '源码修改沿用 onEdit，保存值保留指令')
      click(host.querySelector('.note-mode-switch button'))
      await sleep()
      check(host.querySelectorAll('.noteui').length === 9 && host.textContent!.includes('源码保存检查'), '源码与阅读预览一致')
    } catch (e) { setResults(r => [...r, `STOP ${(e as Error).message}`]) }
  }
  function input(el: Element | null, value: string) {
    if (!el) throw new Error('找不到输入框')
    const prototype = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  }
  async function runInteractive() {
    setResults([])
    try {
      flushSync(() => { setEditor(false); setStreaming(false); setText(splitFrontmatter(interactiveSample).body); setBroken(false); setWidth(860) })
      await sleep(300)
      const host = document.querySelector('#fixture')!
      const section = (name: string) => host.querySelector<HTMLElement>(`.noteui.nui-${name}`)!
      check(host.querySelectorAll('.noteui').length === 13, '8 类新控件及不同模型共 13 个实例正常渲染')
      check(host.querySelectorAll('.nui-source').length === 13 && !host.querySelector('.nui-fallback'), '全部控件具备源 Markdown，无渲染回退')
      const sequence = section('sequence')
      const next = () => [...sequence.querySelectorAll('button')].find(b => b.textContent === '下一步')!
      click(next()); await sleep()
      check(sequence.querySelectorAll('.nui-bead.is-active').length === 2, '珠子先高亮合法相邻对')
      click(next()); await sleep()
      check(sequence.querySelectorAll('.nui-bead').length === 4 && sequence.textContent!.includes('已消去 1 对'), '消去后元素与累计配对正确')
      click([...sequence.querySelectorAll('button')].find(b => b.textContent === '上一步')!); await sleep()
      check(sequence.querySelectorAll('.nui-bead').length === 6, '回退恢复完整序列')
      const distribution = section('distribution')
      input(distribution.querySelector('input[type=range]'), '10'); await sleep()
      check(distribution.querySelectorAll('.nui-stat-value')[0].textContent === '10' && distribution.querySelectorAll('.nui-stat-value')[1].textContent === '10', '滑块同步更新泊松期望与方差')
      const point = distribution.querySelector<SVGElement>('[data-point="0"]')!
      point.focus(); point.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await sleep()
      check(document.activeElement?.getAttribute('data-point') === '1', '概率数据点支持方向键与详细数值')
      const venn = section('venn'), region = venn.querySelector<SVGElement>('.nui-venn-region:last-child')!
      region.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep()
      check(venn.querySelector('.nui-inspector')!.textContent!.includes('A ∩ B ∩ C'), '维恩区域支持键盘选择和归属说明')
      click(venn.querySelector('.nui-segmented button:nth-child(2)')); await sleep()
      check(venn.textContent!.includes('数量合计：1'), '交集只统计共同区域，不重复计算')
      const matrix = section('matrix'); click(matrix.querySelector('tbody td button')); await sleep()
      check(matrix.querySelector('[role=status]')!.textContent!.includes('未选物品'), '矩阵单元格显示对应行列和值')
      const playback = section('playback'); click(playback.querySelector('.nui-action')); await sleep()
      check(playback.querySelector('.nui-frame-title')!.textContent === '缩小到右半边' && playback.querySelectorAll('.is-active').length === 2, '状态回放同步更新说明和高亮下标')
      const geometry = section('geometry'); geometry.querySelector<SVGElement>('[role=button]')!.focus(); await sleep()
      check(geometry.querySelector('[role=status]')!.textContent!.includes('A = (0, 0)'), '几何点可键盘聚焦并显示坐标')
      check(!host.querySelector('.katex-error') && !!section('numberline').querySelector('.katex'), '区间标签和新控件中的数学公式正常')
      for (const narrow of [360, 768, 1100]) { setWidth(narrow); await sleep(); check((host as HTMLElement).scrollWidth <= (host as HTMLElement).clientWidth + 1, `可视化控件在 ${narrow}px 容器无横向溢出`) }
      document.documentElement.dataset.theme = 'dark'; setDark(true); await sleep()
      check(getComputedStyle(section('venn')).backgroundColor !== 'rgb(255, 255, 255)', '新控件跟随暗色主题')
      document.documentElement.dataset.theme = 'light'; setDark(false); setWidth(860)
      check(true, '可视化实验回归完成')
    } catch (e) { setResults(r => [...r, `STOP ${(e as Error).message}`]) }
  }
  async function runCatalog() {
    setResults([])
    try {
      const original = '# 模板插入回归\n\n原始正文保留。'
      flushSync(() => { setFixturePath('NoteUI-catalog-browser.md'); setText(original); setEditor(true); setStreaming(false); setBroken(false); setWidth(1100) })
      await sleep(250)
      click(document.querySelector('[aria-label="打开 NoteUI 组件库"]')); await sleep(500)
      const dialog = document.querySelector<HTMLElement>('[aria-label="NoteUI 可视化组件库"]')!
      check(!!dialog && dialog.querySelectorAll('nav button').length === 38, '组件库提供全部 38 类模板')
      check(document.activeElement?.getAttribute('id') === 'nui-catalog-search', '打开组件库自动聚焦搜索')
      input(dialog.querySelector('input'), 'venn'); await sleep()
      check(dialog.querySelectorAll('nav button').length === 1, '按英文语法或中文场景查找组件')
      click(dialog.querySelector('nav button')); await sleep()
      check(!!dialog.querySelector('.nui-venn-canvas'), '组件库使用真实交互渲染器预览')
      click(dialog.querySelector('.nui-catalog-insert')); await sleep(350)
      check(!document.querySelector('[role=dialog]') && saved.startsWith(original) && saved.includes('<!-- ui:venn sets=A,B,C -->'), '模板按原始 Markdown 追加并沿现有编辑保存回调提交')
      const host = document.querySelector('#fixture')!
      check(!!host.querySelector('.note-read-preview .nui-venn-canvas') && !host.querySelector('.katex-error'), '插入后留在阅读模式并渲染新控件')
      click(host.querySelector('[aria-label="打开 NoteUI 组件库"]')); await sleep(150)
      document.querySelector('[role=dialog]')!.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true})); await sleep()
      check(!document.querySelector('[role=dialog]') && document.activeElement?.getAttribute('aria-label') === '打开 NoteUI 组件库', 'Escape 关闭并将焦点还给入口按钮')
      check(true, '组件库回归完成')
    } catch (e) { setResults(r => [...r, `STOP ${(e as Error).message}`]) }
  }
  async function runExtended() {
    setResults([])
    try {
      flushSync(() => { setEditor(false); setStreaming(false); setText(extended); setBroken(false); setWidth(860) })
      await sleep(300)
      const host = document.querySelector('#fixture')!
      const section = (name: string) => host.querySelector<HTMLElement>(`.noteui.nui-${name}`)!
      check(host.querySelectorAll('.noteui').length === 20, '完整学习笔记渲染 20 类组件')
      check(host.querySelectorAll('.nui-source').length === 20, '每类组件均可查看原始 Markdown')
      input(section('concept').querySelector('input'), '梯度'); await sleep()
      check(section('concept').querySelectorAll('article').length === 1, '概念词典按关键词过滤')
      const flash = section('flashcards')
      check(flash.querySelector<HTMLElement>('.nui-flash-back')!.hidden, '闪卡答案默认隐藏')
      click(flash.querySelector('.nui-reveal')); await sleep()
      check(!flash.querySelector<HTMLElement>('.nui-flash-back')!.hidden, '闪卡主动揭晓答案')
      click([...flash.querySelectorAll('button')].find(el => el.textContent === '已经记住')!); await sleep()
      check(flash.querySelector('progress')!.value === 1 && flash.textContent!.includes('第 2 / 3 张'), '闪卡自评后记录进度并前进')
      click(section('tree').querySelector('button')); await sleep()
      check([...section('tree').querySelectorAll('.nui-outline details')].every(el => el.open), '知识树支持展开全部层级')
      click(section('accordion').querySelector('summary')); await sleep()
      check(section('accordion').querySelector('details')!.open, '折叠讲解支持逐项阅读')
      const tabs = section('tabs').querySelectorAll<HTMLButtonElement>('[role=tab]')
      click(tabs[1]); await sleep()
      check(tabs[1].getAttribute('aria-selected') === 'true' && section('tabs').querySelector('[role=tabpanel]')!.textContent!.includes('负梯度'), '标签页切换知识视角')
      tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await sleep()
      check(document.activeElement === tabs[2], '标签页支持键盘方向键导航')
      click(section('derivation').querySelector('.nui-action')); await sleep()
      check(section('derivation').querySelectorAll('li').length === 2, '公式推导按步骤逐渐揭示')
      click(section('derivation').querySelectorAll('.nui-action')[1]); await sleep()
      check(section('derivation').querySelectorAll('li').length === 5 && !!section('derivation').querySelector('.katex'), '推导展开全部并复用 KaTeX')
      click(section('code').querySelectorAll('.nui-code-line')[2]); await sleep()
      check(section('code').querySelector('.nui-code-explanation')!.textContent!.includes('链式法则'), '代码导读选择行号显示对应解释')
      click(section('checklist').querySelectorAll('input')[1]); await sleep()
      check(section('checklist').querySelector('progress')!.value === 2, '清单勾选更新阅读会话内进度')
      const explore = section('table')
      input(explore.querySelector('input'), '梯度'); await sleep()
      check(explore.querySelectorAll('tbody tr').length === 1, '数据表支持全文筛选')
      input(explore.querySelector('input'), ''); await sleep()
      click(explore.querySelectorAll('thead button')[3]); await sleep()
      check(explore.querySelector('tbody tr')!.textContent!.includes('数据泄漏'), '数值列按数值升序排序')
      click(explore.querySelectorAll('thead button')[3]); await sleep()
      check(explore.querySelector('tbody tr')!.textContent!.includes('梯度符号'), '再次点击列头切换降序')
      input(section('cloze').querySelectorAll('input')[0], '负梯度')
      input(section('cloze').querySelectorAll('input')[1], '验证集'); await sleep()
      click(section('cloze').querySelector('button[type=submit]')); await sleep()
      check(section('cloze').querySelector('[role=status]')!.textContent!.includes('答对 2 / 2'), '填空题精确检查答案')
      section('match').querySelectorAll('select').forEach((el, i) => input(el, String(i))); await sleep()
      click(section('match').querySelector('button[type=submit]')); await sleep()
      check(section('match').querySelector('[role=status]')!.textContent!.includes('3 / 3'), '配对题检查每个对应关系')
      const quiz = section('quiz')
      click(quiz.querySelector('input[value=A]')); await sleep()
      click(quiz.querySelector('button')); await sleep()
      check(quiz.querySelector('.nui-feedback')!.classList.contains('incorrect'), '多选题漏选不会误判正确')
      click(quiz.querySelector('button')); await sleep()
      click(quiz.querySelector('input[value=A]')); click(quiz.querySelector('input[value=C]')); await sleep()
      click(quiz.querySelector('button')); await sleep()
      check(quiz.querySelector('.nui-feedback')!.classList.contains('correct'), '多选题支持多项选择并严格判分')
      input(section('rubric').querySelector('input'), '4'); await sleep()
      check(section('rubric').querySelector('[role=status]')!.textContent!.includes('自评 4 / 20'), '自评量规更新得分而不修改笔记')
      input(section('schedule').querySelector('select'), '2026-11'); await sleep()
      check(section('schedule').querySelectorAll('time').length === 1, '日程可以按月份筛选')
      click(section('schedule').querySelector('input')); await sleep()
      check(section('schedule').querySelector('[role=status]')!.textContent!.includes('1 / 1'), '日程可勾选当前范围任务')
      check(section('progress').querySelector('progress')!.value === 3, '进度组件展示原始完成数量')
      setText(extended + '\n\n追加学习心得。'); await sleep()
      check(section('flashcards').querySelector('progress')!.value === 1, '新增组件状态在无关正文更新后保留')
      for (const w of [360, 768, 1100]) { setWidth(w); await sleep(); check((host as HTMLElement).scrollWidth <= (host as HTMLElement).clientWidth + 1, `20 类组件在 ${w}px 容器无页面溢出`) }
      document.documentElement.dataset.theme = 'dark'; setDark(true); await sleep()
      check(getComputedStyle(section('flashcards')).backgroundColor === 'rgb(23, 26, 32)', '新增学习组件适配暗色主题')
      document.documentElement.dataset.theme = 'light'; setDark(false); setWidth(860)
    } catch (e) { setResults(r => [...r, `STOP ${(e as Error).message}`]) }
  }
  async function runSystem() {
    setResults([])
    try {
      const bare = '<!-- ui:code -->\n\n~~~python\nx=1\ny=x+1\n~~~'
      flushSync(() => { setEditor(false); setStreaming(false); setText(compositionExample + '\n\n' + legacyDefectExample + '\n\n' + catalog.svg.source + '\n\n' + catalog.carousel.source + '\n\n' + bare); setBroken(false); setWidth(1100) })
      await sleep(250)
      const host = document.querySelector('#fixture')!
      const grid = host.querySelector<HTMLElement>('.nui-layout-grid')!
      check(getComputedStyle(grid).gridTemplateColumns.split(' ').length === 2, '组合网格在宽容器中显示两列')
      check(grid.querySelectorAll('.nui-distribution').length === 1 && grid.querySelectorAll('.nui-concept').length === 1, '布局复用正式控件，Markdown与交互自然混排')
      const code = host.querySelectorAll('.nui-code')
      check(code[0].querySelectorAll('button.nui-code-line').length === 4, '有讲解的四行均可选择')
      click(code[0].querySelectorAll('button.nui-code-line')[3]); await sleep()
      check(code[0].querySelector('.nui-code-explanation')!.textContent!.includes('保证最终到达链尾'), '选择代码行显示真实讲解')
      check(code[1].querySelectorAll('button.nui-code-line').length === 0 && !code[1].querySelector('.nui-code-explanation'), '缺少讲解时保留静态代码，没有空的点击反馈')
      check(!host.querySelector('.katex-error'), '嵌套布局保持公式渲染')
      const popover = host.querySelector<HTMLElement>('.nui-popover button')!
      click(popover); await sleep()
      const popup = document.querySelector<HTMLElement>('.nui-popover-panel')!
      check(!!popup && popup.textContent!.includes('平均发生速率'), '附加说明弹出实际内容')
      popup.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); await sleep()
      check(!document.querySelector('.nui-popover-panel') && document.activeElement === popover, 'Escape关闭旁注并恢复焦点')
      const drawing = host.querySelector('.nui-svg')!
      check(drawing.querySelectorAll('svg > g').length === 7 && !drawing.querySelector('foreignObject, script, image'), '自定义SVG只生成允许的图元')
      const shape = drawing.querySelector<SVGElement>('[role=button]')!; shape.focus(); shape.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})); await sleep()
      check(shape.getAttribute('aria-pressed') === 'true' && drawing.querySelector('[role=status]')!.textContent!.includes('46'), 'SVG图元可用键盘选择并查看标注')
      const track = host.querySelector<HTMLElement>('.nui-carousel-track')!
      track.focus(); track.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true})); await sleep(400)
      check(track.scrollLeft > 0, '横向浏览支持方向键翻页')
      for (const width of [360, 768, 1100]) {
        setWidth(width); await sleep()
        check((host as HTMLElement).scrollWidth <= (host as HTMLElement).clientWidth + 1, `组合布局在${width}px无页面溢出`)
        check([...host.querySelectorAll<HTMLElement>('.nui-sequence-label')].every(el => el.scrollHeight <= el.clientHeight + 1), `旧序列长标签在${width}px不溢出`)
      }
      setWidth(360); await sleep()
      check(getComputedStyle(grid).gridTemplateColumns.split(' ').length === 1, '窄容器自动切换为单列')
      document.documentElement.dataset.theme = 'dark'; setDark(true); await sleep()
      check(getComputedStyle(grid.querySelector('.nui-distribution')!).backgroundColor === 'rgb(23, 26, 32)', '组合内控件继承暗色主题')
      document.documentElement.dataset.theme = 'light'; setDark(false); setWidth(1100)
      check(true, '组合与SVG系统回归完成')
    } catch (e) { setResults(r => [...r, `STOP ${(e as Error).message}`]) }
  }
  async function runReadingLayout() {
    setResults([])
    try {
      flushSync(() => { setEditor(false); setStreaming(false); setText(quotationSample); setBroken(false); setWidth(1100) })
      await sleep()
      setEditor(true); await sleep()
      const host = document.querySelector('#fixture')!
      check(host.querySelector('.note-mode-switch button')!.getAttribute('aria-pressed') === 'true', '普通Markdown笔记也默认阅读模式')
      click(host.querySelector('.note-mode-switch button')); await sleep()
      const reading = host.querySelector<HTMLElement>('.note-read-preview > .rich-md')!
      const headings = [...reading.querySelectorAll<HTMLElement>('h2')]
      check(headings.length === 9, '连续八段引用后的章节与参考文献均完整显示')
      check(!reading.querySelector('blockquote h2'), '引用外的章节不会被吞进前面的引用')
      check(reading.querySelectorAll('blockquote').length === 10, '普通引用与嵌套引用各自闭合')
      check(reading.querySelectorAll('.callout.callout-tip').length === 1 && !reading.querySelector('.callout blockquote'), '提示块只包裹自己的内容')
      const bounds = headings.map(el => el.getBoundingClientRect())
      check(bounds.every(b => Math.abs(b.left - bounds[0].left) < 1 && Math.abs(b.width - bounds[0].width) < 1), '开头到末尾正文位置、行宽完全一致')
      check(!!reading.querySelector('.katex'), '引用中的数学公式正常渲染')
      for (const w of [360, 768, 1100]) {
        setWidth(w); await sleep()
        const column = host.querySelector<HTMLElement>('.editor-content-col')!
        const preview = host.querySelector<HTMLElement>('.note-read-preview')!
        const contentWidth = column.getBoundingClientRect().width
        check(Math.abs(preview.getBoundingClientRect().width - contentWidth) < 1 && reading.getBoundingClientRect().width >= contentWidth - 60, `${w}px 下阅读预览占满配置行宽，不额外收窄`)
        check((host as HTMLElement).scrollWidth <= (host as HTMLElement).clientWidth + 1, `${w}px 下连续引用无横向溢出`)
      }
      document.documentElement.dataset.theme = 'dark'; setDark(true); await sleep()
      check(!reading.querySelector('blockquote h2') && getComputedStyle(reading).color === 'rgb(230, 232, 236)', '暗色主题保持引用边界和正文排版')
      document.documentElement.dataset.theme = 'light'; setDark(false); setWidth(1100)
    } catch (e) { setResults(r => [...r, `STOP ${(e as Error).message}`]) }
  }
  async function runReadingMath() {
    setResults([])
    try {
      flushSync(() => { setEditor(false); setStreaming(false); setText(mathSample); setBroken(false); setWidth(1100) })
      await sleep()
      setEditor(true); await sleep()
      const host = document.querySelector('#fixture')!
      check(host.querySelector('.note-mode-switch button')!.getAttribute('aria-pressed') === 'true' && !host.querySelector('.ProseMirror'), '含公式的普通笔记默认以阅读模式打开')
      let reading = host.querySelector<HTMLElement>('.note-read-preview')!
      const tables = reading.querySelectorAll('table')
      check(tables.length === 2 && tables[0].querySelectorAll('tbody tr').length === 3, '截图中的两张公式表完整显示')
      check([...tables[0].querySelectorAll('tbody tr')].every(row => row.querySelectorAll('td').length === 3), '雅可比和多分支公式不会被竖线拆列')
      check(tables[0].querySelectorAll('td:nth-child(3) .katex').length === 3 && !tables[0].textContent!.includes('$'), '三种分布变换公式全部经过KaTeX渲染')
      check(tables[1].querySelectorAll('.katex').length === 4 && !tables[1].textContent!.includes('$'), '易错点中的范数、绝对值及条件概率均渲染')
      const expected = String.raw`f_Y(y)=f_X(g^{-1}(y))\big\|(g^{-1})'(y)\big\|`
      check([...reading.querySelectorAll('.katex-mathml math')].some(el => el.textContent?.includes(expected)), 'LaTeX反斜线与范数语义原样保留')
      check(reading.querySelectorAll('.katex-display').length === 2, '方括号与latex围栏均渲染为独立公式')
      check([...reading.querySelectorAll('.katex-mathml math')].some(el => el.textContent?.includes(String.raw`\|v\|=\sqrt{v^Tv}`)), '反斜线圆括号行内公式正常显示')
      check([...reading.querySelectorAll('.katex-mathml math')].some(el => el.textContent?.includes('f(x)=\n|x|')), '跨一个换行的行内公式正常显示')
      check(!reading.querySelector('.katex-error'), '合法公式没有KaTeX错误')
      check(!!reading.querySelector('details summary .katex') && !reading.querySelector('details summary')!.textContent!.includes('$'), '旧笔记HTML折叠题干中的公式也正常渲染')
      check(reading.querySelector('code')!.textContent === '$P(A|B)$' && reading.querySelector('pre code')!.textContent === '$P(A|B)$', '行内代码与普通代码围栏不误渲染')
      setText('<!-- ui:compare -->\n\n' + formulaTable); await sleep()
      reading = host.querySelector<HTMLElement>('.note-read-preview')!
      check(!!reading.querySelector('.noteui.nui-compare') && !reading.querySelector('.katex-error'), '同一份公式表添加指令后也能直接使用NoteUI')
      const source = reading.querySelector('.nui-source code')!.textContent!
      check(source.includes(formulaTable), 'NoteUI源码保持完整原始LaTeX与竖线')
      click(host.querySelector('.note-mode-switch button:nth-child(2)')); await sleep()
      check(host.querySelector('.note-mode-switch button')!.getAttribute('aria-pressed') === 'false', '用户仍可主动切换编辑模式')
      setFixturePath('NoteUI-math-other.md'); await sleep()
      check(host.querySelector('.note-mode-switch button')!.getAttribute('aria-pressed') === 'true', '切换笔记后恢复默认阅读模式')
      setText(mathSample); await sleep()
    } catch (e) { setResults(r => [...r, `STOP ${(e as Error).message}`]) }
  }
  async function runComponentMath() {
    setResults([])
    try {
      flushSync(() => { setEditor(false); setStreaming(false); setText(componentMathSample); setBroken(false); setWidth(1100) })
      await sleep()
      setFixturePath('NoteUI-component-math.md'); setEditor(true); await sleep()
      const host = document.querySelector<HTMLElement>('#fixture .note-read-preview')!
      check(host.querySelectorAll('.noteui').length === 6, '公式示例的6个组件都激活')
      const steps = host.querySelector('ol.nui-steps')!
      check(steps.querySelectorAll('.katex').length === 3, '截图中的a_i、min(cur,a_i)、b_i均渲染')
      check(!steps.textContent!.includes('$') && steps.textContent!.includes('串内自身得分恒为 0'), '步骤不残留美元符号，正文完整')
      check(steps.querySelector('code')!.textContent === 'cur' && steps.querySelectorAll('code').length >= 4, '步骤中的cur与括号保持行内代码')
      check(steps.querySelector('strong')!.textContent === '串内自身得分恒为 0', '步骤保留强调样式')
      const summary = host.querySelector('.nui-timeline summary')!
      check(summary.querySelectorAll('.katex').length === 2 && !!summary.querySelector('strong'), '可折叠步骤标题同时支持美元和圆括号公式')
      check(!summary.querySelector('p, div, button, a'), 'summary内保持行内结构，不嵌套段落或交互控件')
      click(summary); await sleep()
      check(summary.parentElement!.hasAttribute('open') && summary.parentElement!.querySelectorAll('.katex').length === 3, '展开步骤后解释公式正常渲染')
      check(host.querySelectorAll('.nui-title .katex').length === 2, '组件标题中的公式正常渲染')
      check(host.querySelectorAll('.nui-branches .katex').length === 3 && !!host.querySelector('.nui-branches code'), '知识树标题、解释和叶节点保留公式与代码')
      check(host.querySelector('.nui-stat-detail')!.querySelectorAll('.katex').length === 2, '指标说明的表头和内容均渲染公式')
      check(host.querySelectorAll('.nui-table thead .katex').length === 2, '可排序表头公式正常渲染')
      check(host.querySelectorAll('[role=tab] .katex').length === 2, '标签标题公式正常渲染')
      check(!host.querySelector('.katex-error') && host.querySelector('p > .katex'), '正文括号重复次数公式完整，无KaTeX错误')
      const source = host.querySelector('.nui-source code')!.textContent!
      check(source.includes('$\\min(cur, a_i)$') && source.includes('`cur`'), '原始Markdown和公式定界符不被改写')
      const malicious = document.createElement('template')
      malicious.innerHTML = renderInlineMarkdown('**$a_i$** <img src=x onerror=alert(1)> [链接](javascript:alert(1)) [[目标|显示]]')
      check(!!malicious.content.querySelector('.katex') && !malicious.content.querySelector('img,a,button,[onerror],script'), '行内渲染保留公式且阻止注入与嵌套交互')
      for (const width of [360, 768, 1100]) {
        setWidth(width); await sleep()
        check(host.scrollWidth <= host.clientWidth + 1, `${width}px下公式组件不溢出`)
      }
      document.documentElement.dataset.theme = 'dark'; setDark(true); await sleep()
      check(!host.querySelector('.katex-error') && getComputedStyle(steps.querySelector('.katex')!).color !== 'rgb(0, 0, 0)', '暗色主题公式继承文字颜色')
      document.documentElement.dataset.theme = 'light'; setDark(false)
    } catch (e) { setResults(r => [...r, `STOP ${(e as Error).message}`]) }
  }
  async function runWikilinks() {
    setResults([])
    try {
      const text = String.raw`# 双链与公式兼容

这一篇只回答一个问题。它是 \[\[随机变量与分布函数｜总览]] 的下游，链接仍在同一段中。

**一句话与 \[\[统一期望技巧]] 划清边界**：比较两个概念。

下游：[[分位数与逆变换]]、\[\[常见连续分布族]]。

显示别名：[[笔记/概率论/note/随机变量与分布函数｜总览|总览]]。

|关联|说明|
|---|---|
|[[统一期望技巧|期望方法]]|别名竖线不拆表格|

\[P(A|B)=P(A\cap B)/P(B)\]

` + '`[[不要打开|样例]]`\n\n```text\n\\[\\[代码示例]]\n```'
      flushSync(() => { setEditor(false); setText(text); setStreaming(false); setWidth(1100); setBroken(false) })
      await sleep(); setEditor(true); await sleep()
      const reading = document.querySelector<HTMLElement>('#fixture .note-read-preview')!
      const links = [...reading.querySelectorAll<HTMLButtonElement>('button.wikilink')]
      check(links.length === 6, '普通、转义、加粗和表格内双链均识别')
      check(links[0].textContent === '随机变量与分布函数｜总览' && links[0].dataset.wikilink === '随机变量与分布函数｜总览', '文件名中的全角竖线保留，不误当别名')
      check(links[0].closest('p')!.textContent!.startsWith('这一篇') && !links[0].closest('p')!.innerHTML.includes('<br>'), '转义双链不会拆开原段落或残留孤立括号')
      check(links[4].textContent === '总览' && links[4].dataset.wikilink === '笔记/概率论/note/随机变量与分布函数｜总览', '别名显示与真实目标分离')
      openedLink = ''; click(links[4]); await sleep()
      check(openedLink === '笔记/概率论/note/随机变量与分布函数｜总览', '点击别名按真实笔记路径导航')
      check(reading.querySelectorAll('tbody td').length === 2, '表格中的别名竖线不破坏列数')
      check(reading.querySelectorAll('.katex-display').length === 1 && !reading.querySelector('.katex-error'), '转义双链不会吞并后续独立公式')
      check(reading.querySelector('code')!.textContent === '[[不要打开|样例]]' && !reading.querySelector('pre .wikilink'), '代码示例保留原样，不变成可点击双链')
      links[4].focus()
      check(document.activeElement === links[4] && links[4].type === 'button', '双链使用可键盘聚焦的原生按钮')
      const malicious = document.createElement('div')
      malicious.innerHTML = renderRichMarkdown('[[a" onclick="alert(1)|<img src=x onerror=alert(1)>]]').html
      check(!malicious.querySelector('img, [onclick], [onerror]'), '双链目标与显示名保持HTML转义')
    } catch (e) { setResults(r => [...r, `STOP ${(e as Error).message}`]) }
  }
  return <>
    <header style={{ padding: '16px 24px', display: 'flex', flexWrap: 'wrap', gap: 16, position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 1, borderBottom: '1px solid var(--border)' }}>
      <button onClick={() => void run()} id="run-tests">运行浏览器回归</button>
      <button onClick={() => void runExtended()} id="run-expanded">运行学习组件回归</button>
      <button onClick={() => void runSystem()} id="run-system">运行组合与SVG回归</button>
      <button onClick={() => void runInteractive()} id="run-interactive">运行可视化实验回归</button>
      <button onClick={() => void runCatalog()} id="run-catalog">运行组件库回归</button>
      <button onClick={() => { setText(splitFrontmatter(interactiveSample).body); setEditor(false); setWidth(860) }}>查看可视化实验室</button>
      <button onClick={() => void runReadingLayout()} id="run-reading-layout">引用与阅读宽度回归</button>
      <button onClick={() => void runReadingMath()} id="run-reading-math">公式与默认阅读回归</button>
      <button onClick={() => void runComponentMath()} id="run-component-math">NoteUI组件公式回归</button>
      <button onClick={() => void runWikilinks()} id="run-wikilinks">双链兼容回归</button>
      <button onClick={() => { setText(generatedSample); setFixturePath('NoteUI-ai-example.md'); setEditor(true); setWidth(1100) }}>查看 AI 实测笔记</button>
      <button onClick={() => { setText(algorithmSample); setFixturePath('NoteUI-algorithm-ai.md'); setEditor(true); setWidth(1100) }}>查看截图算法实测</button>
      <button onClick={() => { setText(extended); setEditor(false) }}>查看 20 类组件</button>
      <button onClick={() => { document.documentElement.dataset.theme = dark ? 'light' : 'dark'; setDark(!dark) }}>切换主题</button>
      <button onClick={() => setWidth(w => w === 360 ? 860 : 360)}>切换 360 / 860px</button>
      <button onClick={() => setEditor(!editor)}>切换笔记编辑器</button>
    </header>
    <pre id="results" style={{ padding: '0 24px', maxHeight: 120, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{results.join('\n')}</pre>
    <main id="fixture" style={{ width: '100%', maxWidth: width, margin: '24px auto', padding: '0 16px', ...(editor ? { height: '80vh', display: 'flex' } : {}) }}>
      {broken ? <NoteUIBlock block={{ name: 'graph', data: null, params: {}, source: '|原文|数据|\n|---|---|\n|保留|1|', key: 'broken' } as any} /> : editor ?
        <EditorPane path={fixturePath} content={text} dark={dark} streaming={streaming} onEdit={(_path, value) => { saved = value; setText(value) }} onWikilink={target => { openedLink = target }} onMarkLearned={() => {}} learnedRunning={false} celebrate={false} tutorOpen={false} onToggleTutor={() => {}} /> :
        <div className="note-read-preview"><RichText text={text} streaming={streaming} /></div>}
    </main>
  </>
}
document.body.style.overflow = 'auto'
document.body.style.height = 'auto'
const root = createRoot(document.getElementById('root')!)
root.render(<App />)
import.meta.hot?.dispose(() => root.unmount())
