import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rotateAccount, flowIdentity } from '../extension/flow-account-switch.js'

function fixture({ current='a@x.com', accounts=[{email:'a@x.com'},{email:'b@x.com'}], limits={}, actual='b@x.com' }={}) {
  const selected=[]
  const io={ currentEmail:current, payload:{limitedEmail:'a@x.com',retryAt:500}, now:100,
    store:{ get:async()=>limits, set:async next=>Object.assign(limits,next) },
    list:async()=>accounts, select:async email=>selected.push(email), identity:async()=>actual }
  return {io, selected,limits}
}
test('rotation persists quota before choosing the next account and verifies identity', async()=>{
  const f=fixture()
  const result=await rotateAccount(f.io)
  assert.equal(result.email,'b@x.com')
  assert.deepEqual(f.selected,['b@x.com'])
  assert.equal(f.limits['a@x.com'].retryAt,500)
})
test('exhaustion returns a reset time without clicking any account', async()=>{
  const f=fixture({limits:{'b@x.com':{retryAt:600}}})
  assert.deepEqual(await rotateAccount(f.io),{exhausted:true,retryAt:500})
  assert.deepEqual(f.selected,[])
})
test('a redirect to the old account cannot authorize another image job', async()=>{
  const f=fixture({actual:'a@x.com'})
  await assert.rejects(rotateAccount(f.io),/ยืนยันบัญชี/)
})
test('manual account changes and signed-out rows are never silently overridden', async()=>{
  const f=fixture({current:'c@x.com'})
  await assert.rejects(rotateAccount(f.io),/เปลี่ยนระหว่าง/)
  assert.deepEqual(f.limits,{})
  const g=fixture({accounts:[{email:'a@x.com'},{email:'b@x.com',signedOut:true}]})
  assert.equal((await rotateAccount(g.io)).exhausted,true)
  assert.deepEqual(g.selected,[])
})

test('a closed profile component is read through its real accessible Google account button', async()=>{
  const chrome={runtime:{},tabs:{get:async()=>({url:'https://flow.google.com/u/1/'})},scripting:{executeScript:async()=>[{result:''}]},debugger:{attach:(_t,_v,cb)=>cb(),detach:(_t,cb)=>cb(),sendCommand:(_t,method,_p,cb)=>{
    assert.equal(method,'Accessibility.getFullAXTree')
    cb({nodes:[{role:{value:'StaticText'},name:{value:'Prompt about a@x.com'}},{role:{value:'button'},name:{value:'Google Account: B (b@x.com)'}}]})
  }}}
  assert.equal(await flowIdentity(chrome,7),'b@x.com')
})

// 2026-11-04: Flow's new layout — the identity check stopped finding the account button.
const axChrome = (frames) => ({runtime:{},tabs:{get:async()=>({url:'https://flow.google.com/project/p1'})},scripting:{executeScript:async()=>[{result:''}]},debugger:{attach:(_t,_v,cb)=>cb(),detach:(_t,cb)=>cb(),sendCommand:(_t,method,params,cb)=>{
  if(method==='Page.getFrameTree') return cb({frameTree:{frame:{id:'main'},childFrames:Object.keys(frames).filter(k=>k!=='main').map(id=>({frame:{id}}))}})
  assert.equal(method,'Accessibility.getFullAXTree')
  cb({nodes:frames[params.frameId ?? 'main'] ?? []})
}}})
test('the account control is also found inside a child frame or as an image control', async()=>{
  assert.equal(await flowIdentity(axChrome({main:[],bar:[{role:{value:'button'},name:{value:'Google Account: B (b@x.com)'}}]}),7),'b@x.com')
  assert.equal(await flowIdentity(axChrome({main:[{role:{value:'img'},name:{value:'Profile picture for c@x.com'}}]}),7),'c@x.com')
})
test('page text and inputs holding an email never count as the signed-in account', async()=>{
  const chrome=axChrome({main:[{role:{value:'StaticText'},name:{value:'Google Account: Evil (e@x.com)'}},{role:{value:'textbox'},name:{value:'Account a@x.com'}},{role:{value:'button'},name:{value:'Share with d@x.com'}}]})
  assert.equal(await flowIdentity(chrome,7),'')
})
test('the last identity attempt explains what account controls were visible, with emails masked', async()=>{
  await assert.rejects(flowIdentity(axChrome({main:[{role:{value:'button'},name:{value:'Account menu'}}]}),7,{diagnose:true}),/ไม่พบปุ่มบัญชี Google.*Account menu/)
  await assert.rejects(flowIdentity(axChrome({main:[]}),7,{diagnose:true}),/ไม่เห็นปุ่มบัญชีเลย/)
})
