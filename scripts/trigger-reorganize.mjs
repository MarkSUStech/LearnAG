// 触发概率论笔记重组任务（临时脚本，UTF-8 安全）
(async () => {
  const res = await fetch('http://127.0.0.1:3001/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message:
        '整理任务：把 笔记/概率论/ 下的笔记按「笔记拆分规范」重组。' +
        '1) 先 read_note 读 笔记/概率论/note/贝叶斯推断.md，按五条判断标准拆分为：贝叶斯推断｜总览（目录+wikilink，不写正文）+ 多篇实体笔记（如 贝叶斯公式与四项概念 / 最大后验估计MAP / MCMC采样原理 / 贝叶斯推断例题 等按实际内容定），实体笔记放在 笔记/概率论/note/ 下，互相 [[wikilink]] 链接；' +
        '2) 把 笔记/概率论/学情分析.md 和 知识地图.md 分别移入 plan/ 与 note/（用 rename_note），旧位置 资料/概率论/web/ 的资料移到 笔记/概率论/reference/web/；' +
        '3) 用 update_graph 同步贝叶斯推断节点的 note 路径（指向总览笔记）；' +
        '4) 完成后把整理清单写入 Agent/工作台.md。原笔记内容不要丢失，拆分时保留全部知识点。',
      mode: '教学',
    }),
  })
  console.log(res.status, await res.text())
})()
