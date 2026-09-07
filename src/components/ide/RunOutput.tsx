// 运行输出面板：流式显示编译/运行输出，支持停止、清空、关闭
import { useEffect, useRef } from 'react'

interface Props {
  output: string
  running: boolean
  desc: string
  onStop: () => void
  onClose: () => void
  onClear: () => void
}

export default function RunOutput({ output, running, desc, onStop, onClose, onClear }: Props) {
  const bodyRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight // 跟随最新输出
  }, [output])

  return (
    <div className="run-panel">
      <div className="run-panel-head">
        <span className={`run-dot ${running ? 'on' : ''}`} />
        <span className="run-desc" title={desc}>
          {running ? '运行中…' : desc || '输出'}
        </span>
        {running && (
          <button className="btn danger" onClick={onStop}>
            <span className="material-symbols-rounded" style={{ fontSize: 14 }}>
              stop
            </span>
            停止
          </button>
        )}
        <button className="run-panel-btn" title="清空" onClick={onClear}>
          <span className="material-symbols-rounded">mop</span>
        </button>
        <button className="run-panel-btn" title="关闭输出面板" onClick={onClose}>
          <span className="material-symbols-rounded">close</span>
        </button>
      </div>
      <pre ref={bodyRef} className="run-panel-body">
        {output}
      </pre>
    </div>
  )
}
