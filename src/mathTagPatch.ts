// KaTeX 行内 \tag 兼容补丁。
// KaTeX 的 \tag / \tag* 仅在 display 模式支持，行内公式带 \tag 会直接渲染失败
// （Crepe 编辑器、答题卡、预览退化为原始 LaTeX 文本）。
// 本模块在共享的 katex 实例上包装 renderToString / render：行内公式中的
// \tag{B.1} 改写为 \qquad \text{(B.1)}（公式尾部显示 (B.1) 标记，观感与
// 原意图接近）；display 模式保持原样（KaTeX 原生支持右对齐标签）。
// 必须在应用入口最先导入，且早于任何 katex 渲染调用。
import katex from 'katex'

function inlineTagSafe(tex: string, displayMode?: boolean) {
  if (displayMode || !tex.includes('\\tag')) return tex
  return tex.replace(/\\tag\*?\{([^{}]*)\}/g, (_m, t: string) => `\\qquad \\text{(${t})}`)
}

const katexAny = katex as any
if (!katexAny.__laTagPatched) {
  katexAny.__laTagPatched = true
  const origToString = katex.renderToString.bind(katex)
  const origRender = katex.render.bind(katex)
  // output 默认 'html'：KaTeX 默认同时生成 HTML 树 + MathML 冗余树，公式密集的
  // 笔记 DOM 直接翻倍（排版/绘制的最大来源之一）。无障碍朗读在此场景让位性能。
  const withDefaults = (opts?: { displayMode?: boolean; output?: string }) =>
    ({ output: 'html', ...opts }) as any
  katexAny.renderToString = (tex: string, opts?: { displayMode?: boolean; output?: string }) =>
    origToString(inlineTagSafe(String(tex), opts?.displayMode), withDefaults(opts))
  katexAny.render = (tex: string, el: HTMLElement, opts?: { displayMode?: boolean; output?: string }) =>
    origRender(inlineTagSafe(String(tex), opts?.displayMode), el, withDefaults(opts))
}
