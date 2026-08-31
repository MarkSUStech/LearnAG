import { useEffect, useRef, useState, type ReactNode } from 'react'
import FilePicker from './FilePicker'
import type { AgentStatus, WriterAttachment } from '../types'

export type Mode = '教学' | '探索' | '目标' | '写作'

interface Props {
  agent: AgentStatus
  mode: Mode
  onModeChange: (m: Mode) => void
  onSend: (text: string, attachments: WriterAttachment[]) => void
  onStop: () => void
  topSlot?: ReactNode
  planChip?: ReactNode
  answering: boolean
  files: string[]
}

/** agent 面板（专家图标 / \ 唤起）：分组展示全部全局 agent */
const AGENT_GROUPS: { label: string; items: { id: Mode; name: string; desc: string; icon: string }[] }[] = [
  {
    label: '学习模式',
    items: [
      { id: '教学', name: '教学', desc: '摸底测评 → 定制计划 → 逐步讲解', icon: 'school' },
      { id: '探索', name: '探索', desc: '基于知识图谱向外推一层，推荐新知识', icon: 'explore' },
      { id: '目标', name: '目标', desc: '推演最短 / 深度 / 广度三条学习路径', icon: 'flag' },
    ],
  },
  {
    label: '笔记',
    items: [
      { id: '写作', name: '写笔记', desc: '根据指定的笔记 / PDF（含你的标注与卡片）撰写笔记', icon: 'edit_note' },
    ],
  },
]

const PLACEHOLDER: Record<Mode, string> = {
  教学: '想学什么？例如：教我动态规划…（Enter 发送）',
  探索: '输入"推荐我学点什么"，agent 会从知识图谱边缘向外推一层…',
  目标: '说出你的目标，例如：我想做出自己的网站…',
  写作: '描述笔记要求，例如：根据这篇论文和我的标注写一篇笔记…',
}

export default function InputBar({ agent, mode, onModeChange, onSend, onStop, topSlot, planChip, answering, files }: Props) {
  const [text, setText] = useState('')
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('la-dock-collapsed') === '1')
  const [menuOpen, setMenuOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [attachments, setAttachments] = useState<WriterAttachment[]>([])
  const taRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const hadQuestion = useRef(false)

  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 96) + 'px'
  }, [text])

  // 新提问出现时自动展开：问题卡片不能被收起状态淹没
  const hasQuestion = Boolean(topSlot)
  useEffect(() => {
    if (hasQuestion && !hadQuestion.current) setCollapsed(false)
    hadQuestion.current = hasQuestion
  }, [hasQuestion])

  // 点击面板/输入栏以外的区域关闭 agent 面板
  useEffect(() => {
    if (!menuOpen) return
    function onDown(e: MouseEvent) {
      const t = e.target as HTMLElement
      if (t.closest('.agent-menu') || t.closest('.input-bar')) return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  function setDock(next: boolean) {
    setCollapsed(next)
    if (next) localStorage.setItem('la-dock-collapsed', '1')
    else localStorage.removeItem('la-dock-collapsed')
  }

  function submit() {
    const t = text.trim()
    if (!t) return
    if (agent.running && !answering) return // 回答 AI 提问时允许提交
    onSend(t, attachments)
    setText('')
    setAttachments([])
  }

  return (
    <div className={`dock${collapsed ? ' dock-collapsed' : ''}`}>
      <button
        className="dock-toggle dock-expand"
        title="展开输入栏"
        onClick={() => setDock(false)}
      >
        <span className="material-symbols-rounded">keyboard_arrow_up</span>
        {agent.running && <i className="dock-running-dot" />}
      </button>
      <div className="dock-content">
        <button
          className="dock-toggle dock-collapse"
          title="收起输入栏"
          onClick={() => setDock(true)}
        >
          <span className="material-symbols-rounded">keyboard_arrow_down</span>
        </button>
        {planChip}
        {topSlot}
        <div className={`status-line ${agent.message.startsWith('出错') ? 'err' : ''}`}>
          {agent.running && <span className="material-symbols-rounded spin">progress_activity</span>}
          {agent.message && <span>{agent.message}</span>}
        </div>
        <div className="input-bar">
          <div className="ib-left">
            <button
              className={`ib-expert${menuOpen ? ' active' : ''}`}
              title={modeTitle(mode)}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span className="material-symbols-rounded">{modeIcon(mode)}</span>
            </button>
            {mode === '写作' && (
              <button className="ib-add" title="附带笔记 / PDF 资料" onClick={() => setPickerOpen(true)}>
                <span className="material-symbols-rounded">add</span>
              </button>
            )}
          </div>
          {attachments.length > 0 && (
            <div className="ib-attachments">
              {attachments.map((a) => (
                <span key={a.path} className="ib-chip" title={a.path}>
                  <span className="material-symbols-rounded">
                    {a.path.toLowerCase().endsWith('.pdf') ? 'picture_as_pdf' : 'description'}
                  </span>
                  {a.path.split('/').pop()}
                  <button
                    title="移除"
                    onClick={() => setAttachments((list) => list.filter((x) => x.path !== a.path))}
                  >
                    <span className="material-symbols-rounded">close</span>
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            placeholder={answering ? '回答 AI 的提问…（Enter 直接提交答案）' : PLACEHOLDER[mode]}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === '\\') {
                // \ 唤起 agent 面板
                e.preventDefault()
                setMenuOpen(true)
                return
              }
              if (e.key === 'Escape' && menuOpen) {
                setMenuOpen(false)
                return
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
          {agent.running && !answering ? (
            <button className="send-btn stop" title="停止" onClick={onStop}>
              <span className="material-symbols-rounded">stop</span>
            </button>
          ) : (
            <button className="send-btn" title={answering ? '提交回答' : '发送'} onClick={submit} disabled={!text.trim()}>
              <span className="material-symbols-rounded">send</span>
            </button>
          )}
          {menuOpen && (
            <div className="agent-menu" ref={menuRef}>
              {AGENT_GROUPS.map((g) => (
                <div key={g.label} className="ag-group">
                  <div className="ag-label">
                    {g.label}（{g.items.length}）
                  </div>
                  {g.items.map((it) => (
                    <button
                      key={it.id}
                      className={`ag-item${mode === it.id ? ' active' : ''}`}
                      onClick={() => {
                        onModeChange(it.id)
                        setMenuOpen(false)
                        taRef.current?.focus()
                      }}
                    >
                      <span className="material-symbols-rounded ag-icon">{it.icon}</span>
                      <span className="ag-name">{it.name}</span>
                      <span className="ag-desc">{it.desc}</span>
                      {mode === it.id && <span className="material-symbols-rounded ag-check">check</span>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        {pickerOpen && (
          <FilePicker
            files={files}
            initial={attachments.map((a) => a.path)}
            onConfirm={(paths) => {
              // 输入栏直接附带的资料默认全部作为重点参考（范围由 agent 自行定位）
              setAttachments((prev) => {
                const next = [...prev]
                for (const p of paths) if (!next.some((x) => x.path === p)) next.push({ path: p, primary: true })
                return next
              })
              setPickerOpen(false)
              taRef.current?.focus()
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>
    </div>
  )
}

function modeIcon(m: Mode) {
  switch (m) {
    case '教学':
      return 'school'
    case '探索':
      return 'explore'
    case '目标':
      return 'flag'
    case '写作':
      return 'edit_note'
  }
}

function modeTitle(m: Mode) {
  switch (m) {
    case '教学':
      return '教学：摸底测评 → 定制计划 → 逐步讲解（\\ 可切换 agent）'
    case '探索':
      return '探索：基于知识图谱向外推一层，推荐新知识（\\ 可切换 agent）'
    case '目标':
      return '目标：推演最短 / 深度 / 广度三条学习路径（\\ 可切换 agent）'
    case '写作':
      return '写笔记：根据指定的笔记 / PDF（含你的标注与卡片）撰写笔记（+ 附带资料）'
  }
}
