import { useEffect, useRef, useState } from 'react'
import RichText from './RichText'
import PromptDialog, { type DialogSpec } from './PromptDialog'
import { api } from '../api'

interface Message {
  role: 'user' | 'assistant'
  content: string
  /** 用户消息附带的图片（历史里是 vault 路径，本地待发送时是 blob 预览） */
  images?: string[]
}

interface Props {
  sessionId: string
  /** 对话文件路径变化（首轮定题后自动改名）时通知 App 更新标签 */
  onPathChange?: (path: string) => void
  /** 新建一个教学对话（App 负责创建会话+文件并打开新标签） */
  onNewChat?: () => void
}

/** 空状态引导问题（点击填入输入框，补全主题后发送） */
const STARTERS = [
  { icon: 'lightbulb', text: '我想搞懂：（写下概念、问题或一道题）' },
  { icon: 'quiz', text: '考考我对「」的掌握，由浅入深出几道题' },
  { icon: 'menu_book', text: '结合我知识库里的笔记和教材，给我讲讲' },
  { icon: 'travel_explore', text: '带我用引导式对话深入研究一个主题：' },
]

/** 教学模式对话：作为标签页内容嵌入（一个对话文件一个标签），引导学习范式；支持图片多模态输入 */
export default function TeacherChat({ sessionId, onPathChange, onNewChat }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [dialog, setDialog] = useState<DialogSpec | null>(null)
  const [pending, setPending] = useState<{ file: File; url: string }[]>([])
  const [dragOver, setDragOver] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const sessionRef = useRef(sessionId)
  sessionRef.current = sessionId

  /** 添加待发送文件（图片走 vision，其他文件以 vault 路径告知 agent）；上限 6 个 */
  function addFiles(files: FileList | File[] | null) {
    if (!files) return
    const arr = [...files]
    if (!arr.length) return
    setPending((p) => {
      const next = [...p]
      for (const f of arr) {
        if (next.length >= 6) break
        next.push({ file: f, url: URL.createObjectURL(f) })
      }
      return next
    })
  }

  function loadHistory(id: string) {
    return api
      .teacherHistory(id)
      .then((r) => setMessages((r.messages as Message[]).filter((m) => m.content?.trim())))
      .catch(() => setMessages([]))
  }

  // 会话切换 / 首次挂载：载入历史与运行状态
  useEffect(() => {
    setLoaded(false)
    setMessages([])
    loadHistory(sessionId).then(() => setLoaded(true))
    api
      .teacherStatus()
      .then((r) => {
        if (r.running) {
          setRunning(true)
          setStatus('回复生成中…')
        }
      })
      .catch(() => undefined)
  }, [sessionId])

  // SSE：App 把 teacher-* 事件桥接到 window 'teacher-sse'
  useEffect(() => {
    function onTeacherEvent(e: Event) {
      try {
        const d = JSON.parse((e as MessageEvent).data)
        if (d.sessionId !== sessionRef.current) return
        if (d.type === 'teacher-delta') {
          setMessages((msgs) => {
            const next = [...msgs]
            const last = next[next.length - 1]
            if (d.reset) {
              if (last?.role === 'assistant' && last.content === '') next.pop()
              return next
            }
            if (typeof d.text !== 'string') return next
            if (last?.role === 'assistant') {
              next[next.length - 1] = { role: 'assistant', content: last.content + d.text }
            } else {
              next.push({ role: 'assistant', content: d.text })
            }
            return next
          })
          setRunning(true)
          setStatus('')
        } else if (d.type === 'teacher-status') {
          setRunning(true)
          setStatus(d.message || '…')
        } else if (d.type === 'teacher-file') {
          if (typeof d.path === 'string') onPathChange?.(d.path)
        } else if (d.type === 'teacher-done') {
          setRunning(false)
          setStatus('')
          if (d.error) {
            setMessages((m) => [...m, { role: 'assistant', content: '⚠️ ' + d.error }])
          }
        }
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('teacher-sse', onTeacherEvent as EventListener)
    return () => window.removeEventListener('teacher-sse', onTeacherEvent as EventListener)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 自动滚底
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, status])

  /** 图片显示地址：待发送的是本地 blob 预览，历史里是 vault 路径（走 /api/raw 代理） */
  const imgSrc = (p: string) => (p.startsWith('blob:') ? p : `/api/raw?path=${encodeURIComponent(p)}`)

  async function send() {
    const text = input.trim()
    if ((!text && pending.length === 0) || running) return
    setInput('')
    resetTaHeight()
    setRunning(true)
    setStatus('思考中…')
    // 本地消息立即上屏：图片先用 blob 预览
    setMessages((m) => [
      ...m,
      { role: 'user', content: text || '（请看图片）', ...(pending.length ? { images: pending.map((p) => p.url) } : {}) },
    ])
    try {
      // 上传附件进 vault（附件/），把返回路径交给对话引擎
      const paths: string[] = []
      for (const f of pending) {
        const r = await api.uploadFile(f.file)
        paths.push(r.path)
      }
      setPending([])
      await api.teacherSend(text || '请看我发送的图片。', sessionId, paths)
    } catch (e) {
      setRunning(false)
      setStatus('')
      setMessages((m) => [...m, { role: 'assistant', content: '⚠️ ' + (e as Error).message }])
    }
  }

  function resetTaHeight() {
    if (taRef.current) {
      taRef.current.style.height = 'auto'
    }
  }

  async function clearThread() {
    if (running) return
    await api.teacherClear(sessionId).catch(() => undefined)
    setMessages([])
  }

  return (
    <div
      className={`teach ${dragOver ? 'drop' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
      }}
    >
      <header className="teach-head">
        <span className="material-symbols-rounded teach-logo">school</span>
        <div className="teach-title">
          <span className="teach-title-main">教学模式 · 引导学习</span>
          <span className="teach-title-sub">每轮自动检索你的知识库；老师会用提问引导你思考</span>
        </div>
        <div className="teach-head-actions">
          <button className="icon-btn" title="新建教学对话" onClick={onNewChat}>
            <span className="material-symbols-rounded">add</span>
          </button>
          <button
            className="icon-btn"
            title="清空当前对话"
            disabled={running || messages.length === 0}
            onClick={() =>
              setDialog({
                kind: 'confirm',
                title: '清空当前对话？（对话文件记录会一并清空）',
                okText: '清空',
                danger: true,
                onOk: () => void clearThread(),
              })
            }
          >
            <span className="material-symbols-rounded">delete_sweep</span>
          </button>
        </div>
      </header>

      <div className="teach-body" ref={listRef}>
        {messages.length === 0 && loaded && (
          <div className="teach-hero">
            <span className="material-symbols-rounded teach-hero-icon">school</span>
            <h1>今天想学点什么？</h1>
            <p>我会用提问一步步引导你自己想明白，而不是直接给答案。</p>
            <div className="teach-starters">
              {STARTERS.map((s) => (
                <button
                  key={s.icon}
                  className="teach-starter"
                  onClick={() => {
                    setInput(s.text)
                    taRef.current?.focus()
                  }}
                >
                  <span className="material-symbols-rounded">{s.icon}</span>
                  {s.text}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="teach-msg user">
              {m.content}
              {m.images && m.images.length > 0 && (
                <div className="teach-msg-imgs">
                  {m.images.map((p, k) => (
                    <img key={k} src={imgSrc(p)} alt="" onClick={() => window.open(imgSrc(p), '_blank')} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div key={i} className="teach-msg assistant">
              <div className="teach-avatar">
                <span className="material-symbols-rounded">school</span>
              </div>
              <div className="teach-msg-body">
                <RichText text={m.content} streaming={running && i === messages.length - 1} />
                {running && i === messages.length - 1 && <span className="stream-caret" />}
              </div>
            </div>
          ),
        )}
        {running && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="teach-msg assistant">
            <div className="teach-avatar">
              <span className="material-symbols-rounded">school</span>
            </div>
            <div className="teach-msg-body">
              {status ? <div className="teach-status-text">{status}</div> : null}
              <span className="dots">
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="teach-input-zone">
        {running && messages[messages.length - 1]?.role === 'assistant' && status && (
          <div className="teach-running-pill">
            <span className="material-symbols-rounded spin">progress_activity</span>
            {status}
          </div>
        )}
        {pending.length > 0 && (
          <div className="teach-pending">
            {pending.map((p, i) => (
              <div key={i} className="teach-pending-item">
                {p.file.type.startsWith('image/') ? (
                  <img src={p.url} alt={p.file.name} />
                ) : (
                  <div className="teach-pending-file">
                    <span className="material-symbols-rounded">draft</span>
                    <span title={p.file.name}>{p.file.name}</span>
                  </div>
                )}
                <button
                  className="rm"
                  title="移除"
                  onClick={() => setPending((arr) => arr.filter((_, k) => k !== i))}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 12 }}>
                    close
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="teach-input">
          <button
            className="teach-attach"
            title="添加图片或文件（也可直接粘贴截图 / 拖入窗口）"
            onClick={() => fileRef.current?.click()}
          >
            <span className="material-symbols-rounded">add_photo_alternate</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <textarea
            ref={taRef}
            rows={1}
            value={input}
            placeholder="向引导学习教师提问，可粘贴/拖入图片…（Enter 发送）"
            onChange={(e) => {
              setInput(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
            }}
            onPaste={(e) => {
              const files = [...(e.clipboardData?.files ?? [])]
              if (files.length) {
                e.preventDefault()
                addFiles(files)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <button
            className={`teach-send ${running ? 'stop' : ''}`}
            disabled={!running && !input.trim() && pending.length === 0}
            title={running ? '停止' : '发送'}
            onClick={async () => {
              if (running) {
                await api.teacherStop().catch(() => undefined)
              } else {
                void send()
              }
            }}
          >
            <span className="material-symbols-rounded">{running ? 'stop' : 'arrow_upward'}</span>
          </button>
        </div>
        <div className="teach-disclaimer">
          <span className="material-symbols-rounded" style={{ fontSize: 13 }}>
            psychology
          </span>
          引导式教学 · 支持粘贴/拖入图片（需视觉模型）· 每轮自动检索知识库 · 按需调用知识库 Agent——请自行核对重要内容
        </div>
      </div>

      {dialog && <PromptDialog spec={dialog} onClose={() => setDialog(null)} />}
    </div>
  )
}
