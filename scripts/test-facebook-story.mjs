// Facebook Story ตามรอบ (ทุก N โพสต์ต่อเพจ) — ไม่ยิง Facebook จริง
//   node scripts/test-facebook-story.mjs
// ผู้ใช้ (พ.ย. 2026): อยากแบ่งไปลง Story บ้าง เช่น 10 โพสต์ไป Story 1
// 5 พ.ย. 2026: Story เปลี่ยนเป็นภาพ "ไขปริศนาธรรม" ของคลิป (riddle.mjs) — ตัวตัดคลิปเป็นตอนยังอยู่ใน delivery-ledger
import assert from 'node:assert/strict'
import { test, beforeEach, after } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
const dir = mkdtempSync(join(tmpdir(), 'facebook-story-')); process.env.POSTING_DIR = dir
const P = await import('../pipeline/lib/posting.mjs')
const L = await import('../pipeline/lib/delivery-ledger.mjs')
const S = await import('../pipeline/lib/social.mjs')
const { createPosting } = await import('../bridge/posting.js')
const { ROOT } = await import('../pipeline/lib/config.mjs')

// ── ตัดตอน ──
test('คลิปไม่เกิน 59 วิ = ตอนเดียว · ยาวกว่าตัดที่ช่วงเงียบใกล้ 59 วิ · ไม่มีช่วงเงียบตัดที่ 59 วิ', () => {
  assert.deepEqual(L.storyCuts(45), [[0, 45]])
  assert.deepEqual(L.storyCuts(72, [{ start: 20, end: 21 }, { start: 55, end: 55.6 }, { start: 66, end: 67 }]), [[0, 55.3], [55.3, 72]])
  assert.deepEqual(L.storyCuts(72), [[0, 59], [59, 72]])
})
test('ตอนท้ายจะสั้นกว่า 3 วิ → แบ่งเท่าๆ กัน · คลิปยาวมากได้หลายตอน ไม่มีตอนไหนเกิน 59 วิ', () => {
  assert.deepEqual(L.storyCuts(61), [[0, 30.5], [30.5, 61]])
  const long = L.storyCuts(130)
  assert.equal(long.length, 3)
  assert.ok(long.every(([a, b]) => b - a <= 59 && b - a >= 3))
  assert.equal(long.at(-1)[1], 130)
})
test('เตรียมไฟล์ Story: เข้ารหัสทีละตอนตามจุดตัด · พลาดกลางทางลบไฟล์ที่ทำไปแล้ว', async () => {
  const calls = []
  const parts = await L.stageStoryParts('clip.mp4', dir, { probe: async () => 72, detect: async () => [], encode: async (_src, out, start, length) => { calls.push([start, length]); writeFileSync(out, 'x') } })
  assert.deepEqual(calls, [[0, 59], [59, 13]])
  assert.equal(parts.files.length, 2)
  await parts.remove()
  assert.ok(parts.files.every((f) => !existsSync(f)))
  let made
  await assert.rejects(L.stageStoryParts('clip.mp4', dir, { probe: async () => 72, detect: async () => [], encode: async (_src, out, start) => { if (start > 0) throw new Error('ffmpeg พัง'); made = out; writeFileSync(out, 'x') } }), /ffmpeg พัง/)
  assert.equal(existsSync(made), false)
  await assert.rejects(L.stageStoryParts('clip.mp4', dir, { probe: async () => 1 }), /สั้นเกินไป/)
})

// ── นับรอบ ──
const posted = (at, extra = {}) => ({ id: `q${at}`, results: { 'fb:a': { ok: true, at, ...extra } } })
test('นับเฉพาะโพสต์หลังเปิดตั้งค่าและหลัง Story ล่าสุด · Story ที่ไม่รู้ผลนับเป็นลงแล้ว · โพสต์ซ้ำที่ข้ามไม่นับ', () => {
  const queue = [posted(5), posted(10), posted(20, { story: { ok: true, at: 21 } }), posted(30), posted(40, { duplicateSkipped: true }), posted(50)]
  assert.equal(P.postsSinceStory(queue, 'fb:a', 0), 2)
  assert.equal(P.postsSinceStory(queue, 'fb:a', 45), 1)
  assert.equal(P.postsSinceStory([...queue, posted(60, { story: { ok: false, needsVerification: true, at: 61 } })], 'fb:a', 0), 0)
  assert.equal(P.postsSinceStory([...queue, posted(60, { story: { ok: false, needsVerification: false, at: 61 } })], 'fb:a', 0), 3, 'พลาดแบบรู้ว่ายังไม่ขึ้น → ยังถึงรอบ')
  assert.equal(P.storyDue(queue, 'fb:a', { storyEvery: 3, storySince: 0 }), true, 'โพสต์ที่ 3 หลัง Story')
  assert.equal(P.storyDue(queue, 'fb:a', { storyEvery: 5, storySince: 0 }), false)
  assert.equal(P.storyDue(queue, 'fb:a', { storyEvery: 0 }), false, 'ปิด')
})

// ── คำขอที่ส่งไป Facebook ──
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const sample = join(dir, 'part.mp4'); writeFileSync(sample, Buffer.alloc(1000, 1))
test('Story: start → อัปไฟล์ไป rupload พร้อม offset/file_size → finish ติดป้าย AI', async () => {
  const calls = []
  const out = await S.facebookStory({ pageId: '42', token: 'tok', file: sample }, { fetchImpl: async (url, init) => {
    calls.push({ url, init })
    if (calls.length === 1) return reply(200, { video_id: 'v1', upload_url: 'https://rupload.facebook.com/video-upload/v25.0/v1' })
    if (calls.length === 2) return reply(200, { success: true })
    return reply(200, { success: true, post_id: 'p1' })
  } })
  assert.match(calls[0].url, /graph\.facebook\.com\/v\d+\.0\/42\/video_stories$/)
  assert.match(calls[0].init.body, /upload_phase=start/)
  assert.equal(calls[1].init.headers.offset, '0')
  assert.equal(calls[1].init.headers.file_size, '1000')
  assert.equal(calls[1].init.headers.authorization, 'OAuth tok')
  assert.match(calls[2].init.body, /upload_phase=finish/)
  assert.match(calls[2].init.body, /video_id=v1/)
  assert.match(calls[2].init.body, /is_ai_generated=true/)
  assert.equal(out.postId, 'p1')
})
test('Story: URL อัปโหลดที่ไม่ใช่ของ Facebook ไม่ส่งไฟล์ · อัปพลาด = รู้ว่ายังไม่ขึ้น · finish พลาด = ไม่รู้ผล', async () => {
  await assert.rejects(S.facebookStory({ pageId: '42', token: 'tok', file: sample }, { fetchImpl: async () => reply(200, { video_id: 'v', upload_url: 'https://evil.example/up' }) }), (e) => /ไม่ใช่ของ Facebook/.test(e.message) && e.needsVerification === false)
  let n = 0
  await assert.rejects(S.facebookStory({ pageId: '42', token: 'tok', file: sample }, { fetchImpl: async () => (++n === 1 ? reply(200, { video_id: 'v', upload_url: 'https://rupload.facebook.com/x' }) : reply(500, { error: { message: 'upload broke' } })) }), (e) => e.needsVerification === false)
  n = 0
  await assert.rejects(S.facebookStory({ pageId: '42', token: 'tok', file: sample }, { fetchImpl: async () => (++n === 1 ? reply(200, { video_id: 'v', upload_url: 'https://rupload.facebook.com/x' }) : n === 2 ? reply(200, { success: true }) : reply(500, { error: { message: 'publish broke' } })) }), (e) => e.needsVerification === true)
})

// ── Story ภาพปริศนาธรรม (5 พ.ย. 2026: แทนการตัดคลิปลง Story) ──
const R = await import('../pipeline/lib/riddle.mjs')
const jpg = join(dir, 'story.jpg'); writeFileSync(jpg, Buffer.alloc(500, 1))
test('Story ภาพ: อัปภาพแบบยังไม่เผยแพร่ → ลง photo_stories ด้วยเลขภาพ · อัปภาพพลาด = รู้ว่ายังไม่ขึ้น · สั่งลงแล้วพลาด = ไม่รู้ผล', async () => {
  const calls = []
  const out = await S.facebookPhotoStory({ pageId: '42', token: 'tok', file: jpg }, { fetchImpl: async (url, init) => {
    calls.push({ url, init })
    return calls.length === 1 ? reply(200, { id: 'ph1' }) : reply(200, { success: true, post_id: 'st1' })
  } })
  assert.match(calls[0].url, /\/42\/photos$/)
  assert.equal(calls[0].init.body.get('published'), 'false')
  assert.match(calls[1].url, /\/42\/photo_stories$/)
  assert.match(calls[1].init.body, /photo_id=ph1/)
  assert.equal(out.postId, 'st1')
  await assert.rejects(S.facebookPhotoStory({ pageId: '42', token: 'tok', file: jpg }, { fetchImpl: async () => reply(500, { error: { message: 'photo broke' } }) }), (e) => e.needsVerification === false)
  let n = 0
  await assert.rejects(S.facebookPhotoStory({ pageId: '42', token: 'tok', file: jpg }, { fetchImpl: async () => (++n === 1 ? reply(200, { id: 'ph' }) : reply(500, { error: { message: 'story broke' } })) }), (e) => e.needsVerification === true)
})
test('โจทย์ปริศนา: อ่านบรรทัด riddle.png จาก ChatGPT · ชิ้นภาพ 2–3 ชิ้นเท่านั้น · ข้อความบนภาพมีหัวข้อและเฉลยมุมล่าง · คลิปภาษาอื่นไม่ขอโจทย์', () => {
  const r = R.parseRiddle('=== RIDDLE ===\nriddle.png | RIDDLE | ANSWER: "ขันติ" | PIECES: ขันน้ำ = ขัน + นิ้วชี้ = ติ | MEANING: ความอดทน')
  assert.deepEqual(r, { answer: 'ขันติ', pieces: [{ picture: 'ขันน้ำ', sound: 'ขัน' }, { picture: 'นิ้วชี้', sound: 'ติ' }], meaning: 'ความอดทน' })
  assert.equal(R.parseRiddle('riddle.png | RIDDLE | ANSWER: สติ | PIECES: ส้ม = ส | MEANING: x'), null, 'ชิ้นเดียวไม่ใช่ปริศนา')
  assert.equal(R.parseRiddle('ไม่มีโจทย์'), null)
  const ass = R.riddleAss(r)
  assert.match(ass, /ไขปริศนาธรรม/)
  assert.match(ass, /Style: Ans,[^\n]*,3,36,36,40,222/, 'เฉลยชิดมุมขวาล่าง')
  assert.match(ass, /เฉลย: ขันติ \(ขัน \+ ติ\)\\Nความอดทน/)
  assert.equal(R.riddleRequest('en'), '')
  assert.match(R.riddleRequest('th', { dhamma: 'ขันติ (ความอดทนอดกลั้น)' }), /riddle\.png \| RIDDLE/)
})

// ── ทั้งระบบ (คิวจริง ไม่ยิงเน็ต) ──
const project = mkdtempSync(join(ROOT, 'projects', '_storytest-')), slug = basename(project)
mkdirSync(join(project, '06_render'))
after(() => { rmSync(project, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }) })
const LONG_AGO = Date.now() - 3 * 3600_000 // โพสต์เก่าพ้นช่วงเว้น 30 นาทีแล้ว
let clipNo = 0
function newClip() {
  const file = `clip${++clipNo}.mp4`
  writeFileSync(join(project, '06_render', file), `video ${clipNo}`)
  return file
}
const scheduled = (file) => ({ ...P.newItem({ slug, file, title: `Clip ${file}`, post: { title: 'Caption' }, targets: ['fb:fb'] }), status: 'scheduled', scheduleAt: Date.now() - 1000, targetsEdited: true })
const done = (file, at) => ({ ...P.newItem({ slug, file, title: 'old', post: { title: 'x' }, targets: ['fb:fb'] }), status: 'posted', postedAt: at, results: { 'fb:fb': { ok: true, postId: 'old', at } } })
beforeEach(() => {
  for (const name of ['deliveries.json', 'deliveries.lock', 'deliveries.initialized']) rmSync(join(dir, name), { force: true })
  P.saveAccounts({ settings: {}, facebook: [{ id: 'fb', pageId: '123', token: 'fake-page-token-123456', name: 'Page', storyEvery: 3, storySince: 1 }], youtube: [], tiktok: [] })
})
function harness({ story = async () => ({ postId: 's' }), riddle = true } = {}) {
  const calls = { feed: 0, story: [], videoStory: 0 }; let body, response
  const posting = createPosting({ jobs: new Map(), enqueue() { throw new Error('no jobs') }, port: 1, token: 'test', log() {}, scheduler: false, readBody: async () => body, json: (_res, code, data) => { response = { code, data } }, deps: {
    listVideos: async () => [],
    facebookUpload: async () => { calls.feed++; return { postId: `f${calls.feed}`, url: `https://www.facebook.com/123/videos/f${calls.feed}` } },
    facebookStory: async () => { calls.videoStory++; return { postId: 'v' } },
    facebookPhotoStory: async (x) => { calls.story.push(x.file); return story(x) },
    prepareRiddleStory: async (s) => (riddle ? { file: `${s}/story.jpg`, riddle: { answer: 'ขันติ' }, remove: async () => {} } : null),
    stageCover: async () => null,
  } })
  return { posting, calls, request: async (path, data) => { body = data; await posting.handle({ method: data ? 'POST' : 'GET', headers: { host: '127.0.0.1:1', 'x-bridge-token': 'test' } }, {}, new URL(path, 'http://127.0.0.1:1')); return response } }
}
test('โพสต์ที่ถึงรอบ ลง Story ภาพปริศนาของคลิปนั้นหลังโพสต์หน้าเพจ · ไม่ลงคลิปเป็น Story · โพสต์ถัดไปไม่ลงซ้ำ', async () => {
  const clip = newClip()
  P.saveQueue([done(newClip(), LONG_AGO), done(newClip(), LONG_AGO + 1), scheduled(clip)])
  const h = harness(); await h.posting.tick()
  const item = P.loadQueue().find((q) => q.file === clip)
  assert.equal(item.status, 'posted')
  assert.equal(h.calls.feed, 1)
  assert.deepEqual(h.calls.story, [`${slug}/story.jpg`])
  assert.equal(h.calls.videoStory, 0)
  assert.equal(item.results['fb:fb'].story.ok, true)
  assert.equal(item.results['fb:fb'].story.riddle, 'ขันติ')
  assert.ok(item.history.some((x) => /ลง Story ปริศนาธรรมแล้ว \(เฉลย: ขันติ\)/.test(x.text)))
  const next = newClip()
  P.saveQueue([...P.loadQueue().map((q) => ({ ...q, ...(q.postedAt ? { postedAt: q.postedAt - 3600_000 } : {}), results: Object.fromEntries(Object.entries(q.results ?? {}).map(([k, r]) => [k, { ...r, at: r.at - 3600_000, ...(r.story ? { story: { ...r.story, at: r.story.at - 3600_000 } } : {}) }])) })), scheduled(next)])
  const h2 = harness(); await h2.posting.tick()
  assert.equal(h2.calls.feed, 1)
  assert.deepEqual(h2.calls.story, [])
})
test('คลิปไม่มีภาพปริศนา → ข้าม Story ไม่นับรอบ · โพสต์ถัดไปลองใหม่', async () => {
  const clip = newClip()
  P.saveQueue([done(newClip(), LONG_AGO), done(newClip(), LONG_AGO + 1), scheduled(clip)])
  const h = harness({ riddle: false }); await h.posting.tick()
  const item = P.loadQueue().find((q) => q.file === clip)
  assert.equal(item.results['fb:fb'].ok, true)
  assert.equal(item.results['fb:fb'].story.skipped, true)
  assert.deepEqual(h.calls.story, [])
  assert.equal(P.storyDue(P.loadQueue(), 'fb:fb', P.loadAccounts().facebook[0]), true)
})
test('Story พลาดไม่ทำให้โพสต์หน้าเพจนับว่าพลาด · ยังถึงรอบ โพสต์ถัดไปลองใหม่', async () => {
  const clip = newClip()
  P.saveQueue([done(newClip(), LONG_AGO), done(newClip(), LONG_AGO + 1), scheduled(clip)])
  const h = harness({ story: async () => { throw Object.assign(new Error('Facebook: token expired'), { needsVerification: false }) } }); await h.posting.tick()
  const item = P.loadQueue().find((q) => q.file === clip)
  assert.equal(item.status, 'posted')
  assert.equal(item.results['fb:fb'].ok, true)
  assert.equal(item.results['fb:fb'].story.ok, false)
  assert.equal(P.storyDue(P.loadQueue(), 'fb:fb', P.loadAccounts().facebook[0]), true)
})
test('สั่งลง Story แล้วไม่รู้ผล → นับเป็นลงแล้ว และคลิปเดิมจะไม่ลง Story ซ้ำ', async () => {
  const clip = newClip()
  P.saveQueue([done(newClip(), LONG_AGO), done(newClip(), LONG_AGO + 1), scheduled(clip)])
  const h = harness({ story: async () => { throw Object.assign(new Error('lost'), { needsVerification: true }) } }); await h.posting.tick()
  const story = P.loadQueue().find((q) => q.file === clip).results['fb:fb'].story
  assert.equal(story.ok, false)
  assert.equal(story.needsVerification, true)
  assert.equal(P.storyDue(P.loadQueue(), 'fb:fb', P.loadAccounts().facebook[0]), false)
})
test('ตั้งค่ารอบ Story ต่อเพจ: รับเฉพาะ ปิด/1/2/3/5/10/20 · เปลี่ยนค่าแล้วเริ่มนับใหม่ · หน้าจอเห็นว่าอีกกี่โพสต์', async () => {
  P.saveQueue([done(newClip(), LONG_AGO)])
  const h = harness()
  assert.equal((await h.request('/api/posting/facebook/update', { id: 'fb', storyEvery: 7 })).code, 400)
  assert.equal((await h.request('/api/posting/facebook/update', { id: 'fb', storyEvery: 1 })).code, 200)
  const before = Date.now()
  const r = await h.request('/api/posting/facebook/update', { id: 'fb', storyEvery: 10 })
  assert.equal(r.code, 200)
  const page = P.loadAccounts().facebook[0]
  assert.equal(page.storyEvery, 10)
  assert.ok(page.storySince >= before, 'โพสต์เก่าไม่ถูกนับ')
  assert.equal(r.data.facebook[0].storyIn, 10)
  assert.equal(r.data.facebook[0].token.includes('fake-page-token'), false, 'ไม่ส่งโทเค็นเต็มให้หน้าจอ')
  await h.request('/api/posting/facebook/update', { id: 'fb', storyEvery: 0 })
  assert.equal(P.loadAccounts().facebook[0].storyEvery, 0)
})