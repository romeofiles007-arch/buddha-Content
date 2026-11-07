// เทสต์เวลาต่อปลายทาง (ผู้ใช้ 8 พ.ย. 2026: "15:00 ทั้ง 2 เพจแต่คนละคลิป" · TikTok แยกเวลาเอง)
//   ช่องเดียวกันสองเพจ Facebook ลงคนละคลิป · TikTok บัญชีเดียวลงตามช่องว่างของตัวเอง · FB ขึ้นแล้วคลิปยังรอ TikTok
//   node --test scripts/test-posting-pertarget.mjs
import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
const dir = mkdtempSync(join(tmpdir(), 'posting-pertarget-')); process.env.POSTING_DIR = dir
const P = await import('../pipeline/lib/posting.mjs')
const { createPosting } = await import('../bridge/posting.js')
const { ROOT } = await import('../pipeline/lib/config.mjs')

const projects = [1, 2, 3].map((n) => {
  const p = mkdtempSync(join(ROOT, 'projects', `_pertarget${n}-`))
  mkdirSync(join(p, '06_render')); writeFileSync(join(p, '06_render', 'video.mp4'), `video ${n}`)
  return basename(p)
})
after(() => { for (const s of projects) rmSync(join(ROOT, 'projects', s), { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }) })

P.saveAccounts({
  settings: { ...P.DEFAULT_SETTINGS, slots: ['12:00', '15:00'], perPageQueueAt: 1, enabledAt: 1 },
  facebook: [{ id: 'a', name: 'ใจใส ใจสบาย วันหยุด', pageId: '111', token: 'ta' }, { id: 'b', name: 'รู้มั้ย เป็นใคร', pageId: '222', token: 'tb' }],
  youtube: [],
  tiktok: [{ id: 'tk', username: 'whytakorn', privacy: 'public', name: 'TikTok' }],
})
P.saveQueue(projects.map((slug, i) => ({ ...P.newItem({ slug, file: 'video.mp4', title: `คลิป ${i + 1}`, post: { titles: [`ชื่อ ${i + 1}`], description: 'บรรยาย' }, targets: [] }), addedAt: i })))

const calls = []
const jobs = new Map()
let body, response
const posting = createPosting({
  jobs, port: 1, token: 'test', log() {}, scheduler: false, readBody: async () => body, json: (_res, code, data) => { response = { code, data } },
  enqueue: (agent, kind, payload) => {
    calls.push('tk'); const job = { id: `job${calls.length}`, agent, kind, payload, status: 'running' }; jobs.set(job.id, job)
    Promise.resolve().then(() => { job.status = 'done'; job.result = { meta: { ok: true, published: true, username: 'whytakorn' } } })
    return job
  },
  deps: { listVideos: async () => [], tiktokPollMs: 1, tiktokTimeoutMs: 1000, facebookUpload: async (x) => { calls.push(`fb:${x.pageId}`); return { postId: 'p', url: `https://www.facebook.com/${x.pageId}/videos/1` } } },
})
const request = async (path, data) => { body = data; await posting.handle({ method: 'POST', headers: { host: '127.0.0.1:1', 'x-bridge-token': 'test' } }, {}, new URL(path, 'http://127.0.0.1:1')); return response }
const byTitle = () => Object.fromEntries(P.loadQueue().map((q) => [q.title, q]))

test('ช่องเดียวกัน: สองเพจลงคนละคลิปพร้อมกัน · TikTok ลงคลิปละช่องตามช่องว่างของตัวเอง', async () => {
  await request('/api/posting/approve-all', {})
  const q = byTitle()
  const fbOf = (it) => it.targets.find((k) => k.startsWith('fb:'))
  assert.notEqual(fbOf(q['คลิป 1']), fbOf(q['คลิป 2']), 'คลิป 1 กับ 2 อยู่คนละเพจ')
  assert.equal(q['คลิป 1'].targetAt[fbOf(q['คลิป 1'])], q['คลิป 2'].targetAt[fbOf(q['คลิป 2'])], 'Facebook สองเพจช่องเดียวกัน')
  const tk = Object.values(q).map((it) => it.targetAt['tk:tk'])
  assert.equal(new Set(tk).size, 3, 'TikTok ช่องละคลิป ไม่ชนกัน')
  assert.ok(q['คลิป 2'].targetAt['tk:tk'] > q['คลิป 2'].targetAt[fbOf(q['คลิป 2'])], 'TikTok ของคลิป 2 ช้ากว่า Facebook ของมัน')
})

test('ถึงเวลา Facebook: ขึ้นสองเพจคนละคลิป · คลิปที่ TikTok ยังไม่ถึงเวลารอต่อในสถานะตั้งเวลา', async () => {
  const past = Date.now() - 1000
  const queue = P.loadQueue()
  const c1 = queue.find((x) => x.title === 'คลิป 1'), c2 = queue.find((x) => x.title === 'คลิป 2')
  // จำลองว่าถึงช่องแรกแล้ว: Facebook ของคลิป 1-2 และ TikTok ของคลิป 1
  for (const it of [c1, c2]) for (const k of it.targets) if (k.startsWith('fb:')) it.targetAt[k] = past
  c1.targetAt['tk:tk'] = past
  for (const it of [c1, c2]) P.setTargetTimes(it, it.targetAt)
  P.saveQueue(queue)
  await posting.tick() // คลิป 1: FB + TikTok
  await posting.tick() // คลิป 2: FB อย่างเดียว
  const q = byTitle()
  assert.equal(q['คลิป 1'].status, 'posted')
  assert.deepEqual(calls.filter((c) => c.startsWith('fb:')).sort(), ['fb:111', 'fb:222'], 'สองเพจลงคนละคลิป')
  assert.equal(calls.filter((c) => c === 'tk').length, 1, 'TikTok ลงคลิปเดียว')
  assert.equal(q['คลิป 2'].status, 'scheduled', 'คลิป 2 ขึ้น FB แล้ว ยังรอ TikTok')
  assert.ok(Object.entries(q['คลิป 2'].results).some(([k, r]) => k.startsWith('fb:') && r.ok))
  assert.ok(!q['คลิป 2'].results['tk:tk']?.ok)
  assert.equal(q['คลิป 2'].scheduleAt, q['คลิป 2'].targetAt['tk:tk'], 'เวลาที่แสดง = เวลาของ TikTok ที่ยังรอ')
  assert.ok(q['คลิป 2'].history.some((h) => /รอ TikTok/.test(h.text)))
})

test('ถึงเวลา TikTok ของคลิป 2 → ลง TikTok อย่างเดียว ไม่ลง Facebook ซ้ำ → โพสต์ครบ', async () => {
  const queue = P.loadQueue()
  const c2 = queue.find((x) => x.title === 'คลิป 2')
  c2.targetAt['tk:tk'] = Date.now() - 1000
  P.setTargetTimes(c2, c2.targetAt)
  // TikTok ลงไปเมื่อกี้ (คลิป 1) — จำลองว่าผ่าน 31 นาทีแล้ว
  for (const it of queue) if (it.results?.['tk:tk']?.ok) it.results['tk:tk'].at = Date.now() - 31 * 60_000
  P.saveQueue(queue)
  const before = calls.length
  await posting.tick()
  assert.deepEqual(calls.slice(before), ['tk'])
  assert.equal(byTitle()['คลิป 2'].status, 'posted')
})
