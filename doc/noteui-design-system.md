# NoteUI 可组合设计系统

本次在现有 28 类学习组件上增加 **9 类布局 + 1 类受控 SVG**，共 38 类指令，保留原有 Markdown、保存和 AI 调用接口。已有笔记不需要迁移。修改前清单、分类及优先级见 [现状分析](noteui-system-audit.md)。

## 模块与注册信息

- `shared/noteuiRegistry.js`：唯一名称、分类、描述、参数类型 / 合法值 / 默认值 / 必填、插槽、交互状态和使用限制。纯数据模块，前后端共用，不依赖 React。
- `src/noteui/parser.ts`：继续使用 marked AST，参数 allowlist 直接取自 Registry。数据解析仍在原解析器及 `interactiveModels.ts`，SVG 校验在 `svgModel.ts`。
- `NoteUIBlock.tsx`、`LearningComponents.tsx`、`InteractiveComponents.tsx`：保留原渲染器；增加 `LayoutComponents.tsx`、`Drawing.tsx`。旧 `componentRegistry` 标签 / render API 保留。
- `primitives.tsx`：提取可复用的受控 Button、Input、Select、Slider、Checkbox、RadioGroup 和布局基础件。输入必须绑定更新函数。现有筛选、清单、参数实验已复用这些基础件；其余原生控件使用同一套状态样式。
- `noteuiPrompt.js`：从 Registry 自动生成全部组件语法，补充内容选择和组合规则。Manager、Tutor、Teacher、写作等角色继续共用它，没有添加 AI 请求或引入 OpenUI Lang。

## 视觉规范

`src/styles/noteui-system.css` 为新增组件提供语义别名，颜色仍由原有 `tokens.css` 和作用域主题决定。普通图表、表格、代码和说明采用文章式区块；实验、闪卡、测验等独立任务可保留轻边框面板。Card 是可选分组，不是默认外壳。

| 语义 | Token / 值 |
|---|---|
| 画布、表面、浅背景 | `--nui-canvas` → `--bg`；`--nui-surface` → `--panel`；`--nui-soft` → `--panel-2` |
| 正文、说明、边框 | `--nui-ink` → `--text`；`--nui-muted` → `--text-2`；`--nui-border` → `--border` |
| 操作、成功、提醒、错误 | `--nui-accent`、`--nui-success`、`--nui-warning`、`--nui-danger` 映射已有语义颜色 |
| 间距 | 4px 基础；Inner 8px、Group 16px、Section 24px |
| 圆角 | small 4px、medium 8px、large 12px |
| 字号 | 标题 16px、正文 14px、说明 / 代码 12px、数字 24px |
| 字体 | 沿用系统字体；代码使用 Cascadia Code / Consolas；数值使用等宽数字 |
| 动效 | 160ms，尊重 `prefers-reduced-motion`；滚动翻页在减少动画时直接定位 |
| 阴影 | 轻阴影仅用于弹出层；普通内容以间距分组 |

布局默认决定间距；AI 仅能选择 `inner/group/section`，不能输出像素、CSS 或事件。Row 自动换行，Grid 根据容器宽度折叠，Carousel 有滚动、按钮和方向键。Popover 支持 Escape、外部点击、关闭后焦点恢复，并避开滚动容器裁切。

## 组合语法

容器为 `row / col / box / grid / card / carousel / popover`。用独立的 `ui:cell` 分格、`ui:end` 结束；每个标记前后保留空行。`divider / spacer` 单独使用，不需要 end。

```markdown
<!-- ui:grid columns=2 -->

### 直觉

每次排除不可能的一半。

<!-- ui:cell -->

<!-- ui:steps -->

1. 检查有序性
2. 比较中点
3. 缩小范围

<!-- ui:end -->
```

每层最多 12 格，最多 4 层；单个组合最多 100 个指令节点、100000 字符。流式未闭合、错误参数、超限或空格子时，整个组合保留为普通 Markdown。注释在其他 Markdown 阅读器中隐藏，正文、列表和表格仍按原顺序可读。原始源码可随时展开和编辑；无关正文更新保留组件状态，修改组件数据会重新建立该组件状态。

## AI 可自定义的 SVG

`ui:svg` 接收五列表格：形状、位置、尺寸或终点、文字、颜色。支持 `rect / circle / ellipse / line / arrow / text / polygon / path`。尺寸为有限坐标；width 默认640，合法160–1200；height 默认360，合法120–900。颜色限于语义色和六个图表系列色，不能写任意 SVG、HTML、CSS、外链、事件或脚本。

```markdown
<!-- ui:svg width=400 height=160 title="节点连接" -->

|形状|位置|尺寸或终点|文字|颜色|
|---|---|---|---|---|
|rect|20,50|100,50|head|accent|
|rect|250,50|100,50|next|blue|
|arrow|120,75|242,75|指向后继|ink|
```

圆的尺寸为 r，椭圆为 rx,ry；线和箭头填终点坐标；text 尺寸为10–28字号，可省略；polygon 的位置列是逗号 / 分号分隔的坐标，尺寸留空。path 的位置列仅接受显式 `M/L/Q/C/Z` 命令及对应数量的有限坐标，最多32条命令，尺寸留空。每图最多80个图形。文字由 React 转义，不创建 foreignObject；使用 Unicode 标注，复杂公式写在相邻 Markdown 中。图形可聚焦并按 Enter / Space 查看标注。

这是可控绘图能力，不是自动排版器或物理仿真：AI 应检查坐标、避开重叠、缩短标签。知识关系用已有 graph / Mermaid，数学坐标优先 geometry；现成控件难以表达的指针、机制、空间示意再用 svg。

## 内容与交互修复

代码导读只为原文有讲解的行提供按钮，支持前后阅读与覆盖行数提示。AI 必须在围栏后紧接 `行号 | 讲解` 表，覆盖每个非空行；行号包含空行和注释，不接受行号范围，也不要在代码与讲解之间插入其他指令。旧笔记没有讲解时保留静态代码，不捏造解释。

sequence 对短元素保留珠子，旧内容的长标签改为可换行矩形，避免文字伸出圆形。整句指针操作应生成 steps / playback。图表悬停、筛选、参数计算、自测和回放仍在本地完成；它们不自动保存到知识图谱，也不触发模型调用。

## Gallery 与验证

开发入口：`http://127.0.0.1:3100/?gallery=noteui`。它复用笔记内「可视化组件库」，支持38类模板、参数 / 状态 / 限制说明、本地浅深主题、360 / 640px预览、受控基础件和组合学习示例。Gallery 只预览和复制源码；正式组件库继续通过现有编辑回调插入笔记。

验证命令：

```powershell
npm run test:noteui
npm run test:agent
npm run test:images
node --test scripts/test-workspace.mjs scripts/test-conversation.mjs
node node_modules/typescript/bin/tsc --noEmit
npm run build
```

浏览器集成测试沿用 `/scripts/noteui-browser.html`。覆盖旧学习组件、公式、流式与错误回退、嵌套布局、SVG选择、旁注焦点、横向键盘翻页、长标签及360 / 768 / 1100px容器。当前全项目类型检查仍有既存的 `lspBridge.ts` 两处类型错误；本次 NoteUI 无新增类型错误。生产包仍有既存 Monaco / Mermaid 大分块警告。

参考研究与源码链接见 [现状分析](noteui-system-audit.md)。本次未增加运行时依赖，未复制 Thesys 组件源码。
