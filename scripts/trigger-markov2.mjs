// 触发马尔可夫笔记图表补足（临时脚本）
(async () => {
  const res = await fetch('http://127.0.0.1:3001/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message:
        '重写 笔记/概率论/note/马尔可夫链与马尔可夫性质.md：按笔记范式补足 Mermaid 图表（至少 2 张：一张状态转移图、一张结构/流程图），内容保持完整并沉淀到图谱',
      mode: '教学',
    }),
  })
  console.log(res.status, await res.text())
})()
