import { useEffect, useRef, useState, type ReactNode } from 'react'
import RichText from './RichText'
import { api } from '../api'
import type { AgentStatus, ConversationMessage, SSEEvent } from '../types'
import type { CiteInfo } from '../cite'

interface Props {
  open: boolean
  width: number
  sessionId: string
  sessionTitle: string
  agent: AgentStatus
  noteTitle?: string
  noteOpen: boolean
  onGlobal: () => void
  onNote: () => void
  onClose: () => void
  onNewSession: () => void
  onResizeStart: (event: React.MouseEvent) => void
  onWikilink: (target: string) => void
  onOpenCite: (info: CiteInfo) => void
  composer: ReactNode
  notePanel?: ReactNode
}

/** Reuses the global agent session and the existing composer; never makes a second model request. */
export default function AssistantPanel(props: Props) {
  const [history, setHistory] = useState<ConversationMessage[]>([])
  const [pending, setPending] = useState<ConversationMessage[]>([])
  const [reply, setReply] = useState('')
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const list = useRef<HTMLDivElement>(null), messageBody = useRef<HTMLDivElement>(null), rail = useRef<HTMLElement>(null)
  const nearBottom = useRef(true), request = useRef(0)
  const requestHistory = useRef<() => void>(() => {})

  useEffect(() => {
    const element = rail.current
    if (!element) return
    if (!props.open && element.contains(document.activeElement)) document.querySelector<HTMLButtonElement>('[aria-controls="global-assistant"]')?.focus()
    element.inert = !props.open
  }, [props.open])
  useEffect(() => {
    const body = messageBody.current
    if (!body) return
    const observer = new ResizeObserver(() => {
      if (nearBottom.current && list.current) { list.current.scrollTop = list.current.scrollHeight; setAtBottom(true) }
    })
    observer.observe(body)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let active = true, buffer = '', timer: ReturnType<typeof setTimeout> | undefined
    setHistory([]); setPending([]); setReply(''); setLoadError(''); nearBottom.current = true
    function refresh(settled = false) {
      if (!props.sessionId) return
      const version = ++request.current
      setLoading(true)
      api.sessionMessages(props.sessionId).then(result => {
        if (!active || version !== request.current) return
        setHistory(result.messages); setLoadError('')
        if (settled) { setPending([]); setReply(''); buffer = '' }
      }).catch(error => { if (active && version === request.current) setLoadError((error as Error).message) })
        .finally(() => { if (active && version === request.current) setLoading(false) })
    }
    requestHistory.current = refresh
    refresh()
    function receive(event: Event) {
      const detail = (event as CustomEvent<SSEEvent>).detail
      if (detail.sessionId && detail.sessionId !== props.sessionId) return
      if (detail.type === 'agent-user') {
        setPending(messages => [...messages, detail.message as unknown as ConversationMessage])
        nearBottom.current = true
      } else if (detail.type === 'agent-reply') {
        buffer = detail.replace ? String(detail.text || '') : buffer + String(detail.text || '')
        if (!timer) timer = setTimeout(() => { if (active) setReply(buffer); timer = undefined }, 80)
      } else if (detail.type === 'agent-done') {
        if (timer) { clearTimeout(timer); timer = undefined }
        setReply(buffer)
        // Failed/stopped turns may not be persisted. Keep their visible reply and user's message.
        if (!detail.error && !detail.stopped) refresh(true)
      }
    }
    window.addEventListener('global-agent-sse', receive)
    return () => { active = false; request.current++; clearTimeout(timer); window.removeEventListener('global-agent-sse', receive) }
  }, [props.sessionId])

  useEffect(() => {
    if (nearBottom.current && list.current) list.current.scrollTop = list.current.scrollHeight
  }, [history, pending, reply, props.agent.message, props.open, props.noteOpen])

  const messages = [...history, ...pending]
  return <aside id="global-assistant" ref={rail} aria-label="AI 协作侧栏" aria-hidden={!props.open}
    className={`assistant-rail${props.open ? ' is-open' : ' is-closed'}`} style={{ ['--assistant-width' as string]: `${props.width}px` }}>
    <div className="resize-handle left" onMouseDown={props.onResizeStart} />
    <div className="assistant-inner">
      <header className="assistant-head"><span className="material-symbols-rounded">cognition</span><strong>AI 协作</strong>
        <span className={`assistant-state${props.agent.running ? ' working' : ''}`}>{props.agent.running ? '进行中' : '就绪'}</span>
        <button className="icon-btn" aria-label="收起 AI 侧栏" onClick={props.onClose}><span className="material-symbols-rounded">right_panel_close</span></button>
      </header>
      <nav className="assistant-tabs" aria-label="AI 对话范围">
        <button aria-pressed={!props.noteOpen} onClick={props.onGlobal}>全局对话</button>
        <button aria-pressed={props.noteOpen} disabled={!props.noteTitle} onClick={props.onNote}>文档答疑</button>
      </nav>
      <div className="assistant-global" hidden={props.noteOpen}>
        <div className="assistant-session"><div><span>当前会话</span><strong title={props.sessionTitle}>{props.sessionTitle || '新对话'}</strong></div><button className="icon-btn" aria-label="新建全局对话" disabled={props.agent.running} onClick={props.onNewSession}><span className="material-symbols-rounded">add_comment</span></button></div>
        <div className="assistant-messages" ref={list} role="log" aria-label="全局对话记录" aria-busy={props.agent.running} onScroll={() => {
          const el = list.current
          if (el) { nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64; setAtBottom(nearBottom.current) }
        }}>
          <div ref={messageBody}>
          {loading && !messages.length && <p className="assistant-load" role="status">正在读取对话…</p>}
          {loadError && <div className="assistant-load-error" role="alert">无法读取对话：{loadError}<button onClick={() => requestHistory.current()}>重试</button></div>}
          {!loading && !loadError && !messages.length && !reply && <div className="assistant-empty"><h2>在这里，一起想清楚。</h2><p>讲解难点、分析题图，或把思路整理成笔记。</p><p>选择下方学习模式，输入问题开始。针对当前笔记或 PDF 的提问，可切换到“文档答疑”。</p></div>}
          {messages.map((message, index) => <section key={index} className={`assistant-message ${message.role}`}>
            <div className="assistant-author">{message.role === 'user' ? '你' : 'LearnAgent'}</div>
            {message.images?.length ? <div className="assistant-images">{message.images.map(path => <a key={path} href={`/api/raw?path=${encodeURIComponent(path)}`} target="_blank" rel="noreferrer"><img src={`/api/raw?path=${encodeURIComponent(path)}`} alt="对话中的图片" loading="lazy" /></a>)}</div> : null}
            <RichText text={message.content} onWikilink={props.onWikilink} onOpenCite={props.onOpenCite} />
          </section>)}
          {reply && <section className="assistant-message assistant streaming"><div className="assistant-author">LearnAgent</div><RichText text={reply} streaming={props.agent.running} onWikilink={props.onWikilink} onOpenCite={props.onOpenCite} /></section>}
          {props.agent.running && !reply && <div className="assistant-working" role="status"><span className="material-symbols-rounded">progress_activity</span>{props.agent.message || '正在处理…'}</div>}
          </div>
        </div>
        {!atBottom && <button className="assistant-jump" onClick={() => { nearBottom.current = true; setAtBottom(true); if (list.current) list.current.scrollTop = list.current.scrollHeight }}>回到最新消息<span className="material-symbols-rounded">arrow_downward</span></button>}
        {props.composer}
      </div>
      {props.noteOpen && <div className="assistant-note">{props.notePanel}</div>}
    </div>
  </aside>
}
