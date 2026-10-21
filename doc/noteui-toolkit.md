# NoteUI 学习可视化工具箱

当前保留 28 类学习组件，并增加 9 类组合布局与受控 SVG，共 38 类。笔记右上角「可视化组件库」可搜索全部模板，直接体验真实控件，再添加到笔记末尾；随后编辑 Markdown 表格或列表即可。AI 全局对话、讲题、教学、笔记答疑和笔记写作共用同一套生成规则。新增语法、视觉 Token 和 Gallery 见 [设计系统说明](noteui-design-system.md)。

## 按需求选择

| 需求 | 组件 |
|---|---|
| 理解定义、建立框架、辨析概念 | concept、tree、graph、compare、tabs、accordion、steps |
| 公式推理、数据分析、实验指标 | derivation、chart、stats、table |
| 概率统计、函数、集合、区间、向量与几何 | distribution、plot、venn、numberline、geometry |
| 数组操作、算法走查、动态规划、代码导读 | sequence、playback、matrix、code |
| 主动回忆、语言词汇、检查掌握、错题复盘 | flashcards、cloze、match、quiz、accordion |
| 计划执行、项目清单、进度与反思 | schedule、checklist、progress、rubric |

组合这些原语可以表达更多课程内容。专业物理仿真、电路求解、三维模型、音频口语、自动判题等仍需要对应的专用能力，当前控件不冒充这些计算引擎。图示不能替代证明；AI 提供的状态和数据仍须核对。

## 新增 8 类控件

统一格式仍是 `<!-- ui:component 参数=值 -->`，空行后紧跟表格。所有类型支持 `title="标题"`。未知参数、超限、错误或不完整数据回退为普通 Markdown，不修改源文件。

| 指令 | 表格列顺序 | 交互与范围 |
|---|---|---|
| `ui:sequence mode=cancel pair=R,B` | 元素 / 说明 | 定向相邻相消，先高亮后移除；上一步、下一步、播放、进度与重置。最多 60 项；`mode=static` 为静态序列，`mode=sort` 为数值升序的稳定相邻插入交换。pair 仅 cancel 使用，默认 R,B |
| `ui:playback` | 步骤 / 逗号分隔状态 / 解释 / 可选高亮下标 | 自定义算法、栈队列、指针等状态回放。下标从 0 开始，逗号分隔；最多 100 帧，每帧 40 项。状态由表格给定，不执行代码、不验证算法 |
| `ui:distribution type=poisson` | 参数 / 值，或参数 / 值 / 最小 / 最大 / 步长 | `poisson` 参数 lambda∈[0,30]；`binomial` 参数 n∈[1,100] 的整数、p∈[0,1]；`normal` 参数 mu∈[−20,20]、sigma∈[0.1,10]。滑块、图中详细值、期望与方差；缺少的合法参数取内置默认值 |
| `ui:plot fn=quadratic` | 同上参数表 | `linear`: ax+b；`quadratic`: ax²+bx+c；`sine`: a·sin(bx+c)；`exponential`: a·exp(bx)。固定 x∈[−5,5]，可调系数，纵轴自动缩放。仅内置模型，不解析任意表达式 |
| `ui:venn sets=A,B,C` | 区域 / 标签 / 可选数量 | 2 或 3 个集合，点击区域、并集/共同交集/仅属一个筛选。区域如 A、A&B、A&B&C，表示**恰好属于这些集合且不属于其余集合**。每个区域最多一行，数量有限非负，合计只针对提供的互斥区域 |
| `ui:matrix` | 行名 / 列1 / 列2… | 最多 20 行、15 个数据列。纯数值支持热图；文字与公式保留原样。点击显示行列和值；宽表在组件内部滚动 |
| `ui:numberline` | 名称 / 左端点 / 右端点 / 可选开闭 | 有限端点，最多 20 区间；开闭为 `[]`、`[)`、`(]`、`()`，默认 []。实心包含、空心不包含；退化单点只接受 [] |
| `ui:geometry mode=polygon` | 点名 / x / y | points 散点、polygon 按行连接并闭合、vectors 从原点画向量。最多 40 点；多边形至少 3 点。等比例坐标保持角度与长度，聚焦点查看坐标 |

参数表的 5 列形式要求初始值位于范围内，并与步长对齐。未提供的参数默认值：lambda=7.5；n=20,p=0.5；mu=0,sigma=1；函数 a=1,b=0,c=0（sine/exponential 的 b=1）。函数 a/b/c 通常范围 [−10,10]，sine 的 b∈[0.1,5]、exponential 的 b∈[−2,2]。数字不附加单位或百分号，绝对值最多 10⁶。

泊松图显示至 λ+6√λ 附近，极小尾部未展示；正态图显示 μ±4σ，高度是密度而非点概率。二项图显示全部 0…n。坐标几何是给定点的图解，不自动求交点、做几何证明或约束求解。

## 可直接复制

```markdown
<!-- ui:sequence mode=cancel pair=R,B -->

|元素|说明|
|---|---|
|B|蓝珠|
|R|红珠|
|R|红珠|
|B|蓝珠|
|B|蓝珠|
|R|红珠|

<!-- ui:distribution type=poisson -->

|参数|值|最小|最大|步长|
|---|---:|---:|---:|---:|
|lambda|7.5|0|20|0.1|

<!-- ui:venn sets=A,B,C -->

|区域|标签|
|---|---|
|A|①|
|B|②|
|C|③|
|A&B|④|
|A&C|⑤|
|B&C|⑥|
|A&B&C|⑦|
```

完整的 13 个新实例在 `server/demo-vault/笔记/NoteUI/note/NoteUI可视化实验室.md`；原有 20 类组件见同目录 `NoteUI学习全场景示例.md`。任意资料库均可通过组件库直接插入，无须切换或迁移 vault。

## 模块与生成策略

- `src/noteui/parser.ts`：唯一 AST 识别与参数注册表。
- `interactiveModels.ts`：有界参数、分布数学、序列状态、所有新数据校验；没有 eval/Function 或源文执行。
- `InteractiveComponents.tsx`：8 类交互渲染器，统一主题、原生控制、局部状态和源文入口。
- `catalog.ts` / `ComponentCatalog.tsx`：28 份有效模板、搜索、按场景筛选、真实预览、追加原始 Markdown；从已有 EditorPane 打开，懒加载，不创建第二个编辑器。
- `server/agent/noteuiPrompt.js`：共享 1673 字符规则，默认选择合适控件；扩展 8 类后仍低于原有 1700 字符预算，无新增模型调用。

交互状态只在当前阅读会话内；原始数据保存仍沿用笔记保存。播放每秒一帧，仅用户主动启动，切换/关闭组件清理定时器。SVG 有语义名称，区域与点可聚焦，按钮和滑块可键盘操作，图表支持左右键，系统减少动画偏好继续生效。组件库支持 Escape、焦点循环与关闭后焦点归还。

## 验证与扩展

`npm run test:noteui` 覆盖解析、严格回退、流式内容、原文保留、所有 28 模板、分布概率质量与矩、排序稳定性和区域归属。开发页 `/scripts/noteui-browser.html` 提供「运行可视化实验回归」「运行组件库回归」及原有公式/学习组件交互回归。

后续按真实课程需求扩展模型，可优先加事件树/条件概率、可编辑多帧矩阵、更多有界分布、SVG 导出和明确 opt-in 的练习进度持久化。继续复用统一注册表和源 Markdown，不开放任意脚本或 CSS。
