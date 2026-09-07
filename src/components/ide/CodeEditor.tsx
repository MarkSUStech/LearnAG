// Monaco 封装：单实例编辑器 + 按路径复用 model（切换标签 = 切换 model，撤销历史保留）
// 外部内容刷新（SSE 重载）通过 value prop 与 model 内容比对后 setValue。
import { useEffect, useRef } from 'react'
import monaco from './monacoSetup'
import { monacoLangOf } from './fileIcons'
import { attachLspModel, changeLspModel, registerLspProviders } from './lspBridge'

interface Props {
  path: string
  value: string
  dark: boolean
  readOnly?: boolean
  onChange?: (path: string, value: string) => void
  onCursor?: (pos: { line: number; col: number }) => void
  /** 搜索结果/大纲跳转：滚动到指定行（ts 变化触发一次） */
  reveal?: { line: number; ts: number } | null
}

const uriOf = (path: string) => monaco.Uri.parse('inmemory://ide/' + path.split('/').map(encodeURIComponent).join('/'))

export default function CodeEditor({ path, value, dark, readOnly = false, onChange, onCursor, reveal }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  // 外部写入标记：setValue 触发的 onDidChangeModelContent 不回传 onChange
  const applyingRef = useRef(false)
  // 各路径最近一次应用到 model 的外部内容，避免重复 setValue 打断输入
  const appliedRef = useRef<Record<string, string>>({})

  function ensureModel(p: string, content: string): monaco.editor.ITextModel {
    const uri = uriOf(p)
    let model = monaco.editor.getModel(uri)
    if (!model) {
      model = monaco.editor.createModel(content, monacoLangOf(p), uri)
      appliedRef.current[p] = content
    }
    return model
  }

  // ── 创建编辑器（一次） ────────────────────────────────────────────────────
  useEffect(() => {
    if (!hostRef.current || editorRef.current) return
    const model = ensureModel(path, value)
    const editor = monaco.editor.create(hostRef.current, {      model,
      theme: dark ? 'la-ide-dark' : 'la-ide-light',
      automaticLayout: true,
      fontSize: 13.5,
      fontFamily:
        "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, 'Courier New', monospace",
      fontLigatures: true,
      minimap: { enabled: true, renderCharacters: false },
      scrollBeyondLastLine: true,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      renderWhitespace: 'selection',
      tabSize: model.getLanguageId() === 'python' ? 4 : 2,
      insertSpaces: true,
      quickSuggestions: { other: true, comments: false, strings: true },
      wordBasedSuggestions: 'currentDocument',
      suggestOnTriggerCharacters: true,
      suggestSelection: 'recentlyUsed',
      suggest: { showStatusBar: true },
      suggestLineHeight: 20,
      readOnly,
      padding: { top: 8 },
    })
    editorRef.current = editor

    const langId = model.getLanguageId()
    void registerLspProviders(langId)
    attachLspModel(path, value, langId)

    const changeSub = editor.onDidChangeModelContent(() => {
      if (applyingRef.current) return
      const p = pathRef.current
      const v = editor.getModel()?.getValue() ?? ''
      appliedRef.current[p] = v
      changeLspModel(p, v, langId)
      onChangeRef.current?.(p, v)
    })
    const cursorSub = editor.onDidChangeCursorPosition((e) => {
      onCursorRef.current?.({ line: e.position.lineNumber, col: e.position.column })
    })
    return () => {
      changeSub.dispose()
      cursorSub.dispose()
      editor.dispose()
      editorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 稳定的回调引用（编辑器只创建一次，回调通过 ref 转发）
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onCursorRef = useRef(onCursor)
  onCursorRef.current = onCursor
  const pathRef = useRef(path)
  pathRef.current = path

  // ── 切换文件：换 model ───────────────────────────────────────────────────
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const model = ensureModel(path, value)
    if (editor.getModel() !== model) {
      editor.setModel(model)
      editor.setScrollTop(0)
    }
    editor.updateOptions({ readOnly })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, readOnly])

  // ── 外部内容刷新：与 model 当前内容不同才 setValue（保留光标近似位置） ────
  useEffect(() => {
    const model = monaco.editor.getModel(uriOf(path))
    if (!model || model.isDisposed()) return
    if (value === model.getValue() || value === appliedRef.current[path]) return
    // 只在「非本编辑器产生」的差异时应用（自身编辑会同步更新 appliedRef）
    const selection = editorRef.current?.getSelection()
    applyingRef.current = true
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: value }], () => null)
    appliedRef.current[path] = value
    applyingRef.current = false
    changeLspModel(path, value, model.getLanguageId())
    if (selection && editorRef.current) editorRef.current.setSelection(selection)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, path])

  // ── 主题 ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    editorRef.current?.updateOptions({ theme: dark ? 'la-ide-dark' : 'la-ide-light' })
  }, [dark])

  // ── 跳转行 ───────────────────────────────────────────────────────────────
  const revealTs = reveal?.ts ?? 0
  useEffect(() => {
    if (!revealTs || !reveal) return
    const editor = editorRef.current
    if (!editor) return
    editor.revealLineInCenter(reveal.line)
    editor.setPosition({ lineNumber: reveal.line, column: 1 })
    editor.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealTs])

  return <div ref={hostRef} className="ide-monaco-host" />
}
