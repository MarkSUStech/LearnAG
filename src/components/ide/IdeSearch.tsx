// IDE 全局搜索：服务端全文搜索，结果按文件分组，点击打开并定位到行
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api'
import type { IdeSearchResult } from '../../api'
import { fileIcon } from './fileIcons'

interface Props {
  onOpenResult: (path: string, line: number) => void
}

export default function IdeSearch({ onOpenResult }: Props) {
  const [q, setQ] = useState('')
  const [data, setData] = useState<{ results: IdeSearchResult[]; truncated: boolean } | null>(null)
  const [searching, setSearching] = useState(false)
  const seqRef = useRef(0)

  async function run(query: string) {
    const seq = ++seqRef.current
    if (!query.trim()) {
      setData(null)
      return
    }
    setSearching(true)
    try {
      const r = await api.ideSearch(query.trim())
      if (seq === seqRef.current) setData(r)
    } catch {
      if (seq === seqRef.current) setData({ results: [], truncated: false })
    } finally {
      if (seq === seqRef.current) setSearching(false)
    }
  }

  useEffect(() => {
    const t = setTimeout(() => void run(q), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  // 按文件分组（保持服务端返回顺序）
  const groups = useMemo(() => {
    const map = new Map<string, IdeSearchResult[]>()
    for (const r of data?.results ?? []) {
      const list = map.get(r.path)
      if (list) list.push(r)
      else map.set(r.path, [r])
    }
    return [...map.entries()]
  }, [data])

  return (
    <div className="ide-search">
      <div className="ide-search-box">
        <span className="material-symbols-rounded">search</span>
        <input
          value={q}
          placeholder="搜索全部文件…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void run(q)}
        />
        {searching && <span className="ide-search-spin material-symbols-rounded">progress_activity</span>}
      </div>
      <div className="ide-search-meta">
        {data
          ? `${data.results.length} 条结果${data.truncated ? '（已达上限，可细化关键词）' : ''}`
          : '输入关键词在全部文本/代码文件中搜索'}
      </div>
      <div className="ide-search-results">
        {groups.map(([path, items]) => {
          const ic = fileIcon(path)
          return (
            <div key={path} className="ide-search-group">
              <div
                className="ide-search-file"
                onClick={() => onOpenResult(path, items[0].line)}
                title={path}
              >
                <span className="material-symbols-rounded" style={{ color: ic.color, fontSize: 15 }}>
                  {ic.icon}
                </span>
                <span className="name">{path.split('/').pop()}</span>
                <span className="path">{path}</span>
                <span className="count">{items.length}</span>
              </div>
              {items.map((r, i) => (
                <div key={i} className="ide-search-row" onClick={() => onOpenResult(r.path, r.line)}>
                  <span className="line">{r.line}</span>
                  <span className="text">{r.text}</span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
