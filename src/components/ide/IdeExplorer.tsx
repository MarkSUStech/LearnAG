// IDE 资源管理器：全类型文件树 + 右键菜单（新建/重命名/删除，走应用内对话框）+ 打开高亮
import { useEffect, useState } from 'react'
import type { TreeNode } from '../../types'
import type { DialogSpec } from '../PromptDialog'
import { fileIcon } from './fileIcons'

interface Props {
  tree: TreeNode[]
  activePath: string | null
  onOpenFile: (path: string) => void
  onCreate: (dir: string | null, kind: 'file' | 'folder', name: string) => void
  onDelete: (path: string) => void
  onRename: (from: string, newName: string) => void
  /** 打开应用内对话框（替代浏览器 prompt/confirm） */
  openDialog: (spec: DialogSpec) => void
}

interface MenuState {
  x: number
  y: number
  node: TreeNode | null // null = 空白处（对根目录操作）
}

export default function IdeExplorer({ tree, activePath, onOpenFile, onCreate, onDelete, onRename, openDialog }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [menu, setMenu] = useState<MenuState | null>(null)

  // 打开文件时自动展开其祖先目录
  useEffect(() => {
    if (!activePath) return
    const segs = activePath.split('/')
    setExpanded((e) => {
      let next = e
      for (let i = 1; i < segs.length; i++) {
        const dir = segs.slice(0, i).join('/')
        if (!next[dir]) {
          if (next === e) next = { ...e }
          next[dir] = true
        }
      }
      return next
    })
  }, [activePath])

  // 点击其他位置 / 滚动缩放时关闭右键菜单
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  const toggle = (dir: string) => setExpanded((e) => ({ ...e, [dir]: !e[dir] }))

  function dirOf(node: TreeNode | null): string | null {
    if (!node) return null
    if (node.type === 'folder') return node.path
    const i = node.path.lastIndexOf('/')
    return i > 0 ? node.path.slice(0, i) : null
  }

  return (
    <div
      className="ide-explorer"
      onContextMenu={(e) => {
        // 空白处右键 → 对根目录操作
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, node: null })
      }}
    >
      {tree.length === 0 ? (
        <div className="ide-explorer-empty">工作区是空的</div>
      ) : (
        tree.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            depth={0}
            expanded={expanded}
            activePath={activePath}
            onToggle={toggle}
            onOpenFile={onOpenFile}
            onMenu={setMenu}
          />
        ))
      )}
      {menu && (
        <div className="ide-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => {
              const dir = dirOf(menu.node)
              openDialog({
                title: dir ? `在「${dir}」下新建文件` : '新建文件',
                placeholder: '文件名（可含扩展名）',
                okText: '创建',
                onOk: (name) => onCreate(dir, 'file', name),
              })
              setMenu(null)
            }}
          >
            <span className="material-symbols-rounded">note_add</span>
            新建文件
          </button>
          <button
            onClick={() => {
              const dir = dirOf(menu.node)
              openDialog({
                title: dir ? `在「${dir}」下新建文件夹` : '新建文件夹',
                placeholder: '文件夹名称',
                okText: '创建',
                onOk: (name) => onCreate(dir, 'folder', name),
              })
              setMenu(null)
            }}
          >
            <span className="material-symbols-rounded">create_new_folder</span>
            新建文件夹
          </button>
          {menu.node && (
            <>
              <button
                onClick={() => {
                  const node = menu.node!
                  openDialog({
                    title: `重命名「${node.name}」`,
                    initial: node.name,
                    okText: '重命名',
                    onOk: (name) => {
                      if (name !== node.name) {
                        const i = node.path.lastIndexOf('/')
                        const dir = i > 0 ? node.path.slice(0, i + 1) : ''
                        onRename(node.path, dir + name)
                      }
                    },
                  })
                  setMenu(null)
                }}
              >
                <span className="material-symbols-rounded">edit</span>
                重命名
              </button>
              <button
                className="danger"
                onClick={() => {
                  const node = menu.node!
                  openDialog({
                    kind: 'confirm',
                    title: `删除「${node.path}」？`,
                    okText: '删除',
                    danger: true,
                    onOk: () => onDelete(node.path),
                  })
                  setMenu(null)
                }}
              >
                <span className="material-symbols-rounded">delete</span>
                删除
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function TreeItem({
  node,
  depth,
  expanded,
  activePath,
  onToggle,
  onOpenFile,
  onMenu,
}: {
  node: TreeNode
  depth: number
  expanded: Record<string, boolean>
  activePath: string | null
  onToggle: (dir: string) => void
  onOpenFile: (path: string) => void
  onMenu: (m: MenuState) => void
}) {
  const isFolder = node.type === 'folder'
  const open = isFolder && expanded[node.path]
  const active = !isFolder && activePath === node.path
  const ic = isFolder ? null : fileIcon(node.path)
  return (
    <>
      <div
        className={`ide-tree-item ${active ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => (isFolder ? onToggle(node.path) : onOpenFile(node.path))}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onMenu({ x: e.clientX, y: e.clientY, node })
        }}
        title={node.path}
      >
        {isFolder ? (
          <span className={`material-symbols-rounded ide-caret ${open ? 'open' : ''}`}>chevron_right</span>
        ) : (
          <span className="ide-tree-indent" />
        )}
        {isFolder ? (
          <span className="material-symbols-rounded ide-tree-icon folder">{open ? 'folder_open' : 'folder'}</span>
        ) : (
          ic && (
            <span className="material-symbols-rounded ide-tree-icon" style={{ color: ic.color }}>
              {ic.icon}
            </span>
          )
        )}
        <span className="ide-tree-name">{node.name}</span>
      </div>
      {isFolder && open && node.children && (
        <>
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              activePath={activePath}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
              onMenu={onMenu}
            />
          ))}
        </>
      )}
    </>
  )
}
