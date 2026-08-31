import { useEffect, useMemo, useRef, useState } from 'react'

interface Props {
  files: string[]
  initial: string[]
  onConfirm: (paths: string[]) => void
  onClose: () => void
}

/** 工作区资料选择器：多选笔记 / PDF，作为写作 agent 的附带资料 */
export default function FilePicker({ files, initial, onConfirm, onClose }: Props) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string[]>(initial)
  const inputRef = useRef<HTMLInputElement>(null)

  const list = useMemo(
    () =>
      files
        .filter((f) => /\.(md|pdf)$/i.test(f))
        .filter((f) => (q ? f.toLowerCase().includes(q.toLowerCase()) : true))
        .slice(0, 200),
    [files, q],
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter') {
        e.preventDefault()
        onConfirm(sel)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onConfirm, sel])

  function toggle(f: string) {
    setSel((s) => (s.includes(f) ? s.filter((x) => x !== f) : [...s, f]))
  }

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="file-picker">
        <div className="fp-head">
          <span className="material-symbols-rounded">attach_file</span>
          附带资料（笔记 / PDF，PDF 含你的标注与卡片）
          <button className="icon-btn" onClick={onClose}>
            <span className="material-symbols-rounded">close</span>
          </button>
        </div>
        <div className="fp-search">
          <span className="material-symbols-rounded">search</span>
          <input
            ref={inputRef}
            value={q}
            placeholder="搜索工作区文件…"
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="fp-list">
          {list.map((f) => {
            const on = sel.includes(f)
            return (
              <button key={f} className={`fp-item${on ? ' active' : ''}`} onClick={() => toggle(f)} title={f}>
                <span className="material-symbols-rounded fp-icon">
                  {f.toLowerCase().endsWith('.pdf') ? 'picture_as_pdf' : 'description'}
                </span>
                <span className="fp-path">{f}</span>
                <span className="material-symbols-rounded fp-check">{on ? 'check_box' : 'check_box_outline_blank'}</span>
              </button>
            )
          })}
          {!list.length && <div className="fp-empty">没有匹配的文件</div>}
        </div>
        <div className="fp-foot">
          <span>已选 {sel.length} 项</span>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={() => onConfirm(sel)}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
