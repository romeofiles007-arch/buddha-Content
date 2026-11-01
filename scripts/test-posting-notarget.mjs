// เทสต์: คลิปที่ไม่มีเพจ/ช่องปลายทาง ห้ามขึ้นว่า "โพสต์แล้ว"
//   node scripts/test-posting-notarget.mjs
// เคยเป็น: โพสต์พลาด → ลบเพจแล้วเพิ่มใหม่ (ปลายทางในคลิปถูกล้าง) → กด "ลองโพสต์ใหม่" → ไม่มีที่ให้โพสต์
//          แต่ไม่มีที่ไหนพลาด ระบบเลยขึ้น "โพสต์แล้ว" ทั้งที่ไม่ได้ขึ้นเพจไหนเลย
// ไม่ยิง Facebook จริง · คิว/บัญชีอยู่ใน temp · โปรเจกต์ทดสอบ _notargettest ถูกลบทิ้งตอนจบ
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const tmp = mkdtempSync(join(tmpdir(), 'posting-notarget-'))
process.env.POSTING_DIR = tmp
const P = await import('../pipeline/lib/posting.mjs')
const { createPosting } = await import('../bridge/posting.js')
const { ROOT } = await import('../pipeline/lib/config.mjs')

let passed = 0
const test = async (name, fn) => {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

const SLUG = '_notargettest'
const projectDir = join(ROOT, 'projects', SLUG)
rmSync(projectDir, { recursive: true, force: true })
mkdirSync(join(projectDir, '06_render'), { recursive: true })
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=320x568:d=2', '-pix_fmt', 'yuv420p', join(projectDir, '06_render', `${SLUG}.mp4`)])

const uploads = []
const make = () => createPosting({
  jobs: new Map(), enqueue: () => ({ id: 'j' }), json: () => {}, readBody: async () => ({}), port: 1, token: 'x', log: () => {}, scheduler: false,
  deps: { listVideos: async () => [], facebookUpload: async (args) => (uploads.push(args), { postId: '9', url: 'https://www.facebook.com/p/9' }) },
})
const post = { title: 'ชื่อ', description: 'd', hashtags: [] }
const due = (extra) => ({ ...P.newItem({ slug: SLUG, file: `${SLUG}.mp4`, title: 'คลิปทดสอบ', post, targets: [] }), status: 'scheduled', scheduleAt: Date.now() - 1000, ...extra })
const only = () => P.loadQueue()[0]

try {
  await test('ไม่มีเพจ/ช่องเลย → "โพสต์ไม่สำเร็จ" พร้อมบอกให้เพิ่มเพจ (ไม่ใช่ "โพสต์แล้ว")', async () => {
    P.saveQueue([due()])
    await make().tick()
    assert.equal(only().status, 'failed')
    assert.match(only().error, /เพจ/)
    assert.equal(uploads.length, 0)
  })

  await test('คลิปที่ปลายทางถูกล้าง (ลบเพจแล้วเพิ่มใหม่) → เลือกเพจใหม่ตามหมวดก่อนโพสต์ → ขึ้นเพจจริง', async () => {
    P.updateAccounts((d) => { d.facebook.push({ id: 'p2', name: 'เพจใหม่', pageId: '7654321', token: 'x'.repeat(30) }) })
    P.saveQueue([due({ status: 'failed', results: { 'fb:old': { ok: false, error: 'โทเค็นหมดอายุ', name: 'เพจเก่า' } } })])
    const queue = P.loadQueue()
    Object.assign(queue[0], { status: 'scheduled', scheduleAt: Date.now() - 1000 }) // เหมือนกด "ลองโพสต์ใหม่"
    P.saveQueue(queue)
    await make().tick()
    assert.equal(only().status, 'posted')
    assert.deepEqual(only().targets, ['fb:p2'])
    assert.equal(only().results['fb:p2'].ok, true)
    assert.equal(uploads.length, 1)
  })

  await test('ติ๊กปลายทางเองแล้วว่าง (targetsEdited) → ไม่เลือกให้เอง · พลาดพร้อมเหตุผล', async () => {
    uploads.length = 0
    P.saveQueue([due({ targetsEdited: true })])
    await make().tick()
    assert.equal(only().status, 'failed')
    assert.equal(uploads.length, 0)
  })

  await test('ข้อมูลเดิมที่ขึ้น "โพสต์แล้ว" แต่ไม่ได้ขึ้นที่ไหนเลย → เปิดโปรแกรมใหม่กลับเป็น "โพสต์ไม่สำเร็จ" ให้กดลองใหม่ได้', async () => {
    const ghost = { ...due(), status: 'posted', postedAt: Date.now(), results: {} }
    const real = { ...due(), id: 'real', status: 'posted', postedAt: Date.now(), targets: ['fb:p2'], results: { 'fb:p2': { ok: true, url: 'u', name: 'เพจใหม่' } } }
    P.saveQueue([ghost, real])
    make()
    const q = P.loadQueue()
    assert.equal(q.find((x) => x.id === ghost.id).status, 'failed')
    assert.match(q.find((x) => x.id === ghost.id).error, /ไม่ได้ขึ้น/)
    assert.equal(q.find((x) => x.id === 'real').status, 'posted', 'ของที่โพสต์จริงไม่แตะ')
  })
} finally {
  rmSync(projectDir, { recursive: true, force: true })
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\nผ่าน ${passed} ข้อ`)
