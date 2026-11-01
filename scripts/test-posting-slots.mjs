// เทสต์: ช่องเวลาโพสต์ประจำวันเป็นตาราง (เลือกเวลา · ลบ · ＋ เพิ่มเวลา) แทนการพิมพ์คั่นด้วยจุลภาค
//   node scripts/test-posting-slots.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { suggestSlot } from '../extension/posting.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
let passed = 0
const test = (name, fn) => {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

test('＋ เพิ่มเวลา: ยังไม่มีเลย → เที่ยงวัน', () => {
  assert.equal(suggestSlot([]), '12:00')
})

test('＋ เพิ่มเวลา: ต่อจากเวลาสุดท้าย 3 ชั่วโมง', () => {
  assert.equal(suggestSlot(['12:00', '19:00']), '22:00')
  assert.equal(suggestSlot(['09:30']), '12:30')
})

test('＋ เพิ่มเวลา: เลยเที่ยงคืนวนกลับ และไม่ซ้ำเวลาที่มีอยู่', () => {
  assert.equal(suggestSlot(['22:00']), '01:00')
  assert.equal(suggestSlot(['01:00', '22:00']), '04:00') // 22+3 = 01 ซ้ำ → ขยับต่อ
})

test('แผง: ไม่มีช่องพิมพ์คั่นจุลภาคแล้ว · มีตารางเวลา ลบได้ เพิ่มได้ · ห้ามลบช่องสุดท้าย', () => {
  const js = readFileSync(join(ROOT, 'extension', 'posting.js'), 'utf8')
  assert.ok(!js.includes("placeholder: '12:00, 19:00'"), 'ต้องเลิกใช้ช่องพิมพ์คั่นจุลภาค')
  assert.match(js, /type: 'time'/)
  assert.match(js, /＋ เพิ่มเวลา/)
  assert.match(js, /disabled: list\.length <= 1/)
})

console.log(`\nผ่าน ${passed} ข้อ`)
