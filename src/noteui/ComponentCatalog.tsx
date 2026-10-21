import { useEffect, useRef, useState } from 'react'
import { catalog, categories } from './catalog'
import { componentRegistry } from './NoteUIBlock'
import type { ComponentName } from './parser'
import RichText from '../components/RichText'
import { noteUIRegistry } from '../../shared/noteuiRegistry'
import { Button, Checkbox, Input, RadioGroup, Select, Slider } from './primitives'
import { compositionExample, legacyDefectExample } from './galleryExamples'
import { NoteUIThemeContext } from './theme'

export default function ComponentCatalog({ onClose, onInsert, disabled, gallery = false }: { onClose: () => void; onInsert: (source: string) => void; disabled: boolean; gallery?: boolean }) {
  const [selected, setSelected] = useState<ComponentName>('sequence'), [category, setCategory] = useState('全部'), [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null)
  const entry = catalog[selected]
  const [view, setView] = useState('component'), [theme, setTheme] = useState<'light' | 'dark'>(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'), [width, setWidth] = useState('full')
  const [invalidDraft, setInvalidDraft] = useState('')
  const [draft, setDraft] = useState('二分查找'), [checked, setChecked] = useState(false), [choice, setChoice] = useState('understand'), [value, setValue] = useState(5), [copied, setCopied] = useState('')
  const spec = noteUIRegistry[selected]
  const source = view === 'composition' ? compositionExample : entry.source
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    search.current?.focus()
    return () => previous?.focus()
  }, [])
  const choices = (Object.keys(catalog) as ComponentName[]).filter(name => (category === '全部' || catalog[name].category === category) && `${name} ${componentRegistry[name].label} ${catalog[name].summary}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <div className="modal-mask nui-catalog-mask" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className={`nui-catalog${gallery ? ' nui-gallery' : ''}`} data-noteui-theme={theme} role="dialog" aria-modal="true" aria-label="NoteUI 可视化组件库" ref={root} onKeyDown={e => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
      if (e.key === 'Tab') {
        const elements = [...root.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, summary, [tabindex="0"]')].filter(el => el.getClientRects().length)
        const first = elements[0], last = elements[elements.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
      }
    }}>
      <header><div><h2>NoteUI 组件系统</h2><p>{Object.keys(catalog).length} 类组件 · Markdown 组合与本地交互</p></div><button aria-label="关闭组件库" onClick={onClose}><span className="material-symbols-rounded">close</span></button></header>
      <div className="nui-catalog-tools"><Select aria-label="展示内容" value={view} onValueChange={setView}><option value="component">组件预览</option><option value="foundations">基础控件与状态</option><option value="composition">组合学习示例</option></Select><Select aria-label="预览主题" value={theme} onValueChange={v => setTheme(v as 'light' | 'dark')}><option value="light">浅色</option><option value="dark">深色</option></Select><Select aria-label="预览宽度" value={width} onValueChange={setWidth}><option value="full">自适应</option><option value="360">手机 360px</option><option value="640">平板 640px</option></Select></div>
      <div className="nui-catalog-content"><nav aria-label="学习场景与组件"><label className="nui-visually-hidden" htmlFor="nui-catalog-search">搜索组件</label><input id="nui-catalog-search" ref={search} placeholder="搜索组件或场景…" value={query} onChange={e => setQuery(e.target.value)} />
        <label className="nui-visually-hidden" htmlFor="nui-catalog-category">学习场景</label><select id="nui-catalog-category" value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select>
        <div className="nui-catalog-list">{choices.map(name => <button key={name} aria-pressed={selected === name} onClick={() => { setSelected(name); setView('component') }}><strong>{noteUIRegistry[name].label}</strong><span>{catalog[name].summary}</span><code>{name}</code></button>)}{!choices.length && <p>没有匹配项，试试“矩阵”“概率”或“复习”。</p>}</div></nav>
        <div className="nui-catalog-preview"><div className="nui-catalog-stage" style={{ maxWidth: width === 'full' ? undefined : Number(width) }} key={selected + view}><p className="nui-meta">交互预览 · 示例数据，操作不调用 AI</p>
          {view === 'foundations' ? <div className="nui-foundations"><h3>操作与反馈</h3><div className="nui-controls"><Button variant="primary" onClick={() => setCopied('操作已完成')}>确认操作</Button><Button onClick={() => setCopied('已重新开始')}>重置</Button><Button disabled>暂不可用</Button></div><p role="status">{copied || '点击按钮查看本地反馈。'}</p><label>学习主题<Input value={draft} onValueChange={setDraft} /></label><p>当前主题：{draft || '尚未填写'}</p><label>无效输入<Input value={invalidDraft} onValueChange={setInvalidDraft} aria-invalid={!invalidDraft.trim()} aria-describedby="nui-invalid-hint" placeholder="需要填写主题" /></label><p id="nui-invalid-hint" className="nui-invalid-hint">{invalidDraft.trim() ? '主题已填写，错误状态已解除。' : '请填写主题；输入后解除错误状态。'}</p><Slider label="练习数量" value={value} min={1} max={20} onValueChange={setValue} /><p>预计练习时间：{value * 3} 分钟（每题 3 分钟的演示计算）。</p><Checkbox checked={checked} onCheckedChange={setChecked} label={checked ? '已完成本轮复习' : '标记本轮复习完成'} /><RadioGroup label="本轮目标" value={choice} options={[{ value: 'understand', label: '理解原理' }, { value: 'practice', label: '练习应用' }]} onValueChange={setChoice} /><p>已选择：{choice === 'practice' ? '练习应用' : '理解原理'}</p><h3>旧内容的长标签回退</h3><RichText text={legacyDefectExample} /></div> : <><NoteUIThemeContext.Provider value={theme}><RichText text={source} /></NoteUIThemeContext.Provider><p className="nui-meta">交互仅在当前阅读会话生效，原始 Markdown 始终可编辑。</p>{view === 'component' && <details className="nui-spec"><summary>参数、状态与使用限制</summary><p>{spec.description}。{spec.limits}</p><dl>{Object.entries(spec.params).map(([name, p]) => <div key={name}><dt><code>{name}</code></dt><dd>{p.values?.join(' / ') ?? '文本（最多160字符）'}{p.required ? ' · 必填' : p.default ? ` · 默认 ${p.default}` : ' · 可选'}</dd></div>)}</dl><p>插槽：{spec.slots.join(' / ') || '无自定义插槽'}；状态：{spec.state.join(' / ') || '只读'}。</p></details>}</>}
        </div></div>
      </div>
      <footer><span>{gallery ? copied || '开发 Gallery · 复用正式渲染器，不会修改笔记。' : disabled ? 'AI 正在写入，完成后可插入组件。' : '插入后编辑 Markdown 数据即可。'}</span><button className="nui-catalog-insert" disabled={disabled || view === 'foundations'} onClick={async () => { if (gallery) { try { await navigator.clipboard.writeText(source); setCopied('已复制 Markdown') } catch { setCopied('复制不可用，请展开原始 Markdown。') } } else onInsert(source) }}>{gallery ? '复制 Markdown' : '添加到笔记末尾'}</button></footer>
    </div>
  </div>
}
