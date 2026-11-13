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

// Flow 2026-11-13: the avatar is now only "Account details". The current email lives
// inside the account settings dialog, not on that control or elsewhere in page text.
function accountPanelChrome({open=false, email='fosavooka@gmail.com', ambiguous=false, navigate=false, replace=false, avatar='รายละเอียดบัญชี'}={}) {
  const clicked=[]
  let reads=0
  const node=(nodeId,role,name,parentId,backendDOMNodeId)=>({nodeId,role:{value:role},name:{value:name},parentId,backendDOMNodeId})
  const chrome={runtime:{},tabs:{get:async()=>({url:navigate && clicked.length ? 'https://flow.google.com/u/0/' : 'https://flow.google.com/u/2/?pli=1'})},scripting:{executeScript:async()=>[{result:''}]},debugger:{attach:(_t,_v,cb)=>cb(),detach:(_t,cb)=>cb(),sendCommand:(_t,method,p,cb)=>{
    if(method==='Page.getFrameTree') return cb({frameTree:{frame:{id:'main'}}})
    if(method==='Accessibility.getFullAXTree') { reads++; return cb({nodes:[
      node('page','RootWebArea','Google Flow'), node('avatar','button',avatar,'page',10),
      node('prompt','StaticText','Google Account: other@x.com','page'),
      ...(open ? [node('panel','dialog','การตั้งค่าบัญชี','page',replace && reads>2 ? 60 : 50),node('email','StaticText',email,'panel'),node('close','button','ปิดแผงบัญชี','panel',20),
        ...(ambiguous ? [node('other','StaticText','another@x.com','panel')] : [])] : [])]}) }
    if(method==='DOM.resolveNode') return cb({object:{objectId:String(p.backendNodeId)}})
    if(method==='Runtime.callFunctionOn') {
      clicked.push(p.objectId)
      if(p.objectId==='10') open=true
      else if(p.objectId==='20') open=false
      else assert.fail('must not click account-switch or other controls')
      return cb({result:{value:true}})
    }
    assert.fail(method)
  }}}
  return {chrome,clicked,isOpen:()=>open}
}

test('Account details verifies the current email inside its dialog and restores the closed panel', async()=>{
  const f=accountPanelChrome()
  assert.equal(await flowIdentity(f.chrome,7),'fosavooka@gmail.com')
  assert.deepEqual(f.clicked,['10','20'])
  assert.equal(f.isOpen(),false)
})

test('an account panel already opened by the user is read without closing it', async()=>{
  const f=accountPanelChrome({open:true})
  assert.equal(await flowIdentity(f.chrome,7),'fosavooka@gmail.com')
  assert.deepEqual(f.clicked,[])
  assert.equal(f.isOpen(),true)
})

test('ambiguous account panels and navigation during verification cannot authorize image generation', async()=>{
  const f=accountPanelChrome({ambiguous:true})
  assert.equal(await flowIdentity(f.chrome,7),'')
  assert.equal(f.isOpen(),false)
  const g=accountPanelChrome({navigate:true})
  assert.equal(await flowIdentity(g.chrome,7),'')
  assert.deepEqual(g.clicked,['10'],'do not close a panel after navigation')
})

test('cleanup cannot close a replacement account panel opened after our identity read', async()=>{
  const f=accountPanelChrome({replace:true})
  await flowIdentity(f.chrome,7)
  assert.deepEqual(f.clicked,['10'])
  assert.equal(f.isOpen(),true)
})

// Flow 2026-11-13 (หน้าโปรเจกต์ของผู้ใช้จริง): ปุ่มรูปโปรไฟล์ไม่มีชื่อที่บอกบัญชีเลย
// AX tree จึงไม่เห็นปุ่มบัญชี — อ่านอีเมลของบัญชี /u/N/ จากข้อมูลของหน้าเว็บเองแทน
const wizChrome = (values, nodes = []) => ({
  runtime: {},
  tabs: { get: async () => ({ url: 'https://flow.google.com/u/2/project/p1' }) },
  scripting: { executeScript: async (opts) => [{ result: opts.world === 'MAIN' ? values : '' }] },
  debugger: { attach: (_t, _v, cb) => cb(), detach: (_t, cb) => cb(), sendCommand: (_t, method, _p, cb) => {
    if (method === 'Page.getFrameTree') return cb({ frameTree: { frame: { id: 'main' } } })
    if (method === 'Accessibility.getFullAXTree') return cb({ nodes })
    assert.fail(method)
  } },
})

test('the signed-in account is read from the page itself when no account control can be found', async () => {
  assert.equal(await flowIdentity(wizChrome(['th', 'me@x.com', 'me@x.com', '1']), 7), 'me@x.com')
})

test('page data holding more than one email is never guessed between', async () => {
  assert.equal(await flowIdentity(wizChrome(['a@x.com', 'b@x.com']), 7), '')
  assert.equal(await flowIdentity(wizChrome([])), '')
  assert.equal(await flowIdentity(wizChrome(['not an email'])), '')
})

test('a readable account control still wins over the page data', async () => {
  const chrome = wizChrome(['page@x.com'], [{ role: { value: 'button' }, name: { value: 'Google Account: B (b@x.com)' } }])
  chrome.scripting.executeScript = async (opts) => [{ result: opts.world === 'MAIN' ? [] : 'Google Account: B (b@x.com)' }]
  assert.equal(await flowIdentity(chrome, 7), 'b@x.com')
})

test('the account panel also opens from an avatar named only "Google Account"', async () => {
  const f = accountPanelChrome({ avatar: 'Google Account' })
  assert.equal(await flowIdentity(f.chrome, 7), 'fosavooka@gmail.com')
  assert.deepEqual(f.clicked, ['10', '20'])
})
