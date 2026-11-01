// เทสต์: โหมด "ดึงคลิปจากคลังเอง" — เติมคิวให้มีคลิปรอโพสต์ครบทุกช่องเวลาของวัน (เก่าสุดก่อน)
//   node scripts/test-posting-autopull.mjs
// ไม่แตะคิว/บัญชีจริง — คิวอยู่ในโฟลเดอร์ temp และคลังวิดีโอเป็นของปลอม
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const tmp = mkdtempSync(join(tmpdir(), 'posting-autopull-'))
process.env.POSTING_DIR = tmp
const P = await import('../pipeline/lib/posting.mjs')
const { createPosting } = await import('../bridge/posting.js')
const ROOT = fileURLToPath(new URL('..', import.meta.url))

let passed = 0
const test = async (name, fn) => {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

const DAY = 86_400_000
const T0 = Date.UTC(2026, 9, 1)
// คลิปในคลัง: c1 เก่าสุด … c5 ใหม่สุด (ใส่สลับลำดับไว้ ต้องเรียงตามวันที่ทำเอง)
const clip = (n) => ({ slug: `autopull_c${n}`, title: `คลิป ${n}`, files: [{ name: `autopull_c${n}.mp4`, main: true, createdAt: T0 + n * DAY }] })
const videos = [clip(3), clip(1), clip(5), clip(2), clip(4)]
const q = (n, status) => ({ slug: `autopull_c${n}`, file: `autopull_c${n}.mp4`, status })
const slugs = (list) => list.map((v) => v.slug)

try {
  await test('คิวว่าง 2 ช่องเวลา → ดึง 2 คลิปที่เก่าที่สุด', () => {
    assert.deepEqual(slugs(P.clipsToPull(videos, [], ['12:00', '19:00'])), ['autopull_c1', 'autopull_c2'])
  })

  await test('มีคลิปรออยู่แล้ว (รอตรวจ/ตั้งเวลา/กำลังโพสต์) → ดึงแค่ส่วนที่ขาด', () => {
    assert.deepEqual(slugs(P.clipsToPull(videos, [q(1, 'review')], ['12:00', '19:00', '21:00'])), ['autopull_c2', 'autopull_c3'])
    assert.deepEqual(P.clipsToPull(videos, [q(1, 'scheduled'), q(2, 'posting')], ['12:00', '19:00']), [])
  })

  await test('ไม่ดึงซ้ำคลิปที่เคยอยู่ในคิว — โพสต์แล้ว / ตีกลับ / เอาออก / โพสต์พลาด', () => {
    const done = [q(1, 'posted'), q(2, 'rejected'), q(3, 'removed'), q(4, 'failed')]
    assert.deepEqual(slugs(P.clipsToPull(videos, done, ['12:00', '19:00'])), ['autopull_c5'])
    // คลิปที่จบไปแล้วไม่นับเป็น "รออยู่" — ต้องเติมใหม่
    assert.deepEqual(slugs(P.clipsToPull(videos, [q(1, 'posted')], ['12:00'])), ['autopull_c2'])
  })

  await test('คลังหมด → ดึงเท่าที่มี · ไม่มีช่องเวลา → ไม่ดึง · คลิปไม่มีไฟล์ → ข้าม', () => {
    assert.equal(P.clipsToPull(videos, [], ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00']).length, 5)
    assert.deepEqual(P.clipsToPull(videos, [], []), [])
    assert.deepEqual(slugs(P.clipsToPull([{ slug: 'x', files: [] }, clip(1)], [], ['12:00'])), ['autopull_c1'])
  })

  await test('ค่าเริ่มต้นปิดไว้ — ไม่ดึงเองจนกว่าผู้ใช้จะเปิด', () => {
    assert.equal(P.DEFAULT_SETTINGS.autoPull, false)
  })

  // ── ต่อสายจริงใน bridge ──
  const posting = createPosting({ jobs: new Map(), enqueue: () => ({ id: 'j' }), json: () => {}, readBody: async () => ({}), log: () => {}, port: 1, token: 'x', scheduler: false, deps: { listVideos: async () => videos } })
  const queued = () => P.loadQueue().filter((it) => it.status !== 'removed').map((it) => `${it.slug}:${it.status}`).sort()

  await test('bridge: เปิดโหมดโพสต์แต่ปิดดึงเอง → ไม่ดึง', async () => {
    P.updateAccounts(({ settings }) => Object.assign(settings, { enabledAt: Date.now(), autoCheck: false, autoPull: false, slots: ['12:00', '19:00'] }))
    await posting.tick()
    assert.deepEqual(queued(), [])
  })

  await test('bridge: เปิดดึงเอง → รอบถัดไปมีคลิปรอตรวจครบ 2 ช่องเวลา (เก่าสุดก่อน) · รอบต่อไปไม่ดึงเพิ่ม', async () => {
    P.updateAccounts(({ settings }) => { settings.autoPull = true })
    await posting.tick()
    assert.deepEqual(queued(), ['autopull_c1:review', 'autopull_c2:review'])
    await posting.tick()
    assert.equal(queued().length, 2)
    const item = P.loadQueue().find((it) => it.slug === 'autopull_c1')
    assert.match(item.history.at(-1).text, /ดึงจากคลังเอง/)
  })

  await test('bridge: ตีกลับ 1 คลิป → เติมคลิปถัดไปแทน ไม่ดึงคลิปที่ตีกลับกลับมา', async () => {
    const queue = P.loadQueue()
    queue.find((it) => it.slug === 'autopull_c1').status = 'rejected'
    P.saveQueue(queue)
    await posting.tick()
    assert.deepEqual(queued(), ['autopull_c1:rejected', 'autopull_c2:review', 'autopull_c3:review'])
  })

  await test('แผง: มีสวิตช์ "ดึงคลิปจากคลังเอง" · bridge รับค่า autoPull', () => {
    assert.match(readFileSync(join(ROOT, 'extension', 'posting.js'), 'utf8'), /toggle\('autoPull', 'ดึงคลิปจากคลังเอง'/)
    assert.match(readFileSync(join(ROOT, 'bridge', 'posting.js'), 'utf8'), /typeof body\.autoPull === 'boolean'/)
  })
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\nผ่าน ${passed} ข้อ`)
