// IDE 模式主壳：活动栏 + 资源管理器/搜索侧栏 + 编辑器标签页 + 状态栏
// 架构参照 Eclipse Theia 的 ApplicationShell（活动栏/侧面板/主区/状态栏四区布局），
// 编辑器按扩展名分派：代码 → Monaco；md → 源码+预览分屏；pdf → 纯阅读器；图片 → 预览。
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api'
import { useSSE } from '../../sse'
import type { ToastItem, TreeNode } from '../../types'
import QuickSwitcher from '../QuickSwitcher'
import Toasts from '../Toasts'
import PromptDialog, { type DialogSpec } from '../PromptDialog'
import IdeExplorer from './IdeExplorer'
import IdeSearch from './IdeSearch'
import IdeMarkdown from './IdeMarkdown'
import IdePdf from './IdePdf'
import IdeImage from './IdeImage'
import IdeFloatPreview from './IdeFloatPreview'
import RunOutput from './RunOutput'
import { runClient, type ToolchainInfo } from './runClient'
import { closeAllLsp, initLspPlugins, lspRunningMap, setLspVaultRoot } from './lspBridge'
import type { LspPluginInfo } from '../../api'
import { fileIcon, kindOf, langLabel, monacoLangOf, runLangOf } from './fileIcons'

const CodeEditor = lazy(() => import('./CodeEditor'))

const SAVE_DEBOUNCE = 600

/** 运行器语言 → 依赖的工具链 id（与 server/run.js 对应） */
const RUN_TOOLCHAIN_IDS: Record<string, string[]> = {
  python: ['python'],
  node: ['node'],
  'node-ts': ['node'],
  c: ['gcc', 'clang'],
  cpp: ['gpp', 'clangpp'],
  java: ['java'],
  go: ['go'],
  rust: ['rustc'],
}

/** Markdown 预览形态：关 / 分屏 / 浮动窗口 */
type PreviewMode = 'off' | 'split' | 'float'

interface Props {
  dark: boolean
  onToggleTheme: () => void
  onExit: () => void
}

/** 展开文件树为可打开路径列表（排除无法预览的二进制） */
function flattenFiles(nodes: TreeNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === 'file') {
      if (kindOf(n.path) !== 'binary') out.push(n.path)
    }
    if (n.children) flattenFiles(n.children, out)
  }
  return out
}

export default function IdeShell({ dark, onToggleTheme, onExit }: Props) {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [vaultPath, setVaultPath] = useState('')
  const [tabs, setTabs] = useState<string[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [contents, setContents] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const [previews, setPreviews] = useState<Record<string, PreviewMode>>({})
  const [sideView, setSideView] = useState<'explorer' | 'search' | null>('explorer')
  const [sideWidth, setSideWidth] = useState(() => {
    const w = Number(localStorage.getItem('la-ide-side-w'))
    return w >= 180 && w <= 560 ? w : 264
  })
  const [cursor, setCursor] = useState({ line: 1, col: 1 })
  const [reveal, setReveal] = useState<{ path: string; line: number; ts: number } | null>(null)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [lspPlugins, setLspPlugins] = useState<LspPluginInfo[]>([])
  const [lspPanelOpen, setLspPanelOpen] = useState(false)
  const [dialog, setDialog] = useState<DialogSpec | null>(null)
  const [toolchains, setToolchains] = useState<ToolchainInfo[]>([])
  const [runOutput, setRunOutput] = useState('')
  const [runDesc, setRunDesc] = useState('')
  const [runRunning, setRunRunning] = useState(false)
  const [runPanelOpen, setRunPanelOpen] = useState(false)

  function toast(text: string, error = false) {
    const id = Math.random()
    setToasts((t) => [...t, { id, text, error }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500)
  }

  const refreshTree = () =>
    api
      .getTreeAll()
      .then((r) => {
        setTree(r.tree)
        setVaultPath(r.vaultPath)
        setLspVaultRoot(r.vaultPath) // LSP 的 workspace root 与文件 URI 前缀
      })
      .catch(() => undefined)

  useEffect(() => {
    refreshTree()
    void initLspPlugins().then(setLspPlugins) // 拉取语言服务器插件清单（本地，可插拔）
    runClient.fetchToolchains().then(setToolchains).catch(() => undefined) // 编译/运行工具链探测
    runClient.handlers = {
      onOut: (stream, text) =>
        setRunOutput((o) => (o + text).slice(-100_000)),
      onStarted: (desc) => {
        setRunDesc(desc)
        setRunOutput((o) => (o ? o + '\n' : '') + `── ${desc}\n`)
      },
      onExit: (code) => {
        setRunRunning(false)
        setRunOutput((o) => (o ? o + '\n' : '') + `\n[进程退出，代码 ${code}]\n`)
      },
      onError: (message) => {
        setRunRunning(false)
        setRunOutput((o) => (o ? o + '\n' : '') + `[错误] ${message}\n`)
        if (message.includes('未检测到')) {
          setLspPanelOpen(true) // 缺工具链 → 打开插件面板引导安装
          toast(message, true)
        }
      },
      onToolchains: setToolchains,
      onInstalled: (id, code) => {
        if (code === 0) toast(`工具链 ${id} 安装完成`)
        else toast(`工具链 ${id} 安装结束（代码 ${code}），如未生效请重启应用`, code !== 0)
      },
    }
    return () => {
      runClient.handlers = {}
      closeAllLsp() // 退出 IDE 模式时关闭语言服务器连接
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 面板打开时轮询各语言运行状态
  useEffect(() => {
    if (!lspPanelOpen) return
    const tick = () => {
      const running = lspRunningMap()
      setLspPlugins((ps) => ps.map((p) => ({ ...p, running: p.languages.some((l) => running[l]) })))
    }
    tick()
    const t = setInterval(tick, 1500)
    return () => clearInterval(t)
  }, [lspPanelOpen])

  // ── 打开 / 保存 ──────────────────────────────────────────────────────────
  const contentsRef = useRef(contents)
  contentsRef.current = contents
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeRef = useRef(activePath)
  activeRef.current = activePath
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const pendingSaves = useRef<Record<string, string>>({})
  const lastSavedRef = useRef<Record<string, string>>({}) // 最近一次成功写入磁盘的内容（区分自动保存回声与外部修改）

  function openFile(path: string) {
    if (kindOf(path) === 'binary') {
      toast('该文件类型暂不支持预览', true)
      return
    }
    setTabs((ts) => {
      if (ts.includes(path)) return ts
      const at = activeRef.current ? ts.indexOf(activeRef.current) + 1 : ts.length
      return [...ts.slice(0, at), path, ...ts.slice(at)]
    })
    setActivePath(path)
    const kind = kindOf(path)
    if ((kind === 'md' || kind === 'code' || kind === 'text') && contentsRef.current[path] === undefined) {
      api
        .getFile(path)
        .then((f) => {
          setContents((c) => ({ ...c, [path]: f.content }))
          lastSavedRef.current[path] = f.content // 磁盘基线
        })
        .catch((e) => toast((e as Error).message, true))
    }
    setCursor({ line: 1, col: 1 })
  }

  function scheduleSave(path: string, content: string) {
    pendingSaves.current[path] = content
    if (saveTimers.current[path]) clearTimeout(saveTimers.current[path])
    saveTimers.current[path] = setTimeout(() => void flushOne(path), SAVE_DEBOUNCE)
  }

  async function flushOne(path: string) {
    const content = pendingSaves.current[path]
    if (content === undefined) return
    delete pendingSaves.current[path]
    if (saveTimers.current[path]) {
      clearTimeout(saveTimers.current[path])
      delete saveTimers.current[path]
    }
    try {
      await api.saveFile(path, content)
      lastSavedRef.current[path] = content
      setDirty((d) => (d[path] ? { ...d, [path]: false } : d))
    } catch (e) {
      toast('保存失败：' + (e as Error).message, true)
    }
  }

  function flushAll(): Promise<void> {
    return Promise.all(Object.keys(pendingSaves.current).map((p) => flushOne(p))).then(() => undefined)
  }

  function handleEdit(path: string, value: string) {
    setContents((c) => ({ ...c, [path]: value }))
    setDirty((d) => (d[path] ? d : { ...d, [path]: true }))
    scheduleSave(path, value)
  }

  function closeTab(path: string) {
    void flushOne(path)
    setTabs((ts) => {
      const next = ts.filter((p) => p !== path)
      if (activeRef.current === path) {
        const idx = ts.indexOf(path)
        setActivePath(next[Math.min(idx, next.length - 1)] ?? null)
      }
      return next
    })
  }

  // 标签拖动排序
  const dragIdxRef = useRef<number | null>(null)
  function moveTab(from: number, to: number) {
    setTabs((ts) => {
      const next = [...ts]
      const [t] = next.splice(from, 1)
      next.splice(to, 0, t)
      return next
    })
  }
  function onTabDragStart(e: React.DragEvent, idx: number) {
    dragIdxRef.current = idx
    e.dataTransfer.effectAllowed = 'move'
    try {
      e.dataTransfer.setData('text/plain', '')
    } catch {
      /* ignore */
    }
  }
  function onTabDragOver(e: React.DragEvent, idx: number) {
    const from = dragIdxRef.current
    if (from == null || from === idx) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }
  function onTabDrop(e: React.DragEvent, idx: number) {
    e.preventDefault()
    const from = dragIdxRef.current
    dragIdxRef.current = null
    if (from == null || from === idx) return
    moveTab(from, idx)
  }

  // ── 文件管理 ─────────────────────────────────────────────────────────────
  async function createEntry(dir: string | null, kind: 'file' | 'folder', name: string) {
    const p = (dir ? dir + '/' : '') + name
    try {
      await api.createEntry(p, kind)
      refreshTree()
      if (kind === 'file') openFile(p)
    } catch (e) {
      toast((e as Error).message, true)
    }
  }

  async function deleteEntry(path: string) {
    try {
      await api.deleteEntry(path)
      tabsRef.current.filter((p) => p === path || p.startsWith(path + '/')).forEach(closeTab)
      refreshTree()
    } catch (e) {
      toast((e as Error).message, true)
    }
  }

  async function renameEntry(from: string, newName: string) {
    const i = from.lastIndexOf('/')
    const dir = i > 0 ? from.slice(0, i + 1) : ''
    const to = dir + newName
    try {
      await api.rename(from, to)
      refreshTree()
      setContents((c) => {
        if (c[from] === undefined) return c
        const n = { ...c }
        n[to] = n[from]
        delete n[from]
        return n
      })
      setTabs((ts) => ts.map((p) => (p === from ? to : p)))
      setActivePath((p) => (p === from ? to : p))
      if (lastSavedRef.current[from] !== undefined) {
        lastSavedRef.current[to] = lastSavedRef.current[from]
        delete lastSavedRef.current[from]
      }
    } catch (e) {
      toast((e as Error).message, true)
    }
  }

  // ── 编译 / 运行 ──────────────────────────────────────────────────────────
  const appendRunOutput = (text: string) => setRunOutput((o) => (o + text).slice(-100_000))

  async function runActive() {
    if (!activePath) return
    const lang = runLangOf(activePath)
    if (!lang) {
      toast('该文件类型不支持直接运行')
      return
    }
    try {
      await flushAll() // 运行前先落盘，保证跑的是最新内容
    } catch {
      /* ignore */
    }
    setRunPanelOpen(true)
    setRunRunning(true)
    appendRunOutput(`▶ 运行 ${activePath}\n`)
    try {
      await runClient.run(activePath, lang)
    } catch (e) {
      setRunRunning(false)
      toast((e as Error).message, true)
    }
  }

  const runActiveRef = useRef(runActive)
  runActiveRef.current = runActive

  // ── 侧栏拖宽 ─────────────────────────────────────────────────────────────
  function startResize(e: React.MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = sideWidth
    let last = startW
    function onMove(ev: MouseEvent) {
      last = Math.min(560, Math.max(180, startW + ev.clientX - startX))
      setSideWidth(last)
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      localStorage.setItem('la-ide-side-w', String(last))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  // ── SSE：文件树 / 外部修改 ───────────────────────────────────────────────
  useSSE((e) => {
    if (e.type === 'tree-changed') {
      refreshTree()
    } else if (e.type === 'file-changed') {
      const path = e.path as string
      const kind = e.kind as string
      if (kind === 'unlink' || kind === 'unlink-dir') {
        tabsRef.current.filter((p) => p === path || p.startsWith(path + '/')).forEach((p) => closeTab(p))
        return
      }
      if (kind !== 'change') return
      if (contentsRef.current[path] === undefined) return // 未打开的文本文件不拉取
      api
        .getFile(path)
        .then((f) => {
          // 与磁盘基线或本地内容一致 → 自己自动保存的回声，静默忽略
          if (f.content === lastSavedRef.current[path] || f.content === contentsRef.current[path]) return
          if (dirtyRef.current[path]) {
            // 真外部修改且本地有未保存改动：保留本地版本并提示
            toast(`「${path.split('/').pop()}」已被外部修改，本地有未保存改动`)
            return
          }
          setContents((c) => ({ ...c, [path]: f.content }))
        })
        .catch(() => undefined)
    } else if (e.type === 'vault-changed') {
      setTabs([])
      setActivePath(null)
      setContents({})
      setDirty({})
      refreshTree()
      toast('工作区已切换')
    }
  })

  // ── 快捷键 ───────────────────────────────────────────────────────────────
  const flushRef = useRef(flushAll)
  flushRef.current = flushAll
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey
      if (mod && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        flushRef.current()
        toast('已保存')
      } else if (mod && !e.shiftKey && e.key === 'Enter') {
        e.preventDefault()
        void runActiveRef.current()
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setSwitcherOpen((o) => !o)
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setSideView((v) => (v ? null : 'explorer'))
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSideView('search')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── 派生状态 ─────────────────────────────────────────────────────────────
  const files = useMemo(() => flattenFiles(tree), [tree])
  const vaultName = vaultPath ? vaultPath.replace(/\\/g, '/').split('/').pop() || vaultPath : ''
  const activeKind = activePath ? kindOf(activePath) : null
  const activeDirty = Boolean(activePath && dirty[activePath])
  const activeLangId = activePath ? monacoLangOf(activePath) : ''
  const statusLang =
    activeKind === 'pdf' ? 'PDF' : activeKind === 'image' ? '图片' : activePath ? langLabel(activeLangId) : ''
  const activeLsp = lspPlugins.find((p) => p.available && p.languages.includes(activeLangId))
  const runLang = activePath ? runLangOf(activePath) : null
  const runReady = runLang
    ? (RUN_TOOLCHAIN_IDS[runLang] ?? []).some((id) => toolchains.find((t) => t.id === id)?.available)
    : false
  const runMissingTool =
    runLang && !runReady
      ? toolchains.find((t) => (RUN_TOOLCHAIN_IDS[runLang] ?? []).includes(t.id) && t.winget)
      : undefined

  function renderEditor(path: string) {
    const kind = kindOf(path)
    if (kind === 'pdf') return <IdePdf path={path} dark={dark} />
    if (kind === 'image') return <IdeImage path={path} />
    const value = contents[path]
    if (value === undefined) {
      return (
        <div className="ide-empty">
          <span className="material-symbols-rounded">progress_activity</span>
          加载中…
        </div>
      )
    }
    if (kind === 'md') {
      return (
        <IdeMarkdown
          path={path}
          value={value}
          dark={dark}
          previewOpen={previews[path] === 'split'}
          onChange={handleEdit}
          onCursor={setCursor}
          reveal={reveal?.path === path ? reveal : null}
        />
      )
    }
    return (
      <Suspense fallback={<div className="ide-loading">编辑器加载中…</div>}>
        <CodeEditor
          path={path}
          value={value}
          dark={dark}
          onChange={handleEdit}
          onCursor={setCursor}
          reveal={reveal?.path === path ? reveal : null}
        />
      </Suspense>
    )
  }

  return (
    <div className={`ide-shell ${sideView ? '' : 'no-side'}`} data-theme={dark ? 'dark' : 'light'}>
      {/* 活动栏 */}
      <div className="ide-activitybar">
        <button
          className={`ide-act-btn ${sideView === 'explorer' ? 'active' : ''}`}
          title="资源管理器 (Ctrl+B)"
          onClick={() => setSideView((v) => (v === 'explorer' ? null : 'explorer'))}
        >
          <span className="material-symbols-rounded">folder_open</span>
        </button>
        <button
          className={`ide-act-btn ${sideView === 'search' ? 'active' : ''}`}
          title="搜索 (Ctrl+Shift+F)"
          onClick={() => setSideView((v) => (v === 'search' ? null : 'search'))}
        >
          <span className="material-symbols-rounded">search</span>
        </button>
        <div className="ide-act-spacer" />
        <button className="ide-act-btn" title={dark ? '切换浅色' : '切换深色'} onClick={onToggleTheme}>
          <span className="material-symbols-rounded">{dark ? 'light_mode' : 'dark_mode'}</span>
        </button>
        <button className="ide-act-btn" title="返回学习模式" onClick={onExit}>
          <span className="material-symbols-rounded">school</span>
        </button>
      </div>

      {/* 侧面板 */}
      {sideView && (
        <>
          <div className="ide-sidepanel" style={{ width: sideWidth }}>
            <div className="ide-side-title">{sideView === 'explorer' ? '资源管理器' : '搜索'}</div>
            {sideView === 'explorer' ? (
              <IdeExplorer
                tree={tree}
                activePath={activePath}
                onOpenFile={openFile}
                onCreate={(dir, kind, name) => void createEntry(dir, kind, name)}
                onDelete={(p) => void deleteEntry(p)}
                onRename={(from, name) => void renameEntry(from, name)}
                openDialog={setDialog}
              />
            ) : (
              <IdeSearch
                onOpenResult={(path, line) => {
                  openFile(path)
                  setReveal({ path, line, ts: Date.now() })
                }}
              />
            )}
          </div>
          <div className="ide-side-resize" onMouseDown={startResize} />
        </>
      )}

      {/* 主区 */}
      <div className="ide-main">
        <div className="ide-tabbar">
          {tabs.map((path) => {
            const ic = fileIcon(path)
            const isActive = path === activePath
            return (
              <div
                key={path}
                draggable
                onDragStart={(e) => onTabDragStart(e, tabs.indexOf(path))}
                onDragOver={(e) => onTabDragOver(e, tabs.indexOf(path))}
                onDrop={(e) => onTabDrop(e, tabs.indexOf(path))}
                onDragEnd={() => (dragIdxRef.current = null)}
                className={`ide-tab ${isActive ? 'active' : ''}`}
                onClick={() => {
                  void flushOne(activePath ?? '')
                  setActivePath(path)
                  setCursor({ line: 1, col: 1 })
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) closeTab(path)
                }}
                title={path}
              >
                <span className="material-symbols-rounded ide-tab-icon" style={{ color: ic.color }}>
                  {ic.icon}
                </span>
                <span className="ide-tab-name">{path.split('/').pop()}</span>
                {dirty[path] && <span className="ide-tab-dirty" />}
                <span
                  className="ide-tab-close"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(path)
                  }}
                >
                  <span className="material-symbols-rounded">close</span>
                </span>
              </div>
            )
          })}
          <div className="ide-tabbar-end">
            {runLang && (
              <button
                className={`icon-btn ${runReady ? '' : 'run-missing'}`}
                title={
                  runReady
                    ? `运行 ${activePath?.split('/').pop()}（Ctrl+Enter）`
                    : `未检测到 ${runMissingTool?.name ?? '工具链'}，点击查看安装方式`
                }
                onClick={() => (runReady ? void runActiveRef.current() : setLspPanelOpen(true))}
              >
                <span className="material-symbols-rounded" style={{ color: runReady ? 'var(--mastered)' : 'var(--learning)' }}>
                  play_arrow
                </span>
              </button>
            )}
            {activeKind === 'md' && activePath && (
              <>
                <button
                  className={`icon-btn ${previews[activePath] === 'split' ? 'active' : ''}`}
                  title={previews[activePath] === 'split' ? '关闭预览分屏' : '分屏预览（源码 | 渲染，可拖动比例）'}
                  onClick={() =>
                    setPreviews((p) => ({ ...p, [activePath]: p[activePath] === 'split' ? 'off' : 'split' }))
                  }
                >
                  <span className="material-symbols-rounded">split_scene</span>
                </button>
                <button
                  className={`icon-btn ${previews[activePath] === 'float' ? 'active' : ''}`}
                  title={previews[activePath] === 'float' ? '关闭浮动预览窗' : '浮动预览窗（独立于源码，可拖动/调整大小）'}
                  onClick={() =>
                    setPreviews((p) => ({ ...p, [activePath]: p[activePath] === 'float' ? 'off' : 'float' }))
                  }
                >
                  <span className="material-symbols-rounded">picture_in_picture</span>
                </button>
              </>
            )}
          </div>
        </div>

        <div className="ide-editor-area">
          {activePath ? (
            renderEditor(activePath)
          ) : (
            <div className="ide-welcome">
              <div className="ide-welcome-logo">
                <span className="material-symbols-rounded">code_blocks</span>
                LearnAgent IDE
              </div>
              <div className="ide-welcome-hint">从左侧资源管理器打开文件，或</div>
              <div className="ide-welcome-keys">
                <div>
                  <kbd>Ctrl</kbd>+<kbd>P</kbd> 快速打开文件
                </div>
                <div>
                  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> 全局搜索
                </div>
                <div>
                  <kbd>Ctrl</kbd>+<kbd>S</kbd> 保存（默认自动保存）
                </div>
                <div>
                  <kbd>Ctrl</kbd>+<kbd>B</kbd> 收起 / 展开侧栏
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Markdown 浮动预览窗（独立于源码布局，可拖动/调整大小） */}
        {activeKind === 'md' && activePath && previews[activePath] === 'float' && contents[activePath] !== undefined && (
          <IdeFloatPreview
            path={activePath}
            value={contents[activePath]}
            dark={dark}
            onClose={() => setPreviews((p) => ({ ...p, [activePath]: 'off' }))}
            onDock={() => setPreviews((p) => ({ ...p, [activePath]: 'split' }))}
          />
        )}

        {/* 运行输出面板 */}
        {runPanelOpen && (
          <RunOutput
            output={runOutput}
            running={runRunning}
            desc={runDesc}
            onStop={() => runClient.kill()}
            onClose={() => setRunPanelOpen(false)}
            onClear={() => setRunOutput('')}
          />
        )}

        {/* 状态栏 */}
        <div className="ide-statusbar">
          <div className="ide-status-left">
            <span className="ide-status-item" title={vaultPath}>
              {vaultName}
            </span>
            {activeDirty && (
              <span className="ide-status-item accent">
                <span className="material-symbols-rounded" style={{ fontSize: 13 }}>
                  cloud_upload
                </span>
                保存中…
              </span>
            )}
          </div>
          <div className="ide-status-right">
            {activePath && (
              <>
                <span className="ide-status-item">
                  行 {cursor.line}, 列 {cursor.col}
                </span>
                <span className="ide-status-item">{statusLang}</span>
                <span className="ide-status-item">UTF-8</span>
              </>
            )}
            {activeLsp && (
              <button
                className={`ide-status-item lsp-indicator ${lspRunningMap()[activeLangId] ? 'on' : ''}`}
                title={`语言服务器：${activeLsp.name}（点击查看插件面板）`}
                onClick={() => setLspPanelOpen((o) => !o)}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 13 }}>
                  plug
                </span>
                {lspRunningMap()[activeLangId] ? `${activeLsp.name}` : `${activeLsp.name}（启动中…）`}
              </button>
            )}
          </div>
        </div>

        {/* LSP 插件面板 */}
        {lspPanelOpen && (
          <div className="lsp-panel">
            <div className="lsp-panel-head">
              <span className="material-symbols-rounded">plug</span>
              语言服务器插件（本机运行 · 可插拔）
              <button className="icon-btn" title="关闭" onClick={() => setLspPanelOpen(false)}>
                <span className="material-symbols-rounded" style={{ fontSize: 14 }}>
                  close
                </span>
              </button>
            </div>
            <div className="lsp-panel-body">
              <div className="lsp-panel-section">语言服务器</div>
              {lspPlugins.map((p) => {
                const running = p.languages.some((l) => lspRunningMap()[l])
                return (
                  <div key={p.id} className="lsp-plugin-row">
                    <span className={`lsp-dot ${running ? 'on' : p.available ? 'idle' : 'off'}`} />
                    <div className="lsp-plugin-info">
                      <div className="lsp-plugin-name">
                        {p.name}
                        <span className="lsp-plugin-langs">{p.languages.join(' / ')}</span>
                      </div>
                      <div className="lsp-plugin-hint">
                        {running ? '运行中' : p.available ? '已安装，打开对应语言文件时自动启动' : '未检测到：' + p.installHint}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div className="lsp-panel-section">编译 / 运行工具链</div>
              {toolchains.map((t) => (
                <div key={t.id} className="lsp-plugin-row">
                  <span className={`lsp-dot ${t.available ? 'idle' : 'off'}`} />
                  <div className="lsp-plugin-info">
                    <div className="lsp-plugin-name">
                      {t.name}
                      {t.available && t.version ? <span className="lsp-plugin-langs">v{t.version}</span> : null}
                    </div>
                    <div className="lsp-plugin-hint">
                      {t.available ? `可运行（${t.command}）` : t.winget ? '未检测到，可一键安装' : '未检测到'}
                    </div>
                  </div>
                  {!t.available && t.winget && (
                    <button
                      className="lsp-install-btn"
                      title={`winget install ${t.winget}`}
                      onClick={() => {
                        setRunPanelOpen(true)
                        appendRunOutput(`▶ 安装工具链 ${t.name}（winget）\n`)
                        void runClient.install(t.id)
                      }}
                    >
                      安装
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="lsp-panel-foot">全部在本地运行，无需联网。扩展：编辑 .learn-agent/lsp-plugins.json</div>
          </div>
        )}
      </div>

      {switcherOpen && (
        <QuickSwitcher files={files} onOpen={(p) => openFile(p)} onClose={() => setSwitcherOpen(false)} />
      )}
      {dialog && <PromptDialog spec={dialog} onClose={() => setDialog(null)} />}
      <Toasts items={toasts} />
    </div>
  )
}
