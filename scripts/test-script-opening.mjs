// เทสต์: บทและข้อความโพสต์ต้องไม่ขึ้นต้นด้วย "คุณเคย…ไหม" — เข้าเรื่องเลย
//   node scripts/test-script-opening.mjs
// เคยเป็น (พ.ย. 2026): 32 จาก 37 คลิปขึ้นต้น "คุณเคย…ไหม" ผู้ใช้บอกว่าเชย น่าเบื่อ
import assert from 'node:assert/strict'
import { opensWithHaveYouEver, scriptPrompt } from '../extension/prompts.js'
import { postPrompt } from '../pipeline/lib/post.mjs'

let passed = 0
const test = (name, fn) => {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

test('จับบทที่ขึ้นต้น "คุณเคย…ไหม" ทั้งบรรทัดเดียวและคำถามข้ามบรรทัด (เคสจริง)', () => {
  assert.equal(opensWithHaveYouEver('คุณเคยผัดวันประกันพรุ่งไหม...\nทั้งที่รู้ว่างานนั้นสำคัญ'), true)
  assert.equal(opensWithHaveYouEver('คุณเคยโกรธใครบางคน...\nจนหัวใจเต้นแรงไหม'), true)
  assert.equal(opensWithHaveYouEver('คุณเคยไหม...\nถูกตำหนิเพียงไม่กี่คำ'), true)
  assert.equal(opensWithHaveYouEver('เคยไหม... งานยังไม่เสร็จ แต่ใจกลับเหนื่อย'), true)
  assert.equal(opensWithHaveYouEver('บทพากย์ 1 นาที — การให้อภัยตัวเอง\nคุณเคยทำผิดพลาด...\nแล้วให้อภัยตัวเองไม่ได้ไหม'), true, 'มีหัวเรื่องนำ 1 บรรทัด')
  assert.equal(opensWithHaveYouEver('Have you ever felt alone?'), true)
  assert.equal(opensWithHaveYouEver('你有没有想过'), true)
})

test('ไม่จับบทที่เข้าเรื่องเลย หรือมีคำถามสะท้อนใจกลางบท', () => {
  assert.equal(opensWithHaveYouEver('ตีสองแล้ว... คุณยังนอนไม่หลับ\nเขาพูดแค่ประโยคเดียว\nแล้วตอนนี้... ใจคุณถือลูกศรดอกไหนอยู่ไหม'), false)
  assert.equal(opensWithHaveYouEver('ถ้าวันหนึ่งคุณรู้ว่า...\nเหลือเวลาอยู่กับคนที่รัก'), false)
  assert.equal(opensWithHaveYouEver('เคยมีชายคนหนึ่ง\nอาศัยอยู่ริมแม่น้ำ\nทุกวันเขาตักน้ำ'), false, 'เล่านิทาน "เคยมี…" ไม่ใช่คำถาม')
  assert.equal(opensWithHaveYouEver(''), false)
})

test('prompt บทพากย์และข้อความโพสต์ห้าม "คุณเคย…ไหม" ชัดเจน', () => {
  assert.match(scriptPrompt('BLUEPRINT', 'หัวข้อ'), /ห้ามขึ้นต้นด้วยคำถามชวนนึก "คุณเคย…ไหม/)
  assert.match(postPrompt({ title: 'หัวข้อ', script: 'บท' }), /ห้ามใช้รูป "คุณเคย…ไหม/)
})

console.log(`\nผ่าน ${passed} ข้อ`)
