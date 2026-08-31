// 最小化笔记标签轨：卡片收起（或右栏收起时全部卡片）变成 PDF 右缘的小色签，随内容同步滚动
// 悬停 → 滑出卡片全文预览 + 对应 PDF 内容高亮；点击 → 弹出右栏并直接定位到该卡片
import { docYToPx, useStore } from './store'
import { anchorYInPage } from './PdfViewer'
import { purposeOf } from './types'
import type { Annotation, Card } from './types'
import RichText from '../RichText'

interface Props {
  cards: Card[]
  annotations: Annotation[]
  scrollTop: number
  viewportH: number
  dims: { w: number; h: number }[]
  scale: number
}

export default function NoteTabRail({ cards, annotations, scrollTop, viewportH, dims, scale }: Props) {
  const s = useStore()

  if (!dims.length || !cards.length) return null

  return (
    <div className="ps-tab-rail">
      <div className="ps-tab-rail-inner" style={{ transform: `translateY(${-scrollTop}px)` }}>
        {cards.map((card) => {
          const y = docYToPx(dims, scale, card.anchor.page, anchorYInPage(card, annotations))
          // 视口外不渲染
          if (y < scrollTop - 60 || y > scrollTop + viewportH + 60) return null
          const purpose = purposeOf(card.purpose)
          const anchor = card.anchor
          const annId = anchor.kind === 'annotation' ? anchor.annotationId : undefined
          // 浮层默认向下展开；标签贴近视口底部时改为向上展开，避免溢出
          const yViewport = y - scrollTop
          const popUp = yViewport + 520 > viewportH
          const quote =
            anchor.kind === 'annotation'
              ? (() => {
                  const a = annotations.find((x) => x.id === anchor.annotationId)
                  return a && 'text' in a ? a.text : ''
                })()
              : ''
          return (
            <div key={card.id} className="ps-note-tab" style={{ top: y }}>
              <div
                className="ps-note-tab-pill"
                style={{ ['--tab-color' as never]: purpose.color }}
                onClick={() => {
                  // 弹出右栏并直接定位到该卡片
                  s.updateCard(card.id, { minimized: false })
                  s.setRightOpen(true)
                  s.setRightTab('cards')
                  s.focusCard(card.id)
                  s.jumpTo(card.anchor.page, { cardId: card.id })
                }}
                onMouseEnter={() => {
                  if (annId) s.flashTargets([annId], card.id)
                  else s.flashTargets([], card.id)
                }}
                onMouseLeave={() => s.flashTargets([], undefined)}
              >
                <span className="material-symbols-rounded">{purpose.icon}</span>
                <span className="ps-note-tab-text">{card.title || purpose.label}</span>
                <div className="ps-note-tab-pop" style={popUp ? { top: 'auto', bottom: 0 } : undefined}>
                  <div className="ps-ntp-head" style={{ color: purpose.color }}>
                    <span className="material-symbols-rounded">{purpose.icon}</span>
                    {purpose.label} · 第 {card.anchor.page} 页
                  </div>
                  <div className="ps-ntp-title">{card.title || '(无标题)'}</div>
                  {quote && (
                    <div className="ps-ntp-quote">
                      「{quote.slice(0, 80)}
                      {quote.length > 80 ? '…' : ''}」
                    </div>
                  )}
                  <div className="ps-ntp-body">{card.markdown ? <RichText text={card.markdown} /> : '（空卡片，点击展开编辑）'}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
