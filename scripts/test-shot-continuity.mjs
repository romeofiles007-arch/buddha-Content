// เทสต์: ความต่อเนื่องของภาพ — กันช็อตที่ตัวละครชุดเดิม + ระยะภาพกลุ่มเดิมติดกันทั้งแถว
//   node scripts/test-shot-continuity.mjs
// ของจริงที่เจอ (พ.ย. 2026): คลิปมรณานุสติได้ภาพผีเสื้อเกาะดอกไม้ระยะมาโคร 4 ช็อตติดกันตั้งแต่เปิดเรื่อง
// แล้วซ้ำอีกชุดกลางเรื่อง — 12 ใน 23 ช็อตเป็นมาโคร เรียงแล้วดูเป็นภาพสุ่ม ไม่เป็นเรื่อง
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { shotSize, shotChars, continuityProblems, continuityReport, SHOT_VARIETY_RULE, MAX_SAME_RUN } from '../pipeline/lib/continuity.mjs'
import { nextRoundPrompt, shotlistFiles } from '../pipeline/lib/shotlist.mjs'
import { shotlistPrompt } from '../pipeline/lib/prompts.mjs'
import { loadConfig, projectDir, ROOT } from '../pipeline/lib/config.mjs'

let passed = 0
const test = (name, fn) => {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

const shot = (n, chars, frame) => ({
  filename: `00_00_${String(n * 3).padStart(2, '0')}.png`,
  shot: n,
  duration: 2.5,
  narration: `บรรทัดที่ ${n}`,
  prompt: `SHOT ${String(n).padStart(2, '0')} | Chars: ${chars} | Env: สวนริมสระบัวยามเช้า ต้นโพธิ์ โขดหิน ดอกคอสมอส | Action: อะไรสักอย่างในบรรทัดที่ ${n} | Frame: ${frame} แนวตั้ง 9:16`,
})

// ── อ่านระยะภาพจากช่อง Frame ──
test('อ่านระยะภาพ: มาโคร/โคลสอัพ = ใกล้ · medium = กลาง · wide = กว้าง · อ่านไม่ออก = null', () => {
  const frame = (f) => shotSize(`Chars: @a | Env: x | Action: y | Frame: ${f}`)
  assert.equal(frame('extreme macro close-up แนวตั้ง 9:16'), 'ใกล้')
  assert.equal(frame('medium macro cinematic shot'), 'ใกล้', 'medium macro ยังเป็นภาพชิด')
  assert.equal(frame('cinematic close-up tracking-style'), 'ใกล้')
  assert.equal(frame('medium-wide cinematic shot'), 'กว้าง')
  assert.equal(frame('wide cinematic shot เห็นตัวละครเต็มตัว'), 'กว้าง')
  assert.equal(frame('medium cinematic portrait'), 'กลาง')
  assert.equal(frame('over-the-shoulder cinematic shot'), 'กลาง')
  assert.equal(frame('ภาพสวยๆ สักภาพ'), null)
})

test('อ่านตัวละคร: ไม่สนลำดับและตัวพิมพ์ · ไม่มีตัวละคร = ว่าง', () => {
  assert.equal(shotChars('Chars: @seeker, @Butterfly | Frame: wide'), '@butterfly,@seeker')
  assert.equal(shotChars('Chars: @butterfly, @seeker | Frame: wide'), '@butterfly,@seeker')
  assert.equal(shotChars('Chars: — | Frame: wide'), '')
})

// ── หาช็อตที่ซ้ำกันทั้งแถว ──
test(`ตัวละครชุดเดิม + ระยะเดิม ติดกันได้ไม่เกิน ${MAX_SAME_RUN} ช็อต — ช็อตที่เกินถูกจับ`, () => {
  const shots = [
    shot(1, '@butterfly', 'macro close-up'),
    shot(2, '@butterfly', 'macro side-angle close-up'),
    shot(3, '@butterfly', 'medium macro cinematic shot'),
    shot(4, '@butterfly', 'extreme macro close-up'),
    shot(5, '@buddha', 'medium-wide cinematic shot'),
    shot(6, '@buddha', 'medium cinematic shot'),
  ]
  const problems = continuityProblems(shots)
  assert.deepEqual(problems.map((p) => p.filename), [shots[2].filename, shots[3].filename])
  assert.match(problems[0].reason, /ระยะภาพใกล้ติดกัน/)
})

test('เปลี่ยนระยะภาพหรือเปลี่ยนตัวละครแล้ว ไม่ถือว่าซ้ำ', () => {
  assert.deepEqual(continuityProblems([
    shot(1, '@butterfly', 'macro close-up'),
    shot(2, '@butterfly', 'macro close-up'),
    shot(3, '@butterfly', 'wide cinematic shot'),
    shot(4, '@butterfly', 'macro close-up'),
    shot(5, '@seeker', 'macro close-up'),
    shot(6, '@seeker', 'macro close-up'),
  ]), [])
})

test('ช็อตที่ยังไม่มี prompt หรืออ่านระยะไม่ออก ไม่ถูกจับ', () => {
  const shots = [shot(1, '@a', 'macro'), { ...shot(2, '@a', 'macro'), prompt: null }, shot(3, '@a', 'macro'), shot(4, '@a', 'ภาพสวย'), shot(5, '@a', 'macro')]
  assert.deepEqual(continuityProblems(shots), [])
})

test('สรุปขึ้น log: ภาพใกล้เยอะเกิน / ไม่มีภาพกว้างเลย', () => {
  const close = Array.from({ length: 8 }, (_, i) => shot(i + 1, i % 2 ? '@a' : '@b', 'macro close-up'))
  const note = continuityReport(close)
  assert.match(note, /ภาพระยะใกล้ 8\/8/)
  assert.match(note, /ไม่มีภาพกว้างเลย/)
  assert.equal(continuityReport([shot(1, '@a', 'wide'), shot(2, '@b', 'medium')]), '')
})

// ── กฎที่ส่งให้ ChatGPT ตั้งแต่รอบแรก ──
test('prompt ขั้นที่ 4 มีกฎความหลากหลายของระยะภาพ', () => {
  const slots = [{ filename: '00_00_00.png', shot: 1, duration: 2.5, narration: 'ทดสอบ', continuation: false }]
  const prompt = shotlistPrompt(loadConfig(), { title: 'ทดสอบ', slots, timecodeText: '00:00 ทดสอบ', slug: null })
  assert.ok(prompt.includes(SHOT_VARIETY_RULE), 'ไม่มีกฎความหลากหลายใน prompt รอบเดียวจบ')
  assert.match(SHOT_VARIETY_RULE, /wide \/ medium \/ close-up \/ macro/)
})

// ── รอบ "เขียนใหม่" — ขอช็อตละครั้งเดียว ──
test('ครบทุกช็อตแล้วแต่ภาพซ้ำ → ขอเขียนใหม่เฉพาะช็อตนั้น แล้วไม่ขอซ้ำอีก', () => {
  const slug = `_test_continuity_${process.pid}`
  const dir = projectDir(slug, 'shotlist')
  try {
    mkdirSync(join(dir, 'rounds'), { recursive: true })
    const shots = [
      shot(1, '@butterfly', 'macro close-up'),
      shot(2, '@butterfly', 'extreme macro close-up'),
      shot(3, '@butterfly', 'macro close-up'),
      shot(4, '@buddha', 'wide cinematic shot'),
    ]
    writeFileSync(join(dir, 'slots.json'), JSON.stringify(shots.map(({ prompt, ...s }) => ({ ...s, start: s.shot * 3, end: s.shot * 3 + 2.5 }))))
    writeFileSync(join(dir, 'rounds', '01.txt'), `=== SHOT LIST ===\n\n${shots.map((s) => `${s.filename} ${s.prompt}`).join('\n\n')}`)

    const context = { title: 'ทดสอบความต่อเนื่อง', timecodeText: '00:00 ทดสอบ' }
    const next = nextRoundPrompt(loadConfig(), slug, context)
    assert.ok(next, 'ควรได้รอบเขียนใหม่')
    assert.equal(next.redo, true)
    assert.equal(next.batch, 1)
    assert.match(next.prompt, /00_00_09\.png/)
    assert.match(next.prompt, /ต้องแก้เพราะ/)
    assert.match(next.prompt, /ช็อตก่อนหน้า \(ห้ามซ้ำกับช็อตนี้\)/)
    assert.match(next.prompt, /=== SHOT LIST ===/)
    // จำไว้แล้วว่าขอช็อตนี้ไป — รอบถัดไปต้องไม่ขอซ้ำ (กันวนไม่จบ)
    assert.deepEqual(JSON.parse(readFileSync(shotlistFiles(slug).redone, 'utf8')), ['00_00_09.png'])
    assert.equal(nextRoundPrompt(loadConfig(), slug, context), null)
  } finally {
    rmSync(join(ROOT, 'projects', slug), { recursive: true, force: true })
    assert.ok(!existsSync(join(ROOT, 'projects', slug)))
  }
})

console.log(`\nผ่าน ${passed} ข้อ`)
