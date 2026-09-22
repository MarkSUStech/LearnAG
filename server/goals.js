// 多目标库：Agent/目标/ 目录下一个 .md 一个目标（frontmatter: id/title/standard/
// status/current_path/current_stage + 正文自由维护计划与进度）。
// 首次访问时自动迁移旧版单目标文件 Agent/目标与计划.md（原文件保留不动）。
import fs from 'node:fs'
import path from 'node:path'
import * as vault from './vault.js'

export const GOALS_DIR = 'Agent/目标'
const LEGACY_NOTE = 'Agent/目标与计划.md'

let migratedForVault = ''

function goalsAbs() {
  return vault.resolveInVault(GOALS_DIR)
}

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const out = {}
  if (!m) return out
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+)\s*:\s*(.*)$/)
    if (kv && kv[2].trim()) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

function ensureMigrated() {
  const root = vault.getVaultRoot()
  if (migratedForVault === root) return
  migratedForVault = root
  try {
    const dir = goalsAbs()
    const hasGoalFiles = fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.md'))
    if (hasGoalFiles) return
    let legacy = ''
    try {
      legacy = vault.readFile(LEGACY_NOTE)
    } catch {
      return
    }
    const fm = parseFrontmatter(legacy)
    const title = String(fm.goal || '').trim()
    if (!title) return
    const body = legacy.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').trim()
    const id = 'goal-' + Date.now().toString(36)
    const meta = [
      '---',
      `id: ${id}`,
      `title: ${title}`,
      `standard: ${fm.standard || ''}`,
      'status: active',
      `current_path: ${fm.current_path || ''}`,
      `current_stage: ${fm.current_stage || ''}`,
      `created: ${new Date().toISOString().slice(0, 10)}`,
      '---',
      '',
      body,
      '',
    ].join('\n')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, id + '.md'), meta, 'utf8')
    console.log('[goals] 已迁移旧目标:', title)
  } catch (e) {
    console.error('[goals] 迁移失败:', e?.message || e)
  }
}

/** 全部目标（按创建时间倒序的文件名排序：新目标在前） */
export function listGoals() {
  ensureMigrated()
  const out = []
  try {
    for (const f of fs.readdirSync(goalsAbs())) {
      if (!f.endsWith('.md')) continue
      try {
        const content = fs.readFileSync(path.join(goalsAbs(), f), 'utf8')
        const fm = parseFrontmatter(content)
        out.push({
          id: f.replace(/\.md$/, ''),
          title: String(fm.title || f.replace(/\.md$/, '')),
          standard: String(fm.standard || ''),
          status: String(fm.status || 'active'),
          currentPath: String(fm.current_path || ''),
          currentStage: String(fm.current_stage || ''),
          path: GOALS_DIR + '/' + f,
        })
      } catch {
        /* 单个文件损坏跳过 */
      }
    }
  } catch {
    /* 目录不存在 */
  }
  return out.sort((a, b) => b.id.localeCompare(a.id))
}

/** 单个目标全文（含正文），不存在返回 null */
export function getGoal(id) {
  if (!id) return null
  try {
    const content = fs.readFileSync(path.join(goalsAbs(), String(id).replace(/[/\\]/g, '') + '.md'), 'utf8')
    const fm = parseFrontmatter(content)
    const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').trim()
    return {
      id: String(id),
      title: String(fm.title || id),
      standard: String(fm.standard || ''),
      status: String(fm.status || 'active'),
      currentPath: String(fm.current_path || ''),
      currentStage: String(fm.current_stage || ''),
      body,
    }
  } catch {
    return null
  }
}

/** 供提示词使用的目标上下文块（选中目标 + 其他目标一览） */
export function goalContextBlock(goalId) {
  const goals = listGoals()
  if (!goals.length) return { block: '当前没有进行中的目标。用户提到新学习意图时可建议建立目标（Agent/目标/<id>.md，一个目标一个文件）。', selected: null, others: [] }
  const selected = goalId ? goals.find((g) => g.id === goalId) : null
  if (goalId && !selected) {
    return { block: `用户指定的目标（${goalId}）已不存在，本轮按未选目标处理。`, selected: null, others: goals }
  }
  const others = goals.filter((g) => !selected || g.id !== selected.id).map((g) => g.title)
  if (!selected) {
    const list = goals.map((g) => `${g.title}${g.currentStage ? '（' + g.currentStage + '）' : ''}`).join('、')
    return { block: `本轮未选定目标（自由对话）。用户进行中的目标：${list}——仅在用户明确提到时才推进对应目标。`, selected: null, others }
  }
  const full = getGoal(selected.id)
  const detail = full?.body ? '\n  目标详情（计划与进度）：' + full.body.slice(0, 2200) : ''
  const block =
    `本轮对话服务目标：「${selected.title}」` +
    (selected.standard ? `\n  验收标准：${selected.standard}` : '') +
    (selected.currentPath ? `\n  学习路径：${selected.currentPath}` : '') +
    (selected.currentStage ? `\n  当前阶段：${selected.currentStage}` : '') +
    detail +
    (others.length ? `\n  其他进行中目标（非本轮重点，不要主动推进）：${others.join('、')}` : '')
  return { block, selected, others }
}
