// เทสต์ตรวจโพสต์ที่ "ไม่รู้ผล" กับเพจ Facebook — ไม่ยิง Facebook จริง ไม่แตะคิว/โทเค็นจริง
//   node scripts/test-posting-verify.mjs
// ผู้ใช้ (19 พ.ย. 2026): Facebook ตอบ 502/503 หลังรับไฟล์ → คลิปค้าง "พลาด" ถาวร เพราะระบบล็อกกันโพสต์ซ้ำแต่ไม่มีทางปลด
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const tmp = mkdtempSync(join(tmpdir(), 'posting-verify-'))
process.env.POSTING_DIR = tmp
const P = await import('../pipeline/lib/posting.mjs')
const { createPosting } = await import('../bridge/posting.js')
const { facebookFindVideo } = await import('../pipeline/lib/social.mjs')
const { ROOT } = await import('../pipeline/lib/config.mjs')

let passed = 0
const test = async (name, fn) => {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

await test('หาวิดีโอในเพจ: ตรงชื่อโพสต์ หรือต้นข้อความ · ไม่ตรง = ไม่พบ · อ่านเพจไม่ได้ = throw', async () => {
  const page = (data, next) => ({ ok: true, json: async () => ({ data, paging: next ? { next } : {} }) })
  const fetchImpl = async (url) => url.includes('page2')
    ? page([{ id: '77', title: 'ชื่อโพสต์  จริง', description: 'x', created_time: '2026-11-12T14:05:00+0000' }])
    : page([{ id: '11', title: 'อื่น', description: 'เรื่องอื่น' }], 'https://graph/page2')
  const hit = await facebookFindVideo({ pageId: 'P', token: 't', title: 'ชื่อโพสต์ จริง', description: 'ไม่เกี่ยว', since: 0 }, { fetchImpl })
  assert.equal(hit.found, true)
  assert.equal(hit.postId, '77')
  const byText = await facebookFindVideo({ pageId: 'P', token: 't', title: 'ไม่มี', description: 'เรื่องอื่น ที่ยาวพอจะจับคู่ได้แน่นอน', since: 0 }, { fetchImpl: async () => page([{ id: '5', title: '', description: 'เรื่องอื่น ที่ยาวพอจะจับคู่ได้แน่นอน #แท็ก' }]) })
  assert.equal(byText.found, true)
  const miss = await facebookFindVideo({ pageId: 'P', token: 't', title: 'ไม่มีในเพจ', description: 'ไม่มีในเพจเลยจริงๆ นะ ข้อความนี้', since: 0 }, { fetchImpl })
  assert.deepEqual(miss, { found: false, checked: 2 })
  await assert.rejects(facebookFindVideo({ pageId: 'P', token: 't', title: 'x', since: 0 }, { fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) }))
})

// ── bridge + คิวจริง (Facebook ปลอม) ──
const SLUG = '_verifytest'
const projectDir = join(ROOT, 'projects', SLUG)
rmSync(projectDir, { recursive: true, force: true })
mkdirSync(join(projectDir, '06_render'), { recursive: true })
mkdirSync(join(projectDir, '01_script'), { recursive: true })
const video = join(projectDir, '06_render', `${SLUG}.mp4`)
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=320x568:d=2', '-pix_fmt', 'yuv420p', video])
writeFileSync(join(projectDir, '01_script', 'post.json'), JSON.stringify({ titles: ['ชื่อโพสต์ทดสอบ'], description: 'คำบรรยายทดสอบ', hashtags: ['#ธรรมะ'] }))

const TOKEN = 'test-token'
const uploads = []
let failNext = true
let onPage = false
const finds = []
const fakeVideos = async () => [{ slug: SLUG, title: 'คลิปทดสอบ', thumb: null, post: null, updatedAt: Date.now(), files: [{ name: `${SLUG}.mp4`, main: true, url: '/files/x', seconds: 2, createdAt: Date.now() }] }]
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const readBody = (req) => new Promise((resolve) => { let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => resolve(raw ? JSON.parse(raw) : {})) })
const server = createServer()
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const logs = []
const posting = createPosting({
  jobs: new Map(), json, readBody, port, token: TOKEN, log: (s) => logs.push(s), scheduler: false, enqueue: () => ({}),
  deps: {
    listVideos: fakeVideos,
    verifyAfterMs: 0, verifyEveryMs: 0,
    facebookPageInfo: async ({ pageId }) => ({ id: pageId, name: 'เพจทดสอบ' }),
    facebookUpload: async (args) => {
      uploads.push(args)
      if (failNext) { failNext = false; throw Object.assign(new Error('Facebook: HTTP 503'), { needsVerification: true }) }
      return { postId: 'new1', url: `https://www.facebook.com/${args.pageId}/videos/new1` }
    },
    facebookFindVideo: async (args) => {
      finds.push(args)
      return onPage ? { found: true, postId: 'old9', url: `https://www.facebook.com/${args.pageId}/videos/old9`, createdAt: '2026-11-12T14:05:00+0000' } : { found: false, checked: 3 }
    },
  },
})
server.on('request', async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`)
  if (!(await posting.handle(req, res, url))) json(res, 404, { error: 'ไม่ใช่ของโหมดโพสต์' })
})
const base = `http://127.0.0.1:${port}`
async function call(path, body, { expect = 200 } = {}) {
  const res = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-bridge-token': TOKEN }, body: body && JSON.stringify(body) })
  const data = await res.json()
  assert.equal(res.status, expect, `${path} ควรได้ ${expect} แต่ได้ ${res.status}: ${data.error ?? ''}`)
  return data
}
const item = () => P.loadQueue().find((q) => q.slug === SLUG)
const ledger = () => JSON.parse(readFileSync(join(tmp, 'deliveries.json'), 'utf8')).entries
/** ทำให้คลิปถึงเวลาโพสต์เดี๋ยวนี้ แล้วให้รอบทำงานส่ง */
async function postNow() {
  const q = P.loadQueue()
  const it = q.find((x) => x.slug === SLUG)
  it.status = 'scheduled'
  P.setTargetTimes(it, Object.fromEntries(it.targets.filter((k) => !it.results?.[k]?.ok).map((k) => [k, Date.now() - 1000])))
  P.saveQueue(q)
  await posting.tick()
}

try {
  await call('/api/posting/settings', { enabled: true, slots: '09:00,21:00', autoCheck: false })
  const fb = (await call('/api/posting/facebook', { pageId: '1234567', token: 'good-token-abcdefghij1234' })).facebook[0]
  const key = `fb:${fb.id}`

  await test('Facebook 503 หลังส่งไฟล์ → พลาดแบบไม่รู้ผล · ปุ่มลองใหม่ถูกปฏิเสธ (กันโพสต์ซ้ำ)', async () => {
    await call('/api/posting/add', { slug: SLUG, file: `${SLUG}.mp4` })
    await postNow()
    assert.equal(item().status, 'failed')
    assert.equal(item().results[key].needsVerification, true)
    assert.equal(ledger().filter((e) => e.status === 'uncertain').length, 1)
    await call('/api/posting/retry', { id: item().id }, { expect: 409 })
  })

  await test('ตรวจกับเพจแล้วไม่พบ → ปลดล็อก + ตั้งเวลาโพสต์ใหม่ในช่องว่างถัดไป · ไม่อัปซ้ำทันที', async () => {
    const v = await call('/api/posting/verify', { id: item().id })
    assert.match(v.message, /ไม่พบโพสต์ที่ เพจทดสอบ — ตั้งเวลาโพสต์ใหม่แล้ว/)
    assert.equal(finds.at(-1).pageId, '1234567')
    assert.equal(finds.at(-1).title, 'ชื่อโพสต์ทดสอบ')
    assert.equal(item().status, 'scheduled')
    assert.ok(item().scheduleAt > Date.now(), 'ลงช่องเวลาถัดไป ไม่ใช่ส่งทันที')
    assert.equal(item().results[key].needsVerification, false)
    assert.equal(item().results[key].verifiedMissing, true)
    assert.deepEqual(ledger().map((e) => e.status), ['retryable'])
    assert.equal(uploads.length, 1)
  })

  await test('ถึงเวลา → ส่งใหม่ได้จริง (ประวัติถาวรยอมให้ส่ง) → โพสต์แล้ว', async () => {
    await postNow()
    assert.equal(uploads.length, 2)
    assert.equal(item().status, 'posted')
    assert.equal(item().results[key].postId, 'new1')
    assert.deepEqual(ledger().map((e) => e.status).sort(), ['done', 'retryable'])
  })

  await test('ตรวจกับเพจแล้วพบ → นับว่าโพสต์แล้ว ไม่อัปซ้ำ · รอบอัตโนมัติ (tick) ตรวจเอง', async () => {
    // คลิปเดิมเข้าคิวใหม่ไม่ได้ (ห้ามโพสต์ซ้ำ) → จำลองคลิปที่สอง
    const SLUG2 = `${SLUG}2`
    const dir2 = join(ROOT, 'projects', SLUG2, '06_render')
    mkdirSync(dir2, { recursive: true })
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x568:d=2', '-pix_fmt', 'yuv420p', join(dir2, `${SLUG2}.mp4`)])
    // เพจที่สอง — เพจแรกเพิ่งโพสต์ไป ต้องเว้น 30 นาทีต่อเพจ
    const fb2 = (await call('/api/posting/facebook', { pageId: '7654321', token: 'good-token-zyxwvutsrq9876' })).facebook.find((a) => a.pageId === '7654321')
    const key2 = 'fb:' + fb2.id
    try {
      const q = P.loadQueue()
      const it = P.newItem({ slug: SLUG2, file: `${SLUG2}.mp4`, title: 'คลิปสอง', post: { titles: ['ชื่อคลิปสอง'], description: 'คำบรรยายคลิปสอง' } })
      it.targets = [key2]
      q.push(it)
      P.saveQueue(q)
      failNext = true
      const q2 = P.loadQueue(); const x = q2.find((y) => y.id === it.id)
      x.status = 'scheduled'; P.setTargetTimes(x, { [key2]: Date.now() - 1000 }); P.saveQueue(q2)
      await posting.tick() // ส่ง → 503 → ไม่รู้ผล (รอบเดียวกันตรวจก่อนส่ง จึงยังไม่ตรวจ)
      assert.equal(P.loadQueue().find((y) => y.id === it.id).status, 'failed')
      onPage = true
      const before = uploads.length
      await posting.tick() // รอบถัดไป: ตรวจกับเพจเอง
      const done = P.loadQueue().find((y) => y.id === it.id)
      assert.equal(done.status, 'posted')
      assert.equal(done.results[key2].verified, true)
      assert.equal(done.results[key2].postId, 'old9')
      assert.equal(uploads.length, before, 'ไม่อัปซ้ำ')
      assert.ok(logs.some((l) => /ขึ้นจริง นับว่าโพสต์แล้ว/.test(l)))
    } finally {
      rmSync(join(ROOT, 'projects', SLUG2), { recursive: true, force: true })
    }
  })

  await test('ไฟล์คลิปหาย → ไม่ตั้งเวลาใหม่ · ไฟล์กลับมา (ตัดต่อใหม่) → ตั้งเวลาโพสต์ใหม่เอง', async () => {
    const q = P.loadQueue()
    const it = q.find((x) => x.slug === SLUG)
    Object.assign(it, { status: 'failed', results: { [key]: { ok: false, needsVerification: false, error: "ENOENT: no such file or directory, stat 'x.mp4'", at: Date.now() } } })
    P.saveQueue(q)
    const moved = video + '.bak'
    execFileSync(process.platform === 'win32' ? 'cmd' : 'mv', process.platform === 'win32' ? ['/c', 'move', '/y', video, moved] : [video, moved])
    await posting.tick()
    assert.equal(item().status, 'failed', 'ไฟล์ยังหาย ไม่ตั้งเวลา')
    execFileSync(process.platform === 'win32' ? 'cmd' : 'mv', process.platform === 'win32' ? ['/c', 'move', '/y', moved, video] : [moved, video])
    await posting.tick()
    assert.equal(item().status, 'scheduled')
  })

  await test('พลาดเพราะเหตุอื่น (เช่นโทเค็นหมดอายุ) → ไม่ส่งใหม่เองวนซ้ำ', async () => {
    const q = P.loadQueue()
    const it = q.find((x) => x.slug === SLUG)
    Object.assign(it, { status: 'failed', results: { [key]: { ok: false, needsVerification: false, error: 'Facebook: Invalid OAuth access token', at: Date.now() } } })
    P.saveQueue(q)
    await posting.tick()
    assert.equal(item().status, 'failed')
  })

  console.log(`\nผ่าน ${passed} ข้อ`)
} finally {
  server.close()
  rmSync(projectDir, { recursive: true, force: true })
  rmSync(tmp, { recursive: true, force: true })
}
process.exit(0)
