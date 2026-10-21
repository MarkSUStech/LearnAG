import { api } from '../api'
import type { GraphData, GoalInfo, TreeNode } from '../types'

export interface WorkspaceFile { name: string; path: string; type: 'note' | 'pdf' | 'image' | 'file'; folder: string }
export interface WorkspaceSnapshot { files: WorkspaceFile[]; graph: GraphData; goals: GoalInfo[]; connected: boolean; model: string }

function flatten(nodes: TreeNode[]): WorkspaceFile[] {
  return nodes.flatMap(node => node.type === 'folder' ? flatten(node.children || []) : [{
    name: node.name.replace(/\.md$/i, ''), path: node.path,
    type: /\.md$/i.test(node.path) ? 'note' as const : /\.pdf$/i.test(node.path) ? 'pdf' as const : /\.(png|jpe?g|webp|gif)$/i.test(node.path) ? 'image' as const : 'file' as const,
    folder: node.path.split('/').slice(0, -1).join('/'),
  }])
}

/** Preview reads only. Existing save, upload and model endpoints are not invoked. */
export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  const [tree, graph, goals, settings] = await Promise.allSettled([api.getTree(), api.getGraph(), api.getGoals(), api.getSettings()])
  return {
    files: tree.status === 'fulfilled' ? flatten(tree.value.tree) : [],
    graph: graph.status === 'fulfilled' ? graph.value : { version: 1, updatedAt: '', nodes: [], edges: [] },
    goals: goals.status === 'fulfilled' ? goals.value.goals : [],
    connected: tree.status === 'fulfilled',
    model: settings.status === 'fulfilled' ? settings.value.model : '',
  }
}

export async function readWorkspaceNote(path: string) {
  const file = await api.getFile(path)
  return file.content
}
