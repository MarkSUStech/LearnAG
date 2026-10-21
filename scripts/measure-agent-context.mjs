import { NOTEUI_PROMPT } from '../server/agent/noteuiPrompt.js'
import { buildManagerSystem } from '../server/agent/prompt.js'
import { buildTeacherSystemPrompt } from '../server/agent/teacherPrompts.js'
import { buildTutorPrompt } from '../server/agent/tutorPrompts.js'
import { MANAGER_TOOLS, TUTOR_TOOLS, TEACHER_TOOLS } from '../server/agent/toolProfiles.js'

// 2026-10-19 before this optimization, same empty dynamic context / writing mode / quick tutor.
const baseline = { noteui: 2638, manager: 1785, teacher: 15157, tutor: 3528, managerTools: 7705, tutorTools: 7705 }
const current = {
  noteui: NOTEUI_PROMPT.length,
  manager: buildManagerSystem({ mode: '写作' }).length,
  teacher: buildTeacherSystemPrompt().length,
  tutor: buildTutorPrompt({ role: 'quick', notePath: 'a.md', noteTitle: 'a', noteContent: '', graphSummary: '' }).length,
  managerTools: JSON.stringify(MANAGER_TOOLS).length,
  tutorTools: JSON.stringify(TUTOR_TOOLS).length,
}
console.log(JSON.stringify({ unit: 'UTF-16 characters (not provider tokens)', baseline, current,
  toolCounts: { manager: MANAGER_TOOLS.length, tutor: TUTOR_TOOLS.length, teacher: TEACHER_TOOLS.length },
  reductionPercent: Object.fromEntries(Object.keys(current).map((k) => [k, Number((100 * (1 - current[k] / baseline[k])).toFixed(1))])),
}, null, 2))
