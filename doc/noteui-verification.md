# NoteUI 验证与交付记录

既有验证日期：2026-10-19；以下历史记录保留当时的组件数与验证结果。

## 可组合系统交付复核（2026-10-21）

复核源码为 `fe43c4d`。对照共享Registry、正式组件库、渲染器、基础件及样式，确认28类原有组件、9类布局与1类受控SVG共38类；Gallery复用正式模板与渲染器。两份系统说明与实现一致，仅细化通用令牌作用域、Grid容器断点、SVG整数画布尺寸及Popover焦点返回条件。

- 自动回归102 / 102通过、0失败：[测试日志](../.impeccable/review/release-tests.log)。该提交的生产构建通过，用时1分2秒：[构建日志](../.impeccable/review/release-build.log)。
- 浏览器留档全部通过：组合 / SVG20项、旧学习组件30项、组件库8项，见 [系统](../.impeccable/review/system/browser-system.txt)、[旧组件](../.impeccable/review/system/browser-legacy.txt)、[组件库](../.impeccable/review/system/browser-catalog.txt)。交付执行者另观察到18项交互回归通过，未并入以上留档计数。
- 留存1440×900桌面组合、SVG及深色SVG截图，以及390×844手机SVG截图，位于 `.impeccable/review/system/`。最终 [审查记录](../.impeccable/review/system/finish-review.md) 结论为 `ship`，无要求修复的材料性问题。
- [类型检查日志](../.impeccable/review/system-types.log) 仍只有既存的 `lspBridge.ts:237`、`:320` 两处错误，无新增NoteUI类型错误；生产构建保留既存Mermaid / Monaco分块警告。

正式界面沿用紫色操作、系统字体及现有明暗主题；暖色预览专属的 `DESIGN.md` 和 `.impeccable/design.json` 保持原样。本次文档复核未改实现或重新运行模型调用；交互仍为阅读会话内状态，Markdown仍是笔记数据源。

## 已验证

- `npm run build` 成功，最近构建用时 49.46 秒（含全局图片输入）。
- `npm run test:noteui`：33 项自动测试全部通过。覆盖参数白名单、20 类组件、公式表格竖线、数字和日期校验、嵌套结构、完整代码围栏、流式回退、源码 CRLF 保留、Markdown 兼容性及共享 AI 提示词接入。
- 浏览器核心回归：37 项通过。覆盖 6 类原始组件、4 种图表、键盘导航、图例、源码查看、单选练习、数据与运行异常回退、流式呈现、公式、Mermaid 主题重绘、Monaco 源码编辑与预览同步、注入防护及 360/768/1100px 容器布局。
- 浏览器学习组件回归：30 项通过。覆盖全部 20 类组件混排、概念筛选、闪卡揭晓与自评、知识树展开、标签页键盘导航、推导逐步揭示、代码行解释、清单、数值排序、填空、配对、多选题严格判分、自评量规、日程筛选与勾选、进度、状态保留及主题。
- 实际 360px 浏览器视口检查无页面横向溢出，并直接填写、提交了填空题，得到 2/2 正确反馈。
- 继续复用现有组件与依赖；没有新增第三方依赖、正常生成链路的AI请求、存储格式或生产页面。

浏览器测试入口仅供开发验收：启动 Vite 后打开 `/scripts/noteui-browser.html`，分别运行「运行浏览器回归」和「运行学习组件回归」。该测试夹具不属于生产构建入口。

## 阅读宽度回归

修复 `src/components/md.ts` 对引用结束标签的全局替换：旧逻辑把普通 `</blockquote>` 也替换成 `</div>`，连续引用会错误嵌套后续正文，每次吞掉约80px阅读宽度。现通过 marked 的 `blockquote` 节点渲染分别闭合普通引用与 Obsidian callout，不修改笔记原文或用户行宽设置。

浏览器入口新增「引用与阅读宽度回归」，14项通过，覆盖连续八段引用、普通/嵌套引用、提示块边界、数学公式、360/768/1100px、亮暗主题和默认阅读。复现样本修复前各节宽度从804px逐级降到244px，末尾参考文献仅4px；修复后全部章节与末尾均为804px。

「公式与默认阅读回归」16项通过，覆盖截图中的分布变换/易错点表、裸竖线与范数、方括号/圆括号/跨行公式、latex围栏、旧HTML折叠题干、代码字面量、NoteUI源码、编辑及切换笔记。「双链兼容回归」10项通过，覆盖转义双链、别名/路径、全角文件名、表格、代码、键盘聚焦和注入防护。

## AI 使用状态

共享语法规则已默认接入 API 主助手、内容/可视化/脚手架角色、ZCode 主流程、教学和笔记答疑；资源角色使用精简的资源表格语法。后端进程若在修改前已启动，需要重启才能加载新提示词；前端刷新以使用最新构建。

可在写作模式输入：

> 帮我生成一篇梯度下降学习笔记，按内容选择 NoteUI，包含分步推导、代码导读、回忆闪卡和自测题。保留必要的普通文字，不要强行把所有内容组件化。

已调用当前配置的 `deepseek-v4-flash` 做短样本生成检查：补强英文参数和完整示例后，直接生成 compare 与 quiz 并通过实际解析器校验。样本见 [真实生成笔记](noteui-generated-sample.md)，usage与可选复验方法见 [AI 调用优化](ai-efficiency.md)。不合规指令仍安全回退原始Markdown，已有旧笔记不自动改写。

默认策略与调用优化另有 `npm run test:agent` 回归：真实 runner/tutor 配合模拟接口，覆盖请求次数、角色工具、NoteUI 原文保存、历史保留及推理字段回传；不访问付费模型。测量细节见 [AI 上下文与调用优化](ai-efficiency.md)。

## 全局图片与算法讲解回归

- 后端25项回归通过，包含全局图片实际请求体、路径持久化、最近4张图片限额、格式/大小/路径校验、子任务传图、提问附图、旧会话图片恢复、工具读图及错误提示。受限终端可用 `node scripts/test-agent-efficiency.mjs` 在同一进程执行。
- 浏览器图片25项检查通过：四种模式入口、粘贴/选择/拖放、多图、纯图片发送、移除、上传或发送失败保留草稿、重试复用上传结果、扩展名补齐、三种宽度、亮暗主题及工作台图片路径。入口 `/scripts/images-browser.html`，上传与发送均模拟，不触碰真实笔记库。
- 使用用户实际附带的 Pay to Swap 题目截图，通过真实 `runAgent` + 当前配置模型完成一次实测。在输入中没有要求 NoteUI；1次模型请求包含1张图片，识别到逆序对最小代价，样例 `[3,1,2]` 结果为3，自主生成 `steps` 和 `table`，实际解析器均识别成功。样本见 [模型生成的算法讲解](noteui-algorithm-generated.md)。这是链路样本，不替代对生成内容的人工审校，也不保证每次生成都遵循格式。
- 可选复验：`node scripts/check-global-images-live.mjs --run --image <图片绝对路径>`。临时笔记库隔离，不改用户会话/设置；最多3次请求、90秒上限，当前实测仅1次。未带 `--run` 不调用模型。
- 排查发现真实后端从2026-10-18晚间一直未重启，因此旧会话将图片标为普通文本附件，写作未加载新的NoteUI规则。已确认助手空闲后定向重启本项目后端，并验证新进程启动成功。

## 已知限制

- 全量 `tsc --noEmit` 仍报告原有 `src/components/ide/lspBridge.ts:237` 与 `:320` 两处类型错误；该模块未因 NoteUI 改动。NoteUI 新增代码没有类型错误，项目正式构建不受这两处基线错误影响。
- 构建仍提示现有 Mermaid 静态/动态导入混用与大包体积；本次没有开展无关的依赖拆分。
- 闪卡、自评、答题、清单和日程交互状态只保留在当前阅读会话，不跨刷新持久化、不自动回写笔记或知识图谱。
- 日程不创建系统提醒；代码导读不执行代码。需要运行代码时继续使用已有 IDE。
- NoteUI 指令只在顶层识别；组件数据可使用受支持的嵌套列表，但引用、代码示例、列表内部的指令不会被激活。

## 本次模块

| 模块 | 文件 |
|---|---|
| 指令、数据校验、注册类型 | `src/noteui/parser.ts` |
| 核心 6 类组件与渲染注册表 | `src/noteui/NoteUIBlock.tsx` |
| 新增 14 类学习组件 | `src/noteui/LearningComponents.tsx` |
| 统一样式与响应式 | `src/styles/noteui.css`、`src/styles/index.css` |
| Markdown 与阅读器集成 | `src/components/md.ts`、`RichText.tsx`、`EditorPane.tsx`、`editor/MilkdownEditor.tsx` |
| 流式会话呈现 | `src/components/TeacherChat.tsx`、`TutorPanel.tsx` |
| AI 规则 | `server/agent/noteuiPrompt.js`、`roles.js`、`runner.js`、`teacherPrompts.js`、`tutorPrompts.js` |
| 测试 | `scripts/test-noteui.mjs`、`scripts/noteui-browser.html`、`scripts/noteui-browser.tsx`、`package.json` |
| 文档与示例 | `README.md`、`doc/noteui.md`、本文件、演示库 `NoteUI交互示例.md` 与 `NoteUI学习全场景示例.md` |

后续优先方向：练习状态的显式持久化、遗忘曲线复习队列、错题回流、图表导出、专用学科实验与音频口语练习。扩展时继续保持原始 Markdown 为唯一笔记数据源。
