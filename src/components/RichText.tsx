import { useEffect, useMemo, useRef } from 'react'
import { renderRichMarkdown, renderRemoteDiagramsIn } from './md'
import { ensureMermaid } from './editor/mermaidNodeView'
import { isBeautifulSupported, renderBeautiful } from './editor/beautifulMermaid'
import { attachCiteHover } from '../cite'

/** 轻量 markdown 渲染（callout/wikilink/代码/公式/mermaid/引用角标），用于聊天面板等非编辑器场景 */
export default function RichText({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => renderRichMarkdown(text), [text])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const dark = document.documentElement.dataset.theme === 'dark'
    if (html.hasMermaid) {
      ensureMermaid(dark)
      const nodes = [...el.querySelectorAll('.mermaid')] as HTMLElement[]
      const rest: HTMLElement[] = []
      for (const n of nodes) {
        const code = n.textContent ?? ''
        if (isBeautifulSupported(code)) {
          const svg = renderBeautiful(code, dark)
          if (svg) {
            n.innerHTML = svg
            continue
          }
        }
        rest.push(n)
      }
      if (rest.length) {
        import('mermaid').then((m) => m.default.run({ nodes: rest }).catch(() => undefined))
      }
    }
    if (html.hasRemoteDiagram) renderRemoteDiagramsIn(el)
    // 引用角标悬浮来源卡片
    return attachCiteHover(el, (num) => html.citeRefs.get(num))
  }, [html])

  return <div ref={ref} className="rich-md" dangerouslySetInnerHTML={{ __html: html.html }} />
}
