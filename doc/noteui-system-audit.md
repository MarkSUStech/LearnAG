# NoteUI 组件系统升级：现状分析与改造记录

## 修改前检查（2026-10-21）

现有技术栈是 React 18 / TypeScript / Vite，样式为按业务域拆分的 CSS。`tokens.css` 提供全局明暗主题；IDE 另有作用域主题。原文用 Milkdown 编辑，阅读与 AI 对话复用 `RichText → md.ts → planNoteUI`。NoteUI 在 marked 顶层 AST 上识别 HTML 注释指令，经过 allowlist 与数据校验后替换成 React 插槽，保留原始 Markdown。代码、公式、Mermaid 与普通段落继续使用已有渲染链路。

28 类组件的参数校验在 `parser.ts`，渲染分布在 `NoteUIBlock.tsx`、`LearningComponents.tsx` 和 `InteractiveComponents.tsx`。`catalog.ts` 已有 28 个可插入模板，`ComponentCatalog.tsx` 已有搜索、分类、预览和插入；无需第二套 Gallery。交互用组件内 React 状态，不执行 AI 代码，也不调用 Agent。Manager / Tutor / Teacher / 子角色共用 `noteuiPrompt.js`，目前语法说明仍手工维护，存在漂移风险。

| 分类 | 组件 | 检查结论 / 改进优先级 |
|---|---|---|
| 保留功能 | chart、graph | 已有 Tooltip、键盘聚焦、图例与 Mermaid；统一外壳和主题 token |
| 保留功能 | distribution、plot、venn、matrix、numberline、geometry | 已有安全数值模型和本地状态，不增加表达式执行器 |
| 保留功能 | quiz、flashcards、cloze、match | 已有作答、自评与反馈；统一控件状态和层级 |
| 保留功能 | checklist、rubric、progress、schedule | 已有受控状态、合法范围及状态说明 |
| 优化视觉/API | stats、compare、concept、tabs、table | 多重卡片边框、标题/说明/操作间距分散；P1 内容优先的外壳与通用控件 |
| 优化视觉/API | steps、tree、accordion、derivation、playback | 保留结构和状态，统一排版节奏与可访问反馈 |
| 功能缺陷 | code | 无讲解的行也能点击，显示空讲解；AI 可遗漏讲解表；P0 修复交互和生成约束 |
| 功能缺陷 | sequence | 长文本塞入固定圆形导致垂直溢出；P0 长标签自动使用矩形单元，指针过程改 steps |
| 真正缺失 | row、col、box、grid、card、divider、spacer、carousel、popover | P1 补少量通用布局，支持有限嵌套、默认响应式，不接受任意 CSS / JS |
| 复用并提取 | Button、Input、Slider、Select、Checkbox、RadioGroup | 原来散落于组件的原生控件提取为内部受控基础件；不另造无动作的 AI 表单 |

完整参数、默认值、状态与限制由共享 Registry 提供；Gallery 展示相同数据。旧组件输入格式不变。只扩展 HTML 注释边界标记；普通 Markdown、原始内容编辑和流式回退继续沿用原链路。

## 参考研究

研究了 Thesys 的 [library.ts](https://github.com/thesysdev/open-intelligent-ui/blob/main/src/lib/library.ts)、[layout.tsx](https://github.com/thesysdev/open-intelligent-ui/blob/main/src/lib/components/layout.tsx)、[controls.tsx](https://github.com/thesysdev/open-intelligent-ui/blob/main/src/lib/components/controls.tsx)、[theme.css](https://github.com/thesysdev/open-intelligent-ui/blob/main/src/lib/components/theme.css)、[components.css](https://github.com/thesysdev/open-intelligent-ui/blob/main/src/lib/components/components.css) 和 [prompt-options.ts](https://github.com/thesysdev/open-intelligent-ui/blob/main/src/lib/prompt-options.ts)。借鉴分类注册、少量布局基础件、三级间距与本地状态更新的思路。实现仍基于本项目 AST、React 和 CSS，不引入 OpenUI Lang、其运行时或任意表达式求值。

升级后的文档、验证及限制见 [设计系统说明](noteui-design-system.md)。

## 交付对照（2026-10-21）

对照 `shared/noteuiRegistry.js`、正式组件库、渲染注册表、基础件与两份 NoteUI 样式，修改前28类均保留，新增9类布局及受控SVG，共38类。Registry已成为参数白名单、组件说明和AI语法的共同来源；开发Gallery复用正式模板、渲染和本地状态，正式插入仍调用原有笔记编辑回调。

正式界面继续使用 `tokens.css` 的紫色操作、系统字体与浅深主题；新增通用层以8 / 16 / 24px组织间距，文章默认无外壳，独立实验保留面板。根目录 `DESIGN.md` 与 `.impeccable/design.json` 明确属于暖色工作台预览，本轮保持原样，没有将预览身份推广到正式组件库。旧组件的局部字号、过渡和状态样式仍按其源码记录，不提升为新增通用层规则。

代码导读的无讲解行保持静态，长序列标签使用可换行矩形；有界组合、SVG白名单及键盘状态与设计说明一致。交付复核结论为 `ship`，无要求修复的材料性问题；测试、截图和既存类型检查限制见 [验证记录](noteui-verification.md)。
