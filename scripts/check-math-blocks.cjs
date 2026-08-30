// 检查笔记中的数学块情况（临时脚本）
const fs = require('fs')
const path = require('path')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (e.name.endsWith('.md')) out.push(full)
  }
  return out
}

const vault = 'C:/Users/mark0/Documents/note-agent-vault'
const files = walk(vault)
const looksLikeMath = (code) => !new RegExp('(^|\\n)\\s*#|->|"').test(code)

for (const f of files) {
  const c = fs.readFileSync(f, 'utf8')
  const blocks = c.match(/\$\$[\s\S]*?\$\$/g) || []
  if (blocks.length === 0) continue
  const bad = blocks.filter((b) => !looksLikeMath(b.slice(2, -2)))
  console.log(path.basename(f), '| $$块:', blocks.length, '| 非数学:', bad.length)
  if (bad.length) console.log('  非数学示例:', bad[0].slice(0, 120).replace(/\n/g, ' | '))
}
