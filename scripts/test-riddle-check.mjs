// เทสต์ตัวตรวจโจทย์ "ไขปริศนาธรรม" (8 พ.ย. 2026: "รูปโลก + มือลบตัว ก" เฉลย "โลภ" — ผิด ใช้ไม่ได้)
//   โจทย์ต้องเป็นภาพของจริงที่อ่านชื่อต่อกันแล้วได้เสียงคำตอบ · ห้ามเล่นกับตัวอักษร · เฉลยกับความหมายไม่ทับกัน
//   node --test scripts/test-riddle-check.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
const R = await import('../pipeline/lib/riddle.mjs')

const line = (s) => `=== RIDDLE ===\nriddle.png | RIDDLE | ${s}`

test('โจทย์ในภาพที่ผู้ใช้ส่งมา (โลก + ลบ ก = โลภ) ใช้ไม่ได้', () => {
  const text = line('ANSWER: โลภ | PIECES: ลูกโลก = โลก + มือใช้ยางลบลบตัวอักษร ก = ลบ ก | MEANING: ความโลภคือความอยากได้')
  assert.equal(R.parseRiddle(text), null)
  assert.match(R.riddleProblem(R.parseRiddleDraft(text)), /เล่นกับตัวอักษร/)
})

test('อ่านชื่อภาพต่อกันไม่ตรงคำอ่าน → ใช้ไม่ได้ (ระวังตัวสะกด: โลภ อ่าน โลบ ไม่ใช่ โลก)', () => {
  const text = line('ANSWER: โลภ | READ: โลบ | PIECES: ลูกโลก = โลก + ใบไม้ = ใบ | MEANING: x')
  assert.equal(R.parseRiddle(text), null)
  assert.match(R.riddleProblem(R.parseRiddleDraft(text)), /ไม่ตรงกับคำตอบ/)
})

test('โจทย์ที่ถูก: ตรงตัวสะกด หรือตรงคำอ่านทุกพยางค์', () => {
  const a = R.parseRiddle(line('ANSWER: "ขันติ" | PIECES: ขันน้ำ = ขัน + ตีกลอง = ติ | MEANING: ความอดทน'))
  assert.ok(a, 'ขัน + ติ = ขันติ')
  const b = R.parseRiddle(line('ANSWER: สติ | READ: สะ-ติ | PIECES: สะพาน = สะ + ตีกลอง = ติ | MEANING: ความระลึกได้'))
  assert.ok(b, 'สะ + ติ ตรงคำอ่าน สะ-ติ')
  assert.equal(b.read, 'สะ-ติ')
})

test('ชื่อสิ่งของธรรมดาไม่โดนตีว่าเล่นกับตัวอักษร (สระน้ำ · ตัวละคร · กบ)', () => {
  assert.equal(R.riddleProblem({ answer: 'สระกบ', pieces: [{ picture: 'สระน้ำ', sound: 'สระ' }, { picture: 'ตัวกบ', sound: 'กบ' }] }), null)
})

test('ชิ้นเดียว / ไม่บอกคำอ่าน → ใช้ไม่ได้', () => {
  assert.equal(R.parseRiddle(line('ANSWER: สติ | PIECES: ส้ม = ส | MEANING: x')), null)
  assert.match(R.riddleProblem({ answer: 'ขันติ', pieces: [{ picture: 'ขันน้ำ', sound: 'ขัน' }, { picture: 'ตีกลอง', sound: '' }] }), /ไม่ได้บอก/)
})

test('ภาพ Story: เฉลยกับความหมายเป็นคนละกล่อง วางซ้อนกันไม่ทับ · ความหมายยาวถูกตัดไม่ล้นขอบ', () => {
  const ass = R.riddleAss({ answer: 'ขันติ', pieces: [{ picture: 'ขันน้ำ', sound: 'ขัน' }, { picture: 'ตีกลอง', sound: 'ติ' }], meaning: 'ความอดทนอดกลั้นต่อสิ่งที่ไม่ชอบใจ ไม่โกรธตอบ ไม่ทำร้ายใคร แม้จะถูกกระทำ และรักษาใจให้สงบอยู่เสมอทุกสถานการณ์' })
  const ans = ass.split('\n').find((l) => l.includes(',Ans,'))
  const mean = ass.split('\n').find((l) => l.includes(',Mean,'))
  assert.ok(ans && mean, 'แยกเป็น 2 บรรทัดคำสั่ง')
  assert.ok(!ans.includes('\\N'), 'เฉลยไม่มีบรรทัดที่สองในกล่องเดียวกัน')
  assert.match(ans, /,0,0,102,,เฉลย: ขันติ \(ขัน \+ ติ\)$/, 'เฉลยยกขึ้นเหนือบรรทัดความหมาย')
  assert.ok([...mean.split(',,').pop()].length <= 49, 'ความหมายบรรทัดเดียว ไม่เกิน 48 ตัว + …')
  assert.ok(mean.endsWith('…'))
})
