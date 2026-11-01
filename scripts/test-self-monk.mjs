// เทสต์: โหมด "พระสอนธรรม (ตัวเราเอง)" — ผู้ใช้เป็นพระ แนบหน้าตัวเอง บทเป็นพระสอนธรรมเอง
//   node scripts/test-self-monk.mjs
// โหมดนี้เป็นโหมดเฉพาะ: ใช้เมื่อเลือกเองเท่านั้น ไม่ปนกับการคละ/สุ่มหมวด ไม่เดาจากชื่อเรื่อง
// ไม่แตะรูป/ตั้งค่าจริงของผู้ใช้ — ที่เก็บรูปทดสอบใน temp
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATEGORIES, GENRES, MIX_GENRES, categoryOf, pickGenres, scriptPrompt, topicsPrompt, categoryRule, selfMonkName } from '../extension/prompts.js'
import { readSelfMonk, updateSelfMonk, addSelfMonkImage, removeSelfMonkImage, selfMonkReady, MAX_SELF_IMAGES } from '../pipeline/lib/self_monk.mjs'
import { characterRule, characterFlowNote, bodyStyleRule } from '../pipeline/lib/character.mjs'
import { detectCategory } from '../pipeline/lib/clip_profile.mjs'
import { pickClip, DEFAULT_SETTINGS } from '../bridge/production.js'
import { CATEGORIES as POST_CATEGORIES, AI_CATEGORIES, qcPrompt } from '../pipeline/lib/posting.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const SELF = CATEGORIES.find((c) => c.id === 'self')
let passed = 0
const test = (name, fn) => {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

test('มีโหมดพระสอนธรรม เป็นโหมดเฉพาะ — เลือกได้และเป็นหมวดของเพจได้ แต่ไม่อยู่ในการคละ', () => {
  assert.ok(SELF?.exclusive)
  assert.ok(GENRES.includes(SELF.name))
  assert.ok(POST_CATEGORIES.includes(SELF.name), 'เพจต้องติ๊กรับหมวดนี้ได้')
  assert.ok(!MIX_GENRES.includes(SELF.name))
  assert.equal(MIX_GENRES.length, 3)
  assert.equal(categoryOf('self')?.id, 'self')
  assert.equal(categoryOf(SELF.name)?.id, 'self')
})

test('คละหมวด 200 ครั้งไม่เคยได้โหมดพระสอนธรรม · เลือกโหมดนี้ได้ทั้ง 5 หัวข้อ', () => {
  for (let i = 0; i < 40; i++) assert.ok(!pickGenres('mix', 5).includes(SELF.name))
  assert.deepEqual(pickGenres(SELF.name, 5), Array(5).fill(SELF.name))
  const mixPrompt = topicsPrompt('BP', { genre: 'mix' })
  assert.ok(!mixPrompt.includes(SELF.name))
  const selfPrompt = topicsPrompt('BP', { genre: SELF.name })
  assert.match(selfPrompt, /ทั้ง 5 หัวข้อต้องอยู่ในหมวดนี้/)
  assert.ok(selfPrompt.includes(SELF.topics))
})

test('ไม่เดาโหมดนี้จากชื่อเรื่อง — แม้มีคำว่าพระหรืออาตมา', () => {
  for (const t of ['อาตมาจะสอนโยมเรื่องความโกรธ', 'พระสอนธรรม ปล่อยวางอย่างไร', 'โยมคิดมากใช่ไหม']) assert.notEqual(detectCategory(t), 'self')
})

test('บท: พระพูดเอง ใช้ "อาตมา" เรียก "โยม" ห้าม "คุณ" · ไม่ชี้ไป "กฎหมวด" ของ Blueprint', () => {
  const p = scriptPrompt('BP', 'โยมโกรธใครอยู่ไหม', { language: 'th', profile: { category: 'self', self: { name: 'พระอาจารย์ทดสอบ' } } })
  assert.match(p, /ผู้พูดในคลิปคือพระอาจารย์ทดสอบ/)
  assert.match(p, /ใช้ "อาตมา" แทนตัวเอง/)
  assert.match(p, /อวยพรโยม/)
  assert.ok(!p.includes('บุรุษที่ 2 ตลอด ใช้ "คุณ"'), 'ห้ามใช้กฎบุรุษที่ 2 ของภาษาไทย')
  assert.ok(!/กฎหมวด \d/.test(p))
  const en = scriptPrompt('BP', 't', { language: 'en', profile: { category: 'self', self: { name: '' } } })
  assert.match(en, /first person \("I"\)/)
  assert.equal(selfMonkName({ self: { name: '  ' } }), 'พระผู้สอน')
})

test('ภาพ: @monk เป็นพระผู้ใช้ การ์ตูนหน้าเหมือน · ช็อตแรก/สุดท้ายเป็นท่าน', () => {
  const img = categoryRule({ category: 'self', self: { name: 'พระอาจารย์ทดสอบ' } }, 'image')
  assert.match(img, /@monk คือพระอาจารย์ทดสอบ พระผู้สอนในคลิป/)
  assert.match(img, /ช็อตแรกและช็อตสุดท้ายต้องเป็น @monk/)
  assert.ok(!categoryRule({ category: 'self' }, 'image').includes('คือพระผู้สอน พระผู้สอน'))
  const c = { enabled: true, images: ['monk_a.jpg'], selfMonk: 'พระอาจารย์ทดสอบ', selfNote: 'ใส่แว่นกรอบดำ' }
  assert.match(characterRule(c), /ภาพจริงของพระอาจารย์ทดสอบ พระผู้สอนในคลิปนี้/)
  assert.match(characterRule(c), /ใส่แว่นกรอบดำ/)
  assert.match(characterFlowNote(c), /การ์ตูนเต็มตัวหน้าเหมือนท่าน/)
  assert.match(bodyStyleRule(c, { category: 'self', artStyle: 'doodle' }), /FULL-BODY MODE/)
})

test('ที่เก็บรูปหน้าพระ: เพิ่ม/ลบ/ชื่อ · สูงสุด 4 รูป · ลบด้วยชื่อแปลกไม่ได้', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dhamma-self-'))
  try {
    assert.equal(selfMonkReady(dir), false)
    const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')
    let m = addSelfMonkImage({ type: 'image/png', base64: png }, dir)
    assert.equal(m.images.length, 1)
    assert.equal(selfMonkReady(dir), true)
    m = updateSelfMonk({ name: '  พระอาจารย์ทดสอบ  ', description: 'ห่มจีวรสีกรัก' }, dir)
    assert.equal(m.name, 'พระอาจารย์ทดสอบ')
    assert.equal(readSelfMonk(dir).description, 'ห่มจีวรสีกรัก')
    for (let i = 1; i < MAX_SELF_IMAGES; i++) addSelfMonkImage({ type: 'image/jpeg', base64: png }, dir)
    assert.throws(() => addSelfMonkImage({ type: 'image/png', base64: png }, dir), /สูงสุด/)
    assert.throws(() => addSelfMonkImage({ type: 'image/gif', base64: png }, join(dir, 'x')), /PNG/)
    writeFileSync(join(dir, 'other.txt'), 'x')
    assert.throws(() => removeSelfMonkImage('other.txt', dir), /ไม่พบ/)
    assert.throws(() => removeSelfMonkImage('../x', dir), /ไม่พบ/)
    assert.ok(existsSync(join(dir, 'other.txt')))
    const first = readSelfMonk(dir).images[0]
    m = removeSelfMonkImage(first, dir)
    assert.equal(m.images.length, MAX_SELF_IMAGES - 1)
    assert.ok(!existsSync(join(dir, first)))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ผลิตต่อเนื่อง: เลือกโหมดนี้ = ทุกคลิปเป็นโหมดนี้ แม้ติ๊กสุ่มหมวด · หมวดอื่นยังสุ่มได้ตามเดิม', () => {
  const s = { ...DEFAULT_SETTINGS, random: { ...DEFAULT_SETTINGS.random, genre: true } }
  const cfg = (genre) => ({ script: { genre, language: 'th', targetMinutes: 5 } })
  assert.equal(pickClip(s, cfg(SELF.name)).genre, SELF.name)
  assert.equal(pickClip(s, cfg(GENRES[0])).genre, 'mix')
  assert.equal(pickClip({ ...s, random: { ...s.random, genre: false } }, cfg(GENRES[1])).genre, GENRES[1])
})

test('AI ตรวจคลิปเลือกโหมดนี้ไม่ได้ และไม่ทับหมวดของคลิปโหมดนี้', () => {
  assert.ok(!AI_CATEGORIES.includes(SELF.name))
  assert.ok(!qcPrompt({ title: 't', script: 's', seconds: 60, times: [1, 30] }).includes(SELF.name))
  assert.match(read('bridge/posting.js'), /!\(item\.category && !AI_CATEGORIES\.includes\(item\.category\)\)/)
})

test('ต่อสายครบ: ต้องมีรูปก่อนเริ่ม · ส่งหมวดทั้งแบบพิมพ์หัวข้อ · แผงมีกล่องพระของฉัน', () => {
  const runner = read('bridge/runner.js')
  assert.match(runner, /\.\.\.\(autoTopic \? \['--auto-topic'\] : \[title\]\), \.\.\.\(genre \? \['--genre', genre\] : \[\]\)/)
  assert.match(read('pipeline/autopilot.mjs'), /categoryOf\(config\.script\.genre\)\?\.id === 'self' && !selfMonkReady\(\)/)
  assert.match(read('pipeline/lib/clip_profile.mjs'), /category === 'self' && !selfMonkReady\(\)\) throw new Error\(SELF_NOT_READY\)/)
  const ui = read('bridge/ui.js')
  assert.match(ui, /path === '\/api\/self-monk'/)
  assert.match(ui, /categoryOf\(genre\)\?\.id === 'self' && !selfMonkReady\(\)/)
  assert.match(ui, /c\.script\.genre = body\.genre/)
  assert.match(read('bridge/production.js'), /categoryOf\(loadConfig\(\)\.script\.genre\)\?\.id === 'self' && !selfMonkReady\(\)/)
  const html = read('extension/sidepanel.html')
  assert.match(html, /id="selfMonkBox"[^>]*hidden/)
  assert.match(html, /id="selfPaste"/)
  const js = read('extension/sidepanel.js')
  assert.match(js, /\/api\/character\?attachments=1&slug=/)
  assert.match(js, /if \(selfMode\(\)\) opts\.profile = \{ category: 'self'/)
  // รูปหน้าพระอยู่ใน characters/ ซึ่งไม่ขึ้น repo สาธารณะ
  assert.match(read('.gitignore'), /^characters\/$/m)
})

console.log(`\nผ่าน ${passed} ข้อ`)
