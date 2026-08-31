// 标签 chips + 内联添加输入（标注列表/卡片共用）
import { useState } from 'react'
import { useStore } from './store'

export default function TagChips({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const s = useStore()
  const [adding, setAdding] = useState(false)
  const [v, setV] = useState('')

  const known = new Set<string>()
  for (const a of s.annotations) a.tags.forEach((t) => known.add(t))
  for (const c of s.cards) c.tags.forEach((t) => known.add(t))

  return (
    <div className="ps-tag-chips">
      {tags.map((t) => (
        <span key={t} className="ps-tag-chip" title={`标签：${t}（点击查看全部）`} onClick={() => s.setRightTab('tags')}>
          #{t}
          <button
            title="移除标签"
            onClick={(e) => {
              e.stopPropagation()
              onChange(tags.filter((x) => x !== t))
            }}
          >
            <span className="material-symbols-rounded">close</span>
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          className="ps-tag-add-input"
          list="ps-tagchips-known"
          placeholder="回车添加"
          value={v}
          onBlur={() => setAdding(false)}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && v.trim()) {
              onChange([...new Set([...tags, v.trim()])])
              setV('')
              setAdding(false)
            }
            if (e.key === 'Escape') setAdding(false)
          }}
        />
      ) : (
        <button className="ps-tag-add" title="添加标签" onClick={() => setAdding(true)}>
          <span className="material-symbols-rounded">add</span>
        </button>
      )}
      <datalist id="ps-tagchips-known">
        {[...known].map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  )
}
