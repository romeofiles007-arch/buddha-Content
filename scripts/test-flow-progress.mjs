import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
test('uploaded reference photos never count as requested timecoded images',async()=>{
  let now=0
  const sent=[]
  const refs=Array.from({length:3},(_,i)=>({getAttribute:()=>`buddha_${i}.jpg`,querySelector:()=>({dataset:{mediaId:`ref-${i}`},src:`ref-${i}.jpg`})}))
  const document={documentElement:{className:''},querySelector:()=>null,querySelectorAll:selector=>selector==='flow-grid-tile-container'?refs:[]}
  class Clock extends Date {static now(){return now}}
  const ctx=vm.createContext({document,Date:Clock,location:{pathname:'/project/test',href:'https://flow.google.com/project/test'},MutationObserver:class{observe(){}},setTimeout:fn=>{now+=5000;queueMicrotask(fn)},chrome:{runtime:{getManifest:()=>({version:'test'}),onMessage:{addListener(){}},sendMessage:async msg=>{sent.push(msg);return {ok:true}}}}})
  for(const f of ['flow-text.js','flow-quota.js']) vm.runInContext(readFileSync(new URL('../extension/'+f,import.meta.url),'utf8'),ctx)
  const source=readFileSync(new URL('../extension/content-flow-agent.js',import.meta.url),'utf8').replace(/\}\)\(\)\s*$/,'globalThis.flowTest = {waitAgentIdle};\n})()')
  vm.runInContext(source,ctx)
  await ctx.flowTest.waitAgentIdle({id:'test',payload:{shots:[{filename:'00_00_00.png'}]}},{before:0,expected:1,stage:'generate'})
  const progress=sent.filter(m=>m.body?.progress)
  assert.ok(progress.length)
  assert.equal(progress[0].body.progress.done,0)
})
