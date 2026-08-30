// 修复 tutor 会话历史：剔除 tool/system 消息与空内容（临时脚本）
import fs from 'node:fs'
import path from 'node:path'
import { resolveInVault } from '../server/vault.js'

const vault = process.argv[2]
if (!vault) {
  console.error('用法: node scripts/fix-tutor-sessions.mjs <vaultPath>')
  process.exit(1)
}
const dir = path.join(path.dirname(resolveInVault('.agent/tutor/x')))
if (!fs.existsSync(dir)) {
  console.log('无 tutor 会话目录')
  process.exit(0)
}
let fixed = 0
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.json')) continue
  const full = path.join(dir, f)
  try {
    const msgs = JSON.parse(fs.readFileSync(full, 'utf8'))
    if (!Array.isArray(msgs)) continue
    const clean = msgs.filter(
      (m) =>
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim().length > 0,
    )
    if (clean.length !== msgs.length) {
      fs.writeFileSync(full, JSON.stringify(clean, null, 1), 'utf8')
      console.log(`修复 ${f}: ${msgs.length} → ${clean.length} 条`)
      fixed++
    }
  } catch (e) {
    console.error(`跳过 ${f}:`, e.message)
  }
}
console.log(fixed ? `共修复 ${fixed} 个会话文件` : '所有会话均已干净')
