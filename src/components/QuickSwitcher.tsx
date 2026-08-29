import { useEffect, useMemo, useRef, useState } from 'react'

interface Props {
  files: string[]
  onOpen: (path: string) => void
  onClose: () => void
}

/** Ctrl+K 快速切换器：模糊过滤 vault 内的笔记并跳转 */
export default function QuickSwitcher({ files, onOpen, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = files
    if (!q) return pool.slice(0, 12)
    // 简单评分：文件名命中 > 路径命中；子串位置越靠前越优
    const scored = pool
      .map((p) => {
        const name = p.split('/').pop()!.toLowerCase()
        const pi = name.indexOf(q)
        const pj = p.toLowerCase().indexOf(q)
        if (pi < 0 && pj < 0) return null
        const score = pi >= 0 ? pi : 100 + pj
        return { p, score }
      })
      .filter(Boolean) as { p: string; score: number }[]
    return scored.sort((a, b) => a.score - b.score).slice(0, 12).map((x) => x.p)
  }, [files, query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setActive(0)
  }, [query])

  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, results])

  function open(path: string) {
    onOpen(path)
    onClose()
  }

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="switcher">
        <div className="switcher-input">
          <span className="material-symbols-rounded">search</span>
          <input
            ref={inputRef}
            value={query}
            placeholder="搜索笔记…（↑↓ 选择，Enter 打开，Esc 关闭）"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, results.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === 'Enter' && results[active]) {
                open(results[active])
              }
            }}
          />
        </div>
        <div className="switcher-list" ref={listRef}>
          {results.length === 0 && <div className="switcher-empty">没有匹配的笔记</div>}
          {results.map((p, i) => (
            <div
              key={p}
              className={`switcher-item ${i === active ? 'active' : ''}`}
              onClick={() => open(p)}
              onMouseEnter={() => setActive(i)}
            >
              <span className="material-symbols-rounded">description</span>
              <span className="s-name">{p.split('/').pop()?.replace(/\.md$/, '')}</span>
              <span className="s-path">{p}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
