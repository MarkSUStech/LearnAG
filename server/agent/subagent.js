// 子 Agent 执行器：运行一个专职子 Agent 直到完成（工具循环），返回最终文字。
// streamChat 由调用方（runner）注入，避免与 runner 的循环依赖。
import { toolsForRole, SUB_AGENTS } from './roles.js'

const MAX_ROUNDS = 8

/**
 * 运行子 Agent
 * @param opts { role, task, context, emit, signal, streamChat, executeTool, hooks }
 * @returns { result: string } 子 Agent 的最终文字产出
 */
export async function runSubAgent({ role, task, context = '', emit, signal, streamChat, executeTool, hooks = {} }) {
  const def = SUB_AGENTS[role]
  if (!def) throw new Error('未知子 Agent：' + role)
  const tools = toolsForRole(role)

  const messages = [
    { role: 'system', content: def.system },
    {
      role: 'user',
      content: `【任务】${task}${context ? `\n\n【上下文】${context}` : ''}`,
    },
  ]

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const assistant = { role: 'assistant', content: '' }
    const callAcc = new Map()

    for await (const { delta, finishReason } of streamChat({ messages, signal, tools })) {
      if (finishReason) break
      if (delta.content) assistant.content += delta.content
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const i = tc.index ?? 0
          if (!callAcc.has(i)) callAcc.set(i, { id: tc.id || '', name: '', args: '' })
          const acc = callAcc.get(i)
          if (tc.id) acc.id = tc.id
          if (tc.function?.name) acc.name += tc.function.name
          if (tc.function?.arguments) acc.args += tc.function.arguments
        }
      }
    }

    const toolCalls = [...callAcc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => ({ id: v.id, name: v.name, args: v.args }))

    if (toolCalls.length > 0) {
      assistant.content = ''
      assistant.tool_calls = toolCalls.map((t) => ({
        id: t.id,
        type: 'function',
        function: { name: t.name, arguments: t.args },
      }))
      messages.push(assistant)
      for (const tc of toolCalls) {
        let args = {}
        try {
          args = JSON.parse(tc.args || '{}')
        } catch {
          /* ignore */
        }
        let result
        try {
          result = await executeTool(tc.name, args, { onWrite: hooks.onWrite })
        } catch (e) {
          result = JSON.stringify({ error: String(e?.message || e) })
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
      }
      continue
    }

    if (!assistant.content.trim()) {
      return { result: `（${def.label}未返回内容）` }
    }
    return { result: assistant.content }
  }

  return { result: `（${def.label} 达到工具轮次上限，以上是阶段性产出）` }
}

export function subAgentLabel(role) {
  return SUB_AGENTS[role]?.label ?? role
}
