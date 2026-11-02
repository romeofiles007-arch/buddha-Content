import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let M
try { M = await import('../pipeline/lib/delivery-ledger.mjs') } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error }
const setup = t => {
  assert.ok(M, 'permanent delivery ledger is missing')
  const dir = mkdtempSync(join(tmpdir(), 'delivery-ledger-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { dir, ledger: M.createDeliveryLedger(dir), identity: { source: 'project/video.mp4', sha256: 'a'.repeat(64) } }
}
test('a durable reservation blocks another process/instance until the outcome is known', t => {
  const { dir, ledger, identity } = setup(t)
  const first = ledger.reserve({ identity, destination: 'facebook:page', itemId: 'one' })
  assert.equal(first.status, 'reserved')
  assert.equal(M.createDeliveryLedger(dir).reserve({ identity, destination: 'facebook:page', itemId: 'two' }).status, 'blocked')
  ledger.complete(first.ticket, { postId: 'published', url: 'https://example.com/post' })
  const duplicate = M.createDeliveryLedger(dir).reserve({ identity, destination: 'facebook:page', itemId: 'three' })
  assert.equal(duplicate.status, 'done'); assert.equal(duplicate.result.postId, 'published')
})
test('a copied or rerendered clip is blocked at the same destination but other platforms remain independent', t => {
  const { ledger, identity } = setup(t)
  ledger.complete(ledger.reserve({ identity, destination: 'tiktok:romeo' }).ticket, { published: true })
  assert.equal(ledger.reserve({ identity: { ...identity, source: 'copy/renamed.mp4' }, destination: 'tiktok:romeo' }).status, 'done')
  assert.equal(ledger.reserve({ identity: { ...identity, sha256: 'b'.repeat(64) }, destination: 'tiktok:romeo' }).status, 'done')
  assert.equal(ledger.reserve({ identity, destination: 'youtube:channel' }).status, 'reserved')
})
test('a copied clip retains its alias when later rerendered under the copied name', t => {
  const { ledger, identity } = setup(t)
  ledger.complete(ledger.reserve({ identity, destination: 'facebook:one' }).ticket, { postId: 'one' })
  ledger.reserve({ identity: { ...identity, source: 'copy/video.mp4' }, destination: 'facebook:one' })
  const rerender = { source: 'copy/video.mp4', sha256: 'c'.repeat(64) }
  assert.equal(ledger.reserve({ identity: rerender, destination: 'facebook:one' }).status, 'done')
  assert.equal(ledger.reserve({ identity: { ...rerender, source: 'another/video.mp4' }, destination: 'facebook:one' }).status, 'done')
})
test('lost responses stay blocked; only a proven pre-submit failure can reserve again', t => {
  const { ledger, identity } = setup(t)
  const attempt = ledger.reserve({ identity, destination: 'facebook:one' })
  ledger.fail(attempt.ticket, { message: 'connection lost', needsVerification: true })
  assert.equal(ledger.reserve({ identity, destination: 'facebook:one' }).status, 'blocked')
  const safe = ledger.reserve({ identity, destination: 'youtube:one' })
  ledger.fail(safe.ticket, { message: 'token rejected before media upload', needsVerification: false })
  assert.equal(ledger.reserve({ identity, destination: 'youtube:one' }).status, 'reserved')
})
test('corrupt permanent history never becomes an empty history', t => {
  const { ledger, dir, identity } = setup(t)
  writeFileSync(join(dir, 'deliveries.json'), '{broken')
  assert.throws(() => ledger.reserve({ identity, destination: 'facebook:one' }), /ประวัติ|history/i)
})
test('missing previously initialized history and concurrent writers fail closed', t => {
  const { ledger, dir, identity } = setup(t)
  ledger.reserve({ identity, destination: 'facebook:one' })
  rmSync(join(dir, 'deliveries.json'))
  assert.throws(() => ledger.reserve({ identity, destination: 'facebook:one' }), /ประวัติ|history/i)
  writeFileSync(join(dir, 'deliveries.lock'), 'another writer')
  assert.throws(() => ledger.reserve({ identity, destination: 'youtube:one' }), /ล็อก|lock/i)
})
test('destination identity survives reconnecting the same external account', t => {
  setup(t)
  assert.equal(M.deliveryDestination('facebook', { id: 'new', pageId: '123' }), 'facebook:123')
  assert.equal(M.deliveryDestination('youtube', { id: 'new', channelId: 'UC123' }), 'youtube:UC123')
  assert.equal(M.deliveryDestination('tiktok', { id: 'new', username: 'Romeo' }), 'tiktok:romeo')
  assert.throws(() => M.deliveryDestination('youtube', { id: 'internal-only' }), /ช่อง|account/i)
})
test('a different TikTok handle cannot bypass history when a stable user ID is unavailable', t => {
  const { ledger, identity } = setup(t)
  ledger.complete(ledger.reserve({ identity, destination: 'tiktok:oldname' }).ticket, { published: true })
  assert.equal(ledger.reserve({ identity, destination: 'tiktok:newname' }).status, 'blocked')
  ledger.reserve({ identity: { ...identity, source: 'copy/video.mp4' }, destination: 'tiktok:newname' })
  assert.equal(ledger.reserve({ identity: { source: 'copy/video.mp4', sha256: 'd'.repeat(64) }, destination: 'tiktok:newname' }).status, 'blocked')
})
test('history import preserves aliases of duplicate historical successes', t => {
  const { ledger, identity } = setup(t)
  ledger.importRecords([
    { id: 'old-a', identity, destination: 'facebook:one', status: 'done', result: { postId: 'old-a' } },
    { id: 'old-b', identity: { ...identity, source: 'copy/video.mp4' }, destination: 'facebook:one', status: 'done', result: { postId: 'old-b' } },
  ])
  assert.equal(ledger.reserve({ identity: { source: 'copy/video.mp4', sha256: 'e'.repeat(64) }, destination: 'facebook:one' }).status, 'done')
})
