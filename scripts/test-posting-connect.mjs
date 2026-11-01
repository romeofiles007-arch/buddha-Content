// เทสต์: กรอก Client ID/secret ของ Drive (หรือ YouTube) แล้วกด "เชื่อมต่อ" ได้เลย ไม่ต้องหาปุ่มบันทึกก่อน
//   node scripts/test-posting-connect.mjs
// เคยเป็น: ปุ่มเชื่อมต่อเป็นสีเทากดไม่ได้จนกว่าจะกดบันทึก และหน้าตั้งค่าวาดใหม่ทุก 6 วินาที
// ลบค่าที่วางไว้ทิ้ง — ผู้ใช้กรอกแล้วแต่เชื่อมต่อไม่ได้
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clientToSave } from '../extension/posting.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const ID = '123-abc.apps.googleusercontent.com'
const empty = { clientId: '', clientSecret: '', ready: false }
const saved = { clientId: ID, clientSecret: '••••wxyz', ready: true }
let passed = 0
const test = (name, fn) => {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

test('ยังไม่เคยบันทึก แต่กรอกครบ → บันทึกให้ก่อนเชื่อมต่อ', () => {
  assert.deepEqual(clientToSave({ clientId: ` ${ID} `, clientSecret: ' GOCSPX-new ' }, empty), { save: { clientId: ID, clientSecret: 'GOCSPX-new' } })
})

test('บันทึกไว้แล้วและไม่ได้แก้ → เชื่อมต่อเลย ไม่บันทึกซ้ำ', () => {
  assert.deepEqual(clientToSave({ clientId: ID, clientSecret: '••••wxyz' }, saved), {})
})

test('บันทึกไว้แล้ว แต่วาง secret ใหม่ → บันทึกใหม่ก่อน', () => {
  assert.deepEqual(clientToSave({ clientId: ID, clientSecret: 'GOCSPX-other' }, saved), { save: { clientId: ID, clientSecret: 'GOCSPX-other' } })
})

test('ยังไม่เคยบันทึกและกรอกไม่ครบ → บอกว่าขาดอะไร ไม่ยิงไปเชื่อมต่อ', () => {
  assert.match(clientToSave({ clientId: '', clientSecret: '' }, empty).error, /Client ID และ Client secret/)
  assert.match(clientToSave({ clientId: ID, clientSecret: '' }, empty).error, /Client secret/)
  assert.match(clientToSave({ clientId: '', clientSecret: 'GOCSPX-x' }, empty).error, /Client ID/)
})

test('แผง: ปุ่มเชื่อมต่อไม่ล็อกเทา · วาดใหม่อัตโนมัติไม่ทับค่าที่พิมพ์ค้างไว้', () => {
  const js = readFileSync(join(ROOT, 'extension', 'posting.js'), 'utf8')
  assert.ok(!js.includes('disabled: !dc.ready'), 'ปุ่มเชื่อมต่อ Drive ต้องกดได้ตอนกรอกแล้ว')
  assert.ok(!js.includes('disabled: !g.ready'), 'ปุ่มเชื่อมต่อ YouTube ต้องกดได้ตอนกรอกแล้ว')
  const refresh = js.slice(js.indexOf('async function refresh()'), js.indexOf('// ── ชื่อเพจ/ช่องจากรหัสปลายทาง'))
  assert.match(refresh, /if \(typedUnsaved\(\)\) return/)
  assert.match(js, /dataset\.saved = /)
})

console.log(`\nผ่าน ${passed} ข้อ`)
