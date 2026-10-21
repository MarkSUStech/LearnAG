import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import MilkdownEditor from './editor/MilkdownEditor'
import { splitFrontmatter } from '../frontmatter'
import RichText from './RichText'
import { hasNoteUIMarker } from '../noteui/parser'
const ComponentCatalog = lazy(() => import('../noteui/ComponentCatalog'))

interface Props {
  path: string
  /** 完整文件内容（含 frontmatter） */
  content: string
  /** agent 正在向该文件流式写入 */
  streaming: boolean
  dark: boolean
  /** 用户编辑导致的正文变化（每次击键；保存节奏由父层控制） */
  onEdit: (path: string, body: string) => void
  /** 点击 [[wikilink]] */
  onWikilink: (title: string) => void
  /** 点击引用角标：打开来源文件（第二参数为当前笔记路径，用于排除自身） */
  onOpenCite?: (info: import('../cite').CiteInfo, sourcePath?: string) => void
  /** 点击「已学习」按钮 */
  onMarkLearned: (path: string, title: string) => void
  /** 已学习流程进行中（agent 正在抽查） */
  learnedRunning: boolean
  /** 庆祝动效（掌握检查完成） */
  celebrate: boolean
  /** 答疑面板开启状态 */
  tutorOpen: boolean
  /** 切换答疑面板 */
  onToggleTutor: () => void
}

export default function EditorPane({
  path,
  content,
  streaming,
  dark,
  onEdit,
  onWikilink,
  onOpenCite,
  onMarkLearned,
  learnedRunning,
  celebrate,
  tutorOpen,
  onToggleTutor,
}: Props) {
  const split = useMemo(() => splitFrontmatter(content), [content])
  const hasNoteUI = useMemo(() => hasNoteUIMarker(split.body), [split.body])
  const [mode, setMode] = useState<'edit' | 'read'>('read')
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [scrollToInserted, setScrollToInserted] = useState(false)
  useEffect(() => { setMode('read'); setCatalogOpen(false) }, [path])
  const reading = mode === 'read' || (streaming && hasNoteUI)
  const streamingRef = useRef(streaming)
  streamingRef.current = streaming
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!scrollToInserted) return
    const frame = requestAnimationFrame(() => { bodyRef.current?.querySelector('.noteui:last-of-type')?.scrollIntoView({ block: 'center', behavior: 'auto' }); setScrollToInserted(false) })
    return () => cancelAnimationFrame(frame)
  }, [content, scrollToInserted])

  // ── 阅读位置记忆：滚动时节流记录 .editor-body 的 scrollTop，重开时恢复 ──
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    let last = 0
    const save = (force = false) => {
      const now = Date.now()
      if (!force && now - last < 500) return
      last = now
      if (streamingRef.current && !force) return // 流式写入期间内容高度持续变化，不记
      try {
        localStorage.setItem('la-pos:note:' + path, JSON.stringify({ top: Math.round(el.scrollTop) }))
      } catch {
        /* ignore */
      }
    }
    const onScroll = () => save()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      save(true) // 卸载即记录最终位置（绕过节流）
    }
  }, [path])

  // 恢复上次阅读位置：Milkdown 异步渲染、内容高度逐步稳定，在多个时间点重设滚动位；
  // 用户一旦主动滚动/按键即停止恢复
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    let saved: number | null = null
    try {
      const raw = localStorage.getItem('la-pos:note:' + path)
      if (raw) {
        const pos = JSON.parse(raw)
        if (Number.isFinite(pos?.top) && pos.top > 10) saved = pos.top
      }
    } catch {
      /* ignore */
    }
    if (saved == null) return
    let cancelled = false
    const cancel = () => {
      cancelled = true
    }
    const opts = { once: true, passive: true } as AddEventListenerOptions
    window.addEventListener('wheel', cancel, opts)
    window.addEventListener('touchstart', cancel, opts)
    window.addEventListener('keydown', cancel, opts)
    const timers = [80, 300, 800, 1600, 2800].map((ms) =>
      setTimeout(() => {
        if (!cancelled && !streamingRef.current) el.scrollTop = saved as number
      }, ms),
    )
    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
      window.removeEventListener('wheel', cancel)
      window.removeEventListener('touchstart', cancel)
      window.removeEventListener('keydown', cancel)
    }
  }, [path])

  const meta = split.meta

  return (
    <div className="editor-pane">
      <div className="fm-banner">
        {meta.tags.map((t) => (
          <span key={t} className="chip">
            {t}
          </span>
        ))}
        {meta.mastery !== undefined && <span className="chip mastery">mastery {meta.mastery}/10</span>}
        {meta.status && <span className={`chip status-${meta.status}`}>{statusLabel(meta.status)}</span>}
        {meta.date && <span className="chip">{meta.date}</span>}
        <span className="spacer" />
        <button className="icon-btn" title="可视化组件库" aria-label="打开 NoteUI 组件库" disabled={streaming} onClick={event => { event.currentTarget.focus(); setCatalogOpen(true) }}><span className="material-symbols-rounded">widgets</span></button>
        <div className="note-mode-switch" role="group" aria-label="笔记模式">
          <button type="button" aria-pressed={reading} onClick={() => setMode('read')}>阅读</button>
          <button type="button" aria-pressed={!reading} disabled={streaming} onClick={() => setMode('edit')}>{hasNoteUI ? '源码' : '编辑'}</button>
        </div>
        {streaming && (
          <span className="chip" style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>
            ● agent 正在写入…
          </span>
        )}
        <button
          className={`icon-btn tutor-toggle ${tutorOpen ? 'active' : ''}`}
          title="笔记答疑助手"
          onClick={onToggleTutor}
        >
          <span className="material-symbols-rounded">forum</span>
        </button>
      </div>
      <div className="editor-body" key={path} ref={bodyRef}>
        <div className="editor-content-col">
          {reading ? <div className="note-read-preview"><RichText text={split.body} streaming={streaming} onWikilink={onWikilink} onOpenCite={info => onOpenCite?.(info, path)} /></div> : <MilkdownEditor
            value={split.body}
            dark={dark}
            onChange={(body) => !streamingRef.current && onEdit(path, body)}
            onWikilink={onWikilink}
            onOpenCite={(info) => onOpenCite?.(info, path)}
            notePath={path}
            autoFixBlocked={() => Boolean(streaming)}
          />}
          {/* 仅知识笔记（note/ 分区）显示；计划/知识地图类笔记不显示 */}
          {path.includes('/note/') && (
            <div className="note-learned">
              {celebrate && (
                <div className="celebrate">
                  {Array.from({ length: 18 }).map((_, i) => (
                    <span
                      key={i}
                      className="confetti"
                      style={{
                        ['--cx' as string]: `${(Math.random() - 0.5) * 220}px`,
                        ['--cy' as string]: `${-40 - Math.random() * 120}px`,
                        ['--cr' as string]: `${Math.random() * 540 - 270}deg`,
                        background: ['#f59e0b', '#10b981', '#6366f1', '#ec4899', '#38bdf8'][i % 5],
                        animationDelay: `${(i % 6) * 0.05}s`,
                      }}
                    />
                  ))}
                  <span className="celebrate-check material-symbols-rounded">verified</span>
                  <span className="celebrate-text">掌握检查完成，图谱已更新</span>
                </div>
              )}
              <button
                className={`learned-btn ${learnedRunning ? 'running' : ''}`}
                disabled={learnedRunning || streaming}
                onClick={() => {
                  const title = path.split('/').pop()?.replace(/\.md$/, '') ?? path
                  onMarkLearned(path, title)
                }}
                title="告诉 AI 你已学完这篇笔记，它会抽查掌握情况并更新知识图谱"
              >
                <span className="material-symbols-rounded">{learnedRunning ? 'progress_activity' : 'task_alt'}</span>
                {learnedRunning ? 'AI 正在检查掌握情况…' : '已学习 · 检查掌握情况'}
              </button>
            </div>
          )}
        </div>
      </div>
      {catalogOpen && <Suspense fallback={<div role="status" className="nui-catalog-loading">正在加载组件库…</div>}><ComponentCatalog disabled={streaming} onClose={() => setCatalogOpen(false)} onInsert={source => {
        if (streamingRef.current) return
        onEdit(path, split.body.trimEnd() + '\n\n' + source + '\n')
        setMode('read'); setCatalogOpen(false); setScrollToInserted(true)
      }} /></Suspense>}
    </div>
  )
}

function statusLabel(s: string) {
  switch (s) {
    case 'mastered':
      return '已掌握'
    case 'learning':
      return '学习中'
    case 'learnable':
      return '待探索'
    default:
      return s
  }
}
