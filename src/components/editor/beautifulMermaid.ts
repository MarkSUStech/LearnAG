// Mermaid 渲染分发器：flowchart/state/sequence/class/ER/xy 用 beautiful-mermaid（同步、美观），
// 其余（mindmap/gantt/pie 等与带 classDef 配色的图）回退标准 mermaid 异步渲染
import { renderMermaidSVG } from 'beautiful-mermaid'

const BEAUTIFUL_PREFIXES = [
  'flowchart',
  'graph',
  'statediagram',
  'statediagram-v2',
  'sequencediagram',
  'classdiagram',
  'erdiagram',
  'xychart',
]

/** 根据首行关键字判断图型；返回小写关键字 */
export function detectDiagramType(code: string): string {
  const first = code
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('%%'))
  return (first ?? '').split(/[\s:]+/)[0]?.toLowerCase() ?? ''
}

export function isBeautifulSupported(code: string): boolean {
  const type = detectDiagramType(code)
  const ok = BEAUTIFUL_PREFIXES.includes(type)
  // 带 classDef 配色约定的图（图谱配色规范）走标准渲染器以保留颜色
  return ok && !/^\s*classDef/m.test(code)
}

/** 同步渲染（beautiful-mermaid），失败返回 null 由调用方兜底
 *  注意：必须传具体十六进制色——库会把派生色写进 SVG 属性，var()/color-mix 在属性里无法解析会导致文字丢失 */
export function renderBeautiful(code: string, dark: boolean): string | null {
  try {
    const colors = dark
      ? { bg: '#101216', fg: '#e6e8ec', accent: '#818cf8', muted: '#9aa1ad', surface: '#1e222a', border: '#4b5563' }
      : { bg: '#f7f7f8', fg: '#16181d', accent: '#4f46e5', muted: '#6b7280', surface: '#eceef2', border: '#c9ced8' }
    return renderMermaidSVG(code, { ...colors, transparent: true })
  } catch {
    return null
  }
}
