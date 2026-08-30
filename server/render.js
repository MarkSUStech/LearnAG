// 服务端图表渲染：D2（@terrastruct/d2 WASM）与 gnuplot（gnuplot-wasm）→ SVG
// WASM 实例非并发安全 → 所有渲染串行执行；启动时预热避免首请求超时

let d2Instance = null

async function getD2() {
  if (d2Instance) return d2Instance
  const { D2 } = await import('@terrastruct/d2')
  d2Instance = new D2()
  await d2Instance.init?.()
  return d2Instance
}

// gnuplot-wasm 的内存快照机制在多次 exec 后会堆损坏（memory access out of bounds），
// 因此每次渲染都用全新实例（模块/WASM 编译有缓存，成本 ~1s）
async function getGnuplot() {
  const init = (await import('gnuplot-wasm')).default
  return init({})
}

// 启动预热（后台进行，失败不阻断服务）
getD2().catch((e) => console.error('[render] D2 初始化失败:', e.message))
/* gnuplot 按需初始化 */

function toSvgText(bytes) {
  if (typeof bytes === 'string') return bytes
  if (bytes && typeof bytes.length === 'number') return Buffer.from(bytes).toString('utf8')
  throw new Error('渲染结果格式异常')
}

async function renderD2(code) {
  const d2 = await getD2()
  const compiled = await d2.compile(code)
  const bytes = await d2.render(compiled.diagram, compiled.renderOptions)
  const svg = toSvgText(bytes)
  if (!svg.includes('<svg')) throw new Error('D2 渲染结果为空')
  return svg
}

async function renderGnuplot(code) {
  const gnuplot = await getGnuplot()
  // 系统统一注入 svg 终端并负责输出流；剥离模型自己写的 terminal/output 设置
  //（WASM 版只有 svg 终端，模型写的 pngcairo/png 会导致 unknown terminal）
  const cleaned = code
    .split('\n')
    .filter((l) => !/^\s*set\s+(terminal|term|output)\b/i.test(l))
    .join('\n')
  // 末尾必须 set output 关闭输出流，否则 gnuplot 缓冲的 SVG 不会写入文件
  const { svg, stdout } = gnuplot.render(cleaned.trim() + '\nset output\n', {
    term: 'svg',
    width: 900,
    height: 480,
    background: '#ffffff',
  })
  const svgText = toSvgText(svg)
  if (!svgText.includes('<svg')) {
    throw new Error('gnuplot 渲染失败：' + (stdout || '').slice(0, 300))
  }
  return svgText
}

// 串行队列：单一 WASM 实例不支持并发渲染
let renderChain = Promise.resolve()

export async function renderDiagram(lang, code) {
  const run = () => {
    if (lang === 'd2') return renderD2(code)
    if (lang === 'gnuplot') return renderGnuplot(code)
    return Promise.reject(new Error('不支持的图表语言：' + lang))
  }
  const result = renderChain.then(run, run)
  renderChain = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}
