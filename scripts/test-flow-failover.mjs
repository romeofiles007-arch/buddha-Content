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
