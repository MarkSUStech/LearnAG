import { useEffect, useRef } from 'react'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx, editorViewOptionsCtx } from '@milkdown/kit/core'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { replaceAll, $prose } from '@milkdown/kit/utils'
import { codeBlockNodeView } from './mermaidNodeView'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'

// [[wikilink]] 高亮装饰 + Obsidian callout（> [!type]）块级装饰
// 均不改动文档内容，只加样式；保存时仍是原文
const contentDecorations = $prose(
  () =>
    new Plugin({
      key: new PluginKey('learnagent-decorations'),
      props: {
        decorations(state) {
          const decos: Decoration[] = []
          state.doc.descendants((node, pos) => {
            if (node.isText && node.text) {
              const re = /\[\[([^\[\]\n]{1,80})\]\]/g
              let m: RegExpExecArray | null
              while ((m = re.exec(node.text))) {
                decos.push(
                  Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
                    class: 'wikilink',
                  }),
                )
              }
            }
            // callout：引用块首行以 [!type] 开头 → 块级样式 + 隐藏标记
            if (node.type.name === 'blockquote') {
              const m = /^\s*\[!(\w+)\]/.exec(node.textContent)
              if (m) {
                const type = m[1].toLowerCase()
                decos.push(Decoration.node(pos, pos + node.nodeSize, { class: `callout callout-${type}` }))
                node.descendants((child, childPos) => {
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
          return DecorationSet.create(state.doc, decos)
        },
      },
    }),
)

interface Props {
  /** 正文（不含 frontmatter） */
  value: string
  dark: boolean
  onChange: (md: string) => void
  /** 点击 [[wikilink]] 时回调（传入链接标题） */
  onWikilink?: (title: string) => void
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
export default function MilkdownEditor({ value, dark, onChange, onWikilink, readonly, notePath, autoFixBlocked }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const crepeRef = useRef<Crepe | null>(null)
  const viewRef = useRef<any>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onWikilinkRef = useRef(onWikilink)
  onWikilinkRef.current = onWikilink
  const autoFixBlockedRef = useRef(autoFixBlocked)
  autoFixBlockedRef.current = autoFixBlocked
  const lastPushed = useRef(value) // 最近一次由本组件上报的内容
  const applyingExternal = useRef(false)

  // 创建编辑器（一次）
  useEffect(() => {
    let disposed = false
    const host = hostRef.current
    if (!host) return

    const crepe = new Crepe({
      root: host,
      defaultValue: value,
      // 保留 CodeMirror（LaTeX 功能依赖它）；code_block 的渲染由下方 nodeView 覆盖：
      // mermaid 语言块渲染图表，其余语言回退为普通代码块
    })
    crepeRef.current = crepe

    crepe.editor.config((ctx) => {
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        nodeViews: {
          ...prev.nodeViews,
          code_block: codeBlockNodeView({
            isDark: () => document.documentElement.dataset.theme === 'dark',
            notePath: notePath,
            autoFixBlocked: () => autoFixBlockedRef.current?.() ?? false,
          }),
        },
      }))
    })
    crepe.editor.use(contentDecorations)

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        if (applyingExternal.current) return
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
        }
      })
      .catch((e) => {
        console.error('[milkdown] 初始化失败', e)
        window.dispatchEvent(new ErrorEvent('error', { error: e, message: String(e) }))
      })

    return () => {
      disposed = true
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
