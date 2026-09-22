import { useEffect, useRef } from 'react'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx, editorViewOptionsCtx } from '@milkdown/kit/core'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { replaceAll, $prose } from '@milkdown/kit/utils'
import { codeBlockNodeView, mathInlineNodeView } from './mermaidNodeView'
import { attachCiteHover, parseCiteDefs } from '../../cite'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'

// [[wikilink]] 高亮装饰 + Obsidian callout（> [!type]）块级装饰
// 均不改动文档内容，只加样式；保存时仍是原文
// 性能：文本节点不可变，扫描结果按节点 WeakMap 缓存——每次按键只重新扫描
// 被编辑的那个节点，其余节点直接复用；角标 widget 用节点内偏移做稳定 key，
// 避免光标前后打字导致 widget DOM 反复重建（大笔记卡顿的主因之一）。
const textScanCache = new WeakMap<any, { wl: Array<[number, number]>; cite: Array<{ num: string; idx: number }> }>()

function scanTextNode(node: any) {
  let c = textScanCache.get(node)
  if (!c) {
    c = { wl: [], cite: [] }
    const re = /\[\[([^\[\]\n]{1,80})\]\]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(node.text))) c.wl.push([m.index, m[0].length])
    const reCite = /\[\^(\d{1,3})\]/g
    while ((m = reCite.exec(node.text))) c.cite.push({ num: m[1], idx: m.index })
    textScanCache.set(node, c)
  }
  return c
}

function buildDecorations(doc: any): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node: any, pos: number) => {
    if (node.isText && node.text) {
      const c = scanTextNode(node)
      for (const [idx, len] of c.wl) {
        decos.push(Decoration.inline(pos + idx, pos + idx + len, { class: 'wikilink' }))
      }
      // 资料引用角标：[^n] 隐藏原文，替换为可悬停的编号徽章（文档文本不变）
      for (const { num, idx } of c.cite) {
        const from = pos + idx
        decos.push(Decoration.inline(from, from + num.length + 3, { class: 'cite-mark' }))
        decos.push(
          Decoration.widget(
            from,
            () => {
              const sup = document.createElement('sup')
              sup.className = 'cite-badge'
              sup.dataset.ref = num
              sup.textContent = num
              return sup
            },
            { side: -1, key: 'cite-' + num + '-' + idx },
          ),
        )
      }
      return
    }
    // callout：引用块首行以 [!type] 开头 → 块级样式 + 隐藏标记
    if (node.type.name === 'blockquote') {
      const m = /^\s*\[!(\w+)\]/.exec(node.textContent)
      if (m) {
        const type = m[1].toLowerCase()
        decos.push(Decoration.node(pos, pos + node.nodeSize, { class: `callout callout-${type}` }))
        node.descendants((child: any, childPos: number) => {
          if (!child.isText || !child.text) return
          const mm = /^\s*\[!\w+\]\s*/.exec(child.text)
          if (mm) {
            decos.push(
              Decoration.inline(pos + 1 + childPos + mm.index, pos + 1 + childPos + mm.index + mm[0].length, {
                class: 'callout-marker',
              }),
            )
          }
        })
      }
    }
  })
  return DecorationSet.create(doc, decos)
}

const contentDecorationsKey = new PluginKey<DecorationSet>('learnagent-decorations')
const contentDecorations = $prose(
  () =>
    new Plugin({
      key: contentDecorationsKey,
      state: {
        init: (_: unknown, state: any) => buildDecorations(state.doc),
        apply: (tr: any, old: DecorationSet) => (tr.docChanged ? buildDecorations(tr.doc) : old.map(tr.mapping, tr.doc)),
      },
      props: {
        decorations: (state: any) => contentDecorationsKey.getState(state),
      },
    }),
)

// 伪 LaTeX 自愈：网页剪藏或误点「加 LaTex」会把 ASCII 流程图等纯文本块标记为
// latex/tex，被 KaTeX 渲染成乱码。特征：块内容含中文或箭头/连线制表字符 → 改回 text。
// 真正的 LaTeX 数学（无中文、无制表符）不受影响。导出供 IdeMarkdown 等外部路径复用。
const PSEUDO_TEX_RE = /```(latex|tex)\r?\n([\s\S]*?)```/g
const PSEUDO_TEX_FEATURE = /[\u4e00-\u9fff]|─|→|←|►|◄|══|──/
export function fixPseudoTex(md: string): string {
  return md.replace(PSEUDO_TEX_RE, (m, _lang: string, body: string) =>
    PSEUDO_TEX_FEATURE.test(body) ? '```text\n' + body + '```' : m,
  )
}

interface Props {
  /** 正文（不含 frontmatter） */
  value: string
  dark: boolean
  onChange: (md: string) => void
  /** 点击 [[wikilink]] 时回调（传入链接标题） */
  onWikilink?: (title: string) => void
  /** 点击引用角标时回调（打开来源文件）；工作台等含脚注引用的笔记用 */
  onOpenCite?: (info: import('../../cite').CiteInfo) => void
  /** 只读模式（资料预览等） */
  readonly?: boolean
  /** 所属笔记路径：提供后 mermaid 渲染失败会自动触发 AI 修复 */
  notePath?: string
  /** 返回 true 时暂停 mermaid 自动修复（如 agent 正在流式写入） */
  autoFixBlocked?: () => boolean
}

/**
 * Milkdown Crepe 编辑器封装。
 * - value 变化（外部写入，如 agent 流式输出）→ replaceAll 打字机式刷新
 * - 用户编辑 → onChange 回调（去抖由父层处理）
 * - 点击 [[wikilink]] → onWikilink
 */
export default function MilkdownEditor({ value, dark, onChange, onWikilink, onOpenCite, readonly, notePath, autoFixBlocked }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const crepeRef = useRef<Crepe | null>(null)
  const viewRef = useRef<any>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onWikilinkRef = useRef(onWikilink)
  onWikilinkRef.current = onWikilink
  const onOpenCiteRef = useRef(onOpenCite)
  onOpenCiteRef.current = onOpenCite
  const autoFixBlockedRef = useRef(autoFixBlocked)
  autoFixBlockedRef.current = autoFixBlocked
  const lastPushed = useRef(value) // 最近一次由本组件上报的内容
  const applyingExternal = useRef(false)
  const disposeCiteHover = useRef<(() => void) | null>(null)
  const valueRef = useRef(value)
  valueRef.current = value

  // 创建编辑器（一次）
  useEffect(() => {
    let disposed = false
    const host = hostRef.current
    if (!host) return

    // 加载前先做伪 LaTeX 自愈（剪藏误标的 latex 块）
    const initialValue = fixPseudoTex(value)
    const crepe = new Crepe({
      root: host,
      defaultValue: initialValue,
      // 保留 CodeMirror（LaTeX 功能依赖它）；code_block 的渲染由下方 nodeView 覆盖：
      // mermaid 语言块渲染图表，其余语言回退为普通代码块
    })
    crepeRef.current = crepe
    if (initialValue !== value && !readonly) {
      // 修正后的内容回传父层保存（仅可编辑模式）
      setTimeout(() => onChangeRef.current?.(initialValue), 500)
    }
    lastPushed.current = initialValue

    crepe.editor.config((ctx) => {
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        // 大文档（10 万字符级）的中文拼写检查会让首次输入卡顿数秒，直接关闭
        attributes: { ...(prev.attributes ?? {}), spellcheck: 'false', 'data-gramm': 'false' },
        nodeViews: {
          ...prev.nodeViews,
          code_block: codeBlockNodeView({
            isDark: () => document.documentElement.dataset.theme === 'dark',
            notePath: notePath,
            autoFixBlocked: () => autoFixBlockedRef.current?.() ?? false,
          }),
          math_inline: mathInlineNodeView(),
        },
      }))
    })
    crepe.editor.use(contentDecorations)

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        if (applyingExternal.current) return
        // 伪 LaTeX 自愈：误点「加 LaTex」后立即把 ASCII 图等纯文本块改回 text
        const fixed = fixPseudoTex(markdown)
        if (fixed !== markdown) {
          applyingExternal.current = true
          try {
            crepe.editor.action(replaceAll(fixed))
          } finally {
            setTimeout(() => {
              applyingExternal.current = false
            }, 0)
          }
          lastPushed.current = fixed
          onChangeRef.current(fixed)
          return
        }
        lastPushed.current = markdown
        onChangeRef.current(markdown)
      })
    })

    crepe
      .create()
      .then(() => {
        if (disposed) {
          void crepe.destroy()
          return
        }
        if (readonly) crepe.setReadonly(true)
        // 取出 ProseMirror view，用于 [[wikilink]] 点击检测
        try {
          crepe.editor.action((ctx) => {
            viewRef.current = ctx.get(editorViewCtx)
          })
        } catch (err) {
          console.error('[milkdown] 获取 editorView 失败', err)
        }
        const host = hostRef.current
        if (host) {
          host.addEventListener('click', (e: MouseEvent) => {
            if (e.button !== 0) return
            // 装饰插件会把 [[...]] 包在 span.wikilink 里，直接从点击目标取标题
            const wl = (e.target as HTMLElement)?.closest?.('.wikilink') as HTMLElement | null
            if (!wl) return
            const m = /^\[\[([^\[\]\n]+)\]\]$/.exec(wl.textContent ?? '')
            if (m?.[1]) onWikilinkRef.current?.(m[1].trim())
          })
          // 引用角标悬浮来源卡片：从 value prop（原始 markdown）解析 [^n]: 定义
          disposeCiteHover.current = attachCiteHover(
            host,
            (num) => parseCiteDefs(valueRef.current).get(num),
            onOpenCiteRef.current ? (_num, info) => onOpenCiteRef.current?.(info) : undefined,
          )
        }
      })
      .catch((e) => {
        console.error('[milkdown] 初始化失败', e)
        window.dispatchEvent(new ErrorEvent('error', { error: e, message: String(e) }))
      })

    return () => {
      disposed = true
      disposeCiteHover.current?.()
      disposeCiteHover.current = null
      crepeRef.current = null
      void crepe.destroy().catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 外部内容变化 → 写入编辑器（replaceAll）
  useEffect(() => {
    const crepe = crepeRef.current
    if (!crepe) return
    if (value === lastPushed.current) return
    lastPushed.current = value
    applyingExternal.current = true
    try {
      crepe.editor.action(replaceAll(value))
    } finally {
      setTimeout(() => {
        applyingExternal.current = false
      }, 0)
    }
  }, [value])

  return (
    <div className="milkdown-editor-host" data-theme={dark ? 'dark' : 'light'}>
      <div ref={hostRef} className="milkdown-root" />
    </div>
  )
}
