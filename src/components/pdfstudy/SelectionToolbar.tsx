// 选中文本后的浮出工具条：四类文字标注 / 颜色 / 卡片 / 翻译 / 打标签
import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { translateStream, uid } from './api'
import type { TextAnnotation, TextSelectionInfo } from './types'
import { TEXT_ANN_COLORS } from './types'

export default function SelectionToolbar() {
  const s = useStore()
  const selState = s.selection
  const [colorOpen, setColorOpen] = useState(false)
  const [tagMode, setTagMode] = useState(false)
  const [tagVal, setTagVal] = useState('')
  // 翻译状态：running 时在工具条下方流式预览，完成后自动进卡片编辑器
  const [translating, setTranslating] = useState(false)
  const [translated, setTranslated] = useState('')
  const translateAbort = useRef<AbortController | null>(null)
  const open = Boolean(selState)

  // 点击浮层以外的任何位置（PDF 空白/侧栏/面板）自动关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('.ps-sel-toolbar')) return
      s.setSelection(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, s])

  if (!selState) return null
  const sel: TextSelectionInfo = selState

  function close() {
    s.setSelection(null)
    window.getSelection()?.removeAllRanges()
  }

  function annotate(type: TextAnnotation['type']) {
    s.addAnnotation({
      id: uid(),
      page: sel.page,
      type,
      color: s.annotColor,
      quads: sel.quads,
      text: sel.text,
      tags: [],
      createdAt: new Date().toISOString(),
    })
    close()
  }

  function addCard(initialMarkdown?: string) {
    // 选区自动生成一条荧光标注作为卡片锚点，卡片内引用原文
    const annId = uid()
    s.addAnnotation({
      id: annId,
      page: sel.page,
      type: 'highlight',
      color: s.annotColor,
      quads: sel.quads,
      text: sel.text,
      tags: [],
      createdAt: new Date().toISOString(),
    })
    s.setCardEditor({
      draft: {
        anchor: { kind: 'annotation', annotationId: annId, page: sel.page },
        quote: sel.text,
        initialMarkdown,
      },
    })
    close()
  }

  function addTag() {
    if (!tagVal.trim()) return
    s.addAnnotation({
      id: uid(),
      page: sel.page,
      type: 'tag-anchor',
      color: '#8b5cf6',
      quads: sel.quads,
      text: sel.text,
      tags: [tagVal.trim()],
      createdAt: new Date().toISOString(),
    })
    s.toast(`已打标签 #${tagVal.trim()}`, 'ok')
    setTagMode(false)
    setTagVal('')
    close()
  }

  async function translate() {
    if (translating) return
    setTranslating(true)
    setTranslated('')
    const ac = new AbortController()
    translateAbort.current = ac
    let acc = ''
    try {
      await translateStream(
        sel.text,
        (d) => {
          acc += d
          setTranslated(acc)
        },
        ac.signal,
      )
      addCard(`> ${sel.text.replace(/\n+/g, '\n> ')}\n\n**译文**\n\n${acc.trim()}\n`)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') s.toast('翻译失败：' + (e as Error).message, 'error')
    } finally {
      setTranslating(false)
      translateAbort.current = null
    }
  }

  const x = Math.min(sel.clientX, window.innerWidth - 380)
  const y = Math.max(8, sel.clientY - 52)

  return (
    <div className="ps-sel-toolbar-wrap" style={{ left: x, top: y }}>
      <div className="ps-sel-toolbar" onMouseDown={(e) => e.preventDefault()}>
        {tagMode ? (
          <div className="ps-sel-tag-row">
            <input
              autoFocus
              placeholder="标签名，回车确认"
              value={tagVal}
              onChange={(e) => setTagVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addTag()
                if (e.key === 'Escape') {
                  setTagMode(false)
                  close()
                }
              }}
            />
          </div>
        ) : (
          <>
            <div className="ps-color-anchor">
              <button className="ps-st-color" style={{ background: s.annotColor }} title="颜色" onClick={() => setColorOpen(!colorOpen)} />
              {colorOpen && (
                <div className="ps-color-pop">
                  {TEXT_ANN_COLORS.map((c) => (
                    <button
                      key={c}
                      className={`ps-color-dot${s.annotColor === c ? ' active' : ''}`}
                      style={{ background: c }}
                      onClick={() => {
                        s.setAnnotColor(c)
                        setColorOpen(false)
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
            <button title="荧光笔" onClick={() => annotate('highlight')}>
              <span className="material-symbols-rounded">highlight</span>
            </button>
            <button title="下划线" onClick={() => annotate('underline')}>
              <span className="material-symbols-rounded">format_underlined</span>
            </button>
            <button title="波浪线" onClick={() => annotate('squiggly')}>
              <span className="material-symbols-rounded">gesture</span>
            </button>
            <button title="删除线" onClick={() => annotate('strikethrough')}>
              <span className="material-symbols-rounded">strikethrough_s</span>
            </button>
            <span className="ps-st-sep" />
            <button title="添加卡片笔记" onClick={() => addCard()}>
              <span className="material-symbols-rounded">note_add</span>
            </button>
            <button title="翻译成中文并保存为卡片" onClick={() => void translate()} disabled={translating}>
              <span className="material-symbols-rounded">translate</span>
            </button>
            <button title="打标签" onClick={() => setTagMode(true)}>
              <span className="material-symbols-rounded">sell</span>
            </button>
            <button title="关闭" className="ps-st-close" onClick={close}>
              <span className="material-symbols-rounded">close</span>
            </button>
          </>
        )}
      </div>
      {translating && (
        <div className="ps-translate-pop" onMouseDown={(e) => e.preventDefault()}>
          <div className="ps-translate-head">
            <span className="material-symbols-rounded">translate</span> 翻译中…
            <button
              className="ps-st-close"
              title="取消"
              onClick={() => {
                translateAbort.current?.abort()
                setTranslating(false)
              }}
            >
              <span className="material-symbols-rounded">close</span>
            </button>
          </div>
          <div className="ps-translate-body">{translated || '…'}</div>
        </div>
      )}
    </div>
  )
}
