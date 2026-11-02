import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { facebookUpload, youtubeUpload } from '../pipeline/lib/social.mjs'
const dir = mkdtempSync(join(tmpdir(), 'social-delivery-')), file = join(dir, 'video.mp4')
writeFileSync(file, 'fixture'); after(() => rmSync(dir, { recursive: true, force: true }))
test('YouTube can retry a token failure before media is sent', async () => {
  await assert.rejects(youtubeUpload({ file }, { fetchImpl: async () => { throw new Error('token connection failed') } }), e => e.needsVerification === false)
})
test('YouTube must not repeat a media upload whose response was lost', async () => {
  let requests = 0
  await assert.rejects(youtubeUpload({ file }, { fetchImpl: async () => {
    requests++
    if (requests === 1) return { ok: true, json: async () => ({ access_token: 'fake' }) }
    if (requests === 2) return { ok: true, headers: new Headers({ location: 'https://upload.example/session' }) }
    throw new Error('lost after media sent')
  } }), e => e.needsVerification === true)
  assert.equal(requests, 3)
})
test('Facebook distinguishes missing local input from a lost publish response', async () => {
  await assert.rejects(facebookUpload({ file: join(dir, 'missing.mp4') }), e => e.needsVerification === false)
  await assert.rejects(facebookUpload({ file }, { fetchImpl: async () => { throw new Error('publish connection lost') } }), e => e.needsVerification === true)
})
