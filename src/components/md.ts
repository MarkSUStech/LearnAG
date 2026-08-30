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
      const lang = (token.lang ?? '').trim().toLowerCase()
      if (lang === 'mermaid') {
        return `<div class="mermaid">${escapeHtml(token.text)}</div>`
      }
      if (lang === 'd2' || lang === 'gnuplot') {
        return `<div class="remote-diagram" data-lang="${lang}">${escapeHtml(token.text)}</div>`
      }
      return `<pre><code>${escapeHtml(token.text)}</code></pre>`
    },
  },
})

export interface RenderedMd {
  html: string
  hasMermaid: boolean
  hasRemoteDiagram: boolean
}

/** markdown → 消毒后的 HTML；mermaid/d2/gnuplot 转占位 div 由调用方渲染；wikilink/callout 样式化 */
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
  return {
    html: withCallouts,
    hasMermaid: withCallouts.includes('class="mermaid"'),
    hasRemoteDiagram: withCallouts.includes('remote-diagram'),
  }
}

/** 服务端渲染 gnuplot/d2 代码为 SVG 文本 */
export async function renderRemoteDiagram(lang: string, code: string): Promise<string> {
  const res = await fetch('/api/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang, code }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.svg) throw new Error(json.error || '渲染失败')
  return json.svg as string
}

/** 在容器内渲染全部 remote-diagram 占位（d2/gnuplot） */
export function renderRemoteDiagramsIn(el: HTMLElement) {
  const nodes = [...el.querySelectorAll<HTMLElement>('.remote-diagram')]
  for (const n of nodes) {
    if (n.dataset.rendered === '1') continue
    n.dataset.rendered = '1'
    n.classList.add('mermaid-diagram', 'loading')
    const lang = n.dataset.lang ?? 'd2'
    renderRemoteDiagram(lang, n.textContent ?? '')
      .then((svg) => {
        n.innerHTML = svg
        n.classList.remove('loading')
      })
      .catch((e) => {
        n.classList.remove('loading')
        n.classList.add('error')
        n.textContent = lang + ' 渲染失败：' + String(e?.message || e).slice(0, 200)
      })
  }
}

/** 纯文本一行预览：剥掉 markdown 标记 */
export function stripMd(text: string) {
  return text.replace(/[*`>#\[\]]/g, '').replace(/\n+/g, ' ')
}
