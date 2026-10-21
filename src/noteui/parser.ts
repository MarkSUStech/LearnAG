import { marked, type Token, type Tokens } from 'marked'
import { noteUIRegistry, parameterChoices } from '../../shared/noteuiRegistry'
import { parseDrawing, type DrawingData } from './svgModel'
import { protectMathPipes, restoreMathTree } from '../markdown/math'
import { parseSequence, parseDistribution, parseVenn, parseMatrix, parseNumberline, parseGeometry, parsePlot, parsePlayback, type SequenceData, type DistributionData, type VennData, type MatrixData, type IntervalData, type GeometryData, type PlotData, type PlaybackData } from './interactiveModels'

export type ComponentName = keyof DataByName
export interface Directive { name: ComponentName; params: Record<string, string> }
export interface TableData { headers: string[]; rows: string[][] }
export interface StepData { title: string; body: string }
export interface QuizData { question: string; options: { id: string; text: string }[]; answer: string; explanation: string; multiple: boolean }
export interface ChartData { type: 'line' | 'bar' | 'pie' | 'scatter'; x: string[]; series: { name: string; values: number[] }[]; numericX?: number[] }
export interface GraphData { nodes: string[]; edges: [number, number][] }
export interface TreeItem { title: string; body: string; children: TreeItem[] }
export interface CodeData { code: string; language: string; annotations: { line: number; text: string }[] }
export type LayoutName = 'row' | 'col' | 'box' | 'grid' | 'card' | 'divider' | 'spacer' | 'carousel' | 'popover'
export interface LayoutData { cells: string[] }
export interface ChecklistItem { text: string; checked: boolean }
export interface ClozeItem { before: string; answer: string; after: string }
export interface RubricItem { label: string; max: number; description: string }
export interface ProgressItem { label: string; value: number; total: number }
export interface ScheduleItem { date: string; task: string; detail: string }
export interface DataByName extends Record<LayoutName, LayoutData> {
  svg: DrawingData
  chart: ChartData; stats: TableData; compare: TableData; steps: StepData[]; quiz: QuizData; graph: GraphData
  concept: TableData; flashcards: TableData; accordion: TreeItem[]; tree: TreeItem[]; derivation: TableData
  code: CodeData; checklist: ChecklistItem[]; table: TableData; tabs: TableData; cloze: ClozeItem[]
  match: TableData; rubric: RubricItem[]; progress: ProgressItem[]; schedule: ScheduleItem[]
  sequence: SequenceData; distribution: DistributionData; venn: VennData; matrix: MatrixData
  numberline: IntervalData[]; geometry: GeometryData; plot: PlotData; playback: PlaybackData
}
export type NoteUIBlock = { [N in ComponentName]: { name: N; params: Record<string, string>; data: DataByName[N]; source: string; key: string } }[ComponentName]
interface Definition<N extends ComponentName> {
  params: Record<string, readonly string[] | null>
  parse: (tokens: Token[], params: Record<string, string>) => { data: DataByName[N]; count: number } | null
}

// Only this isolated, complete HTML-comment token is interpreted. No document-wide replacement.
export function parseDirective(raw: string): Directive | null {
  const match = /^<!--\s*ui:([a-z]+)((?:\s+[\s\S]*?)?)\s*-->$/.exec(raw.trim())
  if (!match || !Object.prototype.hasOwnProperty.call(definitions, match[1])) return null
  const name = match[1] as ComponentName
  const rest = match[2].trim()
  const params: Record<string, string> = Object.create(null)
  let pos = 0
  while (pos < rest.length) {
    const param = /^([a-z]+)=(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"'<>]+))(?:\s+|$)/.exec(rest.slice(pos))
    if (!param || Object.prototype.hasOwnProperty.call(params, param[1])) return null
    const value = param[2] ?? param[3] ?? param[4]
    const allowed = definitions[name].params
    if (!Object.prototype.hasOwnProperty.call(allowed, param[1]) || value.length > 160 || !value) return null
    const choices = allowed[param[1]]
    if (choices && !choices.includes(value)) return null
    params[param[1]] = value
    pos += param[0].length
  }
  return { name, params }
}

function plain(tokens: Token[]): string {
  return tokens.map(t => {
    if ('tokens' in t && Array.isArray(t.tokens)) return plain(t.tokens)
    if (t.type === 'html') return ''
    return 'text' in t ? String(t.text) : t.raw
  }).join('').trim()
}

// Presentation titles must retain Markdown delimiters, TeX escapes and code spans.
function inlineSource(token: Token | undefined, fallback: string): string {
  return (token && 'tokens' in token && Array.isArray(token.tokens)
    ? token.tokens.map(t => t.raw).join('') : fallback).trim()
}

function columns(line: string): number {
  const cells: string[] = []
  let cell = ''
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && i + 1 < line.length) { cell += line[i] + line[++i]; continue }
    if (line[i] === '|') { cells.push(cell); cell = '' } else cell += line[i]
  }
  cells.push(cell)
  if (!cells[0].trim()) cells.shift()
  if (cells.length && !cells[cells.length - 1].trim()) cells.pop()
  return cells.length
}

function table(tokens: Token[]): TableData | null {
  const t = tokens[0]
  if (t?.type !== 'table') return null
  const value = t as Tokens.Table
  const headers = value.header.map(c => plain(c.tokens))
  if (headers.length < 2 || headers.length > 16 || headers.some(h => !h || h.length > 160) || new Set(headers).size !== headers.length) return null
  if (!value.rows.length || value.rows.length > 500) return null
  if (value.raw.trim().split('\n').filter(l => l.trim()).some(l => columns(l) !== headers.length)) return null
  const rows = value.rows.map(row => row.map(c => c.text))
  if (rows.some(row => row.some(c => c.length > 4000))) return null
  return { headers, rows }
}

export function numeric(raw: string): number | null {
  const s = raw.trim()
  if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(?:%)?$/i.test(s)) return null
  const n = Number(s.replace(/,/g, '').replace(/%$/, ''))
  return Number.isFinite(n) && Math.abs(n) <= 1e15 ? n : null
}

const tabular = (tokens: Token[]) => { const data = table(tokens); return data && data.rows.every(r => r[0].trim()) ? { data, count: 1 } : null }
function interactive<T>(tokens: Token[], params: Record<string, string>, parse: (table: TableData, params: Record<string, string>) => T | null) {
  const t = table(tokens), data = t && parse(t, params)
  return data ? { data, count: 1 } : null
}

function completeTable(tokens: Token[]) {
  const result = tabular(tokens)
  return result && result.data.rows.every(r => r[1].trim()) ? result : null
}

function outline(tokens: Token[]): TreeItem[] | null {
  let count = 0
  function visit(token: Token, depth = 0): TreeItem[] | null {
    if (token.type !== 'list' || depth > 8) return null
    const items: TreeItem[] = []
    for (const item of (token as Tokens.List).items) {
      if (++count > 200) return null
      const first = item.tokens.find(t => t.type !== 'space')
      if (!first) return null
      const title = inlineSource(first, item.text.split('\n')[0])
      const children: TreeItem[] = [], body: string[] = []
      for (const next of item.tokens.slice(item.tokens.indexOf(first) + 1)) {
        if (next.type === 'list') { const nested = visit(next, depth + 1); if (!nested) return null; children.push(...nested) }
        else body.push(next.raw)
      }
      if (!title) return null
      items.push({ title, body: body.join('').trim(), children })
    }
    return items
  }
  return tokens[0] ? visit(tokens[0]) : null
}
// Parsing, parameter allowlists and normalization share one registry. Renderers use the same names.
export const definitions: { [N in ComponentName]: Definition<N> } = {
  svg: { params: parameterChoices('svg'), parse: (t, p) => interactive(t, p, parseDrawing) },
  ...Object.fromEntries((['row', 'col', 'box', 'grid', 'card', 'divider', 'spacer', 'carousel', 'popover'] as const).map(name => [name, { params: parameterChoices(name), parse: () => null }])) as unknown as { [N in LayoutName]: Definition<N> },
  sequence: { params: parameterChoices('sequence'), parse: (t, p) => interactive(t, p, parseSequence) },
  distribution: { params: parameterChoices('distribution'), parse: (t, p) => interactive(t, p, parseDistribution) },
  venn: { params: parameterChoices('venn'), parse: (t, p) => interactive(t, p, parseVenn) },
  matrix: { params: parameterChoices('matrix'), parse: (t, p) => interactive(t, p, parseMatrix) },
  numberline: { params: parameterChoices('numberline'), parse: (t, p) => interactive(t, p, parseNumberline) },
  geometry: { params: parameterChoices('geometry'), parse: (t, p) => interactive(t, p, parseGeometry) },
  plot: { params: parameterChoices('plot'), parse: (t, p) => interactive(t, p, parsePlot) },
  playback: { params: parameterChoices('playback'), parse: (t, p) => interactive(t, p, parsePlayback) },
  chart: {
    params: parameterChoices('chart'),
    parse(tokens, params) {
      const t = table(tokens)
      if (!t || !params.x || !params.y) return null
      const xi = t.headers.indexOf(params.x)
      const names = params.y.split(',')
      const indices = names.map(n => t.headers.indexOf(n))
      if (xi < 0 || !names.length || names.length > 6 || new Set(names).size !== names.length || indices.some(i => i < 0 || i === xi)) return null
      const x = t.rows.map(r => r[xi])
      if (x.some(v => !v.trim())) return null
      const series = indices.map((i, j) => ({ name: names[j], values: t.rows.map(r => numeric(r[i])) }))
      if (series.some(s => s.values.some(v => v === null))) return null
      const type = (params.type ?? 'bar') as ChartData['type']
      if (type === 'pie' && (series.length !== 1 || t.rows.length > 24 || series[0].values.some(v => v! < 0) || !series[0].values.some(v => v! > 0))) return null
      const numericX = type === 'scatter' ? x.map(numeric) : undefined
      if (numericX?.some(v => v === null)) return null
      return { data: { type, x, series: series as ChartData['series'], numericX: numericX as number[] | undefined }, count: 1 }
    },
  },
  stats: { params: parameterChoices('stats'), parse(tokens) { const result = tabular(tokens); return result?.data.rows.every(r => r[1].trim()) ? result : null } },
  compare: { params: parameterChoices('compare'), parse: tabular },
  steps: {
    params: parameterChoices('steps'),
    parse(tokens) {
      const t = tokens[0]
      if (t?.type !== 'list' || !t.ordered || t.items.length > 100 || !t.items.length) return null
      const data = (t as Tokens.List).items.map(item => {
        const first = item.tokens.find(t => t.type !== 'space')
        const title = inlineSource(first, item.text.split('\n')[0])
        const body = item.tokens.slice(item.tokens.indexOf(first!) + 1).map(t => t.raw).join('').trim()
        return { title, body }
      })
      return data.some(s => !s.title) ? null : { data, count: 1 }
    },
  },
  quiz: {
    params: parameterChoices('quiz'),
    parse(tokens, params) {
      const multiple = params.type === 'multi'
      if (tokens[0]?.type !== 'paragraph' || !(multiple ? /^[A-H](?:,[A-H])+$/ : /^[A-H]$/).test(params.answer ?? '')) return null
      const answers = params.answer.split(',')
      if (new Set(answers).size !== answers.length) return null
      let li = 1
      while (tokens[li]?.type === 'space') li++
      const list = tokens[li]
      if (list?.type !== 'list' || list.ordered || list.items.length < 2 || list.items.length > 8) return null
      const options = (list as Tokens.List).items.map(item => {
        const m = /^([A-H])[.)、：:]\s+([\s\S]+)/.exec(item.text.trim())
        return m ? { id: m[1], text: m[2] } : null
      })
      if (options.some(o => !o) || new Set(options.map(o => o?.id)).size !== options.length || answers.some(a => !options.some(o => o?.id === a))) return null
      let end = li + 1
      while (tokens[end]?.type === 'space') end++
      let explanation = ''
      if (tokens[end]?.type === 'blockquote') { explanation = (tokens[end] as Tokens.Blockquote).text; end++ } else end = li + 1
      return { data: { question: tokens[0].text, options: options as QuizData['options'], answer: params.answer, explanation, multiple }, count: end }
    },
  },
  graph: {
    params: parameterChoices('graph'),
    parse(tokens, params) {
      const t = table(tokens)
      if (!t || t.rows.length > 120) return null
      const fi = t.headers.indexOf(params.from ?? 'source'), ti = t.headers.indexOf(params.to ?? 'target')
      if (fi < 0 || ti < 0 || fi === ti) return null
      const nodes: string[] = [], edges: [number, number][] = []
      for (const row of t.rows) {
        const pair = [row[fi].trim(), row[ti].trim()]
        if (pair.some(s => !s || s.length > 100)) return null
        const ids = pair.map(s => { if (!nodes.includes(s)) nodes.push(s); return nodes.indexOf(s) })
        edges.push(ids as [number, number])
      }
      return nodes.length > 60 ? null : { data: { nodes, edges }, count: 1 }
    },
  },
  concept: { params: parameterChoices('concept'), parse: completeTable },
  flashcards: { params: parameterChoices('flashcards'), parse: completeTable },
  accordion: {
    params: parameterChoices('accordion'),
    parse(tokens) { const data = outline(tokens); return data ? { data, count: 1 } : null },
  },
  tree: { params: parameterChoices('tree'), parse(tokens) { const data = outline(tokens); return data ? { data, count: 1 } : null } },
  derivation: { params: parameterChoices('derivation'), parse: completeTable },
  code: {
    params: parameterChoices('code'),
    parse(tokens) {
      const code = tokens[0]
      if (code?.type !== 'code') return null
      const token = code as Tokens.Code, language = (token.lang ?? 'text').split(/\s/)[0].toLowerCase()
      const rawLines = token.raw.trimEnd().split('\n'), fence = /^ {0,3}(`{3,}|~{3,})/.exec(rawLines[0])
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(rawLines[rawLines.length - 1])
      if (!fence || !close || rawLines.length < 2 || fence[1][0] !== close[1][0] || close[1].length < fence[1].length) return null
      if (['mermaid', 'd2', 'gnuplot'].includes(language) || !token.text.trim() || token.text.length > 50000) return null
      const lines = token.text.split('\n').length
      if (lines > 500) return null
      let next = 1
      while (tokens[next]?.type === 'space') next++
      const annotations: CodeData['annotations'] = []
      const annotationTable = tokens[next]?.type === 'table' ? completeTable(tokens.slice(next)) : null
      if (tokens[next]?.type === 'table' && (!annotationTable || annotationTable.data.headers.length !== 2)) return null
      if (annotationTable) {
        for (const row of annotationTable.data.rows) {
          const line = numeric(row[0])
          if (line === null || !Number.isInteger(line) || line < 1 || line > lines || annotations.some(a => a.line === line)) return null
          annotations.push({ line, text: row[1] })
        }
      }
      annotations.sort((a, b) => a.line - b.line)
      return { data: { code: token.text, language, annotations }, count: annotationTable ? next + 1 : 1 }
    },
  },
  checklist: {
    params: parameterChoices('checklist'),
    parse(tokens) {
      if (tokens[0]?.type !== 'list') return null
      const list = tokens[0] as Tokens.List
      if (!list.items.length || list.items.length > 200 || list.items.some(i => !i.task || i.tokens.some(t => t.type === 'list'))) return null
      return { data: list.items.map(i => ({ text: i.text, checked: Boolean(i.checked) })), count: 1 }
    },
  },
  table: { params: parameterChoices('table'), parse: tabular },
  tabs: { params: parameterChoices('tabs'), parse: completeTable },
  cloze: {
    params: parameterChoices('cloze'),
    parse(tokens) {
      const t = tokens[0]
      if (t?.type !== 'list') return null
      const items = (t as Tokens.List).items
      if (!items.length || items.length > 100) return null
      const data: ClozeItem[] = []
      for (const item of items) {
        // Inline code is portable in ordinary Markdown and provides an unambiguous answer span.
        const first = item.tokens[0]
        if (!first || !('tokens' in first) || !Array.isArray(first.tokens) || item.tokens.filter(t => t.type !== 'space').length !== 1) return null
        const inline = first.tokens as Token[], answers = inline.filter(t => t.type === 'codespan')
        if (answers.length !== 1 || item.tokens.some(t => t.type === 'list')) return null
        const at = inline.indexOf(answers[0]), answer = (answers[0] as Tokens.Codespan).text
        if (!answer.trim() || answer.length > 160) return null
        data.push({ before: inline.slice(0, at).map(t => t.raw).join(''), answer, after: inline.slice(at + 1).map(t => t.raw).join('') })
      }
      return { data, count: 1 }
    },
  },
  match: {
    params: parameterChoices('match'),
    parse(tokens) {
      const result = completeTable(tokens)
      if (!result || result.data.rows.length < 2 || result.data.rows.length > 12 || result.data.headers.length !== 2) return null
      if ([0, 1].some(col => new Set(result.data.rows.map(r => r[col].trim())).size !== result.data.rows.length)) return null
      return result
    },
  },
  rubric: {
    params: parameterChoices('rubric'),
    parse(tokens) {
      const result = completeTable(tokens)
      if (!result || result.data.rows.length > 50) return null
      const data: RubricItem[] = []
      for (const row of result.data.rows) {
        const max = numeric(row[1])
        if (max === null || !Number.isInteger(max) || max < 1 || max > 100) return null
        data.push({ label: row[0], max, description: row.slice(2).join(' · ') })
      }
      return { data, count: 1 }
    },
  },
  progress: {
    params: parameterChoices('progress'),
    parse(tokens) {
      const result = completeTable(tokens)
      if (!result || result.data.headers.length < 3) return null
      const data: ProgressItem[] = []
      for (const row of result.data.rows) {
        const value = numeric(row[1]), total = numeric(row[2])
        if (value === null || total === null || value < 0 || total <= 0 || value > total) return null
        data.push({ label: row[0], value, total })
      }
      return { data, count: 1 }
    },
  },
  schedule: {
    params: parameterChoices('schedule'),
    parse(tokens) {
      const result = completeTable(tokens)
      if (!result) return null
      const data: ScheduleItem[] = []
      for (const row of result.data.rows) {
        const date = row[0].trim()
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
        const parsed = new Date(date + 'T00:00:00Z')
        if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null
        data.push({ date, task: row[1], detail: row.slice(2).join(' · ') })
      }
      return { data: data.sort((a, b) => a.date.localeCompare(b.date)), count: 1 }
    },
  },
}

export interface NoteUIPlan { markdown: string; blocks: NoteUIBlock[]; slots: string[] }

// Boundaries are standalone marked HTML-comment nodes, never replacements inside text/code.
function boundary(token: Token | undefined) {
  return token?.type === 'html' && token.block ? /^<!--\s*ui:([a-z]+)(?:\s[\s\S]*?)?\s*-->$/.exec(token.raw.trim())?.[1] : undefined
}
function container(tokens: Token[], index: number, positions: number[], source: string) {
  let depth = 1, invalid = false, nodes = 1, cellStart = positions[index] + tokens[index].raw.length
  const cells: string[] = [], counts = [1]
  for (let end = index + 1; end < tokens.length; end++) {
    const name = boundary(tokens[end])
    if (name === 'end') {
      if (--depth === 0) {
        cells.push(source.slice(cellStart, positions[end]).trim())
        return { end, cells, valid: !invalid && cells.length <= 12 && cells.every(Boolean) }
      }
    } else if (name === 'cell' && depth === 1) {
      cells.push(source.slice(cellStart, positions[end]).trim())
      cellStart = positions[end] + tokens[end].raw.length
    } else if (name && Object.prototype.hasOwnProperty.call(noteUIRegistry, name)) {
      if (++nodes > 100 || !parseDirective(tokens[end].raw)) invalid = true
      if (noteUIRegistry[name as ComponentName].input === 'container') {
        if (++depth > 4) invalid = true
        counts[depth - 1] = 1
      }
    }
    if (name === 'cell' && ++counts[depth - 1] > 12) invalid = true
  }
  // Unclosed streaming layouts keep all their source as ordinary Markdown.
  return { end: tokens.length - 1, cells: [], valid: false }
}
export function hasNoteUIMarker(text: string) {
  if (!/<!--\s*ui:/.test(text)) return false
  try { return marked.lexer(text).some(t => t.type === 'html' && t.block && /^<!--\s*ui:/.test(t.raw.trim())) } catch { return true }
}

/** Top-level block AST only; directives in fences, inline code, lists and quotations stay ordinary Markdown.
 * Original source slices are retained (including CRLF). This function never mutates the source or tokens.
 * During streaming the final block stays plain until a blank line or subsequent block closes it.
 */
export function planNoteUI(source: string, streaming = false): NoteUIPlan {
  if (!/<!--\s*ui:/.test(source)) return { markdown: source, blocks: [], slots: [] }
  const normalized = source.replace(/\r\n?/g, '\n')
  const offsets: number[] = []
  for (let i = 0; i < source.length; i++) { offsets.push(i); if (source[i] === '\r' && source[i + 1] === '\n') i++ }
  offsets.push(source.length)
  let tokens: Token[]
  const math = protectMathPipes(normalized)
  try { tokens = restoreMathTree(marked.lexer(math.markdown), math.restore, true) } catch { return { markdown: source, blocks: [], slots: [] } }
  if (!globalThis.crypto?.randomUUID) return { markdown: source, blocks: [], slots: [] }
  const positions: number[] = []
  let pos = 0
  for (const t of tokens) { positions.push(pos); pos += t.raw.length }
  const blocks: NoteUIBlock[] = [], slots: string[] = [], output: string[] = []
  const nonce = globalThis.crypto.randomUUID()
  let cursor = 0
  for (let i = 0; i < tokens.length && blocks.length < 100; i++) {
    const token = tokens[i]
    if (token.type !== 'html' || !token.block) continue
    const name = boundary(token)
    const spec = name && Object.prototype.hasOwnProperty.call(noteUIRegistry, name) ? noteUIRegistry[name as ComponentName] : undefined
    const directive = parseDirective(token.raw)
    if (spec?.input === 'container') {
      const group = container(tokens, i, positions, normalized)
      if (!directive || !group.valid || normalized.slice(positions[i], positions[group.end]).length > 100000) { i = group.end; continue }
      const end = positions[group.end] + tokens[group.end].raw.length, from = offsets[positions[i]], to = offsets[end], raw = source.slice(from, to)
      const occurrence = blocks.filter(b => b.source === raw).length
      blocks.push({ name: directive.name, params: directive.params, data: { cells: group.cells }, source: raw, key: raw + ':' + occurrence } as NoteUIBlock)
      const slot = `<div data-noteui-slot="${nonce}-${slots.length}"></div>`
      slots.push(slot); output.push(source.slice(cursor, from), '\n\n', slot, '\n\n'); cursor = to; i = group.end; continue
    }
    if (!directive) continue
    if (spec?.input === 'none') {
      const from = offsets[positions[i]], to = offsets[positions[i] + token.raw.length], raw = source.slice(from, to)
      const occurrence = blocks.filter(b => b.source === raw).length
      blocks.push({ name: directive.name, params: directive.params, data: { cells: [] }, source: raw, key: raw + ':' + occurrence } as NoteUIBlock)
      const slot = `<div data-noteui-slot="${nonce}-${slots.length}"></div>`
      slots.push(slot); output.push(source.slice(cursor, from), '\n\n', slot, '\n\n'); cursor = to; continue
    }
    let start = i + 1
    while (tokens[start]?.type === 'space') start++
    try {
      const result = definitions[directive.name].parse(tokens.slice(start), directive.params)
      if (!result) continue
      const last = start + result.count - 1
      const end = positions[last] + tokens[last].raw.length
      if (streaming && !normalized.slice(end).trim() && !/\n\s*\n\s*$/.test(normalized.slice(positions[last]))) continue
      const from = offsets[positions[i]], to = offsets[end]
      const raw = source.slice(from, to)
      // Full source is a collision-free React key; appending unrelated prose preserves component state.
      const occurrence = blocks.filter(b => b.source === raw).length
      blocks.push({ name: directive.name, params: directive.params, data: restoreMathTree(result.data, math.restore), source: raw, key: raw + ':' + occurrence } as NoteUIBlock)
      const slot = `<div data-noteui-slot="${nonce}-${slots.length}"></div>`
      slots.push(slot)
      output.push(source.slice(cursor, from), '\n\n', slot, '\n\n')
      cursor = to
      i = last
    } catch { /* Local validation failure leaves the entire Markdown block unchanged. */ }
  }
  output.push(source.slice(cursor))
  return { markdown: output.join(''), blocks, slots }
}
