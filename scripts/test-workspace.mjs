import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const source = ts.transpileModule(fs.readFileSync(new URL('../src/workspaceState.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText
const {parseWorkspace,workspaceKey,parsePdfPosition,readyPdfPosition,readLocal,writeLocal} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))

test('workspace restores known tabs, rejects malformed paths and bounds layout sizes',()=>{
  const state = parseWorkspace({version:1,tabs:[{kind:'note',path:'笔记/a.md'},{kind:'note',path:'笔记/a.md'},{kind:'pdf',path:'book.pdf'},{kind:'note',path:'../outside.md'},{kind:'file',path:'x.exe'},{kind:'teach',path:'教学对话/a.md',sessionId:'t-valid'}],activeKey:'pdf:book.pdf',sidebarWidth:99999,assistantWidth:-20,splitRatio:Infinity,splitTab:{kind:'pdf',path:'book.pdf'},sidebarCollapsed:true,assistantOpen:false})
  assert.deepEqual(state.tabs,[{kind:'note',path:'笔记/a.md'},{kind:'pdf',path:'book.pdf'},{kind:'teach',path:'教学对话/a.md',sessionId:'t-valid'}])
  assert.equal(state.sidebarWidth,440); assert.equal(state.assistantWidth,300); assert.equal(state.splitRatio,.55)
  assert.equal(state.activeKey,'pdf:book.pdf');assert.equal(state.splitTab,null);assert.equal(state.assistantOpen,false)
  assert.equal(parseWorkspace({version:99,tabs:[]}),null)
  assert.equal(parseWorkspace({version:1}),null)
  assert.equal(workspaceKey('C:\\Vault'),workspaceKey('c:/vault'))
})
test('PDF resume includes the first page and waits for deep pages to finish loading',()=>{
  const first=parsePdfPosition({page:1,y:350})
  assert.deepEqual(readyPdfPosition(first,200,32),{page:1,y:350})
  assert.equal(readyPdfPosition({page:160,y:72},200,32),null)
  assert.deepEqual(readyPdfPosition({page:160,y:72},200,160),{page:160,y:72})
  assert.equal(readyPdfPosition({page:999,y:72},100,32),null)
  assert.deepEqual(readyPdfPosition({page:999,y:72},100,100),{page:100,y:72})
  assert.equal(parsePdfPosition({page:0,y:1}),null);assert.equal(parsePdfPosition({page:2,y:NaN}),null)
})
test('blocked or corrupted browser storage falls back without breaking reading',()=>{
  globalThis.localStorage={getItem(){throw new Error('blocked')},setItem(){throw new Error('quota')}}
  assert.deepEqual(readLocal('x',{scale:1.2}),{scale:1.2});assert.equal(writeLocal('x',{}),false)
  globalThis.localStorage={getItem(){return 'null'}};assert.deepEqual(readLocal('x',{}),{})
  globalThis.localStorage={getItem(){return '{broken'}};assert.deepEqual(readLocal('x',{}),{})
  delete globalThis.localStorage
})
