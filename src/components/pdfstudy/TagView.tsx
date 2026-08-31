// 标签视图：全库标签云 → 点击列出关联的 标注/卡片 → 点击条目自动跳转定位
import { useMemo, useState } from 'react'
import { useStore } from './store'
import { purposeOf } from './types'

export default function TagView() {
  const s = useStore()
  const [active, setActive] = useState<string | null>(null)

  const tagMap = useMemo(() => {
    const map = new Map<string, { anns: typeof s.annotations; cards: typeof s.cards }>()
    const ensure = (t: string) => {
      if (!map.has(t)) map.set(t, { anns: [], cards: [] })
      return map.get(t)!
    }
    for (const a of s.annotations) for (const t of a.tags) ensure(t).anns.push(a)
    for (const c of s.cards) for (const t of c.tags) ensure(t).cards.push(c)
    return map
  }, [s.annotations, s.cards])

  const sorted = [...tagMap.entries()].sort(
    (a, b) => b[1].anns.length + b[1].cards.length - (a[1].anns.length + a[1].cards.length),
  )
  const cur = active ? tagMap.get(active) : null

  if (!tagMap.size) {
    return (
      <div className="ps-tag-view">
        <div className="ps-side-empty">
          <span className="material-symbols-rounded">sell</span>
          <p>还没有标签</p>
          <p className="sub">选中文本/标注/卡片都可以打标签，点击标签可自动跳转</p>
        </div>
      </div>
    )
  }

  return (
    <div className="ps-tag-view">
      <div className="ps-tag-cloud">
        {sorted.map(([t, v]) => (
          <button
            key={t}
            className={`ps-cloud-tag${active === t ? ' active' : ''}`}
            style={{ fontSize: `${Math.min(16, 12 + v.anns.length + v.cards.length)}px` }}
            onClick={() => setActive(active === t ? null : t)}
          >
            #{t}
            <em>{v.anns.length + v.cards.length}</em>
          </button>
        ))}
      </div>
      {cur && (
        <div className="ps-tag-items">
          {cur.cards.map((c) => (
            <button key={c.id} className="ps-tag-item" onClick={() => s.jumpTo(c.anchor.page, { cardId: c.id })}>
              <span className="material-symbols-rounded" style={{ color: purposeOf(c.purpose).color }}>
                {purposeOf(c.purpose).icon}
              </span>
              <span className="ps-ti-kind">卡片</span>
              <span className="ps-ti-title">{c.title || strip(c.markdown)}</span>
              <span className="ps-ti-page">P{c.anchor.page}</span>
            </button>
          ))}
          {cur.anns.map((a) => (
            <button key={a.id} className="ps-tag-item" onClick={() => s.jumpTo(a.page, { annId: a.id })}>
              <span className="material-symbols-rounded">draw</span>
              <span className="ps-ti-kind">标注</span>
              <span className="ps-ti-title">{'text' in a && a.text ? a.text : a.type === 'mask' ? '遮罩框' : '贴图'}</span>
              <span className="ps-ti-page">P{a.page}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function strip(md: string) {
  return md
    .replace(/[*`>#\[\]]/g, '')
    .replace(/\n+/g, ' ')
    .slice(0, 40)
}
