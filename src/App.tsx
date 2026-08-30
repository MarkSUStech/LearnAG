import { useEffect, useRef, useState } from 'react'
import './styles.css'
import { api } from './api'
import { useSSE } from './sse'
import { splitFrontmatter } from './frontmatter'
import Sidebar from './components/Sidebar'
import EditorPane from './components/EditorPane'
import GraphView from './components/GraphView'
import InputBar, { type Mode } from './components/InputBar'
import SettingsDialog from './components/SettingsDialog'
import QuestionCard from './components/QuestionCard'
import QuickSwitcher from './components/QuickSwitcher'
import ReferenceBrowser from './components/ReferenceBrowser'
import Toasts from './components/Toasts'
import TutorPanel from './components/TutorPanel'
import { applyAppearance, loadAppearance, saveAppearance, type Appearance } from './appearance'
import type { AgentStatus, GraphData, PendingQuestion, PlanInfo, SessionMeta, Settings, Tab, ToastItem, TreeNode } from './types'

/** 展开文件树为路径列表 */
function flattenFiles(nodes: TreeNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === 'file') out.push(n.path)
    if (n.children) flattenFiles(n.children, out)
  }
  return out
}

const SAVE_DEBOUNCE = 600

export default function App() {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [vaultPath, setVaultPath] = useState('')
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [contents, setContents] = useState<Record<string, string>>({})
  const [streaming, setStreaming] = useState<Record<string, boolean>>({})
  const [conflicts, setConflicts] = useState<Record<string, boolean>>({})
  const [agent, setAgent] = useState<AgentStatus>({ running: false, stage: 'idle', message: '' })
  const [settings, setSettings] = useState<Settings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [graph, setGraph] = useState<GraphData>({ version: 1, updatedAt: '', nodes: [], edges: [] })
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [dark, setDark] = useState(() => localStorage.getItem('la-theme') === 'dark')
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('la-mode') as Mode) || '教学')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null)
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [activeSessionId, setActiveSessionId] = useState('')
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [appearance, setAppearance] = useState<Appearance>(() => loadAppearance())
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null)
  const [learnedFlow, setLearnedFlow] = useState<string | null>(null) // 正在检查掌握情况的笔记路径
  const [celebratePath, setCelebratePath] = useState<string | null>(null)
  const [tutorFor, setTutorFor] = useState<string | null>(null) // 答疑面板绑定的笔记路径
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const w = Number(localStorage.getItem('la-sidebar-w'))
    return w >= 180 && w <= 440 ? w : 248
  })
  const [tutorWidth, setTutorWidth] = useState(() => {
    const w = Number(localStorage.getItem('la-tutor-w'))
    return w >= 300 && w <= 640 ? w : 400
  })

  // 侧栏拖拽调宽（sidebar 向右拖 / tutor 向左拖）
  function startResize(e: React.MouseEvent, kind: 'sidebar' | 'tutor') {
    e.preventDefault()
    const startX = e.clientX
    const startW = kind === 'sidebar' ? sidebarWidth : tutorWidth
    let last = startW
    function onMove(ev: MouseEvent) {
      const delta = kind === 'sidebar' ? ev.clientX - startX : startX - ev.clientX
      last = Math.min(kind === 'sidebar' ? 440 : 640, Math.max(kind === 'sidebar' ? 180 : 300, startW + delta))
      if (kind === 'sidebar') setSidebarWidth(last)
      else setTutorWidth(last)
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      localStorage.setItem(kind === 'sidebar' ? 'la-sidebar-w' : 'la-tutor-w', String(last))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }
  const learnedFlowRef = useRef<string | null>(null)
  learnedFlowRef.current = learnedFlow

  const refreshPlan = () =>
    fetch('/api/plan')
      .then((r) => r.json())
      .then(setPlanInfo)
      .catch(() => undefined)

  // refs：SSE 回调里要读到的最新状态
  const contentsRef = useRef(contents)
  contentsRef.current = contents
  const streamingRef = useRef(streaming)
  streamingRef.current = streaming
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const lastEditRef = useRef<Record<string, number>>({})
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const pendingSaves = useRef<Record<string, string>>({})
  const lastSentRef = useRef<Record<string, string>>({})
  const activeIdxRef = useRef(activeIdx)
  activeIdxRef.current = activeIdx

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    localStorage.setItem('la-theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    applyAppearance(appearance)
    saveAppearance(appearance)
  }, [appearance])

  useEffect(() => {
    localStorage.setItem('la-mode', mode)
  }, [mode])

  function toast(text: string, error = false) {
    const id = Math.random()
    setToasts((t) => [...t, { id, text, error }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500)
  }

  const refreshTree = () => api.getTree().then((r) => setTree(r.tree)).catch(() => undefined)
  const refreshSessions = () =>
    api
      .listSessions()
      .then((r) => {
        setSessions(r.sessions)
        setActiveSessionId(r.activeId)
      })
      .catch(() => undefined)

  // ── 启动 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    refreshTree()
    refreshSessions()
    refreshPlan()
    api.getSettings().then(setSettings).catch(() => undefined)
    api.getGraph().then(setGraph).catch(() => undefined)
    // 默认打开欢迎页
    api
      .getFile('欢迎.md')
      .then((f) => {
        setContents((c) => ({ ...c, [f.path]: f.content }))
        setTabs([{ kind: 'note', path: f.path }])
        setActiveIdx(0)
      })
      .catch(() => undefined)
  }, [])

  // ── 文件打开 / 保存 ─────────────────────────────────────────────────────
  async function openNote(path: string) {
    if (!path.toLowerCase().endsWith('.md')) {
      toast('非 Markdown 文件请在「资料」预览器中查看')
      openRefs()
      return
    }
    flushSaves()
    setTabs((ts) => {
      const i = ts.findIndex((t) => t.kind === 'note' && t.path === path)
      if (i >= 0) {
        setActiveIdx(i)
        return ts
      }
      const next = [...ts]
      next.splice(activeIdx + 1, 0, { kind: 'note', path })
      setActiveIdx(next.findIndex((t) => t.kind === 'note' && t.path === path))
      return next
    })
    if (contentsRef.current[path] === undefined) {
      try {
        const f = await api.getFile(path)
        setContents((c) => ({ ...c, [path]: f.content }))
      } catch (e) {
        toast((e as Error).message, true)
      }
    }
    setConflicts((cf) => ({ ...cf, [path]: false }))
  }

  function scheduleSave(path: string, full: string) {
    pendingSaves.current[path] = full
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
      lastSentRef.current[path] = content
    } catch (e) {
      toast('保存失败：' + (e as Error).message, true)
    }
  }

  function flushSaves() {
    for (const p of Object.keys(pendingSaves.current)) void flushOne(p)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        flushSaves()
        toast('已保存')
      }
      // Ctrl+P / Alt+K 快速切换（Ctrl+K 会被浏览器保留拦截）
      if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') ||
        (e.altKey && e.key.toLowerCase() === 'k')
      ) {
        e.preventDefault()
        setSwitcherOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // [[wikilink]] 跳转：按标题匹配 vault 内的笔记文件
  function openWikilink(title: string) {
    const all = flattenFiles(tree)
    const target = all.find((p) => {
      const name = p.split('/').pop() ?? ''
      return name.replace(/\.md$/i, '') === title || name.toLowerCase() === title.toLowerCase()
    })
    if (target) void openNote(target)
    else toast(`笔记「${title}」不存在`)
  }

  // 用户在编辑器里改动了正文（每次击键都会进来）
  function handleEdit(path: string, body: string) {
    if (streamingRef.current[path]) return
    const raw = contentsRef.current[path] ?? ''
    const fm = splitFrontmatter(raw).frontmatter
    const full = fm ? fm.replace(/\r?\n?$/, '\n\n') + body : body
    lastEditRef.current[path] = Date.now()
    setContents((c) => ({ ...c, [path]: full }))
    scheduleSave(path, full)
  }

  // ── 标签页 ──────────────────────────────────────────────────────────────
  function closeTab(idx: number) {
    const tab = tabs[idx]
    if (tab.kind === 'note') void flushOne(tab.path)
    setTabs((ts) => {
      const next = ts.filter((_, i) => i !== idx)
      setActiveIdx((ai) => (idx < ai ? ai - 1 : Math.min(ai, next.length - 1)))
      return next
    })
  }

  function openGraph() {
    flushSaves()
    setTabs((ts) => {
      const i = ts.findIndex((t) => t.kind === 'graph')
      if (i >= 0) {
        setActiveIdx(i)
        return ts
      }
      const next = [...ts, { kind: 'graph' as const }]
      setActiveIdx(next.length - 1)
      return next
    })
  }

  function openRefs() {
    flushSaves()
    setTabs((ts) => {
      const i = ts.findIndex((t) => t.kind === 'refs')
      if (i >= 0) {
        setActiveIdx(i)
        return ts
      }
      const next = [...ts, { kind: 'refs' as const }]
      setActiveIdx(next.length - 1)
      return next
    })
  }

  const activeTab = tabs[activeIdx]
  const activeNotePath = activeTab?.kind === 'note' ? activeTab.path : null

  // 切换标签/笔记时关闭答疑面板（面板严格绑定其笔记）
  useEffect(() => {
    setTutorFor((cur) => (cur && activeNotePath !== cur ? null : cur))
  }, [activeNotePath])

  // ── 新建 / 删除 / 改名 ──────────────────────────────────────────────────
  async function createEntry(_parent: string | null, kind: 'file' | 'folder') {
    const name = prompt(kind === 'file' ? '新笔记名称：' : '新文件夹名称：')
    if (!name) return
    const p = kind === 'file' && !name.endsWith('.md') ? name + '.md' : name
    try {
      await api.createEntry(p, kind)
      refreshTree()
      if (kind === 'file') void openNote(p)
    } catch (e) {
      toast((e as Error).message, true)
    }
  }

  async function deleteEntry(path: string) {
    if (!confirm(`确定删除「${path}」？`)) return
    try {
      await api.deleteEntry(path)
      setTabs((ts) => ts.filter((t) => !(t.kind === 'note' && (t.path === path || t.path.startsWith(path + '/')))))
      refreshTree()
    } catch (e) {
      toast((e as Error).message, true)
    }
  }

  async function renameEntry(from: string, newName: string) {
    try {
      await api.rename(from, newName)
      refreshTree()
      const oldContent = contentsRef.current[from]
      setContents((c) => {
        const n = { ...c }
        if (oldContent !== undefined) {
          delete n[from]
          n[newName] = oldContent
        }
        return n
      })
      setTabs((ts) =>
        ts.map((t) => (t.kind === 'note' && t.path === from ? { kind: 'note', path: newName } : t)),
      )
      if (lastSentRef.current[from] !== undefined) {
        lastSentRef.current[newName] = lastSentRef.current[from]
      }
    } catch (e) {
      toast((e as Error).message, true)
    }
  }

  // ── Agent ───────────────────────────────────────────────────────────────
  async function sendToAgent(text: string) {
    // 有待回答的提问 → 本次输入直接作为答案提交
    if (pendingQuestion) {
      try {
        await api.answerQuestion(pendingQuestion.id, text)
        setPendingQuestion(null)
      } catch (e) {
        toast((e as Error).message, true)
      }
      return
    }
    flushSaves()
    setAgent({ running: true, stage: 'thinking', message: '正在思考…' })
    try {
      await api.sendAgent(text, mode)
    } catch (e) {
      setAgent({ running: false, stage: 'idle', message: '' })
      toast((e as Error).message, true)
    }
  }

  async function stopAgent() {
    try {
      await api.stopAgent()
      setPendingQuestion(null)
    } catch {
      /* ignore */
    }
  }

  // 「已学习」按钮：把学习完成事件发给 agent，抽查通过后庆祝
  async function markLearned(path: string, title: string) {
    if (agent.running) {
      toast('agent 正在工作中，请稍候', true)
      return
    }
    setLearnedFlow(path)
    setAgent({ running: true, stage: 'thinking', message: '正在检查你的掌握情况…' })
    try {
      await api.sendAgent(
        `我已学完《${title}》这篇笔记（含课后习题），笔记路径：${path}。请按分层评估框架抽查我的掌握情况（2~3 道题，用提问卡片），然后执行沉淀动作更新知识图谱`,
        '教学',
      )
    } catch (e) {
      setAgent({ running: false, stage: 'idle', message: '' })
      setLearnedFlow(null)
      toast((e as Error).message, true)
    }
  }

  // ── 会话 ────────────────────────────────────────────────────────────────
  async function newSession() {
    try {
      await api.createSession()
      refreshSessions()
      toast('已开始新对话')
    } catch (e) {
      toast((e as Error).message, true)
    }
  }

  async function switchSession(id: string) {
    try {
      await api.activateSession(id)
      setActiveSessionId(id)
      setAgent({ running: false, stage: 'idle', message: '' })
      toast('已切换对话')
    } catch (e) {
      toast((e as Error).message, true)
    }
  }

  async function deleteSession(id: string) {
    if (!confirm('删除这个对话？（记录会归档保存）')) return
    try {
      await api.deleteSession(id)
      refreshSessions()
    } catch (e) {
      toast((e as Error).message, true)
    }
  }

  // ── SSE ─────────────────────────────────────────────────────────────────
  useSSE((e) => {
    switch (e.type) {
      case 'file-changed': {
        const path = e.path as string
        const kind = e.kind as string
        if (kind === 'unlink' || kind === 'unlink-dir') {
          setTabs((ts) => {
            const next = ts.filter(
              (t) => !(t.kind === 'note' && (t.path === path || t.path.startsWith(path + '/'))),
            )
            return next
          })
          return
        }
        if (streamingRef.current[path]) return // agent 流式写入由 agent-write 事件驱动
        if (!tabsRef.current.some((t) => t.kind === 'note' && t.path === path)) return
        void api
          .getFile(path)
          .then((f) => {
            if (f.content === lastSentRef.current[path] || f.content === contentsRef.current[path]) return
            if (Date.now() - (lastEditRef.current[path] ?? 0) < 2000) {
              setConflicts((cf) => ({ ...cf, [path]: true }))
            } else {
              setContents((c) => ({ ...c, [path]: f.content }))
            }
          })
          .catch(() => undefined)
        break
      }
      case 'tree-changed':
        refreshTree()
        break
      case 'graph-changed':
        api.getGraph().then(setGraph).catch(() => undefined)
        break
      case 'vault-changed': {
        setVaultPath(e.vaultPath as string)
        setContents({})
        setTabs((ts) => ts.filter((t) => t.kind === 'graph'))
        setActiveIdx(0)
        setPendingQuestion(null)
        refreshTree()
        refreshSessions()
        refreshPlan()
        api.getGraph().then(setGraph).catch(() => undefined)
        toast('知识库已切换')
        break
      }
      case 'agent-write': {
        const path = e.path as string
        const content = e.content as string
        const done = e.done as boolean
        const exists = tabsRef.current.some((t) => t.kind === 'note' && t.path === path)
        if (!exists) {
          setTabs((ts) => {
            const i = ts.findIndex((t) => t.kind === 'note' && t.path === path)
            if (i >= 0) return ts
            const next = [...ts]
            const at = Math.min(activeIdxRef.current + 1, next.length)
            next.splice(at, 0, { kind: 'note', path })
            setActiveIdx(at)
            return next
          })
        }
        delete pendingSaves.current[path]
        setContents((c) => ({ ...c, [path]: content }))
        setStreaming((s) => ({ ...s, [path]: !done }))
        if (done) refreshTree()
        break
      }
      case 'agent-question':
        setPendingQuestion({
          id: e.id as string,
          question: e.question as string,
          type: (e.qType as PendingQuestion['type']) || 'text',
          options: (e.options as string[]) ?? [],
          allowCustom: e.allowCustom !== false,
          fileHint: (e.fileHint as string) ?? '',
          fileMultiple: Boolean(e.fileMultiple),
          code: (e.code as string) || '',
          contextFiles: (e.contextFiles as PendingQuestion['contextFiles']) ?? [],
        })
        setAgent((a) => ({ ...a, running: true, message: '等待你的回答…' }))
        break
      case 'agent-question-closed':
        setPendingQuestion((q) => (q && q.id === e.id ? null : q))
        break
      case 'tutor-delta':
      case 'tutor-status':
      case 'tutor-done':
        // 桥接给答疑面板（TutorPanel 自行按 path 过滤）
        window.dispatchEvent(new MessageEvent('tutor-sse', { data: JSON.stringify(e) }))
        break
      case 'agent-status': {
        const stage = e.stage as string
        if (stage === 'thinking') setAgent({ running: true, stage: 'thinking', message: (e.message as string) || '正在思考…' })
        else if (stage === 'writing') setAgent({ running: true, stage: 'writing', message: (e.message as string) || '正在写入…' })
        else if (stage === 'tool') setAgent({ running: true, stage: 'tool', message: (e.message as string) || '' })
        else if (stage === 'written') setAgent({ running: true, stage: 'written', message: (e.message as string) || '' })
        break
      }
      case 'agent-done': {
        const error = e.error as string | undefined
        const stopped = e.stopped as boolean | undefined
        setAgent({
          running: false,
          stage: 'done',
          message: error ? `出错：${error}` : stopped ? '已停止' : '完成',
        })
        setPendingQuestion(null)
        // 「已学习」流程结束 → 庆祝动效
        if (learnedFlowRef.current) {
          if (!error && !stopped) {
            setCelebratePath(learnedFlowRef.current)
            setTimeout(() => setCelebratePath(null), 2200)
          }
          setLearnedFlow(null)
        }
        refreshTree()
        refreshSessions()
        refreshPlan()
        api.getGraph().then(setGraph).catch(() => undefined)
        if (error) toast(error, true)
        break
      }
    }
  })

  const vaultName = vaultPath ? vaultPath.replace(/\\/g, '/').split('/').pop() || vaultPath : ''

  return (
    <div className="app">
      <Sidebar
        collapsed={sidebarCollapsed}
        width={sidebarWidth}
        onResizeStart={(e) => startResize(e, 'sidebar')}
        tree={tree}
        activePath={activeNotePath}
        onOpen={(p) => void openNote(p)}
        onCreate={createEntry}
        onDelete={deleteEntry}
        onRename={renameEntry}
        onOpenGraph={openGraph}
        onOpenRefs={openRefs}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleTheme={() => setDark((d) => !d)}
        dark={dark}
        vaultName={vaultName}
        graphOpen={activeTab?.kind === 'graph'}
        refsOpen={activeTab?.kind === 'refs'}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onNewSession={() => void newSession()}
        onSwitchSession={(id) => void switchSession(id)}
        onDeleteSession={(id) => void deleteSession(id)}
        onRenameSession={(id, title) => {
          api.renameSession(id, title).then(refreshSessions).catch((e) => toast((e as Error).message, true))
        }}
        onOpenSwitcher={() => setSwitcherOpen(true)}
        agentRunning={agent.running}
      />
      <div className="main">
        <div className="tabbar">
          <button
            className="icon-btn"
            title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            onClick={() => setSidebarCollapsed((c) => !c)}
            style={{ marginBottom: 4 }}
          >
            <span className="material-symbols-rounded">{sidebarCollapsed ? 'menu' : 'left_panel_close'}</span>
          </button>
          {tabs.map((tab, i) => (
            <div
              key={tab.kind === 'note' ? tab.path : tab.kind}
              className={`tab ${i === activeIdx ? 'active' : ''}`}
              onClick={() => {
                flushSaves()
                setActiveIdx(i)
              }}
            >
              <span className="material-symbols-rounded">
                {tab.kind === 'graph' ? 'hub' : tab.kind === 'refs' ? 'folder_open' : 'description'}
              </span>
              <span className="tab-title">
                {tab.kind === 'graph' ? '知识图谱' : tab.kind === 'refs' ? '资料' : tab.path.split('/').pop()?.replace(/\.md$/, '')}
              </span>
              {streaming[tab.kind === 'note' ? tab.path : ''] && <span className="dot" />}
              <span
                className="close"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(i)
                }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 14 }}>
                  close
                </span>
              </span>
            </div>
          ))}
          <div className="tabbar-end" />
        </div>

        {activeNotePath ? (
          <>
            {conflicts[activeNotePath] && (
              <div className="conflict-tip">
                <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
                  warning
                </span>
                该文件刚被外部（可能是 agent）更新，而本地有未保存的修改。
                <button
                  onClick={() => {
                    void api
                      .getFile(activeNotePath)
                      .then((f) => setContents((c) => ({ ...c, [activeNotePath]: f.content })))
                    setConflicts((cf) => ({ ...cf, [activeNotePath]: false }))
                  }}
                >
                  加载新版本
                </button>
                <button onClick={() => setConflicts((cf) => ({ ...cf, [activeNotePath]: false }))}>忽略</button>
              </div>
            )}
            <div className={`editor-stack ${tutorFor === activeNotePath ? 'tutor-open' : ''}`}>
              {contents[activeNotePath] !== undefined ? (
                <EditorPane
                  key={activeNotePath}
                  path={activeNotePath}
                  content={contents[activeNotePath]}
                  streaming={Boolean(streaming[activeNotePath])}
                  dark={dark}
                  onEdit={handleEdit}
                  onWikilink={openWikilink}
                  onMarkLearned={(p, title) => void markLearned(p, title)}
                  learnedRunning={Boolean(learnedFlow)}
                  celebrate={celebratePath === activeNotePath}
                  tutorOpen={tutorFor === activeNotePath}
                  onToggleTutor={() =>
                    setTutorFor((cur) => (cur === activeNotePath ? null : activeNotePath))
                  }
                />
              ) : (
                <div className="empty-state">
                  <span className="material-symbols-rounded">progress_activity</span>
                  加载中…
                </div>
              )}
              {tutorFor === activeNotePath && (
                <TutorPanel
                  notePath={activeNotePath}
                  noteTitle={activeNotePath.split('/').pop()?.replace(/\.md$/, '') ?? ''}
                  width={tutorWidth}
                  onResizeStart={(e) => startResize(e, 'tutor')}
                  onClose={() => setTutorFor(null)}
                />
              )}
            </div>
          </>
        ) : activeTab?.kind === 'graph' ? (
          <GraphView graph={graph} onOpenNote={(p) => void openNote(p)} />
        ) : activeTab?.kind === 'refs' ? (
          <ReferenceBrowser tree={tree} dark={dark} onOpenNote={(p) => void openNote(p)} />
        ) : (
          <div className="empty-state">
            <span className="material-symbols-rounded">note_stack</span>
            <div>从左侧打开一篇笔记，或用下方输入框与 agent 交流</div>
          </div>
        )}

        <InputBar
          agent={agent}
          mode={mode}
          onModeChange={setMode}
          onSend={sendToAgent}
          onStop={stopAgent}
          answering={Boolean(pendingQuestion)}
          planChip={
            planInfo?.exists && planInfo.goal ? (
              <button
                className="plan-chip"
                title="打开目标与计划（Agent/目标与计划.md）"
                onClick={() => void openNote(planInfo.path)}
              >
                <span className="material-symbols-rounded">flag</span>
                {planInfo.goal}
                {planInfo.currentStage ? <span className="pc-stage">· {planInfo.currentStage}</span> : null}
              </button>
            ) : undefined
          }
          topSlot={
            pendingQuestion ? (
              <QuestionCard
                question={pendingQuestion}
                onAnswered={() => setPendingQuestion(null)}
                onError={(m) => toast(m, true)}
              />
            ) : undefined
          }
        />
      </div>

      {switcherOpen && <QuickSwitcher files={flattenFiles(tree)} onOpen={(p) => void openNote(p)} onClose={() => setSwitcherOpen(false)} />}
      {settingsOpen && settings && (
        <SettingsDialog
          settings={settings}
          appearance={appearance}
          onAppearanceChange={setAppearance}
          onClose={() => setSettingsOpen(false)}
          onSaved={(s) => {
            setSettings(s)
            setSettingsOpen(false)
          }}
        />
      )}
      <Toasts items={toasts} />
    </div>
  )
}
