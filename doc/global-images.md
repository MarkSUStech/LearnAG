# 全局对话图片

底部全局输入栏的教学、探索、目标、写作模式均可点击图片按钮、粘贴截图或拖入图片。支持PNG、JPEG、WebP、GIF，每条最多4张，每张10MB；可预览、逐张移除，也可只发图片。发送失败保留文字与图片，重试复用已上传文件。

复用现有上传接口，图片保存在笔记库 `附件/`。`/api/agent` 验证文件内容和路径后，将图片路径记录在原会话的用户消息中；`server/agent/vision.js` 仅在模型请求边界转换成OpenAI兼容的 `image_url` 内容块，数据库不存base64。按真实文件签名识别MIME，不把图片字节当UTF-8文本读取。

同一会话追问及内容子任务会接收最近4张唯一图片，单次请求中相同图片只传一次；更多历史图片保留路径并提示需要重新附图。旧版本「附带资料」中的图片路径可在后续请求恢复，无需迁移会话；任意正文里提到的图片路径不会被自动当成上传附件。`read_note` 显式读取图片后，也会在完整工具结果组之后附上图像，避免工具调用协议被打断。历史图片被删除时给出说明，不阻止继续讨论其他内容。

图片会显示在工作台记录中，Markdown仍可直接编辑。图像理解取决于配置的模型；不支持视觉的接口返回错误时会明确提示，不静默删图重试，也不自动切换供应商。ZCode模式提示其使用原有Read能力读图。本功能不添加OCR模型调用，仍由当前视觉模型直接识别。

截至2026-10-19，当前配置为DeepSeek官方接口的 `deepseek-v4-flash`。官方说明该旧名称映射到支持图像输入的Flash模型，详见 [更新日志](https://api-docs.deepseek.com/updates/) 和 [Vision接口](https://api-docs.deepseek.com/guides/vision/)。其他兼容供应商需依据其模型能力选择。

涉及文件：`src/components/InputBar.tsx`、`src/imageAttachments.ts`、`src/App.tsx`、`src/components/md.ts`、`src/styles/inputbar.css`、`src/types.ts`；服务端 `server/index.js`、`server/agent/vision.js`、`runner.js`、`subagent.js`、`tools.js`；共享限额 `shared/image-attachments.json`。

回归入口与真实截图实测结果见 [验证记录](noteui-verification.md)。后端修改需要重启应用服务，生产前端改动需要重新构建并刷新页面。
