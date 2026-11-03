// Local-only TikTok queue regressions. No browser, upload or external request.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, basename, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { test, after, beforeEach } from 'node:test'

const temp = mkdtempSync(join(tmpdir(), 'tiktok-posting-'))
process.env.POSTING_DIR = temp
const P = await import('../pipeline/lib/posting.mjs')
const { createPosting } = await import('../bridge/posting.js')
const { ROOT } = await import('../pipeline/lib/config.mjs')
const project = mkdtempSync(join(ROOT, 'projects', '_tiktoktest-'))
const slug = basename(project)
mkdirSync(join(project, '06_render'))
writeFileSync(join(project, '06_render', `${slug}.mp4`), 'fixture')
beforeEach(() => {
  for (const file of ['deliveries.json', 'deliveries.lock', 'deliveries.initialized']) rmSync(join(temp, file), { force: true })
})
after(() => {
  assert.ok(resolve(project).startsWith(resolve(ROOT, 'projects') + sep))
  assert.ok(resolve(temp).startsWith(resolve(tmpdir()) + sep))
  rmSync(project, { recursive: true, force: true })
  rmSync(temp, { recursive: true, force: true })
})
const account = { id: 'one', username: 'romeo', name: 'Romeo', privacy: 'public', aigc: true }
const accounts = () => ({ settings: { autoCheck: false }, facebook: [], youtube: [], tiktok: [{ ...account }] })
const due = extra => ({ ...P.newItem({ slug, file: `${slug}.mp4`, title: 'คลิป', post: { title: 'ชื่อ', description: 'คำบรรยาย' }, targets: ['tk:one'] }), status: 'scheduled', scheduleAt: Date.now() - 1000, ...extra })
function harness(reply = { ok: true, published: true, username: 'romeo', url: 'https://www.tiktok.com/@romeo/video/1234567' }) {
  const jobs = new Map(), calls = []
  let body, response
  const posting = createPosting({
    jobs, enqueue: (agent, kind, payload) => {
      const job = { id: `tk-${calls.length}`, agent, kind, payload, status: 'queued' }
      calls.push(job); jobs.set(job.id, job)
      queueMicrotask(() => { if (!job.cancelled) { job.status = 'done'; job.result = { meta: reply } } })
      return job
    }, json: (_r, code, data) => { response = { code, data } }, readBody: async () => body,
    port: 1, token: 'test', log: () => {}, scheduler: false,
    deps: { listVideos: async () => [], tiktokPollMs: 1, tiktokTimeoutMs: 100, youtubeUpload: async () => { throw new Error('TikTok must never call YouTube') } },
  })
  return { posting, calls, jobs, request: async (path, data) => {
    body = data
    await posting.handle({ method: data ? 'POST' : 'GET', headers: { host: '127.0.0.1:1', 'x-bridge-token': 'test' } }, {}, new URL(path, 'http://127.0.0.1:1'))
    return response
  } }
}

test('TikTok destinations resolve by account and category; legacy account objects work', () => {
  const a = accounts()
  assert.deepEqual(P.allTargets(a), ['tk:one'])
  assert.equal(P.findTarget(a, 'tk:one').kind, 'tiktok')
  assert.equal(P.findTarget(a, 'tk:one').account.username, 'romeo')
  assert.deepEqual(P.targetsFor(a, null), ['tk:one'])
  a.tiktok[0].categories = [P.CATEGORIES[0]]
  assert.deepEqual(P.targetsFor(a, null), [])
  assert.deepEqual(P.targetsFor(a, P.CATEGORIES[0]), ['tk:one'])
  delete a.tiktok
  assert.deepEqual(P.allTargets(a), [])
})

test('accounts round trip and public views do not expose injected session credentials', () => {
  P.saveAccounts(accounts())
  assert.equal(P.loadAccounts().tiktok[0].username, 'romeo')
  const a = P.loadAccounts()
  Object.assign(a.tiktok[0], { cookie: 'secret-cookie', token: 'secret-token', password: 'secret-password' })
  const view = P.publicAccounts(a)
  assert.equal(view.tiktok[0].username, 'romeo')
  assert.ok(!JSON.stringify(view).includes('secret-'))
})

test('connect detects an account through Chrome and keeps its identity on reconnect', async () => {
  P.saveAccounts({ ...accounts(), tiktok: [] }); P.saveQueue([])
  const h = harness({ ok: true, username: 'romeo', name: 'Romeo' })
  assert.equal((await h.request('/api/posting/tiktok/connect', {})).code, 200)
  await h.request('/api/posting')
  assert.equal(h.calls[0].agent, 'tiktok')
  assert.equal(h.calls[0].kind, 'tiktok-account')
  const [a] = P.loadAccounts().tiktok
  assert.equal(a.username, 'romeo')
  assert.equal(a.privacy, 'private', 'new destinations start private until the user selects otherwise')
  await h.request('/api/posting/tiktok/connect', {})
  await h.request('/api/posting')
  assert.equal(P.loadAccounts().tiktok.length, 1)
  assert.equal(P.loadAccounts().tiktok[0].id, a.id)
})

test('TikTok update validates visibility and removal clears only this destination', async () => {
  P.saveAccounts(accounts()); P.saveQueue([due({ targets: ['tk:one', 'fb:keep'] })])
  const h = harness()
  assert.equal((await h.request('/api/posting/tiktok/update', { id: 'one', privacy: 'invalid' })).code, 400)
  assert.equal((await h.request('/api/posting/tiktok/update', { id: 'one', privacy: 'private', aigc: true })).code, 200)
  assert.equal(P.loadAccounts().tiktok[0].privacy, 'private')
  assert.equal((await h.request('/api/posting/tiktok/remove', { id: 'one' })).code, 200)
  assert.deepEqual(P.loadAccounts().tiktok, [])
  assert.deepEqual(P.loadQueue()[0].targets, ['fb:keep'])
})

test('scheduled TikTok posts run a non-retryable browser job and require a published result', async () => {
  P.saveAccounts(accounts()); P.saveQueue([due()])
  const h = harness(); await h.posting.tick()
  const [q] = P.loadQueue()
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].kind, 'tiktok-post')
  assert.equal(h.calls[0].payload.noRetry, true)
  assert.equal(h.calls[0].payload.username, 'romeo')
  assert.equal(h.calls[0].payload.privacy, 'public')
  assert.equal(q.status, 'posted')
  assert.equal(q.results['tk:one'].ok, true)
  assert.equal(q.results['tk:one'].url, 'https://www.tiktok.com/@romeo/video/1234567')
  await h.posting.tick(); assert.equal(h.calls.length, 1)
})

test('an upload-only response stays blocked, including the former user acknowledgement override', async () => {
  P.saveAccounts(accounts()); P.saveQueue([due()])
  const h = harness({ ok: true, uploaded: true, username: 'romeo' }); await h.posting.tick()
  const [q] = P.loadQueue()
  assert.equal(q.status, 'failed')
  assert.equal(q.results['tk:one'].needsVerification, true)
  assert.equal((await h.request('/api/posting/retry', { id: q.id })).code, 409)
  assert.equal(h.calls.length, 1)
  assert.equal((await h.request('/api/posting/retry', { id: q.id, confirmTikTokRetry: true })).code, 409)
  assert.equal(P.loadQueue()[0].results['tk:one'].needsVerification, true)
})

test('failure before submission can retry; account mismatch cannot be accepted as success', async () => {
  P.saveAccounts(accounts()); P.saveQueue([due()])
  const h = harness({ ok: false, error: 'กรุณาล็อกอิน TikTok', needsVerification: false }); await h.posting.tick()
  const [q] = P.loadQueue()
  assert.equal(q.results['tk:one'].needsVerification, false)
  assert.match(q.error, /ล็อกอิน/)
  assert.equal((await h.request('/api/posting/retry', { id: q.id })).code, 200)
  P.saveQueue([due()])
  await harness({ ok: true, published: true, username: 'other' }).posting.tick()
  assert.equal(P.loadQueue()[0].status, 'failed')
})

test('restart cancels an interrupted browser job and preserves the uncertain checkpoint', () => {
  P.saveAccounts(accounts())
  P.saveQueue([due({ status: 'posting', tiktokJobId: 'old-job', results: { 'tk:one': { ok: false, needsVerification: true } } })])
  const jobs = new Map([['old-job', { id: 'old-job', agent: 'tiktok', status: 'running', payload: { noRetry: true } }]])
  createPosting({ jobs, enqueue: () => {}, json: () => {}, readBody: async () => ({}), port: 1, token: 'x', log: () => {}, scheduler: false })
  assert.equal(jobs.get('old-job').cancelled, true)
  assert.equal(P.loadQueue()[0].status, 'failed')
  assert.equal(P.loadQueue()[0].results['tk:one'].needsVerification, true)
})

test('publish attempts never requeue on stale heartbeat; other browser jobs still retry', async () => {
  const { canRetryJob, canDispatchJob } = await import('../bridge/job-policy.js')
  assert.equal(canRetryJob({ agent: 'tiktok', kind: 'tiktok-post', payload: {} }), false)
  assert.equal(canRetryJob({ agent: 'flow', kind: 'generate-images', payload: {} }), true)
  assert.equal(canRetryJob({ agent: 'tiktok', kind: 'tiktok-account', payload: {} }), true)
  assert.equal(canRetryJob({ agent: 'x', payload: { noRetry: true } }), false)
  const posting = { id: 'post', agent: 'tiktok', kind: 'tiktok-post', status: 'running' }
  const connection = { id: 'connect', agent: 'tiktok', kind: 'tiktok-account', status: 'queued' }
  assert.equal(canDispatchJob(connection, [posting, connection]), false)
  posting.status = 'done'
  assert.equal(canDispatchJob(connection, [posting, connection]), true)
})

test('file injection endpoint only exposes the active posting item, not arbitrary job paths', async () => {
  P.saveAccounts(accounts()); P.saveQueue([])
  const h = harness()
  P.saveQueue([due({ status: 'posting', tiktokJobId: 'file-job' })])
  h.jobs.set('file-job', { id: 'file-job', agent: 'tiktok', kind: 'tiktok-post', status: 'running', payload: { file: 'C:/sensitive.txt',caption:'คำบรรยายของงานนี้เท่านั้น' } })
  const result = await h.request('/api/posting/tiktok/job?id=file-job')
  assert.equal(result.code, 200)
  assert.equal(result.data.file, join(project, '06_render', `${slug}.mp4`))
  assert.equal(result.data.caption,'คำบรรยายของงานนี้เท่านั้น')
  h.jobs.get('file-job').cancelled = true
  assert.equal((await h.request('/api/posting/tiktok/job?id=file-job')).code, 409)
})
