// เทสต์: ผลิตต่อเนื่อง → โพสต์อัตโนมัติ เลือกเพจได้ (ทุกเพจ / แบ่งเพจ: เพจ 1 กี่คลิป เพจ 2 กี่คลิป)
//   node scripts/test-production-pages.mjs
// ไม่แตะคิว/บัญชีจริง — เทสต์ฟังก์ชันล้วน + โปรไฟล์คลิปจำลองใน temp
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pageSequence, clipCategory, acceptsCategory } from '../pipeline/lib/posting.mjs'
import { cleanSettings, DEFAULT_SETTINGS } from '../bridge/production.js'
import { CATEGORIES } from '../extension/prompts.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
let passed = 0
const test = (name, fn) => {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

test('แบ่งเพจ 3/2 → สลับกัน ครบ 5 คลิป (เพจ 1 = 3 · เพจ 2 = 2)', () => {
  const seq = pageSequence({ 'fb:a': 3, 'fb:b': 2 }, ['fb:a', 'fb:b'])
  assert.deepEqual(seq, ['fb:a', 'fb:b', 'fb:a', 'fb:b', 'fb:a'])
  assert.equal(seq.filter((k) => k === 'fb:a').length, 3)
  assert.equal(seq.filter((k) => k === 'fb:b').length, 2)
})

test('เพจที่ใส่ 0 / เพจที่ถูกลบไปแล้ว ไม่ได้คลิป', () => {
  assert.deepEqual(pageSequence({ 'fb:a': 2, 'fb:b': 0, 'fb:gone': 5 }, ['fb:a', 'fb:b']), ['fb:a', 'fb:a'])
  assert.deepEqual(pageSequence({}, ['fb:a']), [])
  assert.deepEqual(pageSequence({ 'fb:a': 1, 'yt:c': 1 }, ['fb:a', 'yt:c']), ['fb:a', 'yt:c'])
})

test('ตั้งค่า: ค่าเริ่มต้นเป็นทุกเพจ · รับแบ่งเพจ · ตัดค่าแปลกทิ้ง', () => {
  assert.equal(DEFAULT_SETTINGS.postPages, 'all')
  const s = cleanSettings({ postPages: 'split', pageQuota: { 'fb:a': 3, 'fb:b': '2', 'evil key': 9, 'fb:c': -1, 'fb:d': 'x', 'yt:e': 500 } })
  assert.equal(s.postPages, 'split')
  assert.deepEqual(s.pageQuota, { 'fb:a': 3, 'fb:b': 2, 'yt:e': 100 })
  assert.equal(cleanSettings({ postPages: 'nope' }).postPages, 'all')
  // ไม่ส่ง pageQuota มา → ใช้ของเดิม และไม่แชร์ object กับของเดิม
  const kept = cleanSettings({}, s)
  assert.deepEqual(kept.pageQuota, s.pageQuota)
  assert.notEqual(kept.pageQuota, s.pageQuota)
})

test('แบ่งปลายทาง TikTok ร่วมกับ Facebook ได้ และคงโควตาหลังอ่านค่ากลับ', () => {
  const settings = cleanSettings({ postPages: 'split', pageQuota: { 'tk:account-1': 2, 'fb:page-1': 1, 'xx:unknown': 3 } })
  assert.deepEqual(settings.pageQuota, { 'tk:account-1': 2, 'fb:page-1': 1 })
  assert.deepEqual(cleanSettings({}, settings).pageQuota, settings.pageQuota)
  assert.deepEqual(pageSequence(settings.pageQuota, ['tk:account-1', 'fb:page-1']), ['tk:account-1', 'fb:page-1', 'tk:account-1'])
})

test('หมวดของคลิปอ่านจากโปรไฟล์ → เพจที่ตั้งหมวดไว้รับคลิปจากผลิตต่อเนื่องได้ (เดิมค้างในคิว)', () => {
  const root = mkdtempSync(join(tmpdir(), 'dhamma-pages-'))
  try {
    mkdirSync(join(root, 'projects', 'clip-a', '00_ref'), { recursive: true })
    writeFileSync(join(root, 'projects', 'clip-a', '00_ref', 'profile.json'), JSON.stringify({ category: 'buddha', title: 'x' }))
    const name = clipCategory('clip-a', root)
    assert.equal(name, CATEGORIES.find((c) => c.id === 'buddha').name)
    assert.equal(acceptsCategory({ categories: [name] }, name), true)
    assert.equal(acceptsCategory({ categories: [name] }, null), false) // ของเดิม: ไม่มีหมวด = เพจนี้ไม่รับ
    assert.equal(clipCategory('missing', root), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ต่อสายครบ: production ส่งเพจให้ posting · posting ใช้เพจที่แบ่งให้ · แผงมีปุ่มทุกเพจ/แบ่งเพจ', () => {
  const prodSrc = readFileSync(join(ROOT, 'bridge', 'production.js'), 'utf8')
  const postSrc = readFileSync(join(ROOT, 'bridge', 'posting.js'), 'utf8')
  const server = readFileSync(join(ROOT, 'bridge', 'server.js'), 'utf8')
  const html = readFileSync(join(ROOT, 'extension', 'sidepanel.html'), 'utf8')
  const js = readFileSync(join(ROOT, 'extension', 'sidepanel.js'), 'utf8')
  assert.match(prodSrc, /api\.onClipReady\(result\.slug, settings\.autoPost, pages\)/)
  assert.match(server, /onClipReady = \(slug, mode, pages\) => posting\.enqueueAuto\(slug, mode, pages\)/)
  assert.match(postSrc, /async function enqueueAuto\(slug, mode = 'ai', pages = null\)/)
  assert.match(postSrc, /item\.targetsEdited = true/)
  assert.match(html, /id="prodPages"[\s\S]*data-value="all"[\s\S]*data-value="split"/)
  assert.match(js, /pageQuota: Object\.fromEntries/)
  // view ส่งชื่อเพจเท่านั้น ไม่ส่ง token
  assert.match(prodSrc, /return \{ key, kind, name: account\?\.name \?\? key \}/)
})

console.log(`\nผ่าน ${passed} ข้อ`)
