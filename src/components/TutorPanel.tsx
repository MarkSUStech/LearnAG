import { useEffect, useRef, useState } from 'react'
import RichText from './RichText'
import { api } from '../api'
import { TUTOR_ROLES, type TutorRole } from '../tutorRoles'
import PromptDialog from './PromptDialog'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  notePath: string
  noteTitle: string
  width: number
  onResizeStart: (e: React.MouseEvent) => void
  onClose: () => void
}

const ROLES: TutorRole[] = ['socratic', 'feynman', 'quick']

/** 笔记答疑助手：右侧抽屉面板，会话绑定当前笔记 */
export default function TutorPanel({ notePath, noteTitle, width, onResizeStart, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [role, setRole] = useState<TutorRole>('quick')
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  // PDF 文档答疑：记录阅读器上报的当前页（服务端据此定位当前章节）
  const pageRef = useRef(0)
  useEffect(() => {
    pageRef.current = 0
    function onPage(e: Event) {
      try {
        const d = JSON.parse((e as MessageEvent).data)
        if (d.path === notePath && typeof d.page === 'number') pageRef.current = d.page
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('pdf-page', onPage as EventListener)
    return () => window.removeEventListener('pdf-page', onPage as EventListener)
  }, [notePath])

  // 打开时载入该笔记的历史会话（兜底过滤：只保留对话消息）
  useEffect(() => {
    api
      .tutorHistory(notePath)
      .then((r) =>
        setMessages(
          (r.messages as Message[]).filter(
            (m) => (m.role === 'user' || m.role === 'assistant') && m.content?.trim(),
          ),
        ),
      )
      .catch(() => setMessages([]))
  }, [notePath])

  // 流式与状态：App 将 SSE 的 tutor-* 事件桥接到 window 'tutor-sse'
  useEffect(() => {
    function onTutorEvent(e: Event) {
      try {
        const d = JSON.parse((e as MessageEvent).data)
        if (d.path !== notePath) return
        if (d.type === 'tutor-delta') {
          setMessages((msgs) => {
            const next = [...msgs]
            const last = next[next.length - 1]
            if (d.reset) {
              if (last?.role === 'assistant' && last.content === '') next.pop()
              return next
            }
            if (d.noteUpdated) return next // 笔记更新由编辑器 SSE 自行刷新
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
        } else if (d.type === 'tutor-status') {
          setRunning(true)
          setStatus(d.message || '…')
        } else if (d.type === 'tutor-done') {
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
    window.addEventListener('tutor-sse', onTutorEvent as EventListener)
    return () => window.removeEventListener('tutor-sse', onTutorEvent as EventListener)
  }, [notePath])

  // 自动滚底
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages])

  function lastSealed(_msgs: Message[]) {
    return false
  }
  void lastSealed

  async function send() {
    const text = input.trim()
    if (!text || running) return
    setInput('')
    setRunning(true)
    setStatus('思考中…')
    setMessages((m) => [...m, { role: 'user', content: text }])
    try {
      await api.tutorSend(notePath, role, text, pageRef.current || undefined)
    } catch (e) {
      setRunning(false)
      setStatus('')
      setMessages((m) => [...m, { role: 'assistant', content: '⚠️ ' + (e as Error).message }])
    }
  }

  async function clearThread() {
    await api.tutorClear(notePath).catch(() => undefined)
    setMessages([])
  }

  return (
    <div className="tutor-panel" style={{ width }}>
      <div className="resize-handle left" onMouseDown={onResizeStart} />
      <div className="tutor-head">
        <span className="material-symbols-rounded">forum</span>
        <span className="tutor-title" title={notePath}>
          {noteTitle}
        </span>
        <button className="icon-btn" title="清空对话" onClick={() => setConfirmClear(true)}>
          <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
            mopup
          </span>
        </button>
        <button className="icon-btn" title="关闭" onClick={onClose}>
          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
            close
          </span>
        </button>
      </div>

      <div className="tutor-roles">
        {ROLES.map((r) => (
          <button
            key={r}
            className={`tutor-role ${role === r ? 'active' : ''}`}
            onClick={() => setRole(r)}
            title={TUTOR_ROLES[r].desc}
          >
            <span className="material-symbols-rounded">{TUTOR_ROLES[r].icon}</span>
            {TUTOR_ROLES[r].label}
          </button>
        ))}
      </div>

      <div className="tutor-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="tutor-empty">
            <span className="material-symbols-rounded tutor-empty-icon">forum</span>
            <div className="tutor-empty-title">选择一个角色开始提问</div>
            <div className="tutor-empty-rows">
              <div>
                <span className="material-symbols-rounded">psychology_alt</span>
                苏格拉底会用问题引导你想通
              </div>
              <div>
                <span className="material-symbols-rounded">record_voice_over</span>
                费曼要你讲给他听，挑出漏洞
              </div>
              <div>
                <span className="material-symbols-rounded">bolt</span>
                快讲直接给答案与类比
              </div>
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="tutor-msg user">
              {m.content}
            </div>
          ) : (
            <div key={i} className="tutor-msg assistant">
              <RichText text={m.content} />
              {running && i === messages.length - 1 && <span className="stream-caret" />}
            </div>
          ),
        )}
        {running && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="tutor-msg assistant">
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
      </div>

      <div className="tutor-input">
        <textarea
          ref={taRef}
          rows={1}
          value={input}
          placeholder={`向${TUTOR_ROLES[role].label.split(' · ')[0]}提问…（Enter 发送）`}
          onChange={(e) => {
            setInput(e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = Math.min(e.target.scrollHeight, 90) + 'px'
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button
          className={`send-btn ${running ? 'stop' : ''}`}
          disabled={!running && !input.trim()}
          title={running ? '停止' : '发送'}
          onClick={async () => {
            if (running) {
              await api.tutorStop().catch(() => undefined)
            } else {
              void send()
            }
          }}
        >
          <span className="material-symbols-rounded">{running ? 'stop' : 'send'}</span>
        </button>
      </div>
      {confirmClear && (
        <PromptDialog
          spec={{ kind: 'confirm', title: '清空与该笔记的答疑对话？', okText: '清空', danger: true, onOk: () => void clearThread() }}
          onClose={() => setConfirmClear(false)}
        />
      )}
    </div>
  )
}
