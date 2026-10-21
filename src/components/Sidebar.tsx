import { useEffect, useRef, useState } from 'react'
import type { SessionMeta, TreeNode } from '../types'
import type { DialogSpec } from './PromptDialog'
import { readLocal, writeLocal, workspaceKey } from '../workspaceState'

interface Props {
  tree: TreeNode[]
  activePath: string | null
  onOpen: (path: string) => void
  onCreate: (parent: string | null, kind: 'file' | 'folder', name: string) => void
  onCreateCode?: (parent: string | null, name: string) => void
  onCreateTeachChat?: (dir?: string) => void
  onDelete: (path: string) => void
  onRename: (path: string, newName: string) => void
  onTreeContextMenu?: (node: TreeNode, x: number, y: number) => void
  onOpenDialog: (spec: DialogSpec) => void
  onOpenGraph: () => void
  onOpenRefs: () => void
  onOpenIde?: () => void
  onOpenSettings: () => void
  onToggleTheme: () => void
  dark: boolean
  vaultName: string
  vaultScope?: string
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

/** 代码文件扩展名 → 树里显示代码图标 */
const CODE_EXT_RE = /\.(py|js|mjs|cjs|ts|tsx|jsx|java|c|h|cpp|hpp|cc|cs|go|rs|rb|php|swift|kt|sh|bat|ps1|sql|r|html?|css|scss|json|ya?ml|toml|ini|csv)$/i

/** 右键菜单状态：树里任意文件/文件夹 */
interface CtxMenu {
  x: number
  y: number
  node: TreeNode
}

export default function Sidebar(props: Props) {
  const { tree, vaultName, collapsed, width } = props
  const sidebarRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const sidebar = sidebarRef.current
    if (!sidebar) return
    if (collapsed && sidebar.contains(document.activeElement)) document.querySelector<HTMLButtonElement>('[aria-controls="workspace-navigation"]')?.focus()
    sidebar.inert = collapsed
  }, [collapsed])
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)
  return (
    <aside
      id="workspace-navigation"
      ref={sidebarRef}
      aria-label="文件与对话导航"
      aria-hidden={collapsed}
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
          <TreeItem
            key={node.path}
            node={node}
            {...props}
            onTreeContextMenu={(n, x, y) =>
              setCtxMenu({ node: n, x: Math.min(x, window.innerWidth - 190), y: Math.min(y, window.innerHeight - 230) })
            }
            depth={0}
          />
        ))}
      </div>

      <div className="side-foot">
        {props.onCreateTeachChat && (
          <button className="icon-btn" title="新建教学对话（引导学习）" onClick={() => props.onCreateTeachChat?.()}>
            <span className="material-symbols-rounded">school</span>
          </button>
        )}
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

      {/* 树右键菜单：任意文件夹都可新建笔记/教学对话/代码文件/文件夹；文件可重命名/删除 */}
      {ctxMenu && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 90 }}
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setCtxMenu(null)
            }}
          />
          <div className="tree-ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            {ctxMenu.node.type === 'folder' && (
              <>
                <button
                  onClick={() => {
                    setCtxMenu(null)
                    props.onOpenDialog({
                      title: `在「${ctxMenu.node.name}」中新建笔记`,
                      placeholder: '笔记名称',
                      okText: '创建',
                      onOk: (name) => props.onCreate(ctxMenu.node.path, 'file', name),
                    })
                  }}
                >
                  <span className="material-symbols-rounded">note_add</span>新建笔记
                </button>
                {props.onCreateTeachChat && (
                  <button
                    onClick={() => {
                      setCtxMenu(null)
                      props.onCreateTeachChat?.(ctxMenu.node.path)
                    }}
                  >
                    <span className="material-symbols-rounded">school</span>新建教学对话
                  </button>
                )}
                {props.onCreateCode && (
                  <button
                    onClick={() => {
                      setCtxMenu(null)
                      props.onOpenDialog({
                        title: `在「${ctxMenu.node.name}」中新建代码文件`,
                        placeholder: '文件名（含扩展名，如 main.py）',
                        initial: 'untitled.py',
                        okText: '创建',
                        onOk: (name) => props.onCreateCode?.(ctxMenu.node.path, name.trim()),
                      })
                    }}
                  >
                    <span className="material-symbols-rounded">code_blocks</span>新建代码文件
                  </button>
                )}
                <button
                  onClick={() => {
                    setCtxMenu(null)
                    props.onOpenDialog({
                      title: `在「${ctxMenu.node.name}」中新建文件夹`,
                      placeholder: '文件夹名称',
                      okText: '创建',
                      onOk: (name) => props.onCreate(ctxMenu.node.path, 'folder', name),
                    })
                  }}
                >
                  <span className="material-symbols-rounded">create_new_folder</span>新建文件夹
                </button>
                <div className="tcm-sep" />
              </>
            )}
            <button
              onClick={() => {
                setCtxMenu(null)
                props.onOpenDialog({
                  title: ctxMenu.node.type === 'folder' ? `重命名文件夹「${ctxMenu.node.name}」` : `重命名「${ctxMenu.node.name}」`,
                  initial: ctxMenu.node.name,
                  okText: '重命名',
                  onOk: (name) => {
                    if (name.trim() && name !== ctxMenu.node.name) {
                      const dir = ctxMenu.node.path.includes('/')
                        ? ctxMenu.node.path.slice(0, ctxMenu.node.path.lastIndexOf('/') + 1)
                        : ''
                      props.onRename(ctxMenu.node.path, dir + name.trim())
                    }
                  },
                })
              }}
            >
              <span className="material-symbols-rounded">edit</span>重命名
            </button>
            <button
              className="danger"
              onClick={() => {
                setCtxMenu(null)
                props.onOpenDialog({
                  kind: 'confirm',
                  title: `删除「${ctxMenu.node.name}」？${ctxMenu.node.type === 'folder' ? '（文件夹内容将一并删除）' : ''}`,
                  okText: '删除',
                  danger: true,
                  onOk: () => props.onDelete(ctxMenu.node.path),
                })
              }}
            >
              <span className="material-symbols-rounded">delete</span>删除
            </button>
          </div>
        </>
      )}
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
  const expansionKey = workspaceKey(props.vaultScope || '') + ':folder:' + node.path
  const [open, setOpen] = useState(() => readLocal<boolean>(expansionKey, node.path === '知识图谱' || Boolean(props.activePath?.startsWith(node.path + '/'))))
  const isFolder = node.type === 'folder'
  const toggle = () => setOpen(current => { writeLocal(expansionKey,!current); return !current })

  return (
    <div>
      <div
        className={`tree-item ${!isFolder && props.activePath === node.path ? 'active' : ''}`}
        style={{ paddingLeft: 6 }}
        onClick={() => (isFolder ? toggle() : props.onOpen(node.path))}
        onContextMenu={(e) => {
          e.preventDefault()
          props.onTreeContextMenu?.(node, e.clientX, e.clientY)
        }}
      >
        {isFolder ? (
          <>
            <span
              className={`material-symbols-rounded caret ${open ? 'open' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                toggle()
              }}
            >
              chevron_right
            </span>
            <span className="material-symbols-rounded">{open ? 'folder_open' : 'folder'}</span>
          </>
        ) : (
          <span className="material-symbols-rounded" style={{ marginLeft: 21 }}>
            {node.path.toLowerCase().endsWith('.pdf')
              ? 'picture_as_pdf'
              : node.chat
                ? 'school'
                : CODE_EXT_RE.test(node.path.toLowerCase())
                  ? 'code_blocks'
                  : 'description'}
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
