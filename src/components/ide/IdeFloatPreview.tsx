// Markdown 浮动预览窗口：可拖动（标题栏）、可调整大小（左缘/底缘/左下角）、可停靠回分屏
// 内容与源码同源（IdeShell 传入），Milkdown 只读渲染 + 防抖。几何尺寸记忆在 localStorage。
import { useEffect, useRef, useState } from 'react'
import MilkdownEditor from '../editor/MilkdownEditor'

interface Props {
  path: string
  value: string
  dark: boolean
  onClose: () => void
  onDock: () => void
}

interface Geo {
  x: number
  y: number
  w: number
  h: number
}

const GEO_KEY = 'la-ide-mdfloat-geo'
const MIN_W = 320
const MIN_H = 220

function loadGeo(vw: number, vh: number): Geo {
  try {
    const raw = JSON.parse(localStorage.getItem(GEO_KEY) ?? '')
    if (raw && raw.w >= MIN_W && raw.h >= MIN_H && raw.x < vw && raw.y < vh) return raw
  } catch {
    /* ignore */
  }
  return { x: Math.max(40, vw - 780), y: 60, w: Math.min(740, vw - 120), h: Math.max(MIN_H, vh - 220) }
}

export default function IdeFloatPreview({ path, value, dark, onClose, onDock }: Props) {
  const [geo, setGeo] = useState<Geo>(() =>
    loadGeo(window.innerWidth, window.innerHeight),
  )
  const [debounced, setDebounced] = useState(value)
  const geoRef = useRef(geo)
  geoRef.current = geo

  // 内容防抖渲染
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), 300)
    return () => clearTimeout(t)
  }, [value])

  // 窗口尺寸变化时兜底，避免浮窗跑到视口外
  useEffect(() => {
    const onResize = () =>
      setGeo((g) => ({
        ...g,
        x: Math.min(g.x, window.innerWidth - 80),
        y: Math.min(g.y, window.innerHeight - 60),
      }))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const persist = (g: Geo) => localStorage.setItem(GEO_KEY, JSON.stringify(g))

  function startDrag(e: React.MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const { x, y } = geoRef.current
    function onMove(ev: MouseEvent) {
      const nx = Math.min(Math.max(-geoRef.current.w + 120, x + ev.clientX - startX), window.innerWidth - 120)
      const ny = Math.min(Math.max(0, y + ev.clientY - startY), window.innerHeight - 60)
      setGeo((g) => ({ ...g, x: nx, y: ny }))
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      persist(geoRef.current)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'move'
    document.body.style.userSelect = 'none'
  }

  function startResize(e: React.MouseEvent, dir: 'left' | 'bottom' | 'corner') {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const start = { ...geoRef.current }
    function onMove(ev: MouseEvent) {
      setGeo((g) => {
        const n = { ...g }
        if (dir === 'left' || dir === 'corner') {
          const dx = startX - ev.clientX
          n.w = Math.max(MIN_W, start.w + dx)
          n.x = start.x + (start.w - n.w)
        }
        if (dir === 'bottom' || dir === 'corner') {
          n.h = Math.max(MIN_H, start.h + (ev.clientY - startY))
        }
        return n
      })
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      persist(geoRef.current)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.userSelect = 'none'
    if (dir === 'left') document.body.style.cursor = 'ew-resize'
    else if (dir === 'bottom') document.body.style.cursor = 'ns-resize'
    else document.body.style.cursor = 'nwse-resize'
  }

  const name = path.split('/').pop()

  return (
    <div className="ide-float-preview" data-theme={dark ? 'dark' : 'light'} style={{ left: geo.x, top: geo.y, width: geo.w, height: geo.h }}>
      <div className="ide-float-head" onMouseDown={startDrag} onDoubleClick={onDock}>
        <span className="material-symbols-rounded">picture_in_picture</span>
        <span className="ide-float-title" title={path}>
          {name} — 预览
        </span>
        <button className="ide-float-btn" title="停靠回分屏" onClick={onDock}>
          <span className="material-symbols-rounded">dock_to_right</span>
        </button>
        <button className="ide-float-btn" title="关闭预览" onClick={onClose}>
          <span className="material-symbols-rounded">close</span>
        </button>
      </div>
      <div className="ide-float-body">
        <MilkdownEditor value={debounced} dark={dark} onChange={() => undefined} readonly />
      </div>
      <div className="ide-float-resize left" onMouseDown={(e) => startResize(e, 'left')} />
      <div className="ide-float-resize bottom" onMouseDown={(e) => startResize(e, 'bottom')} />
      <div className="ide-float-resize corner" onMouseDown={(e) => startResize(e, 'corner')} />
    </div>
  )
}
