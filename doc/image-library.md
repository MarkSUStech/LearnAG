# 图片检索、读图与七家图库

## Agent 使用链路

1. `search_images` 默认 `source=auto`：按本地文件名、笔记图片图注、PDF 导出清单及已保存出处检索；本地无匹配才联网。`source=local` 保证不联网；`source=web` 明确联网。
2. 可传 `providers` 指定一家或多家图库；不指定时按学科选择 2–4 家。显式指定的源失败时不悄悄换源。普通网络搜索仅在默认开放图库全无结果时作为后备。
3. 本地图用 `read_image` 查看实际像素；网络候选先 `download_image` 下载并解码，保存来源页、作者、授权链接与图注，然后读图核对。文件名、标题和匹配分不等于图像内容已经核实。
4. `read_image` 支持归一化 `crop=[x,y,width,height]`，用于从教材整页截出图；保留原图和出处。视觉输入转为 PNG，最长边 1536px，每次最多最近 4 张，不把 base64 写入历史，也不额外请求一次视觉总结。
5. 用 `![有意义的图注](<返回的path>)` 展示，并解释图中重点及标注来源。`write_note` 返回 `imageWarnings`，提示空路径、缺失文件或未经入库校验的外链；不擅自删改原文。

主 Agent 和笔记/PDF 答疑始终可发现图片检索。检测到图片需求、用户图片或最近已调用图片工具时，才发送完整图片工具定义；普通问答保持小工具集。内容写作、配图、教师可使用完整图片链路。ZCode 的 `read_image` 经 MCP 返回真正的 image 内容块，API 通过统一 vision 边界注入，保持工具消息连续。

模型必须支持视觉才能核对像素；纯文本模型仍可检索、下载、引用，但必须说明无法确认图中细节。这里没有替用户切换模型或增加付费模型调用。

## 七家图库

| providers ID | 来源与实际接入 | 来源/授权处理 |
|---|---|---|
| `wikimedia` | Wikimedia Commons Action API，包含 SVG 和位图 | 逐图读取 extmetadata，不套用统一网站授权 |
| `openverse` | Openverse images REST API | 保留原始落地页、作者、license/version；网络候选需入库后核对 |
| `europepmc` | Europe PMC 开放全文搜索 → fullTextXML → JATS figure/caption 与实际 CDN 图版地址 | 单独保留文章授权。图注涉及 BioRender、转载、copyright 等第三方声明时，不将文章授权直接当作单图授权；不编造 /bin 图片链接 |
| `openstax` | OpenStax 官方 GitHub 教材源目录与 media，读取 collection XML 授权；索引缓存到本机 | 当前提供物理、生物、化学、解剖生理、微积分、统计教材源。按文件名匹配，不能假装已解析所有教材图注；保留教材级授权与单图核对提示 |
| `servier` | Servier 官方搜索页的插图卡片，取已声明的最高分辨率图 | 保留官方图页、Servier Medical Art 署名与 [官方使用说明](https://smart.servier.com/using-smart-images-what-you-can-do/)；不是虚构的 REST API |
| `bioicons` | [官方 GitHub 图标索引](https://github.com/duerrsimon/bioicons)，只缓存约 300KB 的元数据，SVG 按需下载 | 按每个图标记录作者和授权，不用网站代码的 MIT 许可替代图标自身许可 |
| `wellcome` | [Catalogue images API](https://developers.wellcomecollection.org/api/catalogue) → IIIF info → 实际图像 | 保留原始馆藏记录、credit 和逐项授权，包含 CC BY-NC 时原样保留 |

图源声明参考：[Commons Imageinfo](https://www.mediawiki.org/wiki/API:Imageinfo)、[Openverse API](https://api.openverse.org/v1/)、[Europe PMC REST](https://europepmc.org/RestfulWebService)、[OpenStax 官方源码](https://github.com/openstax)、[Wellcome IIIF 示例](https://developers.wellcomecollection.org/docs/examples/connecting-the-apis-together)。

公开索引缓存位于项目 `.learn-agent/image-source-cache/`，有效期 24 小时；不会批量下载整站或整套图库。普通查询缓存 5 分钟。元数据请求最大 5MB，超时 12 秒；单个源错误不会吞掉其他源结果。已存在 SigLIP 模型才尝试图文重排，不为搜图自动下载大型模型；重排失败退回检索排序并报告。

`GET /api/image-sources` 返回七个来源的说明和**当前服务进程**最近一次检索状态；未调用显示 `not_checked`。它不会为显示状态而额外联网。

```json
{"query":"mitochondria diagram","source":"web","providers":["bioicons","europepmc"],"count":4}
```

```json
{"path":"assets/pdf/book/p126-page-example.png","crop":[0.25,0.62,0.55,0.2]}
```

## PDF 插图修复

旧版只取内嵌位图，因此数理统计教材的矢量图返回 0 张，被误称为接口故障。现在 `extract_pdf_images` 支持：

- `mode=embedded`：内嵌位图，支持异步图片对象、重复 XObject 和打包 1-bit 灰度解码。
- `mode=page` + `pages=[69,90,126]`：导出包含矢量图、文字和图注的指定整页，最多 12 页；这是页面导出，不冒充自动裁切的插图。
- 默认 `mode=auto`：指定页没有符合条件的位图时回退整页；未指定页时只扫描位图，避免意外导出整本书。

结果区分 `ok / partial / no_images / error`，包含 warnings、扫描页数、kind 和真实尺寸。缓存同时区分源路径、文件修改、模式、页码、尺寸筛选，保留不同同名 PDF 的独立目录。没有图片时不再提示嵌入空路径。

## 模块与验证

实现位于 `imageSources.js`（七源适配）、`imageLibrary.js`（本地优先与统一查询）、`imageAssets.js`（解码、裁切、出处与引用检查）、`imgsearch.js`（聚合、重排、下载）、`pdfimages.js`（教材图片）、`vision.js`（图像注入）；API、ZCode、教师和答疑共用。

`npm run test:images` 包含图片链路与七源离线契约测试。当前整合测试 91 项通过，涵盖分布/NoteUI、工作区、会话和 Agent；外部服务连通性单独记录，不用 mock 通过冒充网络可用。

2026-10-20 实测：Europe PMC、OpenStax、Servier、Bioicons、Wellcome 均返回真实候选；Wikimedia、Openverse 在当前网络下超时，已报告具体源错误。公开普通搜图结果也完成了一次下载、解码和出处保存。资料库原文未因测试被重写；真实教材第 69、90、126 页导出在项目验证目录检查。
