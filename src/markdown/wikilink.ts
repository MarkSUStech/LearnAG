/** ASCII | is Obsidian's alias separator; full-width ｜ remains part of a filename. */
export function parseWikilink(value: string) {
  const pipe = value.indexOf('|')
  const target = (pipe < 0 ? value : value.slice(0, pipe)).trim()
  const label = (pipe < 0 ? target : value.slice(pipe + 1).trim()) || target
  return { target, label }
}
