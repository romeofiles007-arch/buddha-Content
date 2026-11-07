// เทสต์ "✓ โพสต์ทั้งหมดเลย (ไม่ตรวจ)" — ผู้ใช้ (8 พ.ย. 2026): "บอกไม่ต้องตรวจให้ post ได้เลย และแบ่งกันระหว่าง 2 เพจ"
//   คลิปรอตรวจทุกคลิปข้ามการตรวจ · ไม่มีชื่อโพสต์ให้ ChatGPT เขียน · คลิปละ 1 เพจ กระจาย 2 เพจ · ลงช่องเวลาของเพจ
//   node --test scripts/test-posting-approveall.mjs
import assert from 'node:assert/strict'
import { test, beforeEach, after } from 'node:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const dir = mkdtempSync(join(tmpdir(), 'posting-approveall-')); process.env.POSTING_DIR = dir
const P = await import('../pipeline/lib/posting.mjs')
const { createPosting } = await import('../bridge/posting.js')
const { ROOT } = await import('../pipeline/lib/config.mjs')
// savePost เขียน projects/<slug>/... ของจริง — ลบโฟลเดอร์คลิปทดสอบทิ้ง
after(() => {
  rmSync(dir, { recursive: true, force: true })
  for (let n = 1; n <= 12; n++) rmSync(join(ROOT, 'projects', `_approveall_c${n}`), { recursive: true, force: true })
})

const accounts = () => ({
  settings: { ...P.DEFAULT_SETTINGS, slots: ['12:00', '19:00'], perPageQueueAt: 1, enabledAt: 1 },
  facebook: [{ id: 'a', name: 'ใจใส ใจสบาย วันหยุด', pageId: '111', token: 'ta' }, { id: 'b', name: 'รู้มั้ย เป็นใคร', pageId: '222', token: 'tb' }],
  youtube: [], tiktok: [],
})
const clip = (n, extra = {}) => ({ ...P.newItem({ slug: `_approveall_c${n}`, file: `c${n}.mp4`, title: `คลิป ${n}`, post: extra.post ?? { titles: [`ชื่อ ${n}`], description: 'บรรยาย' }, targets: [] }), ...extra })
beforeEach(() => {
  for (const name of ['posted.json', 'deliveries.json', 'deliveries.lock', 'deliveries.initialized']) rmSync(join(dir, name), { force: true })
  P.saveAccounts(accounts())
})
function harness() {
  const jobs = new Map(), enqueued = []; let body, response
  const posting = createPosting({ jobs, enqueue: (agent, kind, payload) => { const job = { id: `j${enqueued.length + 1}`, agent, kind, payload, status: 'queued' }; jobs.set(job.id, job); enqueued.push(job); return job },
    port: 1, token: 'test', log() {}, scheduler: false, readBody: async () => body, json: (_res, code, data) => { response = { code, data } }, deps: { listVideos: async () => [] } })
  const request = async (path, data) => { body = data; await posting.handle({ method: 'POST', headers: { host: '127.0.0.1:1', 'x-bridge-token': 'test' } }, {}, new URL(path, 'http://127.0.0.1:1')); return response }
  return { posting, jobs, enqueued, request }
}

test('กดครั้งเดียว: คลิปที่มีชื่อโพสต์ตั้งเวลาเลยโดยไม่ตรวจ · กระจาย 2 เพจคลิปละเพจ · ลง 12:00 พร้อมกันคนละคลิป', async () => {
  P.saveQueue([
    clip(1, { targets: ['fb:a'] }),
    clip(2, { targets: ['fb:a'] }),
    clip(3, { targets: ['fb:a', 'fb:b'], targetsEdited: true }), // ติ๊กเองทั้งสองเพจ (ผิดกฎ)
    clip(4, { auto: 'ai', targets: ['fb:b'] }), // จากผลิตต่อเนื่องแบบรอ AI ตรวจ
    clip(7, { auto: 'now', targets: ['fb:b'], targetsEdited: true }), // ผลิตต่อเนื่องแบ่งเพจไว้เพจเดียว
    clip(8, { auto: 'now', targets: ['fb:b'], targetsEdited: true }),
  ])
  const h = harness()
  const r = await h.request('/api/posting/approve-all', {})
  assert.equal(r.code, 200)
  assert.equal(r.data.approvedAll, 6)
  const q = P.loadQueue()
  assert.ok(q.every((x) => x.status === 'scheduled'), 'ทุกคลิปตั้งเวลาแล้ว ไม่ต้องรอ AI')
  assert.ok(q.every((x) => x.targets.length === 1), 'คลิปละ 1 เพจ')
  const per = (k) => q.filter((x) => x.targets[0] === k).length
  assert.equal(per('fb:a'), 3, 'ที่ผลิตต่อเนื่องเลือกเพจไว้ก็ถูกแบ่งใหม่')
  assert.equal(per('fb:b'), 3)
  const first = Math.min(...q.map((x) => x.scheduleAt))
  assert.equal(q.filter((x) => x.scheduleAt === first).length, 2, 'ช่องแรกลงพร้อมกัน 2 เพจ คนละคลิป')
  assert.equal(h.enqueued.length, 0, 'ไม่ส่งไปให้ AI ตรวจ')
})

test('เพจที่เพิ่งลงไป 46 คลิปในสัปดาห์นี้ ไม่ทำให้เพจใหม่ได้คลิปทั้งหมด (แบ่งตามคิวที่รอ) · คลิปที่ตั้งเวลาไว้แล้วก็แบ่งใหม่', async () => {
  for (let n = 0; n < 46; n++) P.recordPosted(`old${n}/v.mp4`, 'fb:a', { name: 'ใจใส', at: Date.now() - 2 * 86_400_000 })
  const later = Date.now() + 86_400_000
  P.saveQueue([
    clip(9, { status: 'scheduled', scheduleAt: later, targets: ['fb:b'], targetsEdited: true, auto: 'now' }),
    clip(10, { status: 'scheduled', scheduleAt: later + 3 * 3600_000, targets: ['fb:b'], targetsEdited: true, auto: 'now' }),
    clip(11, { targets: ['fb:b'] }),
    clip(12, { targets: ['fb:b'] }),
  ])
  const h = harness()
  await h.request('/api/posting/approve-all', {})
  const q = P.loadQueue()
  const per = (k) => q.filter((x) => x.targets[0] === k).length
  assert.equal(per('fb:a'), 2, 'แบ่งตามคิวที่รอ ไม่ใช่ประวัติ — ได้เท่ากัน')
  assert.equal(per('fb:b'), 2)
})

test('คลิปที่ยังไม่มีชื่อโพสต์ → ChatGPT เขียนให้ (ที่เคยพลาดก็ลองใหม่) แล้วตั้งเวลาเอง', async () => {
  // คลิปจริงมีโฟลเดอร์โปรเจกต์เสมอ — ข้อความโพสต์ที่ ChatGPT เขียนบันทึกไว้ใน 01_script/post.json
  for (const n of [5, 6]) mkdirSync(join(ROOT, 'projects', `_approveall_c${n}`, '01_script'), { recursive: true })
  P.saveQueue([
    clip(5, { post: null }),
    clip(6, { post: null, postJob: { status: 'error', error: 'เคยพลาด' } }),
  ])
  const h = harness()
  await h.request('/api/posting/approve-all', {})
  let q = P.loadQueue()
  assert.ok(q.every((x) => x.status === 'review'), 'ยังไม่มีชื่อ → ยังไม่ตั้งเวลา')
  assert.equal(h.enqueued.length, 1, 'ขอ ChatGPT ทีละคลิป')
  assert.match(h.enqueued[0].payload.label, /คิดชื่อคลิป/)
  // ChatGPT ตอบกลับ → ได้ชื่อ → ตั้งเวลาเอง
  const job = h.enqueued[0]
  job.status = 'done'
  job.result = { text: '{"titles": ["ปล่อยวางความโกรธ"], "description": "ธรรมะสั้นๆ", "hashtags": ["#ธรรมะ"]}' }
  await h.posting.tick()
  q = P.loadQueue()
  const done = q.find((x) => x.postJob?.status === 'done')
  assert.ok(done, 'ได้ข้อความโพสต์จาก ChatGPT')
  assert.equal(done.post.title, 'ปล่อยวางความโกรธ')
  assert.equal(done.status, 'scheduled', 'ได้ชื่อแล้วตั้งเวลาเอง')
  assert.ok(q.some((x) => x.postJob?.status === 'running') || h.enqueued.length === 2, 'คลิปที่เคยพลาดได้ลองขอใหม่')
})
