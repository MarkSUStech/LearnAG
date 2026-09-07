// Python 离线补全：Monaco 只内置 Python 语法着色，没有任何补全提供器。
// 本提供器是 LSP（Pyright）不可用时的回退；Pyright 就绪时成员/内置函数让位，
// 仅保留关键字与片段（Pyright 不提供这些）。静态成员表不做导入分析与动态推断。
import { isLspActive } from './lspState'

/** f=函数 c=类 v=变量/属性 k=常量 e=异常 */
type Kind = 'f' | 'c' | 'v' | 'k' | 'e'
type Member = [name: string, kind: Kind]

/** 模块成员表：键为点号链（与代码里的 `os.path.` 前缀匹配） */
export const PY_MODULES: Record<string, Member[]> = {
  os: [
    ['path', 'v'], ['sep', 'k'], ['linesep', 'k'], ['curdir', 'k'], ['pardir', 'k'], ['name', 'k'],
    ['getcwd', 'f'], ['chdir', 'f'], ['listdir', 'f'], ['scandir', 'f'], ['walk', 'f'],
    ['mkdir', 'f'], ['makedirs', 'f'], ['rmdir', 'f'], ['removedirs', 'f'], ['remove', 'f'],
    ['rename', 'f'], ['replace', 'f'], ['stat', 'f'], ['lstat', 'f'], ['symlink', 'f'],
    ['environ', 'v'], ['getenv', 'f'], ['putenv', 'f'], ['system', 'f'], ['popen', 'f'],
    ['cpu_count', 'f'], ['getpid', 'f'], ['get_terminal_size', 'f'], ['urandom', 'f'],
  ],
  'os.path': [
    ['join', 'f'], ['exists', 'f'], ['isfile', 'f'], ['isdir', 'f'], ['isabs', 'f'], ['islink', 'f'],
    ['abspath', 'f'], ['realpath', 'f'], ['relpath', 'f'], ['normpath', 'f'], ['normcase', 'f'],
    ['basename', 'f'], ['dirname', 'f'], ['split', 'f'], ['splitext', 'f'], ['splitdrive', 'f'],
    ['getsize', 'f'], ['getmtime', 'f'], ['getatime', 'f'], ['getctime', 'f'], ['commonpath', 'f'],
    ['commonprefix', 'f'], ['samefile', 'f'], ['expanduser', 'f'], ['expandvars', 'f'],
  ],
  sys: [
    ['argv', 'v'], ['path', 'v'], ['platform', 'v'], ['version', 'v'], ['version_info', 'v'],
    ['executable', 'v'], ['modules', 'v'], ['maxsize', 'k'], ['stdout', 'v'], ['stderr', 'v'],
    ['stdin', 'v'], ['exit', 'f'], ['abiflags', 'v'], ['setrecursionlimit', 'f'],
  ],
  json: [
    ['load', 'f'], ['dump', 'f'], ['loads', 'f'], ['dumps', 'f'], ['JSONDecodeError', 'e'], ['JSONEncoder', 'c'], ['JSONDecoder', 'c'],
  ],
  re: [
    ['compile', 'f'], ['match', 'f'], ['fullmatch', 'f'], ['search', 'f'], ['findall', 'f'],
    ['finditer', 'f'], ['sub', 'f'], ['subn', 'f'], ['split', 'f'], ['escape', 'f'], ['purge', 'f'],
    ['IGNORECASE', 'k'], ['MULTILINE', 'k'], ['DOTALL', 'k'], ['VERBOSE', 'k'],
    ['Match', 'c'], ['Pattern', 'c'], ['error', 'e'],
  ],
  math: [
    ['pi', 'k'], ['e', 'k'], ['tau', 'k'], ['inf', 'k'], ['nan', 'k'],
    ['ceil', 'f'], ['floor', 'f'], ['trunc', 'f'], ['sqrt', 'f'], ['isqrt', 'f'], ['pow', 'f'],
    ['exp', 'f'], ['log', 'f'], ['log2', 'f'], ['log10', 'f'], ['sin', 'f'], ['cos', 'f'], ['tan', 'f'],
    ['degrees', 'f'], ['radians', 'f'], ['factorial', 'f'], ['gcd', 'f'], ['lcm', 'f'],
    ['isclose', 'f'], ['isfinite', 'f'], ['isnan', 'f'], ['comb', 'f'], ['perm', 'f'],
  ],
  random: [
    ['seed', 'f'], ['random', 'f'], ['randint', 'f'], ['randrange', 'f'], ['choice', 'f'],
    ['choices', 'f'], ['shuffle', 'f'], ['sample', 'f'], ['uniform', 'f'], ['gauss', 'f'],
    ['betavariate', 'f'], ['expovariate', 'f'],
  ],
  datetime: [
    ['datetime', 'c'], ['date', 'c'], ['time', 'c'], ['timedelta', 'c'], ['timezone', 'c'],
    ['tzinfo', 'c'], ['MINYEAR', 'k'], ['MAXYEAR', 'k'],
  ],
  'datetime.datetime': [
    ['now', 'f'], ['today', 'f'], ['utcnow', 'f'], ['fromtimestamp', 'f'], ['fromisoformat', 'f'],
    ['strptime', 'f'], ['strftime', 'f'], ['combine', 'f'], ['timestamp', 'f'], ['isoformat', 'f'],
    ['date', 'f'], ['time', 'f'], ['replace', 'f'], ['year', 'v'], ['month', 'v'], ['day', 'v'],
    ['hour', 'v'], ['minute', 'v'], ['second', 'v'],
  ],
  collections: [
    ['defaultdict', 'c'], ['OrderedDict', 'c'], ['Counter', 'c'], ['deque', 'c'],
    ['namedtuple', 'f'], ['ChainMap', 'c'], ['UserDict', 'c'], ['UserList', 'c'],
  ],
  itertools: [
    ['chain', 'f'], ['product', 'f'], ['permutations', 'f'], ['combinations', 'f'],
    ['combinations_with_replacement', 'f'], ['groupby', 'f'], ['islice', 'f'], ['count', 'f'],
    ['cycle', 'f'], ['repeat', 'f'], ['zip_longest', 'f'], ['accumulate', 'f'], ['starmap', 'f'],
  ],
  functools: [
    ['partial', 'f'], ['reduce', 'f'], ['lru_cache', 'f'], ['cache', 'f'], ['wraps', 'f'],
    ['cached_property', 'c'], ['singledispatch', 'f'], ['total_ordering', 'f'],
  ],
  pathlib: [
    ['Path', 'c'], ['PurePath', 'c'], ['PurePosixPath', 'c'], ['PureWindowsPath', 'c'],
    ['PosixPath', 'c'], ['WindowsPath', 'c'],
  ],
  shutil: [
    ['copy', 'f'], ['copy2', 'f'], ['copyfile', 'f'], ['copytree', 'f'], ['rmtree', 'f'],
    ['move', 'f'], ['which', 'f'], ['disk_usage', 'f'], ['make_archive', 'f'], ['unpack_archive', 'f'],
  ],
  subprocess: [
    ['run', 'f'], ['Popen', 'c'], ['PIPE', 'k'], ['STDOUT', 'k'], ['DEVNULL', 'k'],
    ['check_call', 'f'], ['check_output', 'f'], ['call', 'f'], ['CompletedProcess', 'c'],
    ['CalledProcessError', 'e'], ['TimeoutExpired', 'e'],
  ],
  time: [
    ['time', 'f'], ['sleep', 'f'], ['strftime', 'f'], ['strptime', 'f'], ['ctime', 'f'],
    ['gmtime', 'f'], ['localtime', 'f'], ['mktime', 'f'], ['time_ns', 'f'], ['perf_counter', 'f'],
    ['monotonic', 'f'], ['process_time', 'f'],
  ],
  io: [['StringIO', 'c'], ['BytesIO', 'c'], ['open', 'f'], ['IOBase', 'c'], ['DEFAULT_BUFFER_SIZE', 'k']],
  csv: [
    ['reader', 'f'], ['writer', 'f'], ['DictReader', 'c'], ['DictWriter', 'c'],
    ['QUOTE_MINIMAL', 'k'], ['QUOTE_ALL', 'k'], ['Sniffer', 'c'],
  ],
  sqlite3: [
    ['connect', 'f'], ['Connection', 'c'], ['Cursor', 'c'], ['Error', 'e'],
    ['ProgrammingError', 'e'], ['OperationalError', 'e'], ['IntegrityError', 'e'], ['paramstyle', 'v'],
  ],
  typing: [
    ['Any', 'v'], ['List', 'c'], ['Dict', 'c'], ['Set', 'c'], ['Tuple', 'c'], ['Optional', 'c'],
    ['Union', 'c'], ['Callable', 'c'], ['Iterator', 'c'], ['Iterable', 'c'], ['Generator', 'c'],
    ['ClassVar', 'c'], ['Final', 'c'], ['TypeVar', 'f'], ['NamedTuple', 'c'], ['Protocol', 'c'],
  ],
  string: [
    ['ascii_letters', 'k'], ['ascii_lowercase', 'k'], ['ascii_uppercase', 'k'], ['digits', 'k'],
    ['punctuation', 'k'], ['whitespace', 'k'], ['Template', 'c'], ['capwords', 'f'],
  ],
  heapq: [['heapify', 'f'], ['heappush', 'f'], ['heappop', 'f'], ['heappushpop', 'f'], ['nlargest', 'f'], ['nsmallest', 'f'], ['merge', 'f']],
  statistics: [['mean', 'f'], ['median', 'f'], ['mode', 'f'], ['stdev', 'f'], ['variance', 'f'], ['pstdev', 'f'], ['quantiles', 'f']],
  dataclasses: [['dataclass', 'f'], ['field', 'f'], ['asdict', 'f'], ['astuple', 'f'], ['InitVar', 'v'], ['MISSING', 'k']],
  base64: [['b64encode', 'f'], ['b64decode', 'f'], ['urlsafe_b64encode', 'f'], ['urlsafe_b64decode', 'f'], ['b32encode', 'f'], ['b16encode', 'f']],
  hashlib: [['md5', 'f'], ['sha1', 'f'], ['sha224', 'f'], ['sha256', 'f'], ['sha384', 'f'], ['sha512', 'f'], ['blake2b', 'f'], ['new', 'f']],
  uuid: [['uuid1', 'f'], ['uuid3', 'f'], ['uuid4', 'f'], ['uuid5', 'f'], ['NAMESPACE_DNS', 'k'], ['UUID', 'c']],
  'urllib.parse': [['urlparse', 'f'], ['urlsplit', 'f'], ['urlunparse', 'f'], ['parse_qs', 'f'], ['parse_qsl', 'f'], ['urlencode', 'f'], ['quote', 'f'], ['unquote', 'f'], ['urljoin', 'f']],
  copy: [['copy', 'f'], ['deepcopy', 'f']],
  traceback: [['format_exc', 'f'], ['print_exc', 'f'], ['format_tb', 'f'], ['print_stack', 'f']],
  logging: [
    ['getLogger', 'f'], ['basicConfig', 'f'], ['debug', 'f'], ['info', 'f'], ['warning', 'f'],
    ['error', 'f'], ['exception', 'f'], ['critical', 'f'], ['Logger', 'c'], ['Handler', 'c'],
    ['StreamHandler', 'c'], ['FileHandler', 'c'], ['Formatter', 'c'], ['DEBUG', 'k'], ['INFO', 'k'],
    ['WARNING', 'k'], ['ERROR', 'k'],
  ],
  argparse: [['ArgumentParser', 'c'], ['Namespace', 'c'], ['FileType', 'c'], ['ArgumentTypeError', 'e']],
  tempfile: [['NamedTemporaryFile', 'f'], ['TemporaryFile', 'f'], ['TemporaryDirectory', 'f'], ['mkdtemp', 'f'], ['mkstemp', 'f'], ['gettempdir', 'f']],
  enum: [['Enum', 'c'], ['IntEnum', 'c'], ['StrEnum', 'c'], ['Flag', 'c'], ['auto', 'f'], ['unique', 'f']],
  abc: [['ABC', 'c'], ['ABCMeta', 'c'], ['abstractmethod', 'f']],
  contextlib: [['contextmanager', 'f'], ['suppress', 'f'], ['ExitStack', 'c'], ['closing', 'f'], ['redirect_stdout', 'f']],
}

export const PY_KEYWORDS = [
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif',
  'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda',
  'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
  'False', 'None', 'True', 'match', 'case',
]

export const PY_BUILTINS = [
  'print', 'len', 'range', 'open', 'input', 'int', 'float', 'str', 'bool', 'list', 'dict',
  'set', 'frozenset', 'tuple', 'sum', 'min', 'max', 'abs', 'round', 'sorted', 'reversed',
  'enumerate', 'zip', 'map', 'filter', 'any', 'all', 'isinstance', 'issubclass', 'type',
  'getattr', 'setattr', 'hasattr', 'delattr', 'repr', 'format', 'divmod', 'pow', 'hex', 'oct',
  'ord', 'chr', 'bytes', 'bytearray', 'slice', 'super', 'staticmethod', 'classmethod',
  'property', 'vars', 'dir', 'id', 'hash', 'iter', 'next', 'callable', 'exit',
]

export const PY_SNIPPETS: { label: string; body: string; detail: string }[] = [
  { label: '#main', detail: '程序入口', body: "if __name__ == '__main__':\n\t${1:main()}" },
  { label: 'def', detail: '函数定义', body: 'def ${1:name}(${2:args}):\n\t${3:pass}' },
  { label: 'class', detail: '类定义', body: 'class ${1:Name}:\n\t${2:pass}' },
  { label: 'for', detail: 'for 循环', body: 'for ${1:item} in ${2:iterable}:\n\t${3:pass}' },
  { label: 'forrange', detail: 'for + range 循环', body: 'for ${1:i} in range(${2:n}):\n\t${3:pass}' },
  { label: 'while', detail: 'while 循环', body: 'while ${1:cond}:\n\t${2:pass}' },
  { label: 'try', detail: 'try/except', body: 'try:\n\t${1:pass}\nexcept ${2:Exception} as ${3:e}:\n\t${4:raise}' },
  { label: 'withopen', detail: 'with open 读文件', body: "with open(${1:path}, ${2:'r'}, encoding='utf-8') as ${3:f}:\n\t${4:pass}" },
  { label: 'ifmain', detail: '程序入口（同 #main）', body: "if __name__ == '__main__':\n\t${1:pass}" },
]

const KIND_MAP = { f: 'Function', c: 'Class', v: 'Field', k: 'Constant', e: 'Class' } as const

/** 光标前的点号链：如 `os.path.` → 'os.path'；无链返回 null */
function dottedChainBefore(model: any, position: any): string | null {
  const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1)
  const m = line.match(/([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.$/)
  return m ? m[1] : null
}

const toRange = (position: any, startColumn: number, endColumn: number) => ({
  startLineNumber: position.lineNumber,
  endLineNumber: position.lineNumber,
  startColumn,
  endColumn,
})

/**
 * Python 补全入口（注册到 monaco.languages.registerCompletionItemProvider）。
 * 独立导出便于测试：monaco 会做关键词过滤，这里返回全量候选即可。
 */
export function providePythonCompletions(model: any, position: any) {
  const lspReady = isLspActive('python')
  const chain = dottedChainBefore(model, position)
  const suggestions: any[] = []

  if (chain) {
    if (lspReady) return { suggestions: [] } // 成员补全交给 Pyright
    const members = PY_MODULES[chain]
    if (!members) return { suggestions: [] } // 未知模块：交给 monaco 的文档内词匹配
    for (const [name, kind] of members) {
      suggestions.push({
        label: name,
        kind: KIND_MAP[kind],
        insertText: name,
        detail: `${chain}.${name}`,
        sortText: '0' + name,
        range: toRange(position, position.column, position.column),
      })
    }
    return { suggestions }
  }

  const word = model.getWordUntilPosition(position)
  const range = toRange(position, word.startColumn ?? position.column, word.endColumn ?? position.column)
  if (!lspReady) {
    for (const b of PY_BUILTINS) {
      suggestions.push({ label: b, kind: 'Function', insertText: b, detail: '内置函数', sortText: '1' + b, range })
    }
  }
  for (const k of PY_KEYWORDS) {
    suggestions.push({ label: k, kind: 'Keyword', insertText: k, sortText: '2' + k, range })
  }
  for (const s of PY_SNIPPETS) {
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
