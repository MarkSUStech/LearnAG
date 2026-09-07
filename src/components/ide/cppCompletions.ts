// C/C++ 离线补全（clangd 不可用时的回退，与 pythonCompletions 同机制）：
// 关键字 / 预处理指令 / 常用标准库成员（`std::` 触发，按 `::` 链匹配）/ 常用片段。
import { isLspActive } from './lspState'

export const CPP_KEYWORDS = [
  'int', 'char', 'bool', 'float', 'double', 'void', 'long', 'short', 'unsigned', 'signed',
  'const', 'constexpr', 'consteval', 'static', 'extern', 'inline', 'class', 'struct', 'enum',
  'union', 'namespace', 'using', 'template', 'typename', 'public', 'private', 'protected',
  'virtual', 'override', 'final', 'friend', 'operator', 'return', 'if', 'else', 'for', 'while',
  'do', 'switch', 'case', 'break', 'continue', 'default', 'try', 'catch', 'throw', 'new',
  'delete', 'this', 'nullptr', 'true', 'false', 'auto', 'sizeof', 'static_cast',
  'dynamic_cast', 'const_cast', 'reinterpret_cast', 'typealias', 'concept', 'requires',
  'co_await', 'co_return', 'co_yield', 'mutable', 'explicit', 'noexcept', 'typedef',
]

export const CPP_PREPROCESSOR = ['#include', '#define', '#ifndef', '#define', '#endif', '#pragma once', '#pragma', '#error']

export const CPP_BUILTINS = [
  'cout', 'cin', 'cerr', 'clog', 'endl', 'std', 'size_t',
  'string', 'vector', 'map', 'unordered_map', 'set', 'unordered_set', 'pair', 'tuple',
  'array', 'deque', 'list', 'queue', 'stack', 'priority_queue',
  'sort', 'find', 'find_if', 'max', 'min', 'swap', 'reverse', 'abs', 'move', 'forward',
  'make_pair', 'make_shared', 'make_unique', 'shared_ptr', 'unique_ptr', 'weak_ptr',
  'optional', 'variant', 'function', 'thread', 'mutex', 'atomic',
]

export const CPP_SNIPPETS: { label: string; body: string; detail: string }[] = [
  { label: 'main', detail: 'main 函数', body: 'int main(${1:int argc, char *argv[]}) {\n\t${2:return 0;\n}}' },
  { label: 'class', detail: '类定义', body: 'class ${1:Name} {\npublic:\n\t${1:Name}(${2});\n\t~${1:Name}();\n\nprivate:\n\t${3}\n};' },
  { label: 'struct', detail: '结构体', body: 'struct ${1:Name} {\n\t${2}\n};' },
  { label: 'for', detail: 'for 循环', body: 'for (${1:int i = 0}; ${2:i < n}; ++${1:i}) {\n\t${3}\n}' },
  { label: 'foreach', detail: '范围 for', body: 'for (const auto &${1:item} : ${2:container}) {\n\t${3}\n}' },
  { label: 'if', detail: 'if 语句', body: 'if (${1:cond}) {\n\t${2}\n}' },
  { label: 'cout', detail: '输出行', body: 'std::cout << ${1} << std::endl;' },
  { label: 'func', detail: '函数定义', body: '${1:void} ${2:name}(${3:args}) {\n\t${4}\n}' },
  { label: 'template', detail: '函数模板', body: 'template <typename ${1:T}>\n${2:auto} ${3:name}(${4:$1 x}) {\n\t${5}\n}' },
  { label: 'try', detail: 'try/catch', body: 'try {\n\t${1}\n} catch (const std::exception &${2:e}) {\n\t${3}\n}' },
  { label: 'incl', detail: '#include 头文件', body: '#include <${1:iostream}>' },
  { label: 'guard', detail: '#ifndef 头文件保护', body: '#ifndef ${1:HEADER_H}\n#define ${1:HEADER_H}\n\n${2}\n\n#endif' },
]

/** `::` 链成员表：键为链（如 std、std::chrono） */
export const CPP_NAMESPACES: Record<string, [name: string, kind: 'f' | 'c' | 'v' | 'k'][]> = {
  std: [
    ['cout', 'v'], ['cin', 'v'], ['cerr', 'v'], ['clog', 'v'], ['endl', 'f'],
    ['string', 'c'], ['wstring', 'c'], ['vector', 'c'], ['map', 'c'], ['unordered_map', 'c'],
    ['set', 'c'], ['unordered_set', 'c'], ['multimap', 'c'], ['multiset', 'c'],
    ['pair', 'c'], ['tuple', 'c'], ['array', 'c'], ['deque', 'c'], ['list', 'c'],
    ['queue', 'c'], ['stack', 'c'], ['priority_queue', 'c'], ['optional', 'c'], ['variant', 'c'],
    ['function', 'c'], ['shared_ptr', 'c'], ['unique_ptr', 'c'], ['weak_ptr', 'c'],
    ['sort', 'f'], ['find', 'f'], ['find_if', 'f'], ['max', 'f'], ['min', 'f'], ['max_element', 'f'],
    ['min_element', 'f'], ['swap', 'f'], ['reverse', 'f'], ['abs', 'f'], ['make_pair', 'f'],
    ['make_shared', 'f'], ['make_unique', 'f'], ['move', 'f'], ['forward', 'f'], ['for_each', 'f'],
    ['transform', 'f'], ['accumulate', 'f'], ['count', 'f'], ['count_if', 'f'], ['begin', 'f'], ['end', 'f'],
    ['size_t', 'k'], ['string_view', 'c'], ['exception', 'c'], ['runtime_error', 'c'],
  ],
  'std::chrono': [
    ['system_clock', 'c'], ['steady_clock', 'c'], ['duration', 'c'], ['time_point', 'c'],
    ['seconds', 'c'], ['milliseconds', 'c'], ['microseconds', 'c'], ['minutes', 'c'], ['hours', 'c'],
  ],
  'std::filesystem': [
    ['path', 'c'], ['exists', 'f'], ['is_directory', 'f'], ['is_file', 'f'], ['create_directory', 'f'],
    ['remove', 'f'], ['rename', 'f'], ['copy', 'f'], ['current_path', 'f'], ['directory_iterator', 'c'],
  ],
  'std::this_thread': [['sleep_for', 'f'], ['sleep_until', 'f'], ['get_id', 'f'], ['yield', 'f']],
}

const KIND_MAP = { f: 'Function', c: 'Class', v: 'Variable', k: 'Constant' } as const

/** 光标前的 `::` 链：如 `std::` → 'std'；`std::chrono::` → 'std::chrono' */
function doubleColonChainBefore(model: any, position: any): string | null {
  const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1)
  const m = line.match(/([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)::$/)
  return m ? m[1] : null
}

const toRange = (position: any, startColumn: number, endColumn: number) => ({
  startLineNumber: position.lineNumber,
  endLineNumber: position.lineNumber,
  startColumn,
  endColumn,
})

export function provideCppCompletions(model: any, position: any) {
  const lspReady = isLspActive('cpp')
  const chain = doubleColonChainBefore(model, position)
  const suggestions: any[] = []

  if (chain) {
    if (lspReady) return { suggestions: [] } // clangd 在时让位
    const members = CPP_NAMESPACES[chain]
    if (!members) return { suggestions: [] }
    for (const [name, kind] of members) {
      suggestions.push({
        label: name,
        kind: KIND_MAP[kind],
        insertText: name,
        detail: `${chain}::${name}`,
        sortText: '0' + name,
        range: toRange(position, position.column, position.column),
      })
    }
    return { suggestions }
  }

  const word = model.getWordUntilPosition(position)
  const range = toRange(position, word.startColumn ?? position.column, word.endColumn ?? position.column)
  if (!lspReady) {
    for (const b of CPP_BUILTINS) {
      suggestions.push({ label: b, kind: 'Function', insertText: b, detail: '常用标识', sortText: '1' + b, range })
    }
  }
  for (const k of CPP_KEYWORDS) {
    suggestions.push({ label: k, kind: 'Keyword', insertText: k, sortText: '2' + k, range })
  }
  for (const pp of CPP_PREPROCESSOR) {
    suggestions.push({ label: pp, kind: 'Keyword', insertText: pp + ' ', sortText: '3' + pp, range })
  }
  for (const s of CPP_SNIPPETS) {
    suggestions.push({
      label: s.label,
      kind: 'Snippet',
      insertText: s.body,
      insertTextRules: 'InsertAsSnippet',
      detail: s.detail,
      sortText: '0' + s.label,
      range,
    })
  }
  return { suggestions }
}
