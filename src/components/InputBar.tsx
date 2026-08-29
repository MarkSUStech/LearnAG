import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AgentStatus } from '../types'

export type Mode = '教学' | '探索' | '目标'

interface Props {
  agent: AgentStatus
  mode: Mode
  onModeChange: (m: Mode) => void
  onSend: (text: string) => void
  onStop: () => void
  topSlot?: ReactNode
  planChip?: ReactNode
  answering: boolean
}

const PLACEHOLDER: Record<Mode, string> = {
  教学: '想学什么？例如：教我动态规划…（Enter 发送）',
  探索: '输入"推荐我学点什么"，agent 会从知识图谱边缘向外推一层…',
  目标: '说出你的目标，例如：我想做出自己的网站…',
}

export default function InputBar({ agent, mode, onModeChange, onSend, onStop, topSlot, planChip, answering }: Props) {
  const [text, setText] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 96) + 'px'
  }, [text])

  function submit() {
    const t = text.trim()
    if (!t) return
    if (agent.running && !answering) return // 回答 AI 提问时允许提交
    onSend(t)
    setText('')
  }

  return (
    <div className="dock">
      {planChip}
      {topSlot}
      <div className={`status-line ${agent.message.startsWith('出错') ? 'err' : ''}`}>
        {agent.running && <span className="material-symbols-rounded spin">progress_activity</span>}
        {agent.message && <span>{agent.message}</span>}
      </div>
      <div className="input-bar">
        <div className="mode-switch">
          {(['教学', '探索', '目标'] as Mode[]).map((m) => (
            <button
              key={m}
              className={`mode-btn ${mode === m ? 'active' : ''}`}
              onClick={() => onModeChange(m)}
              title={modeTitle(m)}
            >
              <span className="material-symbols-rounded">{modeIcon(m)}</span>
              {m}
            </button>
          ))}
        </div>
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          placeholder={answering ? '回答 AI 的提问…（Enter 直接提交答案）' : PLACEHOLDER[mode]}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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
  }
}

function modeTitle(m: Mode) {
  switch (m) {
    case '教学':
      return '教学模式：摸底测评 → 定制计划 → 逐步讲解'
    case '探索':
      return '探索模式：基于知识图谱向外推一层，推荐新知识'
    case '目标':
      return '目标模式：推演最短 / 深度 / 广度三条学习路径'
  }
}
