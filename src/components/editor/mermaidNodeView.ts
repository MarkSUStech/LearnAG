import type { Node as PMNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { TextSelection } from '@milkdown/kit/prose/state'
import mermaid from 'mermaid'
import katex from 'katex'
import { isBeautifulSupported, renderBeautiful } from './beautifulMermaid'

// ── mermaid 初始化 ──────────────────────────────────────────────────────────

let mermaidTheme: 'default' | 'dark' | null = null

export function ensureMermaid(dark: boolean) {
  const theme = dark ? 'dark' : 'default'
  if (mermaidTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      theme,
      securityLevel: 'strict',
      fontFamily:
        "-apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
    })
    mermaidTheme = theme
  }
}

// ── node view ───────────────────────────────────────────────────────────────

export interface CodeBlockNodeViewOptions {
  isDark: () => boolean
  /** 所属笔记路径：提供后，mermaid 渲染失败会自动上报 AI 修复 */
  notePath?: string
  /** 返回 true 时暂停自动修复（如 agent 正在流式写入该笔记） */
  autoFixBlocked?: () => boolean
}

/**
 * 空代码块的编辑兜底（自定义 nodeView 下 PM 的两个坑）：
 * 1. 点击空 contentDOM 时 PM 无法把光标放进空块（焦点落到 body/根节点）——
 *    mousedown 时显式把 selection 放进块内；
 * 2. 空块内退格：PM 默认 joinBackward 在表格等非文本块相邻时只会选中前一个节点，
 *    空块永远删不掉——document 捕获阶段拦截，把整块替换为空段落。
 * keydown 必须挂 document 捕获：焦点在 PM 根节点时事件路径不经过 nodeView 的 DOM。
 */
function bindEmptyBlockFix(
  dom: HTMLElement,
  contentDOM: HTMLElement,
  getNode: () => PMNode,
  view: EditorView,
  getPos: (() => number | undefined) | undefined,
) {
  dom.addEventListener(
    'mousedown',
    (e) => {
      const t = e.target as Node
      if (t !== contentDOM && !contentDOM.contains(t)) return
      if (getNode().textContent.trim() !== '') return
      const pos = typeof getPos === 'function' ? getPos() : undefined
      if (pos == null) return
      e.preventDefault()
      e.stopPropagation()
      const st = view.state
      view.dispatch(st.tr.setSelection(TextSelection.create(st.doc, pos + 1)))
      view.focus()
    },
    true,
  )

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key !== 'Backspace' || e.defaultPrevented) return
    if (getNode().textContent.trim() !== '') return
    const st = view.state
    if (!st.selection.empty) return
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (pos == null) return
    if (st.selection.from !== pos + 1) return // 光标必须在该空块的内容起点
    e.preventDefault()
    e.stopPropagation()
    view.dispatch(st.tr.replaceWith(pos, pos + getNode().nodeSize, st.schema.nodes.paragraph.create()))
    view.focus()
  }
  document.addEventListener('keydown', onKeydown, true)
  return () => document.removeEventListener('keydown', onKeydown, true)
}

/**
 * code_block 的自定义 nodeView（覆盖 CodeMirror 默认渲染）：
 * - 语言 mermaid → 渲染 Mermaid 图表，可点击切换源码编辑
 * - 语言 latex（Crepe 把 $$..$$ 块转换为 LaTeX 代码块）→ katex 渲染，可点击切换源码编辑
 * - 其他语言 → 普通 pre/code 块
 */
export function codeBlockNodeView({ isDark, notePath, autoFixBlocked }: CodeBlockNodeViewOptions) {
  return (node: PMNode, view: EditorView, getPos: (() => number | undefined) | undefined) => {
    const lang = String(node.attrs.language ?? '').toLowerCase()
    let current = node

    // gnuplot / d2：服务端渲染（/api/render），UI 与 mermaid 图表一致
    if (lang === 'gnuplot' || lang === 'd2') {
      const dom = document.createElement('div')
      dom.className = 'mermaid-block'
      dom.dataset.lang = lang

      const bar = document.createElement('div')
      bar.className = 'mermaid-bar'
      const langTag = document.createElement('span')
      langTag.className = 'lang'
      langTag.innerHTML =
        lang === 'gnuplot'
          ? '<span class="material-symbols-rounded">monitoring</span>gnuplot'
          : '<span class="material-symbols-rounded">account_tree</span>d2'
      const copyBtn = document.createElement('button')
      copyBtn.type = 'button'
      copyBtn.textContent = '复制代码'
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(current.textContent).then(() => {
          copyBtn.textContent = '已复制'
          setTimeout(() => {
            copyBtn.textContent = '复制代码'
          }, 1200)
        })
      })
      bar.append(langTag, copyBtn)

      const diagram = document.createElement('div')
      diagram.className = 'mermaid-diagram'

      const contentDOM = document.createElement('pre')
      contentDOM.className = 'mermaid-src'

      dom.append(bar, diagram, contentDOM)
      const disposeEmptyFix = bindEmptyBlockFix(dom, contentDOM, () => current, view, getPos)

      let renderToken = 0
      let lastRendered: string | null = null

      async function renderRemote() {
        const my = ++renderToken
        const code = current.textContent
        lastRendered = code
        diagram.classList.add('loading')
        try {
          const res = await fetch('/api/render', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lang, code }),
          })
          const json = await res.json()
          if (my !== renderToken) return
          if (!res.ok || !json.svg) throw new Error(json.error || '渲染失败')
          diagram.classList.remove('error')
          diagram.innerHTML = json.svg
        } catch (e) {
          if (my !== renderToken) return
          diagram.classList.add('error')
          const msg = e instanceof Error ? e.message : String(e)
          diagram.textContent = lang + ' 渲染失败：\n' + msg.slice(0, 300)
        } finally {
          if (my === renderToken) diagram.classList.remove('loading')
        }
      }

      void renderRemote() // 初始渲染

      return {
        dom,
        contentDOM,
        update(updated: PMNode) {
          if (updated.type.name !== 'code_block') return false
          if (String(updated.attrs.language ?? '').toLowerCase() !== lang) return false
          const changed = updated.textContent !== current.textContent
          current = updated
          if (changed) void renderRemote()
          return true
        },
        ignoreMutation(m: { target: Node }) {
          // 图表 DOM 程序化更新忽略，避免 PM 把 SVG 插入当作文档变更触发死循环
          return !contentDOM.contains(m.target)
        },
        stopEvent() {
          return false
        },
        destroy() {
          disposeEmptyFix()
        },
      }
    }

    const isMermaid = lang === 'mermaid'
    const dom = document.createElement('div')
    dom.className = 'mermaid-block'
    dom.dataset.lang = lang

    const bar = document.createElement('div')
    bar.className = 'mermaid-bar'
    const langTag = document.createElement('span')
    langTag.className = 'lang'
    langTag.innerHTML = isMermaid
      ? '<span class="material-symbols-rounded">deployed_code</span>mermaid'
      : '<span class="material-symbols-rounded">function</span>LaTeX'
    const toggleBtn = document.createElement('button')
    toggleBtn.type = 'button'
    toggleBtn.textContent = '编辑源码'
    const copyBtn = document.createElement('button')
    copyBtn.type = 'button'
    copyBtn.textContent = '复制代码'
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(current.textContent).then(() => {
        copyBtn.textContent = '已复制'
        setTimeout(() => {
          copyBtn.textContent = '复制代码'
        }, 1200)
      })
    })
    bar.append(langTag, toggleBtn, copyBtn)

    const diagram = document.createElement('div')
    diagram.className = 'mermaid-diagram'

    const contentDOM = document.createElement('pre')
    contentDOM.className = 'mermaid-src'

    dom.append(bar, diagram, contentDOM)
    const disposeEmptyFix = bindEmptyBlockFix(dom, contentDOM, () => current, view, getPos)
    let renderToken = 0
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let lastRendered: string | null = null
    let fixTimer: ReturnType<typeof setTimeout> | null = null

    // mermaid 渲染失败 → 防抖上报 AI 自动修复（只修这一段代码块）；期间任何新渲染都会撤销旧上报
    function scheduleAutoFix(badCode: string, errorMessage: string) {
      if (!notePath) return
      if (fixTimer) clearTimeout(fixTimer)
      fixTimer = setTimeout(() => {
        fixTimer = null
        if (autoFixBlocked?.()) return
        void fetch('/api/mermaid-fix', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: notePath, code: badCode, error: errorMessage }),
        }).catch(() => undefined)
      }, 1500)
    }

    function scheduleRender(immediate = false) {
      const code = current.textContent
      if (code === lastRendered && diagram.childElementCount > 0 && !diagram.classList.contains('error')) {
        return
      }
      if (debounceTimer) clearTimeout(debounceTimer)
      if (immediate) {
        void render()
      } else {
        debounceTimer = setTimeout(() => void render(), 500)
      }
    }

    /** beautiful-mermaid 对非法语法可能"成功"渲染出空 SVG（viewBox 0 0 0 0）——视为失败 */
    function isBlankSvg(svg: string): boolean {
      const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)
      if (m && parseFloat(m[1]) * parseFloat(m[2]) === 0) return true
      const visible = svg.replace(/<defs[\s\S]*?<\/defs>/g, '')
      return !/<(text|path|rect|circle|polygon|polyline|line|ellipse)\b/.test(visible)
    }

    async function render() {
      const my = ++renderToken
      const code = current.textContent
      lastRendered = code
      // 新渲染开始：撤销尚未发出的修复上报（内容仍在变化中）
      if (fixTimer) {
        clearTimeout(fixTimer)
        fixTimer = null
      }
      diagram.classList.add('loading')
      try {
        if (isMermaid) {
          // flowchart/state/sequence/class 等走 beautiful-mermaid 同步渲染（更美观）
          if (isBeautifulSupported(code)) {
            const svg = renderBeautiful(code, isDark())
            if (my !== renderToken) return
            if (svg && !isBlankSvg(svg)) {
              diagram.classList.remove('error')
              diagram.innerHTML = svg
              return
            }
            // 空图 → 视为失败，落到标准 mermaid 重试
          }
          // 兜底：标准 mermaid 异步渲染（mindmap/gantt/pie/带 classDef 的图）
          ensureMermaid(isDark())
          const id = 'mmd-' + Math.random().toString(36).slice(2, 10)
          const { svg } = await mermaid.render(id, code)
          if (my !== renderToken) return
          if (isBlankSvg(svg)) {
            // 标准 mermaid 也可能不抛错但产出空图
            throw new Error('渲染结果为空图，mermaid 语法可能存在问题')
          }
          diagram.classList.remove('error')
          diagram.innerHTML = svg
        } else {
          // Crepe 把 $..$ 块转为 LaTeX 代码块；若内容明显不是数学（含 # 注释/->/引号），
          // 按代码显示而非喂给 KaTeX 产生一屏报错
          const looksLikeMath = !new RegExp('(^|\\n)\\s*#|->|"').test(code)
          if (!looksLikeMath) {
            diagram.classList.remove('error')
            diagram.innerHTML = ''
            const pre = document.createElement('pre')
            pre.className = 'latex-as-code'
            pre.textContent = code
            diagram.appendChild(pre)
            return
          }
          const holder = document.createElement('div')
          katex.render(code, holder, { displayMode: true, throwOnError: false, strict: false })
          if (my !== renderToken) return
          diagram.classList.remove('error')
          diagram.innerHTML = ''
          diagram.appendChild(holder)
        }
      } catch (e) {
        if (my !== renderToken) return
        diagram.classList.add('error')
        const msg = typeof e === 'string' ? e : ((e as Error)?.message ?? String(e))
        diagram.textContent = (isMermaid ? 'Mermaid' : 'LaTeX') + ' 渲染失败（可点击"编辑源码"修正）：\n' + msg.slice(0, 300)
        // mermaid 语法错误 → 上报 AI 只修这一段
        if (isMermaid && code.trim()) scheduleAutoFix(code, msg.slice(0, 600))
      } finally {
        if (my === renderToken) diagram.classList.remove('loading')
      }
    }

    function setEditing(on: boolean) {
      dom.classList.toggle('editing', on)
      toggleBtn.textContent = on ? '查看渲染' : '编辑源码'
    }

    diagram.addEventListener('click', () => setEditing(true))
    toggleBtn.addEventListener('click', () => {
      if (dom.classList.contains('editing')) {
        setEditing(false)
        void render()
      } else {
        setEditing(true)
      }
    })

    scheduleRender(true)

    return {
      dom,
      contentDOM,
      update(updated: PMNode) {
        if (updated.type.name !== 'code_block') return false
        const newLang = String(updated.attrs.language ?? '').toLowerCase()
        if (newLang !== lang) return false
        current = updated
        scheduleRender()
        return true
      },
      ignoreMutation(m: { target: Node }) {
        // 图表/工具栏的 DOM 是程序化更新的，忽略；contentDOM 内的真实编辑交给 PM
        return !contentDOM.contains(m.target)
      },
      stopEvent() {
        return false
      },
      destroy() {
        disposeEmptyFix()
      },
    }
  }
}
