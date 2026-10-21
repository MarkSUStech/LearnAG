import { Component, useContext, useEffect, useId, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import DOMPurify from 'dompurify'
import RichText from '../components/RichText'
import { renderBeautiful } from '../components/editor/beautifulMermaid'
import type { ComponentName, DataByName, GraphData, NoteUIBlock as Block, TableData } from './parser'
import { learningRegistry } from './LearningComponents'
import { interactiveRegistry } from './InteractiveComponents'
import InlineMarkdown from './InlineMarkdown'
import { layoutRegistry } from './LayoutComponents'
import { noteUIRegistry } from '../../shared/noteuiRegistry'
import { NoteUIThemeContext } from './theme'
import Drawing from './Drawing'

type RendererProps<N extends ComponentName> = { data: DataByName[N]; params: Record<string, string> }
const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3, notation: 'compact' })
const percent = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 })
const color = (i: number) => `var(--nui-series-${i % 6})`
function Markdown({ text }: { text: string }) { return <RichText text={text} noteUI={false} /> }

function Chart({ data, params }: RendererProps<'chart'>) {
  const { x, series, type } = data
  const [hidden, setHidden] = useState<string[]>([])
  const [active, setActive] = useState<{ row: number; series: number } | null>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const [plotWidth, setPlotWidth] = useState(640)
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setPlotWidth(Math.max(280, Math.min(640, Math.round(entry.contentRect.width)))))
    if (plotRef.current) observer.observe(plotRef.current)
    return () => observer.disconnect()
  }, [])
  const visible = series.map((s, i) => ({ ...s, i })).filter(s => !hidden.includes(s.name))
  const values = visible.flatMap(s => s.values)
  const low = Math.min(0, ...values), high = Math.max(0, ...values)
  const roughStep = Math.max((high - low || 1) / 4, 1e-300), power = 10 ** Math.floor(Math.log10(roughStep))
  const step = [1, 2, 2.5, 5, 10].find(n => n * power >= roughStep)! * power
  const min = Math.floor(low / step) * step, max = high === low ? min + step * 4 : Math.ceil(high / step) * step
  const span = max - min || 1
  const W = plotWidth, H = W < 400 ? 240 : 270, left = W < 400 ? 48 : 62, right = 18, top = 22, bottom = 42
  const width = W - left - right, height = H - top - bottom
  const yPos = (value: number) => top + (max - value) / span * height
  const nx = data.numericX
  const xmin = nx ? Math.min(...nx) : 0, xspan = nx ? Math.max(...nx) - xmin || 1 : 1
  const xPos = (i: number) => type === 'scatter' && nx ? left + (nx[i] - xmin) / xspan * width : left + (i + .5) * width / x.length
  const titleId = useId()
  const pointLabel = (r: number, s: number) => `${x[r]} · ${series[s].name}：${series[s].values[r]}`
  const handlers = (row: number, s: number) => ({
    tabIndex: 0, role: 'img', 'aria-label': pointLabel(row, s),
    onMouseEnter: () => setActive({ row, series: s }), onMouseLeave: () => setActive(null),
    onFocus: () => setActive({ row, series: s }), onBlur: () => setActive(null),
    onKeyDown: (e: React.KeyboardEvent<SVGElement>) => {
      if (e.key === 'Escape') setActive(null)
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        const next = (row + (e.key === 'ArrowRight' ? 1 : -1) + x.length) % x.length
        e.currentTarget.ownerSVGElement?.querySelectorAll<SVGElement>(`[data-series="${s}"]`)[next]?.focus()
      }
    },
    'data-series': s,
  })
  const total = series[0].values.reduce((a, b) => a + b, 0)
  let angle = -Math.PI / 2
  return <div className="nui-chart">
    <div className="nui-plot" ref={plotRef}>
      <svg viewBox={`0 0 ${W} ${H}`} aria-labelledby={titleId}>
        <title id={titleId}>{params.title ?? `${params.x} 与 ${params.y} 的${{ line: '折线图', bar: '柱状图', pie: '饼图', scatter: '散点图' }[type]}`}</title>
        {type === 'pie' ? series[0].values.map((value, i) => {
          const a = angle, b = angle += value / total * Math.PI * 2
          const cx = W / 2, cy = H / 2, r = W < 400 ? 90 : 106
          const d = `M ${cx} ${cy} L ${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)} A ${r} ${r} 0 ${b - a > Math.PI ? 1 : 0} 1 ${cx + r * Math.cos(b)} ${cy + r * Math.sin(b)} Z`
          return value / total > .999999 ? <circle key={i} cx={cx} cy={cy} r={r} fill={color(i)} {...handlers(i, 0)}><title>{pointLabel(i, 0)}</title></circle> :
            <path key={i} d={d} fill={color(i)} stroke="var(--panel)" strokeWidth="2" {...handlers(i, 0)}><title>{pointLabel(i, 0)}</title></path>
        }) : <>
          {Array.from({ length: Math.round(span / step) + 1 }, (_, i) => {
            const value = min + step * i, y = yPos(value)
            return <g key={i}><line className="nui-gridline" x1={left} x2={W - right} y1={y} y2={y} /><text x={left - 10} y={y + 4} textAnchor="end">{number.format(value)}</text></g>
          })}
          <line className="nui-baseline" x1={left} x2={W - right} y1={yPos(0)} y2={yPos(0)} />
          {visible.map(s => <g key={s.name}>
            {type === 'line' && <polyline fill="none" stroke={color(s.i)} strokeWidth="2.5" strokeLinejoin="round" points={s.values.map((v, i) => `${xPos(i)},${yPos(v)}`).join(' ')} />}
            {s.values.map((v, i) => type === 'bar' ?
              <rect key={i} x={xPos(i) - width / x.length * .36 + visible.indexOf(s) * width / x.length * .72 / visible.length} y={Math.min(yPos(v), yPos(0))} width={Math.max(.3, width / x.length * .72 / visible.length - 1)} height={Math.max(1, Math.abs(yPos(v) - yPos(0)))} rx="2" fill={color(s.i)} {...handlers(i, s.i)}><title>{pointLabel(i, s.i)}</title></rect> :
              <circle key={i} cx={xPos(i)} cy={yPos(v)} r={type === 'scatter' ? 5 : x.length > 80 ? 2 : 4} fill={color(s.i)} stroke="var(--panel)" strokeWidth="1.5" {...handlers(i, s.i)}><title>{pointLabel(i, s.i)}</title></circle>)}
          </g>)}
          {x.map((label, i) => i % Math.max(1, Math.ceil(x.length / (W < 400 ? 4 : 7))) === 0 && <text key={i} x={xPos(i)} y={H - 18} textAnchor="middle">{label.length > (W < 400 ? 6 : 12) ? label.slice(0, W < 400 ? 5 : 11) + '…' : label}</text>)}
        </>}
      </svg>
      <div className="nui-tooltip" role="status" aria-live="polite">{active ? pointLabel(active.row, active.series) : '悬停或聚焦数据点查看详情'}</div>
    </div>
    <div className="nui-legend" aria-label="图例">
      {type === 'pie' ? x.map((label, i) => <span key={i}><i style={{ background: color(i) }} />{label} <strong>{percent.format(series[0].values[i] / total * 100)}%</strong></span>) :
        series.map((s, i) => <button key={s.name} type="button" aria-pressed={!hidden.includes(s.name)} onClick={() => {
          setActive(null)
          setHidden(h => h.includes(s.name) ? h.filter(n => n !== s.name) : h.length < series.length - 1 ? [...h, s.name] : h)
        }}><i style={{ background: color(i) }} />{s.name}</button>)}
    </div>
  </div>
}

function ExpandRows({ children, total, expanded, onToggle }: { children: ReactNode; total: number; expanded: boolean; onToggle: () => void }) {
  return <>{children}{total > 6 && <button type="button" className="nui-more" aria-expanded={expanded} onClick={onToggle}>{expanded ? '收起' : `展开其余 ${total - 6} 项`}</button>}</>
}

function Stats({ data }: RendererProps<'stats'>) {
  const [expanded, setExpanded] = useState(false)
  return <ExpandRows total={data.rows.length} expanded={expanded} onToggle={() => setExpanded(!expanded)}>
    <dl className="nui-stats">{data.rows.slice(0, expanded ? undefined : 6).map((r, i) => <div key={i}>
      <dt><Markdown text={r[0]} /></dt><dd className="nui-stat-value"><Markdown text={r[1]} /></dd>
      {r.slice(2).map((v, j) => <dd key={j} className="nui-stat-detail"><span><InlineMarkdown text={data.headers[j + 2]} /> </span><InlineMarkdown text={v} /></dd>)}
    </div>)}</dl>
  </ExpandRows>
}

function DataTable({ data }: { data: TableData }) {
  return <div className="nui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table>
    <thead><tr>{data.headers.map(h => <th key={h} scope="col"><InlineMarkdown text={h} /></th>)}</tr></thead>
    <tbody>{data.rows.map((r, i) => <tr key={i}>{r.map((c, j) => j === 0 ? <th key={j} scope="row"><Markdown text={c} /></th> : <td key={j}><Markdown text={c} /></td>)}</tr>)}</tbody>
  </table></div>
}

function Compare({ data, params }: RendererProps<'compare'>) {
  const [layout, setLayout] = useState(params.layout ?? 'auto')
  const [expanded, setExpanded] = useState(false)
  const rows = expanded ? data.rows : data.rows.slice(0, 6)
  return <>
    <div className="nui-segmented" role="group" aria-label="对比展示方式">{[['auto', '自动'], ['table', '表格'], ['cards', '卡片']].map(([v, label]) => <button type="button" key={v} aria-pressed={layout === v} onClick={() => setLayout(v)}>{label}</button>)}</div>
    <ExpandRows total={data.rows.length} expanded={expanded} onToggle={() => setExpanded(!expanded)}>
      <div className={`nui-compare nui-layout-${layout}`}>
        <div className="nui-compare-table"><DataTable data={{ ...data, rows }} /></div>
        <div className="nui-compare-cards">{rows.map((r, i) => <article key={i}>
          <h4><Markdown text={r[0]} /></h4><dl>{data.headers.slice(1).map((h, j) => <div key={h}><dt><InlineMarkdown text={h} /></dt><dd><Markdown text={r[j + 1]} /></dd></div>)}</dl>
        </article>)}</div>
      </div>
    </ExpandRows>
  </>
}

function Steps({ data, params }: RendererProps<'steps'>) {
  const [expanded, setExpanded] = useState(false)
  return <ExpandRows total={data.length} expanded={expanded} onToggle={() => setExpanded(!expanded)}>
    <ol className={`nui-steps nui-${params.mode ?? 'steps'}`}>{data.slice(0, expanded ? undefined : 6).map((s, i) => <li key={i}>
      <span className="nui-step-number" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
      {s.body ? <details><summary><InlineMarkdown text={s.title} /></summary><Markdown text={s.body} /></details> : <div className="nui-step-title"><InlineMarkdown text={s.title} /></div>}
    </li>)}</ol>
  </ExpandRows>
}

function Quiz({ data }: RendererProps<'quiz'>) {
  const [selected, setSelected] = useState<string[]>([]), [submitted, setSubmitted] = useState(false)
  const id = useId()
  const answers = data.answer.split(','), correct = selected.length === answers.length && selected.every(s => answers.includes(s))
  return <form className="nui-quiz" onSubmit={e => { e.preventDefault(); if (selected.length) setSubmitted(true) }}>
    <fieldset><legend><Markdown text={data.question} /></legend>
      {data.options.map(option => <label key={option.id} className={submitted ? answers.includes(option.id) ? 'correct' : selected.includes(option.id) ? 'incorrect' : '' : ''}>
        <input type={data.multiple ? 'checkbox' : 'radio'} name={id} value={option.id} checked={selected.includes(option.id)} disabled={submitted} onChange={() => setSelected(s => data.multiple ? s.includes(option.id) ? s.filter(v => v !== option.id) : [...s, option.id] : [option.id])} />
        <span className="nui-option-letter">{option.id}</span><Markdown text={option.text} />
      </label>)}
    </fieldset>
    <div className="nui-quiz-actions"><button type={submitted ? 'button' : 'submit'} className="nui-action" disabled={!selected.length} onClick={submitted ? () => { setSelected([]); setSubmitted(false) } : undefined}>{submitted ? '再试一次' : '检查答案'}</button><span>{data.multiple ? '多选' : '单选'} · 即时反馈</span></div>
    {submitted && <div className={`nui-feedback ${correct ? 'correct' : 'incorrect'}`} role="status">
      <strong>{correct ? '回答正确' : `再想一想，正确答案是 ${data.answer}`}</strong>
      {data.explanation && <Markdown text={data.explanation} />}
    </div>}
  </form>
}

/** Generated IDs and Mermaid entity escapes keep table labels out of Mermaid's syntax. */
export function graphCode(data: GraphData): string {
  const label = (s: string) => [...s].map(c => /[\p{L}\p{N} ]/u.test(c) ? c : `#${c.codePointAt(0)};`).join('')
  return ['flowchart LR', ...data.nodes.map((s, i) => `n${i}["${label(s)}"]`), ...data.edges.map(([a, b]) => `n${a} --> n${b}`)].join('\n')
}
function Graph({ data }: RendererProps<'graph'>) {
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark')
  const override = useContext(NoteUIThemeContext)
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.dataset.theme === 'dark'))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  const svg = useMemo(() => renderBeautiful(graphCode(data), override ? override === 'dark' : dark), [data, dark, override])
  if (!svg) throw new Error('关系图布局失败')
  return <div className="nui-graph" role="img" aria-label={`知识关系图：${data.nodes.length} 个概念，${data.edges.length} 条关系`} tabIndex={0} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } }) }} />
}

export const componentRegistry: { [N in ComponentName]: { label: string; render: ComponentType<RendererProps<N>> } } = {
  svg: { label: noteUIRegistry.svg.label, render: Drawing },
  ...layoutRegistry,
  ...learningRegistry,
  ...interactiveRegistry,
  chart: { label: '数据图表', render: Chart }, stats: { label: '关键指标', render: Stats },
  compare: { label: '概念对比', render: Compare }, steps: { label: '过程与步骤', render: Steps },
  quiz: { label: '随堂练习', render: Quiz }, graph: { label: '知识关系', render: Graph },
}

class RenderBoundary extends Component<{ source: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <div className="nui-fallback"><small>可视化暂不可用，显示原始内容</small><Markdown text={this.props.source} /></div> : this.props.children }
}

export default function NoteUIBlock({ block }: { block: Block }) {
  const definition = componentRegistry[block.name]
  const spec = noteUIRegistry[block.name], title = block.params.title ?? spec.label
  // The registry is exhaustively typed; the discriminated data was validated by the parser.
  const Renderer = definition.render as ComponentType<{ data: DataByName[ComponentName]; params: Record<string, string> }>
  return <RenderBoundary source={block.source}>
    <section className={`noteui nui-${block.name}${spec.input ? ' nui-layout' : ''} nui-surface-${spec.surface}`} aria-label={title}>
      {(!spec.input || (block.params.title && block.name !== 'popover')) && <header className="nui-header"><h3 className="nui-title"><InlineMarkdown text={title} /></h3></header>}
      <Renderer data={block.data} params={block.params} />
      <details className="nui-source"><summary>查看原始 Markdown</summary><pre><code>{block.source}</code></pre></details>
    </section>
  </RenderBoundary>
}
