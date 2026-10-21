// PDF 学习器面板：顶栏 + 大纲 + 阅读器 + 卡片面板 + 选区工具条 + 卡片编辑器 + 本地提示
// 在 learn-agent 中占满一个标签页，AI 对话由右侧协作栏承载。
import { useEffect, useRef } from 'react'
import { StudyProvider, useStore } from './store'
import PsToolbar from './PsToolbar'
import OutlinePanel from './OutlinePanel'
import PdfViewer from './PdfViewer'
import CardPanel from './CardPanel'
import SelectionToolbar from './SelectionToolbar'
import CardEditor from './CardEditor'

export default function PdfStudyPane({
  path,
  dark,
  tutorOpen,
  onToggleTutor,
  files,
  onComposeNotes,
  jumpHint,
  onJumpApplied,
}: {
  path: string
  dark: boolean
  tutorOpen?: boolean
  onToggleTutor?: () => void
  files?: string[]
  onComposeNotes?: (message: string, attachments: import('../../types').WriterAttachment[]) => void
  /** 引用角标带页打开：{page, ts} 变化时跳到该页 */
  jumpHint?: { page: number; ts: number }
  onJumpApplied?: () => void
}) {
  return (
    <StudyProvider key={path} docPath={path}>
      <div className="pdf-study" data-theme={dark ? 'dark' : 'light'}>
        <Inner dark={dark} tutorOpen={tutorOpen} onToggleTutor={onToggleTutor} files={files} onComposeNotes={onComposeNotes} jumpHint={jumpHint} onJumpApplied={onJumpApplied} />
      </div>
    </StudyProvider>
  )
}

function Inner({
  dark,
  tutorOpen,
  onToggleTutor,
  files,
  onComposeNotes,
  jumpHint,
  onJumpApplied,
}: {
  dark: boolean
  tutorOpen?: boolean
  onToggleTutor?: () => void
  files?: string[]
  onComposeNotes?: (message: string, attachments: import('../../types').WriterAttachment[]) => void
  jumpHint?: { page: number; ts: number }
  onJumpApplied?: () => void
}) {
  const s = useStore()

  // 引用角标带页打开：文档就绪后跳到目标页
  const jumpTs = jumpHint?.ts ?? 0
  const appliedJump = useRef(0)
  useEffect(() => {
    if (!jumpTs || !jumpHint || appliedJump.current === jumpTs || !s.pageCount) return
    const page = Math.min(Math.max(1, jumpHint.page), s.pageCount)
    if (s.pageDims.length < page) return
    appliedJump.current = jumpTs
    s.jumpTo(page)
    onJumpApplied?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTs, s.pageDims.length, s.pageCount])

  // 快捷键：Esc 回选择工具；+/- 缩放
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      if (e.key === 'Escape') {
        s.setTool('select')
        s.setSelection(null)
      } else if (e.key === '+' || e.key === '=') {
        s.requestZoom('in')
      } else if (e.key === '-') {
        s.requestZoom('out')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s])

  return (
    <>
      <PsToolbar
        tutorOpen={tutorOpen}
        onToggleTutor={onToggleTutor}
      />
      <div className="ps-body">
        {s.outlineOpen && (
          <aside className="ps-outline">
            <div className="ps-outline-head">
              <span className="material-symbols-rounded">toc</span>
              大纲
              <button className="icon-btn" title="收起大纲" onClick={() => s.setOutlineOpen(false)}>
                <span className="material-symbols-rounded">left_panel_close</span>
              </button>
            </div>
            <OutlinePanel />
          </aside>
        )}
        <div className="ps-center">
          <PdfViewer explicitPage={jumpHint?.page} />
          {s.rightOpen && <CardPanel files={files ?? []} onComposeNotes={onComposeNotes ?? (() => undefined)} />}
          {!s.outlineOpen && (
            <button className="ps-outline-fab icon-btn" title="展开大纲" onClick={() => s.setOutlineOpen(true)}>
              <span className="material-symbols-rounded">toc</span>
            </button>
          )}
        </div>
      </div>
      <SelectionToolbar />
      <CardEditor dark={dark} />
      {s.docError && (
        <div className="ps-error-tip">
          <span className="material-symbols-rounded">warning</span>
          {s.docError}
        </div>
      )}
      <div className="ps-toasts">
        {s.toasts.map((t) => (
          <div key={t.id} className={`ps-toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  )
}
