// 卡片项（右侧面板内）：可拖动摆放、最小化、编辑、删除、跳转锚点、标签
import { useState } from 'react'
import { useStore } from './store'
import RichText from '../RichText'
import { purposeOf } from './types'
import type { Card } from './types'
import TagChips from './TagChips'
import PromptDialog from '../PromptDialog'

export default function CardItem({ card, top }: { card: Card; top: number }) {
  const s = useStore()
  const [dragging, setDragging] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const purpose = purposeOf(card.purpose)
  const anchor = card.anchor
  const anchorAnn = anchor.kind === 'annotation' ? s.annotations.find((a) => a.id === anchor.annotationId) : undefined
  const flashing = s.flash?.cardId === card.id

  function startDrag(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    setDragging(true)
    const startY = e.clientY
    const orig = card.offsetY
    let dy = 0
    const onMove = (ev: PointerEvent) => {
      dy = (ev.clientY - startY) / s.scale
      const next = Math.max(-(top / s.scale) + 8, orig + dy)
      s.updateCard(card.id, { offsetY: next })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDragging(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <>
    <article
      className={`ps-card-item p-${card.purpose}${dragging ? ' dragging' : ''}${flashing ? ' flashing' : ''}`}
      style={{ top, ['--card-color' as never]: purpose.color }}
    >
      <header className="ps-ci-head" onPointerDown={startDrag}>
        <span className="ps-ci-drag" title="拖动摆放">
          <span className="material-symbols-rounded">drag_indicator</span>
        </span>
        <span className="ps-ci-purpose" title={purpose.label}>
          <span className="material-symbols-rounded">{purpose.icon}</span>
          {purpose.label}
        </span>
        <span className="ps-ci-title" title={card.title}>
          {card.title || '(无标题)'}
        </span>
        <span className="ps-ci-actions">
          <button className="icon-btn" title="定位到 PDF 原文" onClick={() => s.jumpTo(card.anchor.page, { cardId: card.id })}>
            <span className="material-symbols-rounded">my_location</span>
          </button>
          <button className="icon-btn" title="编辑" onClick={() => s.setCardEditor({ card })}>
            <span className="material-symbols-rounded">edit</span>
          </button>
          <button className="icon-btn" title="最小化为右侧标签" onClick={() => s.updateCard(card.id, { minimized: true })}>
            <span className="material-symbols-rounded">dock_to_bottom</span>
          </button>
          <button
            className="icon-btn danger"
            title="删除卡片"
            onClick={() => {
              setConfirmOpen(true)
            }}
          >
            <span className="material-symbols-rounded">delete</span>
          </button>
        </span>
      </header>

      {anchorAnn && 'text' in anchorAnn && anchorAnn.text && (
        <div
          className="ps-ci-quote"
          title="点击定位原文"
          onClick={() => s.jumpTo(card.anchor.page, { annId: anchorAnn.id, cardId: card.id })}
        >
          {anchorAnn.text.slice(0, 120)}
          {anchorAnn.text.length > 120 ? '…' : ''}
        </div>
      )}

      <div className="ps-ci-body" onClick={() => s.setCardEditor({ card })}>
        {card.markdown ? <RichText text={card.markdown} /> : <span className="ps-ci-empty-body">（空卡片，点击编辑）</span>}
      </div>

      <footer className="ps-ci-foot">
        <TagChips tags={card.tags} onChange={(tags) => s.updateCard(card.id, { tags })} />
        <span className="ps-ci-anchor" onClick={() => s.jumpTo(card.anchor.page, { cardId: card.id })}>
          P{card.anchor.page}
          {card.anchor.kind === 'annotation' ? ' · 标注' : ' · 整页'}
        </span>
      </footer>
    </article>
    {confirmOpen && (
      <PromptDialog
        spec={{ kind: 'confirm', title: '删除这张卡片？', okText: '删除', danger: true, onOk: () => s.deleteCard(card.id) }}
        onClose={() => setConfirmOpen(false)}
      />
    )}
    </>
  )
}
