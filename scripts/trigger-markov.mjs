// 触发「马尔可夫性质」知识笔记（临时脚本，验证图表密度）
(async () => {
  const res = await fetch('http://127.0.0.1:3001/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message:
        '请为「马尔可夫链与马尔可夫性质」写一篇符合范式的知识笔记（概率论（ML方向）路径的子知识点），按拆分规范放入 笔记/概率论/note/，并沉淀到知识图谱。我的目标与计划见状态板。',
      mode: '教学',
    }),
  })
  console.log(res.status, await res.text())
})()
