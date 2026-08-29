// 编辑器外观偏好：字号 / 行宽 / 字体（持久化于 localStorage，即时生效）

export interface Appearance {
  fontSize: number // px
  maxWidth: number // px，0 表示全宽
  fontPreset: FontPresetKey
}

export type FontPresetKey = 'system' | 'serif' | 'kai' | 'hei' | 'mono'

export const FONT_PRESETS: { key: FontPresetKey; label: string; stack: string; sample: string }[] = [
  {
    key: 'system',
    label: '系统默认',
    stack: '',
    sample: '',
  },
  {
    key: 'serif',
    label: '衬线 · 宋体（书卷阅读感）',
    // 注意：不放入思源宋体——部分用户只安装了它的 Bold 字重，会导致全文假粗
    stack: "'Noto Serif', Georgia, 'Songti SC', SimSun, 'NSimSun', serif",
    sample: "'Noto Serif', Georgia, serif",
  },
  {
    key: 'kai',
    label: '楷体（手写亲和）',
    stack: "'Kaiti SC', KaiTi, STKaiti, 楷体, serif",
    sample: "KaiTi, 'Kaiti SC', cursive",
  },
  {
    key: 'hei',
    label: '黑体（清晰锐利）',
    stack: "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
    sample: "'Segoe UI', sans-serif",
  },
  {
    key: 'mono',
    label: '等宽（代码风）',
    stack: "'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace",
    sample: "Consolas, monospace",
  },
]

export const WIDTH_PRESETS: { value: number; label: string }[] = [
  { value: 720, label: '窄 · 720px' },
  { value: 860, label: '标准 · 860px' },
  { value: 1020, label: '宽 · 1020px' },
  { value: 0, label: '全宽' },
]

const KEY = 'la-appearance'

export const DEFAULT_APPEARANCE: Appearance = {
  fontSize: 16,
  maxWidth: 860,
  fontPreset: 'system',
}

export function loadAppearance(): Appearance {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    return {
      fontSize: clamp(Number(raw.fontSize) || DEFAULT_APPEARANCE.fontSize, 13, 22),
      maxWidth: raw.maxWidth === 0 ? 0 : Number(raw.maxWidth) || DEFAULT_APPEARANCE.maxWidth,
      fontPreset: FONT_PRESETS.some((p) => p.key === raw.fontPreset) ? raw.fontPreset : 'system',
    }
  } catch {
    return { ...DEFAULT_APPEARANCE }
  }
}

export function saveAppearance(a: Appearance) {
  localStorage.setItem(KEY, JSON.stringify(a))
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

/** 把外观偏好写到根元素的 CSS 变量 */
export function applyAppearance(a: Appearance) {
  const root = document.documentElement
  root.style.setProperty('--editor-font-size', a.fontSize + 'px')
  root.style.setProperty('--editor-max-width', a.maxWidth === 0 ? '100%' : a.maxWidth + 'px')
  const preset = FONT_PRESETS.find((p) => p.key === a.fontPreset)
  if (preset && preset.stack) {
    root.style.setProperty('--editor-font-family', preset.stack)
    root.style.setProperty('--editor-font-title', preset.stack)
  } else {
    // 系统默认：交还 Crepe 主题自己的字体
    root.style.removeProperty('--editor-font-family')
    root.style.removeProperty('--editor-font-title')
  }
}
