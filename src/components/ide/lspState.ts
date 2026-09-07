// LSP 激活状态（独立小模块，避免 pythonCompletions ↔ lspBridge 循环依赖）
const active = new Set<string>()

export function setLspActive(lang: string, on: boolean) {
  if (on) active.add(lang)
  else active.delete(lang)
}

/** 该语言的 LSP 是否已就绪（就绪时静态补全提供器让位给 LSP） */
export function isLspActive(lang: string): boolean {
  return active.has(lang)
}
