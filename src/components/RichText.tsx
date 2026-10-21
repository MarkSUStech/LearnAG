import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { NoteUIThemeContext } from '../noteui/theme'
import { NoteUIReadingContext } from '../noteui/readingContext'
import { renderRichMarkdown, renderRemoteDiagramsIn } from './md'
import { ensureMermaid } from './editor/mermaidNodeView'
import { isBeautifulSupported, renderBeautiful } from './editor/beautifulMermaid'
import { attachCiteHover, type CiteInfo } from '../cite'
import NoteUIBlock from '../noteui/NoteUIBlock'

/** 轻量 markdown 渲染（callout/wikilink/代码/公式/mermaid/引用角标），用于聊天面板等非编辑器场景 */
export default function RichText({ text, onOpenCite, onWikilink, noteUI = true, streaming = false }: { text: string; onOpenCite?: (info: CiteInfo) => void; onWikilink?: (target: string) => void; noteUI?: boolean; streaming?: boolean }) {
  const inherited = useContext(NoteUIReadingContext)
  const reading = useMemo(() => ({ onWikilink: onWikilink ?? inherited.onWikilink, onOpenCite: onOpenCite ?? inherited.onOpenCite }), [onWikilink, onOpenCite, inherited])
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => renderRichMarkdown(text, { noteUI, streaming }), [text, noteUI, streaming])
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark')
  const themeOverride = useContext(NoteUIThemeContext)
  const diagramDark = themeOverride ? themeOverride === 'dark' : dark

  useEffect(() => {
    if (!html.hasMermaid) return
    const observer = new MutationObserver(() => setDark(document.documentElement.dataset.theme === 'dark'))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    setDark(document.documentElement.dataset.theme === 'dark')
    return () => observer.disconnect()
  }, [html.hasMermaid])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let cancelled = false
    if (html.hasMermaid) {
      ensureMermaid(diagramDark)
      const nodes = [...el.querySelectorAll<HTMLElement>('.mermaid')].filter(node => node.closest('.rich-md') === el)
      const rest: HTMLElement[] = []
      for (const [i, n] of nodes.entries()) {
        const code = html.mermaidSources[i] ?? ''
        if (!code.trim()) continue
        n.textContent = code
        n.removeAttribute('data-processed')
        if (isBeautifulSupported(code)) {
          const svg = renderBeautiful(code, diagramDark)
          if (svg) {
            n.innerHTML = svg
            continue
          }
        }
        rest.push(n)
      }
      if (rest.length) {
        import('mermaid').then((m) => {
          if (!cancelled) return m.default.run({ nodes: rest.filter(n => n.isConnected) }).catch(() => undefined)
        })
      }
    }
    if (html.hasRemoteDiagram) renderRemoteDiagramsIn(el)
    return () => { cancelled = true }
  }, [html, diagramDark])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // 引用角标悬浮来源卡片；提供 onOpenCite 时点击角标直接打开来源文件
    return attachCiteHover(
      el,
      (num) => html.citeRefs.get(num),
      reading.onOpenCite ? (_num, info) => reading.onOpenCite!(info) : undefined,
    )
  }, [html, reading.onOpenCite])

  const openLink = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-wikilink]')?.dataset.wikilink
    if (target && reading.onWikilink) { e.preventDefault(); e.stopPropagation(); reading.onWikilink(target) }
  }
  if (!html.parts.some(part => 'block' in part)) return <div ref={ref} className="rich-md" onClick={openLink} dangerouslySetInnerHTML={{ __html: html.html }} />
  return <NoteUIReadingContext.Provider value={reading}><div ref={ref} className="rich-md" onClick={openLink}>{html.parts.map((part, i) => 'block' in part ?
    <NoteUIBlock key={part.block.key} block={part.block} /> :
    <div key={`md-${i}`} className="rich-md-fragment" dangerouslySetInnerHTML={{ __html: part.html }} />,
  )}</div></NoteUIReadingContext.Provider>
}
