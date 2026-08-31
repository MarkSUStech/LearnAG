// 标注列表：按页分组的全部标注，点击跳转定位，可打标签/删除
import { useStore } from './store'
import TagChips from './TagChips'
import type { Annotation } from './types'

const TYPE_ICON: Record<string, string> = {
  highlight: 'highlight',
  underline: 'format_underlined',
  squiggly: 'gesture',
  strikethrough: 'strikethrough_s',
  'tag-anchor': 'sell',
  mask: 'rectangle',
  image: 'image',
}

export default function AnnListView() {
  const s = useStore()
  const byPage = new Map<number, Annotation[]>()
  for (const a of s.annotations) {
    if (!byPage.has(a.page)) byPage.set(a.page, [])
    byPage.get(a.page)!.push(a)
  }
  const pages = [...byPage.keys()].sort((x, y) => x - y)

  if (!s.annotations.length) {
    return (
      <div className="ps-ann-list">
        <div className="ps-side-empty">
          <span className="material-symbols-rounded">draw</span>
          <p>还没有标注</p>
          <p className="sub">选中 PDF 文字后用浮出工具条添加荧光/下划线/波浪线/删除线</p>
        </div>
      </div>
    )
  }

  return (
    <div className="ps-ann-list">
      {pages.map((p) => (
        <div key={p} className="ps-ann-page-group">
          <div className="ps-ann-page-head">第 {p} 页</div>
          {byPage.get(p)!.map((a) => (
            <div
              key={a.id}
              className={`ps-ann-row${s.selectedAnnId === a.id ? ' selected' : ''}${s.flash?.annIds.includes(a.id) ? ' flashing' : ''}`}
              onClick={() => {
                s.setSelectedAnnId(a.id)
                s.jumpTo(a.page, { annId: a.id })
              }}
            >
              <span className="material-symbols-rounded ps-ann-type-icon" style={{ color: a.color }}>
                {TYPE_ICON[a.type] ?? 'draw'}
              </span>
              <div className="ps-ann-row-main">
                <div className="ps-ann-row-text">
                  {a.type === 'mask' ? '遮罩框' : a.type === 'image' ? '贴图' : 'text' in a ? a.text : ''}
                </div>
                <TagChips tags={a.tags} onChange={(tags) => s.updateAnnotation(a.id, { tags } as Partial<Annotation>)} />
              </div>
              <button
                className="icon-btn danger"
                title="删除标注"
                onClick={(e) => {
                  e.stopPropagation()
                  s.deleteAnnotation(a.id)
                }}
              >
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
