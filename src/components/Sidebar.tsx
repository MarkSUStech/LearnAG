import { useState } from 'react'
import type { SessionMeta, TreeNode } from '../types'
import type { DialogSpec } from './PromptDialog'

interface Props {
  tree: TreeNode[]
  activePath: string | null
  onOpen: (path: string) => void
  onCreate: (parent: string | null, kind: 'file' | 'folder', name: string) => void
  onDelete: (path: string) => void
  onRename: (path: string, newName: string) => void
  onOpenDialog: (spec: DialogSpec) => void
  onOpenGraph: () => void
  onOpenRefs: () => void
  onOpenIde?: () => void
  onOpenSettings: () => void
  onToggleTheme: () => void
  dark: boolean
  vaultName: string
  graphOpen: boolean
  refsOpen: boolean
  collapsed: boolean
  sessions: SessionMeta[]
  activeSessionId: string
  onNewSession: () => void
  onSwitchSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onRenameSession: (id: string, title: string) => void
  onOpenSwitcher: () => void
  agentRunning: boolean
  width: number
  onResizeStart: (e: React.MouseEvent) => void
}

export default function Sidebar(props: Props) {
  const { tree, vaultName, collapsed, width } = props
  return (
    <aside
      className={`sidebar ${collapsed ? 'collapsed' : ''}`}
      style={{ width: collapsed ? 0 : width }}
    >
      <div className="resize-handle right" onMouseDown={props.onResizeStart} />
      <div className="side-head">
        <div className="logo">
          <span className="material-symbols-rounded">psychology</span>
          LearnAgent
        </div>
        <div className="side-actions">
          <button className="icon-btn" title="搜索笔记（Ctrl+K）" onClick={props.onOpenSwitcher}>
            <span className="material-symbols-rounded">search</span>
          </button>
          <button
            className="icon-btn"
            title="新建笔记"
            onClick={() =>
              props.onOpenDialog({ title: '新建笔记', placeholder: '笔记名称', okText: '创建', onOk: (name) => props.onCreate(null, 'file', name) })
            }
          >
            <span className="material-symbols-rounded">note_add</span>
          </button>
          <button
            className="icon-btn"
            title="新建文件夹"
            onClick={() =>
              props.onOpenDialog({ title: '新建文件夹', placeholder: '文件夹名称', okText: '创建', onOk: (name) => props.onCreate(null, 'folder', name) })
            }
          >
            <span className="material-symbols-rounded">create_new_folder</span>
          </button>
        </div>
      </div>

      <div className="sessions">
        <div className="side-section-title">
          <span>对话</span>
          <button
            className="icon-btn"
            title={props.agentRunning ? 'agent 运行中，稍后再试' : '新建会话'}
            disabled={props.agentRunning}
            onClick={props.onNewSession}
          >
            <span className="material-symbols-rounded">add</span>
          </button>
        </div>
        <div className="sessions-list">
          {props.sessions.map((s) => (
            <div
              key={s.id}
              className={`session-item ${s.id === props.activeSessionId ? 'active' : ''}`}
              onClick={() => s.id !== props.activeSessionId && !props.agentRunning && props.onSwitchSession(s.id)}
              onDoubleClick={() =>
                props.onOpenDialog({
                  title: '重命名对话',
                  initial: s.title,
                  okText: '重命名',
                  onOk: (name) => {
                    if (name.trim() && name !== s.title) props.onRenameSession(s.id, name.trim())
                  },
                })
              }
              title={`${s.title} · ${s.messageCount} 条消息（双击重命名）`}
            >
              <span className="material-symbols-rounded">chat_bubble</span>
              <span className="s-title">{s.title}</span>
              <span
                className="icon-btn s-del"
                title="删除会话（归档）"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onOpenDialog({
                    kind: 'confirm',
                    title: '删除这个对话？（记录会归档保存）',
                    okText: '删除',
                    danger: true,
                    onOk: () => props.onDeleteSession(s.id),
                  })
                }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 14 }}>
                  delete
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="tree">
        <div className="side-section-title" style={{ paddingTop: 8 }}>
          <span>文件</span>
          <span style={{ width: 28 }} />
        </div>
        {tree.length === 0 && <div className="tree-empty">知识库是空的，新建一篇笔记开始吧</div>}
        {tree.map((node) => (
          <TreeItem key={node.path} node={node} {...props} depth={0} />
        ))}
      </div>

      <div className="side-foot">
        {props.onOpenIde && (
          <button className="icon-btn" title="IDE 模式（代码编辑器）" onClick={props.onOpenIde}>
            <span className="material-symbols-rounded">code_blocks</span>
          </button>
        )}
        <button
          className={`icon-btn ${props.graphOpen ? 'active' : ''}`}
          title="知识图谱"
          onClick={props.onOpenGraph}
        >
          <span className="material-symbols-rounded">hub</span>
        </button>
        <button
          className={`icon-btn ${props.refsOpen ? 'active' : ''}`}
          title="资料预览器"
          onClick={props.onOpenRefs}
        >
          <span className="material-symbols-rounded">folder_open</span>
        </button>
        <button className="icon-btn" title={props.dark ? '切换浅色' : '切换深色'} onClick={props.onToggleTheme}>
          <span className="material-symbols-rounded">{props.dark ? 'light_mode' : 'dark_mode'}</span>
        </button>
        <button className="icon-btn" title="设置" onClick={props.onOpenSettings}>
          <span className="material-symbols-rounded">settings</span>
        </button>
        <div className="vault-name" title={vaultName}>
          {vaultName}
        </div>
      </div>
    </aside>
  )
}

function TreeItem({
  node,
  depth,
  ...props
}: {
  node: TreeNode
  depth: number
} & Omit<Props, 'tree' | 'vaultName'>) {
  const [open, setOpen] = useState(node.path === '知识图谱')
  const isFolder = node.type === 'folder'

  return (
    <div>
      <div
        className={`tree-item ${!isFolder && props.activePath === node.path ? 'active' : ''}`}
        style={{ paddingLeft: 6 }}
        onClick={() => (isFolder ? setOpen((o) => !o) : props.onOpen(node.path))}
        onContextMenu={(e) => {
          e.preventDefault()
          props.onOpenDialog({
            title: isFolder ? `重命名文件夹「${node.name}」` : `重命名「${node.name}」`,
            initial: node.name,
            okText: '重命名',
            onOk: (name) => {
              if (name !== node.name) {
                const dir = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/') + 1) : ''
                props.onRename(node.path, dir + name)
              }
            },
          })
        }}
      >
        {isFolder ? (
          <>
            <span
              className={`material-symbols-rounded caret ${open ? 'open' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                setOpen((o) => !o)
              }}
            >
              chevron_right
            </span>
            <span className="material-symbols-rounded">{open ? 'folder_open' : 'folder'}</span>
          </>
        ) : (
          <span className="material-symbols-rounded" style={{ marginLeft: 21 }}>
            {node.path.toLowerCase().endsWith('.pdf') ? 'picture_as_pdf' : 'description'}
          </span>
        )}
        <span className="name">{node.name.replace(/\.(md|pdf)$/i, '')}</span>
        <span
          className="icon-btn"
          style={{ marginLeft: 'auto', width: 22, height: 22, opacity: 0.55 }}
          title="删除"
          onClick={(e) => {
            e.stopPropagation()
            props.onOpenDialog({
              kind: 'confirm',
              title: `删除「${node.path}」？`,
              okText: '删除',
              danger: true,
              onOk: () => props.onDelete(node.path),
            })
          }}
        >
          <span className="material-symbols-rounded" style={{ fontSize: 15 }}>
            delete
          </span>
        </span>
      </div>
      {isFolder && open && node.children && node.children.length > 0 && (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeItem key={child.path} node={child} depth={depth + 1} {...props} />
          ))}
        </div>
      )}
      {isFolder && open && (node.children?.length ?? 0) === 0 && (
        <div className="tree-children">
          <div className="tree-empty" style={{ padding: '4px 6px' }}>
            （空）
          </div>
        </div>
      )}
    </div>
  )
}
