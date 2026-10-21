import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectConversation } from '../server/agent/conversation.js'

test('conversation exposes text and vault image paths without internal observations or reasoning', () => {
  const source = [
    { role:'system', content:'private system prompt' },
    { role:'user', content:'【模式：教学】解释题图', images:['附件/题.png','../secret.png','https://example.com/private.png','data:image/png;base64,abc'] },
    { role:'assistant', content:'internal planning', reasoning_content:'private reasoning', tool_calls:[{ id:'read',function:{name:'read_note',arguments:'{"path":"private.md"}'} }] },
    { role:'tool', tool_call_id:'read',content:'private tool output' },
    { role:'assistant',content:'这里是解题思路。',reasoning_content:'private reasoning' },
  ]
  const original = structuredClone(source)
  assert.deepEqual(projectConversation(source), [
    { role:'user',content:'解释题图',images:['附件/题.png'] },
    { role:'assistant',content:'这里是解题思路。' },
  ])
  assert.deepEqual(source,original)
})

test('structured questions retain their visible question and answer, with unrelated tools excluded', () => {
  assert.deepEqual(projectConversation([
    { role:'assistant',tool_calls:[{id:'q1',function:{name:'ask_user',arguments:JSON.stringify({question:'复杂度是多少？',options:['O(n)','O(n²)']})}}] },
    { role:'tool',tool_call_id:'other',content:'never expose this' },
    { role:'tool',tool_call_id:'q1',content:JSON.stringify({value:'O(n)'}) },
    { role:'assistant',content:'回答正确。' },
  ]),[
    {role:'assistant',content:'复杂度是多少？\n\n- O(n)\n- O(n²)'},
    {role:'user',content:'O(n)'},
    {role:'assistant',content:'回答正确。'},
  ])
})
