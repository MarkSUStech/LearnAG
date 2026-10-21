# LearnAgent

基于 Markdown 编辑器的**学习 Agent 网页软件**：AI 私人教师直接把讲解、探索候选、学习路径、知识沉淀写成 Markdown 笔记，并实时维护一份可可视化的知识图谱。

![架构](https://img.shields.io/badge/React%2018-Milkdown%20Crepe-4f46e5) ![后端](https://img.shields.io/badge/Node-Express%20%2B%20SSE-10b981)

## 核心特性

- **NoteUI 智能可视化**：Markdown 注释驱动 20 类学习组件，包括图表、知识树、概念词典、闪卡、填空、配对、多选题、公式推导、代码导读、清单、日程与自评等；支持阅读/源码切换，普通 Markdown 保持兼容。参见 [语法与集成说明](doc/noteui.md)、[基础示例](server/demo-vault/笔记/NoteUI/note/NoteUI交互示例.md) 和 [全场景学习示例](server/demo-vault/笔记/NoteUI/note/NoteUI学习全场景示例.md)。

- **Markdown 编辑器**（Milkdown Crepe）：所见即所得，原生渲染 **LaTeX 公式**（KaTeX）与 **Mermaid 图表**，`[[wikilink]]` 点击跳转、frontmatter 徽章栏；可自定义字号/行宽/字体（设置 → 编辑器外观）
- **三种 agent 模式**（底部输入框旁切换，无独立聊天区——所有回答都落成笔记）：
  - **教学**（默认）：摸底测评（一道一问、L1~L4 递进）→ 学情分析 → 定制计划 → 逐步讲解 → 阶段验收
  - **探索**：读取知识图谱，筛选前置已掌握的前沿节点，外推一层给出 3~5 个候选
  - **目标**：从目标反向拆解，推演**最短 / 深度 / 广度**三条路径供选择
- **免费联网检索资料库**：给出方案前 agent 自动 `web_search`（DuckDuckGo，不通自动落 Bing）+ `web_fetch` 抓取 3~5 条资料，存入 `资料/<主题>/web/`；**用户把文件直接放进对应主题文件夹**即可（md/txt/代码/PDF），agent 用 `read_note` 读取（PDF 自动提取文本层，可按页）；资料预览器（侧栏 folder 图标）可浏览 md/PDF/图片/文本
- **统一笔记规范**：所有知识点笔记按 `笔记/<领域>/<子主题>/<标题>.md` 组织（三种 agent 形式一致）；目标路径上的知识点追加 `goal/path/stage/point-status` 标签；目标计划在 `笔记/目标/<目标名>.md`
- **目标与计划防遗忘**：`Agent/目标与计划.md` 状态板每轮注入 agent 上下文；输入框上方常驻「🎯 目标 · 阶段」计划芯片，点击打开
- **结构化提问卡片**：`ask_user` 工具驱动的可折叠卡片（单选/多选/判断/简答/上传文件，代码内容随卡展示）
- **多会话记忆**：会话列表创建/切换/重命名（双击）；旧消息自动滚动压缩成长期摘要；`Agent/记忆.md` 跨会话记忆锚点；问答留档 `Agent/工作台.md`
- **知识图谱页**（侧栏 `hub` 图标）：d3-force 力导向图，拖拽/缩放/悬停高亮邻居；绿=已掌握、琥珀=学习中、**灰=最外圈待探索**；点击节点打开笔记；自动刷新
- **实时同步**：agent 写笔记时编辑器流式呈现；文件/图谱变化经 SSE 推送
- **沉淀闭环**：掌握知识点 → 写笔记 → 更新 `知识图谱.json` → 自动外推一圈灰色前沿
- **兼容 Obsidian**：vault 就是普通文件夹，设置里可切换任意本地路径

## 快速开始

```bash
npm install
npm run dev        # 服务端 :3001 + 前端 :5173（浏览器访问 http://localhost:5173）
```

生产模式：

```bash
npm start          # 构建前端并由服务端托管，访问 http://127.0.0.1:3001
```

## 配置

左下角 **设置** 图标：

| 配置项 | 说明 |
|---|---|
| AI 引擎 | `API 服务`（OpenAI 兼容）或 `ZCode`（本机智能体） |
| 知识库路径 | 本地任意文件夹（兼容 Obsidian Vault），默认使用内置演示库 `server/demo-vault` |
| Base URL | 任意 OpenAI 兼容接口，默认 `https://api.deepseek.com` |
| API Key | 保存在本机 `.learn-agent/settings.json`，不会回传前端 |
| 模型 | 需支持 function calling（DeepSeek / GLM / OpenAI / Kimi / OpenRouter 免费模型等均可） |

### ZCode 引擎（本机智能体）

设置里把 AI 引擎切到 **ZCode** 后，学习任务不再调用外部 API，而是交给本机 ZCode CLI（桌面版内置内核）无头执行——凭据自动复用桌面版 ZCode 的登录（走你的账号额度），无需 API Key：

- ZCode 以知识库根目录为工作区，用自带文件工具直接读写笔记、联网查证、绘制 mermaid 图，最终回复落到 `Agent/工作台.md`
- 知识网络纪律以内置提示词注入：`知识图谱/*.md` 带规范 frontmatter 会被自动同步进 `知识图谱.json`（服务端监听，外部写入同样生效）
- **提问卡片与语义检索**：通过 MCP 桥接（`server/zcode-mcp.mjs`）提供 `ask_user` / `search_knowledge` 两个工具——出题测评、摸底提问走和 API 模式同一套提问卡片；首次启用时会把该桥接写入 ZCode 原生配置（`~/.zcode/cli/config.json` 的 `mcp.servers.learnagent`），桌面版 ZCode 中也会出现这两个工具，属正常现象。用户 6 分钟未作答则超时，ZCode 按最合理假设继续
- 跨请求记忆：通过 `--resume` 续接 ZCode 会话（映射存于 `.learn-agent/zcode-sessions.json`）
- 答疑、翻译、图表修复同步切换；CLI 缺失时自动回落 API 引擎
- 注意：CLI 随桌面版更新，路径可在设置中手动指定

## 知识图谱格式（知识图谱.json）

```json
{
  "version": 1,
  "updatedAt": "2026-08-28",
  "nodes": [
    { "id": "recursion", "title": "递归", "field": "算法", "mastery": 7,
      "status": "mastered", "note": "知识图谱/递归.md", "updatedAt": "2026-08-28" }
  ],
  "edges": [ { "from": "recursion", "to": "tree-dfs", "type": "leads-to" } ]
}
```

- `id`：英文小写 kebab-case；`title`：中文
- `status`：`mastered`（已掌握）/ `learning`（学习中）/ `learnable`（待探索前沿，图谱页显示为灰色）
- 边类型：`depends-on`（前置依赖，蓝）/ `leads-to`（进阶方向，绿）/ `relates-to`（横向关联，紫虚线）
- `mastery`：1~10（1-2 听说过 → 5-6 能解释会做题 → 9-10 能讲给别人听）

## 目录结构

```
learn-agent/
├─ server/            # Express 服务端（ESM，无构建）
│  ├─ index.js        # REST + SSE + 静态托管
│  ├─ vault.js        # 文件树/CRUD + chokidar 监听
│  ├─ graph.js        # 知识图谱.json 校验与补丁式更新
│  ├─ settings.js     # 配置持久化
│  ├─ agent/          # runner（流式工具循环）/ tools / prompt
│  └─ demo-vault/     # 内置演示知识库
└─ src/               # React + Vite 前端
   └─ components/     # Sidebar / EditorPane / GraphView / InputBar / SettingsDialog
```

## 安全说明

- 服务只绑定 `127.0.0.1`，所有文件操作限制在 vault 目录内
- Agent 的工具调用受服务端 schema 校验（非法节点/边会被拒绝）

## 进阶模块

- **NoteUI 组件设计系统**：保留28类学习组件，增加9类布局与受控 SVG 示意图。组件元数据由前后端共享，AI 可组合 Markdown、图表、练习和图解；Gallery 使用 `?gallery=noteui`，正式笔记内也可打开组件库。见 [组件清单](doc/noteui-system-audit.md) 与 [设计规范和语法](doc/noteui-design-system.md)。

- **全局对话图片**：底部输入栏所有模式支持选图、粘贴截图、拖入图片和纯图片发送。图片通过视觉消息传给当前模型，追问和子任务可继续读图；算法讲解默认使用合适的NoteUI组件。见 [使用说明](doc/global-images.md) 与 [真实截图生成的算法讲解](doc/noteui-algorithm-generated.md)。
- **PDF 学习器**：vault 内 PDF（资料/、reference/papers/、附件/）以学习器标签页打开——连续滚动阅读、荧光/下划线/波浪线/删除线标注、遮挡自测、页面贴图、四用途卡片笔记（Milkdown 编辑）、标签系统、书签大纲精确跳转；**无书签的 PDF 可 AI 生成大纲**（大纲栏「AI 生成大纲」→ 填目录页码范围，LLM 解析目录并自动校准正文页码偏移，支撑章节跳转与答疑的按章节读取）；标注存 `vault/.agent/pdf-study/`，与 Obsidian 完全兼容（PDF 文件零修改）
- **选区翻译 & AI 重写**：划选 PDF 文字一键翻译成卡片；mermaid 图渲染失败时自动/手动（AI 重写按钮）让 AI 只修坏掉的那一段代码块
- **本地 RAG 检索**：transformers.js(ONNX) 本地 embedding（默认 jina-embeddings-v2-base-zh 中英双语，可在设置切换 bge-m3 等），纯文件向量库零原生依赖；索引覆盖全部笔记 + PDF 文本 + 学习器标注/卡片，主 agent 与笔记答疑助手共享 `search_knowledge` 工具
- **写笔记 agent**：指定笔记 / PDF（含你的标注与卡片，支持按章节/页码限定范围）撰写笔记，未指定范围时经 RAG 自行定位，避免全文读入
- **笔记答疑助手**：笔记/PDF 右上角论坛图标唤起右侧面板，苏格拉底 / 费曼 / 快讲三种角色针对当前内容答疑；PDF 按当前阅读章节注入上下文
- **教学模式**（侧栏 `school` 按钮新建，或直接点开 vault 里任意对话文件）：对话式引导学习，内置 Gemini Guided Learning 同款建构主义导师提示词——先给关键背景再以提问引导，不直接给答案；与笔记一样占据标签栏（可拖拽/分屏）。每个对话就是 vault 里一个 md 文件：frontmatter `session` 关联会话，正文为系统自动维护的对话实录（首轮回复后自动按标题改名）；重命名/删除文件会同步会话。**多模态**：输入框可粘贴/拖入/附加图片（存 `附件/`，以 vision 格式发给模型，需模型支持视觉；ZCode 引擎降级为路径引用），文件存档并嵌入实录。每轮消息**自动 RAG 检索**知识库，可联网搜图/提取教材原图并在对话中展示（mermaid 与公式实时渲染）；要求整理笔记/找资料/配图时自动 `delegate` 给知识库专职子 Agent。接口：`POST /api/teacher`（含 `attachments`）、`POST /api/teacher/stop`、`GET|POST /api/teacher/sessions`、`POST /api/teacher/sessions/:id/activate`、`PUT|DELETE /api/teacher/sessions/:id`、`GET|DELETE /api/teacher/session?id=`、`GET /api/teacher/status`
- **资料引用角标**：AI 生成内容中的 `[^n]` 脚注渲染为可悬停的来源卡片（来源标题/摘录/类型/分组），语法与 Obsidian 脚注兼容

## 目录结构（节选）

```
learn-agent/
├─ server/
│  ├─ pdfdoc.js / pdfstudy.js / pdfcontext.js   # PDF 解析/标注存储/上下文编码
│  ├─ rag.js                                     # 本地 embedding + 向量检索
│  └─ agent/                                     # 主 agent / tutor / 写作 / mermaid 修复
└─ src/
   └─ components/pdfstudy/                       # PDF 学习器前端
```
