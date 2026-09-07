// 卡片编辑抽屉：目的四选一 / 标题 / 标签 / 引用原文 / Milkdown 全套 Markdown 编辑器
import { useEffect, useMemo, useState } from 'react'
import { useStore } from './store'
import { uid } from './api'
import { PURPOSES, purposeOf } from './types'
import type { CardPurpose } from './types'
import MilkdownEditor from '../editor/MilkdownEditor'
import TagChips from './TagChips'
import PromptDialog from '../PromptDialog'

export default function CardEditor({ dark }: { dark: boolean }) {
  const s = useStore()
  const ed = s.cardEditor
  const [purpose, setPurpose] = useState<CardPurpose>('explain')
  const [title, setTitle] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)

  const existing = ed?.card
  const quote = existing
    ? (() => {
        const anchor = existing.anchor
        if (anchor.kind !== 'annotation') return ''
        const a = s.annotations.find((x) => x.id === anchor.annotationId)
        return a && 'text' in a ? a.text : ''
      })()
    : ed?.draft?.quote ?? ''

  // 打开时装载
  useEffect(() => {
    if (!ed) return
    if (ed.card) {
      setPurpose(ed.card.purpose)
      setTitle(ed.card.title)
      setMarkdown(ed.card.markdown)
      setTags(ed.card.tags)
    } else {
      setPurpose(ed.draft?.initialMarkdown ? 'supplement' : 'explain')
      setTitle('')
      setMarkdown(ed.draft?.initialMarkdown ?? (ed.draft?.quote ? `> ${ed.draft.quote.replace(/\n+/g, '\n> ')}\n\n` : ''))
      setTags([])
    }
  }, [ed])

  const purposeInfo = useMemo(() => purposeOf(purpose), [purpose])

  if (!ed) return null

  function save() {
    if (existing) {
      s.updateCard(existing.id, { purpose, title, markdown, tags })
      s.toast('卡片已保存', 'ok')
    } else if (ed?.draft) {
      const card = {
        id: uid(),
        purpose,
        title,
        markdown,
        tags,
        anchor: ed.draft.anchor,
        minimized: false,
        offsetY: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      s.addCard(card)
      s.toast('卡片已创建', 'ok')
    }
    s.setCardEditor(null)
  }

  return (
    <div className="ps-drawer-mask" onMouseDown={(e) => e.target === e.currentTarget && s.setCardEditor(null)}>
      <div className="ps-drawer" style={{ ['--card-color' as never]: purposeInfo.color }}>
        <div className="ps-drawer-head">
          <span className="material-symbols-rounded" style={{ color: purposeInfo.color }}>
            {purposeInfo.icon}
          </span>
          <h3>{existing ? '编辑卡片' : '新建卡片'}</h3>
          <button className="icon-btn" onClick={() => s.setCardEditor(null)}>
            <span className="material-symbols-rounded">close</span>
          </button>
        </div>

        <div className="ps-drawer-body">
          <div className="ps-purpose-row">
            {PURPOSES.map((p) => (
              <button
                key={p.id}
                className={`ps-purpose-chip${purpose === p.id ? ' active' : ''}`}
                style={{ ['--pc' as never]: p.color }}
                onClick={() => setPurpose(p.id)}
              >
                <span className="material-symbols-rounded">{p.icon}</span>
                {p.label}
              </button>
            ))}
          </div>

          <input className="ps-card-title-input" placeholder="卡片标题（可留空）" value={title} onChange={(e) => setTitle(e.target.value)} />

          {quote && (
            <div className="ps-card-quote" title="锚定的原文">
              <span className="material-symbols-rounded">format_quote</span>
              {quote.slice(0, 200)}
              {quote.length > 200 ? '…' : ''}
            </div>
          )}

          <div className="ps-card-tags-row">
            <span className="material-symbols-rounded">sell</span>
            <TagChips tags={tags} onChange={setTags} />
          </div>

          <div className="ps-card-md-editor">
            <MilkdownEditor value={markdown} dark={dark} onChange={setMarkdown} />
          </div>
        </div>

        <div className="ps-drawer-foot">
          {existing && (
            <button
              className="btn danger"
              onClick={() => setConfirmOpen(true)}
            >
              删除
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={() => s.setCardEditor(null)}>
            取消
          </button>
          <button className="btn primary" onClick={save}>
            {existing ? '保存' : '创建卡片'}
          </button>
        </div>
      </div>
      {confirmOpen && existing && (
        <PromptDialog
          spec={{ kind: 'confirm', title: '删除这张卡片？', okText: '删除', danger: true, onOk: () => { s.deleteCard(existing.id); s.setCardEditor(null) } }}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </div>
  )
}
