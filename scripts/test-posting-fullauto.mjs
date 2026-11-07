// เทสต์: "ออโต้ทั้งหมด" — ผลิตเสร็จ → เข้าคิว → AI ตรวจ → (ไม่มีข้อความโพสต์ก็ให้ ChatGPT เขียนให้) → ตั้งเวลา → โพสต์
//         แล้วบอกว่าโพสต์ไปไหนบ้าง (แจ้งเตือน + บรรทัด "โพสต์ล่าสุด" ในแผงข้าง)
//   node scripts/test-posting-fullauto.mjs
// ไม่ยิง Facebook/ChatGPT จริง · คิว/บัญชีอยู่ใน temp · โปรเจกต์ทดสอบ _fullautotest ถูกลบทิ้งตอนจบ
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const tmp = mkdtempSync(join(tmpdir(), 'posting-fullauto-'))
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

// ── ตรรกะล้วน: ข้อความ "โพสต์ไปไหนบ้าง" ──
const posted = {
  id: 'a', title: 'คลิป ก', status: 'posted', finishedAt: 2000, targets: ['fb:1', 'yt:2'],
  results: { 'fb:1': { ok: true, name: 'เพจธรรมะ', url: 'https://fb/1' }, 'yt:2': { ok: true, name: 'ช่องธรรมะ', url: 'https://yt/2' } },
}
const failed = {
  id: 'b', title: 'คลิป ข', status: 'failed', finishedAt: 3000, targets: ['fb:1', 'yt:2'],
  results: { 'fb:1': { ok: true, name: 'เพจธรรมะ', url: 'https://fb/1' }, 'yt:2': { ok: false, name: 'ช่องธรรมะ', error: 'โควตาหมด' } },
}
const held = { id: 'c', title: 'คลิป ค', status: 'review', ai: { status: 'done', verdict: 'fix', summary: 'เสียงไม่ชัด', checkedAt: 2500 } }
const old = { ...posted, id: 'd', finishedAt: 500 }

await test('สรุปปลายทาง: ✓ ที่สำเร็จ · ✗ ที่พลาดพร้อมเหตุผล', () => {
  assert.equal(P.resultSummary(posted), 'เพจธรรมะ ✓ · ช่องธรรมะ ✓')
  assert.equal(P.resultSummary(failed), 'เพจธรรมะ ✓ · ช่องธรรมะ ✗ (โควตาหมด)')
})

await test('เหตุการณ์ใหม่หลังเวลาที่เห็นล่าสุด: โพสต์แล้ว / พลาด / AI ให้รอคนดู · เรียงตามเวลา', () => {
  const ev = P.postingEvents([old, failed, posted, held], 1000)
  assert.deepEqual(ev.map((e) => [e.id, e.kind]), [['a', 'posted'], ['c', 'held'], ['b', 'failed']])
  assert.match(ev[0].text, /เพจธรรมะ ✓/)
  assert.match(ev[1].text, /เสียงไม่ชัด/)
  assert.deepEqual(P.postingEvents([old, posted], 5000), [])
})

await test('โพสต์ล่าสุด: คลิปที่จบการโพสต์ล่าสุด (สำเร็จหรือพลาด) · ไม่มี = null', () => {
  assert.equal(P.lastPosted([old, posted, failed, held]).id, 'b')
  assert.equal(P.lastPosted([held]), null)
})

// ── ต่อสายจริง: bridge + คิว + ChatGPT/Facebook ปลอม ──
const SLUG = '_fullautotest'
const projectDir = join(ROOT, 'projects', SLUG)
rmSync(projectDir, { recursive: true, force: true })
mkdirSync(join(projectDir, '06_render'), { recursive: true })
mkdirSync(join(projectDir, '01_script'), { recursive: true })
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=320x568:d=4', '-pix_fmt', 'yuv420p', join(projectDir, '06_render', `${SLUG}.mp4`)])

const jobs = new Map()
const uploads = []
const clipAt = Date.now()
const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
const readBody = (req) => new Promise((resolve) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => resolve(raw ? JSON.parse(raw) : {}))
})
const server = createServer()
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const posting = createPosting({
  jobs, json, readBody, port, token: 'tk', log: () => {}, scheduler: false,
  enqueue: (agent, kind, payload) => {
    const job = { id: `job${jobs.size + 1}`, agent, kind, payload, status: 'queued' }
    jobs.set(job.id, job)
    return job
  },
  deps: {
    listVideos: async () => [{ slug: SLUG, title: 'คลิปออโต้', files: [{ name: `${SLUG}.mp4`, main: true, seconds: 4, createdAt: clipAt }] }],
    facebookUpload: async (args) => (uploads.push(args), { postId: '1', url: 'https://www.facebook.com/p/1' }),
  },
})
server.on('request', async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`)
  if (!(await posting.handle(req, res, url))) json(res, 404, {})
})
const get = async (path) => (await fetch(`http://127.0.0.1:${port}${path}`, { headers: { 'x-bridge-token': 'tk' } })).json()
const item = () => P.loadQueue().find((q) => q.slug === SLUG)
const lastJob = () => [...jobs.values()].at(-1)

try {
  P.updateAccounts((d) => {
    d.facebook.push({ id: 'p1', name: 'เพจธรรมะ', pageId: '1234567', token: 'x'.repeat(30) })
    Object.assign(d.settings, { enabledAt: clipAt - 1000, autoCheck: true, autoApprove: true, skipCheck: false, slots: ['12:00', '19:00'] }) // เลือก AI ตรวจเอง (ค่าเริ่มต้นไม่ตรวจ)
  })

  await test('ผลิตเสร็จ → เข้าคิวเอง → ส่ง AI ตรวจเอง', async () => {
    await posting.tick()
    assert.equal(item().status, 'review')
    assert.equal(item().ai?.status, 'running')
    assert.match(lastJob().payload.label, /ตรวจคลิป/)
  })

  await test('AI ให้ผ่านแต่คลิปยังไม่มีข้อความโพสต์ → ให้ ChatGPT เขียนให้เอง (ไม่ค้างรอคน)', async () => {
    Object.assign(lastJob(), { status: 'done', result: { text: '{"score": 92, "verdict": "pass", "summary": "ดี", "issues": []}' } })
    await posting.tick()
    assert.equal(item().ai.verdict, 'pass')
    assert.equal(item().status, 'review', 'ยังไม่มีข้อความโพสต์ ยังตั้งเวลาไม่ได้')
    assert.match(lastJob().payload.label, /คิดชื่อคลิป/)
    await posting.tick()
    assert.equal([...jobs.values()].filter((j) => /คิดชื่อคลิป/.test(j.payload.label)).length, 1, 'ไม่ขอซ้ำระหว่างรอ')
  })

  await test('ได้ข้อความโพสต์ → บันทึก post.json → ตั้งเวลาโพสต์เองที่ช่องเวลาถัดไป', async () => {
    Object.assign(lastJob(), { status: 'done', result: { text: '{"titles": ["ปล่อยวางอย่างไร"], "description": "คำบรรยาย", "hashtags": ["#ธรรมะ"]}' } })
    await posting.tick()
    assert.equal(item().post.title, 'ปล่อยวางอย่างไร')
    assert.ok(existsSync(join(projectDir, '01_script', 'post.json')))
    assert.equal(item().status, 'scheduled')
    assert.equal(item().scheduleAt, P.nextFreeSlot(['12:00', '19:00'], []))
  })

  await test('ถึงเวลา → โพสต์ → endpoint บอกว่าโพสต์ไปไหนบ้าง (แจ้งเตือน + โพสต์ล่าสุด)', async () => {
    const since = Date.now() - 1
    const q = P.loadQueue()
    // ถึงเวลาทุกปลายทาง (เวลาต่อปลายทาง: ต้องเลื่อนทั้งของคลิปและของแต่ละปลายทาง)
    P.setTargetTimes(q.find((x) => x.slug === SLUG), Object.fromEntries(q.find((x) => x.slug === SLUG).targets.map((k) => [k, Date.now() - 1000])))
    P.saveQueue(q)
    await posting.tick()
    assert.equal(item().status, 'posted')
    assert.equal(uploads.length, 1)
    const r = await get(`/api/posting/recent?since=${since}`)
    assert.ok(r.now >= since)
    assert.deepEqual(r.events.map((e) => e.kind), ['posted'])
    assert.equal(r.events[0].title, 'คลิปออโต้')
    assert.equal(r.events[0].text, 'เพจธรรมะ ✓')
    assert.equal(r.events[0].links[0].url, 'https://www.facebook.com/p/1')
    assert.equal(r.last.title, 'คลิปออโต้')
    assert.deepEqual((await get(`/api/posting/recent?since=${r.now}`)).events, [])
  })

  await test('แผง + แจ้งเตือน: สวิตช์ "ออโต้ทั้งหมด" · บรรทัดโพสต์ล่าสุด · Chrome แจ้งเตือนหลังโพสต์', () => {
    const js = readFileSync(join(ROOT, 'extension', 'posting.js'), 'utf8')
    assert.match(js, /ออโต้ทั้งหมด/)
    assert.match(js, /enabled: true, autoCheck: true, autoApprove: true/)
    assert.match(readFileSync(join(ROOT, 'extension', 'sidepanel.html'), 'utf8'), /id="lastPost"/)
    assert.match(readFileSync(join(ROOT, 'extension', 'sidepanel.js'), 'utf8'), /\/api\/posting\/recent/)
    const bg = readFileSync(join(ROOT, 'extension', 'background.js'), 'utf8')
    assert.match(bg, /async function checkPosting\(\)/)
    assert.match(bg, /\/api\/posting\/recent\?since=/)
    assert.match(bg, /checkPosting\(\)/)
  })
} finally {
  server.close()
  rmSync(projectDir, { recursive: true, force: true })
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\nผ่าน ${passed} ข้อ`)
