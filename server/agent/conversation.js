/** Public conversation view. Keep tool payloads, system prompts and reasoning on the server. */
export function projectConversation(messages) {
  const questions = new Set()
  return messages.flatMap(message => {
    if (message.role === 'assistant' && message.tool_calls?.length) {
      return message.tool_calls.flatMap(call => {
        if (call.function?.name !== 'ask_user') return []
        try {
          const args = JSON.parse(call.function.arguments)
          if (typeof args.question !== 'string') return []
          questions.add(call.id)
          return [{ role: 'assistant', content: args.question + (Array.isArray(args.options) ? '\n\n' + args.options.filter(option => typeof option === 'string').map(option => '- ' + option).join('\n') : '') }]
        } catch { return [] }
      })
    }
    if (message.role === 'tool' && questions.has(message.tool_call_id)) {
      questions.delete(message.tool_call_id)
      try {
        const answer = JSON.parse(message.content)
        const value = typeof answer === 'object' && answer ? answer.value : answer
        const content = typeof value === 'string' ? value : Array.isArray(value) ? value.filter(item => typeof item === 'string').join('、') : answer?.skipped ? '已跳过' : answer?.cancelled ? '已取消' : ''
        return content ? [{ role: 'user', content }] : []
      } catch { return [] }
    }
    if (!['user', 'assistant'].includes(message.role)) return []
    const raw = typeof message.content === 'string' ? message.content : Array.isArray(message.content)
      ? message.content.filter(part => part.type === 'text').map(part => part.text || '').join('\n') : ''
    const content = message.role === 'user' ? raw.replace(/^【模式：[^】]+】\s*/, '').trim() : raw.trim()
    const images = Array.isArray(message.images) ? message.images.filter(image => typeof image === 'string' && !/^(?:[a-z]+:|[/\\])|(?:^|[/\\])\.\.(?:[/\\]|$)/i.test(image) && /\.(png|jpe?g|webp|gif)$/i.test(image)) : []
    return content || images.length ? [{ role: message.role, content, ...(images.length ? { images } : {}) }] : []
  })
}
