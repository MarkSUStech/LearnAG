import { useEffect, useMemo, useRef } from 'react'
import MilkdownEditor from './editor/MilkdownEditor'
import { splitFrontmatter } from '../frontmatter'

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
  onMarkLearned,
  learnedRunning,
  celebrate,
  tutorOpen,
  onToggleTutor,
}: Props) {
  const split = useMemo(() => splitFrontmatter(content), [content])
  const streamingRef = useRef(streaming)
  streamingRef.current = streaming

  // agent 流式写入结束后不需要额外处理：content 由父层更新，value 比对自动刷新
  useEffect(() => {
    return () => {
      /* unmount 时父层已通过 flushSaves 保存 */
    }
  }, [])

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
      <div className="editor-body" key={path}>
        <div className="editor-content-col">
          <MilkdownEditor
            value={split.body}
            dark={dark}
            onChange={(body) => !streamingRef.current && onEdit(path, body)}
            onWikilink={onWikilink}
          />
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
