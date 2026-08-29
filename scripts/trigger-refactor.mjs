// 触发图谱重构任务（临时脚本，UTF-8 安全）
(async () => {
  const res = await fetch('http://127.0.0.1:3001/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message:
        '对现有知识图谱做一次全面重构（维护任务）：' +
        '1) 把 知识图谱/ 目录下的所有旧笔记用 rename_note 迁入 笔记/<领域>/<子主题>/note/（领域用图谱节点的 field 字段，子主题根据笔记内容判断，保持同领域同目录）；' +
        '2) 同步用 update_graph 更新所有节点的 note 路径；' +
        '3) 按「知识图谱粒度设计规范」的三条件审查每个节点：过细的合并或降级为该节点的 weakPoints 属性，过粗的拆分；' +
        '4) 从 Agent/工作台.md 的测评记录提炼，为 learning/mastered 节点补充 weakPoints；' +
        '5) 完成后把重构报告（移动清单+粒度调整清单+遗留问题）写入 Agent/工作台.md',
      mode: '教学',
    }),
  })
  console.log(res.status, await res.text())
})()
