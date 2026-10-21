// Runtime-neutral source of truth: browser parser, Gallery and server prompts.
const choice = (values, fallback) => ({ type: 'enum', values: values.split('|'), ...(fallback === undefined ? {} : { default: fallback }) })
const text = (required = false) => ({ type: 'string', required, maxLength: 160 })
const title = { title: text() }
const spacing = choice('inner|group|section', 'group')
const align = choice('start|center|end|stretch', 'stretch')
function item(label, category, data, params = {}, state = [], limits = '', surface = 'plain') {
  return { label, category, description: data, data, params: { ...title, ...params }, state, limits, surface, children: [], slots: [] }
}
function layout(label, description, params = {}, children = true) {
  return { ...item(label, '布局与组合', description, params), input: children ? 'container' : 'none', children: children ? ['markdown', 'noteui'] : [], slots: children ? ['body', 'cell'] : [], limits: '最多4层、每层12格；完整end后显示，错误保留Markdown' }
}
export const noteUIRegistry = {
  chart: item('数据图表', '数学与实验', '精确表头的数据表', { type: choice('line|bar|pie|scatter', 'bar'), x: text(true), y: text(true) }, ['hiddenSeries', 'focusedPoint'], '≤6序列；scatter数值x/y；pie单序列非负、总和>0'),
  stats: item('关键指标', '数学与实验', '指标|值|说明(可选)'),
  compare: item('概念对比', '理解与梳理', '方案|维度…', { layout: choice('auto|table|cards', 'auto') }, ['view']),
  steps: item('过程与步骤', '理解与梳理', '有序列表，首段标题、缩进段落解释', { mode: choice('steps|timeline', 'steps') }, ['expandedSteps']),
  quiz: item('随堂练习', '记忆与自测', '题干+无序选项(- A. 文本)+可选>解析', { type: choice('single|multi', 'single'), answer: text(true) }, ['selection', 'submitted'], 'A–H唯一，多选答案A,C', 'panel'),
  graph: item('知识关系', '理解与梳理', 'source|target', { from: text(true), to: text(true) }, [], '复用Mermaid；复杂流程直接用mermaid'),
  concept: item('概念词典', '理解与梳理', '术语|定义|例子(可选)', {}, ['query', 'limit']),
  flashcards: item('回忆闪卡', '记忆与自测', '问题|答案', {}, ['index', 'revealed', 'ratings'], '', 'panel'),
  accordion: item('折叠讲解', '理解与梳理', '可嵌套普通列表', {}, ['expandedItems']),
  tree: item('知识层级', '理解与梳理', '可嵌套普通列表', {}, ['expandedItems']),
  derivation: item('分步推导', '数学与实验', '步骤|公式|理由(可选)', {}, ['shownSteps']),
  code: item('代码导读', '算法与编程', '代码围栏，紧接行号|讲解表；每个非空行必须有解释', {}, ['selectedLine', 'wrap', 'copyStatus'], '真实行号含空行/注释，勿用范围，不插其他指令；≤500行，不执行'),
  checklist: item('学习清单', '计划与反思', 'GFM任务列表', {}, ['checked']),
  table: item('数据探索', '算法与编程', '任意表格', {}, ['query', 'sort', 'page']),
  tabs: item('知识分组', '理解与梳理', '标签|内容', {}, ['activeTab']),
  cloze: item('主动填空', '记忆与自测', '列表，每项唯一反引号行内答案', {}, ['answers', 'submitted']),
  match: item('概念配对', '记忆与自测', '概念|解释', {}, ['answers', 'submitted', 'optionOrder'], '2–12对，两侧唯一'),
  rubric: item('掌握度自评', '计划与反思', '维度|整数满分1–100|标准', {}, ['scores']),
  progress: item('学习进度', '计划与反思', '项目|完成|总量', {}, [], '0≤完成≤总量且总量>0'),
  schedule: item('学习日程', '计划与反思', 'YYYY-MM-DD|任务|说明', {}, ['month', 'checked'], '需计划依据，不设提醒'),
  sequence: item('序列与操作', '算法与编程', '短元素|说明', { mode: choice('static|cancel|sort', 'static'), pair: { ...text(), default: 'R,B' } }, ['frame', 'selectedItem'], '≤60项；cancel定向相邻消去，pair仅cancel；sort数值升序交换；整句指针操作改steps'),
  distribution: item('概率分布实验', '数学与实验', '参数|值，或参数|值|最小|最大|步长', { type: choice('poisson|binomial|normal', 'poisson') }, ['parameters', 'focusedPoint'], '参数lambda / n,p / mu,sigma；有界滑块，勿列概率表', 'panel'),
  venn: item('集合与归属', '数学与实验', '区域|标签|数量(可选)', { sets: { ...text(), default: 'A,B,C' } }, ['selection'], '2/3集合，A、A&B、A&B&C为互斥区域，勿重复计数'),
  matrix: item('矩阵与状态', '算法与编程', '行名|列1|列2…', {}, ['selectedCell'], '≤20行15数据列，纯数值热图'),
  numberline: item('数轴与区间', '数学与实验', '名称|左端点|右端点|开闭(可选[]/[)/(]/())', {}, ['selectedInterval'], '有限区间'),
  geometry: item('坐标与几何', '数学与实验', '点名|x|y', { mode: choice('points|polygon|vectors', 'polygon') }, ['selectedPoint'], '按行连多边形或从原点画向量，等比例'),
  plot: item('函数实验', '数学与实验', '参数|值，或参数|值|最小|最大|步长', { fn: choice('linear|quadratic|sine|exponential', 'quadratic') }, ['parameters', 'focusedPoint'], '参数a,b / a,b,c / a,b,c / a,b；x∈[-5,5]，无表达式执行', 'panel'),
  playback: item('状态回放', '算法与编程', '步骤|逗号分隔状态|解释|高亮下标(可选，0起逗号分隔)', {}, ['frame', 'playing'], '≤100帧，按给定数据回放，不验证算法'),
  svg: item('自定义示意图', '理解与梳理', '形状|位置|尺寸或终点|文字|颜色', { width: { ...text(), default: '640' }, height: { ...text(), default: '360' } }, ['selectedShape'], '≤80图形；rect位置x,y尺寸w,h；circle位置cx,cy尺寸r；ellipse尺寸rx,ry；line/arrow终点x2,y2；text尺寸字号10–28；polygon位置为逗号/分号坐标且尺寸空；path位置仅显式M/L/Q/C/Z、尺寸空。颜色ink/muted/accent/success/warning/danger/blue/red/series1–6；文字用Unicode，公式放相邻Markdown；禁原始SVG/HTML/JS'),
  row: layout('水平组合', '并列短内容，小屏自动堆叠', { gap: spacing, align }),
  col: layout('垂直组合', '文章顺序，默认section间距', { gap: choice('inner|group|section', 'section'), align }),
  box: layout('内容容器', '局部分组，默认透明无边框', { gap: spacing, tone: choice('plain|soft', 'plain') }),
  grid: layout('响应式网格', '并列信息，小屏自动单列', { columns: choice('2|3|4', '2'), gap: spacing }),
  card: layout('分组卡片', '仅汇总/独立任务，勿套全部正文', { tone: choice('outline|soft', 'outline'), gap: spacing }),
  divider: layout('分隔线', '分隔章节，普通---也可', {}, false),
  spacer: layout('弹性留白', '仅布局内补空，不堆叠留白', { size: spacing }, false),
  carousel: { ...layout('横向浏览', '并列资料，可键盘滚动和前后翻页', { gap: spacing }), state: ['visibleItem'] },
  popover: { ...layout('附加说明', '点击标题查看补充说明，Esc关闭', {}), state: ['open'], slots: ['body'] },
}

export const layoutNames = Object.keys(noteUIRegistry).filter(name => noteUIRegistry[name].input)
export function parameterChoices(name) {
  return Object.fromEntries(Object.entries(noteUIRegistry[name].params).map(([key, param]) => [key, param.values ?? null]))
}
// Validation and prompts read the same parameter descriptions; no per-role grammar copies.
export function componentGuide() {
  return Object.entries(noteUIRegistry).map(([name, spec]) => {
    const params = Object.entries(spec.params).filter(([key]) => key !== 'title').map(([key, p]) => `${key}=${p.values?.join('|') ?? '值'}${p.required ? '(必填)' : ''}`).join(' ')
    return `${name}${params ? ' ' + params : ''}：${spec.data}${spec.limits && !spec.input ? '；' + spec.limits : ''}`
  }).join('\n')
}
