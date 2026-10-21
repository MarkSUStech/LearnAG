import { useEffect, useId, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import InlineMarkdown from './InlineMarkdown'
import type { DataByName } from './parser'
import { distributionCurve, plotValue, sequenceFrames, vennSelection, type Parameter } from './interactiveModels'
import { Slider } from './primitives'

type Name = 'sequence' | 'distribution' | 'venn' | 'matrix' | 'numberline' | 'geometry' | 'plot' | 'playback'
type Props<N extends Name> = { data: DataByName[N]; params: Record<string, string> }
const format = (v: number) => Number(v.toPrecision(5)).toLocaleString('zh-CN', { maximumFractionDigits: 5 })
const color = (i: number) => `var(--nui-series-${i % 6})`

function FrameControls({ index, count, onChange }: { index: number; count: number; onChange: (i: number) => void }) {
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (!playing || index >= count - 1) { setPlaying(false); return }
    const timer = setTimeout(() => onChange(index + 1), 1000)
    return () => clearTimeout(timer)
  }, [playing, index, count, onChange])
  function seek(i: number) { setPlaying(false); onChange(i) }
  return <div className="nui-frame-controls">
    <input aria-label="演示进度" type="range" min={0} max={Math.max(0, count - 1)} value={index} onChange={e => seek(+e.target.value)} disabled={count < 2} />
    <div className="nui-controls"><button onClick={() => seek(0)} disabled={index === 0}>重置</button><button onClick={() => seek(index - 1)} disabled={index === 0}>上一步</button>
      <button className="nui-action" onClick={() => seek(index + 1)} disabled={index >= count - 1}>下一步</button>
      <button onClick={() => setPlaying(v => !v)} disabled={index >= count - 1} aria-pressed={playing}>{playing ? '暂停' : '播放'}</button><span className="nui-meta">{index + 1} / {count}</span></div>
  </div>
}
function Sequence({ data }: Props<'sequence'>) {
  const frames = useMemo(() => sequenceFrames(data), [data]), [index, setIndex] = useState(0), [selected, setSelected] = useState<number | null>(null)
  const frame = frames[index], item = data.items.find(v => v.id === selected)
  const categories = [...new Set(data.items.map(v => v.value))]
  // Keep atomic symbols as beads; legacy prose needs a readable, wrapping cell.
  const labels = data.items.some(v => !/^[\p{L}\p{N}+-]{1,3}$/u.test(v.value))
  return <div>
    <div className="nui-meta"><span>{data.mode === 'cancel' ? `相消规则：${data.pair.join(' → ')}，仅相邻且方向匹配` : data.mode === 'sort' ? '插入排序 · 相邻交换 · 升序' : '按原始顺序展示；点击元素查看说明'}</span>{data.mode === 'cancel' && <span>已消去 {frame.removed} 对</span>}</div>
    <div className={`nui-sequence-track${labels ? ' nui-sequence-labels' : ''}`} aria-label="当前序列">{frame.items.map((v, i) => <div className="nui-sequence-item" key={v.id}>
      <button className={`${labels ? 'nui-sequence-label' : 'nui-bead'} ${frame.active.includes(v.id) ? 'is-active' : ''}`} style={{ '--bead-color': v.value === 'B' ? 'var(--nui-blue)' : v.value === 'R' ? 'var(--nui-red)' : color(categories.indexOf(v.value)) } as React.CSSProperties} aria-label={`位置 ${i}：${v.value}${v.detail ? '，' + v.detail : ''}`} aria-pressed={selected === v.id} onClick={() => setSelected(v.id)}><InlineMarkdown text={v.value} /></button><span>{i}</span></div>)}
      {!frame.items.length && <p className="nui-empty">序列已全部消去</p>}</div>
    <div className="nui-inspector" role="status"><strong>{frame.message}</strong>{item?.detail && <p><InlineMarkdown text={item.detail} />{!frame.items.some(v => v.id === item.id) && '（该元素已消去）'}</p>}</div>
    {data.mode !== 'static' && <FrameControls index={index} count={frames.length} onChange={setIndex} />}
  </div>
}
function Playback({ data }: Props<'playback'>) {
  const [index, setIndex] = useState(0), frame = data.frames[index]
  return <div><h4 className="nui-frame-title"><InlineMarkdown text={frame.label} /></h4><div className="nui-sequence-track" aria-label="当前状态">{frame.values.map((value, i) => <div className="nui-sequence-item" key={i}><span className={`nui-state-cell ${frame.active.includes(i) ? 'is-active' : ''}`}><InlineMarkdown text={value} /></span><span>{i}</span></div>)}</div>
    <div className="nui-inspector" role="status"><InlineMarkdown text={frame.detail} /></div><FrameControls index={index} count={data.frames.length} onChange={setIndex} /><p className="nui-meta">按 Markdown 中给定状态回放，不执行算法或验证推导。</p></div>
}
function ParameterControls({ parameters, values, onChange }: { parameters: Parameter[]; values: Record<string, number>; onChange: (p: Record<string, number>) => void }) {
  return <div className="nui-parameters">{parameters.map(p => <Slider key={p.name} label={({ lambda: '平均发生次数 λ', n: '试验次数 n', p: '成功概率 p', mu: '均值 μ', sigma: '标准差 σ' } as Record<string, string>)[p.name] ?? p.name} value={values[p.name]} min={p.min} max={p.max} step={p.step} onValueChange={value => onChange({ ...values, [p.name]: value })} />)}</div>
}
/** Small domain plot shared by distribution and safe built-in functions; no expression interpreter. */
function Curve({ points, continuous, label, fixedX }: { points: { x: number; y: number }[]; continuous: boolean; label: string; fixedX?: [number, number] }) {
  const [active, setActive] = useState<number | null>(null), id = useId()
  const W = 640, H = 290, l = 60, r = 18, top = 18, bottom = 42, width = W - l - r, height = H - top - bottom
  const xmin = fixedX?.[0] ?? points[0].x, xmax = fixedX?.[1] ?? points[points.length - 1].x
  const low = Math.min(0, ...points.map(p => p.y)), high = Math.max(0, ...points.map(p => p.y)), span = high - low || 1
  const ymin = low < 0 ? low - span * .05 : 0, ymax = high + span * .1
  const xp = (x: number) => l + (x - xmin) / (xmax - xmin || 1) * width, yp = (y: number) => top + (ymax - y) / (ymax - ymin) * height
  const barWidth = width / points.length * .8, tickEvery = Math.max(1, Math.ceil(points.length / 12))
  const key = (e: React.KeyboardEvent<SVGElement>, i: number) => {
    if (e.key === 'Escape') setActive(null)
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const next = Math.max(0, Math.min(points.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1))); (e.currentTarget.parentElement?.querySelector(`[data-point="${next}"]`) as SVGElement | null)?.focus() }
  }
  const last = active !== null ? points[active] : null
  return <div className="nui-plot nui-domain-plot"><svg viewBox={`0 0 ${W} ${H}`} aria-labelledby={id} role="group"><title id={id}>{label}，左右方向键浏览数据点</title>
    {Array.from({ length: 5 }, (_, i) => { const y = ymin + (ymax - ymin) * i / 4; return <g key={i}><line className="nui-gridline" x1={l} x2={W - r} y1={yp(y)} y2={yp(y)} /><text x={l - 8} y={yp(y) + 4} textAnchor="end">{format(y)}</text></g> })}
    <line className="nui-baseline" x1={l} x2={W - r} y1={yp(0)} y2={yp(0)} />
    {continuous && <path d={points.map((p, i) => `${i ? 'L' : 'M'}${xp(p.x)},${yp(p.y)}`).join(' ')} fill="none" stroke={color(0)} strokeWidth={2.5} />}
    {points.map((p, i) => <g key={i}>
      {i % tickEvery === 0 && <text x={continuous ? xp(p.x) : l + (i + .5) * width / points.length} y={H - 16} textAnchor="middle">{format(p.x)}</text>}
    </g>)}
    <g>{points.map((p, i) => continuous ? <circle key={i} data-point={i} cx={xp(p.x)} cy={yp(p.y)} r={active === i ? 5 : 3} fill={color(0)} opacity={active === i ? 1 : .05} tabIndex={active === i || (active === null && i === 0) ? 0 : -1} role="img" aria-label={`x=${format(p.x)}，${label}=${format(p.y)}`} onKeyDown={e => key(e, i)} onFocus={() => setActive(i)} onMouseEnter={() => setActive(i)} /> : <rect key={i} data-point={i} x={l + (i + .5) * width / points.length - barWidth / 2} y={yp(p.y)} width={barWidth} height={Math.max(.5, yp(0) - yp(p.y))} rx={3} fill={color(i)} tabIndex={active === i || (active === null && i === 0) ? 0 : -1} role="img" aria-label={`k=${p.x}，${label}=${format(p.y)}`} onKeyDown={e => key(e, i)} onFocus={() => setActive(i)} onMouseEnter={() => setActive(i)} />)}</g>
  </svg><div className="nui-tooltip" role="status">{last ? `${continuous ? 'x' : 'k'} = ${format(last.x)} · ${label} = ${format(last.y)}` : '悬停或聚焦图中数据点，查看详细数值'}</div></div>
}
const initialValues = (parameters: Parameter[]) => Object.fromEntries(parameters.map(p => [p.name, p.value]))
function Distribution({ data }: Props<'distribution'>) {
  const [values, setValues] = useState(() => initialValues(data.parameters)), curve = useMemo(() => distributionCurve(data.type, values), [data.type, values])
  return <div><p className="nui-meta">{({ poisson: '泊松分布 · 独立事件的发生次数', binomial: '二项分布 · 独立重复试验的成功次数', normal: '正态分布 · 连续概率密度' })[data.type]}</p><ParameterControls parameters={data.parameters} values={values} onChange={setValues} />
    <Curve points={curve.points} continuous={curve.continuous} label={curve.continuous ? 'f(x)' : 'P(X=k)'} />
    <dl className="nui-stats"><div><dt>期望 E(X)</dt><dd className="nui-stat-value">{format(curve.mean)}</dd></div><div><dt>方差 Var(X)</dt><dd className="nui-stat-value">{format(curve.variance)}</dd></div></dl>
    <div className="nui-controls"><button onClick={() => setValues(initialValues(data.parameters))}>恢复参数</button><span className="nui-meta">{curve.continuous ? '显示 μ ± 4σ；曲线高度是密度，不是点概率。' : data.type === 'poisson' ? '显示 0 至 λ + 6√λ 附近；尾部未展示。' : '显示全部 0…n 个可能取值。'}</span></div></div>
}
function Plot({ data }: Props<'plot'>) {
  const [values, setValues] = useState(() => initialValues(data.parameters)), points = Array.from({ length: 121 }, (_, i) => ({ x: -5 + i / 12, y: plotValue(data.fn, -5 + i / 12, values) }))
  const formula = { linear: 'ax+b', quadratic: 'ax^2+bx+c', sine: String.raw`a\sin(bx+c)`, exponential: 'ae^{bx}' }[data.fn]
  return <div><p className="nui-function-label"><InlineMarkdown text={`$f(x)=${formula}$`} /></p><ParameterControls parameters={data.parameters} values={values} onChange={setValues} /><Curve points={points} continuous label="f(x)" fixedX={[-5, 5]} /><div className="nui-controls"><button onClick={() => setValues(initialValues(data.parameters))}>恢复参数</button><span className="nui-meta">x ∈ [−5, 5]；纵轴随参数缩放，仅采样展示。</span></div></div>
}
function Venn({ data }: Props<'venn'>) {
  const id = useId().replace(/:/g, ''), [selected, setSelected] = useState<number | null>(null), [mode, setMode] = useState('union'), all = (1 << data.sets.length) - 1
  const three = data.sets.length === 3, circles = three ? [[225, 185], [395, 185], [310, 325]] : [[230, 185], [390, 185]], radius = three ? 148 : 145
  const positions: Record<number, number[]> = three ? { 1: [160, 175], 2: [460, 175], 4: [310, 405], 3: [310, 115], 5: [220, 285], 6: [400, 285], 7: [310, 230] } : { 1: [175, 185], 2: [445, 185], 3: [310, 185] }
  const current = data.regions.find(r => r.mask === selected), members = (mask: number) => data.sets.filter((_, i) => mask & (1 << i)).join(' ∩ ')
  const total = data.regions.filter(r => vennSelection(r.mask, mode, all)).reduce((v, r) => v + (r.count ?? 0), 0)
  return <div><div className="nui-segmented" aria-label="集合范围">{[['union', '并集'], ['intersection', '共同交集'], ['exclusive', '仅属一个']].map(([key, label]) => <button key={key} aria-pressed={mode === key} onClick={() => setMode(key)}>{label}</button>)}</div>
    <svg className="nui-venn-canvas" viewBox={`0 0 620 ${three ? 500 : 370}`} role="group" aria-label={`${data.sets.join('、')} 的互斥区域维恩图`}>
      <defs>{circles.map(([cx, cy], i) => <clipPath id={`${id}-clip-${i}`} key={i}><circle cx={cx} cy={cy} r={radius} /></clipPath>)}{Array.from({ length: all }, (_, k) => k + 1).map(mask => <mask id={`${id}-mask-${mask}`} key={mask}><rect width={620} height={500} fill="white" />{circles.map(([cx, cy], i) => !(mask & (1 << i)) && <circle key={i} cx={cx} cy={cy} r={radius} fill="black" />)}</mask>)}</defs>
      {Array.from({ length: all }, (_, k) => k + 1).map(mask => {
        let content: ReactNode = <rect width={620} height={500} fill={color(mask === selected ? 0 : mask % 3)} opacity={vennSelection(mask, mode, all) ? mask === selected ? .4 : .18 : .025} mask={`url(#${id}-mask-${mask})`} />
        data.sets.forEach((_, i) => { if (mask & (1 << i)) content = <g clipPath={`url(#${id}-clip-${i})`}>{content}</g> })
        return <g key={mask}>{content}</g>
      })}
      {circles.map(([cx, cy], i) => <g key={i}><circle cx={cx} cy={cy} r={radius} fill="none" stroke={color(i)} strokeWidth={2.5} /><text x={i === 0 ? cx - 115 : i === 1 ? cx + 115 : cx + 125} y={i < 2 ? cy - 150 : cy + 120} fill={color(i)} fontSize={25} fontWeight={600} textAnchor="middle">{data.sets[i]}</text></g>)}
      {data.regions.map(r => { const [x, y] = positions[r.mask]; return <g key={r.mask} role="button" tabIndex={0} aria-pressed={selected === r.mask} aria-label={`${members(r.mask)} 专属区域：${r.label}${r.count !== undefined ? '，数量 ' + r.count : ''}`} onClick={() => setSelected(r.mask)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(r.mask) } }} className="nui-venn-region" opacity={vennSelection(r.mask, mode, all) ? 1 : .3}><title>{r.label}</title><circle cx={x} cy={y} r={23} fill="var(--panel)" stroke={r.mask === selected ? 'var(--accent)' : 'var(--border)'} /><text x={x} y={y + 6} textAnchor="middle" fill="var(--text)" fontSize={17}>{r.label.length > 4 ? r.label.slice(0, 3) + '…' : r.label}</text></g> })}
    </svg><div className="nui-inspector" role="status">{current ? <><strong>{members(current.mask)}，且不属于其余集合</strong><p><InlineMarkdown text={current.label} />{current.count !== undefined && ` · 数量 ${current.count}`}</p></> : '点击区域查看归属；每行表示一个互斥区域，同一元素只计一次。'}</div>{data.regions.every(r => r.count !== undefined) && <p className="nui-meta">所示区域数量合计：{format(total)}（仅统计提供的数据行）</p>}</div>
}
function Matrix({ data }: Props<'matrix'>) {
  const [heat, setHeat] = useState(data.numeric), [selected, setSelected] = useState<[number, number] | null>(null)
  const nums = data.numeric ? data.rows.flatMap(r => r.values.map(Number)) : [], min = Math.min(...nums), max = Math.max(...nums)
  return <div>{data.numeric && <div className="nui-controls"><button aria-pressed={heat} onClick={() => setHeat(v => !v)}>热力底色</button><span className="nui-meta">低 {format(min)} → 高 {format(max)}</span></div>}<div className="nui-table-scroll"><table className="nui-matrix-grid"><caption className="nui-visually-hidden">矩阵数据，点击单元格查看行列坐标</caption><thead><tr><th scope="col">行 / 列</th>{data.columns.map(c => <th scope="col" key={c}><InlineMarkdown text={c} /></th>)}</tr></thead><tbody>{data.rows.map((r, ri) => <tr key={ri}><th scope="row"><InlineMarkdown text={r.label} /></th>{r.values.map((v, ci) => <td key={ci}><button aria-label={`${r.label}，${data.columns[ci]}：${v}`} aria-pressed={selected?.[0] === ri && selected?.[1] === ci} style={heat ? { background: `color-mix(in srgb, var(--accent) ${10 + (Number(v) - min) / (max - min || 1) * 40}%, var(--panel))` } : undefined} onClick={() => setSelected([ri, ci])}><InlineMarkdown text={v} /></button></td>)}</tr>)}</tbody></table></div><p className="nui-inspector" role="status">{selected ? <><InlineMarkdown text={data.rows[selected[0]].label} /> × <InlineMarkdown text={data.columns[selected[1]]} /> = <InlineMarkdown text={data.rows[selected[0]].values[selected[1]]} /></> : '点击单元格查看坐标和值；可用于矩阵、动态规划状态、棋盘或实验数据。'}</p></div>
}
function Numberline({ data }: Props<'numberline'>) {
  const [selected, setSelected] = useState(0), lo = Math.min(...data.map(d => d.from)), hi = Math.max(...data.map(d => d.to)), pad = (hi - lo || 1) * .1, min = lo - pad, max = hi + pad
  const x = (v: number) => 46 + (v - min) / (max - min) * 548, height = 55 + data.length * 55
  return <div className="nui-plot"><svg viewBox={`0 0 640 ${height}`} aria-label="数轴上的有限区间" role="group"><line x1={32} x2={610} y1={25} y2={25} className="nui-baseline" />{Array.from({ length: 6 }, (_, i) => { const value = min + (max - min) * i / 5; return <text key={i} x={x(value)} y={15} textAnchor="middle">{format(value)}</text> })}
    {data.map((d, i) => { const y = 55 + i * 55; return <g key={i} className="nui-interval" role="button" tabIndex={0} aria-pressed={selected === i} aria-label={`${d.label}：${d.bounds[0]}${d.from}, ${d.to}${d.bounds[1]}`} onClick={() => setSelected(i)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(i) } }}><rect x={25} y={y - 14} width={590} height={49} rx={5} fill={selected === i ? 'var(--accent-weak)' : 'transparent'} /><line x1={x(d.from)} x2={x(d.to)} y1={y} y2={y} stroke={color(i)} strokeWidth={4} />{[d.from, d.to].map((v, j) => <circle key={j} cx={x(v)} cy={y} r={5} stroke={color(i)} strokeWidth={2} fill={(j === 0 ? d.bounds[0] === '[' : d.bounds[1] === ']') ? color(i) : 'var(--panel)'} />)}<text x={x((d.from + d.to) / 2)} y={y + 24} textAnchor="middle">{d.label}</text></g> })}</svg><p className="nui-inspector" role="status"><InlineMarkdown text={data[selected].label} />：{data[selected].bounds[0]}{data[selected].from}, {data[selected].to}{data[selected].bounds[1]} · 实心含端点，空心不含端点</p></div>
}
function Geometry({ data }: Props<'geometry'>) {
  const [selected, setSelected] = useState<number | null>(null), id = useId().replace(/:/g, '')
  // Equal units on both axes preserve angles and lengths. Vectors include the origin.
  const xs = data.points.map(p => p.x), ys = data.points.map(p => p.y)
  if (data.mode === 'vectors') { xs.push(0); ys.push(0) }
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys), unit = Math.min(500 / (xmax - xmin || 1), 290 / (ymax - ymin || 1))
  const xp = (x: number) => 320 + (x - (xmin + xmax) / 2) * unit, yp = (y: number) => 190 - (y - (ymin + ymax) / 2) * unit
  const point = selected !== null ? data.points[selected] : null
  return <div><svg className="nui-geometry-canvas" viewBox="0 0 640 380" role="group" aria-label="等比例二维坐标图"><defs><marker id={id} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" /></marker></defs>
    {xmin <= 0 && xmax >= 0 && <line className="nui-baseline" x1={xp(0)} x2={xp(0)} y1={25} y2={355} />}{ymin <= 0 && ymax >= 0 && <line className="nui-baseline" x1={40} x2={600} y1={yp(0)} y2={yp(0)} />}
    {data.mode === 'polygon' && <polygon points={data.points.map(p => `${xp(p.x)},${yp(p.y)}`).join(' ')} fill="var(--accent-weak)" stroke={color(0)} strokeWidth={2} />}
    {data.points.map((p, i) => <g key={i} tabIndex={0} role="button" aria-label={`${p.label} (${p.x}, ${p.y})`} aria-pressed={selected === i} onFocus={() => setSelected(i)} onClick={() => setSelected(i)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(i) } }}>
      {data.mode === 'vectors' && <line x1={xp(0)} y1={yp(0)} x2={xp(p.x)} y2={yp(p.y)} stroke="var(--accent)" strokeWidth={2} markerEnd={`url(#${id})`} />}<circle cx={xp(p.x)} cy={yp(p.y)} r={selected === i ? 7 : 5} fill={color(i)} /><text x={xp(p.x)} y={yp(p.y) - 14} textAnchor="middle" fill="var(--text)" fontSize={13}>{p.label}</text></g>)}
  </svg><p className="nui-inspector" role="status">{point ? `${point.label} = (${point.x}, ${point.y})${data.mode === 'vectors' ? ' · 长度 ' + format(Math.hypot(point.x, point.y)) : ''}` : '点击或聚焦点查看坐标；横纵坐标使用相同单位比例。'}</p></div>
}
export const interactiveRegistry: { [N in Name]: { label: string; render: ComponentType<Props<N>> } } = {
  sequence: { label: '序列与操作', render: Sequence }, distribution: { label: '概率分布实验', render: Distribution }, venn: { label: '集合与归属', render: Venn },
  matrix: { label: '矩阵与网格', render: Matrix }, numberline: { label: '数轴与区间', render: Numberline }, geometry: { label: '坐标与几何', render: Geometry },
  plot: { label: '函数探索', render: Plot }, playback: { label: '状态回放', render: Playback },
}
