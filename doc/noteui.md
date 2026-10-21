# NoteUI 集成与语法

当前提供 28 类组件；新增序列、状态回放、概率分布、函数探索、维恩图、矩阵、数轴和几何控件，以及笔记内可搜索、预览、插入的组件库，详见 [完整工具箱](noteui-toolkit.md)。下文保留原有 20 类组件的兼容语法。

## 集成分析

- 技术栈：React 18 + TypeScript + Vite；Express（ESM）提供文件 CRUD、AI 调用及 SSE；笔记仍是 vault 中的 `.md` 文件。
- 编辑：`EditorPane` 分离 frontmatter 与正文；正文编辑经 `App.handleEdit` 合并 frontmatter，沿用已有防抖保存、文件冲突和 SSE 同步。默认 Milkdown Crepe，IDE 已有 Monaco 源码编辑和分屏/浮动预览。
- 渲染：Milkdown 使用 remark/ProseMirror 解析编辑文档；聊天、答疑及 PDF 卡片通过 `RichText → md.ts → marked → DOMPurify`。已有 KaTeX、Mermaid/beautiful-mermaid、d2/gnuplot 服务端渲染、图片代理、引用角标、wikilink 和 callout。Milkdown 的自定义代码节点以普通代码块兜底，没有为 NoteUI 添加新的代码高亮引擎。
- 主题：复用 `tokens.css` 的 panel/text/border/accent 等变量；IDE 作用域变量继续生效。新样式集中在 `noteui.css`。
- AI：API 走 runner 管理/子角色工具调用；写作角色通过 `write_note` 原样写文件；ZCode 有独立 prompt。教师和答疑通过各自 prompt 生成回复。SSE 更新已有笔记内容，无须改变存储、历史或会话协议。

## 实现数据流

原始 Markdown → marked 块 token → 独立 NoteUI 注释 → 注册表参数白名单/数据校验 → 内部占位 → 原有完整 Markdown 消毒链路 → React NoteUI 组件。

`src/noteui/parser.ts` 的 `definitions` 统一管理参数和数据解析；`NoteUIBlock.tsx` 的 `componentRegistry` 统一管理渲染器，学习组件位于 `LearningComponents.tsx`，两者以 `ComponentName/DataByName` 映射进行类型检查。新增组件需扩展类型和两个映射，不再增加独立文档解析流程。Markdown 使用独立 Marked 实例，避免其他库对全局配置的修改影响阅读器。

识别基于 marked token，字符串替换只按 AST 确定的源区间进行。占位使用每次渲染的随机 ID，原始文档不能指定组件实例。未知组件、未知/重复参数、缺列、非法数字或尺寸超限全部留作普通 Markdown。组件运行异常由局部 Error Boundary 回退，源数据保留 CRLF，不回写渲染结果。

仅识别**顶层独立注释**，不激活围栏、行内代码、引用和列表内部的指令。指令只绑定紧接着的完整块，中间只能有空行。未闭合注释不激活；显式流式模式下，末尾数据块在空行/下一个块出现或生成结束前保持普通 Markdown。当前单组件最多 500 行、16 列；chart 最多 6 序列、pie 最多 24 项；steps 最多 100 步；graph 最多 60 节点/120 边；单文档最多激活 100 组件。超限不截断原文。

## 使用语法

格式统一为 `<!-- ui:component key=value -->`。参数值有空格时加单/双引号（值内不支持转义引号），未知参数使整个指令回退。所有组件支持可选 `title="标题"`。

| 指令 | 后续数据 | 参数与行为 |
|---|---|---|
| `<!-- ui:chart type=line x=time y=value -->` | Markdown 表格 | type=line/bar/pie/scatter，默认 bar；x/y 必填且精确匹配表头；多序列 `y=训练,验证`；scatter 的 x 也必须数值；pie 只支持单序列非负数且总和大于零 |
| `<!-- ui:stats -->` | Markdown 表格 | 每行一个指标，首列名称、次列值，额外列显示说明；展示原值，不自动求均值 |
| `<!-- ui:compare layout=auto -->` | Markdown 表格 | 每行一个方案；layout=auto/table/cards；自动布局按组件容器宽度切换，手动可选表格或卡片 |
| `<!-- ui:steps mode=timeline -->` | 有序列表 | mode=steps/timeline；首段标题，后续缩进段落为可展开解释 |
| `<!-- ui:quiz answer=B -->` | 题干段落 + 无序选项列表 + 可选解析引用 | 2–8 个唯一 A–H 选项，写为 `- A. 文本`；多选用 `type=multi answer=A,C`，必须选全且不多选；解析在提交后出现；可重试 |
| `<!-- ui:graph from=source to=target -->` | Markdown 表格 | from/to 默认 source/target；自动生成受控 Mermaid flowchart，复用 beautiful-mermaid 渲染和主题 |
| `<!-- ui:concept -->` | 术语 / 定义 / 例子等表格 | 可搜索的概念词典，保留额外说明列 |
| `<!-- ui:flashcards -->` | 问题 / 答案 / 补充等表格 | 回忆后揭晓、自评、前后切换；左右方向键导航 |
| `<!-- ui:accordion -->` | 普通列表 | 折叠问答、提示和解释；支持嵌套与展开全部 |
| `<!-- ui:tree -->` | 嵌套列表 | 可展开知识层级，限制为最多 8 层嵌套 / 200 节点 |
| `<!-- ui:derivation -->` | 步骤 / 公式 / 理由等表格 | 下一步、展开全部、重新推导；沿用 KaTeX |
| `<!-- ui:code -->` | 完整代码围栏 + 行号 / 讲解两列表格 | AI须覆盖每个非空行，行号包含空行、注释；旧内容缺讲解时静态显示，不提供空的点选反馈；最多 500 行 / 50000 字符，不执行代码 |
| `<!-- ui:checklist -->` | GFM 任务列表 | 从原文 `[x]` 初始化，交互勾选、完成进度、恢复原始状态；不接受嵌套任务 |
| `<!-- ui:table -->` | 普通表格 | 全文筛选、数值/文本排序、每页 20 行 |
| `<!-- ui:tabs -->` | 分组 / 内容等表格 | 每行一个标签页，左右方向键及 Home/End 导航 |
| `<!-- ui:cloze -->` | 普通列表 | 每项一个段落，唯一的行内代码片段为答案；精确检查、重置 |
| `<!-- ui:match -->` | 恰好两列表格 | 2–12 对，两个列内各自唯一；随机排列候选项、检查配对、重试 |
| `<!-- ui:rubric -->` | 维度 / 满分 / 达标描述等表格 | 满分 1–100 的整数；键盘可调自评与总分，未评与 0 分区分 |
| `<!-- ui:progress -->` | 项目 / 已完成 / 总量表格 | 展示原始进度，要求总量大于零且完成量不越界，不自动推断掌握度 |
| `<!-- ui:schedule -->` | 日期 / 任务 / 说明等表格 | 真实 YYYY-MM-DD 日期；自动排序、按月份筛选、任务勾选；不创建提醒 |

## 按学习场景选型

| 场景 | 可选组件 | 使用重点 |
|---|---|---|
| 预习与建立框架 | tree、concept、accordion | 知识层级、术语与常见疑问 |
| 理解与辨析 | compare、tabs、graph | 不同概念、不同视角与概念关系 |
| 数学和逻辑推理 | derivation、steps、chart | 分步理由、条件、数据证据 |
| 编程与算法 | code、steps、table | 代码导读、算法步骤、测试/实验记录；执行用已有 IDE |
| 语言与事实记忆 | flashcards、cloze、match | 先回忆后揭晓，避免只反复阅读 |
| 自测与纠错 | quiz、table、accordion | 单选/多选/两选判断、错题复盘、分层提示 |
| 阅读与研究 | table、tabs、concept | 文献比较、资料链接、案例、术语检索 |
| 实验与项目 | checklist、stats、chart | 步骤检查、指标与结果分析 |
| 复习计划与反思 | schedule、progress、rubric | 日期任务、有依据的进度、按证据自评 |

这组组件覆盖常见学习闭环；专业实验模拟、绘图、音频口语等需要专用能力，不由注释执行任意代码。组合现有组件即可表达更多场景，避免为每种课程创建重复控件。

图表数值接受有限十进制/科学计数法、规范千位逗号和百分比；百分比按显示数值绘制（`87%` 为 87），不会自动猜测单位或将 0.87 转为 87。不要在同一序列混用单位。空值、NaN、Infinity、不规范数字全部回退。

```markdown
<!-- ui:chart type=bar x=年份 y=数量 title="年度记录" -->

| 年份 | 数量 |
|---|---:|
| 2024 | 126 |
| 2025 | 273 |

<!-- ui:steps mode=steps -->

1. 读取数据

    检查来源与字段是否完整。

2. 验证结论

    对照原始 Markdown 表格复核。

<!-- ui:quiz answer=B -->

NoteUI 的可信数据源是什么？

- A. 渲染器生成的 HTML
- B. 原始 Markdown

> 原始 Markdown 保留指令、表格和解释，渲染器只负责呈现。
```

## 编辑与交互

主笔记面板默认以「阅读」打开，切换笔记后也回到阅读；可主动切换「编辑/源码」。含 NoteUI 注释的文档用现有 Monaco 编辑原始正文，避免富文本序列化丢失注释；无 NoteUI 的笔记保持 Milkdown 编辑。IDE 分屏/浮动预览、资料预览和 PDF 卡片通过原有 Milkdown 包装器自动接入。聊天和答疑统一复用 RichText。

阅读器支持 `$...$`、`$$...$$`、`\(...\)`、`\[...\]` 及 latex/tex/math 围栏；支持跨一个换行的行内公式、原生 details/summary 题干中的公式。公式中的裸 `|` 与 `\|` 在分表格之前临时保护，再恢复原始TeX，不改源文或范数语义。双链支持 `[[目标|显示名]]` 及旧编辑器留下的 `\[\[目标]]`；全角 `｜` 仍是文件名的一部分，代码示例不转成链接。

每个组件提供原始 Markdown 折叠区。图例按钮、对比切换、steps 的 details、测验单选与提交均可键盘访问；图表点支持 Tab 聚焦和左右方向键，Esc 清除提示。交互状态存于组件本地，不触发文件保存或 AI 调用；追加无关正文时保留已有组件状态，修改数据后重置。大列表默认显示前 6 项；图表保留全部数据。减少动画偏好遵循系统设置。

测验答案保存在 Markdown 中，可直接查看源码，仅适用于个人复习；不保存跨刷新答题记录。

闪卡、填空、配对、量规、清单与日程的交互均只保留在当前阅读会话。它们不写回文档、不自动改知识图谱、不调用 AI 评分，也不创建系统提醒。编辑原始 Markdown 可保存清单、日程和进度的初始数据。填空每项只能有一个行内代码答案，比较时执行 NFKC 规范化、忽略大小写、首尾空白与连续空白；不进行语义推断或同义词评分。

## AI 集成

NoteUI 默认启用：结构化学习内容优先选择合适组件，普通讲解仍写 Markdown；短答无需强行添加组件，用户指定格式优先。无需每次在输入中强调 NoteUI。

生成规则要求已有的对比、定义、步骤、练习等结构带对应指令，并提供对比/测验的完整示例；组件名和参数名固定英文，不得把 `answer` 翻译为「答案」。已有笔记没有指令时保持原文，不自动补写或迁移。

算法题讲解同样默认启用：解题流程用 `steps`、证明用 `derivation`、代码导读用 `code`、走查用 `table`、练习用 `quiz`，按内容选择，不要求每题堆满组件。输入题目截图也走同一提示词，不新增视觉预处理或格式修复的模型请求。图片链路说明见 [全局对话图片](global-images.md)。真实截图生成样本见 [算法讲解](noteui-algorithm-generated.md)。

`server/agent/noteuiPrompt.js` 提供紧凑的共享语法，注入 API 主助手、content/visualize/scaffold 角色、ZCode 主流程、教学和笔记答疑；resource 角色使用资源表格所需的最小语法。寒暄分支仅简短回应，不携带组件说明。

主助手取消额外的模型分类调用，常规写作可以直接保存，不再固定串联研究/写作/配图/润色。工具定义按角色发送，`ask_user` 交互与笔记源文件格式保持兼容。完整优化说明和可复现测量见 [AI 上下文与调用优化](ai-efficiency.md)。

## 示例与验证

打开演示库的 `笔记/NoteUI/note/NoteUI交互示例.md`，可检查 6 类组件、4 类图表、错误回退、Mermaid、公式、代码与正文混排。自定义 vault 用户可直接复制该文件，无须迁移已有笔记。

`笔记/NoteUI/note/NoteUI学习全场景示例.md` 包含全部 20 类组件，串联「理解线性回归 → 推导与代码 → 主动回忆与练习 → 实验分析 → 计划、自评与反思」。这是一份组件验收样本，真实笔记通常只选 2–4 种合适的组件，不应照样堆满全部类型。

执行 `npm run test:noteui` 做自动解析回归，`npm run build` 构建。浏览器内验证说明见 `doc/noteui-verification.md`。

后续可扩展：图表导出 SVG、可访问的数据点导航优化、跨刷新练习进度、列表嵌套指令支持、显式单位与缺失值策略、Milkdown 原生 NoteUI NodeView（保留原文后再启用富文本编辑）。
