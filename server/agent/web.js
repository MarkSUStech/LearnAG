// 免费网页检索：Bing 搜索（国内可达，免 Key）+ 网页正文抓取
// 兜底链：www.bing.com → cn.bing.com → html.duckduckgo.com（海外可达时）

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x(\w+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

async function fetchText(url, timeoutMs = 15000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6' },
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

// ── 搜索：Bing 为主 ─────────────────────────────────────────────────────────

function parseBing(html) {
  const results = []
  // 结果块：<li class="b_algo"> ... <h2><a href="URL">标题</a></h2> ... 摘要 <p ...>
  const re = /<li class="b_algo"[\s\S]*?<h2[^>]*><a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>([\s\S]*?)(?=<li class="b_algo"|<\/ol|$)/g
  let m
  while ((m = re.exec(html)) && results.length < 12) {
    const title = stripTags(m[2])
    if (!title) continue
    // 摘要：块内第一个 <p>
    const pMatch = m[3].match(/<p[^>]*>([\s\S]*?)<\/p>/)
    results.push({ title, url: m[1], snippet: pMatch ? stripTags(pMatch[1]).slice(0, 300) : '' })
  }
  return results
}

function parseDdgHtml(html) {
  const results = []
  const re =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g
  let m
  while ((m = re.exec(html)) && results.length < 12) {
    const title = stripTags(m[2])
    if (!title) continue
    let url = m[1]
    try {
      const u = url.startsWith('//') ? 'https:' + url : url
      const parsed = new URL(u, 'https://duckduckgo.com')
      const uddg = parsed.searchParams.get('uddg')
      url = uddg ? decodeURIComponent(uddg) : u
    } catch {
      /* keep */
    }
    results.push({ title, url, snippet: stripTags(m[3] || '') })
  }
  return results
}

export async function webSearch(query, maxResults = 8) {
  const q = encodeURIComponent(query)
  // 有代理/海外环境走 DDG（质量最好）；不通时自动落 Bing（国内可达）
  const endpoints = [
    { url: `https://html.duckduckgo.com/html/?q=${q}`, parse: parseDdgHtml, via: 'duckduckgo' },
    { url: `https://lite.duckduckgo.com/lite/?q=${q}`, parse: parseDdgLite, via: 'duckduckgo-lite' },
    { url: `https://www.bing.com/search?q=${q}&format=rss&count=15`, parse: parseBingRss, via: 'bing-rss' },
    { url: `https://www.bing.com/search?q=${q}&count=15&setlang=zh-hans`, parse: parseBing, via: 'bing' },
    { url: `https://cn.bing.com/search?q=${q}&count=15`, parse: parseBing, via: 'bing-cn' },
  ]
  let lastErr = ''
  for (const ep of endpoints) {
    try {
      const results = ep.parse(await fetchText(ep.url)).slice(0, Math.max(1, Math.min(maxResults, 10)))
      if (results.length > 0) return { via: ep.via, results }
      lastErr = `${ep.via}: 无结果`
    } catch (e) {
      lastErr = `${ep.via}: ${e.message}`
    }
  }
  throw new Error('搜索失败（' + lastErr + '）。可稍后重试或更换关键词')
}

function parseBingRss(xml) {
  const results = []
  const re = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?(?:<description>([\s\S]*?)<\/description>)?/g
  let m
  while ((m = re.exec(xml)) && results.length < 12) {
    const title = decodeEntities(m[1].replace(/<!\[CDATA\[|\]\]>/g, '')).trim()
    if (!title) continue
    const url = m[2].replace(/<!\[CDATA\[|\]\]>/g, '').trim()
    const snippet = stripTags(decodeEntities((m[3] || '').replace(/<!\[CDATA\[|\]\]>/g, '')))
    results.push({ title, url, snippet })
  }
  return results
}

function parseDdgLite(html) {
  // lite 版：<a href="http...">标题</a>（排除 DDG 自身链接）
  const results = []
  const re = /<a[^>]*href="(http[^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  const skip = /duckduckgo\.com/
  let m
  while ((m = re.exec(html)) && results.length < 12) {
    if (skip.test(m[1])) continue
    const title = stripTags(m[2])
    if (!title || title.length < 4) continue
    results.push({ title, url: m[1], snippet: '' })
  }
  return results
}

// ── 网页抓取 ────────────────────────────────────────────────────────────────

function extractHtmlBody(html) {
  const s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities(s)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

export async function webFetch(url, mode = 'auto') {
  if (!/^https?:\/\//i.test(url)) throw new Error('仅支持 http(s) 链接')

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6' },
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const ctype = res.headers.get('content-type') || ''
    const body = await res.text()
    if (ctype.includes('html')) {
      const content = extractHtmlBody(body)
      // 正文过短（SPA/反爬页面）→ 尝试 jina reader 转出干净 markdown
      if (content.length < 400) {
        const md = await fetchText('https://r.jina.ai/' + url, 25000).catch(() => '')
        if (md && md.trim().length > 400) return { via: 'jina-reader-fallback', url, content: md.slice(0, 50000) }
      }
      return { via: 'direct', url, content: content.slice(0, 50000) }
    }
    return { via: 'direct-text', url, content: body.slice(0, 50000) }
  } finally {
    clearTimeout(timer)
  }
}
