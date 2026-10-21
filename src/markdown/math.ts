/** Protect math pipes before GFM splits table cells. The single-character mask
 * keeps source offsets exact; restore the original TeX after tokenization.
 * Code spans, fenced/indented code and escaped delimiters remain literal.
 */
export function protectMathPipes(source: string) {
  let marker = ''
  for (let code = 0xe000; code <= 0xf8ff; code++) {
    const candidate = String.fromCharCode(code)
    if (!source.includes(candidate)) { marker = candidate; break }
  }
  if (!marker || !source.includes('|')) return { markdown: source, restore: (s: string) => s }
  const parts: string[] = []
  let pos = 0
  const escaped = (at: number) => {
    let slashes = 0
    while (at > 0 && source[--at] === '\\') slashes++
    return slashes % 2 === 1
  }
  while (pos < source.length) {
    // Match a fence only at a Markdown line start, including list/quote prefixes.
    const lineStart = pos === 0 || source[pos - 1] === '\n'
    if (lineStart) {
      const lineEnd = source.indexOf('\n', pos)
      const end = lineEnd < 0 ? source.length : lineEnd + 1
      const line = source.slice(pos, end)
      const fence = /^(?:[ \t]*>[ \t]?)*[ \t]*(?:[-+*]|\d+[.)])?[ \t]*(`{3,}|~{3,})/.exec(line)
      if (fence) {
        let finish = end
        while (finish < source.length) {
          const next = source.indexOf('\n', finish)
          const to = next < 0 ? source.length : next + 1
          const closing = /^(?:[ \t]*>[ \t]?)*[ \t]*(`{3,}|~{3,})[ \t]*\r?\n?$/.exec(source.slice(finish, to))
          finish = to
          if (closing && closing[1][0] === fence[1][0] && closing[1].length >= fence[1].length) break
        }
        parts.push(source.slice(pos, finish)); pos = finish; continue
      }
      if (/^(?: {4}|\t)/.test(line)) { parts.push(line); pos = end; continue }
    }
    if (source[pos] === '`' && !escaped(pos)) {
      const run = /^`+/.exec(source.slice(pos))![0]
      let close = source.indexOf(run, pos + run.length)
      while (close >= 0 && (source[close - 1] === '`' || source[close + run.length] === '`')) close = source.indexOf(run, close + run.length)
      if (close >= 0) { const end = close + run.length; parts.push(source.slice(pos, end)); pos = end; continue }
    }
    const link = /^(?:\[\[|\\\[\\\[)([^\[\]\r\n]{1,200}?)(?:\]\]|\\\]\\\])/.exec(source.slice(pos))
    if (link) { parts.push(link[0].replaceAll('|', marker)); pos += link[0].length; continue }
    let open = '', close = ''
    if (!escaped(pos)) {
      if (source.startsWith('$$', pos)) open = close = '$$'
      else if (source[pos] === '$') open = close = '$'
      else if (source.startsWith('\\(', pos)) { open = '\\('; close = '\\)' }
      else if (source.startsWith('\\[', pos)) { open = '\\['; close = '\\]' }
    }
    if (open) {
      let end = source.indexOf(close, pos + open.length)
      while (end >= 0 && escaped(end)) end = source.indexOf(close, end + close.length)
      const body = end >= 0 ? source.slice(pos + open.length, end) : ''
      if (body.trim() && (!(open === '$' || open === '\\(') || !/\n\s*\n/.test(body))) {
        end += close.length
        parts.push(source.slice(pos, end).replaceAll('|', marker)); pos = end; continue
      }
    }
    parts.push(source[pos++])
  }
  return { markdown: parts.join(''), restore: (text: string) => text.replaceAll(marker, '|') }
}

/** Clone lexer output, leaving table raw text masked until strict column validation. */
export function restoreMathTree<T>(value: T, restore: (s: string) => string, keepRaw = false): T {
  if (typeof value === 'string') return restore(value) as T
  if (Array.isArray(value)) return value.map(v => restoreMathTree(v, restore, keepRaw)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, keepRaw && key === 'raw' ? v : restoreMathTree(v, restore, keepRaw)])) as T
  return value
}
