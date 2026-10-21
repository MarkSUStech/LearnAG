# AI 侧栏集成

用户已确认以现有文件树、标签栏、笔记阅读界面为基础，仅将底部悬浮全局对话移至右侧，并优化动效。正式入口为前端根地址 `/`；`?design=workspace` 仍是独立的视觉探索预览。

- `src/components/AssistantPanel.tsx`：全局历史、流式消息、笔记答疑范围切换；关闭不卸载全局输入，保留未发送文字和图片。
- `src/components/InputBar.tsx`：增加 `placement="sidebar"`，沿用真实上传、附件选择、模式、目标、提问卡片、停止及发送逻辑。
- `src/App.tsx`：右栏布局与现有 SSE 桥接；普通对话回复不再将中央页面切到 Agent 工作台，工作台仍照常落盘；真正生成的笔记仍按原流程展示。
- `server/agent/conversation.js` 与 `GET /api/sessions/:id/messages`：只返回可展示的用户/助手消息、题目回答与知识库图片路径，过滤系统提示、模型推理和普通工具结果；不改写已存历史。
- `server/agent/runner.js`：API / ZCode 引擎增加 `agent-reply` 事件，复用既有生成流，不增加模型调用。ZCode 的普通文字对话也保存到现有会话文件。
- `src/styles/assistant.css`：复用正式界面的主题令牌；桌面以 220ms transform 展开，正文宽度只重排一次；手机为 240ms 抽屉、消息为 180ms 入场，并支持焦点恢复与减少动画偏好。

笔记答疑继续使用原 TutorPanel；独立教学对话文件、PDF、IDE、Markdown 保存链路保持原功能。

验证命令：`npm run build`、`node --test scripts/test-conversation.mjs scripts/test-agent-efficiency.mjs scripts/test-noteui.mjs`。全量类型检查仍有 `src/components/ide/lspBridge.ts:237`、`:320` 两处原有错误。
