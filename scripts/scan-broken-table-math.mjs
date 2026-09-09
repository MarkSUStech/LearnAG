// 临时脚本：扫描库内表格行中 $ 计数为奇数（公式被表格切开）的损坏行
import fs from 'node:fs'
import path from 'node:path'

const vault = 'C:/Users/mark0/Documents/Obsidian Vault'
const hits = []

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.toLowerCase().endsWith('.md')) {
      const lines = fs.readFileSync(p, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (!line.trimStart().startsWith('|')) return
        const cells = line.split('|').slice(1, -1).map((c) => c.trim())
        const broken = cells.some((c) => c.startsWith('\\$') || c.endsWith('\\$'))
        const unescaped = line.replace(/\\\$/g, '')
        const odd = ((unescaped.match(/\$/g) || []).length % 2 === 1)
        const escAny = line.includes('\\$') // 任何转义美元（人工核对是否为公式碎片）
        if (broken || odd || escAny) hits.push({ file: path.relative(vault, p), line: i + 1, text: line.trim().slice(0, 120) })
      })
    }
  }
}
walk(vault)
console.log(hits.length ? hits.map((h) => `${h.file}:${h.line}\n  ${h.text}`).join('\n') : 'no hits')
