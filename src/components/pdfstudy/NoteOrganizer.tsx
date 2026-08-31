// 整理笔记对话框：把当前 PDF（默认重点）+ 可添加的次要资料，按章节/页码范围
// 交给写作 agent 生成笔记。范围纪律：未指定范围时 agent 用 RAG 自行定位，避免全文读入。
import { useEffect, useState } from 'react'
import FilePicker from '../FilePicker'
import { psApi } from './api'
import { useStore } from './store'
import type { OutlineNode } from './types'
import type { WriterAttachment } from '../../types'

interface Props {
  files: string[]
  onLaunch: (message: string, attachments: WriterAttachment[]) => void
  onClose: () => void
}

interface RefItem {
  path: string
  primary: boolean
  /** 章节快选（来自书签大纲），选中后自动填充页码范围 */
  chapter: string
  from: string
  to: string
  outline: OutlineNode[] | null
  outlineFailed?: boolean
}

type FlatNode = { title: string; page: number | null; level: number }

function flattenOutline(nodes: OutlineNode[], level = 0, out: FlatNode[] = []): FlatNode[] {
  for (const n of nodes) {
    out.push({ title: n.title, page: n.page, level })
    if (n.children?.length) flattenOutline(n.children, level + 1, out)
  }
  return out
}

/** 章节页码范围：起点为该章书签页，终点为下一个同级/更高级条目的前一页 */
function rangeForChapter(flat: FlatNode[], idx: number): { from: number; to: number } | null {
  const from = flat[idx].page
  if (!from) return null
  let to = 99999
  for (let j = idx + 1; j < flat.length; j++) {
    const n = flat[j]
    if (n.level <= flat[idx].level && n.page) {
      to = Math.max(from, n.page - 1)
      break
    }
  }
  return { from, to: Math.min(to, from + 400) }
}

export default function NoteOrganizer({ files, onLaunch, onClose }: Props) {
  const s = useStore()
  const [requirement, setRequirement] = useState('')
  const [items, setItems] = useState<RefItem[]>([])
  const [picking, setPicking] = useState(false)

  // 初始：当前浏览的 PDF 为重点参考（大纲来自 store）
  useEffect(() => {
    setItems([{ path: s.docPath, primary: true, chapter: '', from: '', to: '', outline: s.outline ?? [] }])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function addFiles(paths: string[]) {
    const additions: RefItem[] = []
    for (const p of paths) {
      if (items.some((i) => i.path === p)) continue
      const isPdf = /\.pdf$/i.test(p)
      let outline: OutlineNode[] | null = null
      let outlineFailed = false
      if (isPdf) {
        try {
          outline = (await psApi.getOutline(p)).outline
        } catch {
          outlineFailed = true
        }
      }
      additions.push({ path: p, primary: false, chapter: '', from: '', to: '', outline, outlineFailed })
    }
    if (additions.length) setItems((it) => [...it, ...additions])
  }

  function patchItem(idx: number, patch: Partial<RefItem>) {
    setItems((it) => it.map((x, i) => (i === idx ? { ...x, ...patch } : x)))
  }

  function applyChapter(idx: number, chapter: string) {
    const item = items[idx]
    const flat = flattenOutline(item.outline ?? [])
    const hit = flat.findIndex((n) => n.title === chapter && n.page)
    if (hit >= 0) {
      const r = rangeForChapter(flat, hit)
      patchItem(idx, { chapter, from: r ? String(r.from) : '', to: r ? String(r.to) : '' })
    } else {
      patchItem(idx, { chapter })
    }
  }

  function removeItem(idx: number) {
    setItems((it) => it.filter((_, i) => i !== idx))
  }

  const canLaunch = requirement.trim().length > 0 && items.length > 0

  function launch() {
    if (!canLaunch) return
    const attachments: WriterAttachment[] = items.map((i) => {
      const from = parseInt(i.from, 10)
      const to = parseInt(i.to, 10)
      const hasScope = Boolean(i.chapter || Number.isFinite(from) || Number.isFinite(to))
      return {
        path: i.path,
        primary: i.primary,
        scope: hasScope
          ? {
              chapter: i.chapter || undefined,
              from: Number.isFinite(from) ? from : undefined,
              to: Number.isFinite(to) ? to : undefined,
            }
          : undefined,
      }
    })
    onLaunch(requirement.trim(), attachments)
    s.toast('已提交写笔记任务，agent 正在按范围阅读资料…', 'ok')
    onClose()
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="note-organizer" style={{ width: 620 }}>
        <div className="no-head">
          <span className="material-symbols-rounded">auto_stories</span>
          整理笔记
          <button className="icon-btn" onClick={onClose}>
            <span className="material-symbols-rounded">close</span>
          </button>
        </div>

        <div className="no-body">
          <div className="no-req">
            <label>笔记要求</label>
            <textarea
              autoFocus
              rows={2}
              value={requirement}
              placeholder="例如：把本章我标注的重点和卡片整理成一篇知识笔记，突出易错点…"
              onChange={(e) => setRequirement(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) launch()
              }}
            />
          </div>

          <div className="no-refs-label">
            参考资料
            <span className="no-refs-hint">★ 重点 = 笔记核心依据；未指定范围的 PDF 由 agent 检索定位，不全文读入</span>
          </div>
          <div className="no-refs">
            {items.map((item, idx) => {
              const flat = flattenOutline(item.outline ?? [])
              const isPdf = /\.pdf$/i.test(item.path)
              return (
                <div key={item.path} className={`no-ref${item.primary ? ' primary' : ''}`}>
                  <button
                    className={`no-star${item.primary ? ' on' : ''}`}
                    title={item.primary ? '重点参考（点击改为次要）' : '次要参考（点击设为重点）'}
                    onClick={() => patchItem(idx, { primary: !item.primary })}
                  >
                    <span className="material-symbols-rounded">{item.primary ? 'star' : 'star_border'}</span>
                  </button>
                  <span className="material-symbols-rounded no-file-icon">
                    {isPdf ? 'picture_as_pdf' : 'description'}
                  </span>
                  <span className="no-file-name" title={item.path}>
                    {item.path.split('/').pop()}
                  </span>
                  {isPdf && item.outline && item.outline.length > 0 && (
                    <select
                      className="no-chapter"
                      value={item.chapter}
                      onChange={(e) => applyChapter(idx, e.target.value)}
                      title="按章节快速定位页码范围"
                    >
                      <option value="">整本（agent 检索定位）</option>
                      {flat
                        .filter((n) => n.page)
                        .map((n, i) => (
                          <option key={i} value={n.title}>
                            {n.title}（P{n.page}）
                          </option>
                        ))}
                    </select>
                  )}
                  {isPdf && (
                    <span className="no-pages">
                      P
                      <input
                        value={item.from}
                        placeholder="1"
                        onChange={(e) => patchItem(idx, { from: e.target.value.replace(/\D/g, '') })}
                      />
                      –
                      <input
                        value={item.to}
                        placeholder="末"
                        onChange={(e) => patchItem(idx, { to: e.target.value.replace(/\D/g, '') })}
                      />
                    </span>
                  )}
                  <button className="icon-btn no-del" title="移除" onClick={() => removeItem(idx)}>
                    <span className="material-symbols-rounded">close</span>
                  </button>
                </div>
              )
            })}
            <button className="no-add" onClick={() => setPicking(true)}>
              <span className="material-symbols-rounded">add</span>
              添加资料（教材 / 论文 / 笔记…）
            </button>
          </div>
        </div>

        <div className="no-foot">
          <span className="no-hint">将调用「写笔记」agent；Ctrl+Enter 提交</span>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={!canLaunch} onClick={launch}>
            <span className="material-symbols-rounded">edit_note</span>
            生成笔记
          </button>
        </div>
      </div>

      {picking && (
        <FilePicker
          files={files.filter((f) => f !== s.docPath)}
          initial={[]}
          onConfirm={(paths) => {
            setPicking(false)
            void addFiles(paths)
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  )
}
