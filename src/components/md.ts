// 提问卡片等轻量场景的 markdown 渲染：GFM + 换行转 br + KaTeX 公式 + Mermaid 图表占位
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import katex from 'katex'

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const blockMath = {
  name: 'blockMath',
  level: 'block' as const,
  start(src: string) {
    return src.indexOf('$$')
  },
  tokenizer(src: string) {
    const m = /^\$\$([\s\S]+?)\$\$/.exec(src)
    if (m) return { type: 'blockMath', raw: m[0], text: m[1].trim() }
  },
  renderer(token: { text: string }) {
    return `<p class="q-katex">${katex.renderToString(token.text, { displayMode: true, throwOnError: false, strict: false })}</p>`
  },
}

const inlineMath = {
  name: 'inlineMath',
  level: 'inline' as const,
  start(src: string) {
    return src.indexOf('$')
  },
  tokenizer(src: string) {
    const m = /^\$([^$\n]+?)\$/.exec(src)
    if (m) return { type: 'inlineMath', raw: m[0], text: m[1].trim() }
  },
  renderer(token: { text: string }) {
    return katex.renderToString(token.text, { throwOnError: false, strict: false })
  },
}

marked.use({
  breaks: true,
  gfm: true,
  extensions: [blockMath, inlineMath],
  renderer: {
    code(token: { text: string; lang?: string }) {
      if ((token.lang ?? '').trim().toLowerCase() === 'mermaid') {
        return `<div class="mermaid">${escapeHtml(token.text)}</div>`
      }
      return `<pre><code>${escapeHtml(token.text)}</code></pre>`
    },
  },
})

export interface RenderedMd {
  html: string
  hasMermaid: boolean
}

/** markdown → 消毒后的 HTML；mermaid 占位 div、wikilink/callout 样式化，由调用方渲染 mermaid */
export function renderRichMarkdown(text: string): RenderedMd {
  const raw = marked.parse(text, { async: false }) as string
  const html = DOMPurify.sanitize(raw, { ADD_ATTR: ['style'] })
  const withLinks = html.replace(
    /\[\[([^\[\]\n]{1,80})\]\]/g,
    (_m, title) => `<span class="wikilink">[[${title}]]</span>`,
  )
  // Obsidian callout：blockquote 首段 [!type] → 彩色卡片 div
  const withCallouts = withLinks
    .replace(/<blockquote>\s*<p>\[!(\w+)\]\s*/g, '<div class="callout callout-$1"><p class="callout-title">')
    .replace(/<\/blockquote>/g, '</div>')
  return { html: withCallouts, hasMermaid: withCallouts.includes('class="mermaid"') }
}

/** 纯文本一行预览：剥掉 markdown 标记 */
export function stripMd(text: string) {
  return text.replace(/[*`>#\[\]]/g, '').replace(/\n+/g, ' ')
}
