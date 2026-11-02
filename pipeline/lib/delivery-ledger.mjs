// Permanent at-most-once submission history. Queue removal must never erase it.
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, fsyncSync, renameSync, unlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { copyFile, unlink } from 'node:fs/promises'
import { findTarget } from './posting.mjs'

const blocked = message => Object.assign(new Error(message), { needsVerification: true })
const sources = identity => [identity.source, ...(identity.sources ?? [])].filter(Boolean)
const hashes = identity => [identity.sha256, ...(identity.hashes ?? [])].filter(Boolean)
const sameClip = (a, b) => sources(a).some(s => sources(b).includes(s)) || hashes(a).some(h => hashes(b).includes(h))
const mergeIdentity = (a, b) => ({ ...a, sources: [...new Set([...sources(a), ...sources(b)])], hashes: [...new Set([...hashes(a), ...hashes(b)])] })
const sameDestination = (a, b) => a === b || a === b.split(':')[0] + ':*'
const matches = (entry, identity, destination) => sameClip(entry.identity, identity) && sameDestination(entry.destination, destination)

export function deliveryDestination(kind, account, result = {}, { legacy = false } = {}) {
  if (legacy && result.destination?.startsWith(kind + ':')) return result.destination
  let external = kind === 'facebook' ? account?.pageId : kind === 'youtube' ? account?.channelId : account?.username?.replace(/^@/, '').toLowerCase()
  if (!external && result.destination?.startsWith(kind + ':')) return result.destination
  if (!external && result.url) {
    try {
      const u = new URL(result.url)
      if (kind === 'facebook' && /^(?:www\.)?facebook\.com$/.test(u.hostname)) external = /^\/(\d+)\/videos\//.exec(u.pathname)?.[1]
      if (kind === 'tiktok' && u.hostname === 'www.tiktok.com') external = /^\/@([^/]+)\/video\//.exec(u.pathname)?.[1]?.toLowerCase()
    } catch {}
  }
  if (external) return kind + ':' + String(external)
  if (legacy) return kind + ':*' // Unknown legacy account: block that platform conservatively.
  throw Object.assign(new Error('ไม่พบรหัสเพจ/ช่องปลายทาง — เชื่อมบัญชีใหม่ก่อนโพสต์'), { needsVerification: false })
}

export async function deliveryIdentity(file, { slug, file: fileName }, { allowMissing = false } = {}) {
  const source = `${slug}/${fileName}`.replace(/\\/g, '/').normalize('NFC').toLowerCase()
  if (allowMissing && !existsSync(file)) return { source }
  const before = statSync(file), hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  const after = statSync(file)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('ไฟล์คลิปเปลี่ยนระหว่างตรวจประวัติ — หยุดก่อนโพสต์')
  return { source, sha256: hash.digest('hex') }
}

export async function stageDelivery(file, item, dir) {
  const staging = join(dir, 'staging'); mkdirSync(staging, { recursive: true })
  const snapshot = join(staging, randomUUID() + '.mp4'), before = statSync(file)
  try {
    await copyFile(file, snapshot)
    const after = statSync(file)
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error('ไฟล์คลิปเปลี่ยนระหว่างเตรียมส่ง — หยุดก่อนโพสต์')
    const identity = await deliveryIdentity(snapshot, item)
    return { file: snapshot, identity, remove: () => unlink(snapshot) }
  } catch (error) { await unlink(snapshot).catch(() => {}); throw error }
}

export async function importDeliveryHistory(ledger, queue, accounts, pathOf) {
  const records = [], identities = new Map()
  for (const q of queue) {
    const history = Object.entries(q.results ?? {}).filter(([, r]) => r && (r.ok || r.needsVerification !== false))
    if (!history.length) continue
    const file = pathOf(q)
    if (!identities.has(file)) identities.set(file, await deliveryIdentity(file, q, { allowMissing: true }))
    for (const [key, result] of history) {
      const { kind, account } = findTarget(accounts, key)
      if (!kind) continue
      records.push({ id: `history:${q.id}:${key}`, identity: identities.get(file), destination: deliveryDestination(kind, account, result, { legacy: true }), status: result.ok ? 'done' : 'uncertain', result: result.ok ? result : undefined, error: result.error, at: result.at ?? q.postedAt ?? Date.now() })
    }
  }
  ledger.importRecords(records)
}

export function createDeliveryLedger(dir) {
  const file = join(dir, 'deliveries.json'), lock = join(dir, 'deliveries.lock'), initialized = join(dir, 'deliveries.initialized')
  function read() {
    if (!existsSync(file)) {
      if (existsSync(initialized)) throw blocked('ประวัติการโพสต์ถาวรหายไป — หยุดเพื่อป้องกันโพสต์ซ้ำ')
      return { version: 1, entries: [] }
    }
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'))
      if (data.version !== 1 || !Array.isArray(data.entries) || data.entries.some(e => !e.id || !e.identity?.source || !e.destination || !['pending', 'done', 'uncertain', 'retryable'].includes(e.status))) throw new Error()
      return data
    } catch { throw blocked('อ่านประวัติการโพสต์ถาวรไม่ได้ — หยุดเพื่อป้องกันโพสต์ซ้ำ') }
  }
  function transaction(fn) {
    mkdirSync(dir, { recursive: true })
    let fd
    try { fd = openSync(lock, 'wx') } catch { throw blocked('ประวัติการโพสต์ถูกล็อกอยู่ — หยุดเพื่อป้องกันโปรแกรมส่งงานซ้อน') }
    let temp
    try {
      const data = read(), result = fn(data)
      temp = file + '.' + randomUUID() + '.tmp'
      const out = openSync(temp, 'wx')
      try { writeFileSync(out, JSON.stringify(data)); fsyncSync(out) } finally { closeSync(out) }
      renameSync(temp, file)
      if (!existsSync(initialized)) {
        const marker = openSync(initialized, 'wx')
        try { writeFileSync(marker, '1'); fsyncSync(marker) } finally { closeSync(marker) }
      }
      return result
    } finally {
      if (temp && existsSync(temp)) unlinkSync(temp)
      closeSync(fd); unlinkSync(lock)
    }
  }
  return {
    snapshot: () => read(),
    reserve({ identity, destination, itemId }) {
      return transaction(data => {
        const previous = data.entries.filter(e => matches(e, identity, destination))
        for (const entry of previous) if (entry.status !== 'retryable') entry.identity = mergeIdentity(entry.identity, identity)
        const done = previous.find(e => e.status === 'done')
        if (done) return { status: 'done', result: done.result }
        if (previous.some(e => e.status === 'pending' || e.status === 'uncertain')) return { status: 'blocked' }
        // The browser adapter exposes a handle, not a permanent TikTok user ID.
        // A renamed account must not turn the same clip into a new submission.
        if (destination.startsWith('tiktok:')) {
          const otherHandles = data.entries.filter(e => e.destination.startsWith('tiktok:') && e.status !== 'retryable' && sameClip(e.identity, identity))
          if (otherHandles.length) {
            for (const entry of otherHandles) entry.identity = mergeIdentity(entry.identity, identity)
            return { status: 'blocked' }
          }
        }
        const ticket = randomUUID()
        data.entries.push({ id: ticket, identity, destination, itemId, status: 'pending', at: Date.now() })
        return { status: 'reserved', ticket }
      })
    },
    complete(ticket, result) {
      transaction(data => {
        const entry = data.entries.find(e => e.id === ticket)
        if (!entry || entry.status !== 'pending') throw blocked('สถานะประวัติการโพสต์ไม่ตรง — หยุดการส่งซ้ำ')
        Object.assign(entry, { status: 'done', result, at: Date.now() })
      })
    },
    fail(ticket, { message, needsVerification }) {
      transaction(data => {
        const entry = data.entries.find(e => e.id === ticket)
        if (!entry || entry.status !== 'pending') return
        Object.assign(entry, { status: needsVerification === false ? 'retryable' : 'uncertain', error: message, at: Date.now() })
      })
    },
    importRecords(records) {
      transaction(data => {
        for (const record of records) {
          const previous = data.entries.filter(e => matches(e, record.identity, record.destination))
          for (const entry of previous) if (entry.status !== 'retryable') entry.identity = mergeIdentity(entry.identity, record.identity)
          if (data.entries.some(e => e.id === record.id)) continue
          if (previous.some(e => e.status === 'done') || (record.status !== 'done' && previous.some(e => !e.legacy))) continue
          data.entries.push({ ...record, legacy: true })
        }
      })
    },
  }
}
