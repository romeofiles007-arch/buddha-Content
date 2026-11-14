// เทสต์: พระพุทธเจ้าของฉัน — แนบภาพอ้างอิงเอง แทนพระพุทธรูปที่ระบบโหลดจากวิกิพีเดีย (หมวด 1)
//   node scripts/test-my-buddha.mjs
// ไม่ต่อเน็ต ไม่แตะภาพของผู้ใช้: ที่เก็บเทสต์ในโฟลเดอร์ชั่วคราว · ขั้นคัดลอกเข้าคลิปทดสอบเฉพาะตอนที่ยังไม่มีภาพของผู้ใช้
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readMyBuddha, updateMyBuddha, addMyBuddhaImage, removeMyBuddhaImage, myBuddhaReady, MY_BUDDHA_DIR, MAX_MY_BUDDHA_IMAGES } from '../pipeline/lib/my_buddha.mjs'
import { ensureProfile, refDir } from '../pipeline/lib/clip_profile.mjs'
import { categoryRule } from '../extension/prompts.js'
import { activeCharacter, characterRule, characterFlowNote } from '../pipeline/lib/character.mjs'
import { ROOT } from '../pipeline/lib/config.mjs'

let passed = 0
const test = (name, fn) => {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}
const asyncTest = async (name, fn) => {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const image = () => ({ type: 'image/png', base64: PNG })

// ── ที่เก็บภาพ (ใช้โฟลเดอร์ชั่วคราว ไม่แตะ characters/buddha ของผู้ใช้) ──
const box = mkdtempSync(join(tmpdir(), 'my-buddha-'))
try {
  test('ยังไม่แนบ = ไม่พร้อม · แนบแล้ว = พร้อม และไฟล์ขึ้นต้นด้วย buddha_', () => {
    assert.equal(myBuddhaReady(box), false)
    const after = addMyBuddhaImage(image(), box)
    assert.equal(after.images.length, 1)
    assert.match(after.images[0], /^buddha_.*\.png$/)
    assert.equal(myBuddhaReady(box), true)
  })

  test('รายละเอียดเพิ่มเติมเก็บไว้ได้ · ลบรูปได้ · ลบด้วยชื่อแปลกไม่ได้', () => {
    assert.equal(updateMyBuddha({ description: 'จีวรสีกรักเข้ม พระพักตร์อิ่มเอิบ' }, box).description, 'จีวรสีกรักเข้ม พระพักตร์อิ่มเอิบ')
    const name = readMyBuddha(box).images[0]
    assert.throws(() => removeMyBuddhaImage('../../secret.png', box), /ไม่พบรูปนี้/)
    assert.equal(removeMyBuddhaImage(name, box).images.length, 0)
    assert.equal(readMyBuddha(box).description, 'จีวรสีกรักเข้ม พระพักตร์อิ่มเอิบ')
  })

  test(`ใส่ได้สูงสุด ${MAX_MY_BUDDHA_IMAGES} รูป`, () => {
    for (let i = 0; i < MAX_MY_BUDDHA_IMAGES; i++) addMyBuddhaImage(image(), box)
    assert.throws(() => addMyBuddhaImage(image(), box), /สูงสุด/)
    for (const n of readMyBuddha(box).images) removeMyBuddhaImage(n, box)
  })
} finally {
  rmSync(box, { recursive: true, force: true })
}

// ── คำสั่งที่ส่งให้ ChatGPT / Flow ──
const mineProfile = { category: 'buddha', artStyle: 'cinematic', buddha: { mine: true, note: 'จีวรสีกรักเข้ม', images: [{ file: 'buddha_1.png' }] } }
const wikiProfile = { category: 'buddha', artStyle: 'cinematic', buddha: { images: [{ file: 'buddha_1.jpg' }] } }

test('แนบเอง: บอกว่าเป็นภาพที่เลือกไว้เอง + ใส่รายละเอียดที่ขอ · ไม่แนบ: พระพุทธรูปไทยเหมือนเดิม', () => {
  const mine = categoryRule(mineProfile, 'image')
  assert.match(mine, /ภาพอ้างอิงพระพุทธเจ้าที่เลือกไว้เอง/)
  assert.match(mine, /จีวรสีกรักเข้ม/)
  assert.doesNotMatch(mine, /รูปที่แนบคือพระพุทธรูปไทย/)
  assert.match(categoryRule(wikiProfile, 'image'), /รูปที่แนบคือพระพุทธรูปไทย/)
})

test('Character Bible + คำกำกับ Flow พูดถึงภาพที่เลือกไว้เอง และยังล็อกพระพักตร์ทุกช็อต', () => {
  const c = { enabled: true, description: '', images: ['buddha_1.png'], buddha: true, buddhaMine: true }
  assert.match(characterRule(c, mineProfile), /ภาพอ้างอิงพระพุทธเจ้าที่เลือกไว้เอง/)
  assert.match(characterFlowNote(c, mineProfile), /ล็อกพระพักตร์/)
  // ไม่ได้แนบเอง = ข้อความเดิม
  const w = { ...c, buddhaMine: false }
  assert.match(characterRule(w, wikiProfile), /พระพุทธรูปไทย/)
  assert.match(characterFlowNote(w, wikiProfile), /รูปที่แนบคือพระพุทธรูป/)
})

// ── คลิปใหม่หยิบภาพที่แนบเองไปใช้ (ไม่ยิงวิกิพีเดีย) ──
await asyncTest('คลิปหมวด 1: ภาพที่แนบเองถูกคัดลอกเข้าคลิปเป็น buddha_1.. และ profile บอกว่า mine', async () => {
  const had = myBuddhaReady()
  if (!had) addMyBuddhaImage(image())
  const slug = `_test_my_buddha_${process.pid}`
  try {
    const profile = await ensureProfile(slug, { title: 'พระพุทธเจ้าตรัสถึงความไม่เที่ยง', log: () => {} })
    assert.equal(profile.category, 'buddha')
    assert.equal(profile.buddha.mine, true)
    assert.ok(profile.buddha.images.length >= 1)
    for (const i of profile.buddha.images) {
      assert.match(i.file, /^buddha_\d+\./)
      assert.ok(existsSync(join(refDir(slug), i.file)), `ไม่พบ ${i.file} ในคลิป`)
    }
    assert.equal(profile.buddha.images.length, readMyBuddha().images.length)
  } finally {
    rmSync(join(ROOT, 'projects', slug), { recursive: true, force: true })
    // ภาพที่เทสต์ใส่เองเท่านั้นที่ลบ — ภาพของผู้ใช้ไม่ยุ่ง
    if (!had) for (const n of readMyBuddha().images) removeMyBuddhaImage(n)
  }
})

// ── แนบภาพทีหลัง: คลิปที่ทำค้างอยู่ต้องเปลี่ยนมาใช้ภาพที่แนบ ถ้ายังไม่ได้ลงภาพสักใบ ──
const stale = (slug) => {
  mkdirSync(refDir(slug), { recursive: true })
  writeFileSync(join(refDir(slug), 'buddha_9.jpg'), 'ภาพพระพุทธรูปชุดเก่า')
  writeFileSync(join(refDir(slug), 'profile.json'), JSON.stringify({
    category: 'buddha',
    title: 'พระพุทธเจ้าตรัสถึงความไม่เที่ยง',
    artStyle: 'watercolor',
    narration: 'teach',
    buddha: { fetchedAt: 1, images: [{ file: 'buddha_9.jpg', name: 'พระพุทธชินราช' }] },
  }))
}

await asyncTest('แนบภาพทีหลัง: คลิปที่ยังไม่ได้ลงภาพ เปลี่ยนมาใช้ภาพที่แนบ และลบพระพุทธรูปชุดเก่าทิ้ง', async () => {
  const had = myBuddhaReady()
  if (!had) addMyBuddhaImage(image())
  const slug = `_test_my_buddha_swap_${process.pid}`
  try {
    stale(slug)
    const profile = await ensureProfile(slug, { title: 'พระพุทธเจ้าตรัสถึงความไม่เที่ยง', log: () => {} })
    assert.equal(profile.buddha.mine, true)
    assert.equal(profile.artStyle, 'watercolor', 'ลายเส้นของคลิปต้องไม่ถูกเขียนทับ')
    assert.ok(!existsSync(join(refDir(slug), 'buddha_9.jpg')), 'พระพุทธรูปชุดเก่ายังค้างอยู่ใน 00_ref')
    assert.equal(readdirSync(refDir(slug)).filter((f) => f.startsWith('buddha_')).length, readMyBuddha().images.length)
  } finally {
    rmSync(join(ROOT, 'projects', slug), { recursive: true, force: true })
    if (!had) for (const n of readMyBuddha().images) removeMyBuddhaImage(n)
  }
})

await asyncTest('คลิปที่ลงภาพไปแล้ว ไม่เปลี่ยนพระกลางคัน (คลิปหน้าถึงใช้ภาพที่แนบ)', async () => {
  const had = myBuddhaReady()
  if (!had) addMyBuddhaImage(image())
  const slug = `_test_my_buddha_keep_${process.pid}`
  try {
    stale(slug)
    mkdirSync(join(ROOT, 'projects', slug, '05_images'), { recursive: true })
    writeFileSync(join(ROOT, 'projects', slug, '05_images', '00_00_00.png'), 'ภาพที่ลงไปแล้ว')
    const profile = await ensureProfile(slug, { title: 'พระพุทธเจ้าตรัสถึงความไม่เที่ยง', log: () => {} })
    assert.notEqual(profile.buddha.mine, true)
    assert.ok(existsSync(join(refDir(slug), 'buddha_9.jpg')))
  } finally {
    rmSync(join(ROOT, 'projects', slug), { recursive: true, force: true })
    if (!had) for (const n of readMyBuddha().images) removeMyBuddhaImage(n)
  }
})

test('ไม่มีภาพของผู้ใช้ค้างไว้จากเทสต์', () => {
  if (!existsSync(MY_BUDDHA_DIR)) return
  assert.ok(readdirSync(MY_BUDDHA_DIR).every((f) => f === 'monk.json' || readMyBuddha().images.includes(f)))
})

console.log(`\nผ่าน ${passed} ข้อ`)
