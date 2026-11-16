// เทสต์ตัวกันทำเรื่องซ้ำ (pipeline/lib/topic-guard.mjs) — ไม่ยิง ChatGPT จริง ไม่แตะ projects จริง
//   node scripts/test-topic-guard.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GUARD_WINDOW, recentTopics, similarity, nearSame, localDuplicate, dedupePrompt, parseDedupe, screenTopics } from '../pipeline/lib/topic-guard.mjs'
import { ROOT } from '../pipeline/lib/config.mjs'

let passed = 0
const test = async (name, fn) => {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

// ชื่อเรื่องจริงจากคลัง (พ.ย. 2026)
const YAK1 = 'ยักษ์อาฬวกะผู้ข่มขู่พระพุทธเจ้า — เหตุใดการเผชิญหน้าจึงจบลงด้วยคำสอนเรื่องศรัทธา'
const YAK2 = 'ยักษ์อาฬวกผู้ข่มขู่พระพุทธเจ้า แต่กลับได้รับคำตอบว่ามนุษย์ข้ามห้วงน้ำแห่งทุกข์ได้ด้วยสิ่งใด'
const UNTOLD1 = 'เรื่องที่ไม่ค่อยมีใครเล่าของพระโสณะ — เมื่อความเพียรเกือบทำให้ท่านเลิกบวช'
const UNTOLD2 = 'เรื่องที่ไม่ค่อยมีใครเล่าของพระองคุลิมาล — จากผู้เคยทำผิดร้ายแรงสู่ผู้ให้ความปลอดภัย'
const recent = [
  { slug: 'a', title: YAK1, at: 3, key: 'ยักษ์อาฬวกะถามปัญหา · ศรัทธาและปัญญา', theme: null },
  { slug: 'b', title: UNTOLD1, at: 2, key: null, theme: null },
  { slug: 'c', title: 'วิธีรับมือกับความผิดหวังหลังสอบตกแบบพระพุทธเจ้า — อุปมาลูกศรดอกที่สอง', at: 1, key: 'อุปมาลูกศรดอกที่สอง · เวทนา', theme: null },
]

await test('เทียบกับ 100 เรื่องล่าสุด', () => {
  assert.equal(GUARD_WINDOW, 100)
})

await test('ชื่อเหมือน/เกือบเหมือน = ซ้ำ · แค่รูปประโยคเดียวกัน = ไม่ซ้ำ', () => {
  assert.ok(nearSame(YAK1, YAK1))
  assert.ok(nearSame(YAK1, YAK1.replace(' — ', ' - ').replace('เหตุใด', 'ทำไม')), 'แก้คำเดียว/เปลี่ยนขีด ยังนับว่าเรื่องเดิม')
  assert.ok(nearSame('ยักษ์อาฬวกะ ข่มขู่พระพุทธเจ้า!', 'ยักษ์อาฬวกะข่มขู่พระพุทธเจ้า'), 'ช่องว่าง/วรรคตอนไม่มีผล')
  assert.ok(!nearSame(UNTOLD1, UNTOLD2), 'ขึ้นต้นเหมือนกันแต่คนละเรื่อง')
  assert.ok(similarity(UNTOLD1, UNTOLD2) < 0.5)
  assert.ok(!nearSame('', ''))
})

await test('ตรวจในเครื่อง: จับชื่อเกือบเหมือนและแก่นเรื่อง (key) เดียวกัน', () => {
  assert.equal(localDuplicate({ title: UNTOLD1 + ' ' }, recent)?.slug, 'b')
  assert.equal(localDuplicate({ title: 'ชื่อใหม่เอี่ยม', key: 'ยักษ์อาฬวกถามปัญหา ศรัทธาและปัญญา' }, recent)?.slug, 'a', 'สะกดต่าง (อาฬวก) ยังจับได้จาก key')
  assert.equal(localDuplicate({ title: UNTOLD2 }, recent), null)
  // เรื่องเดียวกันแต่ตั้งชื่อต่างกันมาก — ตัวหนังสือบอกไม่ได้ ต้องให้ ChatGPT ตัดสิน (ชั้นที่ 2)
  assert.equal(localDuplicate({ title: YAK2 }, recent), null)
})

await test('prompt ตรวจเรื่องซ้ำ: มีทั้งสองรายการ ลำดับเลข และแก่นเรื่องของคลิปเก่า', () => {
  const p = dedupePrompt([{ title: YAK2 }, { title: UNTOLD2 }], recent)
  assert.match(p, /เรื่องที่ทำคลิปไปแล้ว 3 เรื่องล่าสุด/)
  assert.ok(p.includes(`1. ${YAK1} 〔แก่นเรื่อง: ยักษ์อาฬวกะถามปัญหา · ศรัทธาและปัญญา〕`))
  assert.ok(p.includes(`2. ${UNTOLD1}\n`), 'คลิปเก่าที่ไม่มี key แสดงแค่ชื่อ')
  assert.ok(p.includes(`1. ${YAK2}\n2. ${UNTOLD2}`))
  assert.match(p, /JSON array/)
  assert.match(p, /อุปมาหลักเดียวกัน/)
})

await test('อ่านผลตรวจ: ทน ```json``` · ระบุเรื่องที่ซ้ำด้วย · เลขข้อผิดยังนับว่าซ้ำ · ไม่ครบข้อ = error', () => {
  const cands = [{ title: YAK2 }, { title: UNTOLD2 }, { title: 'x' }]
  const out = parseDedupe('ผล:\n```json\n[{"n":1,"dup":true,"same":1,"key":"ยักษ์อาฬวกะ","why":"เรื่องเดียวกัน"},\n{"n":2,"dup":false,"same":null,"key":"องคุลิมาลกลับใจ","why":""},{"n":3,"dup":"true","same":99,"key":""}]\n```', cands, recent)
  assert.equal(out[0].dup, true)
  assert.equal(out[0].sameAs.slug, 'a')
  assert.equal(out[1].dup, false)
  assert.equal(out[1].key, 'องคุลิมาลกลับใจ')
  assert.equal(out[2].dup, true)
  assert.equal(out[2].sameAs, null)
  assert.throws(() => parseDedupe('[{"n":1,"dup":false}]', cands, recent), /ไม่มีข้อ 2/)
  assert.throws(() => parseDedupe('ขออภัย', cands, recent), /อ่านผลตรวจ/)
})

await test('คัดหัวข้อ: ตัดข้อที่ซ้ำ คงลำดับเดิม เก็บ key ให้ข้อที่ผ่าน', async () => {
  const offered = [{ title: YAK2, score: 95 }, { title: UNTOLD1, score: 90 }, { title: UNTOLD2, score: 80 }]
  const prompts = []
  const out = await screenTopics(offered, recent, async (prompt) => {
    prompts.push(prompt)
    // ข้อที่ส่งให้ตรวจเหลือ 2 ข้อ (UNTOLD1 ถูกตัดในเครื่องไปก่อน)
    return '[{"n":1,"dup":true,"same":1,"key":"ยักษ์อาฬวกะ","why":"เรื่องเดียวกัน สะกดต่างกัน"},{"n":2,"dup":false,"same":null,"key":"องคุลิมาลกลับใจ · การให้อภัย","why":""}]'
  })
  assert.equal(prompts.length, 1)
  assert.ok(prompts[0].includes(`รายการ B — หัวข้อใหม่ที่เสนอ:\n1. ${YAK2}\n2. ${UNTOLD2}\n`), 'ส่งให้ ChatGPT เฉพาะข้อที่ยังไม่ถูกตัดในเครื่อง')
  assert.equal(out.judged, true)
  assert.deepEqual(out.fresh.map((t) => t.title), [UNTOLD2])
  assert.equal(out.fresh[0].key, 'องคุลิมาลกลับใจ · การให้อภัย')
  assert.equal(out.fresh[0].score, 80, 'ข้อมูลเดิมของหัวข้ออยู่ครบ')
  assert.deepEqual(out.rejected.map((r) => [r.title, r.by, r.sameAs?.slug]), [[UNTOLD1, 'local', 'b'], [YAK2, 'ai', 'a']])
})

await test('ChatGPT ตรวจไม่สำเร็จ: ลอง 2 รอบ แล้วใช้ผลในเครื่องอย่างเดียว (ไม่หยุดการผลิต)', async () => {
  let calls = 0
  const out = await screenTopics([{ title: YAK2 }, { title: UNTOLD1 }], recent, async () => { calls++; if (calls === 1) throw new Error('timeout'); return 'ตอบไม่เป็น JSON' })
  assert.equal(calls, 2)
  assert.equal(out.judged, false)
  assert.match(out.error.message, /อ่านผลตรวจ/)
  assert.deepEqual(out.fresh.map((t) => t.title), [YAK2], 'ข้อที่ตรวจในเครื่องไม่เจอยังผ่าน')
  assert.equal(out.rejected.length, 1)
})

await test('ไม่มีเรื่องเก่า / ซ้ำในเครื่องหมดทุกข้อ → ไม่ต้องถาม ChatGPT', async () => {
  const never = async () => { throw new Error('ไม่ควรถูกเรียก') }
  assert.deepEqual((await screenTopics([{ title: 'ก' }], [], never)).fresh, [{ title: 'ก' }])
  const all = await screenTopics([{ title: YAK1 }], recent, never)
  assert.equal(all.fresh.length, 0)
  assert.equal(all.rejected[0].by, 'local')
})

await test('เรื่องล่าสุด: ใหม่สุดก่อน ตัดตามจำนวน · คลิปที่เพิ่งเลือกหัวข้อ (ยังไม่มี title.txt) ก็นับ · อ่าน key', () => {
  const root = mkdtempSync(join(tmpdir(), 'topic-guard-'))
  try {
    const add = (slug, { title, chosen, at }) => {
      const dir = join(root, slug, '01_script')
      mkdirSync(dir, { recursive: true })
      if (title) { writeFileSync(join(dir, 'title.txt'), title + '\n'); utimesSync(join(dir, 'title.txt'), at / 1000, at / 1000) }
      if (chosen) { writeFileSync(join(dir, 'topics_scored.json'), JSON.stringify({ chosen })); utimesSync(join(dir, 'topics_scored.json'), at / 1000, at / 1000) }
    }
    add('old', { title: 'เรื่องเก่า', at: 1_000_000 })
    add('mid', { title: 'เรื่องกลาง', chosen: { title: 'เรื่องกลาง', key: 'แก่นกลาง', theme: { area: 'งาน', dhamma: 'สติ' } }, at: 2_000_000 })
    add('new', { chosen: { title: 'เรื่องที่เพิ่งเลือก' }, at: 3_000_000 })
    add('_posting', { title: 'ไม่ใช่คลิป', at: 9_000_000 })
    mkdirSync(join(root, 'empty'))
    const rows = recentTopics(100, root)
    assert.deepEqual(rows.map((r) => r.title), ['เรื่องที่เพิ่งเลือก', 'เรื่องกลาง', 'เรื่องเก่า'])
    assert.equal(rows[1].key, 'แก่นกลาง')
    assert.equal(rows[1].theme.dhamma, 'สติ')
    assert.deepEqual(recentTopics(2, root).map((r) => r.slug), ['new', 'mid'])
    assert.deepEqual(recentTopics(5, join(root, 'nope')), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

await test('ต่อสายใน autopilot: ตรวจกับ 100 เรื่องล่าสุด · ตัดข้อที่ซ้ำ · ซ้ำหมด = ขอชุดใหม่ · จดผลไว้กับคลิป', () => {
  const src = readFileSync(join(ROOT, 'pipeline', 'autopilot.mjs'), 'utf8')
  assert.match(src, /const recent = recentTopics\(GUARD_WINDOW\)/)
  assert.match(src, /await screenTopics\(offered, recent,/)
  assert.match(src, /label: 'ตรวจเรื่องซ้ำ'/)
  assert.match(src, /avoid: \[\.\.\.recent\.map\(\(r\) => r\.title\), \.\.\.rejected\.map\(\(r\) => r\.title\)\]/)
  assert.match(src, /topics = screened\.fresh/)
  assert.match(src, /guard: \{ \.\.\.guard, rejected:/)
})

console.log(`\nผ่าน ${passed} ข้อ`)
