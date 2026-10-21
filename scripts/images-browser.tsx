// Development fixture only. Uploads and sends are mocked; no model or real vault is used.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import InputBar, { type Mode } from '../src/components/InputBar'
import { api } from '../src/api'
import { renderRichMarkdown } from '../src/components/md'
import type { WriterAttachment } from '../src/types'
import '../src/styles/index.css'

const wait = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms))
let uploads: string[] = [], sent: { text: string; attachments: WriterAttachment[] }[] = []
let uploadFailures = 0, sendFailure = false
api.uploadFile = async (file: File) => {
  uploads.push(file.name)
  if (uploadFailures > 0) { uploadFailures--; throw new Error('模拟上传失败') }
  return { path: '附件/' + file.name, name: file.name, size: file.size }
}

async function picture(name = '解题截图.png') {
  const canvas = document.createElement('canvas')
  canvas.width = 420; canvas.height = 240
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, 420, 240)
  ctx.fillStyle = '#223047'; ctx.font = 'bold 25px sans-serif'; ctx.fillText('函数变换：Y = g(X)', 28, 50)
  ctx.font = '19px sans-serif'; ctx.fillText('fY(y) = fX(h(y)) · |h′(y)|', 28, 105)
  ctx.strokeStyle = '#6559ca'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(32, 200); ctx.lineTo(370, 200); ctx.moveTo(60, 215); ctx.lineTo(60, 133); ctx.moveTo(72, 185); ctx.quadraticCurveTo(180, 110, 345, 175); ctx.stroke()
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'))
  return new File([blob], name, { type: 'image/png' })
}

function App() {
  const [mode, setMode] = useState<Mode>('教学'), [key, setKey] = useState(0), [width, setWidth] = useState(1000)
  const [results, setResults] = useState<string[]>([]), [last, setLast] = useState('')
  const check = (ok: boolean, label: string) => { setResults(r => [...r, `${ok ? 'PASS' : 'FAIL'} ${label}`]); if (!ok) throw new Error(label) }
  const textarea = () => document.querySelector<HTMLTextAreaElement>('[aria-label="全局对话消息"]')!
  function text(value: string) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea(), value)
    textarea().dispatchEvent(new Event('input', { bubbles: true }))
  }
  function paste(files: File[]) {
    const transfer = new DataTransfer(); files.forEach(file => transfer.items.add(file))
    textarea().dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
  }
  function drop(files: File[]) {
    const transfer = new DataTransfer(); files.forEach(file => transfer.items.add(file))
    document.querySelector('.dock')!.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  }
  const click = (selector: string) => { const el = document.querySelector<HTMLElement>(selector); if (!el) throw new Error(selector); el.click() }
  async function reset() {
    flushSync(() => { setKey(k => k + 1); setMode('教学'); setWidth(1000) })
    uploads = []; sent = []; uploadFailures = 0; sendFailure = false
    await wait()
  }
  async function run() {
    setResults([])
    try {
      await reset()
      const image = await picture()
      for (const m of ['教学', '探索', '目标', '写作'] as Mode[]) {
        setMode(m); await wait()
        check(!!document.querySelector('button[aria-label="添加图片"]'), `${m}模式有图片入口`)
      }
      paste([image]); await wait()
      check(document.querySelectorAll('.ib-image img').length === 1, '粘贴截图显示缩略图')
      check(!document.querySelector<HTMLButtonElement>('button[title="发送"]')!.disabled, '没有文字也能发送图片')
      click('button[title="发送"]'); await wait()
      check(sent.length === 1 && sent[0].text === '请看我发送的图片。' && sent[0].attachments[0].path.endsWith('.png'), '纯图片发送自动提供提示并传入上传路径')
      check(!document.querySelector('.ib-image'), '发送成功后清空待发送图片')
      const fileInput = document.querySelector<HTMLInputElement>('input[type=file]')!
      const data = new DataTransfer(); data.items.add(image); fileInput.files = data.files; fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      await wait()
      check(!!document.querySelector('.ib-image img') && fileInput.value === '', '文件选择后显示预览并允许再次选同一文件')
      click('.ib-image > button'); await wait()
      check(!document.querySelector('.ib-image'), '可以逐张移除图片')
      drop([image, await picture('第二张.webp')]); await wait()
      check(document.querySelectorAll('.ib-image').length === 2, '拖入多张图片')
      text('请解释图中的雅可比因子'); await wait()
      click('button[title="发送"]'); await wait()
      check(sent.at(-1)!.text.includes('雅可比') && sent.at(-1)!.attachments.length === 2, '文字与多张图片一起发送')
      paste([await picture('a.png'), await picture('b.png'), await picture('c.png'), await picture('d.png'), await picture('e.png')]); await wait()
      check(document.querySelectorAll('.ib-image').length === 4 && document.querySelector('[role=alert]')!.textContent!.includes('4张'), '超过四张时明确提示并保持四张上限')
      await reset()
      const huge = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })
      drop([huge]); await wait()
      check(!document.querySelector('.ib-image') && document.querySelector('[role=alert]')!.textContent!.includes('10MB'), '过大图片在上传前拦截')
      drop([new File(['text'], 'document.txt', { type: 'text/plain' })]); await wait()
      check(!document.querySelector('.ib-image') && document.querySelector('[role=alert]')!.textContent!.includes('支持'), '非图片拖入不会误作为视觉附件')
      paste([image]); text('失败后保留草稿'); await wait()
      uploadFailures = 1
      click('button[title="发送"]'); await wait()
      check(!!document.querySelector('.ib-image') && textarea().value === '失败后保留草稿' && sent.length === 0, '上传失败保留图片与文字草稿')
      sendFailure = true
      click('button[title="发送"]'); await wait()
      const attempts = uploads.length
      check(!!document.querySelector('.ib-image') && !!document.querySelector('[role=alert]'), '发送被拒时保留上传结果供重试')
      sendFailure = false
      click('button[title="发送"]'); await wait()
      check(uploads.length === attempts && sent.length === 1 && !document.querySelector('.ib-image'), '重试复用已上传路径，不重复上传')
      paste([await picture('clipboard')]); await wait()
      click('button[title="发送"]'); await wait()
      check(uploads.at(-1) === 'clipboard.png', '无扩展名截图补上正确图片扩展名')
      paste([image]); await wait()
      for (const w of [360, 768, 1100]) {
        setWidth(w); await wait()
        const host = document.querySelector<HTMLElement>('#images-fixture')!
        check(host.scrollWidth <= host.clientWidth + 1, `${w}px 下输入栏与缩略图不溢出`)
      }
      document.documentElement.dataset.theme = 'dark'; await wait()
      check(getComputedStyle(document.querySelector('.ib-images')!).backgroundColor === 'rgb(23, 26, 32)', '图片预览适配暗色主题')
      document.documentElement.dataset.theme = 'light'; setWidth(1000)
      const template = document.createElement('template')
      template.innerHTML = renderRichMarkdown('![用户图片](<附件/解题 (1).png>)').html
      const src = template.content.querySelector('img')!.getAttribute('src')!
      check(new URL(src, location.origin).searchParams.get('path') === '附件/解题 (1).png', '工作台图片含空格括号的文件名只代理一次')
      template.innerHTML = renderRichMarkdown('![](/api/raw?path=picture.png)').html
      check(template.content.querySelector('img')!.getAttribute('src') === '/api/raw?path=picture.png', '现有图片代理地址不被再次代理')
    } catch (e) { setResults(r => [...r, `STOP ${(e as Error).message}`]) }
  }
  return <>
    <header style={{ padding: 20, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
      <button id="run-images" onClick={() => void run()}>运行全局图片回归</button>
      <button onClick={async () => { await reset(); paste([await picture()]); text('请解释图中的雅可比因子'); }}>查看图片输入示例</button>
      <select aria-label="测试模式" value={mode} onChange={e => setMode(e.target.value as Mode)}>{['教学', '探索', '目标', '写作'].map(m => <option key={m}>{m}</option>)}</select>
    </header>
    <pre id="results" style={{ margin: '0 20px', maxHeight: 170, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{results.join('\n')}</pre>
    <main id="images-fixture" style={{ width: '100%', maxWidth: width, height: 390, position: 'relative', margin: '24px auto', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg)' }}>
      <div style={{ padding: 26, color: 'var(--text-2)' }}>全局对话 · 可选图、粘贴截图或拖入图片。<p>最多4张，每张10MB。预览与上传复用原输入栏，教学、探索、目标和写作均可使用。</p>{last && <p id="last-send">{last}</p>}</div>
      <InputBar key={key} mode={mode} onModeChange={setMode} agent={{ running: false, stage: 'idle', message: '' }} answering={false} files={['资料/book.pdf']} engine="api" onStop={() => {}} onSend={async (text, attachments) => {
        if (sendFailure) return false
        sent.push({ text, attachments }); setLast(`已发送 ${attachments.length} 张图片：${text}`); return true
      }} />
    </main>
  </>
}
localStorage.removeItem('la-dock-collapsed')
document.body.style.overflow = 'auto'
const root = createRoot(document.getElementById('root')!)
root.render(<App />)
import.meta.hot?.dispose(() => root.unmount())
