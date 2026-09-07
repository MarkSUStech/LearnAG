// IDE Markdown：左边 Monaco 源码 + 右边只读渲染分屏（可拖动分隔条调节比例）
// 浮窗模式由 IdeShell 直接渲染 IdeFloatPreview，本组件只负责 关闭/分屏 两种形态。
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { splitFrontmatter } from '../../frontmatter'
import MilkdownEditor, { fixPseudoTex } from '../editor/MilkdownEditor'

const CodeEditor = lazy(() => import('./CodeEditor'))

interface Props {
  path: string
  value: string
  dark: boolean
  previewOpen: boolean
  onChange?: (path: string, value: string) => void
  onCursor?: (pos: { line: number; col: number }) => void
  reveal?: { line: number; ts: number } | null
}

const RATIO_KEY = 'la-ide-md-ratio'

export default function IdeMarkdown({ path, value, dark, previewOpen, onChange, onCursor, reveal }: Props) {
  // 伪 LaTeX 自愈：外部内容里被误标为 latex 的 ASCII 图块改回 text
  const safeValue = fixPseudoTex(value)
  // 预览防抖：源码连续输入时不必每键重渲染 Milkdown
  const [previewValue, setPreviewValue] = useState(safeValue)
  const [ratio, setRatio] = useState(() => {
    const r = Number(localStorage.getItem(RATIO_KEY))
    return r >= 0.25 && r <= 0.75 ? r : 0.5
  })
  const ratioRef = useRef(ratio)
  ratioRef.current = ratio
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!previewOpen) return
    const t = setTimeout(() => setPreviewValue(safeValue), 300)
    return () => clearTimeout(t)
  }, [safeValue, previewOpen])
  useEffect(() => {
    if (!previewOpen) setPreviewValue(safeValue)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewOpen])

  // 分隔条拖动：调节源码 / 预览宽度比例
  function startResize(e: React.MouseEvent) {
    e.preventDefault()
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    function onMove(ev: MouseEvent) {
      const r = Math.min(0.75, Math.max(0.25, (ev.clientX - rect.left) / rect.width))
      setRatio(r)
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      localStorage.setItem(RATIO_KEY, String(ratioRef.current))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const body = splitFrontmatter(previewValue).body || previewValue

  return (
    <div ref={wrapRef} className={`ide-md ${previewOpen ? 'split' : ''}`}>
      <div className="ide-md-source" style={previewOpen ? { width: `${ratio * 100}%` } : undefined}>
        <Suspense fallback={<div className="ide-loading">编辑器加载中…</div>}>
          <CodeEditor path={path} value={safeValue} dark={dark} onChange={onChange} onCursor={onCursor} reveal={reveal} />
        </Suspense>
      </div>
      {previewOpen && (
        <>
          <div className="ide-md-splitter" onMouseDown={startResize} title="拖动调节分屏比例" />
          <div className="ide-md-preview" data-theme={dark ? 'dark' : 'light'}>
            <MilkdownEditor value={body} dark={dark} onChange={() => undefined} readonly />
          </div>
        </>
      )}
    </div>
  )
}
