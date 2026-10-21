import { useId, useState } from 'react'
import type { DrawingData, DrawingShape } from './svgModel'
import { drawingLabelLines } from './svgModel'

const colors: Record<string, string> = { ink: 'var(--text)', muted: 'var(--text-2)', accent: 'var(--accent)', success: 'var(--mastered)', warning: 'var(--learning)', danger: 'var(--danger)', blue: 'var(--nui-blue)', red: 'var(--nui-red)' }
for (let i = 1; i <= 6; i++) colors[`series${i}`] = `var(--nui-series-${i - 1})`
function Shape({ shape, marker }: { shape: DrawingShape; marker: string }) {
  const [x, y] = shape.position, [w, h] = shape.size
  const filled = ['rect', 'circle', 'ellipse', 'polygon'].includes(shape.kind)
  const stroke = colors[shape.color], base = { stroke, strokeWidth: 2, fill: filled ? `color-mix(in srgb, ${stroke} 12%, var(--panel))` : 'none' }
  const labelWidth = shape.kind === 'rect' ? w : shape.kind === 'circle' || shape.kind === 'ellipse' ? w * 1.5 : 180
  const font = shape.kind === 'text' ? w || 14 : 14
  const lines = drawingLabelLines(shape.text, labelWidth, font)
  const cx = shape.kind === 'rect' ? x + w / 2 : x, cy = shape.kind === 'rect' ? y + h / 2 : y
  return <>
    {shape.kind === 'rect' && <rect x={x} y={y} width={w} height={h} rx={6} {...base} />}
    {shape.kind === 'circle' && <circle cx={x} cy={y} r={w} {...base} />}
    {shape.kind === 'ellipse' && <ellipse cx={x} cy={y} rx={w} ry={h} {...base} />}
    {(shape.kind === 'line' || shape.kind === 'arrow') && <line x1={x} y1={y} x2={w} y2={h} {...base} markerEnd={shape.kind === 'arrow' ? `url(#${marker})` : undefined} />}
    {shape.kind === 'polygon' && <polygon points={shape.position.reduce<string[]>((p, n, i) => { if (i % 2 === 0) p.push(`${n},${shape.position[i + 1]}`); return p }, []).join(' ')} {...base} />}
    {shape.kind === 'path' && <path d={shape.path} {...base} />}
    {shape.text && !['path', 'polygon', 'line', 'arrow'].includes(shape.kind) && <text x={cx} y={cy - (lines.length - 1) * font * .65} textAnchor={shape.kind === 'text' ? 'start' : 'middle'} dominantBaseline="middle" fill={shape.kind === 'text' ? stroke : colors.ink} fontSize={font}>{lines.map((line, i) => <tspan key={i} x={cx} dy={i ? font * 1.3 : 0}>{line}</tspan>)}</text>}
  </>
}
export default function Drawing({ data }: { data: DrawingData; params: Record<string, string> }) {
  const id = useId().replace(/:/g, ''), [selected, setSelected] = useState<number | null>(null)
  return <div className="nui-drawing"><svg viewBox={`0 0 ${data.width} ${data.height}`} role="group" aria-label="自定义示意图，聚焦或点击图形查看说明">
    <defs>{Object.entries(colors).map(([color, value]) => <marker key={color} id={`${id}-${color}`} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 Z" fill={value} /></marker>)}</defs>
    {data.shapes.map((shape, i) => <g key={i} role="button" tabIndex={0} aria-label={shape.text || `${shape.kind} 图形 ${i + 1}`} aria-pressed={selected === i} className="nui-drawing-shape" onClick={() => setSelected(i)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(i) } if (e.key === 'Escape') setSelected(null) }}><title>{shape.text || shape.kind}</title><Shape shape={shape} marker={`${id}-${shape.color}`} /></g>)}
  </svg><p className="nui-drawing-caption" role="status">{selected === null ? '聚焦或点击图形查看标注。图形来自原文坐标，不执行代码。' : data.shapes[selected].text || `${data.shapes[selected].kind}：位置 ${data.shapes[selected].position.join(', ')}；尺寸/终点 ${data.shapes[selected].size.join(', ')}`}</p></div>
}
