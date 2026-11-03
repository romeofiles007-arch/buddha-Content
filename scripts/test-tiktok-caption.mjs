import test from 'node:test'
import assert from 'node:assert/strict'
import { insertTikTokCaption } from '../extension/tiktok-caption.js'
test('trusted caption input selects text inside the focused editor, then inserts exact text',async()=>{
 const calls=[];await insertTikTokCaption(async(method,params)=>{calls.push({method,params});return {result:{value:true}}},'ข้อความ “รัก”\n#ธรรมะ')
 assert.deepEqual(calls.map(c=>c.method),['Runtime.evaluate','Input.dispatchKeyEvent','Input.dispatchKeyEvent','Input.insertText'])
 assert.equal(calls[1].params.modifiers,2)
 assert.equal(calls.at(-1).params.text,'ข้อความ “รัก”\n#ธรรมะ')
})
test('missing or ambiguous editor stops before any text input',async()=>{
 const calls=[];await assert.rejects(()=>insertTikTokCaption(async(method)=>{calls.push(method);return {result:{value:false}}},'caption'),/คำบรรยาย/)
 assert.deepEqual(calls,['Runtime.evaluate'])
})
