// 演示库二次迁移：三分区结构（note/plan/reference）+ 图谱路径更新（临时脚本）
import fs from 'node:fs'
import path from 'node:path'

const root = 'server/demo-vault'
const mv = (from, to) => {
  const a = path.join(root, from)
  const b = path.join(root, to)
  if (fs.existsSync(a)) {
    fs.mkdirSync(path.dirname(b), { recursive: true })
    fs.renameSync(a, b)
    console.log('moved', from, '→', to)
  }
}

mv('笔记/算法/基础/递归.md', '笔记/算法/基础/note/递归.md')
mv('笔记/编程/基础/函数与作用域.md', '笔记/编程/基础/note/函数与作用域.md')
mv('笔记/计算机网络/基础/HTTP基础.md', '笔记/计算机网络/基础/note/HTTP基础.md')
mv('笔记/编程/位运算/位运算基础.md', '笔记/编程/位运算/note/位运算基础.md')
mv('笔记/目标/部署HTTPS网站.md', '笔记/计算机网络/HTTPS部署/plan/部署HTTPS网站.md')

// 旧 资料/ 内容并入对应主题的 reference/
const mergeDir = (from, to) => {
  const a = path.join(root, from)
  const b = path.join(root, to)
  if (!fs.existsSync(a)) return
  fs.mkdirSync(b, { recursive: true })
  for (const entry of fs.readdirSync(a, { withFileTypes: true })) {
    const sa = path.join(a, entry.name)
    const sb = path.join(b, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(sb, { recursive: true })
      fs.readdirSync(sa).forEach((f) => fs.copyFileSync(path.join(sa, f), path.join(sb, f)))
    } else {
      fs.copyFileSync(sa, sb)
    }
    console.log('merged', from, '→', to)
  }
}

mergeDir('资料/HTTPS与TLS', '笔记/计算机网络/HTTPS部署/reference')
mergeDir('资料/数字逻辑', '笔记/数字逻辑/基础/reference')
mergeDir('资料/算法', '笔记/算法/动态规划/reference')

// 移除旧 资料/ 目录
fs.rmSync(path.join(root, '资料'), { recursive: true, force: true })
// 清空旧 目标 目录（计划已迁走）
try {
  fs.rmSync(path.join(root, '笔记/目标'), { recursive: true, force: true })
} catch {
  /* ignore */
}

// 图谱 note 路径更新
const gf = path.join(root, '知识图谱.json')
const g = JSON.parse(fs.readFileSync(gf, 'utf8'))
for (const n of g.nodes) {
  if (!n.note) continue
  n.note = n.note.replace('/基础/', '/基础/note/').replace('/位运算/', '/位运算/note/')
}
fs.writeFileSync(gf, JSON.stringify(g, null, 2) + '\n')
console.log('graph updated')
