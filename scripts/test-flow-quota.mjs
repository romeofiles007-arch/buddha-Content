import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
let Q
try {
  const ctx = vm.createContext({ URL, Date })
  vm.runInContext(readFileSync(new URL('../extension/flow-quota.js', import.meta.url), 'utf8'), ctx)
  Q = ctx.DhammaFlowQuota
} catch (e) { if (e.code !== 'ENOENT') throw e }
const api = () => { assert.ok(Q, 'Flow quota policy is missing'); return Q }
test('confirmed generation quota is distinct from demand, safety and generic errors', () => {
  for (const text of ["You've reached your daily image generation limit. Try again in 2 hours.", 'You have reached the limit for image generation', 'You’ve reached your daily limit', 'Daily limit reached', 'You have no more free generations today', 'คุณใช้โควต้าสร้างภาพครบแล้ว ลองอีกครั้งพรุ่งนี้', 'คุณสร้างภาพถึงขีดจำกัดรายวันแล้ว']) assert.ok(api().quotaNotice(text, 1000), text)
  for (const text of ['The agent is experiencing high demand. Please try again later.', 'The agent failed', 'Too many requests', 'Rate limit exceeded', "You've reached the limit of 24 images per request", 'Generate up to 100 images daily', 'Sorry, this image failed to generate', 'Your prompt mentions: you have reached your daily image generation limit']) assert.equal(api().quotaNotice(text, 1000), null, text)
})
test('retry windows are bounded and unknown resets do not invite immediate ping-pong', () => {
  assert.equal(api().quotaNotice("You've reached your image generation limit. Try again in 2 hours.", 1000).retryAt, 1000 + 7200000)
  assert.equal(api().quotaNotice('You have reached your daily image generation limit', 1000).retryAt, 1000 + 86400000)
})
test('round robin skips limited and signed-out accounts, wraps after cooldown, and stops when all blocked', () => {
  const accounts = [{email:'a@x.com'}, {email:'b@x.com'}, {email:'c@x.com', signedOut:true}, {email:'d@x.com'}]
  assert.equal(api().nextAccount(accounts, 'a@x.com', {}, [], 100).email, 'b@x.com')
  assert.equal(api().nextAccount(accounts, 'b@x.com', {'d@x.com':{retryAt:200}}, [], 100).email, 'a@x.com')
  assert.equal(api().nextAccount(accounts, 'b@x.com', {'a@x.com':{retryAt:200}}, ['d@x.com'], 100), null)
  assert.equal(api().nextAccount(accounts.slice(0,2), 'b@x.com', {'a@x.com':{retryAt:99}}, [], 100).email, 'a@x.com')
})
test('account identity must match the intended email and cannot silently return to the first account', () => {
  assert.equal(api().sameAccount('Google Account: H sheh (b@x.com)', 'B@X.COM'), true)
  assert.equal(api().sameAccount('Google Account: ROMEO (a@x.com)', 'b@x.com'), false)
  assert.equal(api().sameAccount('', ''), false)
})

test('Flow account profile can live on a role button inside a component shadow root', () => {
  const profile={getAttribute:name=>name==='aria-label'?'Google Account: B (b@x.com)':null}
  const shadow={querySelectorAll:selector=>selector==='[aria-label], [title]'?[profile]:[]}
  const root={querySelectorAll:selector=>selector==='*'?[{shadowRoot:shadow}]:[]}
  assert.equal(api().profileLabel(root),'Google Account: B (b@x.com)')
})

test('a limited content job reports structured quota without a terminal error or a generation request', async () => {
  let listener
  let identityReads=0
  const sent=[]
  const account={getAttribute:()=> 'Google Account: A (a@x.com)'}
  const alert={innerText:"You've reached your daily image generation limit",getBoundingClientRect:()=>({width:100})}
  const document={documentElement:{className:''},querySelector:()=>null,querySelectorAll:selector=>selector==='button[aria-label], a[aria-label]'?[account]:selector.startsWith('[role="alert"]')?[alert]:[]}
  const ctx=vm.createContext({document,Date,setTimeout:fn=>queueMicrotask(fn),location:{pathname:'/',href:'https://flow.google.com/'},MutationObserver:class{observe(){}},chrome:{
    runtime:{getManifest:()=>({version:'1.0.22'}),onMessage:{addListener:fn=>listener=fn},sendMessage:async msg=>{if(msg.type==='FLOW_ACCOUNT_IDENTITY')return ++identityReads===1?{ok:false,email:''}:{ok:true,email:'a@x.com'};sent.push(msg);return {ok:true}}},
    storage:{local:{get:async()=>({}),set:async()=>{}}},
  }})
  for(const file of ['flow-text.js','flow-quota.js','content-flow-agent.js']) vm.runInContext(readFileSync(new URL('../extension/'+file,import.meta.url),'utf8'),ctx)
  await new Promise(resolve=>listener({type:'RUN_JOB',job:{id:'quota',kind:'generate-images',payload:{shots:[{filename:'a.png'}]}}},{},resolve))
  assert.equal(sent.length,1)
  assert.equal(sent[0].type,'RESULT')
  assert.equal(sent[0].body.meta.flowQuota.email,'a@x.com')
  assert.equal(identityReads,2,'a loading profile must be retried before stopping production')
})

test('initial project quota saves recoverable named images before reporting the account limit', async () => {
  let listener
  const sent=[]
  const account={getAttribute:()=> 'Google Account: A (a@x.com)'}
  const alert={innerText:"You've reached your daily image generation limit",getBoundingClientRect:()=>({width:100})}
  const tile={getAttribute:()=> '00_00_00.png SHOT 01',querySelector:()=>({dataset:{mediaId:'saved'},src:'https://flow.google.com/image'})}
  const document={documentElement:{className:'',style:{}},querySelector:()=>null,querySelectorAll:selector=>selector==='button[aria-label], a[aria-label]'?[account]:selector.startsWith('[role="alert"]')?[alert]:selector==='flow-grid-tile-container'?[tile]:[]}
  const ctx=vm.createContext({document,Date,console,Event:class{},window:{dispatchEvent(){}},setTimeout:fn=>{queueMicrotask(fn)},btoa:value=>Buffer.from(value,'binary').toString('base64'),
    fetch:async()=>({ok:true,blob:async()=>({})}),createImageBitmap:async()=>({width:1,height:1}),OffscreenCanvas:class{getContext(){return {drawImage(){}}}async convertToBlob(){return {arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}}},
    location:{pathname:'/project/a',href:'https://flow.google.com/project/a'},MutationObserver:class{observe(){}},chrome:{
      runtime:{getManifest:()=>({version:'1.0.21'}),onMessage:{addListener:fn=>listener=fn},sendMessage:async msg=>{if(msg.type==='FLOW_ACCOUNT_IDENTITY')return {ok:true,email:'a@x.com'};sent.push(msg);return {ok:true}}},
      storage:{local:{get:async()=>({}),set:async()=>{}}},
    }})
  for(const file of ['flow-text.js','flow-quota.js','content-flow-agent.js']) vm.runInContext(readFileSync(new URL('../extension/'+file,import.meta.url),'utf8'),ctx)
  await new Promise(resolve=>listener({type:'RUN_JOB',job:{id:'quota',kind:'generate-images',payload:{shots:[{filename:'00_00_00.png'},{filename:'00_00_03.png'}]}}},{},resolve))
  const partial=sent.findIndex(s=>s.type==='PARTIAL')
  const result=sent.findIndex(s=>s.type==='RESULT')
  assert.ok(partial>=0 && result>partial)
  assert.equal(sent[partial].body.files[0].name,'00_00_00.png')
  assert.equal(sent[result].body.meta.flowQuota.email,'a@x.com')
  assert.equal(sent.some(s=>s.type==='ERROR'),false)
})
