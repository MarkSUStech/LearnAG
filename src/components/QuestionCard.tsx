import { useEffect, useMemo, useRef, useState } from 'react'
import { renderRichMarkdown, stripMd, renderRemoteDiagramsIn } from './md'
import { ensureMermaid } from './editor/mermaidNodeView'
import { isBeautifulSupported, renderBeautiful } from './editor/beautifulMermaid'
import { api } from '../api'
import type { AnswerValue, PendingQuestion, UploadedFilePayload } from '../types'

interface Props {
  question: PendingQuestion
  onAnswered: () => void
  onError: (msg: string) => void
}

/** AI 提问卡片：可折叠，支持 single/multi/judge/text/file 五种作答形态 */
export default function QuestionCard({ question, onAnswered, onError }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [multiSel, setMultiSel] = useState<string[]>([])
  const [customText, setCustomText] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [uploading, setUploading] = useState(0)
  const [answered, setAnswered] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const questionHtml = useMemo(() => renderRichMarkdown(question.question), [question.question])

  // mermaid 占位 div → 优先 beautiful-mermaid 同步渲染，其余走标准 mermaid
  useEffect(() => {
    if (!questionHtml.hasMermaid && !questionHtml.hasRemoteDiagram) return
    const el = headRef.current
    if (!el) return
    const dark = document.documentElement.dataset.theme === 'dark'
    if (questionHtml.hasMermaid) {
      ensureMermaid(dark)
      const nodes = [...el.querySelectorAll('.mermaid')] as HTMLElement[]
      const rest: HTMLElement[] = []
      for (const n of nodes) {
        const code = n.textContent ?? ''
        if (isBeautifulSupported(code)) {
          const svg = renderBeautiful(code, dark)
          if (svg) {
            n.innerHTML = svg
            continue
          }
        }
        rest.push(n)
      }
      if (rest.length) {
        import('mermaid').then((m) => m.default.run({ nodes: rest }).catch(() => undefined))
      }
    }
    if (questionHtml.hasRemoteDiagram) renderRemoteDiagramsIn(el)
  }, [questionHtml])

  async function submit(value: AnswerValue, label: string) {
    try {
      await api.answerQuestion(question.id, value)
      setAnswered(label || '已提交')
      setTimeout(onAnswered, 450)
    } catch (e) {
      onError((e as Error).message)
    }
  }

  function toggleOption(opt: string) {
    setMultiSel((sel) => (sel.includes(opt) ? sel.filter((x) => x !== opt) : [...sel, opt]))
  }

  async function onFilesPicked(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(files.length)
    try {
      const uploaded: UploadedFilePayload[] = []
      for (const f of Array.from(files)) {
        const r = await api.uploadFile(f)
        uploaded.push({ path: r.path, name: r.name, preview: r.preview })
      }
      await submit({ files: uploaded }, `已上传 ${uploaded.length} 个文件`)
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setUploading(0)
    }
  }

  const answeredView = (
    <div className="qcard answered">
      <span className="material-symbols-rounded">check_circle</span>
      {answered}——等待 AI 继续…
    </div>
  )

  if (answered) return answeredView

  if (collapsed) {
    return (
      <div className="qcard collapsed-bar" onClick={() => setCollapsed(false)}>
        <span className="q-badge">AI 提问</span>
        <span className="q-preview">{stripMd(question.question)}</span>
        <span className="material-symbols-rounded">expand_less</span>
      </div>
    )
  }

  return (
    <div className="qcard">
      <div className="qcard-head" ref={headRef} onClick={() => setCollapsed(true)}>
        <span className="q-badge">AI 提问</span>
        <span className="q-text md" dangerouslySetInnerHTML={{ __html: questionHtml.html }} />
        <span className="material-symbols-rounded expand">expand_more</span>
      </div>

      <div className="qcard-body">
        {question.code && <pre className="q-code">{question.code}</pre>}
        {(question.contextFiles?.length ?? 0) > 0 && (
          <div className="q-context-files">
            {question.contextFiles!.map((f) => (
              <div key={f.path} className="q-context-file">
                <div className="qcf-head">
                  <span className="material-symbols-rounded">description</span>
                  {f.name}
                  <span className="qcf-path">{f.path}</span>
                </div>
                {f.content && <pre className="q-code">{f.content}</pre>}
              </div>
            ))}
          </div>
        )}
        {(question.type === 'single' || question.type === 'multi') && (
          <>
            <div className="q-options">
              {question.options.map((opt) => (
                <button
                  key={opt}
                  className={`q-option ${question.type === 'multi' && multiSel.includes(opt) ? 'selected' : ''}`}
                  onClick={() => {
                    if (question.type === 'single') void submit(stripMd(opt), stripMd(opt))
                    else toggleOption(opt)
                  }}
                >
                  {question.type === 'multi' && (
                    <span className="material-symbols-rounded">
                      {multiSel.includes(opt) ? 'check_box' : 'check_box_outline_blank'}
                    </span>
                  )}
                  {stripMd(opt)}
                </button>
              ))}
            </div>
            {question.type === 'multi' && (
              <div className="q-actions">
                <button className="q-submit" disabled={multiSel.length === 0} onClick={() => void submit(multiSel, multiSel.join('、'))}>
                  提交（已选 {multiSel.length} 项）
                </button>
              </div>
            )}
          </>
        )}

        {question.type === 'judge' && (
          <div className="q-options">
            <button className="q-option" onClick={() => void submit('对', '对')}>
              <span className="material-symbols-rounded">check</span>对
            </button>
            <button className="q-option" onClick={() => void submit('不对', '不对')}>
              <span className="material-symbols-rounded">close</span>不对
            </button>
          </div>
        )}

        {/* 自定义回答：所有题型（判断/单选/多选/简答）都可用自由文本作答 */}
        {question.type !== 'file' && (
          <div className="q-custom">
            <button className="q-option" onClick={() => setShowCustom((v) => !v)}>
              <span className="material-symbols-rounded">edit</span>
              {showCustom ? '收起自定义回答' : '自定义回答…'}
            </button>
            {showCustom && (
              <>
                <textarea
                  ref={taRef}
                  rows={2}
                  autoFocus
                  placeholder="用自己的话回答（与选项同等计分，认真作答）…（Ctrl+Enter 提交）"
                  onChange={(e) => setCustomText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && customText.trim()) {
                      void submit(customText.trim(), customText.trim().slice(0, 30))
                    }
                  }}
                />
                <button className="q-submit" disabled={!customText.trim()} onClick={() => void submit(customText.trim(), customText.trim().slice(0, 30))}>
                  提交自定义回答
                </button>
              </>
            )}
          </div>
        )}

        {question.type === 'text' && (
          <div className="q-textarea-wrap">
            <textarea
              ref={taRef}
              autoFocus
              placeholder="输入你的回答…（Ctrl+Enter 提交）"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  const v = (e.target as HTMLTextAreaElement).value.trim()
                  if (v) void submit(v, v.slice(0, 30))
                }
              }}
            />
            <button
              className="q-submit"
              onClick={() => {
                const v = taRef.current?.value.trim()
                if (v) void submit(v, v.slice(0, 30))
              }}
            >
              提交
            </button>
          </div>
        )}

        {question.type === 'file' && (
          <div className="q-file">
            {question.fileHint && <div className="q-file-hint">{question.fileHint}</div>}
            <button className="q-submit" disabled={uploading > 0} onClick={() => fileRef.current?.click()}>
              <span className="material-symbols-rounded">upload_file</span>
              {uploading > 0 ? `上传中 ${uploading} 个…` : question.fileMultiple ? '选择文件（可多选）' : '选择文件'}
            </button>
            <input
              ref={fileRef}
              type="file"
              style={{ display: 'none' }}
              multiple={question.fileMultiple}
              onChange={(e) => {
                void onFilesPicked(e.target.files)
                e.target.value = ''
              }}
            />
          </div>
        )}

        <div className="q-actions">
          <button className="q-skip" onClick={() => void submit({ skipped: true }, '已跳过')}>
            跳过这个问题
          </button>
        </div>
      </div>
    </div>
  )
}
