import { useEffect, useMemo, useState } from 'react'
import MilkdownEditor from './editor/MilkdownEditor'
import type { TreeNode } from '../types'

interface Props {
  tree: TreeNode[]
  dark: boolean
  onOpenNote: (path: string) => void
}

/** 从文件树中摘出 资料/ 子树（旧版结构） */
function findFolder(nodes: TreeNode[], name: string): TreeNode | null {
  for (const n of nodes) {
    if (n.type === 'folder' && n.path === name) return n
    if (n.children) {
      const hit = findFolder(n.children, name)
      if (hit) return hit
    }
  }
  return null
}

function flatten(nodes: TreeNode[], out: { path: string; name: string }[] = []) {
  for (const n of nodes) {
    if (n.type === 'file') out.push({ path: n.path, name: n.name })
    if (n.children) flatten(n.children, out)
  }
  return out
}

/** 资料文件 = reference/ 分区（新规范）或 资料/ 根（旧规范）下的文件 */
function isReferenceFile(path: string) {
  return path.startsWith('资料/') || path.includes('/reference/')
}

function kindOf(name: string): 'md' | 'pdf' | 'image' | 'text' | 'other' {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (ext === 'pdf') return 'pdf'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image'
  if (['txt', 'json', 'csv', 'log', 'yml', 'yaml', 'py', 'js', 'ts', 'java', 'c', 'cpp', 'go', 'rs', 'html', 'css', 'sh'].includes(ext)) return 'text'
  return 'other'
}

/** 资料预览器：浏览所有主题的 reference/ 资料分区（兼容旧版 资料/ 目录） */
export default function ReferenceBrowser({ tree, dark, onOpenNote }: Props) {
  const files = useMemo(() => flatten(tree).filter((f) => isReferenceFile(f.path)), [tree])
  const [selected, setSelected] = useState<string | null>(null)
  const [mdContent, setMdContent] = useState<string | null>(null)
  const [textContent, setTextContent] = useState<string | null>(null)

  useEffect(() => {
    if (!selected || kindOf(selected) !== 'md') {
      setMdContent(null)
      return
    }
    let alive = true
    fetch(`/api/file?path=${encodeURIComponent(selected)}`)
      .then((r) => r.json())
      .then((j) => {
        if (alive && j.content !== undefined) setMdContent(j.content)
      })
      .catch(() => alive && setMdContent(null))
    return () => {
      alive = false
    }
  }, [selected, tree])

  useEffect(() => {
    if (!selected || kindOf(selected) !== 'text') {
      setTextContent(null)
      return
    }
    let alive = true
    fetch(`/api/file?path=${encodeURIComponent(selected)}`)
      .then((r) => r.json())
      .then((j) => {
        if (alive && j.content !== undefined) setTextContent(j.content)
      })
      .catch(() => alive && setTextContent(null))
    return () => {
      alive = false
    }
  }, [selected, tree])

  const kind = selected ? kindOf(selected) : null

  return (
    <div className="refs-page">
      <div className="refs-tree">
        {files.length === 0 ? (
          <div className="tree-empty">
            还没有任何资料。agent 检索的资料存在各主题的 reference/ 分区里，你也可以把 md/txt/代码/PDF 文件直接放进去。
          </div>
        ) : (
          files.map((f) => (
            <div
              key={f.path}
              className={`tree-item ${selected === f.path ? 'active' : ''}`}
              onClick={() => setSelected(f.path)}
              title={f.path}
            >
              <span className="material-symbols-rounded">{kindIcon(kindOf(f.name))}</span>
              <span className="name">{f.name}</span>
            </div>
          ))
        )}
      </div>
      <div className="refs-preview">
        {!selected && <div className="empty-state">从左侧选择一个资料文件预览</div>}
        {kind === 'md' && mdContent !== null && (
          <div className="refs-md">
            <MilkdownEditor value={mdContent} dark={dark} onChange={() => undefined} readonly />
          </div>
        )}
        {kind === 'md' && mdContent === null && <div className="empty-state">加载中…</div>}
        {kind === 'pdf' && selected && (
          <embed src={`/api/raw?path=${encodeURIComponent(selected)}`} type="application/pdf" className="refs-pdf" />
        )}
        {kind === 'image' && selected && (
          <div className="refs-image">
            <img src={`/api/raw?path=${encodeURIComponent(selected)}`} alt={selected} />
          </div>
        )}
        {kind === 'text' && textContent !== null && (
          <pre className="refs-text">{textContent}</pre>
        )}
        {kind === 'text' && textContent === null && <div className="empty-state">加载中…</div>}
        {kind === 'other' && (
          <div className="empty-state">该文件类型暂不支持预览（AI 仍可能通过 read_note 读取内容）</div>
        )}
      </div>
    </div>
  )
}

function kindIcon(k: string) {
  switch (k) {
    case 'md':
      return 'description'
    case 'pdf':
      return 'picture_as_pdf'
    case 'image':
      return 'image'
    case 'text':
      return 'code'
    default:
      return 'draft'
  }
}
