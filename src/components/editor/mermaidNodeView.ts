import type { Node as PMNode } from '@milkdown/kit/prose/model'
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
}

/**
 * code_block 的自定义 nodeView（覆盖 CodeMirror 默认渲染）：
 * - 语言 mermaid → 渲染 Mermaid 图表，可点击切换源码编辑
 * - 语言 latex（Crepe 把 $$..$$ 块转换为 LaTeX 代码块）→ katex 渲染，可点击切换源码编辑
 * - 其他语言 → 普通 pre/code 块
 */
export function codeBlockNodeView({ isDark }: CodeBlockNodeViewOptions) {
  return (node: PMNode) => {
    const lang = String(node.attrs.language ?? '').toLowerCase()
    let current = node

    if (lang !== 'mermaid' && lang !== 'latex') {
      // 普通代码块：语言标签 + 复制按钮
      const dom = document.createElement('div')
      dom.className = 'la-codeblock'
      const bar = document.createElement('div')
      bar.className = 'cb-bar'
      const langTag = document.createElement('span')
      langTag.className = 'cb-lang'
      langTag.textContent = lang || '代码'
      const copyBtn = document.createElement('button')
      copyBtn.className = 'cb-copy'
      copyBtn.type = 'button'
      copyBtn.innerHTML = '<span class="material-symbols-rounded">content_copy</span>'
      copyBtn.title = '复制代码'
      bar.append(langTag, copyBtn)
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      if (lang) code.dataset.language = lang
      pre.appendChild(code)
      dom.append(bar, pre)
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(current.textContent).then(() => {
          copyBtn.innerHTML = '<span class="material-symbols-rounded">check</span>'
          setTimeout(() => {
            copyBtn.innerHTML = '<span class="material-symbols-rounded">content_copy</span>'
          }, 1200)
        })
      })
      return {
        dom,
        contentDOM: code,
        update(updated: PMNode) {
          if (updated.type.name !== 'code_block') return false
          if (String(updated.attrs.language ?? '').toLowerCase() !== lang) return false
          current = updated
          return true
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
    let renderToken = 0
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let lastRendered: string | null = null

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

    async function render() {
      const my = ++renderToken
      const code = current.textContent
      lastRendered = code
      diagram.classList.add('loading')
      try {
        if (isMermaid) {
          // flowchart/state/sequence/class 等走 beautiful-mermaid 同步渲染（更美观）
          if (isBeautifulSupported(code)) {
            const svg = renderBeautiful(code, isDark())
            if (my !== renderToken) return
            if (svg) {
              diagram.classList.remove('error')
              diagram.innerHTML = svg
              return
            }
          }
          // 兜底：标准 mermaid 异步渲染（mindmap/gantt/pie/带 classDef 的图）
          ensureMermaid(isDark())
          const id = 'mmd-' + Math.random().toString(36).slice(2, 10)
          const { svg } = await mermaid.render(id, code)
          if (my !== renderToken) return
          diagram.classList.remove('error')
          diagram.innerHTML = svg
        } else {
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
    }
  }
}
