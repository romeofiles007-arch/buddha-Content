// เทสต์กฎห้ามโพสต์ซ้ำ (ผู้ใช้ 7 พ.ย. 2026):
//   1 คลิปลงได้ 1 เพจ/ช่อง/บัญชีต่อแพลตฟอร์ม · ลงแพลตฟอร์มไหนแล้วห้ามลงแพลตฟอร์มนั้นอีกตลอดไป · แพลตฟอร์มอื่นยังลงได้
// ไม่ยิง Facebook/YouTube/TikTok จริง ไม่แตะคิว/โทเค็นจริง
//   node --test scripts/test-posting-norepeat.mjs
import assert from 'node:assert/strict'
import { test, beforeEach, after } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
const dir = mkdtempSync(join(tmpdir(), 'posting-norepeat-')); process.env.POSTING_DIR = dir
const P = await import('../pipeline/lib/posting.mjs')
const { createPosting } = await import('../bridge/posting.js')
const { ROOT } = await import('../pipeline/lib/config.mjs')
const project = mkdtempSync(join(ROOT, 'projects', '_norepeattest-')), slug = basename(project)
mkdirSync(join(project, '06_render')); writeFileSync(join(project, '06_render', 'video.mp4'), 'same video content')
const CLIP = `${slug}/video.mp4`
beforeEach(() => {
  writeFileSync(join(project, '06_render', 'video.mp4'), 'same video content')
  for (const name of ['deliveries.json', 'deliveries.lock', 'deliveries.initialized', 'posted.json']) rmSync(join(dir, name), { force: true })
  P.saveAccounts({ settings: {}, facebook: [
    { id: 'a', pageId: '111', token: 'fake', name: 'ใจใส ใจสบาย วันหยุด' },
    { id: 'b', pageId: '222', token: 'fake', name: 'รู้มั้ย เป็นใคร' },
  ], youtube: [], tiktok: [{ id: 'tk', username: 'romeo', privacy: 'public', name: 'TikTok' }] })
  P.saveQueue([])
})
after(() => { rmSync(project, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }) })
const item = (targets) => ({ ...P.newItem({ slug, file: 'video.mp4', title: 'Video', post: { title: 'Caption' }, targets }), status: 'scheduled', scheduleAt: Date.now() - 1000, targetsEdited: true })
function harness() {
  const calls = [], jobs = new Map(); let body, response
  const posting = createPosting({ jobs, enqueue: (agent, kind, payload) => {
    calls.push('tk'); const job = { id: 'job-' + calls.length, agent, kind, payload, status: 'running' }; jobs.set(job.id, job)
    Promise.resolve().then(() => { job.status = 'done'; job.result = { meta: { ok: true, published: true, username: 'romeo' } } })
    return job
  }, port: 1, token: 'test', log() {}, scheduler: false, readBody: async () => body, json: (_res, code, data) => { response = { code, data } }, deps: {
    listVideos: async () => [], tiktokPollMs: 1, tiktokTimeoutMs: 1000,
    facebookUpload: async (x) => { calls.push(`fb:${x.pageId}`); return { postId: '1', url: `https://www.facebook.com/${x.pageId}/videos/1` } },
    youtubeUpload: async () => { calls.push('yt'); return { postId: '2' } },
  } })
  return { posting, calls, request: async (path, data) => { body = data; await posting.handle({ method: data ? 'POST' : 'GET', headers: { host: '127.0.0.1:1', 'x-bridge-token': 'test' } }, {}, new URL(path, 'http://127.0.0.1:1')); return response } }
}
const passOldGap = () => {
  // ข้ามช่วงเว้น 30 นาทีระหว่างโพสต์ (คนละกฎ)
  P.saveQueue(P.loadQueue().map((q) => ({ ...q, postedAt: q.postedAt ? Date.now() - 3600_000 : q.postedAt, results: Object.fromEntries(Object.entries(q.results ?? {}).map(([k, r]) => [k, { ...r, at: Date.now() - 3600_000 }])) })))
}

test('ระบบเลือกให้แพลตฟอร์มละ 1 ที่ · 2 เพจ Facebook รับหมวดเดียวกัน → เพจเดียว', () => {
  assert.deepEqual(P.targetsFor(P.loadAccounts(), null), ['fb:a', 'tk:tk'])
  assert.deepEqual(P.onePerPlatform(['fb:a', 'fb:b', 'tk:tk', 'tk:x']), ['fb:a', 'tk:tk'])
})

test('กระจายเพจ: เพจที่ได้คลิปไปน้อยกว่าได้คลิปใหม่ก่อน', () => {
  P.recordPosted('อื่น/x.mp4', 'fb:a', { name: 'ใจใส ใจสบาย วันหยุด' })
  assert.deepEqual(P.targetsFor(P.loadAccounts(), null, { clip: CLIP }), ['fb:b', 'tk:tk'])
})

test('คิวที่ติ๊ก 2 เพจ Facebook + TikTok → ขึ้น Facebook เพจเดียว + TikTok · เพจที่สองไม่อัปโหลด', async () => {
  P.saveQueue([item(['fb:a', 'fb:b', 'tk:tk'])]); const h = harness(); await h.posting.tick()
  assert.deepEqual(h.calls.filter((c) => c.startsWith('fb:')), ['fb:111'])
  assert.ok(h.calls.includes('tk'))
  const [q] = P.loadQueue()
  assert.equal(q.status, 'posted')
  assert.deepEqual(q.targets.sort(), ['fb:a', 'tk:tk'])
  assert.ok(q.history.some((x) => /ห้ามโพสต์คลิปเดิมซ้ำในแพลตฟอร์มเดิม/.test(x.text)))
  assert.deepEqual(Object.keys(P.loadPosted()[CLIP]).sort(), ['fb', 'tk'])
})

test('คลิปเดิมเข้าคิวใหม่ไปเพจ Facebook อื่น → ไม่อัปโหลดเด็ดขาด แม้ไฟล์เปลี่ยน (ทำคลิปใหม่ทับ)', async () => {
  P.saveQueue([item(['fb:a'])]); const first = harness(); await first.posting.tick()
  assert.deepEqual(first.calls, ['fb:111'])
  passOldGap()
  writeFileSync(join(project, '06_render', 'video.mp4'), 'render ใหม่ ไฟล์ไม่เหมือนเดิม')
  P.saveQueue([...P.loadQueue().map((q) => ({ ...q, status: 'removed' })), item(['fb:b'])])
  const second = harness(); await second.posting.tick()
  assert.deepEqual(second.calls, [], 'ห้ามอัปโหลดคลิปเดิมไปเพจที่สอง')
  const q = P.loadQueue().at(-1)
  assert.equal(q.status, 'failed')
  assert.match(q.error, /ลง Facebook ไปแล้ว.*ห้ามโพสต์คลิปเดิมซ้ำ/)
  // เพจเดิมแต่ไฟล์เปลี่ยน (deliveries ไม่รู้จักไฟล์ใหม่) → ก็ยังห้าม
  passOldGap()
  P.saveQueue([...P.loadQueue().map((x) => ({ ...x, status: 'removed' })), item(['fb:a'])])
  const third = harness(); await third.posting.tick()
  assert.deepEqual(third.calls, [], 'ห้ามอัปโหลดซ้ำเพจเดิมด้วย')
})

test('แผง: ติ๊ก 2 เพจ Facebook พร้อมกันไม่ได้ · ติ๊กแพลตฟอร์มที่เคยลงแล้วไม่ได้ · หน้าจอเห็นว่าลงที่ไหนแล้ว', async () => {
  const h = harness()
  P.saveQueue([{ ...P.newItem({ slug, file: 'video.mp4', title: 'Video', post: { title: 'Caption' }, targets: [] }) }])
  const [q] = P.loadQueue()
  const two = await h.request('/api/posting/item', { id: q.id, targets: ['fb:a', 'fb:b'] })
  assert.equal(two.code, 500)
  assert.match(two.data.error, /Facebook เพจ\/ช่องเดียวต่อคลิป/)
  P.recordPosted(CLIP, 'tk:tk', { name: 'TikTok' })
  const tk = await h.request('/api/posting/item', { id: q.id, targets: ['tk:tk'] })
  assert.equal(tk.code, 500)
  assert.match(tk.data.error, /เคยโพสต์ลง TikTok แล้ว/)
  const ok = await h.request('/api/posting/item', { id: q.id, targets: ['fb:b'] })
  assert.equal(ok.code, 200)
  const view = await h.request('/api/posting')
  assert.ok(view.data.queue.find((x) => x.id === q.id).postedOn.tk)
})

test('ผลิตต่อเนื่องแบบแบ่งเพจก็ผ่านกฎ: ส่ง 2 เพจ Facebook มา → เหลือเพจเดียว', async () => {
  const h = harness()
  const videos = [{ slug, title: 'Video', files: [{ name: 'video.mp4', createdAt: Date.now() }] }]
  const posting = createPosting({ jobs: new Map(), enqueue: () => ({}), port: 1, token: 'test', log() {}, scheduler: false, readBody: async () => ({}), json() {}, deps: { listVideos: async () => videos } })
  await posting.enqueueAuto(slug, 'ai', ['fb:a', 'fb:b'])
  const q = P.loadQueue().find((x) => x.slug === slug)
  assert.deepEqual(q.targets, ['fb:a'])
  void h
})
