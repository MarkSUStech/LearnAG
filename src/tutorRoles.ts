// 答疑助手角色元数据（前端展示用；提示词在 server/agent/tutorPrompts.js）

export type TutorRole = 'socratic' | 'feynman' | 'quick'

export const TUTOR_ROLES: Record<TutorRole, { label: string; icon: string; desc: string }> = {
  socratic: {
    label: '苏格拉底',
    icon: 'psychology_alt',
    desc: '诘问式：只问不答，引导你自己想通概念',
  },
  feynman: {
    label: '费曼',
    icon: 'record_voice_over',
    desc: '讲给我懂：你来讲，扮小白的助手挑漏洞',
  },
  quick: {
    label: '快讲',
    icon: 'bolt',
    desc: '直击核心：类比+例子+最小示例，快速解答',
  },
}
