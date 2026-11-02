// Real HTTP bridge, isolated port/accounts/jobs. No Chrome or TikTok requests.
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const reserve = createServer(); await new Promise(r => reserve.listen(0, '127.0.0.1', r))
const port = reserve.address().port; await new Promise(r => reserve.close(r))
const temp = mkdtempSync(join(tmpdir(), 'tiktok-bridge-'))
const jobsFile = join(root, 'bridge', `jobs-${port}.json`)
assert.ok(!existsSync(jobsFile), 'test must not overwrite an existing jobs file')
const base = `http://127.0.0.1:${port}`, token = 'tiktok-local-test'
const pause = ms => new Promise(r => setTimeout(r, ms))
let child
const request = async (path, body) => {
  const res = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'x-bridge-token': token, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  assert.ok(res.ok, `${path}: ${res.status}`)
  return res.json()
}
async function start() {
  // The app deliberately lets .env override shell variables. Load it first, then
  // set isolated test parameters before importing the server (never bind 8785).
  const boot = `import {loadEnv} from './pipeline/lib/env.mjs'; loadEnv(); Object.assign(process.env,${JSON.stringify({ BRIDGE_PORT: String(port), BRIDGE_TOKEN: token, POSTING_DIR: temp })}); await import('./bridge/server.js');`
  child = spawn(process.execPath, ['--input-type=module', '-e', boot], { cwd: root, stdio: 'ignore', windowsHide: true })
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/health')).ok) return } catch {}
    if (child.exitCode != null) throw new Error('test bridge exited')
    await pause(50)
  }
  throw new Error('test bridge did not start')
}
async function stop() {
  if (!child || child.exitCode != null) return
  const exited = new Promise(r => child.once('exit', r)); child.kill(); await exited
}
try {
  await start()
  const first = await request('/enqueue', { agent: 'tiktok', kind: 'tiktok-post', payload: { noRetry: true } })
  assert.equal((await request('/job?agent=tiktok')).id, first.id)
  const next = await request('/enqueue', { agent: 'tiktok', kind: 'tiktok-account', payload: {} })
  // Simulate a new worker polling with no in-memory busy flags.
  let delivered = false
  const controller = new AbortController()
  const poll = fetch(base + '/job?agent=tiktok', { signal: controller.signal, headers: { 'x-bridge-token': token } }).then(() => { delivered = true }).catch(error => { if (error.name !== 'AbortError') throw error })
  await pause(120)
  assert.equal(delivered, false, 'connection job must not navigate over a running post')
  controller.abort(); await poll
  await request('/result', { id: first.id, meta: { ok: true, published: true, username: 'test' } })
  const running = await request('/job?agent=tiktok')
  assert.equal(running.id, next.id)
  console.log('PASS: TikTok dispatch is serialized across worker restarts')
  await request('/result', { id: running.id, meta: { ok: true, username: 'test' } })
  const interrupted = await request('/enqueue', { agent: 'tiktok', kind: 'tiktok-post', payload: { noRetry: true } })
  for (let i = 0; i < 100; i++) {
    if (existsSync(jobsFile) && JSON.parse(readFileSync(jobsFile, 'utf8')).some(j => j.id === interrupted.id)) break
    await pause(30)
  }
  await stop(); await start()
  const status = await request('/status?id=' + interrupted.id)
  assert.equal(status.status, 'error')
  assert.match(status.error, /ตรวจ/)
  console.log('PASS: restarting never replays a queued publish attempt')
} finally {
  await stop()
  assert.ok(resolve(temp).startsWith(resolve(tmpdir()) + sep))
  assert.ok(resolve(jobsFile).startsWith(resolve(root, 'bridge') + sep))
  rmSync(temp, { recursive: true, force: true })
  rmSync(jobsFile, { force: true }); rmSync(jobsFile + '.tmp', { force: true })
}
