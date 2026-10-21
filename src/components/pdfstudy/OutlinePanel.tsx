// 左侧大纲栏：书签大纲（无书签时可由 AI 解析目录页生成），点击跳转到对应页码与位置
import { useState } from 'react'
import { useStore } from './store'
import { psApi } from './api'
import type { OutlineNode } from './types'

export default function OutlinePanel() {
  const s = useStore()
  const outline = s.outline
  const [genOpen, setGenOpen] = useState(false)
  const [pages, setPages] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  if (outline === null) {
    return (
      <div className="ps-side-empty">
        <span className="ps-spinner" />
        <p>正在解析大纲…</p>
      </div>
    )
  }

  /** AI 生成：把目录页码范围交给服务端，LLM 解析 + 页码偏移校准 */
  async function generate() {
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      const r = await psApi.generateOutline(s.docPath, pages.trim())
      s.reloadOutline()
      s.toast(`已生成 ${r.count} 条大纲（页码偏移 ${r.offset >= 0 ? '+' : ''}${r.offset}）`)
      setGenOpen(false)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function clearAiOutline() {
    await psApi.clearOutline(s.docPath).catch(() => undefined)
    s.reloadOutline()
  }

  const genDialog = genOpen && (
    <div className="ps-gen-mask" onClick={() => !busy && setGenOpen(false)}>
      <div className="ps-gen-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="ps-gen-title">
          <span className="material-symbols-rounded">auto_awesome</span>
          AI 生成大纲
        </div>
        <p className="ps-gen-hint">
          先翻到本文档的<strong>目录页</strong>，然后填入目录所在的页码范围（如 <code>3-5</code>，多段用逗号分隔如{' '}
          <code>3-4,6</code>）。AI 会解析目录标题与页码，并自动校准正文页码偏移。
        </p>
        <input
          autoFocus
          value={pages}
          placeholder="目录页码范围，如 3-5"
          onChange={(e) => setPages(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void generate()
          }}
        />
        {err && <div className="ps-gen-err">{err}</div>}
        <div className="ps-gen-actions">
          <button disabled={busy} onClick={() => setGenOpen(false)}>
            取消
          </button>
          <button className="primary" disabled={busy || !pages.trim()} onClick={() => void generate()}>
            {busy ? (
              <>
                <span className="ps-spinner" style={{ width: 13, height: 13 }} /> 解析中…
              </>
            ) : (
              '生成'
            )}
          </button>
        </div>
      </div>
    </div>
  )

  if (!outline.length) {
    return (
      <div className="ps-side-empty">
        <span className="material-symbols-rounded">menu_book</span>
        <p>本文档没有书签大纲</p>
        <button className="ps-gen-btn" onClick={() => setGenOpen(true)}>
          <span className="material-symbols-rounded">auto_awesome</span>
          AI 生成大纲
        </button>
        {genDialog}
      </div>
    )
  }

  return (
    <div className="ps-outline-list">
      {outline.map((node, i) => (
        <OutlineItem key={i} node={node} level={0} />
      ))}
      {s.outlineMeta?.source === 'ai' && (
        <div className="ps-ol-ai-foot">
          <span>AI 生成 · 偏移 {s.outlineMeta.offset >= 0 ? '+' : ''}{s.outlineMeta.offset}</span>
          <button
            title="重新生成"
            onClick={() => {
              setPages(s.outlineMeta?.pages?.join('-') ?? '')
              setGenOpen(true)
            }}
          >
            <span className="material-symbols-rounded">refresh</span>
          </button>
          <button title="清除生成的大纲" onClick={() => void clearAiOutline()}>
            <span className="material-symbols-rounded">delete</span>
          </button>
        </div>
      )}
      {genDialog}
    </div>
  )
}

function OutlineItem({ node, level }: { node: OutlineNode; level: number }) {
  const s = useStore()
  const hasKids = node.children.length > 0
  // 默认展开前两级，更深的折叠
  const [open, setOpen] = useState(level < 1)

  const jump = () => {
    if (!node.page) return
    s.jumpTo(node.page, { y: node.yInPage ?? undefined })
  }

  return (
    <div className="ps-ol-branch">
      <div
        className={`ps-ol-item${node.page ? '' : ' disabled'}${level === 0 ? ' top' : ''}`}
        style={{ paddingLeft: 6 + level * 13 }}
        onClick={jump}
        title={node.page ? `第 ${node.page} 页` : '无跳转目标'}
      >
        {hasKids ? (
          <button
            className="ps-ol-caret"
            onClick={(e) => {
              e.stopPropagation()
              setOpen(!open)
            }}
          >
            <span className="material-symbols-rounded">{open ? 'keyboard_arrow_down' : 'keyboard_arrow_right'}</span>
          </button>
        ) : (
          <span className="ps-ol-dot" />
        )}
        <span className="ps-ol-title">{node.title}</span>
        {node.page ? <span className="ps-ol-page">{node.page}</span> : null}
      </div>
      {hasKids && open && (
        <div className="ps-ol-children">
          {node.children.map((child, i) => (
            <OutlineItem key={i} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  )
}
