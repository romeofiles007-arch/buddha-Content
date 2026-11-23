// เทสต์: หน้าเปิดดู/แก้ภาพของ Flow (…/project/<id>/edit/<assetId>) ค้างอยู่ → งานถัดไปต้องกลับหน้าโปรเจกต์เอง
//   node scripts/test-flow-navigation.mjs
// 13 พ.ย. 2026: แท็บ Flow ค้างที่หน้าแก้ภาพ → ไม่มีแถบบน จึงไม่มีปุ่มบัญชี Google
//   → อ่านบัญชีไม่ได้ → แจ้งเป็น "บัญชีติดลิมิตครบ" แล้วหยุดผลิตต่อเนื่องทั้งรอบ
import assert from 'node:assert/strict'
import { flowProjectUrl, flowJobNavigation, flowHomeUrl } from '../extension/flow-navigation.js'

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`) }

const PROJECT = 'https://flow.google.com/u/2/project/85eb9998-dc9a-4c67-b848-c56134470850'
const EDITING = `${PROJECT}/edit/38a662d2-3d83-48aa-bb53-8a1d2d0f4b77`

test('ตัดหน้าย่อย (แก้ภาพ) ให้เหลือ URL ของโปรเจกต์', () => {
  assert.equal(flowProjectUrl(EDITING), `${PROJECT}?hl=en`)
  assert.equal(flowProjectUrl(`${PROJECT}?hl=en`), `${PROJECT}?hl=en`)
  assert.equal(flowProjectUrl(`${EDITING}#anchor`), `${PROJECT}?hl=en`)
})

test('ไม่ใช่หน้าโปรเจกต์ของ Flow → คืนค่าว่าง', () => {
  assert.equal(flowProjectUrl('https://flow.google.com/?hl=en'), '')
  assert.equal(flowProjectUrl('https://labs.google/fx/tools/flow'), '')
  assert.equal(flowProjectUrl(null), '')
})

test('ค้างที่หน้าแก้ภาพของโปรเจกต์เดิม → สั่งกลับหน้าโปรเจกต์ ไม่ใช่ปล่อยให้ทำงานต่อบนหน้านั้น', () => {
  const nav = flowJobNavigation(EDITING, { projectUrl: PROJECT })
  assert.deepEqual(nav, { navigate: true, url: `${PROJECT}?hl=en` })
})

test('projectUrl ที่เคยบันทึกไว้ตอนอยู่หน้าแก้ภาพ ยังนับเป็นโปรเจกต์เดียวกัน', () => {
  const nav = flowJobNavigation(EDITING, { projectUrl: EDITING })
  assert.deepEqual(nav, { navigate: true, url: `${PROJECT}?hl=en` })
  assert.equal(flowJobNavigation(`${PROJECT}?hl=en`, { projectUrl: EDITING }).navigate, false)
})

test('อยู่หน้าโปรเจกต์เดิมอยู่แล้ว → ทำงานต่อที่หน้านั้น ไม่โหลดใหม่', () => {
  const nav = flowJobNavigation(`${PROJECT}?hl=en`, { projectUrl: PROJECT })
  assert.deepEqual(nav, { navigate: false, url: `${PROJECT}?hl=en` })
})

test('เปิดคนละโปรเจกต์อยู่ → หยุดพร้อมบอกวิธีแก้ (ห้ามแอบสลับโปรเจกต์/บัญชี)', () => {
  const other = 'https://flow.google.com/u/2/project/11111111-2222-3333-4444-555555555555'
  const nav = flowJobNavigation(`${other}/edit/99999999-aaaa-bbbb-cccc-dddddddddddd`, { projectUrl: PROJECT })
  assert.equal(nav.navigate, false)
  assert.match(nav.error, /คนละโปรเจกต์/)
})

test('ยังไม่มีโปรเจกต์ของคลิปนี้ → เริ่มที่หน้าแรก Flow แม้ตอนนี้ค้างที่หน้าแก้ภาพ', () => {
  const nav = flowJobNavigation(EDITING, {})
  assert.deepEqual(nav, { navigate: true, url: flowHomeUrl(EDITING) })
  assert.match(nav.url, /^https:\/\/flow\.google\.com\/u\/2\/\?hl=en$/)
})

test('อยู่หน้าอื่นของ Flow (ไม่ใช่โปรเจกต์) → ปล่อยไว้ที่หน้านั้น', () => {
  const nav = flowJobNavigation('https://flow.google.com/?hl=en', { projectUrl: PROJECT })
  assert.deepEqual(nav, { navigate: false, url: 'https://flow.google.com/?hl=en' })
})

test('แท็บค้างที่หน้า "Project not found" (/404) → กลับหน้าแรกของบัญชีเดิม ไม่ปล่อยให้หาปุ่ม New project จนหมดเวลา', () => {
  assert.deepEqual(flowJobNavigation('https://flow.google.com/404?reason=project', { projectUrl: PROJECT }), { navigate: true, url: 'https://flow.google.com/?hl=en' })
  assert.deepEqual(flowJobNavigation('https://flow.google.com/u/2/404?reason=project', {}), { navigate: true, url: 'https://flow.google.com/u/2/?hl=en' })
  assert.equal(flowHomeUrl('https://flow.google.com/u/1/404?reason=project&hl=en'), 'https://flow.google.com/u/1/?hl=en')
})

console.log(`\nผ่าน ${passed} เทสต์`)
