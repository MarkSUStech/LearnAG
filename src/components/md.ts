// 提问卡片等轻量场景的 markdown 渲染：GFM + 换行转 br + KaTeX 公式 + Mermaid 图表占位
import { Marked } from 'marked'
import DOMPurify from 'dompurify'
import katex from 'katex'
import { parseCiteDefs } from '../cite'
import { planNoteUI, type NoteUIBlock } from '../noteui/parser'
import { protectMathPipes, restoreMathTree } from '../markdown/math'
import { parseWikilink } from '../markdown/wikilink'

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
    const at = src.search(/\$\$[\s\S]+?\$\$|(?<!\\\[)\\\[(?!\\?\[)[\s\S]+?\\\]/)
    return at < 0 ? undefined : at
  },
  tokenizer(src: string) {
    const m = /^(?:\$\$([\s\S]+?)\$\$|\\\[(?!\\?\[)([\s\S]+?)\\\])/.exec(src)
    if (m) return { type: 'blockMath', raw: m[0], text: (m[1] ?? m[2]).trim() }
  },
  renderer(token: { text: string }) {
    return `<div class="q-katex">${katex.renderToString(token.text, { displayMode: true, throwOnError: false, strict: false })}</div>`
  },
}

const inlineMath = {
  name: 'inlineMath',
  level: 'inline' as const,
  start(src: string) {
    const at = src.search(/\$(?!\$)[\s\S]+?\$|\\\([\s\S]+?\\\)/)
    return at < 0 ? undefined : at
  },
  tokenizer(src: string) {
    const m = /^(?:\$(?!\$)((?:\\[^\n]|[^$\\])+?)\$(?!\$)|\\\(([\s\S]+?)\\\))/.exec(src)
    if (m && !/\n\s*\n/.test(m[0])) return { type: 'inlineMath', raw: m[0], text: (m[1] ?? m[2]).trim() }
  },
  renderer(token: { text: string }) {
    return katex.renderToString(token.text, { throwOnError: false, strict: false })
  },
}

const wikilink = {
  name: 'wikilink',
  level: 'inline' as const,
  start(src: string) {
    const at = src.search(/(?:\[\[|\\\[\\\[)[^\[\]\r\n]{1,200}(?:\]\]|\\\]\\\])/)
    return at < 0 ? undefined : at
  },
  tokenizer(src: string) {
    const m = /^(?:\[\[|\\\[\\\[)([^\[\]\r\n]{1,200}?)(?:\]\]|\\\]\\\])/.exec(src)
    if (m && parseWikilink(m[1]).target) return { type: 'wikilink', raw: m[0], text: m[1] }
  },
  renderer(token: { text: string }) {
    const { target, label } = parseWikilink(token.text)
    return `<button type="button" class="wikilink" data-wikilink="${escapeHtml(target)}" title="打开笔记：${escapeHtml(target)}">${escapeHtml(label)}</button>`
  },
}

const richMarked: Marked = new Marked({
  breaks: true,
  gfm: true,
  extensions: [blockMath, inlineMath, wikilink],
  renderer: {
    html(token): string {
      // Older notes use native details/summary. Their summary is an HTML token,
      // so run its inline content through the same math/link parser as prose.
      // The resulting HTML still goes through DOMPurify with the whole document.
      return token.text.replace(/(<summary\b[^>]*>)([\s\S]*?)(<\/summary>)/gi,
        (_match, open: string, body: string, close: string) => open + richMarked.parseInline(body, { async: false }) + close)
    },
    image(token) {
      const src = /^(https?:|data:|\/\/|\/api\/raw\?)/.test(token.href) ? token.href : '/api/raw?path=' + encodeURIComponent(token.href)
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(token.text)}"${token.title ? ` title="${escapeHtml(token.title)}"` : ''} loading="lazy">`
    },
    blockquote(token) {
      // Render each AST quote with its own matching closing tag. Replacing every
      // </blockquote> with </div> leaves ordinary quotes open and progressively
      // indents all later prose. Nested quotes are parsed independently here.
      const body = this.parser.parse(token.tokens)
      const callout = /^<p>\[!(\w+)\][ \t]*/.exec(body)
      if (callout) {
        return `<div class="callout callout-${callout[1].toLowerCase()}"><p class="callout-title">${body.slice(callout[0].length)}</div>\n`
      }
      return `<blockquote>\n${body}</blockquote>\n`
    },
    code(token: { text: string; lang?: string }) {
      const lang = (token.lang ?? '').trim().toLowerCase()
      if (lang === 'mermaid') {
        return `<div class="mermaid">${escapeHtml(token.text)}</div>`
      }
      if (lang === 'd2' || lang === 'gnuplot') {
        return `<div class="remote-diagram" data-lang="${lang}">${escapeHtml(token.text)}</div>`
      }
      if (['latex', 'tex', 'math'].includes(lang)) {
        return `<div class="q-katex">${katex.renderToString(token.text, { displayMode: true, throwOnError: false, strict: false })}</div>`
      }
      return `<pre><code>${escapeHtml(token.text)}</code></pre>`
    },
  },
})

/** Phrasing content for NoteUI summaries, labels and buttons; no nested controls. */
export function renderInlineMarkdown(text: string): string {
  return DOMPurify.sanitize(richMarked.parseInline(text, { async: false }), {
    FORBID_TAGS: ['a', 'button', 'img', 'input', 'select', 'textarea', 'video', 'audio'],
  })
}

export interface RenderedMd {
  html: string
  hasMermaid: boolean
  hasRemoteDiagram: boolean
  mermaidSources: string[]
  /** 脚注引用定义（[^n]: ...），供悬浮来源卡片查询 */
  citeRefs: Map<number, import('../cite').CiteInfo>
  parts: Array<{ html: string } | { block: NoteUIBlock }>
}

/** markdown → 消毒后的 HTML；mermaid/d2/gnuplot 转占位 div 由调用方渲染；wikilink/callout/引用角标样式化 */
export function renderRichMarkdown(text: string, options: { noteUI?: boolean; streaming?: boolean } = {}): RenderedMd {
  // 引用脚注：提取 [^n]: 定义（代码围栏内不动），行内 [^n] 换成角标 sup
  const citeRefs = parseCiteDefs(text)
  const plan = options.noteUI ? planNoteUI(text, options.streaming) : { markdown: text, blocks: [], slots: [] }
  const body = plan.markdown
    .split(/(```[\s\S]*?```)/g)
    .map((part, i) => {
      if (i % 2 === 1) return part
      let p = part.replace(/^\[\^(\d{1,3})\]:\s*.+$/gm, '')
      if (citeRefs.size) {
        p = p.replace(/\[\^(\d{1,3})\]/g, (m2, num) => {
          const n = parseInt(num, 10)
          return citeRefs.has(n) ? `<sup class="cite-badge" data-ref="${n}">${n}</sup>` : m2
        })
      }
      return p
    })
    .join('')

  const math = protectMathPipes(body)
  const tokens = restoreMathTree(richMarked.lexer(math.markdown), math.restore)
  const raw = richMarked.parser(tokens)
  const html = DOMPurify.sanitize(raw, { ADD_ATTR: ['style', 'data-ref'] })
  // vault 相对路径的图片代理到 /api/raw（笔记内 ![](assets/x.jpg) 的显示）
  const withImgs = html.replace(
    /<img\b([^>]*?)src="([^"]*)"([^>]*)>/g,
    (m2, pre: string, src: string, post: string) =>
      /^(https?:|data:|\/\/|\/api\/raw\?)/.test(src) ? m2 : `<img${pre} src="/api/raw?path=${encodeURIComponent(src)}"${post}>`,
  )
  const withLinks = withImgs
  const parts: RenderedMd['parts'] = []
  let offset = 0
  for (const [i, slot] of plan.slots.entries()) {
    const at = withLinks.indexOf(slot, offset)
    if (at < 0) return renderRichMarkdown(text, { noteUI: false })
    parts.push({ html: withLinks.slice(offset, at) }, { block: plan.blocks[i] })
    offset = at + slot.length
  }
  parts.push({ html: withLinks.slice(offset) })
  const mermaidSources: string[] = []
  if (withLinks.includes('class="mermaid"')) {
    // Keep an immutable source snapshot. Diagram libraries may rewrite DOM and attributes.
    const template = document.createElement('template')
    template.innerHTML = withLinks
    template.content.querySelectorAll('.mermaid').forEach(el => mermaidSources.push(el.textContent ?? ''))
  }
  return {
    html: withLinks,
    hasMermaid: withLinks.includes('class="mermaid"'),
    hasRemoteDiagram: withLinks.includes('remote-diagram'),
    mermaidSources,
    citeRefs,
    parts,
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
