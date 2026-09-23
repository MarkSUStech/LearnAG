import path from 'node:path'
import fs from 'node:fs'
import * as vault from '../vault.js'
import { readGraph, updateGraph, GRAPH_FILE } from '../graph.js'
import { webSearch, webFetch } from './web.js'
import { searchPapers, downloadPaperPdf } from './scholar.js'
import { extractPdfText, extractPdfPages } from './pdf.js'
import { search as ragSearch } from '../rag.js'
import { loadDoc } from '../pdfstudy.js'
import { buildStudyContext } from '../pdfcontext.js'
import { keyFor, getOutlineTree, flattenOutline, chapterRange } from '../pdfdoc.js'

import { searchImages, downloadImageToVault } from './imgsearch.js'
import { extractPdfImages } from './pdfimages.js'

// ── 工具定义（OpenAI function calling 格式） ────────────────────────────────

export const toolDefs = [
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description:
        '向用户提出结构化问题并等待回答，用户会在输入框上方的卡片里作答（所有题型都自带「自定义回答」入口，用户可能用自由文本回答——按其内容严肃判定，与选项同等计分）。适用场景：' +
        '摸底测评（一道一问，type=text 简答或 judge 判断）、判断题确认（judge）、' +
        '候选/路径选择（single）、多选（multi）、需要用户上传代码或文件（file）。' +
        '提问时对话会暂停，用户回答后你在工具结果中拿到答案。每次只提一个问题。' +
        '注意：问题涉及用户看不到的内容（如刚上传的代码、你写的示例）时，必须把相关内容放进 code 参数展示给用户，否则用户无法回答。',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '问题本身（展示给用户的完整题面）' },
          type: { type: 'string', enum: ['single', 'multi', 'judge', 'text', 'file'] },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'single/multi 的选项列表（2~6 个，每个尽量短）；judge 不需要',
          },
          allowCustom: { type: 'boolean', description: 'single/multi 是否允许自定义输入，默认允许' },
          fileHint: { type: 'string', description: 'type=file 时提示用户上传什么（如"上传你写的 Python 代码"）' },
          fileMultiple: { type: 'boolean', description: 'type=file 时是否允许多个文件' },
          code: { type: 'string', description: '可选。随问题一起展示给用户的代码或内容原文（≤4000 字符），用户看不到文件内容时必须提供' },
        },
        required: ['question', 'type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        '联网搜索（DuckDuckGo，免费无需 Key；不可用时自动切 Bing）。返回标题/链接/摘要列表。' +
        '用途：在给出学习方案/候选/路径前检索资料，之后用 web_fetch 抓取感兴趣的页面存入 资料/ 目录。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词（可用中英文，越具体越好）' },
          max_results: { type: 'number', description: '返回条数，默认 8，最多 10' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description:
        '抓取一个网页的可读正文（自动去除导航/脚本等杂讯；正文过短时自动用 jina reader 转出干净内容）。' +
        '配合 web_search 使用：把有价值页面的内容用 write_note 存入 资料/<主题>/web/ 目录。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '完整的 http(s) 网址' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_papers',
      description:
        '学术论文检索（聚合 arXiv 与 Semantic Scholar，免费）。返回标题/作者/年份/摘要，以及开放获取版本的 PDF 直链。' +
        '学术理论/算法/技术原理类主题的资料收集必须使用它；英文关键词命中率更高。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索词（学术主题建议用英文）' },
          max_results: { type: 'number', description: '返回篇数，默认 8，最多 12' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'download_paper',
      description:
        '把一篇开放获取的论文 PDF 下载进资料库（笔记/<大知识范围>/<细分知识点>/reference/papers/）。下载后立刻用 read_note 读取全文（可按页），再在讲解/方案中引用。' +
        'url 用 search_papers 结果里的 pdfUrl。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '论文 PDF 直链' },
          dir: { type: 'string', description: '主题相对路径（笔记/ 之下），如 计算机网络/TLS握手；论文会存到 笔记/<dir>/reference/papers/' },
          filename: { type: 'string', description: '保存文件名（不含 .pdf）' },
        },
        required: ['url', 'dir'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_note',
      description: '移动/重命名一篇笔记或文件夹（不改变内容）。用于整理目录结构，如把笔记迁入 笔记/<领域>/<子主题>/note/ 规范位置。',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: '当前路径' },
          to: { type: 'string', description: '新路径' },
        },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_notes',
      description: '列出知识库（vault）中的全部 Markdown 笔记文件（相对路径）。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_note',
      description:
        '读取一篇笔记的完整内容（含 YAML frontmatter）。支持 .md 文本笔记与 .pdf 文件：' +
        'PDF 可传 page 按页读取，或传 chapter 按章节标题读取（自动解析书签定位页码范围，返回带行号的原文 + 用户在该范围的标注与卡片）；' +
        '读取 PDF 时会自动附带【用户标注摘要】（用户的高亮/笔记，可能是外文翻译）。扫描型 PDF 无文本层会如实提示。修改文件前必须先读取。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'vault 内的相对路径，如 知识图谱/递归.md 或 资料/TLS/某论文.pdf' },
          page: { type: 'number', description: '仅 PDF：读取指定页（1 开始）。不传则读全文（过长会截断）' },
          chapter: { type: 'string', description: '仅 PDF：章节标题（或关键词），从书签大纲解析页码范围后整章读取；优先于 page' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description:
        '语义检索整个知识库（本地 RAG，中英双语 embedding）。覆盖全部笔记、PDF 教材/论文文本、以及用户在 PDF 学习器里的标注与卡片笔记。' +
        '适用：用户提问的知识点在笔记里找不到细节时、需要引用教材/论文原文时、想了解用户在某资料上做过哪些笔记时。' +
        '返回最相关的片段（来源路径/页码/相关度/文本）。回答后建议用 read_note（可带 chapter 参数）读取完整上下文。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索查询（中英文皆可，描述要找的内容）' },
          max_results: { type: 'number', description: '返回条数，默认 6，最多 12' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_note',
      description:
        '创建或整体覆盖一篇 Markdown 笔记。用户会实时看到你写入的内容流式出现在编辑器里。修改已有文件前必须先 read_note。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'vault 内的相对路径，如 知识图谱/递归.md' },
          content: { type: 'string', description: '完整的 Markdown 文件内容（含 frontmatter）' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_note',
      description: '删除一篇笔记或一个文件夹。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'vault 内的相对路径' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_graph',
      description: '读取知识图谱（知识图谱.json）的完整内容：节点（id/标题/领域/mastery/status/笔记路径）与边。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_graph',
      description:
        '以补丁方式更新知识图谱。ops 是操作数组，每个操作形如：' +
        '{"op":"upsert_node","node":{"id":"recursion","title":"递归","field":"算法","mastery":7,"status":"mastered","note":"知识图谱/递归.md","updatedAt":"2026-08-28"}}；' +
        '{"op":"add_edge","edge":{"from":"recursion","to":"tree-dfs","type":"leads-to"}}；' +
        '{"op":"remove_node","id":"xxx"}；{"op":"remove_edge","from":"a","to":"b"}。' +
        'id 用英文小写 kebab-case，title 用中文；status ∈ mastered/learning/learnable；边类型 ∈ depends-on/leads-to/relates-to。' +
        'mastered 节点必须填 note。向外推演一层时新增节点 status=learnable、mastery=0。',
      parameters: {
        type: 'object',
        properties: {
          ops: {
            type: 'array',
            description: '操作数组',
            items: { type: 'object' },
          },
        },
        required: ['ops'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_images',
      description:
        '联网搜索真实图片并按图文语义相关度重排（本地 SigLIP 模型），返回图片列表（标题/原图链接/缩略图/来源页/授权/相关度）。' +
        '适合为笔记配学术插图（结构图、示意图、实物图）。query 建议用英文（如 "feedforward neural network architecture diagram"），语义重排对英文更准。' +
        '拿到结果后用 download_image 把选中的图存入知识库，再用 write_note 以 ![](相对路径) 引用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '图片检索词。英文效果最佳；越具体越好（对象+类型，如 "Transformer attention mechanism diagram"）' },
          count: { type: 'number', description: '返回条数，默认 6，最多 10' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'download_image',
      description:
        '把一张网络图片下载进知识库（默认存到 assets/images/），返回可嵌入笔记的相对路径。' +
        '与 search_images 配合使用：先搜索、选中后下载、再用 write_note 写入带 ![](路径) 的引用。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '图片直链（search_images 结果里的 image_url）' },
          path: { type: 'string', description: '保存路径（vault 内相对路径，如 assets/images/transformer.jpg）。默认自动命名' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'extract_pdf_images',
      description:
        '提取一篇 PDF 里的全部内嵌图片（教材插图/图表/照片），解码为 PNG 存入 assets/pdf/<PDF名>/，返回清单（文件/页码/尺寸）。' +
        '自动过滤小图标；重复提取直接返回已有结果。配合 download/search 之外的第二种配图来源：把教材原图直接搬进笔记。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'PDF 在 vault 内的相对路径（如 资料/xx/lecturenote1.pdf）' },
          min_size: { type: 'number', description: '图片最小边长（像素），默认 200，过滤小图标' },
          force: { type: 'boolean', description: '已提取过时是否强制重新提取' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delegate',
      description:
        '把一个具体任务委派给专职子 Agent 完成并拿回结果。可选 role：' +
        'research（研究：检索笔记/PDF/RAG/知识网络，返回带来源的事实）、' +
        'resource（资源推荐：联网检索网页与论文并整理入库）、' +
        'content（内容写作：按任务撰写或修改笔记）、' +
        'visualize（可视化：为笔记绘制或修改 mermaid 图表）、' +
        'scaffold（脚手架：组装最终产出、沉淀知识网络）。' +
        '委派前把任务描述写具体：目标、输入素材、输出路径、要点与判定标准。',
      parameters: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['research', 'resource', 'content', 'visualize', 'scaffold'], description: '子 Agent 类型' },
          task: { type: 'string', description: '具体任务描述（目标/素材/输出路径/要求）' },
          context: { type: 'string', description: '可选。随任务附带的上下文（如研究结果、用户要求的原文）' },
        },
        required: ['role', 'task'],
      },
    },
  },
]

// ── 执行器 ──────────────────────────────────────────────────────────────────

/**
 * 执行一个工具调用。
 * @param name 工具名
 * @param args 已解析的参数对象
 * @param hooks {onWrite(path, content, done)} write_note 完成写入时回调
 * @returns {result: string} 给模型的工具结果
 */
export async function executeTool(name, args, hooks = {}) {
  try {
    switch (name) {
      case 'list_notes': {
        const notes = vault.listAllNotes()
        return JSON.stringify({ notes })
      }
      case 'read_note': {
        const rel = String(args.path || '')
        if (/\.pdf$/i.test(rel)) {
          // 章节模式：书签解析页码范围 → StudyContext（行号原文 + 用户标注/卡片）
          if (args.chapter && String(args.chapter).trim()) {
            const { totalPages } = await extractPdfPages(rel)
            const abs = vault.resolveInVault(rel)
            const tree = await getOutlineTree(keyFor(rel), abs)
            if (!tree.length) {
              return JSON.stringify({ error: '该 PDF 没有书签大纲，无法按章节读取；请改用 page 参数按页读取', totalPages })
            }
            const range = chapterRange(flattenOutline(tree), String(args.chapter), totalPages)
            if (!range) {
              const chapters = flattenOutline(tree)
                .filter((n) => n.level <= 1 && n.title)
                .slice(0, 40)
                .map((n) => n.title)
              return JSON.stringify({ error: `没有找到匹配「${args.chapter}」的章节。可用章节：`, chapters, totalPages })
            }
            const doc = loadDoc(rel)
            const ctx = await buildStudyContext(
              { relPath: rel, annotations: doc.annotations, cards: doc.cards },
              { strategy: 'pages', from: range.from, to: range.to, maxChars: 50000 },
            )
            return JSON.stringify({
              path: rel,
              chapter: range.title,
              pageRange: [range.from, range.to],
              totalPages,
              truncated: ctx.truncated,
              content: ctx.text,
            })
          }
          const r = await extractPdfText(rel, args.page)
          // 自动附带用户在该 PDF 上的标注/卡片摘要（含翻译卡片）
          const doc = loadDoc(rel)
          const note = annotationsSummary(doc)
          return JSON.stringify({
            path: rel,
            totalPages: r.totalPages,
            truncated: r.truncated,
            content: r.content + (note ? '\n\n' + note : ''),
          })
        }
        const content = vault.readFile(rel)
        return content
      }
      case 'search_knowledge': {
        const r = await ragSearch(String(args.query ?? ''), Math.min(12, Number(args.max_results) || 6))
        return JSON.stringify(r)
      }
      case 'rename_note': {
        vault.renameEntry(args.from, args.to)
        vault.notifyWrite(String(args.from).replace(/\\/g, '/'), 'unlink')
        vault.notifyWrite(String(args.to).replace(/\\/g, '/'), fsStatKind(String(args.to).replace(/\\/g, '/')))
        return JSON.stringify({ ok: true, from: args.from, to: args.to })
      }
      case 'web_search': {
        const r = await webSearch(String(args.query ?? ''), Number(args.max_results) || 8)
        return JSON.stringify(r)
      }
      case 'web_fetch': {
        const r = await webFetch(String(args.url ?? ''))
        return JSON.stringify(r)
      }
      case 'search_papers': {
        const r = await searchPapers(String(args.query ?? ''), Number(args.max_results) || 8)
        return JSON.stringify(r)
      }
      case 'download_paper': {
        const dir = String(args.dir ?? args.topic ?? '未分类').replace(/^笔记\//, '').replace(/\/$/, '')
        const r = await downloadPaperPdf(String(args.url ?? ''), dir, String(args.filename ?? 'paper'))
        vault.notifyWrite(r.path, 'add')
        return JSON.stringify({
          ok: true,
          path: r.path,
          bytes: r.bytes,
          hint: '已下载到资料库。现在用 read_note 读取该 PDF 全文（可传 page 按页），提炼要点后在方案中引用。',
        })
      }
      case 'write_note': {
        const rel = String(args.path || '').replace(/\\/g, '/')
        const content = String(args.content ?? '')
        if (!rel.toLowerCase().endsWith('.md')) {
          return JSON.stringify({ error: '只能写 .md 文件；知识图谱请用 update_graph 工具' })
        }
        if (path.basename(rel) === GRAPH_FILE) {
          return JSON.stringify({ error: '知识图谱.json 请用 update_graph 工具更新' })
        }
        vault.writeFile(rel, content)
        vault.notifyWrite(rel, fsStatKind(rel))
        hooks.onWrite?.(rel, content)
        // 结构性保障 1：知识点笔记自动同步图谱节点
        let graphSynced = false
        if (rel.startsWith('知识图谱/')) {
          graphSynced = syncNoteToGraph(rel, content)
        }
        // 结构性保障 2：范式符合度检查（图表密度 / 篇幅），不足时提示模型补足
              return JSON.stringify({
          ok: true,
          path: rel,
          bytes: Buffer.byteLength(content, 'utf8'),
          graphSynced,
          ...(graphSynced
            ? {
                notice:
                  '已自动把该笔记的 id/mastery/status 同步进知识图谱，并按 related 补充了关联边。' +
                  '若该知识点刚被掌握，你还必须调用 update_graph：以它为起点向外推演一层' +
                  '（新增 status=learnable、mastery=0 的节点并用 leads-to/depends-on 连边），保持灰色前沿不断生长。',
              }
            : {}),
        })
      }
      case 'delete_note': {
        vault.deleteEntry(args.path)
        vault.notifyWrite(String(args.path).replace(/\\/g, '/'), 'unlink')
        return JSON.stringify({ ok: true })
      }
      case 'search_images': {
        const r = await searchImages(String(args.query ?? ''), Math.min(10, Number(args.count) || 6))
        return JSON.stringify(
          r.length
            ? {
                results: r,
                hint: '选择相关度高（score 大）且授权合适的图：download_image 存入 assets/images/ 后，在笔记中用 ![](assets/images/文件名) 引用；学术引用建议注明来源页与作者/授权。',
              }
            : { results: [], note: '没有找到候选图。建议换更通用的英文关键词重试（如把中文概念翻译成英文术语）。' },
        )
      }
      case 'download_image': {
        const r = await downloadImageToVault({ url: String(args.url ?? ''), path: args.path ? String(args.path) : undefined })
        return JSON.stringify({ ok: true, path: r.path, bytes: r.bytes, hint: '在笔记中用 ![](' + r.path + ') 引用' })
      }
      case 'extract_pdf_images': {
        const r = await extractPdfImages({ path: String(args.path ?? ''), min_size: args.min_size, force: Boolean(args.force) })
        return JSON.stringify({
          ...r,
          hint:
            '在笔记中用 ![](' + (r.images[0]?.file ?? '') + ') 引用；引用时建议注明来源 PDF 与页码。' +
            (r.count === 0 ? '本 PDF 没有提取到符合条件的图片（可能是纯文本/矢量绘制），可尝试降低 min_size。' : ''),
        })
      }
      case 'delegate': {
        if (typeof hooks.delegate !== 'function') {
          return JSON.stringify({ error: 'delegate 在当前上下文不可用（仅管理 Agent 可委派）' })
        }
        const d = await hooks.delegate({
          role: String(args.role || ''),
          task: String(args.task || ''),
          context: args.context == null ? '' : String(args.context),
        })
        return JSON.stringify({ ok: true, result: d })
      }
      case 'read_graph': {
        return JSON.stringify(readGraph())
      }
      case 'update_graph': {
        const { stats } = updateGraph(args.ops)
        vault.notifyWrite(GRAPH_FILE, 'change')
        return JSON.stringify({ ok: true, stats })
      }
      default:
        return JSON.stringify({ error: '未知工具：' + name })
    }
  } catch (e) {
    return JSON.stringify({ error: String(e.message || e) })
  }
}

function fsStatKind(rel) {
  try {
    const abs = vault.resolveInVault(rel)
    return fs.existsSync(abs) ? 'change' : 'add'
  } catch {
    return 'change'
  }
}

/** 用户在 PDF 学习器里的标注/卡片摘要（附在 read_note 的 PDF 结果后） */
function annotationsSummary(doc) {
  const rows = []
  for (const a of doc.annotations) {
    if (rows.length >= 30) break
    if (a.type === 'image') continue
    if (a.type === 'mask') rows.push(`- [遮挡自测框] 第${a.page}页（用户用于自查，可考虑考用户其中内容）`)
    else if (a.text) rows.push(`- [${ANN_LABEL[a.type] ?? '标注'}] 第${a.page}页 "${a.text.slice(0, 160)}"${a.tags?.length ? ' ' + a.tags.map((t) => '#' + t).join(' ') : ''}`)
  }
  for (const c of doc.cards) {
    if (rows.length >= 40) break
    const body = String(c.markdown ?? '').replace(/\s+/g, ' ').slice(0, 200)
    rows.push(`- [卡片·${c.purpose}] ${c.title || '(无标题)'}（第${c.anchor?.page ?? '?'}页）: ${body}`)
  }
  if (!rows.length) return ''
  return '── 用户在学习器里做的标注与卡片 ──\n' + rows.join('\n')
}

const ANN_LABEL = { highlight: '荧光', underline: '下划线', squiggly: '波浪线', strikethrough: '删除线', 'tag-anchor': '标签' }

/** 从笔记 frontmatter 提取字段，自动 upsert 图谱节点并按 related 补边（export 供 vault watcher 复用：外部写入的 知识图谱/*.md 也进图谱） */
export function syncNoteToGraph(rel, content) {
  try {
    const fm = parseFrontmatter(content)
    if (!fm.id) return false
    const titleMatch = content.match(/^#\s+(.+)$/m)
    const title = (titleMatch ? titleMatch[1].trim() : '') || path.basename(rel).replace(/\.md$/i, '')
    const statusMap = { mastered: 'mastered', learning: 'learning', learnable: 'learnable' }
    const ops = [
      {
        op: 'upsert_node',
        node: {
          id: fm.id,
          title,
          field: fm.tags && fm.tags[0] ? String(fm.tags[0]) : '',
          mastery: Number.isFinite(Number(fm.mastery)) ? Number(fm.mastery) : 0,
          status: statusMap[fm.status] ?? 'learning',
          note: rel,
          updatedAt: fm.date || new Date().toISOString().slice(0, 10),
        },
      },
    ]
    // related 里的 [[wikilink]] → 与同名节点的关联边（relates-to，可由 agent 后续细化为具体类型）
    if (Array.isArray(fm.related)) {
      const graph = readGraph()
      const byTitle = new Map(graph.nodes.map((n) => [n.title, n.id]))
      for (const r of fm.related) {
        const target = byTitle.get(String(r).trim())
        if (target && target !== fm.id) ops.push({ op: 'add_edge', edge: { from: fm.id, to: target, type: 'relates-to' } })
      }
    }
    updateGraph(ops)
    vault.notifyWrite(GRAPH_FILE, 'change')
    return true
  } catch {
    return false
  }
}

/** 轻量 frontmatter 解析（足够处理 agent 生成的规范笔记） */
function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return {}
  const out = {}
  let key = ''
  for (const line of m[1].split(/\r?\n/)) {
    const list = line.match(/^\s*-\s+(.*)$/)
    if (list && key) {
      if (!Array.isArray(out[key])) out[key] = []
      out[key].push(list[1].trim().replace(/^\[\[|\]\]$/g, ''))
      continue
    }
    const kv = line.match(/^(\w+)\s*:\s*(.*)$/)
    if (!kv) continue
    key = kv[1]
    const v = kv[2].trim()
    if (v) out[key] = v.replace(/^\[\[|\]\]$/g, '').replace(/^["']|["']$/g, '')
  }
  return out
}

