import fs from 'node:fs'
import path from 'node:path'
import { resolveInVault } from './vault.js'

export const GRAPH_FILE = '知识图谱.json'

const STATUSES = ['mastered', 'learning', 'learnable']
const EDGE_TYPES = ['depends-on', 'leads-to', 'relates-to']
const KEAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

function graphPath() {
  return resolveInVault(GRAPH_FILE)
}

export function emptyGraph() {
  return { version: 1, updatedAt: today(), nodes: [], edges: [] }
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

export function readGraph() {
  const p = graphPath()
  if (!fs.existsSync(p)) return emptyGraph()
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch (e) {
    throw new Error('知识图谱.json 解析失败：' + e.message)
  }
  return raw
}

/** 校验并规范化节点字段，返回可直接写入的对象；不合法则抛错 */
function normalizeNode(input, { requireTitle = false } = {}) {
  const node = {}
  if (typeof input.id !== 'string' || !KEAB_CASE_RE.test(input.id)) {
    throw new Error(`节点 id 必须是英文小写 kebab-case：${JSON.stringify(input.id)}`)
  }
  node.id = input.id
  if (requireTitle || input.title !== undefined) {
    if (typeof input.title !== 'string' || !input.title.trim()) {
      throw new Error(`节点 ${input.id} 缺少 title`)
    }
    node.title = input.title.trim()
  }
  if (input.field !== undefined) node.field = String(input.field ?? '')
  if (input.mastery !== undefined) {
    const m = Math.round(Number(input.mastery))
    if (!Number.isFinite(m) || m < 0 || m > 10) throw new Error(`节点 ${input.id} mastery 必须是 0-10 的整数`)
    node.mastery = m
  }
  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status)) throw new Error(`节点 ${input.id} status 非法：${input.status}`)
    node.status = input.status
  }
  if (input.note !== undefined) node.note = String(input.note ?? '')
  if (input.updatedAt !== undefined) node.updatedAt = String(input.updatedAt ?? '')
  // 微观层按需属性：薄弱子点 / 常见错误模式（作为节点属性挂载，不拆独立节点）
  for (const key of ['weakPoints', 'commonMistakes']) {
    if (input[key] === undefined) continue
    if (!Array.isArray(input[key])) throw new Error(`节点 ${node.id} 的 ${key} 必须是数组`)
    node[key] = input[key]
      .map((item) =>
        typeof item === 'string'
          ? item.trim().slice(0, 60)
          : item && typeof item === 'object' && item.name
            ? { name: String(item.name).slice(0, 60), mastery: Number.isFinite(Number(item.mastery)) ? Math.round(Number(item.mastery)) : undefined }
            : null,
      )
      .filter(Boolean)
      .slice(0, 12)
  }
  return node
}

function indexNodes(graph) {
  const map = new Map()
  for (const n of graph.nodes) map.set(n.id, n)
  return map
}

/**
 * 补丁式更新知识图谱。ops: [{op:'upsert_node', node:{...}}, {op:'remove_node', id},
 * {op:'add_edge', edge:{from,to,type}}, {op:'remove_edge', from, to}]
 * 返回 {added, updated, removed} 统计。
 */
export function updateGraph(ops) {
  if (!Array.isArray(ops)) throw new Error('ops 必须是数组')
  const graph = readGraph()
  if (!Array.isArray(graph.nodes)) graph.nodes = []
  if (!Array.isArray(graph.edges)) graph.edges = []
  const stats = { nodesUpserted: 0, nodesRemoved: 0, edgesAdded: 0, edgesRemoved: 0 }

  for (const step of ops) {
    if (!step || typeof step.op !== 'string') throw new Error('每个操作必须包含 op 字段')
    switch (step.op) {
      case 'upsert_node': {
        const patch = normalizeNode(step.node ?? step, { requireTitle: false })
        if (!patch.title && !patch.id) throw new Error('upsert_node 需要 id')
        const nodes = indexNodes(graph)
        const existing = nodes.get(patch.id)
        if (existing) {
          Object.assign(existing, patch, { updatedAt: patch.updatedAt || today() })
          // mastered 但没有 note 的节点记录警告性处理：保留原 note
        } else {
          graph.nodes.push({
            field: '',
            mastery: 0,
            status: 'learnable',
            note: '',
            updatedAt: '',
            ...patch,
            title: patch.title ?? patch.id,
            updatedAt: patch.updatedAt || (patch.mastery ? today() : ''),
          })
        }
        stats.nodesUpserted++
        break
      }
      case 'remove_node': {
        const id = step.id
        graph.nodes = graph.nodes.filter((n) => n.id !== id)
        graph.edges = graph.edges.filter((e) => e.from !== id && e.to !== id)
        stats.nodesRemoved++
        break
      }
      case 'add_edge': {
        const e = step.edge ?? step
        if (!e.from || !e.to) throw new Error('add_edge 需要 from 与 to')
        const type = e.type ?? 'relates-to'
        if (!EDGE_TYPES.includes(type)) throw new Error(`边类型非法：${type}`)
        const nodes = indexNodes(graph)
        if (!nodes.has(e.from)) throw new Error(`add_edge 起点不存在：${e.from}`)
        if (!nodes.has(e.to)) throw new Error(`add_edge 终点不存在：${e.to}`)
        const dup = graph.edges.some((x) => x.from === e.from && x.to === e.to && x.type === type)
        if (!dup) {
          graph.edges.push({ from: e.from, to: e.to, type })
          stats.edgesAdded++
        }
        break
      }
      case 'remove_edge': {
        const before = graph.edges.length
        graph.edges = graph.edges.filter((x) => !(x.from === step.from && x.to === step.to))
        stats.edgesRemoved += before - graph.edges.length
        break
      }
      default:
        throw new Error('未知操作：' + step.op)
    }
  }

  graph.updatedAt = today()
  fs.mkdirSync(path.dirname(graphPath()), { recursive: true })
  fs.writeFileSync(graphPath(), JSON.stringify(graph, null, 2) + '\n', 'utf8')
  return { stats, graph }
}

/** 给 agent 的紧凑摘要：每行一个节点 + 边列表 */
export function graphSummary() {
  const g = readGraph()
  const lines = []
  lines.push(`节点（${g.nodes.length} 个，status: mastered=已掌握 / learning=学习中 / learnable=可学习前沿）：`)
  for (const n of g.nodes) {
    lines.push(
      `- ${n.id} | ${n.title} | 领域:${n.field || '-'} | mastery:${n.mastery} | ${n.status} | 笔记:${n.note || '无'}`
    )
  }
  lines.push(`边（${g.edges.length} 条）：`)
  for (const e of g.edges) lines.push(`- ${e.from} --[${e.type}]--> ${e.to}`)
  return lines.join('\n')
}
