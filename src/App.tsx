import { useEffect, useRef, useState, Suspense, lazy } from 'react'
import './styles/index.css'
import { api } from './api'
import { useSSE } from './sse'
import { splitFrontmatter } from './frontmatter'
import Sidebar from './components/Sidebar'
import EditorPane from './components/EditorPane'
import GraphView from './components/GraphView'
import InputBar, { type Mode } from './components/InputBar'
import GoalPicker from './components/GoalPicker'
import SettingsDialog from './components/SettingsDialog'
import QuestionCard from './components/QuestionCard'
import QuickSwitcher from './components/QuickSwitcher'
import ReferenceBrowser from './components/ReferenceBrowser'
import Toasts from './components/Toasts'
import TutorPanel from './components/TutorPanel'
import PromptDialog, { type DialogSpec } from './components/PromptDialog'
import PdfStudyPane from './components/pdfstudy/PdfStudyPane'
import { applyAppearance, loadAppearance, saveAppearance, type Appearance } from './appearance'
import type { AgentStatus, GoalInfo, GraphData, PendingQuestion, SessionMeta, Settings, Tab, ToastItem, TreeNode, WriterAttachment  } from './types'

const IdeShell = lazy(() => import('./components/ide/IdeShell'))

/** 展开文件树为路径列表 */
function flattenFiles(nodes: TreeNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === 'file') out.push(n.path)
    if (n.children) flattenFiles(n.children, out)
  }
  return out
}

const SAVE_DEBOUNCE = 600

// 标签栏最多同时显示的标签数，超出的自动收进右端「折叠」区
const MAX_VISIBLE_TABS = 10

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
  // 应用级视图：学习模式 / IDE 模式（IDE 借鉴 Theia ApplicationShell 布局，见 components/ide/）
  const [appView, setAppView] = useState<'learn' | 'ide'>(() =>
    localStorage.getItem('la-app-view') === 'ide' ? 'ide' : 'learn',
  )
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null)
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [activeSessionId, setActiveSessionId] = useState('')
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [appearance, setAppearance] = useState<Appearance>(() => loadAppearance())
  const [goals, setGoals] = useState<GoalInfo[]>([])
  const [selectedGoalId, setSelectedGoalId] = useState<string>(() => localStorage.getItem('la-goal') || '')
  const [learnedFlow, setLearnedFlow] = useState<string | null>(null) // 正在检查掌握情况的笔记路径
  const [dialog, setDialog] = useState<DialogSpec | null>(null)
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
  // 分屏：副面板单标签（标签拖到内容区右缘停靠；拖回标签栏 / 左缘取消）
  const [splitTab, setSplitTab] = useState<Tab | null>(null)
  const [foldOpen, setFoldOpen] = useState(false)
  const foldedStreaming = tabs
    .slice(MAX_VISIBLE_TABS)
    .some((tb) => tb.kind === 'note' && streaming[tb.path])
  const [splitRatio, setSplitRatio] = useState(() => {
    const r = Number(localStorage.getItem('la-split-ratio'))
    return r >= 0.25 && r <= 0.75 ? r : 0.55
  })
  const [dragActive, setDragActive] = useState(false)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null) // 标签栏插入位置
  const [dragZone, setDragZone] = useState<'left' | 'right' | null>(null)

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

  const refreshGoals = () =>
    api.getGoals()
      .then((r) => {
        setGoals(r.goals)
        setSelectedGoalId((cur) => (cur && r.goals.some((g) => g.id === cur) ? cur : ''))
      })
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
  function activateTabReal(next: Tab[], target: number): Tab[] {
    // 激活折叠区里的标签：把它移到标签栏最前并激活（保证活动标签始终可见）
    const [t] = next.splice(target, 1)
    next.unshift(t)
    setActiveIdx(0)
    return next
  }

  // 活动标签始终滚入可视范围（标签区横向滚动时）
  useEffect(() => {
    document.querySelector('.tabbar-scroll .tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeIdx])
  const appViewRef = useRef(appView)
  appViewRef.current = appView
  const dragTabRef = useRef<{ idx: number; from: 'primary' | 'split' } | null>(null)
  const splitRatioRef = useRef(splitRatio)
  splitRatioRef.current = splitRatio

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

  useEffect(() => {
    localStorage.setItem('la-app-view', appView)
  }, [appView])

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
    refreshGoals()
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
  function openPdf(path: string, page?: number) {
    flushSaves()
    if (Number.isFinite(page) && page && page > 0) setPdfJump({ path, page, ts: Date.now() })
    setTabs((ts) => {
      const i = ts.findIndex((t) => t.kind === 'pdf' && t.path === path)
      if (i >= 0) {
        setActiveIdx(i)
        return ts
      }
      const next = [...ts]
      next.splice(activeIdxRef.current + 1, 0, { kind: 'pdf', path })
      setActiveIdx(next.findIndex((t) => t.kind === 'pdf' && t.path === path))
      return next
    })
  }

  /** PDF 打开后的页码跳转信号（供引用角标带页打开） */
  const [pdfJump, setPdfJump] = useState<{ path: string; page: number; ts: number } | null>(null)

  /** 点击引用角标：解析标题→库内文件→打开 PDF（带页码）或笔记；标题缺失/匹配不到时用 RAG 语义检索兜底。
   *  sourcePath = 当前笔记路径：检索结果排除自己，否则会"打开已打开的笔记"看起来毫无反应。
   *  文件名关键词匹配加分：引文提到的文件名(如 Math_Stat_TIAN)优先于同主题其他资料。 */
  async function openCitation(info: import('./cite').CiteInfo, sourcePath?: string) {
    const title = info.title.replace(/^《/, '').replace(/》$/, '').trim()
    const quote = info.quote || ''
    const pm = /(?:P|p|第)\s*(\d{1,4})(?:\s*[-–—~]\s*\d+)?\s*页?/.exec(quote)
    const page = pm ? parseInt(pm[1], 10) : undefined
    const files = flattenFiles(tree)
    const norm = (s: string) => s.toLowerCase()
    const baseOf = (p: string) => p.split('/').pop() ?? ''
    const stemOf = (p: string) => baseOf(p).replace(/\.(pdf|md)$/i, '')
    const open = (hit: string) => {
      if (/\.pdf$/i.test(hit)) openPdf(hit, page)
      else void openNote(hit)
    }
    // 1) 标题精确/包含匹配（无标题的纯摘录引用跳过此步；命中自己视为未命中）
    if (title) {
      const hit =
        files.find((p) => norm(stemOf(p)) === norm(title)) ??
        files.find((p) => norm(baseOf(p)) === norm(title + '.pdf') || norm(baseOf(p)) === norm(title + '.md')) ??
        files.find((p) => norm(baseOf(p)).includes(norm(title)) && /\.(pdf|md)$/i.test(p))
      if (hit && hit !== sourcePath) {
        open(hit)
        return
      }
    }
    // 2) RAG 语义检索兜底：引用标题常与实际文件名无关（《Foundation of...》→ lecturenote1.pdf），
    //    甚至没有标题（只有摘录），此时用摘录文本检索；ext=PDF 或摘录提到 PDF 时优先命中 PDF 路径（含其标注/卡片块）。
    //    排除当前笔记自己——否则第一名往往是正在看的这篇，表现为"点了没反应"
    try {
      const q = (title || quote).slice(0, 150)
      const r = await fetch(`/api/rag/search?query=${encodeURIComponent(q)}&k=8`).then((x) => x.json())
      // 摘录里提到 PDF、或引用类型标注为 PDF 时优先命中 PDF 路径
      const wantPdf = /pdf/i.test(info.ext) || /pdf/i.test(quote)
      const pool = (r.results ?? [])
        .filter((x: { path: string }) => /\.(pdf|md)$/i.test(x.path) && x.path !== sourcePath)
      // 引文里的关键词（≥4 位字母数字段）与文件名重叠越多越优先：同名教材优先于同主题的其他资料
      const qTokens = q.toLowerCase().match(/[a-z0-9_]{4,}/g) ?? []
      const byMatch = [...pool].sort(
        (a: { path: string }, b: { path: string }) =>
          qTokens.filter((tk) => baseOf(b.path).toLowerCase().includes(tk)).length -
          qTokens.filter((tk) => baseOf(a.path).toLowerCase().includes(tk)).length,
      )
      const pick = wantPdf
        ? byMatch.find((x: { path: string }) => /\.pdf$/i.test(x.path)) ?? pool[0]
        : byMatch.find((x: { path: string }) => /\.md$/i.test(x.path)) ?? pool[0]
      if (pick) {
        open((pick as { path: string }).path)
        return
      }
    } catch {
      /* 检索失败按未找到处理 */
    }
    toast(`知识库中未找到「${title || '该来源'}」`)
  }

  async function openNote(path: string) {
    if (path.toLowerCase().endsWith('.pdf')) {
      openPdf(path)
      return
    }
    if (!path.toLowerCase().endsWith('.md')) {
      toast('非 Markdown 文件请在「资料」预览器中查看')
      openRefs()
      return
    }
    flushSaves()
    setTabs((ts) => {
      const i = ts.findIndex((t) => t.kind === 'note' && t.path === path)
      if (i >= 0) {
        if (i >= MAX_VISIBLE_TABS) return activateTabReal(ts, i)
        setActiveIdx(i)
        return ts
      }
      const next = [...ts]
      next.splice(activeIdx + 1, 0, { kind: 'note', path })
      const ai = next.findIndex((t) => t.kind === 'note' && t.path === path)
      if (ai >= MAX_VISIBLE_TABS) return activateTabReal(next, ai)
      setActiveIdx(ai)
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
      if (appViewRef.current === 'ide') return // IDE 模式由 IdeShell 自管快捷键
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

  // ── 标签拖拽：排序 / 左右分屏停靠 ────────────────────────────────────────
  function moveTab(from: number, to: number) {
    setTabs((ts) => {
      const next = [...ts]
      const [tab] = next.splice(from, 1)
      next.splice(to, 0, tab)
      return next
    })
    setActiveIdx(to)
  }

  function dockTab(idx: number) {
    const tab = tabs[idx]
    if (!tab) return
    flushSaves()
    const next = tabs.filter((_, i) => i !== idx)
    if (splitTab) next.splice(Math.min(activeIdx, next.length), 0, splitTab) // 原副面板标签退回标签栏
    setTabs(next)
    setActiveIdx((ai) => (idx < ai ? Math.max(0, ai - 1) : Math.min(ai, next.length - 1)))
    setSplitTab(tab)
    setDragActive(false)
    setDragZone(null)
  }

  function undockSplit(atIdx?: number) {
    if (!splitTab) return
    flushSaves()
    const next = [...tabs]
    const pos = atIdx ?? Math.min(activeIdx + 1, next.length)
    next.splice(pos, 0, splitTab)
    setTabs(next)
    setActiveIdx(pos)
    setSplitTab(null)
    setDragActive(false)
    setDragZone(null)
  }

  function endTabDrag() {
    dragTabRef.current = null
    setDragActive(false)
    setDragOverIdx(null)
    setDragZone(null)
  }

  function onTabDragStart(e: React.DragEvent, idx: number) {
    dragTabRef.current = { idx, from: 'primary' }
    setDragActive(true)
    e.dataTransfer.effectAllowed = 'move'
    try {
      e.dataTransfer.setData('text/plain', 'path' in tabs[idx] ? tabs[idx].path : tabs[idx].kind)
    } catch {
      /* ignore */
    }
  }

  function onTabDragOver(e: React.DragEvent, idx: number) {
    const d = dragTabRef.current
    if (!d || d.from !== 'primary' || d.idx === idx) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setDragOverIdx(e.clientX < rect.left + rect.width / 2 ? idx : idx + 1)
  }

  function onTabDrop(e: React.DragEvent) {
    e.preventDefault()
    const d = dragTabRef.current
    const to = dragOverIdx
    if (d && d.from === 'primary' && to != null) {
      let target = to
      if (d.idx < to) target -= 1
      if (target !== d.idx) moveTab(d.idx, target)
    }
    endTabDrag()
  }

  function startSplitResize(e: React.MouseEvent) {
    e.preventDefault()
    const wsEl = (e.currentTarget as HTMLElement).parentElement
    const w0 = wsEl?.clientWidth || window.innerWidth
    const startR = splitRatioRef.current
    const startX = e.clientX
    function onMove(ev: MouseEvent) {
      const ratio = Math.min(0.75, Math.max(0.25, startR + (ev.clientX - startX) / w0))
      setSplitRatio(Number(ratio.toFixed(3)))
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      localStorage.setItem('la-split-ratio', String(splitRatioRef.current))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
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
  const activePdfPath = activeTab?.kind === 'pdf' ? activeTab.path : null
  const activeDocPath = activeNotePath ?? activePdfPath

  // 切换标签/文档时关闭答疑面板（面板严格绑定其笔记/文档）
  useEffect(() => {
    setTutorFor((cur) => (cur && activeDocPath !== cur ? null : cur))
  }, [activeDocPath])

  // ── 新建 / 删除 / 改名 ──────────────────────────────────────────────────
  async function createEntry(_parent: string | null, kind: 'file' | 'folder', name: string) {
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
  async function sendToAgent(text: string, attachments: WriterAttachment[] = [], modeOverride?: string) {
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
      await api.sendAgent(text, modeOverride ?? mode, attachments, selectedGoalId || undefined)
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
        refreshGoals()
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
            if (at >= MAX_VISIBLE_TABS) return activateTabReal(next, at)
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
        refreshGoals()
        api.getGraph().then(setGraph).catch(() => undefined)
        if (error) toast(error, true)
        break
      }
    }
  })

  const vaultName = vaultPath ? vaultPath.replace(/\\/g, '/').split('/').pop() || vaultPath : ''

  /** 渲染一个标签页的内容（主面板 / 分屏副面板共用）；isSplit=true 时无答疑面板与冲突条 */
  function renderPaneContent(tab: Tab, isSplit: boolean) {
    if (tab.kind === 'note') {
      const p = tab.path
      return (
        <>
          {!isSplit && conflicts[p] && (
            <div className="conflict-tip">
              <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
                warning
              </span>
              该文件刚被外部（可能是 agent）更新，而本地有未保存的修改。
              <button
                onClick={() => {
                  void api
                    .getFile(p)
                    .then((f) => setContents((c) => ({ ...c, [p]: f.content })))
                  setConflicts((cf) => ({ ...cf, [p]: false }))
                }}
              >
                加载新版本
              </button>
              <button onClick={() => setConflicts((cf) => ({ ...cf, [p]: false }))}>忽略</button>
            </div>
          )}
          <div className={`editor-stack ${tutorFor === p && !isSplit ? 'tutor-open' : ''}`}>
            {contents[p] !== undefined ? (
              <EditorPane
                key={p}
                path={p}
                content={contents[p]}
                streaming={Boolean(streaming[p])}
                dark={dark}
                onEdit={handleEdit}
                onWikilink={openWikilink}
                onOpenCite={(info) => void openCitation(info, p)}
                onMarkLearned={(pp, title) => void markLearned(pp, title)}
                learnedRunning={Boolean(learnedFlow)}
                celebrate={celebratePath === p}
                tutorOpen={tutorFor === p && !isSplit}
                onToggleTutor={() => setTutorFor((cur) => (cur === p ? null : p))}
              />
            ) : (
              <div className="empty-state">
                <span className="material-symbols-rounded">progress_activity</span>
                加载中…
              </div>
            )}
            {tutorFor === p && !isSplit && (
              <TutorPanel
                notePath={p}
                noteTitle={p.split('/').pop()?.replace(/\.md$/, '') ?? ''}
                width={tutorWidth}
                onResizeStart={(e) => startResize(e, 'tutor')}
                onClose={() => setTutorFor(null)}
                onOpenSource={(info) => void openCitation(info, p)}
              />
            )}
          </div>
        </>
      )
    }
    if (tab.kind === 'pdf') {
      const p = tab.path
      return (
        <div className="editor-stack">
          <PdfStudyPane
            path={p}
            dark={dark}
            files={flattenFiles(tree)}
            jumpHint={pdfJump?.path === p ? pdfJump : undefined}
            onComposeNotes={(message, attachments) => void sendToAgent(message, attachments, '写作')}
          />
        </div>
      )
    }
    if (tab.kind === 'graph') return <GraphView graph={graph} onOpenNote={(path) => void openNote(path)} />
    if (tab.kind === 'refs')
      return <ReferenceBrowser tree={tree} dark={dark} onOpenNote={(path) => void openNote(path)} onOpenPdf={openPdf} />
    return (
      <div className="empty-state">
        <span className="material-symbols-rounded">note_stack</span>
        <div>从左侧打开一篇笔记，或用下方输入框与 agent 交流</div>
      </div>
    )
  }

  // IDE 模式：整个界面切换为 IDE 壳（代码编辑 / md 分屏 / PDF 阅读），与学习模式互斥
  if (appView === 'ide') {
    return (
      <Suspense fallback={<div className="ide-boot">IDE 加载中…</div>}>
        <IdeShell dark={dark} onToggleTheme={() => setDark((d) => !d)} onExit={() => setAppView('learn')} />
      </Suspense>
    )
  }

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
        onOpenDialog={setDialog}
        onOpenGraph={openGraph}
        onOpenRefs={openRefs}
        onOpenIde={() => setAppView('ide')}
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
      <div className="app-main" style={{ ['--tutor-w' as string]: `${tutorWidth}px` }}>
        <div className="tabbar">
          <button
            className="icon-btn"
            title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            onClick={() => setSidebarCollapsed((c) => !c)}
            style={{ marginBottom: 4 }}
          >
            <span className="material-symbols-rounded">{sidebarCollapsed ? 'menu' : 'left_panel_close'}</span>
          </button>
          <div className="tabbar-scroll">
          {tabs.slice(0, MAX_VISIBLE_TABS).map((tab, i) => {
            const tabKey = tab.kind === 'note' ? tab.path : tab.kind === 'pdf' ? `pdf:${tab.path}` : tab.kind
            const tabTitle =
              tab.kind === 'graph'
                ? '知识图谱'
                : tab.kind === 'refs'
                  ? '资料'
                  : tab.path.split('/').pop()?.replace(/\.(md|pdf)$/i, '') ?? ''
            return (
              <div
                key={tabKey}
                draggable
                onDragStart={(e) => onTabDragStart(e, i)}
                onDragOver={(e) => onTabDragOver(e, i)}
                onDrop={onTabDrop}
                onDragEnd={endTabDrag}
                className={`tab ${i === activeIdx ? 'active' : ''}${dragOverIdx === i ? ' drop-before' : ''}${
                  dragOverIdx === i + 1 ? ' drop-after' : ''
                }${dragActive && dragTabRef.current?.idx === i ? ' dragging' : ''}`}
                onClick={() => {
                  flushSaves()
                  setActiveIdx(i)
                }}
              >
                <span className="material-symbols-rounded">
                  {tab.kind === 'graph' ? 'hub' : tab.kind === 'refs' ? 'folder_open' : tab.kind === 'pdf' ? 'picture_as_pdf' : 'description'}
                </span>
                <span className="tab-title">{tabTitle}</span>
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
            )
          })}
          {splitTab && (
            <div
              key={
                'split:' +
                (splitTab.kind === 'graph' || splitTab.kind === 'refs'
                  ? splitTab.kind
                  : `${splitTab.kind}:${splitTab.path}`)
              }
              draggable
              onDragStart={(e) => {
                dragTabRef.current = { idx: -1, from: 'split' }
                setDragActive(true)
                e.dataTransfer.effectAllowed = 'move'
                try {
                  e.dataTransfer.setData('text/plain', splitTab && 'path' in splitTab ? splitTab.path : splitTab.kind)
                } catch {
                  /* ignore */
                }
              }}
              onDragEnd={endTabDrag}
              className="tab docked"
              title="分屏页面：拖回标签栏取消分屏，拖到右缘区更换分屏内容"
            >
              <span className="material-symbols-rounded">splitscreen_right</span>
              <span className="tab-title">
                {splitTab.kind === 'graph'
                  ? '知识图谱'
                  : splitTab.kind === 'refs'
                    ? '资料'
                    : splitTab.path.split('/').pop()?.replace(/\.(md|pdf)$/i, '') ?? ''}
              </span>
              <span
                className="close"
                onClick={(e) => {
                  e.stopPropagation()
                  setSplitTab(null)
                }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 14 }}>
                  close
                </span>
              </span>
            </div>
          )}
          </div>
                    {tabs.length > MAX_VISIBLE_TABS && (
            <div className="tab-fold">
              <button
                className={`tab-fold-btn${foldOpen ? ' open' : ''}`}
                title={`折叠的标签（${tabs.length - MAX_VISIBLE_TABS}）——点击展开列表`}
                onClick={() => setFoldOpen((o) => !o)}
              >
                <span className="material-symbols-rounded">keyboard_double_arrow_left</span>
                {tabs.length - MAX_VISIBLE_TABS}
                {foldedStreaming && <span className="dot" />}
              </button>
              {foldOpen && (
                <div className="tab-fold-menu">
                  {tabs.slice(MAX_VISIBLE_TABS).map((tab, k) => {
                    const realIdx = MAX_VISIBLE_TABS + k
                    const tabKey = tab.kind === 'note' ? tab.path : tab.kind === 'pdf' ? `pdf:${tab.path}` : tab.kind
                    const tabTitle =
                      tab.kind === 'graph'
                        ? '知识图谱'
                        : tab.kind === 'refs'
                          ? '资料'
                          : tab.path.split('/').pop()?.replace(/\.(md|pdf)$/i, '') ?? ''
                    return (
                      <div key={tabKey} className="tab-fold-item">
                        <button
                          className="tf-open"
                          onClick={() => {
                            flushSaves()
                            setTabs((ts) => activateTabReal(ts, realIdx))
                            setFoldOpen(false)
                          }}
                        >
                          <span className="material-symbols-rounded">
                            {tab.kind === 'graph' ? 'hub' : tab.kind === 'refs' ? 'folder_open' : tab.kind === 'pdf' ? 'picture_as_pdf' : 'description'}
                          </span>
                          <span className="tab-title">{tabTitle}</span>
                          {streaming[tab.kind === 'note' ? tab.path : ''] && <span className="dot" />}
                        </button>
                        <button
                          className="tf-close"
                          title="直接关闭"
                          onClick={(e) => {
                            e.stopPropagation()
                            closeTab(realIdx)
                          }}
                        >
                          <span className="material-symbols-rounded" style={{ fontSize: 14 }}>
                            close
                          </span>
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div
          className="workspace"
          style={
            splitTab
              ? ({ ['--split-ratio' as string]: `${splitRatio * 100}%` } as React.CSSProperties)
              : undefined
          }
        >
          <div className="pane pane-primary">
            {activeTab ? (
              renderPaneContent(activeTab, false)
            ) : (
              <div className="empty-state">
                <span className="material-symbols-rounded">note_stack</span>
                <div>从左侧打开一篇笔记，或用下方输入框与 agent 交流</div>
              </div>
            )}
          </div>
          {splitTab && <div className="split-divider" onMouseDown={startSplitResize} />}
          {splitTab && <div className="pane pane-secondary">{renderPaneContent(splitTab, true)}</div>}
        </div>

        {dragActive && (
          <>
            <div
              className={`ws-drop ws-drop-left${dragZone === 'left' ? ' hover' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragZone('left')
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragTabRef.current?.from === 'split') undockSplit()
                endTabDrag()
              }}
            >
              <span className="material-symbols-rounded">align_horizontal_left</span>
              <div>在主面板打开</div>
            </div>
            <div
              className={`ws-drop ws-drop-right${dragZone === 'right' ? ' hover' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragZone('right')
              }}
              onDrop={(e) => {
                e.preventDefault()
                const d = dragTabRef.current
                if (d?.from === 'primary') dockTab(d.idx)
                endTabDrag()
              }}
            >
              <span className="material-symbols-rounded">splitscreen_right</span>
              <div>停靠到右侧分屏</div>
            </div>
          </>
        )}

        <InputBar
          agent={agent}
          mode={mode}
          onModeChange={setMode}
          onSend={(t, attachments) => void sendToAgent(t, attachments)}
          onStop={stopAgent}
          answering={Boolean(pendingQuestion)}
          files={flattenFiles(tree)}
          engine={settings?.engine}
          onOpenEngineSettings={() => setSettingsOpen(true)}
          planChip={<GoalPicker goals={goals} selectedId={selectedGoalId} onSelect={(id) => { setSelectedGoalId(id); localStorage.setItem('la-goal', id) }} />}
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
            toast(s.engine === 'zcode' ? '已保存：当前引擎 ZCode（本机智能体）' : '已保存：当前引擎 API 服务')
          }}
        />
      )}
      {dialog && <PromptDialog spec={dialog} onClose={() => setDialog(null)} />}
      <Toasts items={toasts} />
    </div>
  )
}
