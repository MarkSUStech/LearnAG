/** Bounded, deterministic learning models. Markdown is data; nothing here evaluates source code. */
import type { TableData } from './parser'

export interface SequenceData { items: { value: string; detail: string; id: number }[]; mode: 'static' | 'cancel' | 'sort'; pair: string[] }
export interface Parameter { name: string; value: number; min: number; max: number; step: number }
export interface DistributionData { type: 'poisson' | 'binomial' | 'normal'; parameters: Parameter[] }
export interface VennData { sets: string[]; regions: { mask: number; label: string; count?: number }[] }
export interface MatrixData { columns: string[]; rows: { label: string; values: string[] }[]; numeric: boolean }
export interface IntervalData { label: string; from: number; to: number; bounds: string }
export interface GeometryData { mode: 'points' | 'polygon' | 'vectors'; points: { label: string; x: number; y: number }[] }
export interface PlotData { fn: 'linear' | 'quadratic' | 'sine' | 'exponential'; parameters: Parameter[] }
export interface PlaybackData { frames: { label: string; values: string[]; detail: string; active: number[] }[] }
type Params = Record<string, string>
const num = (s: string) => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s.trim()) && Number.isFinite(+s) && Math.abs(+s) <= 1e6 ? +s : null
const validText = (s: string, max = 80) => s.trim().length > 0 && s.length <= max

export function parseSequence(t: TableData, p: Params): SequenceData | null {
  if (t.headers.length !== 2 || t.rows.length > 60 || t.rows.some(r => !validText(r[0], 24))) return null
  const mode = (p.mode ?? 'static') as SequenceData['mode'], pair = (p.pair ?? 'R,B').split(',')
  if (pair.length !== 2 || pair.some(s => !validText(s, 24)) || pair[0] === pair[1] || (mode !== 'cancel' && p.pair)) return null
  if (mode === 'sort' && t.rows.some(r => num(r[0]) === null)) return null
  return { mode, pair, items: t.rows.map((r, id) => ({ id, value: r[0].trim(), detail: r[1] })) }
}
export interface SequenceFrame { items: SequenceData['items']; active: number[]; removed: number; message: string }
export function sequenceFrames(data: SequenceData): SequenceFrame[] {
  let items = [...data.items], removed = 0
  const frames: SequenceFrame[] = [{ items, active: [], removed, message: '初始序列' }]
  if (data.mode === 'cancel') {
    for (let iteration = 0; iteration < data.items.length; iteration++) {
      const at = items.findIndex((v, i) => v.value === data.pair[0] && items[i + 1]?.value === data.pair[1])
      if (at < 0) break
      frames.push({ items, active: [items[at].id, items[at + 1].id], removed, message: `相邻 ${data.pair.join(' → ')} 可以相消` })
      items = items.filter((_, i) => i !== at && i !== at + 1); removed++
      frames.push({ items, active: [], removed, message: `已消去 ${removed} 对；检查新的相邻元素` })
    }
  } else if (data.mode === 'sort') {
    // Adjacent insertion swaps: stable, bounded by 60 * 59 / 2, generated only on explicit mode=sort.
    for (let i = 1; i < items.length; i++) for (let j = i; j > 0 && +items[j - 1].value > +items[j].value; j--) {
      const active = [items[j - 1].id, items[j].id]
      const before = `${items[j - 1].value} > ${items[j].value}`
      items = [...items]; [items[j - 1], items[j]] = [items[j], items[j - 1]]
      frames.push({ items, active, removed, message: `${before}，交换相邻元素` })
    }
  }
  if (data.mode !== 'static') frames.push({ items, active: [], removed, message: data.mode === 'cancel' ? '结束：没有可相消的相邻对' : '结束：序列已按数值升序排列' })
  return frames
}

const distributionSpecs = {
  poisson: { lambda: [0, 30, 7.5, 0.1] },
  binomial: { n: [1, 100, 20, 1], p: [0, 1, .5, .01] },
  normal: { mu: [-20, 20, 0, .1], sigma: [.1, 10, 1, .1] },
} satisfies Record<string, Record<string, number[]>>
const plotSpecs = {
  linear: { a: [-10, 10, 1, .1], b: [-10, 10, 0, .1] },
  quadratic: { a: [-10, 10, 1, .1], b: [-10, 10, 0, .1], c: [-10, 10, 0, .1] },
  sine: { a: [-10, 10, 1, .1], b: [.1, 5, 1, .1], c: [-10, 10, 0, .1] },
  exponential: { a: [-10, 10, 1, .1], b: [-2, 2, 1, .1] },
} satisfies Record<string, Record<string, number[]>>
function parameters(t: TableData, spec: Record<string, number[]>): Parameter[] | null {
  if (![2, 5].includes(t.headers.length) || t.rows.length > Object.keys(spec).length) return null
  const found = new Map<string, Parameter>()
  for (const r of t.rows) {
    const name = r[0].trim(), rule = spec[name]
    if (!Object.prototype.hasOwnProperty.call(spec, name) || !rule || found.has(name)) return null
    const values = [r[1], ...(r.length === 5 ? r.slice(2) : [String(rule[0]), String(rule[1]), String(rule[3])])].map(num)
    if (values.some(v => v === null)) return null
    const [value, min, max, step] = values as number[]
    if (min < rule[0] || max > rule[1] || min >= max || value < min || value > max || step <= 0 || step > max - min || (max - min) / step > 10000) return null
    if (name === 'n' && [value, min, max, step].some(n => !Number.isInteger(n))) return null
    // A native range input must be able to represent the requested initial value exactly.
    const aligned = (value - min) / step
    if (Math.abs(aligned - Math.round(aligned)) > 1e-7) return null
    found.set(name, { name, value, min, max, step })
  }
  return Object.entries(spec).map(([name, [min, max, value, step]]) => found.get(name) ?? { name, min, max, value, step })
}
export function parseDistribution(t: TableData, p: Params): DistributionData | null {
  const type = (p.type ?? 'poisson') as DistributionData['type']
  const values = parameters(t, distributionSpecs[type]); return values ? { type, parameters: values } : null
}
export function parsePlot(t: TableData, p: Params): PlotData | null {
  const fn = (p.fn ?? 'quadratic') as PlotData['fn']
  const values = parameters(t, plotSpecs[fn]); return values ? { fn, parameters: values } : null
}
export interface DistributionCurve { points: { x: number; y: number }[]; mean: number; variance: number; continuous: boolean }
export function distributionCurve(type: DistributionData['type'], p: Record<string, number>): DistributionCurve {
  const points: DistributionCurve['points'] = []
  if (type === 'normal') {
    for (let i = 0; i <= 120; i++) { const z = -4 + i / 15; points.push({ x: p.mu + z * p.sigma, y: Math.exp(-z * z / 2) / (p.sigma * Math.sqrt(2 * Math.PI)) }) }
    return { points, mean: p.mu, variance: p.sigma ** 2, continuous: true }
  }
  const limit = type === 'poisson' ? Math.max(12, Math.ceil(p.lambda + 6 * Math.sqrt(p.lambda))) : p.n
  // Log probabilities avoid the p=1 division and underflow of direct factorials.
  const logFactorial = [0]; for (let i = 1; i <= limit; i++) logFactorial[i] = logFactorial[i - 1] + Math.log(i)
  for (let k = 0; k <= limit; k++) {
    let y: number
    if (type === 'poisson') y = p.lambda === 0 ? (k === 0 ? 1 : 0) : Math.exp(-p.lambda + k * Math.log(p.lambda) - logFactorial[k])
    else y = p.p === 0 ? (k === 0 ? 1 : 0) : p.p === 1 ? (k === p.n ? 1 : 0) : Math.exp(logFactorial[p.n] - logFactorial[k] - logFactorial[p.n - k] + k * Math.log(p.p) + (p.n - k) * Math.log1p(-p.p))
    points.push({ x: k, y })
  }
  return { points, mean: type === 'poisson' ? p.lambda : p.n * p.p, variance: type === 'poisson' ? p.lambda : p.n * p.p * (1 - p.p), continuous: false }
}
export function plotValue(fn: PlotData['fn'], x: number, p: Record<string, number>) {
  switch (fn) { case 'linear': return p.a * x + p.b; case 'quadratic': return p.a * x * x + p.b * x + p.c; case 'sine': return p.a * Math.sin(p.b * x + p.c); case 'exponential': return p.a * Math.exp(p.b * x) }
}

export function parseVenn(t: TableData, p: Params): VennData | null {
  const sets = (p.sets ?? 'A,B,C').split(',').map(s => s.trim())
  if (sets.length < 2 || sets.length > 3 || new Set(sets).size !== sets.length || sets.some(s => !/^[\p{L}\p{N}_]{1,12}$/u.test(s)) || ![2, 3].includes(t.headers.length) || t.rows.length > (1 << sets.length) - 1) return null
  const regions: VennData['regions'] = []
  for (const r of t.rows) {
    const members = r[0].split('&').map(s => s.trim())
    if (!members.length || new Set(members).size !== members.length || members.some(s => !sets.includes(s)) || !validText(r[1], 160)) return null
    const mask = members.reduce((v, s) => v | (1 << sets.indexOf(s)), 0)
    const count = r.length === 3 ? num(r[2]) : undefined
    if (regions.some(r => r.mask === mask) || count === null || (count !== undefined && count < 0)) return null
    regions.push({ mask, label: r[1], ...(count !== undefined ? { count } : {}) })
  }
  return { sets, regions }
}
export function vennSelection(mask: number, mode: string, all: number) { return mode === 'intersection' ? mask === all : mode === 'exclusive' ? (mask & (mask - 1)) === 0 : true }
export function parseMatrix(t: TableData): MatrixData | null {
  if (t.rows.length > 20 || t.headers.length > 16 || t.rows.some(r => !validText(r[0]) || r.slice(1).some(v => !validText(v, 160)))) return null
  return { columns: t.headers.slice(1), rows: t.rows.map(r => ({ label: r[0], values: r.slice(1) })), numeric: t.rows.every(r => r.slice(1).every(v => num(v) !== null)) }
}
export function parseNumberline(t: TableData): IntervalData[] | null {
  if (![3, 4].includes(t.headers.length) || t.rows.length > 20) return null
  const values: IntervalData[] = []
  for (const r of t.rows) {
    const from = num(r[1]), to = num(r[2]), bounds = r[3]?.trim() ?? '[]'
    if (!validText(r[0]) || from === null || to === null || from > to || !['[]', '[)', '(]', '()'].includes(bounds) || (from === to && bounds !== '[]')) return null
    values.push({ label: r[0], from, to, bounds })
  }
  return values
}
export function parseGeometry(t: TableData, p: Params): GeometryData | null {
  if (t.headers.length !== 3 || t.rows.length > 40) return null
  const points: GeometryData['points'] = []
  for (const r of t.rows) {
    const x = num(r[1]), y = num(r[2])
    if (!validText(r[0], 24) || x === null || y === null || points.some(v => v.label === r[0])) return null
    points.push({ label: r[0], x, y })
  }
  const mode = (p.mode ?? 'polygon') as GeometryData['mode']
  if (mode === 'polygon' && points.length < 3) return null
  return { mode, points }
}
export function parsePlayback(t: TableData): PlaybackData | null {
  if (![3, 4].includes(t.headers.length) || t.rows.length > 100) return null
  const frames: PlaybackData['frames'] = []
  for (const r of t.rows) {
    const values = r[1].split(',').map(v => v.trim()), active = r[3]?.trim() ? r[3].split(',').map(num) : []
    if (!validText(r[0]) || values.length > 40 || values.some(v => !validText(v, 24)) || active.some(v => v === null || !Number.isInteger(v) || v < 0 || v >= values.length)) return null
    frames.push({ label: r[0], values, detail: r[2], active: active as number[] })
  }
  return { frames }
}
