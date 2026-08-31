// 右侧卡片面板：镜像映射画布（与 PDF 同步滚动）+ 卡片自由拖动 + 标注/标签视图
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { contentHeight, docYToPx, useStore } from './store'
import { attachScrollSync } from './syncBus'
import { anchorYInPage } from './PdfViewer'
import CardItem from './CardItem'
import TagView from './TagView'
import AnnListView from './AnnListView'

export default function CardPanel() {
  const s = useStore()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const scrollSyncRef = useRef(attachScrollSync('panel'))
  const setPanelEl = useCallback((el: HTMLDivElement | null) => {
    panelRef.current = el
    scrollSyncRef.current(el)
  }, [])

  const { pageDims, scale } = s
  const totalH = useMemo(() => contentHeight(pageDims, scale), [pageDims, scale])

  // 标签轨点击 → 右栏直接滚动定位到该卡片
  useEffect(() => {
    const f = s.cardFocus
    if (!f || !panelRef.current || !pageDims.length) return
    const card = s.cards.find((c) => c.id === f.cardId)
    if (!card) return
    const yIn = anchorYInPage(card, s.annotations)
    const top = docYToPx(pageDims, scale, card.anchor.page, yIn) + card.offsetY * scale
    panelRef.current.scrollTop = Math.max(0, top - 90)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.cardFocus])

  return (
    <aside className="ps-card-panel">
      <div className="ps-cp-head">
        <div className="ps-cp-tabs">
          <button className={`ps-cp-tab${s.rightTab === 'cards' ? ' active' : ''}`} onClick={() => s.setRightTab('cards')}>
            <span className="material-symbols-rounded">note_stack</span> 卡片 {s.cards.length ? `(${s.cards.length})` : ''}
          </button>
          <button className={`ps-cp-tab${s.rightTab === 'anns' ? ' active' : ''}`} onClick={() => s.setRightTab('anns')}>
            <span className="material-symbols-rounded">draw</span> 标注 {s.annotations.length ? `(${s.annotations.length})` : ''}
          </button>
          <button className={`ps-cp-tab${s.rightTab === 'tags' ? ' active' : ''}`} onClick={() => s.setRightTab('tags')}>
            <span className="material-symbols-rounded">sell</span> 标签
          </button>
        </div>
        <button className="icon-btn" title="收起面板" onClick={() => s.setRightOpen(false)}>
          <span className="material-symbols-rounded">right_panel_close</span>
        </button>
      </div>

      {s.rightTab === 'cards' && (
        <>
          <div className="ps-cp-toolbar">
            <button
              className="ps-mini-btn"
              onClick={() => s.setCardEditor({ draft: { anchor: { kind: 'page', page: s.currentPage } } })}
            >
              <span className="material-symbols-rounded">note_add</span> 新建卡片（第{s.currentPage}页）
            </button>
            <button
              className="ps-mini-btn"
              title="全部卡片回到锚点位置"
              onClick={() => s.cards.forEach((c) => c.offsetY !== 0 && s.updateCard(c.id, { offsetY: 0 }))}
            >
              <span className="material-symbols-rounded">clear_all</span> 整理
            </button>
          </div>
          <div ref={setPanelEl} className="ps-cp-scroll">
            <div className="ps-cp-canvas" style={{ height: totalH }}>
              {s.cards
                .filter((c) => !c.minimized)
                .map((card) => {
                  const yIn = anchorYInPage(card, s.annotations)
                  const y = docYToPx(pageDims, scale, card.anchor.page, yIn) + card.offsetY * scale
                  return <CardItem key={card.id} card={card} top={y} />
                })}
              {!s.cards.length && (
                <div className="ps-cp-empty">
                  <span className="material-symbols-rounded">note_stack</span>
                  <p>还没有卡片笔记</p>
                  <p className="sub">选中 PDF 文字后点「卡片」，或点上方「新建卡片」</p>
                </div>
              )}
            </div>
          </div>
          <div className="ps-cp-hint">提示：卡片与左侧内容同步滚动；拖住卡片标题可自由摆放</div>
        </>
      )}
      {s.rightTab === 'anns' && <AnnListView />}
      {s.rightTab === 'tags' && <TagView />}
    </aside>
  )
}
