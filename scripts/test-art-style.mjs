// เทสต์: ลายเส้นภาพ — การ์ตูน doodle / สีน้ำพุทธกาล / ภาพยนตร์สมจริง (ไม่มีภาพวาดจีนแล้ว) ทุกลายเส้นห้ามภาพมีขอบขาว/เป็นภาพบนกระดาษ
//   node scripts/test-art-style.mjs
// เคยเป็น (พ.ย. 2026): ภาพวาดจีนดูล้าหลัง ไม่ได้รับความนิยม ภาพออกมามีขอบขาวเหมือนภาพบนกระดาษ ไกลตัว
// พ.ย. 2026: เพิ่ม "ภาพยนตร์สมจริง" — ลายเส้นนี้ต้องไม่มีคำสั่งการ์ตูนหลงไปใน prompt ภาพเลย (ไม่งั้น Flow วาดการ์ตูนทับ)
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ART_STYLES, RETIRED_ART_STYLES, FULL_BLEED_RULE, COLOR_MOOD_RULE, figureStyle, categoryRule } from '../extension/prompts.js'
import { ROOT } from '../pipeline/lib/config.mjs'
import { readProfile } from '../pipeline/lib/clip_profile.mjs'
import { flowPrompt } from '../pipeline/lib/prompts.mjs'
import { characterRule, characterFlowNote, bodyStyleRule, bodyStyleFlowNote } from '../pipeline/lib/character.mjs'

let passed = 0
const test = (name, fn) => {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

test('เลือกได้ 3 ลายเส้น + สุ่ม (การ์ตูน · สีน้ำ · ภาพยนตร์) — ไม่มีภาพวาดจีน', () => {
  assert.deepEqual(Object.keys(ART_STYLES), ['doodle', 'watercolor', 'cinematic', 'random'])
  for (const [id, s] of Object.entries(ART_STYLES)) assert.ok(s.label?.length, `${id} ไม่มี label ให้ปุ่มในแผงข้าง`)
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

// พ.ย. 2026: ภาพออกโทนเหลืองไป — ผู้ใช้ขอโทนเย็นสบายตา หรือปรับตามอารมณ์เรื่อง
test('โทนสีหลักเย็นสบายตาและปรับตามอารมณ์ — ทองใช้แค่จุดเล็ก', () => {
  const prompt = flowPrompt('BRIEF', {}, null)
  assert.ok(prompt.includes(COLOR_MOOD_RULE))
  assert.match(COLOR_MOOD_RULE, /ห้ามทั้งภาพออกโทนเหลือง/)
  assert.ok(!/สีสดอิ่ม/.test(prompt))
  assert.ok(!/golden-saffron and amber|แสงทองเรือง|โทนทองอำพัน/.test(JSON.stringify(ART_STYLES)))
  const blueprint = readFileSync(new URL('../extension/VDO Concept.txt', import.meta.url), 'utf8')
  assert.match(blueprint, /COLOR PALETTE \(base is COOL/)
  assert.match(blueprint, /COLOR MOOD/)
  assert.ok(!/golden dawn, soft candlelight|warm and peaceful mood|SAFFRON ORANGE, DEEP BROWN, or GOLD-YELLOW/.test(blueprint))
})

// ── ภาพยนตร์สมจริง (พ.ย. 2026) — ภาพคนจริงแบบหนัง ไม่ใช่การ์ตูน ──
const CINE = { artStyle: 'cinematic' }
const DOODLE = { artStyle: 'doodle' }
const charBuddha = { enabled: true, description: '', images: ['buddha_1.jpg'], buddha: true }
const charMonk = { enabled: true, description: '', images: ['monk_1.jpg'], monk: 'หลวงปู่ทวด' }

test('ภาพยนตร์สมจริงมีกฎครบทุกที่ที่ใช้ และสั่งเต็มเฟรม', () => {
  for (const k of ['rule', 'flow', 'body', 'bodyFlow', 'figure']) {
    assert.ok(String(ART_STYLES.cinematic[k] ?? '').length > 20, `cinematic.${k} สั้นเกินหรือไม่มี`)
  }
  assert.ok(ART_STYLES.cinematic.rule.includes(FULL_BLEED_RULE))
  assert.match(ART_STYLES.cinematic.rule, /Photorealistic cinematic film still/)
})

test('คำเรียกตัวละครหลัก: cinematic = คนจริง · doodle และไม่รู้ลายเส้น = คำเดิมของ Blueprint', () => {
  assert.match(figureStyle(CINE), /photoreal/)
  assert.match(figureStyle({ artStyle: 'watercolor' }), /สีน้ำ/)
  assert.equal(figureStyle(DOODLE), 'การ์ตูนเต็มตัว')
  assert.equal(figureStyle(null), 'การ์ตูนเต็มตัว')
})

test('หมวดพุทธประวัติ/พระเกจิ: cinematic ไม่สั่งการ์ตูน แต่ยังสั่งให้เคารพ', () => {
  const buddha = { ...CINE, category: 'buddha', narration: 'story', buddha: { images: [{ file: 'buddha_1.jpg' }] } }
  const monk = { ...CINE, category: 'monk', monk: { name: 'หลวงปู่ทวด', images: [{ file: 'monk_1.jpg' }] } }
  for (const p of [buddha, monk]) {
    const rule = categoryRule(p, 'image')
    assert.doesNotMatch(rule, /การ์ตูนเต็มตัว/)
    assert.match(rule, /ภาพยนตร์สมจริง/)
    assert.match(rule, /อย่างเคารพ/)
  }
  // ลายเส้นการ์ตูนต้องไม่เปลี่ยน และกฎลายเส้นไม่หลงไปอยู่ใน prompt บท
  assert.match(categoryRule({ ...monk, artStyle: 'doodle' }, 'image'), /การ์ตูนเต็มตัว/)
  assert.doesNotMatch(categoryRule(buddha, 'script'), /ภาพยนตร์สมจริง/)
})

test('กฎตัวละคร + คำกำกับ Flow เปลี่ยนตามลายเส้นของคลิป', () => {
  for (const c of [charBuddha, charMonk]) {
    for (const text of [characterRule(c, CINE), characterFlowNote(c, CINE)]) {
      assert.doesNotMatch(text, /การ์ตูน/)
      assert.match(text, /photoreal/)
    }
    for (const text of [characterRule(c, DOODLE), characterFlowNote(c, DOODLE)]) assert.match(text, /การ์ตูนเต็มตัว/)
    // ไม่ส่งโปรไฟล์คลิปมา (ไม่มีคลิป/โปรแกรมรุ่นเก่า) = คำเดิม
    assert.match(characterRule(c), /การ์ตูนเต็มตัว/)
    assert.match(characterFlowNote(c), /การ์ตูนเต็มตัว/)
  }
  assert.match(bodyStyleRule(charBuddha, CINE), /photoreal/)
  assert.match(bodyStyleFlowNote(charBuddha, CINE), /photoreal/)
  assert.match(bodyStyleRule(charBuddha, DOODLE), /FULL-BODY MODE/)
})

test('คลิปที่ตั้งลายเส้นภาพยนตร์: คำสั่ง Flow ใช้ลายเส้นนี้ ไม่มีคำสั่งการ์ตูน', () => {
  const slug = `_test_art_style_cine_${process.pid}`
  const dir = join(ROOT, 'projects', slug, '00_ref')
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'profile.json'), JSON.stringify({ category: 'buddha', artStyle: 'cinematic', narration: 'story' }))
    const prompt = flowPrompt('BRIEF', {}, slug)
    assert.ok(prompt.includes(ART_STYLES.cinematic.flow))
    assert.ok(prompt.includes(FULL_BLEED_RULE))
    assert.doesNotMatch(prompt, /การ์ตูน doodle หัวกลมโต|การ์ตูนเต็มตัว/)
  } finally {
    rmSync(join(ROOT, 'projects', slug), { recursive: true, force: true })
  }
})

console.log(`\nผ่าน ${passed} ข้อ`)
