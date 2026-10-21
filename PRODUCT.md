# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

个人学习者，在本地浏览器中阅读 Markdown、教材 PDF 和算法题，边学习边向 AI 提问，并保留可编辑的学习笔记。

## Product Purpose

LearnAgent 是个人学习工作台。此次初稿以笔记阅读为中心，侧边 AI 支持讲题、读图、生成和修改笔记。用户已确认这个范围，并选择先交付可交互页面。

## Operating Context

现有项目为 React / TypeScript / Vite 前端和 Express 后端，运行于本地。学习材料保存在用户的 Markdown 笔记库中，文件树、会话、知识图谱、PDF 学习记录均已有后端能力。

## Capabilities and Constraints

- 继续使用现有后端接口，初稿不改变模型配置、会话和笔记保存格式。
- Markdown 是笔记唯一可信数据源；默认阅读，可主动编辑源码。已有文档无需迁移。
- 已有 NoteUI 28 类学习组件、9 类组合布局、受控 SVG 示意图及笔记内模板组件库 / Gallery；同时复用 KaTeX、Mermaid、PDF 标注、本地 RAG、学习目标、知识图谱和代码 IDE。
- AI 有全局任务、教学对话、针对笔记的答疑等入口；图像附件通过现有上传和视觉请求链路处理。
- 初稿需清楚区分示例交互和实际模型调用。生成和写入动作不能伪装成已经完成。
- 设计包含桌面与移动端；支持亮暗主题、键盘访问和减少动画偏好。

## Evidence on Hand

- 后端入口 `server/index.js`、前端接口封装 `src/api.ts`。
- 当前主界面 `src/App.tsx`，阅读器 `src/components/EditorPane.tsx` 和 `RichText.tsx`。
- `src/noteui/`、`server/demo-vault/笔记/NoteUI/note/` 提供真实可运行的组件与示例。
- 用户反馈：现界面需要整体重新设计，公式与智能可视化需要可靠、自然地混入学习内容。

## Product Principles

1. 阅读和理解优先，AI 操作服务于当前材料。
2. 资料、学习过程和产出的笔记可互相定位。
3. 普通文字保留排版空间，结构化知识才使用交互组件。
4. 显示真实的调用与写入状态，用户始终知道当前作用范围。

## Open Decisions

当前交付为可交互设计初稿；后续是否全面替换正式界面，以用户对初稿的反馈为依据。
