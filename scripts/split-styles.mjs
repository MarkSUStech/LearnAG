// 一次性脚本：把 src/styles.css 按区块行区间拆分到 src/styles/ 下
// 用法：node scripts/split-styles.mjs
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
// 按行切分；原文件以换行结尾，split 产生的末尾空元素是终止符伪影，不算真实行
const raw = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8')
const src = raw.endsWith('\n') ? raw.slice(0, -1).split('\n') : raw.split('\n')

// 每个目标文件 = 若干原文件行区间 [start, end]（1-based 闭区间），区间并集必须恰好覆盖全文件
const PLAN = {
  'tokens.css': [
    [1, 79], // 设计变量 / reset / 基础元素 / material symbols
    [1582, 1600], // 滚动条
    [2177, 2187], // 动效弱化偏好（prefers-reduced-motion）
  ],
  'layout.css': [
    [80, 138], // 布局骨架（.app / .sidebar / .resize-handle / .main）
    [566, 634], // 标签页
    [1601, 1698], // 全局微动效
    [1846, 1862], // .editor-stack（含 tutor-open 让位）
  ],
  'sidebar.css': [[139, 301]], // 侧栏 + 会话列表（含 .icon-btn）
  'editor.css': [
    [635, 1105], // 编辑区 + Milkdown 微调 + Callout/表格/mermaid/latex/代码块
    [1773, 1845], // 已学习按钮 + 庆祝动效
    [4213, 4328], // 资料引用角标与悬浮来源卡片
  ],
  'tutor.css': [[1863, 2176]], // 笔记答疑助手面板
  'inputbar.css': [
    [302, 565], // AI 提问卡片
    [1106, 1298], // 底部输入区（悬空浮动）
    [2188, 2217], // 计划芯片
    [3778, 3906], // 输入栏：专家图标 / agent 面板 / 附件 chips
    [4329, 4351], // 提问卡：自定义回答输入
  ],
  'graph.css': [[1299, 1403]], // 图谱页
  'dialogs.css': [
    [1404, 1547], // 设置对话框（含 .btn）
    [1548, 1581], // Toast
    [1699, 1772], // 快速切换器
    [3736, 3777], // 设置页 RAG 状态区
    [3907, 4022], // 资料选择器
  ],
  'refs.css': [
    [2218, 2301], // 资料预览器
    [3702, 3735], // 资料页 PDF 预览工具条
  ],
  'pdfstudy.css': [
    [2302, 3386], // ps- 模块头 + 大纲树 + 顶栏 + 查看器 + 标注覆盖层 + 标签轨 + 选区工具条 + 卡片面板 + 标注列表 + 标签视图
    [3387, 3507], // 抽屉（卡片编辑）
    [3508, 3701], // pdf-study 面板骨架 + 翻译弹层 + mini 按钮 + 面板 toast
    [4023, 4212], // 整理笔记对话框
  ],
}

// ── 校验：区间无重叠且并集恰好是 1..N ──
const all = Object.values(PLAN).flat().sort((a, b) => a[0] - b[0])
let cursor = 1
for (const [s, e] of all) {
  if (s !== cursor) throw new Error(`区间缺口/重叠：期望起点 ${cursor}，实际 ${s}`)
  if (e < s || e > src.length) throw new Error(`非法区间终点：${e}`)
  cursor = e + 1
}
if (cursor !== src.length + 1) throw new Error(`未覆盖到文件末尾：止于 ${cursor - 1}，共 ${src.length} 行`)

const outDir = path.join(root, 'src/styles')
fs.mkdirSync(outDir, { recursive: true })
const lines = (s, e) => src.slice(s - 1, e).join('\n')
for (const [file, ranges] of Object.entries(PLAN)) {
  // 每个文件一律以单个换行收尾：末行（含空行）必须被终止，否则拼接时与下一文件粘连
  const content = ranges.map(([s, e]) => lines(s, e)).join('\n') + '\n'
  fs.writeFileSync(path.join(outDir, file), content)
  console.log(`${file}: ${ranges.map(([s, e]) => `${s}-${e}`).join(', ')}`)
}
console.log('完成，共覆盖', src.length, '行')
