import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import RichText from '../components/RichText'
import InlineMarkdown from '../noteui/InlineMarkdown'
import { splitFrontmatter } from '../frontmatter'
import { loadWorkspace, readWorkspaceNote, type WorkspaceFile, type WorkspaceSnapshot } from './backend'
import { exampleNote, initialReply, proofReply, quizReply } from './content'
import type { GraphData } from '../types'
import 'katex/dist/katex.min.css'
import './workspace.css'

const KnowledgeGraph = lazy(() => import('../components/GraphView'))
type View = 'desk' | 'library' | 'graph' | 'goals'
type Message = { role: 'user' | 'assistant'; text: string; image?: string }
const icon = (name: string) => <span className="material-symbols-rounded" aria-hidden="true">{name}</span>
const demoFiles: WorkspaceFile[] = [
  { name: '相邻交换与逆序对', path: 'example/swap.md', type: 'note', folder: '算法与数据结构' },
  { name: '随机变量与分布函数', path: 'example/probability.md', type: 'note', folder: '概率论' },
  { name: '学习工作台使用说明', path: 'example/guide.md', type: 'note', folder: '开始使用' },
]
const graphExample: GraphData = { version: 1, updatedAt: '', nodes: ['相邻交换', '逆序对', '树状数组', '坐标压缩', '归并排序'].map((title, i) => ({ id: String(i), title, field: '算法', mastery: 0, status: 'learnable', note: 'example/swap.md', updatedAt: '' })), edges: [{ from: '0', to: '1', type: 'depends-on' }, { from: '1', to: '2', type: 'leads-to' }, { from: '2', to: '3', type: 'depends-on' }, { from: '1', to: '4', type: 'relates-to' }] }
const emptySnapshot: WorkspaceSnapshot = { files: [], graph: { version: 1, updatedAt: '', nodes: [], edges: [] }, goals: [], connected: false, model: '' }

function SwapWalkthrough() {
  const [step, setStep] = useState(0)
  const states = [[3, 1, 2], [1, 3, 2], [1, 2, 3]]
  const explanations = ['先观察：3 的右边，有 1 和 2 两个更小的数。', '交换 3 和 1，支付较小值 1。一个逆序对消失了。', '交换 3 和 2，再支付 2。数组有序，总代价为 3。']
  return <section className="studio-walk" aria-label="相邻交换样例">
    <div className="studio-walk-head"><strong>让结论走一遍</strong><span>示例 [3, 1, 2]</span></div>
    <div className="studio-walk-stage"><div className="studio-array" aria-label={`当前数组 ${states[step].join(',')}`}>{states[step].map(value => <div key={value} className={`studio-array-cell ${step === 2 ? 'sorted' : value === 3 ? 'moving' : ''}`}>{value}</div>)}</div><div className="studio-cost"><span>累计代价</span><strong>{[0, 1, 3][step]}</strong></div></div>
    <p aria-live="polite">{explanations[step]}</p>
    <div className="studio-walk-footer"><span>第 {step + 1} / 3 步</span><div><button onClick={() => setStep(0)} disabled={!step} aria-label="重置交换样例">{icon('replay')}</button><button className="studio-text-action" disabled={step === 2} onClick={() => setStep(s => s + 1)}>下一步 {icon('arrow_forward')}</button></div></div>
  </section>
}

export default function LearningWorkspace() {
  const [view, setView] = useState<View>('desk'), [snapshot, setSnapshot] = useState(emptySnapshot), [loaded, setLoaded] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem('la-design-variant') || 'desk')
  const [dark, setDark] = useState(() => localStorage.getItem('la-design-dark') === '1')
  const [fontSize, setFontSize] = useState(16), [editing, setEditing] = useState(false)
  const [document, setDocument] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem('la-design-draft') || 'null'); if (saved && typeof saved.name === 'string' && typeof saved.path === 'string' && typeof saved.content === 'string' && typeof saved.example === 'boolean') return saved as { name: string; path: string; content: string; example: boolean } } catch { /* Use the authored example when no valid preview draft exists. */ }
    return { name: '相邻交换与逆序对', path: 'example/swap.md', content: exampleNote, example: true }
  })
  const [source, setSource] = useState(document.content), [busy, setBusy] = useState(false), [filter, setFilter] = useState('')
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', text: initialReply }])
  const [input, setInput] = useState(''), [intent, setIntent] = useState('讲解'), [replying, setReplying] = useState(false)
  const [assistantTab, setAssistantTab] = useState<'chat' | 'activity'>('chat'), [activity, setActivity] = useState<string[]>([])
  const [mobileNav, setMobileNav] = useState(false), [mobileAI, setMobileAI] = useState(false), [aiVisible, setAIVisible] = useState(true)
  const [attachment, setAttachment] = useState<{ name: string; url: string } | null>(null), [notice, setNotice] = useState('')
  const [planStep, setPlanStep] = useState(0)
  const searchDialog = useRef<HTMLDialogElement>(null), settingsDialog = useRef<HTMLDialogElement>(null), fileInput = useRef<HTMLInputElement>(null)
  const searchInput = useRef<HTMLInputElement>(null), replyTimer = useRef<ReturnType<typeof setTimeout>>(), messageEnd = useRef<HTMLDivElement>(null)
  const files = snapshot.connected ? snapshot.files.filter(f => f.type === 'note' || f.type === 'pdf') : demoFiles
  const searchFiles = files.filter(f => `${f.name} ${f.folder}`.toLowerCase().includes(filter.toLowerCase()))

  useEffect(() => { let active = true; loadWorkspace().then(s => { if (active) { setSnapshot(s); setLoaded(true) } }); return () => { active = false; clearTimeout(replyTimer.current) } }, [])
  useEffect(() => { window.document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('la-design-dark', dark ? '1' : '0') }, [dark])
  useEffect(() => { localStorage.setItem('la-design-variant', theme) }, [theme])
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(timer) }, [notice])
  useEffect(() => { if (attachment) return () => URL.revokeObjectURL(attachment.url) }, [attachment])
  useEffect(() => { if (messages.length > 1) messageEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' }) }, [messages])
  useEffect(() => { const key = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchDialog.current?.showModal(); searchInput.current?.focus() } if (event.key === 'Escape') { setMobileNav(false); setMobileAI(false) } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key) }, [])

  function navigate(next: View) { setView(next); setMobileNav(false); setFilter('') }
  async function openFile(file: WorkspaceFile) {
    searchDialog.current?.close(); setMobileNav(false)
    if (file.type === 'pdf') { window.open('/api/raw?path=' + encodeURIComponent(file.path), '_blank', 'noopener,noreferrer'); return }
    setBusy(true); setView('desk'); setEditing(false)
    try {
      const content = file.path.startsWith('example/') ? file.path.includes('probability') ? '# 随机变量与分布函数\n\n随机变量将样本空间中的结果映射到实数。\n\n$$F_X(x)=P(X\\le x)$$\n\n<!-- ui:concept -->\n\n|概念|含义|\n|---|---|\n|随机变量|可测的实值函数|\n|分布函数|$F_X(x)=P(X\\le x)$|\n' : file.path.includes('guide') ? '# 从一个问题开始\n\n打开笔记，在旁边与AI讨论。适合比较、推导或练习的内容，会由NoteUI呈现为交互组件。\n\n这是设计初稿，AI回复为演示，文件读取可使用现有后端。' : exampleNote : await readWorkspaceNote(file.path)
      setDocument({ name: file.name, path: file.path, content, example: file.path.startsWith('example/') }); setSource(content)
    } catch (error) { setNotice('无法打开文件：' + (error as Error).message) } finally { setBusy(false) }
  }
  function sendExample(text = input) {
    if ((!text.trim() && !attachment) || replying) return
    setMessages(m => [...m, { role: 'user', text: text.trim() || '请讲解这张题图。', image: attachment?.url }]); setInput(''); setReplying(true); setAssistantTab('chat'); setMobileAI(true)
    const imageHint = attachment ? '图片已在浏览器中加入问题预览。本次演示不会上传或识别图片；正式接入将复用现有视觉请求链路。\n\n' : ''
    setAttachment(null)
    setActivity(a => [...a, '已接收问题 · 演示模式', '材料范围：' + document.name])
    replyTimer.current = setTimeout(() => {
      const reply = /自测|考考|练习/.test(text) || intent === '自测' ? quizReply : /整理|笔记|总结/.test(text) || intent === '整理' ? '可以把这部分整理成“必要开销 → 下界 → 可达性 → 实现”的学习路径。\n\n这是改写交互示例。实际接入时，会先展示修改预览和目标文件，确认后通过现有写入工具保存。' : proofReply
      setMessages(m => [...m, { role: 'assistant', text: imageHint + (document.example ? reply : '当前材料已切换为 **' + document.name.replace(/[*_`]/g, '') + '**。正式接入时，回答会基于该文件及检索结果。\n\n这版页面正在演示交互，下面用示例算法展示回答的排版：\n\n' + reply) }]); setReplying(false); setActivity(a => [...a, '演示回复完成 · 未调用模型 / 未写入笔记'])
    }, 650)
  }
  function addImage(file?: File) {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) { setNotice('请选择 PNG、JPEG、WebP 或 GIF 图片'); return }
    if (!file.size || file.size > 10 * 1024 * 1024) { setNotice('图片需大于0且不超过10MB'); return }
    const reader = new FileReader()
    reader.onload = () => setAttachment({ name: file.name, url: String(reader.result) })
    reader.onerror = () => setNotice('图片读取失败，请重新选择')
    reader.readAsDataURL(file)
  }
  function saveDraft() { try { localStorage.setItem('la-design-draft', JSON.stringify({ ...document, content: source })); setDocument(d => ({ ...d, content: source })); setEditing(false); setNotice('预览草稿已保存到浏览器，真实文件未改动') } catch { setNotice('浏览器无法保存草稿，请复制源码保留修改') } }
  function newDraft() { setDocument({ name: '未命名学习笔记', path: 'example/new.md', content: '# 未命名学习笔记\n\n写下你想理解的问题。', example: true }); setSource('# 未命名学习笔记\n\n写下你想理解的问题。'); setView('desk'); setEditing(true); setMobileNav(false) }
  const nav = [{ id: 'desk' as const, name: '学习工作台', symbol: 'space_dashboard' }, { id: 'library' as const, name: '笔记与资料', symbol: 'folder_open' }, { id: 'graph' as const, name: '知识图谱', symbol: 'hub' }, { id: 'goals' as const, name: '学习路径', symbol: 'route' }]
  const body = splitFrontmatter(document.content).body.trimStart()
  const leadingHeading = /^# ([^\n]+)\n?/.exec(body)
  const readingBody = leadingHeading ? body.slice(leadingHeading[0].length) : body

  return <div className={`studio studio-${theme} ${dark ? 'studio-dark' : ''} ${!aiVisible ? 'studio-ai-hidden' : ''}`} style={{ '--studio-reading-size': `${fontSize}px` } as React.CSSProperties}>
    <a className="studio-skip" href="#studio-content">跳到学习内容</a>
    {(mobileNav || mobileAI) && <button className="studio-scrim" aria-label="关闭侧边面板" onClick={() => { setMobileNav(false); setMobileAI(false) }} />}
    <aside className={`studio-nav ${mobileNav ? 'is-open' : ''}`} aria-label="主导航">
      <a className="studio-logo" href="?design=workspace">{icon('local_library')}<span>LearnAgent<span className="studio-logo-sub">让知识，成为自己的。</span></span></a>
      <button className="studio-search-trigger" onClick={() => { searchDialog.current?.showModal(); searchInput.current?.focus() }}>{icon('search')}<span>搜索你的知识库</span><kbd>Ctrl K</kbd></button>
      <nav>{nav.map(item => <button key={item.id} className={view === item.id ? 'selected' : ''} aria-current={view === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>{icon(item.symbol)}<span>{item.name}</span>{item.id === 'library' && <small>{files.length || '—'}</small>}</button>)}</nav>
      <div className="studio-nav-section"><div className="studio-section-label">正在学习<button aria-label="新建预览笔记" onClick={newDraft}>{icon('add')}</button></div><button className="studio-topic active" onClick={() => { void openFile(demoFiles[0]) }}><i className="studio-topic-dot" />算法与数据结构</button><div className="studio-recent-note"><button onClick={() => { void openFile(demoFiles[0]) }}>相邻交换与逆序对</button><button onClick={() => { void openFile(demoFiles[1]) }}>随机变量与分布函数</button></div></div>
      <div className="studio-nav-section"><div className="studio-section-label">最近的讨论</div><button className="studio-history" onClick={() => { setAIVisible(true); setMobileAI(true); setAssistantTab('chat') }}>{icon('chat_bubble_outline')}为什么交换顺序不重要？</button><span className="studio-demo-label">示例会话</span></div>
      <div className="studio-nav-bottom"><div className="studio-connection"><i className={snapshot.connected ? 'connected' : ''} /><span>{!loaded ? '正在连接知识库…' : snapshot.connected ? '已连接本地知识库' : '示例工作区 · 后端离线'}</span></div><button className="studio-user" onClick={() => settingsDialog.current?.showModal()}><span className="studio-avatar">我</span><span>我的学习空间<small>外观与工作台设置</small></span>{icon('tune')}</button></div>
    </aside>

    <main className="studio-main" id="studio-content">
      <header className="studio-topbar"><button className="studio-mobile-menu studio-icon-button" aria-label="打开导航" onClick={() => setMobileNav(true)}>{icon('menu')}</button><div className="studio-breadcrumb"><span>我的空间</span>{icon('chevron_right')}<strong>{nav.find(n => n.id === view)?.name}</strong></div><div className="studio-top-actions"><span className="studio-preview-tag">交互初稿</span><button className="studio-icon-button" aria-label={dark ? '切换亮色' : '切换暗色'} onClick={() => setDark(!dark)}>{icon(dark ? 'light_mode' : 'dark_mode')}</button><button className={`studio-ai-toggle ${aiVisible ? 'active' : ''}`} aria-label="打开AI协作" onClick={() => { setAIVisible(!aiVisible); setMobileAI(true) }}>{icon('side_navigation')}<span>AI 协作</span></button></div></header>
      {view === 'desk' ? <>
        <div className="studio-document-bar"><div>{icon('description')}<span title={document.path}>{document.name}</span><span className="studio-draft-state">{document.example ? '示例笔记' : '本地文件 · 只读预览'}</span></div><div className="studio-document-actions"><div className="studio-read-switch" aria-label="笔记显示方式"><button aria-pressed={!editing} onClick={() => setEditing(false)}>阅读</button><button aria-pressed={editing} onClick={() => { setSource(document.content); setEditing(true) }}>源码</button></div><button className="studio-icon-button" aria-label="工作台外观" onClick={() => settingsDialog.current?.showModal()}>{icon('text_fields')}</button></div></div>
        <div className="studio-reading-scroll">{busy ? <div className="studio-loading" role="status">正在读取笔记…</div> : editing ? <section className="studio-source"><header><span>Markdown 源码 · 保留全部 NoteUI 指令</span><button className="studio-primary" onClick={saveDraft}>保存预览</button></header><textarea aria-label="笔记原始Markdown" spellCheck={false} value={source} onChange={e => setSource(e.target.value)} /></section> : <article className="studio-article"><h1><InlineMarkdown text={leadingHeading?.[1] || document.name} /></h1><div className="studio-note-meta"><span>{document.example ? '约 5 分钟阅读' : 'Markdown 原文'}</span></div>{document.path === 'example/swap.md' && <><p className="studio-article-lead">把看似复杂的交换过程，化成每个逆序对的必要开销。</p><div className="studio-note-tags"><span>贪心</span><span>逆序对</span><span>树状数组</span></div><SwapWalkthrough /></>}<RichText text={readingBody} /><div className="studio-note-end"><span>理解之后，试着自己讲一遍。</span><button onClick={() => { setAIVisible(true); sendExample('出一道自测，检查我的理解') }}>{icon('quiz')}检查理解</button></div></article>}</div>
      </> : view === 'library' ? <section className="studio-list-page"><div className="studio-page-heading"><div><h1>笔记与资料</h1><p>让每一个想法，都有迹可循。</p></div><button className="studio-primary" onClick={newDraft}>{icon('add')}新建草稿</button></div><div className="studio-list-filter">{icon('search')}<input aria-label="筛选笔记与资料" value={filter} onChange={e => setFilter(e.target.value)} placeholder="按名称、学科或路径查找" /><span>{searchFiles.length} 个文件</span></div><div className="studio-file-list">{searchFiles.map(file => <button key={file.path} onClick={() => { void openFile(file) }}><span className={`studio-file-icon ${file.type}`}>{icon(file.type === 'pdf' ? 'picture_as_pdf' : 'description')}</span><span><strong>{file.name}</strong><small>{file.folder || '知识库根目录'}</small></span><span className="studio-file-kind">{file.type === 'pdf' ? 'PDF' : 'Markdown'}</span>{icon('arrow_outward')}</button>)}{!searchFiles.length && <div className="studio-empty">{icon('search_off')}<h2>没有找到匹配的资料</h2><p>换一个关键词，或新建一篇预览草稿。</p><button onClick={() => setFilter('')}>清除筛选</button></div>}</div></section> : view === 'graph' ? <section className="studio-list-page studio-map-page"><div className="studio-page-heading"><div><h1>知识图谱</h1><p>看见知识之间的联系，找到下一步。</p></div><span className="studio-preview-tag">{snapshot.graph.nodes.length ? '本地知识网络' : '示例关系'}</span></div><div className="studio-map"><Suspense fallback={<div className="studio-loading">正在展开知识网络…</div>}><KnowledgeGraph graph={snapshot.graph.nodes.length ? snapshot.graph : graphExample} onOpenNote={path => { const file = files.find(f => f.path === path) || demoFiles[0]; void openFile(file) }} /></Suspense></div><p className="studio-page-help">滚轮缩放 · 拖动探索 · 点击节点查看关联笔记</p></section> : <section className="studio-list-page"><div className="studio-page-heading"><div><h1>学习路径</h1><p>把一个大目标，拆成能理解、能检验的下一步。</p></div><span className="studio-preview-tag">{snapshot.goals.length ? '本地学习目标' : '路径示例'}</span></div>{snapshot.goals.length ? snapshot.goals.map(goal => <button className="studio-goal-row" key={goal.id} onClick={() => { void openFile({ name: goal.title, path: goal.path, type: 'note', folder: '' }) }}><strong>{goal.title}</strong><span>{goal.currentStage || goal.standard}</span>{icon('arrow_forward')}</button>) : <><div className="studio-path-title">掌握逆序对与树状数组<span>3 个学习阶段 · 演示数据</span></div><ol className="studio-path">{['建立直觉：相对顺序与逆序对', '理解方法：从下界到最优解', '独立实现：树状数组与坐标压缩'].map((label, i) => <li className={planStep === i ? 'current' : planStep > i ? 'done' : ''} key={label}><button onClick={() => setPlanStep(i)}><span>{planStep > i ? icon('check') : i + 1}</span><div><strong>{label}</strong><small>{['先用三个元素，观察一次交换发生了什么。', '能够解释必要开销，以及它为什么可以达到。', '写出代码，再用边界样例检验自己的理解。'][i]}</small></div>{icon('chevron_right')}</button></li>)}</ol><button className="studio-primary" onClick={() => { void openFile(demoFiles[0]) }}>打开对应学习笔记 {icon('arrow_forward')}</button></>}</section>}
    </main>

    <aside className={`studio-assistant ${mobileAI ? 'is-open' : ''}`} aria-label="AI协作面板">
      <div className="studio-ai-header"><div><span className="studio-ai-mark">{icon('cognition')}</span><strong>一起想清楚</strong></div><button className="studio-icon-button" aria-label="关闭AI协作" onClick={() => { setMobileAI(false); setAIVisible(false) }}>{icon('close')}</button></div>
      <div className="studio-ai-tabs"><button aria-pressed={assistantTab === 'chat'} onClick={() => setAssistantTab('chat')}>协作对话</button><button aria-pressed={assistantTab === 'activity'} onClick={() => setAssistantTab('activity')}>任务记录 {activity.length > 0 && <span>{activity.length}</span>}</button><span>演示模式</span></div>
      <div className="studio-scope"><span>{icon('description')}当前材料</span><strong title={document.name}>{document.name}</strong></div>
      {assistantTab === 'activity' ? <div className="studio-activity"><h3>每一步，都清楚可见</h3><p>真实任务将展示检索、读图、生成及写入状态。</p>{activity.length ? <ol>{activity.map((item, i) => <li key={i}>{icon('check_circle')}<span>{item}</span></li>)}</ol> : <div className="studio-activity-empty">{icon('history')}还没有演示任务。发起一次讲解试试。</div>}</div> : <div className="studio-conversation"><div className="studio-ai-intro"><h2>把“好像懂了”，<br />变成真正理解。</h2><p>围绕当前材料提问，一起拆开难点。</p></div>{messages.map((message, i) => <div className={`studio-message ${message.role}`} key={i}><div className="studio-message-author">{message.role === 'user' ? '你' : <>{icon('cognition')}LearnAgent <small>示例回复</small></>}</div>{message.image && <img src={message.image} alt="本次问题附图" />}<RichText text={message.text} /></div>)}{replying && <div className="studio-replying" role="status">{icon('more_horiz')}正在呈现演示回复…</div>}<div ref={messageEnd} />{messages.length === 1 && <div className="studio-suggestions"><button onClick={() => sendExample('为什么这个下界一定可以达到？')}>为什么这是最优解？ {icon('arrow_outward')}</button><button onClick={() => sendExample('出一道自测题')}>用一道题检查理解 {icon('arrow_outward')}</button></div>}</div>}
      <div className="studio-composer"><div className="studio-intents">{['讲解', '推导', '自测', '整理'].map(item => <button key={item} aria-pressed={intent === item} onClick={() => setIntent(item)}>{item}</button>)}</div><div className="studio-compose-box" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addImage(e.dataTransfer.files[0]) }}>{attachment && <div className="studio-attachment"><img src={attachment.url} alt="待发送图片" /><span>{attachment.name}</span><button aria-label="移除图片" onClick={() => setAttachment(null)}>{icon('close')}</button></div>}<textarea aria-label="向AI提问" placeholder="哪里还没想明白？" value={input} onChange={e => setInput(e.target.value)} onPaste={e => { const file = [...e.clipboardData.files].find(f => f.type.startsWith('image/')); if (file) { e.preventDefault(); addImage(file) } }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendExample() } }} /><div className="studio-compose-actions"><button className="studio-icon-button" aria-label="附加图片" onClick={() => fileInput.current?.click()}>{icon('add_photo_alternate')}</button><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" ref={fileInput} hidden onChange={e => { addImage(e.target.files?.[0]); e.target.value = '' }} /><span>围绕当前笔记</span><button className="studio-send" aria-label="发送演示问题" disabled={replying || (!input.trim() && !attachment)} onClick={() => sendExample()}>{icon('arrow_upward')}</button></div></div><p className="studio-composer-note">初稿使用演示回复，不调用模型、不写入笔记。</p></div>
    </aside>

    <dialog className="studio-dialog" ref={searchDialog} onClick={e => { if (e.target === e.currentTarget) e.currentTarget.close() }}><div className="studio-command"><div className="studio-command-input">{icon('search')}<input ref={searchInput} aria-label="搜索笔记" value={filter} onChange={e => setFilter(e.target.value)} placeholder="想找到哪一份知识？" /><button aria-label="关闭搜索" onClick={() => searchDialog.current?.close()}>{icon('close')}</button></div><div className="studio-command-results">{searchFiles.slice(0, 18).map(file => <button key={file.path} onClick={() => { void openFile(file) }}>{icon(file.type === 'pdf' ? 'picture_as_pdf' : 'description')}<span>{file.name}<small>{file.folder}</small></span>{icon('subdirectory_arrow_left')}</button>)}{!searchFiles.length && <p>没有匹配的笔记，试试其他关键词。</p>}</div><footer>选择一项打开 · Esc 关闭</footer></div></dialog>
    <dialog className="studio-dialog studio-settings" ref={settingsDialog}><header><h2>让工作台适合你</h2><button aria-label="关闭设置" onClick={() => settingsDialog.current?.close()}>{icon('close')}</button></header><label>视觉方向<select aria-label="视觉方向" value={theme} onChange={e => { setTheme(e.target.value); setDark(e.target.value === 'graphite') }}><option value="desk">研习记录台 · 暖白与赤陶</option><option value="reading">批注阅读室 · 白纸与松绿</option><option value="graphite">专注研究台 · 石墨与杏色</option></select></label><label className="studio-settings-toggle">暗色阅读<input type="checkbox" checked={dark} onChange={e => setDark(e.target.checked)} /></label><label>正文字号 <span>{fontSize}px</span><input aria-label="正文字号" type="range" min="15" max="20" value={fontSize} onChange={e => setFontSize(Number(e.target.value))} /></label><div className="studio-settings-backend"><span>现有后端</span><strong>{snapshot.model || '未连接，正在使用本地示例'}</strong><p>初稿只读取资料。模型调用与文件写入继续使用现有系统，下一阶段接入新交互。</p></div><a href="/" className="studio-return">回到正式工作台 {icon('open_in_new')}</a></dialog>
    {notice && <div className="studio-toast" role="status">{icon('info')}<span>{notice}</span><button aria-label="关闭通知" onClick={() => setNotice('')}>{icon('close')}</button></div>}
  </div>
}
