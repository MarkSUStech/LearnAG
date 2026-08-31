// 左右面板滚动同步：通过回调 ref 注册滚动元素并挂原生 scroll 监听，
// 直接互写 scrollTop；锁时间戳防止程序化写入触发的回环。
type Side = 'pdf' | 'panel'

const els: Record<Side, HTMLDivElement | null> = { pdf: null, panel: null }
const lockedUntil: Record<Side, number> = { pdf: 0, panel: 0 }
const LOCK_MS = 140
const other: Record<Side, Side> = { pdf: 'panel', panel: 'pdf' }

/** 生成回调 ref：挂到对应滚动容器上，元素卸载/重建时自动解绑重绑 */
export function attachScrollSync(side: Side): (el: HTMLDivElement | null) => void {
  const onScroll = () => {
    const el = els[side]
    if (!el) return
    if (Date.now() < lockedUntil[side]) return // 由对方写入触发，忽略
    const target = els[other[side]]
    if (!target || Math.abs(target.scrollTop - el.scrollTop) < 0.5) return
    lockedUntil[other[side]] = Date.now() + LOCK_MS
    target.scrollTop = el.scrollTop
  }
  return (el) => {
    const prev = els[side]
    if (prev) prev.removeEventListener('scroll', onScroll)
    els[side] = el
    if (el) el.addEventListener('scroll', onScroll, { passive: true })
  }
}
