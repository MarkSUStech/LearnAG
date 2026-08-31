// PDF 学习器顶栏：文档名 / 标注工具条 / 颜色 / 缩放 / 页码 / 大纲与卡片面板开关
import { useStore } from './store'
import type { ToolMode } from './types'
import { MASK_COLORS, TEXT_ANN_COLORS } from './types'

const TOOLS: { id: ToolMode; icon: string; label: string }[] = [
  { id: 'pointer', icon: 'arrow_selector_tool', label: '指针：点选标注，可添加卡片/标签' },
  { id: 'select', icon: 'text_select_start', label: '选择文本（划选后浮出标注工具条）' },
  { id: 'highlight', icon: 'highlight', label: '荧光笔（选中文本应用）' },
  { id: 'underline', icon: 'format_underlined', label: '下划线' },
  { id: 'squiggly', icon: 'gesture', label: '波浪线' },
  { id: 'strikethrough', icon: 'strikethrough_s', label: '删除线' },
  { id: 'mask', icon: 'rectangle', label: '矩形遮罩框（拖拽绘制，自查自测）' },
  { id: 'image', icon: 'add_photo_alternate', label: '页面贴图' },
]

export default function PsToolbar({
  tutorOpen,
  onToggleTutor,
}: {
  tutorOpen?: boolean
  onToggleTutor?: () => void
}) {
  const s = useStore()

  return (
    <div className="ps-topbar">
      <div className="ps-tb-left">
        <button
          className={`icon-btn${s.outlineOpen ? ' active' : ''}`}
          title="大纲（书签）"
          onClick={() => s.setOutlineOpen(!s.outlineOpen)}
        >
          <span className="material-symbols-rounded">toc</span>
        </button>
        <div className="ps-tb-doc-title" title={s.docPath}>
          {s.docTitle}
        </div>
      </div>

      <div className="ps-tb-tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`ps-tool-btn${s.tool === t.id ? ' active' : ''}`}
            title={t.label}
            onClick={() => s.setTool(t.id)}
          >
            <span className="material-symbols-rounded">{t.icon}</span>
          </button>
        ))}
        {['highlight', 'underline', 'squiggly', 'strikethrough'].includes(s.tool) && (
          <div className="ps-color-dots">
            {TEXT_ANN_COLORS.map((c) => (
              <button
                key={c}
                className={`ps-color-dot${s.annotColor === c ? ' active' : ''}`}
                style={{ background: c }}
                title="颜色"
                onClick={() => s.setAnnotColor(c)}
              />
            ))}
          </div>
        )}
        {s.tool === 'mask' && (
          <div className="ps-color-dots">
            {MASK_COLORS.map((c) => (
              <button
                key={c}
                className={`ps-color-dot${s.maskColor === c ? ' active' : ''}`}
                style={{ background: c }}
                title="遮罩颜色"
                onClick={() => s.setMaskColor(c)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="ps-tb-right">
        <div className="ps-zoom-group">
          <button className="icon-btn" title="缩小 (Ctrl+滚轮以鼠标为中心)" onClick={() => s.requestZoom('out')}>
            <span className="material-symbols-rounded">zoom_out</span>
          </button>
          <span className="ps-zoom-val">{Math.round(s.scale * 100)}%</span>
          <button className="icon-btn" title="放大" onClick={() => s.requestZoom('in')}>
            <span className="material-symbols-rounded">zoom_in</span>
          </button>
        </div>
        <div className="ps-page-ind">
          <input
            value={s.currentPage}
            onChange={() => undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const p = parseInt((e.target as HTMLInputElement).value)
                if (p >= 1 && p <= s.pageCount) s.jumpTo(p)
              }
            }}
          />
          / {s.pageCount || '-'}
        </div>
        {onToggleTutor && (
          <button
            className={`icon-btn${tutorOpen ? ' active' : ''}`}
            title="答疑助手（针对当前章节，苏格拉底/费曼/快讲）"
            onClick={onToggleTutor}
          >
            <span className="material-symbols-rounded">forum</span>
          </button>
        )}
        <button
          className={`icon-btn${s.rightOpen ? ' active' : ''}`}
          title="卡片面板"
          onClick={() => s.setRightOpen(!s.rightOpen)}
        >
          <span className="material-symbols-rounded">right_panel_open</span>
        </button>
      </div>
    </div>
  )
}
