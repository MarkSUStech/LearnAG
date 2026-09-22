// 目标选择器：每次发消息可选「本轮服务哪个目标」或不选目标。
// 芯片显示当前选择，点击弹出向上的目标列表（含「不选目标」项）。
import { useEffect, useRef, useState } from 'react'
import type { GoalInfo } from '../types'

interface Props {
  goals: GoalInfo[]
  selectedId: string
  onSelect: (id: string) => void
}

export default function GoalPicker({ goals, selectedId, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const selected = goals.find((g) => g.id === selectedId) ?? null

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as HTMLElement)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  if (!goals.length) return null // 没有任何目标时不显示（让 agent 在目标模式里建立）

  return (
    <div className="goal-picker" ref={wrapRef}>
      <button
        className={`goal-chip${selected ? ' active' : ''}`}
        title="本轮对话服务哪个目标（可不选）。点击切换"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="material-symbols-rounded">flag</span>
        {selected ? selected.title : '不选目标'}
        <span className="material-symbols-rounded">{open ? 'expand_less' : 'expand_more'}</span>
      </button>
      {open && (
        <div className="goal-menu">
          <button className={`goal-item${!selected ? ' active' : ''}`} onClick={() => { onSelect(''); setOpen(false) }}>
            <span className="material-symbols-rounded">{!selected ? 'check' : 'block'}</span>
            <span className="gi-title">不选目标（自由对话）</span>
          </button>
          {goals.map((g) => (
            <button key={g.id} className={`goal-item${selected?.id === g.id ? ' active' : ''}`} onClick={() => { onSelect(g.id); setOpen(false) }}>
              <span className="material-symbols-rounded">{selected?.id === g.id ? 'check' : 'flag'}</span>
              <span className="gi-title">{g.title}</span>
              {g.currentStage ? <span className="gi-stage">{g.currentStage}</span> : null}
            </button>
          ))}
          <div className="goal-hint">新目标：在「目标」模式下让 agent 建立（Agent/目标/）</div>
        </div>
      )}
    </div>
  )
}
