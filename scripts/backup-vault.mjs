// 备份用户 vault 的图谱与笔记（逐文件复制，绕开 cpSync 崩溃问题）
import fs from 'node:fs'
import path from 'node:path'

const vault = 'C:/Users/mark0/Documents/Obsidian Vault'
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupDir = `.learn-agent/backup-${ts}`
fs.mkdirSync(backupDir, { recursive: true })

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

fs.copyFileSync(`${vault}/知识图谱.json`, `${backupDir}/知识图谱.json`)
copyDir(`${vault}/知识图谱`, `${backupDir}/知识图谱`)
if (fs.existsSync(`${vault}/笔记`)) copyDir(`${vault}/笔记`, `${backupDir}/笔记`)
if (fs.existsSync(`${vault}/学习计划`)) copyDir(`${vault}/学习计划`, `${backupDir}/学习计划`)
if (fs.existsSync(`${vault}/Agent`)) copyDir(`${vault}/Agent`, `${backupDir}/Agent`)

console.log('备份完成:', backupDir)
console.log('内容:', fs.readdirSync(backupDir).join(', '))
console.log('备份文件数:', flattenCount(backupDir))

function flattenCount(dir) {
  let n = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += flattenCount(path.join(dir, e.name))
    else n++
  }
  return n
}
