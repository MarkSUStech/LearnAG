// Distilled from the project's Guided Learning reference; keep the stable policy before dynamic context.
import { NOTEUI_PROMPT } from './noteuiPrompt.js'
import { IMAGE_RULES } from './imagePrompt.js'

export const GUIDED_LEARNING_CORE = `
你是 LearnAgent 的引导式学习伙伴，用中文温和、简洁地帮助用户理解如何与为何。
- 优先当前请求和最近对话；结合知识图谱与长期记忆调整起点，不机械重复已掌握内容、不使用用户名或空泛恭维。
- 首次进入主题时简短建立背景；目标明确就问一个引导问题，目标开放可给2–3个方向；事实快问直接简答。每轮只推进一个关键点。
- 用已有理解、具体例子、类比与视觉解释搭桥；发现误解，指出具体推理问题并给小提示，再请用户尝试，不一口气给出整套答案。
- 练习中每次只问一个问题，循序给提示；用户明确要求答案、反复失败2–3次或明显受挫时，给简洁完整解释与推理，避免无休止追问。
- 根据实际表现反馈，肯定具体正确部分、纠正错误；收尾可简述学到什么和下一步，不每轮强加测验或邀请。
- 用户要求具体格式/学习方法时配合；换话题自然衔接，信息不足才澄清。介绍自身时说明协作学习伙伴的职责。
- 资料不足如实说明，不捏造来源；引用知识库用路径、页码或行号。
- 安全底线：不提供或鼓励危险、自伤、针对未成年人的不健康节食/受限物质等有害行为；不促进武器/毒品/酒精等受管制物的买卖；维护尊严，不骚扰、霸凌、性物化或渲染暴力。
`

const TOOLS = `
## 运行环境
回复在聊天窗口呈现，支持 Markdown、KaTeX、Mermaid、图片与 NoteUI；讲解、引导和练习直接在对话完成。
- 消息可附【知识库自动检索命中】，优先用相关片段并注明来源；缺细节才 search_knowledge/read_note（PDF可按 chapter/page），不要重复检索已有资料。
- 用户要求保存笔记、收集论文等产出时才 delegate：research本地研究、resource联网资料、content写作、visualize配图、scaffold结构与图谱。传目标、必要事实/素材路径、输出路径和标准，勿复制整段对话。
- 单个角色可完成就一次完成，不固定串联各角色；有明确写入结果可直接汇报路径，疑点才定点核验。不在聊天重复已写入的笔记全文。
`

export function buildTeacherSystemPrompt({ graphSummaryText = '', memoryNote = '' } = {}) {
  let out = GUIDED_LEARNING_CORE + TOOLS + NOTEUI_PROMPT + IMAGE_RULES
  if (graphSummaryText) out += `\n## 知识图谱摘要（mastered已掌握/learning学习中/learnable前沿；按mastery调整深度）\n${graphSummaryText.slice(0, 4000)}\n`
  if (memoryNote) out += `\n## 长期记忆（Agent/记忆.md）\n${memoryNote.slice(0, 2000)}\n`
  return out
}

export function buildTeacherUserMessage({ message, ragHits = [] }) {
  const block = buildRagHitBlock(ragHits)
  return message + (block ? '\n\n' + block : '')
}

/** Bounded unique excerpts with exact source locations; full source stays recoverable. */
export function buildRagHitBlock(ragHits = []) {
  const seen = new Set()
  const hits = []
  for (const h of ragHits) {
    const text = String(h.text || '').replace(/\s+/g, ' ').trim()
    const key = JSON.stringify([h.path, h.page, h.pageEnd, text])
    if (!text || !h.path || seen.has(key)) continue
    seen.add(key)
    hits.push({ ...h, text })
    if (hits.length === 4) break
  }
  if (!hits.length) return ''
  return '【知识库自动检索命中】仅使用相关片段并引用来源；缺细节按路径读取。\n' + hits.map((h, i) => {
    const loc = h.page ? `${h.path}（第 ${h.page}${h.pageEnd && h.pageEnd !== h.page ? '-' + h.pageEnd : ''} 页）` : h.path
    return `${i + 1}. ${loc}\n${h.text.slice(0, 500)}${h.text.length > 500 ? '…[节选]' : ''}`
  }).join('\n')
}
