import { useId, useRef, useState, type ComponentType, type ReactNode } from 'react'
import RichText from '../components/RichText'
import { numeric, type DataByName, type TableData, type TreeItem } from './parser'
import InlineMarkdown from './InlineMarkdown'
import { Button, Checkbox, Input } from './primitives'

type Name = 'concept' | 'flashcards' | 'accordion' | 'tree' | 'derivation' | 'code' | 'checklist' | 'table' | 'tabs' | 'cloze' | 'match' | 'rubric' | 'progress' | 'schedule'
type Props<N extends Name> = { data: DataByName[N]; params: Record<string, string> }
const Markdown = ({ text }: { text: string }) => <RichText text={text} noteUI={false} />
function Action({ children, onClick, disabled = false, primary = false }: { children: ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return <Button className={`nui-action${primary ? '' : ' nui-action-secondary'}`} variant={primary ? 'primary' : 'secondary'} onClick={onClick} disabled={disabled}>{children}</Button>
}
function Search({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const id = useId()
  return <div className="nui-search"><label htmlFor={id}>{label}</label><Input id={id} type="search" value={value} onValueChange={onChange} placeholder="输入关键词…" /></div>
}
function Fields({ headers, row, start = 1 }: { headers: string[]; row: string[]; start?: number }) {
  return <dl className="nui-fields">{headers.slice(start).map((h, i) => <div key={h}><dt><InlineMarkdown text={h} /></dt><dd><Markdown text={row[start + i]} /></dd></div>)}</dl>
}

function Concepts({ data }: Props<'concept'>) {
  const [query, setQuery] = useState(''), [limit, setLimit] = useState(6)
  const rows = data.rows.filter(r => r.join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  return <>
    <Search value={query} label="查找概念" onChange={q => { setQuery(q); setLimit(6) }} />
    <div className="nui-definitions">{rows.slice(0, limit).map((row, i) => <article key={i}><h4><Markdown text={row[0]} /></h4><Fields headers={data.headers} row={row} /></article>)}</div>
    {!rows.length && <p className="nui-empty" role="status">没有匹配的概念。</p>}
    {rows.length > limit && <button type="button" className="nui-more" onClick={() => setLimit(limit + 12)}>再显示 {Math.min(12, rows.length - limit)} 个概念</button>}
  </>
}

function Flashcards({ data }: Props<'flashcards'>) {
  const [index, setIndex] = useState(0), [revealed, setRevealed] = useState(false)
  const [ratings, setRatings] = useState<Record<number, 'again' | 'known'>>({})
  const row = data.rows[index], panelId = useId()
  function move(delta: number) { setIndex(i => (i + delta + data.rows.length) % data.rows.length); setRevealed(false) }
  const known = Object.values(ratings).filter(r => r === 'known').length
  return <div className="nui-flashcards" onKeyDown={e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); move(e.key === 'ArrowRight' ? 1 : -1) }
  }}>
    <div className="nui-meta"><span>第 {index + 1} / {data.rows.length} 张</span><span>已记住 {known} · 待复习 {Object.values(ratings).filter(r => r === 'again').length}</span></div>
    <progress value={known} max={data.rows.length} aria-label="闪卡自评进度" />
    <div className="nui-flash-front"><span className="nui-eyebrow"><InlineMarkdown text={data.headers[0]} /></span><Markdown text={row[0]} /></div>
    <button type="button" className="nui-reveal" aria-expanded={revealed} aria-controls={panelId} onClick={() => setRevealed(!revealed)}>{revealed ? '隐藏答案' : '回想之后，查看答案'}</button>
    <div id={panelId} hidden={!revealed} className="nui-flash-back"><Fields headers={data.headers} row={row} /></div>
    {revealed && <div className="nui-controls"><Action onClick={() => { setRatings(r => ({ ...r, [index]: 'again' })); move(1) }}>还需复习</Action><Action primary onClick={() => { setRatings(r => ({ ...r, [index]: 'known' })); move(1) }}>已经记住</Action></div>}
    <div className="nui-controls"><Action onClick={() => move(-1)}>上一张</Action><Action onClick={() => move(1)}>下一张</Action><button type="button" onClick={() => { setRatings({}); setIndex(0); setRevealed(false) }}>重置自评</button></div>
  </div>
}

function Branches({ items, depth = 0 }: { items: TreeItem[]; depth?: number }) {
  return <ul className="nui-branches">{items.map((item, i) => <li key={i}>
    {item.body || item.children.length ? <details><summary><InlineMarkdown text={item.title} /></summary>{item.body && <Markdown text={item.body} />}{item.children.length > 0 && <Branches items={item.children} depth={depth + 1} />}</details> : <span className="nui-tree-leaf"><InlineMarkdown text={item.title} /></span>}
  </li>)}</ul>
}
function Outline({ data }: { data: TreeItem[]; params: Record<string, string> }) {
  const ref = useRef<HTMLDivElement>(null), [expanded, setExpanded] = useState(false)
  return <div ref={ref} className="nui-outline">
    <button type="button" className="nui-more" aria-expanded={expanded} onClick={() => { ref.current?.querySelectorAll('details').forEach(el => { el.open = !expanded }); setExpanded(!expanded) }}>{expanded ? '折叠全部' : '展开全部'}</button>
    <Branches items={data} />
  </div>
}

function Derivation({ data }: Props<'derivation'>) {
  const [shown, setShown] = useState(1)
  return <>
    <p className="nui-meta">逐步推导 · 已展开 {shown} / {data.rows.length} 步</p>
    <ol className="nui-derivation">{data.rows.slice(0, shown).map((row, i) => <li key={i}>
      <span className="nui-step-number">{i + 1}</span><div><h4><Markdown text={row[0]} /></h4><div className="nui-equation"><Markdown text={row[1]} /></div>{row.length > 2 && <Fields headers={data.headers} row={row} start={2} />}</div>
    </li>)}</ol>
    <div className="nui-controls"><Action primary disabled={shown === data.rows.length} onClick={() => setShown(s => s + 1)}>下一步</Action><Action disabled={shown === data.rows.length} onClick={() => setShown(data.rows.length)}>展开全部</Action><button type="button" onClick={() => setShown(1)}>从头推导</button></div>
  </>
}

function CodeWalkthrough({ data }: Props<'code'>) {
  const [line, setLine] = useState(data.annotations[0]?.line ?? 1), [wrap, setWrap] = useState(false), [message, setMessage] = useState('')
  const annotation = data.annotations.find(a => a.line === line) ?? data.annotations[0]
  const lines = data.code.split('\n'), annotated = new Set(data.annotations.map(a => a.line))
  const explained = lines.filter((text, i) => text.trim() && annotated.has(i + 1)).length
  const total = lines.filter(text => text.trim()).length
  const current = data.annotations.indexOf(annotation)
  const explanationId = useId()
  return <div className="nui-codewalk">
    <div className="nui-controls"><span className="nui-code-language">{data.language}</span><button type="button" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>自动换行</button><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(data.code); setMessage('已复制代码') } catch { setMessage('复制不可用，请从原始 Markdown 复制') } }}>复制代码</button></div>
    <p className="nui-meta">{explained ? `原文已讲解 ${explained} / ${total} 行；点击高亮行或逐行阅读。` : '原文尚未提供逐行讲解；可在代码围栏后添加「行号 | 讲解」表格。'}</p>
    <pre className={wrap ? 'nui-wrap-code' : ''} aria-label="代码导读"><code>{lines.map((text, i) => {
      const content = <><span aria-hidden="true">{i + 1}</span><span>{text || ' '}</span></>
      return annotated.has(i + 1) ? <button type="button" className="nui-code-line" key={i} aria-pressed={annotation?.line === i + 1} aria-controls={explanationId} aria-label={`第 ${i + 1} 行：${text}`} onClick={() => setLine(i + 1)}>{content}</button> : <span className="nui-code-line nui-code-static" key={i}>{content}</span>
    })}</code></pre>
    {annotation && <>
      <div className="nui-controls" aria-label="逐行讲解"><button type="button" disabled={current <= 0} onClick={() => setLine(data.annotations[current - 1].line)}>上一行讲解</button><span className="nui-meta">{current + 1} / {data.annotations.length}</span><button type="button" disabled={current === data.annotations.length - 1} onClick={() => setLine(data.annotations[current + 1].line)}>下一行讲解</button></div>
      <div id={explanationId} className="nui-code-explanation" role="status"><strong>第 {annotation.line} 行</strong><Markdown text={annotation.text} /></div>
    </>}
    <p className="nui-meta" role="status">{message || '代码导读只展示与讲解代码，不执行代码。'}</p>
  </div>
}

function Checklist({ data }: Props<'checklist'>) {
  const [checked, setChecked] = useState(() => data.map(i => i.checked))
  const done = checked.filter(Boolean).length
  return <div className="nui-checklist"><div className="nui-meta"><span>已完成 {done} / {data.length}</span><button type="button" onClick={() => setChecked(data.map(i => i.checked))}>恢复原始状态</button></div><progress value={done} max={data.length} aria-label="清单完成进度" />
    {data.map((item, i) => <Checkbox key={i} checked={checked[i]} onCheckedChange={value => setChecked(c => c.map((v, j) => j === i ? value : v))} label={<Markdown text={item.text} />} />)}
    <p className="nui-meta">勾选仅在当前阅读会话内生效；编辑原文可保存清单。</p>
  </div>
}

function ExplorerTable({ data }: Props<'table'>) {
  const [query, setQuery] = useState(''), [sort, setSort] = useState<{ col: number; ascending: boolean } | null>(null), [page, setPage] = useState(0)
  const rows = data.rows.map((row, index) => ({ row, index })).filter(({ row }) => row.join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  if (sort) rows.sort((a, b) => {
    const x = a.row[sort.col], y = b.row[sort.col], nx = numeric(x), ny = numeric(y)
    const result = nx !== null && ny !== null ? nx - ny : x.localeCompare(y, 'zh-CN', { numeric: true })
    return (sort.ascending ? result : -result) || a.index - b.index
  })
  const pages = Math.max(1, Math.ceil(rows.length / 20)), current = Math.min(page, pages - 1)
  return <>
    <Search value={query} label="筛选表格" onChange={q => { setQuery(q); setPage(0) }} />
    <div className="nui-table-scroll" tabIndex={0} role="region" aria-label="可排序数据表"><table><thead><tr>{data.headers.map((h, col) => <th key={h} scope="col" aria-sort={sort?.col === col ? sort.ascending ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => { setSort(s => ({ col, ascending: s?.col === col ? !s.ascending : true })); setPage(0) }}><InlineMarkdown text={h} /> {sort?.col === col ? sort.ascending ? '↑' : '↓' : '↕'}</button></th>)}</tr></thead>
      <tbody>{rows.slice(current * 20, current * 20 + 20).map(({ row, index }) => <tr key={index}>{row.map((cell, col) => <td key={col}><Markdown text={cell} /></td>)}</tr>)}</tbody></table></div>
    {!rows.length && <p className="nui-empty" role="status">没有匹配的数据。</p>}
    <div className="nui-controls"><span className="nui-meta">{rows.length} 条 · 第 {current + 1} / {pages} 页</span><Action disabled={!current} onClick={() => setPage(current - 1)}>上一页</Action><Action disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>下一页</Action></div>
  </>
}

function Tabs({ data }: Props<'tabs'>) {
  const [active, setActive] = useState(0), id = useId()
  return <>
    <div role="tablist" aria-label="知识分组" className="nui-tablist">{data.rows.map((row, i) => <button type="button" key={i} role="tab" id={`${id}-tab-${i}`} aria-controls={`${id}-panel`} aria-selected={active === i} tabIndex={active === i ? 0 : -1} onClick={() => setActive(i)} onKeyDown={e => {
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? data.rows.length - 1 : e.key === 'ArrowRight' ? (i + 1) % data.rows.length : e.key === 'ArrowLeft' ? (i - 1 + data.rows.length) % data.rows.length : null
      if (next !== null) { e.preventDefault(); setActive(next); e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus() }
    }}><InlineMarkdown text={row[0]} /></button>)}</div>
    <div role="tabpanel" tabIndex={0} id={`${id}-panel`} aria-labelledby={`${id}-tab-${active}`} className="nui-tabpanel"><Fields headers={data.headers} row={data.rows[active]} /></div>
  </>
}

const normalizeAnswer = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
function Cloze({ data }: Props<'cloze'>) {
  const [answers, setAnswers] = useState(() => data.map(() => '')), [submitted, setSubmitted] = useState(false), id = useId()
  const correct = data.map((d, i) => normalizeAnswer(d.answer) === normalizeAnswer(answers[i]))
  return <form className="nui-cloze" onSubmit={e => { e.preventDefault(); setSubmitted(true) }}>
    {data.map((item, i) => <div key={i} className="nui-cloze-item"><label htmlFor={`${id}-${i}`}><Markdown text={item.before} /><span className="nui-meta">填空 {i + 1}</span></label><input id={`${id}-${i}`} type="text" value={answers[i]} autoComplete="off" onChange={e => { setAnswers(a => a.map((v, j) => j === i ? e.target.value : v)); setSubmitted(false) }} /><Markdown text={item.after} />
      {submitted && <p className={correct[i] ? 'nui-answer-correct' : 'nui-answer-wrong'}>{correct[i] ? '回答正确' : `参考答案：${item.answer}`}</p>}</div>)}
    <div className="nui-controls"><button type="submit" className="nui-action">检查填空</button><button type="button" onClick={() => { setAnswers(data.map(() => '')); setSubmitted(false) }}>重置</button></div>
    {submitted && <p role="status">答对 {correct.filter(Boolean).length} / {data.length} 题 · 按原文精确匹配，忽略大小写与首尾空格。</p>}
  </form>
}

function Matching({ data }: Props<'match'>) {
  const [answers, setAnswers] = useState(() => data.rows.map(() => '')), [submitted, setSubmitted] = useState(false), id = useId()
  const [order] = useState(() => {
    const indices = data.rows.map((_, i) => i)
    for (let i = indices.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [indices[i], indices[j]] = [indices[j], indices[i]] }
    return indices
  })
  return <form className="nui-matching" onSubmit={e => { e.preventDefault(); setSubmitted(true) }}>
    {data.rows.map((row, i) => <div key={i}><label htmlFor={`${id}-${i}`}><Markdown text={row[0]} /></label><select id={`${id}-${i}`} value={answers[i]} onChange={e => { setAnswers(a => a.map((v, j) => j === i ? e.target.value : v)); setSubmitted(false) }}><option value="">选择对应项</option>{order.map(j => <option key={j} value={j}>{data.rows[j][1]}</option>)}</select>{submitted && <p className={answers[i] === String(i) ? 'nui-answer-correct' : 'nui-answer-wrong'}>{answers[i] === String(i) ? '配对正确' : `对应项：${row[1]}`}</p>}</div>)}
    <div className="nui-controls"><button type="submit" className="nui-action" disabled={answers.some(a => a === '')}>检查配对</button><button type="button" onClick={() => { setAnswers(data.rows.map(() => '')); setSubmitted(false) }}>重新配对</button></div>
    {submitted && <p role="status">配对正确 {answers.filter((a, i) => a === String(i)).length} / {data.rows.length} 项</p>}
  </form>
}

function Rubric({ data }: Props<'rubric'>) {
  const [scores, setScores] = useState<Record<number, number>>({}), id = useId()
  const total = Object.values(scores).reduce((a, b) => a + b, 0), max = data.reduce((s, row) => s + row.max, 0)
  return <div className="nui-rubric"><p className="nui-meta" role="status">自评 {total} / {max} 分 · 已评 {Object.keys(scores).length} / {data.length} 个维度</p>
    {data.map((row, i) => <div key={i}><label htmlFor={`${id}-${i}`}><Markdown text={row.label} /><span>{scores[i] === undefined ? '未评分' : `${scores[i]} / ${row.max}`}</span></label>{row.description && <Markdown text={row.description} />}<input id={`${id}-${i}`} type="range" min="0" max={row.max} step="1" value={scores[i] ?? 0} onChange={e => setScores(s => ({ ...s, [i]: Number(e.target.value) }))} /></div>)}
    <button type="button" className="nui-more" onClick={() => setScores({})}>重置自评</button><p className="nui-meta">自评帮助定位薄弱点，不会自动修改知识图谱掌握度。</p>
  </div>
}

function Progress({ data }: Props<'progress'>) {
  return <div className="nui-progress-list">{data.map((row, i) => <div key={i}><div><Markdown text={row.label} /><span>{row.value} / {row.total} · {Math.round(row.value / row.total * 100)}%</span></div><progress value={row.value} max={row.total} aria-label={row.label} /></div>)}</div>
}

function Schedule({ data }: Props<'schedule'>) {
  const months = [...new Set(data.map(d => d.date.slice(0, 7)))], [month, setMonth] = useState('all'), [checked, setChecked] = useState<Record<number, boolean>>({}), id = useId()
  const rows = data.map((row, i) => ({ ...row, i })).filter(row => month === 'all' || row.date.startsWith(month))
  const dates = [...new Set(rows.map(row => row.date))]
  return <div className="nui-schedule"><div className="nui-search"><label htmlFor={id}>学习日程范围</label><select id={id} value={month} onChange={e => setMonth(e.target.value)}><option value="all">全部日期</option>{months.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
    {dates.map(date => <section key={date}><h4><time dateTime={date}>{date}</time></h4>{rows.filter(row => row.date === date).map(row => <label key={row.i}><input type="checkbox" checked={Boolean(checked[row.i])} onChange={e => setChecked(c => ({ ...c, [row.i]: e.target.checked }))} /><div><Markdown text={row.task} />{row.detail && <div className="nui-meta"><Markdown text={row.detail} /></div>}</div></label>)}</section>)}
    <p className="nui-meta" role="status">当前范围完成 {rows.filter(row => checked[row.i]).length} / {rows.length} 项。此组件不创建系统提醒。</p>
  </div>
}

export const learningRegistry: { [N in Name]: { label: string; render: ComponentType<Props<N>> } } = {
  concept: { label: '概念词典', render: Concepts }, flashcards: { label: '回忆闪卡', render: Flashcards },
  accordion: { label: '折叠讲解', render: Outline }, tree: { label: '知识层级', render: Outline },
  derivation: { label: '分步推导', render: Derivation }, code: { label: '代码导读', render: CodeWalkthrough },
  checklist: { label: '学习清单', render: Checklist }, table: { label: '数据探索', render: ExplorerTable },
  tabs: { label: '知识分组', render: Tabs }, cloze: { label: '主动填空', render: Cloze },
  match: { label: '概念配对', render: Matching }, rubric: { label: '掌握度自评', render: Rubric },
  progress: { label: '学习进度', render: Progress }, schedule: { label: '学习日程', render: Schedule },
}
