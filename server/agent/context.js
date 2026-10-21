// Request-only observation masking. Stored messages and source Markdown stay intact.
export function prepareRequestMessages(messages, { historyEnd = messages.findLastIndex((m) => m.role === 'user'), resultLimit = 1600 } = {}) {
  // IDs are unique within a call group, but providers may reuse them across turns.
  const results = new Map()
  const calls = new Map()
  for (let i = 0; i < messages.length; i++) {
    if (!messages[i].tool_calls?.length) continue
    const group = new Map(messages[i].tool_calls.map((c) => [c.id, c]))
    for (let j = i + 1; j < messages.length && messages[j].role === 'tool'; j++) {
      const call = group.get(messages[j].tool_call_id)
      if (call) { results.set(call, messages[j]); calls.set(j, call) }
    }
  }
  return messages.map((m, i) => {
    if (i >= historyEnd) return m // Current user input, reasoning and tool observations remain exact.
    if (m.role === 'assistant' && m.tool_calls?.length) {
      return { ...m, tool_calls: m.tool_calls.map((call) => {
        if (call.function?.name !== 'write_note') return call
        const args = parse(call.function.arguments)
        const result = parse(results.get(call)?.content)
        if (!args?.path || typeof args.content !== 'string' || args.content.length <= resultLimit || result?.ok !== true) return call
        return { ...call, function: { ...call.function, arguments: JSON.stringify({ ...args, content: `[历史写入正文已省略，${args.content.length}字符；文件：${args.path}。修改前用 read_note 读取当前完整原文。]` }) } }
      }) }
    }
    if (m.role !== 'tool' || typeof m.content !== 'string' || m.content.length <= resultLimit) return m
    const call = calls.get(i)
    const args = parse(call?.function?.arguments)
    const value = parse(m.content)
    // Preserve failures in full: a failed operation must never turn into a success summary.
    if (value?.error || value?.ok === false) return m
    const sources = Array.isArray(value?.results) ? value.results.filter((r) => r && typeof r === 'object').map(({ path, page, pageEnd, url }) => ({ path, page, pageEnd, url })) : undefined
    return { ...m, content: JSON.stringify({
      excerpt: (typeof value?.content === 'string' ? value.content : m.content).slice(0, resultLimit),
      omitted: true,
      source: args?.path || args?.url || value?.path,
      sources,
      hint: '历史工具结果节选，完整内容可按来源重新读取/检索；不是完整文件，不能据此覆盖原文。',
    }) }
  })
}

function parse(text) {
  try { return JSON.parse(text) } catch { return null }
}

/** A merged summary replaces the previous one; an empty model reply must not discard history. */
export function applyCompaction(messages, summary, keep, text) {
  return typeof text === 'string' && text.trim()
    ? { messages: keep, summary: text.trim().slice(0, 4000) }
    : { messages, summary }
}
