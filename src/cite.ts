// 资料引用角标：解析 markdown 脚注式引用（[^n] 角标 + [^n]: 来源定义），
// 提供悬浮来源卡片（编号 / 来源标题 / 摘录 / 类型 / 分组）。
// 语法与 Obsidian 脚注兼容，笔记在 Obsidian 中也能正常渲染。

export interface CiteInfo {
  title: string
  quote: string
  group: string
  ext: string
}

/** 从 markdown 提取全部脚注定义（跳过代码围栏内的内容） */
export function parseCiteDefs(md: string): Map<number, CiteInfo> {
  const map = new Map<number, CiteInfo>()
  const parts = md.split(/(```[\s\S]*?```)/g)
  for (let i = 0; i < parts.length; i += 2) {
    const re = /^\[\^(\d{1,3})\]:\s*(.+)$/gm
    let m: RegExpExecArray | null
    while ((m = re.exec(parts[i]))) {
      const num = parseInt(m[1], 10)
      if (!map.has(num)) map.set(num, parseDefText(m[2]))
    }
  }
  return map
}

/** 定义格式：《标题》.pdf ｜ 关键摘录（P35-36） ｜ @来源分组 */
function parseDefText(t: string): CiteInfo {
  const segs = t
    .split('｜')
    .map((s) => s.trim())
    .filter(Boolean)
  let title = ''
  let quote = ''
  let group = ''
  if (segs.length >= 2) {
    title = segs[0]
    quote = segs.slice(1).filter((s) => !s.startsWith('@')).join(' ｜ ')
    group = (segs.find((s) => s.startsWith('@')) ?? '').replace(/^@\s*/, '')
  } else {
    quote = t
    title = /《(.+?)》/.exec(t)?.[1] ?? ''
  }
  const ext = (/\.(pdf|md|docx?|txt|html?)\b/i.exec(title)?.[1] ?? '').toUpperCase()
  return { title: title || '参考资料', quote, group, ext }
}

// ── 悬浮卡片（body 级单例） ─────────────────────────────────────────────────

const BADGE_SELECTOR = ".cite-badge, sup[data-type='footnote_reference']"

let popEl: HTMLElement | null = null
let popHideTimer: ReturnType<typeof setTimeout> | null = null

function scheduleHide(ms = 350) {
  if (popHideTimer) clearTimeout(popHideTimer)
  popHideTimer = setTimeout(hideCitePopup, ms)
}

function cancelHide() {
  if (popHideTimer) {
    clearTimeout(popHideTimer)
    popHideTimer = null
  }
}

// 全局兜底：卡片打开时鼠标移动到角标/卡片之外，立即隐藏（防止快速移动漏掉 mouseout）
if (typeof document !== 'undefined') {
  document.addEventListener(
    'mousemove',
    (e) => {
      if (!popEl?.classList.contains('open')) return
      const t = e.target as HTMLElement
      if (t?.closest?.('.cite-pop') || t?.closest?.(BADGE_SELECTOR)) {
        cancelHide() // 悬停在角标/卡片上：取消待执行的隐藏
        return
      }
      hideCitePopup()
    },
    true,
  )
}

function ensurePop(): HTMLElement {
  if (popEl) return popEl
  popEl = document.createElement('div')
  popEl.className = 'cite-pop'
  popEl.addEventListener('mouseenter', () => cancelHide())
  popEl.addEventListener('mouseleave', () => scheduleHide(180))
  document.body.appendChild(popEl)
  return popEl
}

export function hideCitePopup() {
  if (popHideTimer) clearTimeout(popHideTimer)
  popEl?.classList.remove('open')
}

export function showCitePopup(anchor: HTMLElement, num: number, info: CiteInfo) {
  const pop = ensurePop()
  pop.innerHTML = ''

  const head = document.createElement('div')
  head.className = 'cite-pop-head'
  const numEl = document.createElement('span')
  numEl.className = 'cite-pop-num'
  numEl.textContent = String(num)
  const titleEl = document.createElement('span')
  titleEl.className = 'cite-pop-title'
  titleEl.textContent = info.title
  head.append(numEl, titleEl)
  pop.appendChild(head)

  if (info.quote) {
    const quote = document.createElement('div')
    quote.className = 'cite-pop-quote'
    quote.textContent = info.quote
    pop.appendChild(quote)
  }

  const foot = document.createElement('div')
  foot.className = 'cite-pop-foot'
  const type = document.createElement('span')
  type.className = 'cite-pop-type'
  const icon = document.createElement('span')
  icon.className = 'material-symbols-rounded'
  icon.textContent =
    info.ext === 'PDF'
      ? 'picture_as_pdf'
      : info.ext === 'MD' || info.ext === 'DOCX' || info.ext === 'DOC'
        ? 'description'
        : 'article'
  const typeLabel = document.createElement('span')
  typeLabel.textContent = info.ext || '资料'
  type.append(icon, typeLabel)
  foot.appendChild(type)
  if (info.group) {
    const grp = document.createElement('span')
    grp.className = 'cite-pop-group'
    grp.textContent = '@' + info.group
    foot.appendChild(grp)
  }
  pop.appendChild(foot)

  pop.classList.add('open')

  // 定位：优先贴在角标上方，越界则放下方；横向夹紧到视口
  const rect = anchor.getBoundingClientRect()
  const popW = 340
  let x = rect.left + rect.width / 2 - popW / 2
  x = Math.max(8, Math.min(x, window.innerWidth - popW - 8))
  pop.style.left = x + 'px'
  pop.style.top = '0px'
  const h = pop.offsetHeight
  let y = rect.top - h - 10
  if (y < 8) y = rect.bottom + 10
  pop.style.top = Math.max(8, y) + 'px'
}

/** 事件委托：root 内的引用角标悬停即弹出来源卡片；鼠标离开角标与卡片后自动消失；返回清理函数 */
export function attachCiteHover(root: HTMLElement, resolve: (num: number) => CiteInfo | undefined): () => void {
  const badgeOf = (e: MouseEvent) =>
    (e.target as HTMLElement)?.closest?.(".cite-badge, sup[data-type='footnote_reference']") as HTMLElement | null
  const onOver = (e: MouseEvent) => {
    const badge = badgeOf(e)
    if (!badge) return
    const num = parseInt(badge.dataset.ref ?? badge.dataset.label ?? '', 10)
    const info = Number.isFinite(num) ? resolve(num) : undefined
    if (!info) return
    cancelHide()
    showCitePopup(badge, num, info)
  }
  const onOut = (e: MouseEvent) => {
    if (!badgeOf(e)) return
    scheduleHide(350)
  }
  root.addEventListener('mouseover', onOver)
  root.addEventListener('mouseout', onOut)
  return () => {
    root.removeEventListener('mouseover', onOver)
    root.removeEventListener('mouseout', onOut)
  }
}
