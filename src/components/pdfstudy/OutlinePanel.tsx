// 左侧大纲栏：解析自 PDF 书签，点击跳转到对应页码与位置
import { useState } from 'react'
import { useStore } from './store'
import type { OutlineNode } from './types'

export default function OutlinePanel() {
  const s = useStore()
  const outline = s.outline

  if (outline === null) {
    return (
      <div className="ps-side-empty">
        <span className="ps-spinner" />
        <p>正在解析大纲…</p>
      </div>
    )
  }
  if (!outline.length) {
    return (
      <div className="ps-side-empty">
        <span className="material-symbols-rounded">menu_book</span>
        <p>本文档没有书签大纲</p>
      </div>
    )
  }

  return (
    <div className="ps-outline-list">
      {outline.map((node, i) => (
        <OutlineItem key={i} node={node} level={0} />
      ))}
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
