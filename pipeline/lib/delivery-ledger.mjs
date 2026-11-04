// Permanent at-most-once submission history. Queue removal must never erase it.
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, fsyncSync, renameSync, unlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { copyFile, unlink } from 'node:fs/promises'
import { findTarget } from './posting.mjs'
import { run, probeDuration } from './ffmpeg.mjs'

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

// ภาพปกที่ส่งไปพร้อมคลิป: แปลง cover.png เป็น JPG ไม่เกิน 2MB (เพดานของ YouTube) ไว้ใน staging
// ไม่มีปก = คืน null · เตรียมไม่ได้ = throw ให้ผู้เรียกโพสต์ต่อโดยไม่มีปก
export const COVER_MAX_BYTES = 2 * 1024 * 1024
async function coverJpeg(source, out) {
  await run('ffmpeg', ['-y', '-v', 'error', '-i', source, '-frames:v', '1', '-q:v', '2', out])
  if (statSync(out).size <= COVER_MAX_BYTES) return
  // ยังใหญ่เกิน → ย่อด้านยาวเหลือ 1280px แล้วบีบเพิ่ม
  await run('ffmpeg', ['-y', '-v', 'error', '-i', source, '-frames:v', '1', '-vf', "scale='if(gt(iw,ih),1280,-2)':'if(gt(iw,ih),-2,1280)'", '-q:v', '5', out])
}
export async function stageCover(source, dir, { convert = coverJpeg } = {}) {
  if (!source || !existsSync(source)) return null
  const staging = join(dir, 'staging'); mkdirSync(staging, { recursive: true })
  const file = join(staging, randomUUID() + '.jpg')
  try {
    await convert(source, file)
    if (!existsSync(file)) throw new Error('แปลงภาพปกไม่สำเร็จ')
    if (statSync(file).size > COVER_MAX_BYTES) throw new Error('ภาพปกใหญ่เกิน 2MB')
    return { file, remove: () => unlink(file) }
  } catch (error) { await unlink(file).catch(() => {}); throw error }
}

// ── Facebook Story: ตอนละไม่เกิน 60 วิ แนวตั้ง 9:16 → คลิปยาวกว่าตัดเป็นหลายตอน (Facebook เล่นต่อกันเอง) ──
export const STORY_MAX_SEC = 59 // เพดาน 60 วิ เผื่อ 1 วิ
const STORY_MIN_SEC = 3 // สั้นกว่านี้ Facebook ไม่รับ

/**
 * จุดตัดตอน [[เริ่ม, จบ], ...] — ตัดที่ช่วงเงียบ (จบประโยค) ที่ใกล้ 59 วิที่สุด ไม่มีก็ตัดที่ 59 วิ
 * ตอนท้ายจะเหลือสั้นกว่า 3 วิ → แบ่งช่วงที่เหลือเป็นสองตอนเท่าๆ กันแทน
 */
export function storyCuts(duration, silences = []) {
  if (duration <= STORY_MAX_SEC) return [[0, duration]]
  const cuts = []
  let start = 0
  while (duration - start > STORY_MAX_SEC) {
    const limit = start + STORY_MAX_SEC
    const pause = silences.map((s) => (s.start + s.end) / 2).filter((m) => m > start + 30 && m <= limit && duration - m >= STORY_MIN_SEC).pop()
    let end = pause ?? limit
    if (duration - end < STORY_MIN_SEC) end = start + (duration - start) / 2
    cuts.push([start, end])
    start = end
  }
  cuts.push([start, duration])
  return cuts
}

/** ช่วงเงียบในเสียง (วินาที) จาก ffmpeg silencedetect */
async function silences(file) {
  const out = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'silencedetect=noise=-35dB:d=0.3', '-f', 'null', '-'])
  const list = []
  let from = null
  for (const line of String(out).split(/\r?\n/)) {
    const a = /silence_start: ([\d.]+)/.exec(line)
    if (a) from = Number(a[1])
    const b = /silence_end: ([\d.]+)/.exec(line)
    if (b && from != null) { list.push({ start: from, end: Number(b[1]) }); from = null }
  }
  return list
}

/** เข้ารหัส 1 ตอนตามสเปก Story: 1080x1920 · 30fps คงที่ · H.264 GOP 2 วิ · AAC 48kHz สเตอริโอ */
async function storyPart(source, out, start, length) {
  await run('ffmpeg', ['-y', '-v', 'error', '-ss', start.toFixed(3), '-i', source, '-t', length.toFixed(3),
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', out])
}

/** ไฟล์ Story ทุกตอนไว้ใน staging · คืน { files, cuts, remove } */
export async function stageStoryParts(file, dir, { probe = probeDuration, detect = silences, encode = storyPart } = {}) {
  const duration = await probe(file)
  if (!(duration >= STORY_MIN_SEC)) throw new Error('คลิปสั้นเกินไปสำหรับ Story (ต้องยาวอย่างน้อย 3 วิ)')
  const cuts = storyCuts(duration, duration > STORY_MAX_SEC ? await detect(file).catch(() => []) : [])
  const staging = join(dir, 'staging'); mkdirSync(staging, { recursive: true })
  const files = []
  const remove = () => Promise.all(files.map((f) => unlink(f).catch(() => {})))
  try {
    for (const [start, end] of cuts) {
      const out = join(staging, randomUUID() + '.mp4')
      files.push(out)
      await encode(file, out, start, end - start)
      if (!existsSync(out)) throw new Error('ตัดคลิปสำหรับ Story ไม่สำเร็จ')
    }
    return { files, cuts, remove }
  } catch (error) { await remove(); throw error }
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
