// LSP ↔ Monaco 桥：文档生命周期 + 补全/悬停/签名帮助/定义跳转/诊断标记
// 刻意不依赖 monaco-languageclient（避免 monaco 0.56 版本绑定），monaco 模块本身懒加载。
// 支持的语言来自服务端插件清单（/api/lsp/plugins），可经 .learn-agent/lsp-plugins.json 插拔。
import { api, type LspPluginInfo } from '../../api'
import { LspClient } from './lspClient'
import { setLspActive } from './lspState'

// 支持的语言由 initLspPlugins() 从服务端插件清单填充（仅收录本机可用的插件）
const LSP_LANGS = new Set<string>()

let vaultRoot = ''
let monaco: typeof import('./monacoSetup')['default'] | null = null
const clients = new Map<string, LspClient>()
const pendingClients = new Map<string, Promise<LspClient | null>>()
const failed = new Set<string>() // 曾启动失败的语言（如未安装 clangd），本次会话不再重试
const registered = new Set<string>()
const openedVersions = new Map<string, number>() // "lang:path" → LSP 文档版本

export function setLspVaultRoot(root: string) {
  vaultRoot = root.replace(/\\/g, '/').replace(/\/$/, '')
}

/** Windows 盘符大小写归一（pyright 可能回传小写盘符的 uri） */
function normDrive(p: string): string {
  return p.slice(0, 3).toLowerCase() + p.slice(3)
}

async function getMonaco() {
  if (!monaco) monaco = (await import('./monacoSetup')).default
  return monaco
}

// ── 插件清单（供状态栏面板展示） ───────────────────────────────────────────
let pluginsPromise: Promise<LspPluginInfo[]> | null = null

/** 从服务端拉取插件清单并登记可用语言；幂等，失败静默（回落到无 LSP 模式） */
export function initLspPlugins(): Promise<LspPluginInfo[]> {
  if (!pluginsPromise) {
    pluginsPromise = api
      .lspPlugins()
      .then((r) => {
        for (const p of r.plugins) {
          if (p.available) for (const l of p.languages) LSP_LANGS.add(l)
        }
        return r.plugins
      })
      .catch(() => [] as LspPluginInfo[])
  }
  return pluginsPromise
}

/** 各语言 LSP 实时运行状态（状态栏面板轮询用） */
export function lspRunningMap(): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const [lang, c] of clients) out[lang] = c.ready
  return out
}

// ── 路径 ↔ URI（LSP file:// URI 与 CodeEditor 的 inmemory model uri 互转） ──
function toFileUri(rel: string): string {
  const abs = `${vaultRoot}/${rel}`
  return 'file:///' + abs.split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z]%3A)/, (m) => m.toLowerCase())
}

function relFromFileUri(uri: string): string | null {
  if (!vaultRoot || !uri.startsWith('file:///')) return null
  let p: string
  try {
    p = decodeURIComponent(uri.replace(/^file:\/\/\//, ''))
  } catch {
    return null
  }
  return normDrive(p).startsWith(normDrive(vaultRoot) + '/') ? p.slice(vaultRoot.length + 1) : null
}

function monacoUriOf(rel: string) {
  return monaco!.Uri.parse('inmemory://ide/' + rel.split('/').map(encodeURIComponent).join('/'))
}

const lspPosition = (p: { lineNumber: number; column: number }) => ({ line: p.lineNumber - 1, character: p.column - 1 })
const mapRange = (r: any) => ({
  startLineNumber: r.start.line + 1,
  startColumn: r.start.character + 1,
  endLineNumber: r.end.line + 1,
  endColumn: r.end.character + 1,
})

async function ensureClient(lang: string): Promise<LspClient | null> {
  if (!LSP_LANGS.has(lang) || !vaultRoot || failed.has(lang)) return null
  const existing = clients.get(lang)
  if (existing) return existing.ready ? existing : null
  let p = pendingClients.get(lang)
  if (!p) {
    const client = new LspClient(lang)
    clients.set(lang, client)
    client.onDiagnostics = (params) => void applyDiagnostics(params)
    client.onDown = (reason) => {
      setLspActive(lang, false)
      if (reason) console.warn(`[lsp:${lang}]`, reason)
    }
    p = client
      .connect()
      .then(() => {
        setLspActive(lang, true)
        return client
      })
      .catch((e) => {
        failed.add(lang)
        clients.delete(lang)
        pendingClients.delete(lang)
        console.warn(`[lsp:${lang}] 不可用：`, (e as Error).message)
        return null
      })
    pendingClients.set(lang, p)
  }
  return p
}

// ── 文档生命周期（由 CodeEditor 驱动） ──────────────────────────────────────
export function attachLspModel(path: string, text: string, langId: string) {
  if (!vaultRoot) return
  const key = `${langId}:${path}`
  if (openedVersions.has(key)) return
  void (async () => {
    await initLspPlugins() // 支持语言清单来自服务端插件表（幂等）
    if (!LSP_LANGS.has(langId)) return
    if (openedVersions.has(key)) return
    openedVersions.set(key, 1)
    const c = await ensureClient(langId)
    if (!c) {
      openedVersions.delete(key)
      return
    }
    c.notify('textDocument/didOpen', {
      textDocument: { uri: toFileUri(path), languageId: langId, version: 1, text },
    })
  })()
}

export function changeLspModel(path: string, text: string, langId: string) {
  const key = `${langId}:${path}`
  const version = openedVersions.get(key)
  if (!version) return
  openedVersions.set(key, version + 1)
  const c = clients.get(langId)
  c?.notify('textDocument/didChange', {
    textDocument: { uri: toFileUri(path), version: version + 1 },
    contentChanges: [{ text }],
  })
}

export function closeAllLsp() {
  for (const [, c] of clients) c.close()
  clients.clear()
  for (const lang of [...registered]) setLspActive(lang, false)
}

// ── LSP → Monaco 各提供器注册（每个语言一次） ───────────────────────────────
export async function registerLspProviders(lang: string) {
  if (registered.has(lang)) return
  await initLspPlugins() // 等插件清单就绪，确定该语言是否启用 LSP
  if (!LSP_LANGS.has(lang) || registered.has(lang)) return
  registered.add(lang)
  const m = await getMonaco()

  const relOf = (model: any) => {
    const raw = decodeURIComponent(model.uri.path.replace(/^\//, ''))
    return raw
  }

  m.languages.registerCompletionItemProvider(lang, {
    triggerCharacters: ['.', '/', '"', "'"],
    provideCompletionItems: async (model, position) => {
      const rel = relOf(model)
      const c = await ensureClient(lang)
      if (!c) return { suggestions: [] }
      let res: any
      try {
        res = await c.request('textDocument/completion', {
          textDocument: { uri: toFileUri(rel) },
          position: lspPosition(position),
        })
      } catch {
        return { suggestions: [] }
      }
      const items: any[] = Array.isArray(res) ? res : res?.items ?? []
      const word = model.getWordUntilPosition(position)
      const fallbackRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn ?? position.column,
        endColumn: word.endColumn ?? position.column,
      }
      const suggestions: any[] = []
      for (const it of items) {
        try {
          const label = pickLabel(it)
          if (!label) continue // 绝不渲染空标签条目
          const labelStr = String(label)
          suggestions.push({
            label: labelStr,
            kind: it.kind ? KIND_MAP[it.kind] ?? 'Text' : 'Text',
            detail: it.detail ? String(it.detail).slice(0, 160) : undefined,
            documentation: mapDocs(it.documentation),
            insertText: pickInsertText(it) ?? labelStr,
            insertTextRules: it.insertTextFormat === 2 ? m.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
            sortText: typeof it.sortText === 'string' ? it.sortText : undefined,
            filterText: typeof it.filterText === 'string' ? it.filterText : undefined,
            range: it.textEdit ? mapTextEditRange(it.textEdit) ?? fallbackRange : fallbackRange,
            additionalTextEdits: it.additionalTextEdits?.map((te: any) => ({ range: mapTextEditRange(te) ?? fallbackRange, text: String(te.newText ?? '') })),
          })
        } catch (e) {
          console.warn('[lsp] 补全项映射失败（已跳过）:', (e as Error).message)
        }
      }
      // LSP isIncomplete：告诉 monaco 继续输入时重新请求
      return { suggestions, incomplete: !Array.isArray(res) && Boolean(res?.isIncomplete) }
    },
  })

  m.languages.registerHoverProvider(lang, {
    provideHover: async (model, position) => {
      const c = await ensureClient(lang)
      if (!c) return null
      const res = await c.request('textDocument/hover', {
        textDocument: { uri: toFileUri(relOf(model)) },
        position: lspPosition(position),
      })
      if (!res?.contents) return null
      const contents = mapHoverContents(res.contents)
      return { range: res.range ? mapRange(res.range) : undefined, contents }
    },
  })

  m.languages.registerSignatureHelpProvider(lang, {
    signatureHelpTriggerCharacters: ['(', ','],
    provideSignatureHelp: async (model, position) => {
      const c = await ensureClient(lang)
      if (!c) return { value: null, dispose() {} }
      const res = await c.request('textDocument/signatureHelp', {
        textDocument: { uri: toFileUri(relOf(model)) },
        position: lspPosition(position),
        context: { isRetrigger: false, triggerKind: 2 },
      })
      if (!res?.signatures?.length) return { value: null, dispose() {} }
      return {
        value: {
          signatures: res.signatures.map((s: any) => ({
            label: s.label,
            documentation: mapDocs(s.documentation),
            parameters: (s.parameters ?? []).map((pm: any) => ({
              label: pm.label,
              documentation: mapDocs(pm.documentation),
            })),
          })),
          activeSignature: res.activeSignature ?? 0,
          activeParameter: res.activeParameter ?? 0,
        },
        dispose() {},
      }
    },
  })

  m.languages.registerDefinitionProvider(lang, {
    provideDefinition: async (model, position) => {
      const c = await ensureClient(lang)
      if (!c) return null
      const res = await c.request('textDocument/definition', {
        textDocument: { uri: toFileUri(relOf(model)) },
        position: lspPosition(position),
      })
      const locs = Array.isArray(res) ? res : res ? [res] : []
      return locs
        .map((l: any) => ({ rel: relFromFileUri(l.uri ?? l.targetUri), range: l.range ?? l.targetSelectionRange }))
        .filter((l: any) => l.rel)
        .map((l: any) => ({ uri: monacoUriOf(l.rel), range: mapRange(l.range) }))
    },
  })
}

// ── 诊断 → 编辑器标记 ───────────────────────────────────────────────────────
const SEVERITY = { 1: 8, 2: 4, 3: 2, 4: 1 } // LSP Error/Warning/Info/Hint → monaco

async function applyDiagnostics(params: { uri: string; diagnostics?: any[] }) {
  const rel = relFromFileUri(params.uri)
  if (!rel) return // vault 外（如 typeshed 存根）不展示
  const m = await getMonaco()
  const model = m.editor.getModel(monacoUriOf(rel))
  if (!model) return
  const markers = (params.diagnostics ?? []).map((d) => ({
    severity: SEVERITY[d.severity as keyof typeof SEVERITY] ?? 2,
    message: d.message,
    startLineNumber: d.range.start.line + 1,
    startColumn: d.range.start.character + 1,
    endLineNumber: d.range.end.line + 1,
    endColumn: d.range.end.character + 1,
    source: d.source,
    code: typeof d.code === 'object' ? String(d.code.value) : d.code !== undefined ? String(d.code) : undefined,
  }))
  m.editor.setModelMarkers(model, 'lsp', markers)
}

// ── LSP 类型 → monaco 枚举/结构映射 ─────────────────────────────────────────
const KIND_MAP: Record<number, string> = {
  1: 'Text', 2: 'Method', 3: 'Function', 4: 'Constructor', 5: 'Field', 6: 'Variable',
  7: 'Class', 8: 'Interface', 9: 'Module', 10: 'Property', 11: 'Unit', 12: 'Value',
  13: 'Enum', 14: 'Keyword', 15: 'Snippet', 16: 'Color', 17: 'File', 18: 'Reference',
  19: 'Folder', 20: 'EnumMember', 21: 'Constant', 22: 'Struct', 23: 'Event', 24: 'Operator',
  25: 'TypeParameter',
}

function mapDocs(doc: any): string | { value: string } | undefined {
  if (!doc) return undefined
  if (typeof doc === 'string') return doc
  if (doc.kind === 'markdown' || doc.kind === 'plaintext') return { value: doc.value }
  return { value: String(doc.value ?? '') }
}

function mapHoverContents(contents: any): { value: string }[] {
  if (Array.isArray(contents)) return contents.map((c) => mapDocs(c) ?? { value: '' })
  const d = mapDocs(contents)
  return [typeof d === 'string' ? { value: d } : (d ?? { value: '' })]
}

/** LSP 3.17 textEdit 兼容：老格式 {range,newText} 或新格式 {insert,replace,newText} */
function mapTextEditRange(te: any) {
  if (!te) return null
  const r = te.range ?? te.replace ?? te.insert
  return r ? mapRange(r) : null
}

/** 从补全项提取非空标签：label → insertText（去片段占位）→ data.symbolLabel */
function pickLabel(it: any): string {
  let l: unknown = typeof it.label === 'string' ? it.label : it.label?.label ?? it.label?.name
  if (typeof l !== 'string' || !l.trim()) {
    if (typeof it.insertText === 'string' && it.insertText) {
      l = it.insertText.replace(/\$\{\d+:?([^}]*)\}/g, '$1').replace(/\$\d/g, '')
    } else if (it.data?.symbolLabel) {
      l = String(it.data.symbolLabel)
    }
  }
  return typeof l === 'string' ? l.trim() : ''
}

function pickInsertText(it: any): string | undefined {
  return typeof it.insertText === 'string' && it.insertText ? it.insertText : undefined
}
