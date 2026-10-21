import { toolDefs, executeTool } from './tools.js'

// Keep file management and graph operations on the main path; specialists expose external tools.
const IMAGE_TOOLS = ['search_images', 'read_image', 'download_image', 'extract_pdf_images']
export const MANAGER_TOOLS = selectTools(['delegate', 'ask_user', 'read_graph', 'update_graph', 'read_note', 'list_notes', 'search_knowledge', 'write_note', 'rename_note', 'delete_note', 'search_images'])
export const TUTOR_TOOLS = selectTools(['read_note', 'write_note', 'search_knowledge', 'read_graph', 'search_images'])
export const TEACHER_TOOLS = selectTools(['search_knowledge', 'read_note', 'list_notes', 'read_graph', ...IMAGE_TOOLS, 'delegate'])

function selectTools(names) {
  return toolDefs.filter((t) => names.includes(t.function.name))
}

export function executeScopedTool(tools, name, args, hooks) {
  if (!tools.some((t) => t.function.name === name)) return JSON.stringify({ error: `当前角色不可调用工具：${name}` })
  return executeTool(name, args, hooks)
}

export function imageAwareTools(base, messages) {
  const latest = messages.findLast(m => m.role === 'user')
  const text = typeof latest?.content === 'string' ? latest.content : ''
  const active = /图片|插图|配图|截图|图像|照片|教材.*图|图\s*\d|这张|那张|figure|image|diagram|photo|illustrat/i.test(text) || latest?.images?.length || messages.slice(-8).some(m => m.tool_calls?.some(c => IMAGE_TOOLS.includes(c.function?.name)))
  return active ? selectTools([...base.map(t => t.function.name), ...IMAGE_TOOLS]) : base
}
