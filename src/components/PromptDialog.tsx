// 应用内对话框（替代浏览器原生 prompt/confirm）：学习模式与 IDE 模式共用。
// 样式走全局 .modal-mask/.btn 体系，IDE 深浅色由 .ide-shell 的变量重映射自动继承。
import { useEffect, useRef, useState } from 'react'

export interface DialogSpec {
  /** confirm 仅确认（无输入框），默认 prompt 带输入框 */
  kind?: 'prompt' | 'confirm'
  title: string
  initial?: string
  placeholder?: string
  okText?: string
  danger?: boolean
  onOk: (value: string) => void
}

export default function PromptDialog({ spec, onClose }: { spec: DialogSpec; onClose: () => void }) {
  const isConfirm = spec.kind === 'confirm'
  const [value, setValue] = useState(spec.initial ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  const okRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (isConfirm) okRef.current?.focus()
    else {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [isConfirm])

  const canOk = isConfirm || value.trim().length > 0
  const ok = () => {
    if (!canOk) return
    const v = value.trim()
    onClose()
    spec.onOk(isConfirm ? '' : v)
  }

  return (
    <div
      className="modal-mask"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal slim"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          if (e.key === 'Enter' && canOk) ok()
        }}
      >
        <div className="modal-head" style={{ padding: '14px 18px 0' }}>
          {spec.title}
        </div>
        <div className="modal-body">
          {!isConfirm && (
            <div className="field">
              <input
                ref={inputRef}
                value={value}
                placeholder={spec.placeholder}
                onChange={(e) => setValue(e.target.value)}
                spellCheck={false}
              />
            </div>
          )}
        </div>
        <div className="modal-foot slim-actions">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button ref={okRef} className={`btn primary ${spec.danger ? 'danger' : ''}`} disabled={!canOk} onClick={ok}>
            {spec.okText ?? '确定'}
          </button>
        </div>
      </div>
    </div>
  )
}
