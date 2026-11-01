// เทสต์: ออโต้ทั้งหมด → "ตรวจก่อนโพสต์: ไม่ตรวจ — โพสต์เลย"
//   node scripts/test-posting-skipcheck.mjs
// คลิปเข้าคิวแล้วได้เวลาโพสต์เลยโดยไม่ส่ง AI ตรวจ · คลิปที่ AI เคยบอกให้แก้ยังรอคนดู · คลิปผลิตต่อเนื่องแบบ "AI ตรวจ" ยังรอ AI
// ไม่ยิง ChatGPT/Facebook จริง · คิวอยู่ใน temp · โปรเจกต์ทดสอบ _skipchecktest ถูกลบทิ้งตอนจบ
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const tmp = mkdtempSync(join(tmpdir(), 'posting-skipcheck-'))
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

const SLUG = '_skipchecktest'
const projectDir = join(ROOT, 'projects', SLUG)
rmSync(projectDir, { recursive: true, force: true })
mkdirSync(join(projectDir, '01_script'), { recursive: true })
writeFileSync(join(projectDir, '01_script', 'post.json'), JSON.stringify({ titles: ['ชื่อโพสต์'], description: 'คำบรรยาย', hashtags: ['#ธรรมะ'] }))
// ไฟล์วิดีโอของคลิปผลิตต่อเนื่อง — AI ตรวจต้องตัดเฟรมจากไฟล์จริง
mkdirSync(join(projectDir, '06_render'), { recursive: true })
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=320x568:d=4', '-pix_fmt', 'yuv420p', join(projectDir, '06_render', 'prod.mp4')])

const jobs = new Map()
const clipAt = Date.now()
const posting = createPosting({
  jobs, json: () => {}, readBody: async () => ({}), port: 1, token: 'x', log: () => {}, scheduler: false,
  enqueue: (agent, kind, payload) => {
    const job = { id: `job${jobs.size + 1}`, agent, kind, payload, status: 'queued' }
    jobs.set(job.id, job)
    return job
  },
  // prod.mp4 ต้องมีความยาว — AI ตรวจเลือกเวลาตัดเฟรมจากความยาวคลิป
  deps: { listVideos: async () => [{ slug: SLUG, title: 'คลิปไม่ตรวจ', files: [{ name: `${SLUG}.mp4`, main: true, createdAt: clipAt }, { name: 'prod.mp4', seconds: 4, createdAt: clipAt }] }] },
})
const byId = (id) => P.loadQueue().find((q) => q.id === id)
const clip = () => P.loadQueue().find((q) => q.slug === SLUG && q.file === `${SLUG}.mp4`)
const post = { title: 'ชื่อ', description: 'd', hashtags: [] }

try {
  await test('ค่าเริ่มต้น: ตรวจด้วย AI (ไม่ข้าม)', () => {
    assert.equal(P.DEFAULT_SETTINGS.skipCheck, false)
  })

  P.updateAccounts((d) => {
    d.facebook.push({ id: 'p1', name: 'เพจธรรมะ', pageId: '1234567', token: 'x'.repeat(30) })
    Object.assign(d.settings, { enabledAt: clipAt - 1000, autoCheck: true, autoApprove: true, skipCheck: true, slots: ['12:00', '19:00'] })
  })
  // คลิปที่ AI เคยตรวจแล้วบอกให้แก้ + คลิปจากผลิตต่อเนื่องแบบ "AI ตรวจก่อน" ที่ยังไม่ได้ตรวจ
  const flagged = { ...P.newItem({ slug: 'x_flagged', file: 'x_flagged.mp4', title: 'AI ให้แก้', post, targets: ['fb:p1'] }), ai: { status: 'done', verdict: 'fix', summary: 'เสียงหาย', checkedAt: 1 } }
  const prodAi = { ...P.newItem({ slug: SLUG, file: 'prod.mp4', title: 'ผลิตต่อเนื่อง AI', post, targets: ['fb:p1'] }), auto: 'ai' }
  P.saveQueue([flagged, prodAi])

  await test('ไม่ตรวจ: คลิปผลิตเสร็จ → เข้าคิว → ได้เวลาโพสต์เลยในรอบเดียว ไม่ส่ง AI', async () => {
    await posting.tick()
    assert.equal(clip().status, 'scheduled')
    assert.equal(clip().scheduleAt, P.nextFreeSlot(['12:00', '19:00'], []))
    assert.ok(!clip().ai, 'ต้องไม่ส่ง AI ตรวจ')
    assert.match(clip().history.at(-1).text, /ไม่ตรวจ/)
  })

  await test('คลิปที่ AI เคยบอกให้แก้ → ยังรอคนดู ไม่โพสต์เอง', () => {
    assert.equal(byId(flagged.id).status, 'review')
  })

  await test('คลิปผลิตต่อเนื่องที่เลือก "AI ตรวจแล้วตั้งเวลา" → ยังส่ง AI ตรวจตามที่เลือกไว้', () => {
    assert.equal(byId(prodAi.id).status, 'review')
    assert.equal(byId(prodAi.id).ai?.status, 'running', JSON.stringify(byId(prodAi.id).ai))
    assert.equal([...jobs.values()].filter((j) => /ตรวจคลิป/.test(j.payload.label)).length, 1)
  })

  await test('แผง: ตัวเลือก "ตรวจก่อนโพสต์" ใต้ออโต้ทั้งหมด · bridge รับค่า skipCheck', () => {
    const js = readFileSync(join(ROOT, 'extension', 'posting.js'), 'utf8')
    assert.match(js, /ตรวจก่อนโพสต์/)
    assert.match(js, /ไม่ตรวจ — โพสต์เลย/)
    assert.match(js, /skipCheck: /)
    assert.match(readFileSync(join(ROOT, 'bridge', 'posting.js'), 'utf8'), /typeof body\.skipCheck === 'boolean'/)
  })
} finally {
  rmSync(projectDir, { recursive: true, force: true })
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\nผ่าน ${passed} ข้อ`)
