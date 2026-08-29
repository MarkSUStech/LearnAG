import { useEffect, useRef, useState } from 'react'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { select } from 'd3-selection'
import { drag } from 'd3-drag'
import { zoom, zoomIdentity } from 'd3-zoom'
import type { GraphData, GraphEdge, GraphNode } from '../types'

interface Props {
  graph: GraphData
  onOpenNote: (path: string) => void
}

interface SimNode extends SimulationNodeDatum, GraphNode {}
interface SimLink extends SimulationLinkDatum<SimNode> {
  from: string
  to: string
  type: GraphEdge['type']
}

const STATUS_COLOR: Record<GraphNode['status'], string> = {
  mastered: 'var(--mastered)',
  learning: 'var(--learning)',
  learnable: 'var(--frontier)',
}
const STATUS_LABEL: Record<GraphNode['status'], string> = {
  mastered: '已掌握',
  learning: '学习中',
  learnable: '待探索',
}
const EDGE_STYLE: Record<GraphEdge['type'], { color: string; dash?: string }> = {
  'depends-on': { color: '#60a5fa' },
  'leads-to': { color: '#34d399' },
  'relates-to': { color: '#c084fc', dash: '4 3' },
}

function radius(n: GraphNode) {
  return 5 + (n.mastery ?? 0) * 1.1
}

export default function GraphView({ graph, onOpenNote }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null)
  const linkSel = useRef<any>(null)
  const nodeSel = useRef<any>(null)
  const zoomRef = useRef<any>(null)
  const neighborsRef = useRef<Map<string, Set<string>>>(new Map())
  const [tip, setTip] = useState<{ x: number; y: number; node: GraphNode } | null>(null)

  // 初始化：模拟器 + 缩放 + 分层组
  useEffect(() => {
    const svgEl = svgRef.current
    if (!svgEl) return
    const svg = select(svgEl)
    const wrap = wrapRef.current!

    const g = svg.append('g').attr('class', 'graph-fade-in')
    const linkLayer = g.append('g').attr('class', 'links')
    const nodeLayer = g.append('g').attr('class', 'nodes')

    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 3])
      .on('zoom', (e) => {
        g.attr('transform', e.transform.toString())
      })
    zoomRef.current = zoomBehavior
    svg.call(zoomBehavior).on('dblclick.zoom', null)
    // 双击空白处复位视图
    svg.on('dblclick.reset', () => {
      svg.call(zoomRef.current.transform, zoomIdentity)
    })

    const sim = forceSimulation<SimNode, SimLink>([])
      .force(
        'link',
        forceLink<SimNode, SimLink>([])
          .id((d) => d.id)
          .distance((l) => (l.type === 'depends-on' ? 70 : 95))
          .strength(0.25),
      )
      .force('charge', forceManyBody<SimNode>().strength(-260))
      .force('center', forceCenter(wrap.clientWidth / 2, wrap.clientHeight / 2))
      .force('collide', forceCollide<SimNode>().radius((d) => radius(d) + 10))
      .alphaDecay(0.03)
      .on('tick', () => {
        linkSel.current
          ?.attr('x1', (d: any) => (d.source as SimNode).x)
          .attr('y1', (d: any) => (d.source as SimNode).y)
          .attr('x2', (d: any) => (d.target as SimNode).x)
          .attr('y2', (d: any) => (d.target as SimNode).y)
        nodeSel.current?.attr('transform', (d: SimNode) => `translate(${d.x ?? 0},${d.y ?? 0})`)
      })
    simRef.current = sim

    return () => {
      sim.stop()
      simRef.current = null
      svg.selectAll('*').remove()
    }
  }, [])

  // 数据更新：保留已有节点位置
  useEffect(() => {
    const sim = simRef.current
    if (!sim) return
    const wrap = wrapRef.current!
    const prev = new Map<string, SimNode>((sim.nodes() as SimNode[]).map((n) => [n.id, n]))

    const nodes: SimNode[] = graph.nodes.map((n) => {
      const p = prev.get(n.id)
      return {
        ...n,
        x: p?.x ?? wrap.clientWidth / 2 + (Math.random() - 0.5) * 120,
        y: p?.y ?? wrap.clientHeight / 2 + (Math.random() - 0.5) * 120,
      }
    })
    const links: SimLink[] = graph.edges.map((e) => ({ ...e, source: e.from, target: e.to }))
    sim.nodes(nodes) // 必须先设置节点，forceLink 才能把字符串端点解析为节点对象
    ;(sim.force('link') as any).links(links)

    // 邻接表（悬停高亮用）
    const nb = new Map<string, Set<string>>()
    for (const e of graph.edges) {
      if (!nb.has(e.from)) nb.set(e.from, new Set())
      if (!nb.has(e.to)) nb.set(e.to, new Set())
      nb.get(e.from)!.add(e.to)
      nb.get(e.to)!.add(e.from)
    }
    neighborsRef.current = nb

    const svg = select(svgRef.current!)
    const linkLayer = svg.select('g.links')
    const nodeLayer = svg.select('g.nodes')

    linkSel.current = linkLayer
      .selectAll<SVGLineElement, SimLink>('line')
      .data(links, (d) => `${typeof d.source === 'object' ? d.source.id : d.source}|${typeof d.target === 'object' ? d.target.id : d.target}`)
      .join('line')
      .attr('stroke', (d) => EDGE_STYLE[d.type]?.color ?? 'var(--text-3)')
      .attr('stroke-width', 1.6)
      .attr('stroke-opacity', 0.55)
      .attr('stroke-dasharray', (d) => EDGE_STYLE[d.type]?.dash ?? null)

    const nodeSelJoin = nodeLayer
      .selectAll<SVGGElement, SimNode>('g.node')
      .data(nodes, (d) => d.id)
      .join((enter) => {
        const gn = enter.append('g').attr('class', 'node')
        gn.append('circle')
        gn.append('text')
          .attr('text-anchor', 'middle')
          .attr('dy', (d) => radius(d) + 13)
          .attr('font-size', 10.5)
          .attr('fill', 'var(--text-2)')
          .attr('paint-order', 'stroke')
          .attr('stroke', 'var(--bg)')
          .attr('stroke-width', 3)
        return gn
      })

    nodeSelJoin
      .select('circle')
      .attr('r', (d) => radius(d))
      .attr('fill', (d) => STATUS_COLOR[d.status])
      .attr('fill-opacity', (d) => (d.status === 'learnable' ? 0.55 : 0.92))
      .attr('stroke', (d) => (d.status === 'learnable' ? STATUS_COLOR[d.status] : 'transparent'))
      .attr('stroke-width', (d) => (d.status === 'learnable' ? 1.2 : 0))
      .style('cursor', (d) => (d.note ? 'pointer' : 'default'))

    nodeSelJoin.select('text').text((d) => d.title)

    nodeSel.current = nodeSelJoin

    // 拖拽 + 点击打开笔记
    nodeSelJoin.call(
      drag<SVGGElement, SimNode>()
        .on('start', function (event, d) {
          if (!event.active) sim.alphaTarget(0.12).restart()
          d.fx = d.x
          d.fy = d.y
          ;(this as any).__moved = false
        })
        .on('drag', function (event, d) {
          d.fx = event.x
          d.fy = event.y
          ;(this as any).__moved = true
        })
        .on('end', function (event, d) {
          if (!event.active) sim.alphaTarget(0)
          d.fx = null
          d.fy = null
          if (!(this as any).__moved && d.note) onOpenNote(d.note)
        }),
    )

    nodeSelJoin
      .on('mouseenter', (event: MouseEvent, d) => {
        const rect = wrapRef.current!.getBoundingClientRect()
        setTip({ x: event.clientX - rect.left, y: event.clientY - rect.top, node: d })
        // 高亮邻居：淡化无关节点与边
        const nb = neighborsRef.current.get(d.id) ?? new Set<string>()
        linkSel.current?.attr('stroke-opacity', (l: any) =>
          (l.source as SimNode).id === d.id || (l.target as SimNode).id === d.id ? 0.95 : 0.06,
        )
        nodeSel.current?.attr('opacity', (n: SimNode) => (n.id === d.id || nb.has(n.id) ? 1 : 0.16))
      })
      .on('mousemove', (event: MouseEvent, d) => {
        const rect = wrapRef.current!.getBoundingClientRect()
        setTip({ x: event.clientX - rect.left, y: event.clientY - rect.top, node: d })
      })
      .on('mouseleave', () => {
        setTip(null)
        linkSel.current?.attr('stroke-opacity', 0.55)
        nodeSel.current?.attr('opacity', 1)
      })

    sim.alpha(0.7).restart()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph])

  const counts = {
    mastered: graph.nodes.filter((n) => n.status === 'mastered').length,
    learning: graph.nodes.filter((n) => n.status === 'learning').length,
    learnable: graph.nodes.filter((n) => n.status === 'learnable').length,
  }

  return (
    <div className="graph-page">
      <div className="graph-head">
        <span className="title">
          <span className="material-symbols-rounded">hub</span>
          知识图谱
        </span>
        <span className="meta">
          {graph.nodes.length} 个知识点 · {graph.edges.length} 条关联 · 更新于 {graph.updatedAt || '—'}
        </span>
        <span className="spacer" />
        <span className="meta">拖拽节点 · 滚轮缩放 · 点击节点打开笔记</span>
      </div>
      <div className="graph-svg-wrap" ref={wrapRef}>
        <svg ref={svgRef} />
        {tip && (
          <div className="graph-tip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
            <div className="t">{tip.node.title}</div>
            <div className="s">
              {tip.node.field || '未分类'} · mastery {tip.node.mastery}/10 · {STATUS_LABEL[tip.node.status]}
            </div>
            {tip.node.weakPoints && tip.node.weakPoints.length > 0 && (
              <div className="s">
                薄弱点：
                {tip.node.weakPoints
                  .map((w) => (typeof w === 'string' ? w : w.name + (w.mastery !== undefined ? `(${w.mastery})` : '')))
                  .join('、')}
              </div>
            )}
            {tip.node.note && <div className="s" style={{ color: 'var(--accent)' }}>点击打开笔记</div>}
          </div>
        )}
        {graph.nodes.length === 0 && (
          <div className="graph-empty">知识图谱还是空的——让 agent 教你点什么，图谱会自己生长出来</div>
        )}
        <div className="graph-legend">
          <div className="row">
            <span className="sw" style={{ background: 'var(--mastered)' }} />
            已掌握（{counts.mastered}）
          </div>
          <div className="row">
            <span className="sw" style={{ background: 'var(--learning)' }} />
            学习中（{counts.learning}）
          </div>
          <div className="row">
            <span
              className="sw"
              style={{ background: 'color-mix(in srgb, var(--frontier) 55%, transparent)', border: '1px solid var(--frontier)' }}
            />
            待探索 · 最外圈（{counts.learnable}）
          </div>
          <div className="row">
            <span className="line" style={{ borderColor: EDGE_STYLE['depends-on'].color }} />
            前置依赖
          </div>
          <div className="row">
            <span className="line" style={{ borderColor: EDGE_STYLE['leads-to'].color }} />
            进阶方向
          </div>
          <div className="row">
            <span
              className="line"
              style={{ borderColor: EDGE_STYLE['relates-to'].color, borderTopStyle: 'dashed' }}
            />
            横向关联
          </div>
        </div>
      </div>
    </div>
  )
}
