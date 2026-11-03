import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const document={documentElement:{className:''},querySelector:()=>null,querySelectorAll:()=>[]}
const ctx=vm.createContext({URL,document,location:{pathname:'/project/test',href:'https://flow.google.com/project/test'},MutationObserver:class{observe(){}},chrome:{runtime:{getManifest:()=>({version:'test'}),onMessage:{addListener(){}}}}})
for(const f of ['flow-text.js','flow-quota.js'])vm.runInContext(readFileSync(new URL('../extension/'+f,import.meta.url),'utf8'),ctx)
const source=readFileSync(new URL('../extension/content-flow-agent.js',import.meta.url),'utf8').replace(/\}\)\(\)\s*$/,'globalThis.imageTest = {fullSize};\n})()')
vm.runInContext(source,ctx)
const full=ctx.imageTest.fullSize
test('full-resolution Flow images preserve the selected Google account query',()=>{
 const src='https://flow.google.com/asb/image-id=s512-rw?authuser=1'
 assert.equal(full(src),'https://flow.google.com/asb/image-id=s0?authuser=1')
 assert.equal(new URL(full(src)).searchParams.get('authuser'),'1')
})
test('resize only changes the path, leaving query values and fragments intact',()=>{
 const src='https://lh3.googleusercontent.com/asb/image=s512-rw?authuser=2&token=a%2Bb%3D#preview'
 assert.equal(full(src),'https://lh3.googleusercontent.com/asb/image=s0?authuser=2&token=a%2Bb%3D#preview')
 assert.equal(full('https://flow.google.com/asb/image=s0?authuser=1'),'https://flow.google.com/asb/image=s0?authuser=1')
})
test('legacy query-free URLs still request full size and unrelated URLs remain unchanged',()=>{
 assert.equal(full('https://flow.google.com/asb/image=s512-rw'),'https://flow.google.com/asb/image=s0')
 for(const src of ['blob:https://flow.google.com/image','https://example.com/image=s512?authuser=1','https://evilgoogleusercontent.com/image=s512','not-a-url'])assert.equal(full(src),src)
})
