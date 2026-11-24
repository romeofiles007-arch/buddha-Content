// แผงข้างบอกว่าแท็บที่เปิดอยู่เป็นงานของระบบอื่น (extension/foreign-tab.js) + รายการโปรเจกต์ Flow ของคลิปธรรมะ (bridge/project.js)
// รัน: node scripts/test-foreign-tab.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { foreignTab, foreignTabText, flowProjectId } from '../extension/foreign-tab.js'
import { flowProjectIds } from '../bridge/project.js'

let passed = 0
const test = (name, fn) => {
  fn()
  passed++
  console.log(`✓ ${name}`)
}

const NOW = 1_800_000_000_000
const OWN = 'ojcbjifgnjdhlejofmcnajpdnmmpgpof'
const CARTOON = { id: 'odeogehiomlnlgododiodnoojdaofclp', name: 'Cartoon Auto Bridge', at: NOW - 60_000 }
const MINE = new Set(['7536def6-c2c8-4259-9b74-f200fc1873f2'])
const url = (id) => `https://flow.google.com/project/${id}`

test('อ่าน id โปรเจกต์จาก url ของ Flow ทั้งสองโดเมน · หน้าอื่นไม่มี id', () => {
  assert.equal(flowProjectId(url('0D00EB1B-edee-437d-8c38-2b9e416fb42e')), '0d00eb1b-edee-437d-8c38-2b9e416fb42e')
  assert.equal(flowProjectId('https://labs.google/fx/tools/flow/project/7536def6-c2c8-4259-9b74-f200fc1873f2/edit/x'), '7536def6-c2c8-4259-9b74-f200fc1873f2')
  assert.equal(flowProjectId('https://flow.google.com/'), null)
  assert.equal(flowProjectId('https://example.com/project/7536def6-c2c8'), null)
})

test('โปรเจกต์ Flow ของ Cartoon (ไม่อยู่ในรายการของธรรมะ) → เตือน', () => {
  const found = foreignTab({ url: url('0d00eb1b-edee-437d-8c38-2b9e416fb42e'), claim: null, ownId: OWN, ownProjects: MINE, now: NOW })
  assert.deepEqual(found, { owner: null })
  assert.match(foreignTabText(found), /ไม่ได้สร้างจากคลิปของธรรมะ Auto/)
})

test('โปรเจกต์ของคลิปธรรมะ → ไม่เตือน', () => {
  assert.equal(foreignTab({ url: url('7536DEF6-c2c8-4259-9b74-f200fc1873f2'), claim: null, ownId: OWN, ownProjects: MINE, now: NOW }), null)
})

test('ระบบอื่นถือป้ายแท็บอยู่ → เตือนพร้อมชื่อระบบ (ChatGPT ก็เตือน)', () => {
  const found = foreignTab({ url: 'https://chatgpt.com/c/abc', claim: CARTOON, ownId: OWN, ownProjects: null, now: NOW })
  assert.deepEqual(found, { owner: 'Cartoon Auto Bridge' })
  assert.match(foreignTabText(found), /^Cartoon Auto Bridge กำลังใช้แท็บนี้อยู่/)
})

test('ป้ายของเราเอง → ไม่เตือนแม้โปรเจกต์ยังไม่อยู่ในรายการ (คลิปที่กำลังทำเพิ่งได้โปรเจกต์)', () => {
  const claim = { id: OWN, name: 'ธรรมะ Auto Bridge', at: NOW - 1000 }
  assert.equal(foreignTab({ url: url('11111111-2222-3333-4444-555555555555'), claim, ownId: OWN, ownProjects: MINE, now: NOW }), null)
})

test('ป้ายระบบอื่นหมดอายุแล้ว → ดูจากรายการโปรเจกต์แทน', () => {
  const old = { ...CARTOON, at: NOW - 60 * 60_000 }
  assert.equal(foreignTab({ url: url('7536def6-c2c8-4259-9b74-f200fc1873f2'), claim: old, ownId: OWN, ownProjects: MINE, now: NOW }), null)
  assert.deepEqual(foreignTab({ url: url('0d00eb1b-edee-437d-8c38-2b9e416fb42e'), claim: old, ownId: OWN, ownProjects: MINE, now: NOW }), { owner: null })
})

test('อ่านรายการโปรเจกต์ไม่ได้ (โปรแกรมปิด) · หน้าแรกของ Flow · เว็บอื่น → ไม่เตือน', () => {
  assert.equal(foreignTab({ url: url('0d00eb1b-edee-437d-8c38-2b9e416fb42e'), claim: null, ownId: OWN, ownProjects: null, now: NOW }), null)
  assert.equal(foreignTab({ url: 'https://flow.google.com/', claim: null, ownId: OWN, ownProjects: MINE, now: NOW }), null)
  assert.equal(foreignTab({ url: 'https://www.facebook.com/', claim: CARTOON, ownId: OWN, ownProjects: MINE, now: NOW }), null)
})

test('bridge รวม id โปรเจกต์ Flow จากทุกคลิป + ถังขยะ + โปรเจกต์เก่าก่อนสลับบัญชี', () => {
  const root = mkdtempSync(join(tmpdir(), 'flow-projects-'))
  try {
    const put = (dir, data) => {
      mkdirSync(join(root, dir, '05_images'), { recursive: true })
      writeFileSync(join(root, dir, '05_images', '_flow_project.json'), typeof data === 'string' ? data : JSON.stringify(data))
    }
    put('clip-a', { url: url('AAAAAAAA-0000-0000-0000-000000000001'), at: 1 })
    put('clip-b', { url: url('bbbbbbbb-0000-0000-0000-000000000002'), at: 2, previous: [url('cccccccc-0000-0000-0000-000000000003')] })
    put('_trash/clip-c', { url: url('dddddddd-0000-0000-0000-000000000004'), at: 3 })
    put('broken', '{ not json')
    mkdirSync(join(root, 'no-images'))
    assert.deepEqual(flowProjectIds(root).sort(), [
      'aaaaaaaa-0000-0000-0000-000000000001',
      'bbbbbbbb-0000-0000-0000-000000000002',
      'cccccccc-0000-0000-0000-000000000003',
      'dddddddd-0000-0000-0000-000000000004',
    ])
    assert.deepEqual(flowProjectIds(join(root, 'missing')), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

console.log(`\nผ่าน ${passed} ข้อ`)
