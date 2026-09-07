// IDE 文件类型映射：扩展名 → Monaco 语言 / 文件图标(颜色) / 打开方式
export type FileKind = 'md' | 'pdf' | 'image' | 'code' | 'text' | 'binary'

export function extOf(path: string): string {
  const name = path.split('/').pop() ?? ''
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])

const CODE_EXTS = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts',
  'py', 'pyi', 'rb', 'php', 'pl', 'lua',
  'java', 'kt', 'kts', 'scala', 'groovy',
  'c', 'h', 'cpp', 'hpp', 'cc', 'hh', 'cs',
  'go', 'rs', 'swift', 'dart', 'm',
  'html', 'htm', 'vue', 'svelte',
  'css', 'scss', 'less',
  'json', 'jsonc', 'ipynb',
  'xml', 'svg', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'properties',
  'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1',
  'sql', 'r', 'proto', 'gradle',
])

const TEXT_EXTS = new Set(['txt', 'log', 'csv', 'gitignore', 'gitattributes', 'env', 'license', 'readme'])

/** 文件打开方式分派 */
export function kindOf(path: string): FileKind {
  const ext = extOf(path)
  const base = (path.split('/').pop() ?? '').toLowerCase()
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (ext === 'pdf') return 'pdf'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (CODE_EXTS.has(ext) || CODE_EXTS.has(base)) return 'code'
  if (TEXT_EXTS.has(ext) || TEXT_EXTS.has(base)) return 'text'
  return 'binary'
}

/** 扩展名 → Monaco 语言 id */
const LANG_BY_EXT: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  py: 'python', pyi: 'python',
  rb: 'ruby', php: 'php', pl: 'perl', lua: 'lua',
  java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala', groovy: 'groovy',
  c: 'c', h: 'cpp', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', hh: 'cpp', cs: 'csharp',
  go: 'go', rs: 'rust', swift: 'swift', dart: 'dart', m: 'objective-c',
  html: 'html', htm: 'html', vue: 'html', svelte: 'html',
  css: 'css', scss: 'scss', less: 'less',
  json: 'json', jsonc: 'json', ipynb: 'json',
  xml: 'xml', svg: 'xml',
  yml: 'yaml', yaml: 'yaml',
  toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  bat: 'bat', cmd: 'bat', ps1: 'powershell',
  sql: 'sql', r: 'r', proto: 'protobuf', gradle: 'groovy',
}

export function monacoLangOf(path: string): string {
  const ext = extOf(path)
  const base = (path.split('/').pop() ?? '').toLowerCase()
  if (base === 'dockerfile') return 'dockerfile'
  if (base === 'makefile') return 'shell'
  return LANG_BY_EXT[ext] ?? 'plaintext'
}

/** Monaco 语言 id → 状态栏展示名 */
const LANG_LABEL: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  ruby: 'Ruby',
  php: 'PHP',
  perl: 'Perl',
  lua: 'Lua',
  java: 'Java',
  kotlin: 'Kotlin',
  scala: 'Scala',
  groovy: 'Groovy',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  go: 'Go',
  rust: 'Rust',
  swift: 'Swift',
  dart: 'Dart',
  'objective-c': 'Objective-C',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  json: 'JSON',
  xml: 'XML',
  yaml: 'YAML',
  ini: 'INI',
  markdown: 'Markdown',
  shell: 'Shell',
  bat: 'Batch',
  powershell: 'PowerShell',
  sql: 'SQL',
  r: 'R',
  protobuf: 'Protobuf',
  dockerfile: 'Dockerfile',
  plaintext: '纯文本',
}

export function langLabel(id: string): string {
  return LANG_LABEL[id] ?? id
}

/** 扩展名 → 文件图标（material-symbols 连字）与颜色（类 seti 观感） */
const ICON_BY_EXT: Record<string, { icon: string; color: string }> = {
  md: { icon: 'description', color: '#519aba' },
  markdown: { icon: 'description', color: '#519aba' },
  pdf: { icon: 'picture_as_pdf', color: '#d16060' },
  png: { icon: 'image', color: '#a074c4' },
  jpg: { icon: 'image', color: '#a074c4' },
  jpeg: { icon: 'image', color: '#a074c4' },
  gif: { icon: 'image', color: '#a074c4' },
  webp: { icon: 'image', color: '#a074c4' },
  svg: { icon: 'image', color: '#ffb86b' },
  bmp: { icon: 'image', color: '#a074c4' },
  ico: { icon: 'image', color: '#a074c4' },
  js: { icon: 'javascript', color: '#f1e05a' },
  mjs: { icon: 'javascript', color: '#f1e05a' },
  cjs: { icon: 'javascript', color: '#f1e05a' },
  jsx: { icon: 'javascript', color: '#5dd3e0' },
  ts: { icon: 'javascript', color: '#519aba' },
  tsx: { icon: 'javascript', color: '#5dd3e0' },
  mts: { icon: 'javascript', color: '#519aba' },
  cts: { icon: 'javascript', color: '#519aba' },
  json: { icon: 'data_object', color: '#cbcb41' },
  jsonc: { icon: 'data_object', color: '#cbcb41' },
  ipynb: { icon: 'data_object', color: '#f37626' },
  html: { icon: 'html', color: '#e5734f' },
  htm: { icon: 'html', color: '#e5734f' },
  vue: { icon: 'html', color: '#41b883' },
  svelte: { icon: 'html', color: '#ff6259' },
  css: { icon: 'css', color: '#519aba' },
  scss: { icon: 'css', color: '#c6538c' },
  less: { icon: 'css', color: '#6b8fa3' },
  py: { icon: 'code_blocks', color: '#519aba' },
  pyi: { icon: 'code_blocks', color: '#519aba' },
  rb: { icon: 'code_blocks', color: '#cc5b5b' },
  php: { icon: 'code_blocks', color: '#8993be' },
  java: { icon: 'code_blocks', color: '#cc7d5c' },
  kt: { icon: 'code_blocks', color: '#a97bff' },
  kts: { icon: 'code_blocks', color: '#a97bff' },
  scala: { icon: 'code_blocks', color: '#cc7d5c' },
  c: { icon: 'code_blocks', color: '#8a8a8a' },
  h: { icon: 'code_blocks', color: '#8a8a8a' },
  cpp: { icon: 'code_blocks', color: '#7e9cd8' },
  hpp: { icon: 'code_blocks', color: '#7e9cd8' },
  cc: { icon: 'code_blocks', color: '#7e9cd8' },
  hh: { icon: 'code_blocks', color: '#7e9cd8' },
  cs: { icon: 'code_blocks', color: '#5cb85c' },
  go: { icon: 'code_blocks', color: '#00add8' },
  rs: { icon: 'code_blocks', color: '#dea584' },
  swift: { icon: 'code_blocks', color: '#f0745f' },
  dart: { icon: 'code_blocks', color: '#5dd3e0' },
  yml: { icon: 'code_blocks', color: '#f08072' },
  yaml: { icon: 'code_blocks', color: '#f08072' },
  toml: { icon: 'code_blocks', color: '#9c8f7f' },
  ini: { icon: 'code_blocks', color: '#9c8f7f' },
  cfg: { icon: 'code_blocks', color: '#9c8f7f' },
  conf: { icon: 'code_blocks', color: '#9c8f7f' },
  sh: { icon: 'terminal', color: '#89e051' },
  bash: { icon: 'terminal', color: '#89e051' },
  zsh: { icon: 'terminal', color: '#89e051' },
  bat: { icon: 'terminal', color: '#a4c98c' },
  cmd: { icon: 'terminal', color: '#a4c98c' },
  ps1: { icon: 'terminal', color: '#5cb1d6' },
  sql: { icon: 'database', color: '#e38c00' },
  r: { icon: 'code_blocks', color: '#7ca6c9' },
  proto: { icon: 'code_blocks', color: '#c0a06b' },
  txt: { icon: 'article', color: '#9aa1ad' },
  log: { icon: 'article', color: '#9aa1ad' },
  csv: { icon: 'table', color: '#89c47c' },
}

const CODE_DEFAULT = { icon: 'code_blocks', color: '#9aa1ad' }
const TEXT_DEFAULT = { icon: 'article', color: '#9aa1ad' }

export function fileIcon(path: string): { icon: string; color: string } {
  const ext = extOf(path)
  const hit = ICON_BY_EXT[ext]
  if (hit) return hit
  const base = (path.split('/').pop() ?? '').toLowerCase()
  if (base === 'dockerfile' || base === 'makefile') return { icon: 'terminal', color: '#9aa1ad' }
  if (base === 'license' || base === 'readme') return { icon: 'article', color: '#9aa1ad' }
  const kind = kindOf(path)
  if (kind === 'code') return CODE_DEFAULT
  return TEXT_DEFAULT
}

/** 可直接编译/运行的文件 → 运行器语言 key（与 server/run.js 对应）；不可运行返回 null */
const RUN_LANG_BY_EXT: Record<string, string> = {
  py: 'python', pyi: 'python',
  js: 'node', mjs: 'node', cjs: 'node',
  ts: 'node-ts', mts: 'node-ts',
  c: 'c', cpp: 'cpp', cc: 'cpp',
  java: 'java',
  go: 'go',
  rs: 'rust',
}

export function runLangOf(path: string): string | null {
  const ext = extOf(path)
  return RUN_LANG_BY_EXT[ext] ?? null
}
