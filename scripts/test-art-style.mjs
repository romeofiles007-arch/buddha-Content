// เทสต์: ลายเส้นภาพ — เอา "ภาพวาดจีน" ออกแล้ว และทุกลายเส้นห้ามภาพมีขอบขาว/เป็นภาพบนกระดาษ
//   node scripts/test-art-style.mjs
// เคยเป็น (พ.ย. 2026): ภาพวาดจีนดูล้าหลัง ไม่ได้รับความนิยม ภาพออกมามีขอบขาวเหมือนภาพบนกระดาษ ไกลตัว
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ART_STYLES, RETIRED_ART_STYLES, FULL_BLEED_RULE } from '../extension/prompts.js'
import { ROOT } from '../pipeline/lib/config.mjs'
import { readProfile } from '../pipeline/lib/clip_profile.mjs'
import { flowPrompt } from '../pipeline/lib/prompts.mjs'

let passed = 0
const test = (name, fn) => {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

test('เลือกได้เฉพาะ การ์ตูน doodle / สีน้ำพุทธกาล / สุ่ม — ไม่มีภาพวาดจีน', () => {
  assert.deepEqual(Object.keys(ART_STYLES), ['doodle', 'watercolor', 'random'])
  assert.ok(!Object.values(ART_STYLES).some((s) => /จีน|Chinese|rice-paper|scroll/i.test(JSON.stringify(s))))
})

test('สีน้ำพุทธกาลไม่มี "paper texture" แล้ว และสั่งเต็มเฟรมไม่มีขอบขาว', () => {
  const w = ART_STYLES.watercolor
  assert.ok(!/paper texture/i.test(w.rule))
  assert.match(w.rule, /full-bleed, no paper border, no white margin/)
  assert.ok(w.rule.includes(FULL_BLEED_RULE))
  assert.match(w.flow, /ไม่มีขอบขาว/)
})

test('คลิปเก่าที่เป็นภาพวาดจีน อ่านเป็นสีน้ำพุทธกาล (ไม่แก้ไฟล์ของคลิป)', () => {
  const slug = `_test_art_style_${process.pid}`
  const dir = join(ROOT, 'projects', slug, '00_ref')
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'profile.json'), JSON.stringify({ category: 'dhamma', artStyle: 'chinese' }))
    assert.equal(RETIRED_ART_STYLES.chinese, 'watercolor')
    assert.equal(readProfile(slug).artStyle, 'watercolor')
    // คำสั่งที่ส่งให้ Flow ใช้ลายเส้นสีน้ำ + กฎเต็มเฟรม ไม่มีคำของภาพวาดจีน
    const prompt = flowPrompt('BRIEF', {}, slug)
    assert.ok(prompt.includes(ART_STYLES.watercolor.flow))
    assert.ok(prompt.includes(FULL_BLEED_RULE))
    assert.ok(!/กระดาษสา|หมึกจีน/.test(prompt))
  } finally {
    rmSync(join(ROOT, 'projects', slug), { recursive: true, force: true })
  }
})

test('การ์ตูน doodle ก็ได้กฎเต็มเฟรมไม่มีขอบขาว', () => {
  assert.ok(flowPrompt('BRIEF', {}, null).includes(FULL_BLEED_RULE))
})

console.log(`\nผ่าน ${passed} ข้อ`)
