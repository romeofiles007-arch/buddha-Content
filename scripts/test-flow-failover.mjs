import assert from 'node:assert/strict'
import { test } from 'node:test'
let F
try { F = await import('../pipeline/lib/flow-failover.mjs') } catch (e) { if(e.code !== 'ERR_MODULE_NOT_FOUND') throw e }
test('quota after a partial batch switches account and asks only for remaining shots in a fresh project', async () => {
  assert.ok(F, 'Flow failover is missing')
  const calls = []
  const shots = [{filename:'00_00_00.png'}, {filename:'00_00_03.png'}]
  const result = await F.generateWithFailover({payload:{shots, prompt:'original', projectUrl:'https://flow.google.com/project/old'}, promptFor: remaining => 'context:' + remaining.map(s=>s.filename), runJob:async job=> {
    calls.push(job)
    if(calls.length===1) return {files:[{name:shots[0].filename}], meta:{flowQuota:{email:'a@x.com', retryAt:999999}}}
    if(job.kind==='flow-switch-account') return {meta:{email:'b@x.com'}}
    return {files:[{name:shots[1].filename}],meta:{named:1}}
  }})
  assert.equal(calls.length,3)
  assert.equal(calls[1].payload.limitedEmail,'a@x.com')
  assert.equal(calls[2].payload.projectUrl,null)
  assert.deepEqual(calls[2].payload.shots,[shots[1]])
  assert.equal(calls[2].payload.prompt,'context:00_00_03.png')
  assert.equal(result.files.length,2)
})
test('all-exhausted and unexpected account responses stop without retrying generation', async () => {
  assert.ok(F)
  let generations=0
  await assert.rejects(F.generateWithFailover({payload:{shots:[{filename:'x.png'}]},promptFor:()=>'',runJob:async job=>{
    if(job.kind==='generate-images'){generations++;return {files:[],meta:{flowQuota:{email:'a@x.com'}}}}
    return {meta:{exhausted:true,retryAt:10000}}
  }}),/FLOW_ACCOUNTS_EXHAUSTED/)
  assert.equal(generations,1)
})
test('ordinary failures and fully saved quota batches never trigger account switching', async () => {
  assert.ok(F)
  await assert.rejects(F.generateWithFailover({payload:{shots:[]},runJob:async()=>{throw new Error('high demand')}}),/high demand/)
  let calls=0
  const result=await F.generateWithFailover({payload:{shots:[{filename:'x.png'}]},runJob:async()=>{calls++;return {files:[{name:'x.png'}],meta:{flowQuota:{email:'a@x.com'}}}}})
  assert.equal(calls,1)
  assert.equal(result.files.length,1)
  assert.equal(result.meta.flowQuota,undefined)
})

test('recovering named project files rebuilds the first prompt without those shots or account rotation', async () => {
  const calls=[]
  const result=await F.generateWithFailover({payload:{shots:[{filename:'a.png'},{filename:'b.png'}],prompt:'original'},promptFor:remaining=>'style and character:'+remaining.map(s=>s.filename),runJob:async job=>{
    calls.push(job)
    return calls.length===1?{files:['a.png'],meta:{recovered:true,projectUrl:'https://flow.google.com/project/resume'}}:{files:['b.png']}
  }})
  assert.equal(calls.length,2)
  assert.equal(calls[1].kind,'generate-images')
  assert.equal(calls[1].payload.prompt,'style and character:b.png')
  assert.equal(calls[1].payload.projectUrl,'https://flow.google.com/project/resume')
  assert.equal(result.files.length,2)
})

test('26 images are requested as 10/10/6 with one project, preserved references and total progress', async()=>{
  const shots=Array.from({length:26},(_,i)=>({filename:i===25?'cover.png':`00_00_${String(i).padStart(2,'0')}.png`}))
  const calls=[],progress=[]
  const attachments=[{name:'reference.jpg',base64:'ref'}]
  const result=await F.generateWithFailover({payload:{shots,prompt:'oversized',newProject:true,attachments},promptFor:batch=>'style/character:'+batch.map(s=>s.filename).join(','),onProgress:p=>progress.push(p),runJob:async job=>{
    calls.push(job)
    assert.ok(job.payload.shots.length<=10,'a Flow command must not exceed the bounded batch')
    job.onProgress?.({stage:'save',done:job.payload.shots.length,total:job.payload.shots.length})
    return {files:job.payload.shots.map(s=>s.filename),meta:{projectUrl:'https://flow.google.com/u/1/project/clip'}}
  }})
  assert.deepEqual(calls.map(j=>j.payload.shots.length),[10,10,6])
  assert.equal(calls[0].payload.newProject,true)
  for(const job of calls.slice(1)){assert.equal(job.payload.projectUrl,'https://flow.google.com/u/1/project/clip');assert.equal(job.payload.newProject,false);assert.deepEqual(job.payload.attachments,attachments)}
  assert.ok(!calls[0].payload.prompt.includes('cover.png'))
  assert.equal(result.files.length,26)
  assert.equal(progress.at(-1).done,26)
  assert.equal(progress.at(-1).total,26)
})

test('quota after a complete first batch rotates before the next bounded batch, then reuses the new project', async()=>{
  const shots=Array.from({length:26},(_,i)=>({filename:`shot-${i}.png`}))
  const generations=[]
  let rotated=false
  const result=await F.generateWithFailover({payload:{shots,prompt:'all'},promptFor:b=>b.map(s=>s.filename).join(','),runJob:async job=>{
    if(job.kind==='flow-switch-account'){rotated=true;return {meta:{email:'b@x.com'}}}
    generations.push(job.payload)
    assert.ok(job.payload.shots.length<=10)
    return {files:job.payload.shots.map(s=>s.filename),meta:!rotated?{flowQuota:{email:'a@x.com'}}:{projectUrl:'https://flow.google.com/u/1/project/new'}}
  }})
  assert.equal(rotated,true)
  assert.deepEqual(generations.map(p=>p.shots.length),[10,10,6])
  assert.equal(generations[1].newProject,true)
  assert.equal(generations[1].expectedAccount,'b@x.com')
  assert.equal(generations[2].projectUrl,'https://flow.google.com/u/1/project/new')
  assert.equal(result.files.length,26)
})

test('incomplete image batches return their saved partials without advancing or believing claimed counts', async()=>{
  let calls=0
  const shots=Array.from({length:26},(_,i)=>({filename:`shot-${i}.png`}))
  const result=await F.generateWithFailover({payload:{shots},promptFor:()=>'',runJob:async()=>{calls++;return {files:['shot-0.png'],meta:{named:26,expected:26}}}})
  assert.equal(calls,1)
  assert.equal(result.meta.named,1)
  assert.equal(result.meta.expected,26)
})
