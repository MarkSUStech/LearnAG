// Monaco 环境初始化：Vite worker 装配（vite.config 已要求 worker.format: 'es'）+ IDE 主题
// 注意：monaco 0.53+ 的 exports 映射要求用「monaco-editor/<子路径>」形式（勿带 esm/vs 前缀）
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import { providePythonCompletions } from './pythonCompletions'
import { provideCppCompletions } from './cppCompletions'

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}

// VSCode Dark Modern / Light Modern 风格（背景与 .ide-shell 面板色一致）
monaco.editor.defineTheme('la-ide-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#1f1f1f',
    'editor.foreground': '#cccccc',
    'editorLineNumber.foreground': '#6e7681',
    'editorLineNumber.activeForeground': '#cccccc',
    'editor.lineHighlightBackground': '#262626',
    'editor.selectionBackground': '#264f78',
    'editorGutter.background': '#1f1f1f',
    'minimap.background': '#1f1f1f',
  },
})
monaco.editor.defineTheme('la-ide-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#ffffff',
    'editor.lineHighlightBackground': '#f3f3f3',
    'minimap.background': '#ffffff',
  },
})

// Python 补全（Monaco 不内置任何 Python 补全）：关键字/内置函数/片段 + `.` 触发的标准库成员
monaco.languages.registerCompletionItemProvider('python', {
  triggerCharacters: ['.'],
  provideCompletionItems: providePythonCompletions as any,
})

// C/C++ 补全（clangd 不可用时的回退）：关键字/预处理/片段 + `::` 触发的 std 成员
monaco.languages.registerCompletionItemProvider('cpp', {
  triggerCharacters: [':', '.', '>'],
  provideCompletionItems: provideCppCompletions as any,
})
monaco.languages.registerCompletionItemProvider('c', {
  triggerCharacters: [':', '.', '>'],
  provideCompletionItems: provideCppCompletions as any,
})

export default monaco
