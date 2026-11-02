// Regression: a scheduled clip must not silently lose its page destination.
// Runs against temporary accounts/queue; never publishes to Facebook.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, basename, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'

const temp = mkdtempSync(join(tmpdir(), 'posting-targets-'))
process.env.POSTING_DIR = temp
const P = await import('../pipeline/lib/posting.mjs')
const { createPosting } = await import('../bridge/posting.js')
const { ROOT } = await import('../pipeline/lib/config.mjs')
const projectDir = mkdtempSync(join(ROOT, 'projects', '_targettest-'))
const slug = basename(projectDir)
const file = `${slug}.mp4`
const category = 'หมวด 3 · ธรรมะสำหรับพุทธศาสนิกชน'
const clipAt = Date.now()
const future = clipAt + 86400_000
let passed = 0
let requestBody = {}
let response
const posting = createPosting({
  jobs: new Map(), enqueue: () => { throw new Error('Unexpected AI job') },
  json: (_res, code, body) => { response = { code, body } },
  readBody: async () => requestBody,
  port: 1, token: 'test', log: () => {}, scheduler: false,
  deps: {
    listVideos: async () => [{ slug, title: 'คลิปธรรมะ', files: [{ name: file, main: true, createdAt: clipAt }] }],
    facebookUpload: async () => { throw new Error('Must not publish future clips') },
  },
})
const request = async (path, body) => {
  requestBody = body
  response = null
  await posting.handle({ method: body ? 'POST' : 'GET', headers: { host: '127.0.0.1:1', 'x-bridge-token': 'test' } }, {}, new URL(path, 'http://127.0.0.1:1'))
  assert.equal(response.code, 200, response.body.error)
  return response.body
}
const test = async (name, fn) => {
  P.saveQueue([])
  P.saveAccounts({ settings: { autoCheck: false }, facebook: [{ id: 'dhamma', name: 'เพจธรรมะ', pageId: '1234567', token: 'test', categories: [category] }], youtube: [] })
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}
const item = (extra = {}) => ({ ...P.newItem({ slug, file, title: 'คลิปธรรมะ', post: { title: 'ชื่อโพสต์' } }), status: 'scheduled', scheduleAt: future, ...extra })

try {
  mkdirSync(join(projectDir, '00_ref'))
  mkdirSync(join(projectDir, '06_render'))
  writeFileSync(join(projectDir, '00_ref', 'profile.json'), JSON.stringify({ category: 'dhamma' }))
  writeFileSync(join(projectDir, '06_render', file), '')

  await test('automatic enrollment reads clip category and selects its matching page', async () => {
    P.updateAccounts(({ settings }) => { settings.enabledAt = clipAt - 1000 })
    await posting.tick()
    const [q] = P.loadQueue()
    assert.equal(q.category, category)
    assert.deepEqual(q.targets, ['fb:dhamma'])
  })

  await test('adding from the library selects the page accepting the clip category', async () => {
    const v = await request('/api/posting/add', { slug, file })
    assert.equal(v.queue[0].category, category)
    assert.deepEqual(v.queue[0].targets, ['fb:dhamma'])
  })

  await test('opening the panel repairs an old scheduled clip before its posting time', async () => {
    P.saveQueue([item()])
    const v = await request('/api/posting')
    assert.deepEqual(v.queue[0].targets, ['fb:dhamma'])
    const [q] = P.loadQueue()
    assert.deepEqual(q.targets, ['fb:dhamma'], 'repair must persist')
    assert.equal(q.category, category)
    assert.equal(q.scheduleAt, future)
    assert.equal(q.status, 'scheduled')
  })

  await test('a background tick fills the page of future scheduled clips', async () => {
    P.saveQueue([item()])
    await posting.tick()
    assert.deepEqual(P.loadQueue()[0].targets, ['fb:dhamma'])
  })

  await test('a new page repairs only automatic destinations; explicit selections stay intact', async () => {
    P.saveQueue([item({ id: 'auto', category, categoryBy: 'clip' }), item({ id: 'manual', targetsEdited: true }), item({ id: 'assigned', targets: ['fb:old'] })])
    await request('/api/posting')
    const q = P.loadQueue()
    assert.deepEqual(q[0].targets, ['fb:dhamma'])
    assert.deepEqual(q[1].targets, [])
    assert.deepEqual(q[2].targets, ['fb:old'])
  })

  await test('unknown category does not send a clip to an unrelated restricted page', async () => {
    P.saveQueue([item({ slug: `${slug}-missing` })])
    await request('/api/posting')
    assert.deepEqual(P.loadQueue()[0].targets, [])
  })

  await test('posted and failed results are preserved when opening the panel', async () => {
    const q = [item({ id: 'done', status: 'posted', results: { 'fb:old': { ok: true, url: 'u' } } }), item({ id: 'failed', status: 'failed', error: 'original failure' })]
    P.saveQueue(q)
    await request('/api/posting')
    assert.deepEqual(P.loadQueue(), q)
  })
} finally {
  assert.ok(resolve(projectDir).startsWith(resolve(ROOT, 'projects') + sep))
  assert.ok(resolve(temp).startsWith(resolve(tmpdir()) + sep))
  rmSync(projectDir, { recursive: true, force: true })
  rmSync(temp, { recursive: true, force: true })
}
console.log(`\nผ่าน ${passed} ข้อ`)
