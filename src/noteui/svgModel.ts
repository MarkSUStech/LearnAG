export type ShapeKind = 'rect' | 'circle' | 'ellipse' | 'line' | 'arrow' | 'text' | 'polygon' | 'path'
export interface DrawingShape { kind: ShapeKind; position: number[]; size: number[]; path?: string; text: string; color: string }
export interface DrawingData { width: number; height: number; shapes: DrawingShape[] }
const kinds: ShapeKind[] = ['rect', 'circle', 'ellipse', 'line', 'arrow', 'text', 'polygon', 'path']
export const drawingColors = ['ink', 'muted', 'accent', 'success', 'warning', 'danger', 'blue', 'red', 'series1', 'series2', 'series3', 'series4', 'series5', 'series6']
const numbers = (raw: string) => {
  if (!/^[\s,;+.\deE-]*$/.test(raw) || raw.length > 1000) return null
  const values = raw.trim() ? raw.trim().split(/[\s,;]+/).map(Number) : []
  return values.every(n => Number.isFinite(n) && Math.abs(n) <= 5000) ? values : null
}
/** Only explicit M/L/Q/C/Z commands with exact finite coordinate arity; no SVG markup. */
export function validDrawingPath(raw: string): boolean {
  if (raw.length > 1500 || !/^M\s/.test(raw) || /[^MLQCZ\s,\d.eE+-]/.test(raw)) return false
  const commands = raw.match(/[MLQCZ][^MLQCZ]*/g)
  if (!commands || commands.length > 32) return false
  return commands.every(command => {
    const arity = ({ M: 2, L: 2, Q: 4, C: 6, Z: 0 } as Record<string, number>)[command[0]]
    const values = numbers(command.slice(1))
    return values !== null && values.length === arity
  })
}
export function parseDrawing(table: { headers: string[]; rows: string[][] }, params: Record<string, string>): DrawingData | null {
  const width = Number(params.width ?? 640), height = Number(params.height ?? 360)
  if (![width, height].every(Number.isInteger) || width < 160 || width > 1200 || height < 120 || height > 900 || table.headers.length !== 5 || !table.rows.length || table.rows.length > 80) return null
  const shapes: DrawingShape[] = []
  for (const [kind, rawPosition, rawSize, text, colorRaw] of table.rows) {
    const color = colorRaw.trim() || 'ink'
    if (!kinds.includes(kind as ShapeKind) || !drawingColors.includes(color) || text.length > 160) return null
    if (kind === 'path') {
      if (!validDrawingPath(rawPosition) || rawSize.trim()) return null
      shapes.push({ kind, position: [], size: [], path: rawPosition, text, color }); continue
    }
    const position = numbers(rawPosition), size = numbers(rawSize)
    if (!position || !size || (kind !== 'polygon' && position.length !== 2)) return null
    if (kind === 'polygon') {
      if (position.length < 6 || position.length > 40 || position.length % 2 || size.length) return null
    } else if (kind === 'line' || kind === 'arrow') {
      if (size.length !== 2) return null
    } else if (kind === 'text') {
      if (size.length > 1 || (size.length === 1 && (size[0] < 10 || size[0] > 28)) || !text.trim()) return null
    } else {
      if (size.length !== (kind === 'circle' ? 1 : 2) || size.some(n => n < 1 || n > 2400)) return null
    }
    shapes.push({ kind: kind as ShapeKind, position, size, text, color })
  }
  return { width, height, shapes }
}

// SVG text has no HTML/KaTeX execution. Wrap labels inside their actual geometry.
export function drawingLabelLines(text: string, width: number, font = 14): string[] {
  const lines: string[] = []; let line = '', units = 0
  const limit = Math.max(2, (width - 12) / font)
  for (const char of text) {
    const unit = /[\u0000-\u00ff]/.test(char) ? .6 : 1
    if (char === '\n' || (line && units + unit > limit)) { lines.push(line); line = ''; units = 0; if (char === '\n') continue }
    line += char; units += unit
  }
  if (line) lines.push(line)
  return lines
}
