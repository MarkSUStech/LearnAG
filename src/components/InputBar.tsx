import { useEffect, useRef, useState, type ReactNode } from 'react'
import FilePicker from './FilePicker'
import type { AgentStatus, WriterAttachment } from '../types'
import { api } from '../api'
import { IMAGE_ACCEPT, MAX_IMAGES, MAX_IMAGE_BYTES, isImageFile, imageUploadFile } from '../imageAttachments'

export type Mode = '教学' | '探索' | '目标' | '写作'

interface Props {
  agent: AgentStatus
  mode: Mode
  onModeChange: (m: Mode) => void
  onSend: (text: string, attachments: WriterAttachment[]) => void | boolean | Promise<void | boolean>
  onStop: () => void
  topSlot?: ReactNode
  planChip?: ReactNode
  answering: boolean
  files: string[]
  engine?: 'api' | 'zcode'
  onOpenEngineSettings?: () => void
  detail?: { thought: string; tools: { name: string; detail: string }[] } | null
  placement?: 'dock' | 'sidebar'
}

/** agent 面板（专家图标 / \ 唤起）：分组展示全部全局 agent */
const AGENT_GROUPS: { label: string; items: { id: Mode; name: string; desc: string; icon: string }[] }[] = [
  {
    label: '学习模式',
    items: [
      { id: '教学', name: '教学', desc: '摸底测评 → 定制计划 → 逐步讲解', icon: 'school' },
      { id: '探索', name: '探索', desc: '基于知识图谱向外推一层，推荐新知识', icon: 'explore' },
      { id: '目标', name: '目标', desc: '推演最短 / 深度 / 广度三条学习路径', icon: 'flag' },
    ],
  },
  {
    label: '笔记',
    items: [
      { id: '写作', name: '写笔记', desc: '根据指定的笔记 / PDF（含你的标注与卡片）撰写笔记', icon: 'edit_note' },
    ],
  },
]

const PLACEHOLDER: Record<Mode, string> = {
  教学: '想学什么？例如：教我动态规划…（Enter 发送）',
  探索: '输入"推荐我学点什么"，agent 会从知识图谱边缘向外推一层…',
  目标: '说出你的目标，例如：我想做出自己的网站…',
  写作: '描述笔记要求，例如：根据这篇论文和我的标注写一篇笔记…',
}

export default function InputBar({ agent, mode, onModeChange, onSend, onStop, topSlot, planChip, answering, files, engine, onOpenEngineSettings, detail, placement = 'dock' }: Props) {
  const [text, setText] = useState('')
  const [detailOpen, setDetailOpen] = useState(false)
  const hasDetail = Boolean(detail && ((detail.thought || '').trim() || (detail.tools && detail.tools.length)))
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('la-dock-collapsed') === '1')
  const [menuOpen, setMenuOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [attachments, setAttachments] = useState<WriterAttachment[]>([])
  const [images, setImages] = useState<{ id: string; file: File; url: string }[]>([])
  const [sending, setSending] = useState(false)
  const [attachmentError, setAttachmentError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const imageRef = useRef<HTMLInputElement>(null)
  const imagesRef = useRef(images)
  imagesRef.current = images
  const sendingRef = useRef(false)
  const uploaded = useRef(new Map<string, WriterAttachment>())
  const taRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const hadQuestion = useRef(false)

  useEffect(() => () => { imagesRef.current.forEach(p => URL.revokeObjectURL(p.url)) }, [])

  function addImages(files: FileList | File[]) {
    if (sendingRef.current) return
    let next = [...imagesRef.current], error = ''
    for (const file of [...files]) {
      if (!isImageFile(file)) { error = '支持 PNG、JPEG、WebP、GIF 图片'; continue }
      if (!file.size || file.size > MAX_IMAGE_BYTES) { error = '每张图片需大于0且不超过10MB'; continue }
      if (next.length >= MAX_IMAGES) { error = `每次最多添加${MAX_IMAGES}张图片`; break }
      next.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) })
    }
    imagesRef.current = next
    setImages(next)
    setAttachmentError(error)
    taRef.current?.focus()
  }

  function removeImage(id: string) {
    const item = imagesRef.current.find(p => p.id === id)
    if (item) URL.revokeObjectURL(item.url)
    uploaded.current.delete(id)
    const next = imagesRef.current.filter(p => p.id !== id)
    imagesRef.current = next
    setImages(next)
    setAttachmentError('')
  }

  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 96) + 'px'
  }, [text])

  // 新提问出现时自动展开：问题卡片不能被收起状态淹没
  const hasQuestion = Boolean(topSlot)
  useEffect(() => {
    if (hasQuestion && !hadQuestion.current) setCollapsed(false)
    hadQuestion.current = hasQuestion
  }, [hasQuestion])

  // 点击面板/输入栏以外的区域关闭 agent 面板
  useEffect(() => {
    if (!menuOpen) return
    function onDown(e: MouseEvent) {
      const t = e.target as HTMLElement
      if (t.closest('.agent-menu') || t.closest('.input-bar')) return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  function setDock(next: boolean) {
    setCollapsed(next)
    if (next) localStorage.setItem('la-dock-collapsed', '1')
    else localStorage.removeItem('la-dock-collapsed')
  }

  async function submit() {
    const t = text.trim()
    if ((!t && !images.length) || sendingRef.current) return
    if (agent.running && !answering) return // 回答 AI 提问时允许提交
    sendingRef.current = true
    setSending(true)
    setAttachmentError('')
    try {
      const paths: WriterAttachment[] = []
      for (const image of images) {
        let attachment = uploaded.current.get(image.id)
        if (!attachment) {
          const result = await api.uploadFile(imageUploadFile(image.file))
          attachment = { path: result.path, primary: true }
          uploaded.current.set(image.id, attachment)
        }
        paths.push(attachment)
      }
      const accepted = await onSend(t || '请看我发送的图片。', [...attachments, ...paths])
      if (accepted === false) { setAttachmentError('发送未成功，图片和文字已保留，可重试'); return }
      images.forEach(p => URL.revokeObjectURL(p.url))
      uploaded.current.clear()
      imagesRef.current = []
      setImages([])
      setText('')
      setAttachments([])
    } catch (e) {
      setAttachmentError((e as Error).message || '图片上传失败，请重试')
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  return (
    <div className={`${placement === 'sidebar' ? 'assistant-composer' : `dock${collapsed ? ' dock-collapsed' : ''}`}${dragOver ? ' image-drag-over' : ''}`}
      onDragOver={e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.stopPropagation(); setDragOver(true) } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false) }}
      onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); setDragOver(false); addImages(e.dataTransfer.files) } }}>
      {placement === 'dock' && <button
        className="dock-toggle dock-expand"
        title="展开输入栏"
        onClick={() => setDock(false)}
      >
        <span className="material-symbols-rounded">keyboard_arrow_up</span>
        {agent.running && <i className="dock-running-dot" />}
      </button>}
      <div className="dock-content">
        {placement === 'dock' && <button
          className="dock-toggle dock-collapse"
          title="收起输入栏"
          onClick={() => setDock(true)}
        >
          <span className="material-symbols-rounded">keyboard_arrow_down</span>
        </button>}
        {placement === 'sidebar' && <div className="assistant-modes" aria-label="学习模式">{AGENT_GROUPS.flatMap(group => group.items).map(item => <button key={item.id} aria-pressed={mode === item.id} onClick={() => onModeChange(item.id)}>{item.name}</button>)}</div>}
        {planChip}
        {topSlot}
        {images.length > 0 && <div className="ib-images" aria-label="待发送图片">
          {images.map(image => <div className="ib-image" key={image.id}>
            <a href={image.url} target="_blank" rel="noreferrer" title={`预览 ${image.file.name}`}><img src={image.url} alt={image.file.name} /></a>
            <span title={image.file.name}>{image.file.name}</span>
            <button type="button" aria-label={`移除图片 ${image.file.name}`} disabled={sending} onClick={() => removeImage(image.id)}><span className="material-symbols-rounded">close</span></button>
          </div>)}
        </div>}
        {(sending || attachmentError) && <div className={`ib-attachment-status${attachmentError ? ' error' : ''}`} role={attachmentError ? 'alert' : 'status'}>{attachmentError || '正在上传图片并发送…'}</div>}
        <div
          className={`status-line ${agent.message.startsWith('出错') ? 'err' : ''}${hasDetail ? ' clickable' : ''}${detailOpen ? ' open' : ''}`}
          title={hasDetail ? '点击展开思考过程与工具调用' : undefined}
          onClick={() => hasDetail && setDetailOpen((o) => !o)}
        >
          {agent.running && <span className="material-symbols-rounded spin">progress_activity</span>}
          {agent.message && <span>{agent.message}</span>}
          {hasDetail && detail && (
            <span className="material-symbols-rounded detail-caret">{detailOpen ? 'expand_less' : 'expand_more'}</span>
          )}
        </div>
        {detailOpen && hasDetail && detail && (
          <div className="agent-detail-panel">
            {detail.tools.length > 0 && (
              <div className="ad-section">
                <div className="ad-label">工具调用</div>
                {detail.tools.map((t, i) => (
                  <div key={i} className="ad-tool">
                    <span className="ad-name">{t.name}</span>
                    <span className="ad-detail">{t.detail}</span>
                  </div>
                ))}
              </div>
            )}
            {detail.thought && (
              <div className="ad-section">
                <div className="ad-label">思考过程</div>
                <pre className="ad-thought">{detail.thought}</pre>
              </div>
            )}
          </div>
        )}
        <div className="input-bar">
          <div className="ib-left">
            <button
              className={`ib-expert${menuOpen ? ' active' : ''}`}
              title={modeTitle(mode)}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span className="material-symbols-rounded">{modeIcon(mode)}</span>
            </button>
            {engine && (
              <button
                className={`ib-engine${engine === 'zcode' ? ' zcode' : ''}`}
                title={
                  engine === 'zcode'
                    ? '当前引擎：ZCode（本机智能体，走你的账号额度）。点击打开设置'
                    : '当前引擎：API 服务（OpenAI 兼容）。点击打开设置'
                }
                onClick={onOpenEngineSettings}
              >
                <span className="material-symbols-rounded">{engine === 'zcode' ? 'smart_toy' : 'cloud'}</span>
                {engine === 'zcode' ? 'ZCode' : 'API'}
              </button>
            )}
            {mode === '写作' && (
              <button className="ib-add" title="附带笔记 / PDF 资料" onClick={() => setPickerOpen(true)}>
                <span className="material-symbols-rounded">add</span>
              </button>
            )}
            <button type="button" className="ib-add" title="添加图片（支持粘贴截图、拖入；API模型需支持视觉）" aria-label="添加图片" disabled={sending || images.length >= MAX_IMAGES} onClick={() => imageRef.current?.click()}>
              <span className="material-symbols-rounded">add_photo_alternate</span>
            </button>
            <input ref={imageRef} type="file" accept={IMAGE_ACCEPT} multiple hidden aria-label="选择图片" onChange={e => { if (e.target.files) addImages(e.target.files); e.target.value = '' }} />
          </div>
          {attachments.length > 0 && (
            <div className="ib-attachments">
              {attachments.map((a) => (
                <span key={a.path} className="ib-chip" title={a.path}>
                  <span className="material-symbols-rounded">
                    {a.path.toLowerCase().endsWith('.pdf') ? 'picture_as_pdf' : 'description'}
                  </span>
                  {a.path.split('/').pop()}
                  <button
                    title="移除"
                    onClick={() => setAttachments((list) => list.filter((x) => x.path !== a.path))}
                  >
                    <span className="material-symbols-rounded">close</span>
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            disabled={sending}
            aria-label="全局对话消息"
            placeholder={answering ? '回答 AI 的提问…（Enter 直接提交答案）' : PLACEHOLDER[mode]}
            onChange={(e) => setText(e.target.value)}
            onPaste={e => {
              const files = [...e.clipboardData.files].filter(isImageFile)
              if (files.length) { e.preventDefault(); addImages(files) }
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === '\\') {
                // \ 唤起 agent 面板
                e.preventDefault()
                setMenuOpen(true)
                return
              }
              if (e.key === 'Escape' && menuOpen) {
                e.stopPropagation()
                setMenuOpen(false)
                return
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void submit()
              }
            }}
          />
          {agent.running && !answering ? (
            <button className="send-btn stop" title="停止" onClick={onStop}>
              <span className="material-symbols-rounded">stop</span>
            </button>
          ) : (
            <button className="send-btn" title={answering ? '提交回答' : '发送'} onClick={() => void submit()} disabled={sending || (!text.trim() && !images.length)}>
              <span className="material-symbols-rounded">send</span>
            </button>
          )}
          {menuOpen && (
            <div className="agent-menu" ref={menuRef}>
              {AGENT_GROUPS.map((g) => (
                <div key={g.label} className="ag-group">
                  <div className="ag-label">
                    {g.label}（{g.items.length}）
                  </div>
                  {g.items.map((it) => (
                    <button
                      key={it.id}
                      className={`ag-item${mode === it.id ? ' active' : ''}`}
                      onClick={() => {
                        onModeChange(it.id)
                        setMenuOpen(false)
                        taRef.current?.focus()
                      }}
                    >
                      <span className="material-symbols-rounded ag-icon">{it.icon}</span>
                      <span className="ag-name">{it.name}</span>
                      <span className="ag-desc">{it.desc}</span>
                      {mode === it.id && <span className="material-symbols-rounded ag-check">check</span>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        {pickerOpen && (
          <FilePicker
            files={files}
            initial={attachments.map((a) => a.path)}
            onConfirm={(paths) => {
              // 输入栏直接附带的资料默认全部作为重点参考（范围由 agent 自行定位）
              setAttachments((prev) => {
                const next = [...prev]
                for (const p of paths) if (!next.some((x) => x.path === p)) next.push({ path: p, primary: true })
                return next
              })
              setPickerOpen(false)
              taRef.current?.focus()
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>
    </div>
  )
}

function modeIcon(m: Mode) {
  switch (m) {
    case '教学':
      return 'school'
    case '探索':
      return 'explore'
    case '目标':
      return 'flag'
    case '写作':
      return 'edit_note'
  }
}

function modeTitle(m: Mode) {
  switch (m) {
    case '教学':
      return '教学：摸底测评 → 定制计划 → 逐步讲解（\\ 可切换 agent）'
    case '探索':
      return '探索：基于知识图谱向外推一层，推荐新知识（\\ 可切换 agent）'
    case '目标':
      return '目标：推演最短 / 深度 / 广度三条学习路径（\\ 可切换 agent）'
    case '写作':
      return '写笔记：根据指定的笔记 / PDF（含你的标注与卡片）撰写笔记（+ 附带资料）'
  }
}
