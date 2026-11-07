// Real posting orchestration with local fixtures; never contacts a platform.
import assert from 'node:assert/strict'
import { test, beforeEach, after } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
const dir = mkdtempSync(join(tmpdir(), 'posting-delivery-')); process.env.POSTING_DIR = dir
const P = await import('../pipeline/lib/posting.mjs')
const { createPosting } = await import('../bridge/posting.js')
const { ROOT } = await import('../pipeline/lib/config.mjs')
const project = mkdtempSync(join(ROOT, 'projects', '_deliverytest-')), slug = basename(project)
mkdirSync(join(project, '06_render')); writeFileSync(join(project, '06_render', 'video.mp4'), 'same video content')
beforeEach(() => {
  writeFileSync(join(project, '06_render', 'video.mp4'), 'same video content')
  for (const name of ['deliveries.json', 'deliveries.lock', 'deliveries.initialized', 'posted.json']) rmSync(join(dir, name), { force: true })
  P.saveAccounts({ settings: {}, facebook: [{ id: 'fb', pageId: '123', token: 'fake', name: 'Page' }], youtube: [{ id: 'yt', channelId: 'UC123', refreshToken: 'fake', name: 'Channel' }], tiktok: [{ id: 'tk', username: 'romeo', privacy: 'public', name: 'TikTok' }] })
  P.saveQueue([])
})
after(() => { rmSync(project, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }) })
const item = targets => ({ ...P.newItem({ slug, file: 'video.mp4', title: 'Video', post: { title: 'Caption' }, targets }), status: 'scheduled', scheduleAt: Date.now() - 1000, targetsEdited: true })
function harness({ fb = async () => ({ postId: '1', url: 'https://www.facebook.com/123/videos/1' }), yt = async () => ({ postId: '2', url: 'https://www.youtube.com/watch?v=2' }), tk = Promise.resolve() } = {}) {
  const calls = [], jobs = new Map(); let body, response
  const posting = createPosting({ jobs, enqueue: (agent, kind, payload) => {
    calls.push('tk'); const job = { id: 'job-' + calls.length, agent, kind, payload, status: 'running' }; jobs.set(job.id, job)
    tk.then(() => { job.status = 'done'; job.result = { meta: { ok: true, published: true, username: 'romeo' } } })
    return job
  }, port: 1, token: 'test', log() {}, scheduler: false, readBody: async () => body, json: (_res, code, data) => { response = { code, data } }, deps: { listVideos: async () => [], tiktokPollMs: 1, tiktokTimeoutMs: 1000, facebookUpload: async x => { calls.push('fb'); return fb(x) }, youtubeUpload: async x => { calls.push('yt'); return yt(x) } } })
  return { posting, calls, request: async (path, data) => { body = data; await posting.handle({ method: data ? 'POST' : 'GET', headers: { host: '127.0.0.1:1', 'x-bridge-token': 'test' } }, {}, new URL(path, 'http://127.0.0.1:1')); return response } }
}
test('all three platforms begin before any slow destination completes', async () => {
  let release; const gate = new Promise(r => { release = r })
  const h = harness({ fb: async () => { await gate; return { postId: '1' } }, yt: async () => { await gate; return { postId: '2' } }, tk: gate })
  P.saveQueue([item(['fb:fb', 'yt:yt', 'tk:tk'])]); const pending = h.posting.tick()
  try {
    for (let i = 0; i < 80 && h.calls.length < 3; i++) await new Promise(r => setTimeout(r, 5))
    assert.deepEqual([...h.calls].sort(), ['fb', 'tk', 'yt'])
  } finally { release(); await pending }
  assert.equal(P.loadQueue()[0].status, 'posted')
})
test('re-enrollment and reconnecting the same page reuse permanent success without a second upload', async () => {
  P.saveQueue([item(['fb:fb'])]); const first = harness(); await first.posting.tick(); assert.equal(first.calls.length, 1)
  P.saveQueue([item(['fb:reconnected'])]); P.updateAccounts(a => { a.facebook[0].id = 'reconnected' })
  const second = harness(); await second.posting.tick()
  assert.equal(second.calls.length, 0)
  assert.equal(P.loadQueue()[0].results['fb:reconnected'].duplicateSkipped, true)
})
test('a lost Facebook response cannot be retried, even through the former override or a fresh queue item', async () => {
  P.saveQueue([item(['fb:fb'])]); const h = harness({ fb: async () => { throw new Error('socket lost after sending') } }); await h.posting.tick()
  const [q] = P.loadQueue()
  assert.equal(q.results['fb:fb'].needsVerification, true)
  assert.equal((await h.request('/api/posting/retry', { id: q.id, confirmTikTokRetry: true })).code, 409)
  P.saveQueue([item(['fb:fb'])]); const next = harness(); await next.posting.tick()
  assert.equal(next.calls.length, 0); assert.equal(P.loadQueue()[0].status, 'failed')
})
test('previous queue successes are imported before publishing to a new platform', async () => {
  const old = { ...item(['fb:fb']), status: 'removed', results: { 'fb:fb': { ok: true, postId: 'old', url: 'https://www.facebook.com/123/videos/old' } } }
  P.saveQueue([old, item(['fb:fb', 'tk:tk'])]); const h = harness(); await h.posting.tick()
  assert.deepEqual(h.calls, ['tk']); assert.equal(P.loadQueue()[1].status, 'posted')
})
test('adding a removed legacy clip cannot discard its success before history migration', async () => {
  P.saveQueue([{ ...item(['fb:fb']), status: 'removed', results: { 'fb:fb': { ok: true, postId: 'old', url: 'https://www.facebook.com/123/videos/old' } } }])
  const h = harness()
  assert.equal((await h.request('/api/posting/add', { slug, file: 'video.mp4' })).code, 200)
  const [q] = P.loadQueue()
  // กฎห้ามโพสต์ซ้ำ: คลิปนี้เคยขึ้น Facebook แล้ว → ระบบไม่เลือก Facebook ให้ และติ๊ก Facebook เองก็ไม่ได้
  assert.ok(!q.targets.some((k) => k.startsWith('fb:')), 'ไม่เลือก Facebook ให้คลิปที่เคยขึ้น Facebook แล้ว')
  const picked = await h.request('/api/posting/item', { id: q.id, targets: ['fb:fb'], post: { title: 'Caption' } })
  assert.equal(picked.code, 500)
  assert.match(picked.data.error, /เคยโพสต์ลง Facebook แล้ว/)
  // แม้จะมีคิวเก่าที่ติ๊ก Facebook ค้างไว้ ด่านสุดท้ายตอนส่งก็ไม่อัปโหลด
  P.saveQueue(P.loadQueue().map((x) => (x.id === q.id ? { ...x, targets: ['fb:fb'], post: { title: 'Caption' }, status: 'scheduled', scheduleAt: Date.now() - 1000 } : x)))
  await h.posting.tick()
  assert.equal(h.calls.length, 0)
  const after = P.loadQueue().find((x) => x.id === q.id)
  assert.equal(after.results['fb:fb']?.duplicateSkipped, true, 'ปลายทางเดิมนับว่าขึ้นแล้ว (จากประวัติเดิม) ไม่อัปซ้ำ')
})
test('all adapters upload the hashed snapshot even if the project render is replaced', async () => {
  let started, release
  const ready = new Promise(r => { started = r }), gate = new Promise(r => { release = r }), sent = []
  P.saveQueue([item(['fb:fb'])])
  const h = harness({ fb: async ({ file }) => { started(); await gate; sent.push(readFileSync(file, 'utf8')); return { postId: 'one' } } })
  const pending = h.posting.tick(); await ready
  writeFileSync(join(project, '06_render', 'video.mp4'), 'replacement video')
  release(); await pending
  assert.deepEqual(sent, ['same video content'])
})
test('Facebook completion cannot clear the running TikTok binding or its staged file', async () => {
  let release; const gate = new Promise(r => { release = r })
  const h = harness({ tk: gate }); P.saveQueue([item(['fb:fb', 'tk:tk'])])
  const pending = h.posting.tick(); let file
  try {
    for (let i = 0; i < 100 && !P.loadQueue()[0].results?.['fb:fb']?.ok; i++) await new Promise(r => setTimeout(r, 5))
    const q = P.loadQueue()[0]
    assert.ok(q.tiktokJobId)
    const result = await h.request('/api/posting/tiktok/job?id=' + q.tiktokJobId)
    assert.equal(result.code, 200); file = result.data.file
    assert.notEqual(file, join(project, '06_render', 'video.mp4'))
    assert.equal(readFileSync(file, 'utf8'), 'same video content')
  } finally { release(); await pending }
  assert.equal(existsSync(file), false)
})
