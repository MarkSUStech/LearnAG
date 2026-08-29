// 学术论文检索：arXiv API + Semantic Scholar API（均免费免 Key），支持开放获取 PDF 下载
import * as vault from '../vault.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'

async function fetchText(url, timeoutMs = 20000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

// ── arXiv（Atom XML） ───────────────────────────────────────────────────────

function parseArxiv(xml) {
  const results = []
  const re = /<entry>([\s\S]*?)<\/entry>/g
  let m
  while ((m = re.exec(xml))) {
    const block = m[1]
    const title = stripTags(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '')
    const summary = stripTags(block.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? '').slice(0, 600)
    const id = block.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() ?? ''
    const pdf = block.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/)?.[1]
    const authors = [...block.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((a) => a[1].trim()).slice(0, 4)
    const year = block.match(/<published>(\d{4})/)?.[1] ?? ''
    if (!title) continue
    results.push({
      title,
      authors,
      year,
      venue: 'arXiv',
      abstract: summary,
      url: id,
      pdfUrl: pdf ?? (id.includes('arxiv.org') ? id.replace('/abs/', '/pdf/') : undefined),
      source: 'arxiv',
    })
  }
  return results
}

// ── Semantic Scholar（JSON，未认证限流较严，失败跳过） ──────────────────────

async function searchSemanticScholar(query, maxResults) {
  const url =
    `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}` +
    `&limit=${Math.min(maxResults, 10)}&fields=title,abstract,year,venue,authors,openAccessPdf,externalIds`
  const raw = await fetchText(url)
  const json = JSON.parse(raw)
  const papers = json.data ?? []
  return papers
    .filter((p) => p.title)
    .map((p) => ({
      title: p.title,
      authors: (p.authors ?? []).map((a) => a.name).slice(0, 4),
      year: p.year ?? '',
      venue: p.venue ?? '',
      abstract: (p.abstract ?? '').slice(0, 600),
      url: p.url ?? `https://www.semanticscholar.org/paper/${p.paperId}`,
      pdfUrl: p.openAccessPdf?.url,
      source: 'semantic-scholar',
    }))
}

// ── 聚合 ────────────────────────────────────────────────────────────────────

function normTitle(t) {
  return t.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '').slice(0, 60)
}

export async function searchPapers(query, maxResults = 8) {
  const merged = []
  const seen = new Set()
  const push = (r) => {
    const key = normTitle(r.title)
    if (!key || seen.has(key)) return
    seen.add(key)
    merged.push(r)
  }

  try {
    const xml = await fetchText(
      `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${Math.min(maxResults, 10)}&sortBy=relevance`,
    )
    parseArxiv(xml).forEach(push)
  } catch {
    /* arXiv 失败继续 */
  }

  try {
    ;(await searchSemanticScholar(query, maxResults)).forEach(push)
  } catch {
    /* S2 限流/失败继续 */
  }

  if (merged.length === 0) throw new Error('论文检索无结果（arXiv 与 Semantic Scholar 均不可用或无匹配），可换英文关键词重试')
  return { results: merged.slice(0, Math.max(1, Math.min(maxResults, 12))) }
}

// ── 论文 PDF 下载进资料库 ───────────────────────────────────────────────────

export async function downloadPaperPdf(url, topic, filename) {
  if (!/^https?:\/\//i.test(url)) throw new Error('仅支持 http(s) 链接')
  let res
  let lastErr = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 60000)
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal })
      clearTimeout(timer)
      break
    } catch (e) {
      clearTimeout(timer)
      lastErr = e.message ?? String(e)
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500))
    }
  }
  if (!res) throw new Error('下载失败：' + lastErr)
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > 30 * 1024 * 1024) throw new Error('文件超过 30MB，跳过下载')
  if (buf.subarray(0, 5).toString() !== '%PDF-') throw new Error('该链接不是 PDF 文件')
  const safeName = (filename || 'paper')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.pdf$/i, '')
    .slice(0, 100)
  const seq = String(Date.now() % 100).padStart(2, '0')
  const rel = `笔记/${topic}/reference/papers/${seq}-${safeName}.pdf`
  vault.writeFile(rel, buf)
  return { path: rel, bytes: buf.length }
}
