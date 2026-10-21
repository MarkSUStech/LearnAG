import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'

export type Gap = 'inner' | 'group' | 'section'
export type Align = 'start' | 'center' | 'end' | 'stretch'
type LayoutProps = { children: ReactNode; gap?: Gap; align?: Align }
export const Row = ({ children, gap = 'group', align = 'stretch' }: LayoutProps) => <div className={`nui-layout-row nui-gap-${gap} nui-align-${align}`}>{children}</div>
export const Col = ({ children, gap = 'section', align = 'stretch' }: LayoutProps) => <div className={`nui-layout-col nui-gap-${gap} nui-align-${align}`}>{children}</div>
export const Box = ({ children, gap = 'group', tone = 'plain' }: LayoutProps & { tone?: 'plain' | 'soft' }) => <div className={`nui-layout-box nui-layout-col nui-gap-${gap} nui-tone-${tone}`}>{children}</div>
export const Grid = ({ children, gap = 'group', columns = 2 }: LayoutProps & { columns?: 2 | 3 | 4 }) => <div className={`nui-layout-grid nui-gap-${gap} nui-columns-${columns}`}>{children}</div>
export const Card = ({ children, gap = 'group', tone = 'outline' }: LayoutProps & { tone?: 'outline' | 'soft' }) => <section className={`nui-layout-card nui-layout-col nui-gap-${gap} nui-tone-${tone}`}>{children}</section>
export const Divider = () => <hr className="nui-layout-divider" />
export const Spacer = ({ size = 'group' }: { size?: Gap }) => <div className={`nui-layout-spacer nui-gap-${size}`} aria-hidden="true" />

export function Button({ variant = 'secondary', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  return <button {...props} type={type} className={`nui-button nui-button-${variant} ${className}`} />
}
type ControlledInput = Omit<InputHTMLAttributes<HTMLInputElement>, 'defaultValue' | 'value' | 'onChange'> & { value: string; onValueChange: (value: string) => void }
export function Input({ value, onValueChange, className = '', ...props }: ControlledInput) {
  return <input {...props} className={`nui-input ${className}`} value={value} onChange={e => onValueChange(e.target.value)} />
}
export function Select({ value, onValueChange, className = '', ...props }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'defaultValue' | 'value' | 'onChange'> & { value: string; onValueChange: (value: string) => void }) {
  return <select {...props} className={`nui-input ${className}`} value={value} onChange={e => onValueChange(e.target.value)} />
}
export function Checkbox({ checked, onCheckedChange, label, disabled }: { checked: boolean; onCheckedChange: (checked: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return <label className="nui-check"><input type="checkbox" checked={checked} disabled={disabled} onChange={e => onCheckedChange(e.target.checked)} /><span>{label}</span></label>
}
export function RadioGroup({ label, value, options, onValueChange, disabled }: { label: string; value: string; options: { value: string; label: string }[]; onValueChange: (value: string) => void; disabled?: boolean }) {
  const id = useId()
  return <fieldset className="nui-radio-group"><legend>{label}</legend>{options.map(option => <label key={option.value}><input type="radio" name={id} value={option.value} checked={value === option.value} disabled={disabled} onChange={() => onValueChange(option.value)} />{option.label}</label>)}</fieldset>
}
export function Slider({ label, value, min, max, step = 1, onValueChange, disabled }: { label: string; value: number; min: number; max: number; step?: number; onValueChange: (value: number) => void; disabled?: boolean }) {
  const id = useId(), shown = Number(value.toPrecision(8)).toLocaleString('zh-CN')
  return <div className="nui-slider"><label htmlFor={id}>{label}<output htmlFor={id}>{shown}</output></label><input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} aria-valuetext={shown} onChange={e => onValueChange(Number(Number(e.target.value).toPrecision(12)))} /><div className="nui-meta"><span>{min}</span><span>{max}</span></div></div>
}

export function Carousel({ children, gap = 'group' }: LayoutProps) {
  const track = useRef<HTMLDivElement>(null), [index, setIndex] = useState(0), [count, setCount] = useState(1), id = useId()
  useEffect(() => {
    const el = track.current!
    const update = () => {
      const items = [...el.children] as HTMLElement[], left = el.getBoundingClientRect().left
      setCount(Math.max(1, items.length))
      setIndex(items.reduce((best, item, i) => Math.abs(item.getBoundingClientRect().left - left) < Math.abs(items[best].getBoundingClientRect().left - left) ? i : best, 0))
    }
    update(); el.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update); observer.observe(el)
    return () => { observer.disconnect(); el.removeEventListener('scroll', update) }
  }, [children])
  function seek(next: number) {
    const el = track.current!, items = [...el.children] as HTMLElement[], at = Math.max(0, Math.min(items.length - 1, next))
    el.scrollTo({ left: items[at].offsetLeft - items[0].offsetLeft, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  return <div className="nui-carousel"><div className="nui-controls"><Button aria-controls={id} disabled={index === 0} onClick={() => seek(index - 1)}>上一项</Button><span className="nui-meta" role="status">{index + 1} / {count}</span><Button aria-controls={id} disabled={index === count - 1} onClick={() => seek(index + 1)}>下一项</Button></div><div id={id} ref={track} tabIndex={0} role="region" aria-label="横向浏览内容" className={`nui-carousel-track nui-gap-${gap}`} onKeyDown={e => { if (e.target === e.currentTarget && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); seek(e.key === 'Home' ? 0 : e.key === 'End' ? count - 1 : index + (e.key === 'ArrowRight' ? 1 : -1)) } }}>{children}</div></div>
}

export function Popover({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false), [position, setPosition] = useState({ left: 12, top: 12 }), trigger = useRef<HTMLButtonElement | null>(null), panel = useRef<HTMLDivElement>(null), id = useId()
  useEffect(() => {
    if (!open) return
    const place = () => {
      const anchor = trigger.current!.getBoundingClientRect(), box = panel.current!.getBoundingClientRect()
      setPosition({ left: Math.max(12, Math.min(anchor.left, window.innerWidth - box.width - 12)), top: Math.max(12, Math.min(anchor.bottom + 8, window.innerHeight - box.height - 12)) })
    }
    const outside = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setOpen(false) }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); trigger.current?.focus() } }
    place(); panel.current?.focus(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true); document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  return <><Button aria-expanded={open} aria-controls={open ? id : undefined} onClick={e => { trigger.current = e.currentTarget; setOpen(v => !v) }}>{title}</Button>{open && createPortal(<div id={id} ref={panel} tabIndex={-1} className="nui-popover-panel" role="dialog" aria-label={title} style={position} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); trigger.current?.focus() } }}><header><strong>{title}</strong><Button aria-label="关闭附加说明" variant="ghost" onClick={() => { setOpen(false); trigger.current?.focus() }}>关闭</Button></header>{children}</div>, trigger.current?.closest('[role=dialog]') ?? document.body)}</>
}
