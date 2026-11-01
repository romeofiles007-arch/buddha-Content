/**
 * โหมดโพสต์อัตโนมัติ (แผนกนกนางนวล) — คิวคลิปที่ทำเสร็จ → ตรวจ (AI + คน) → ตั้งเวลา → โพสต์ Facebook Page / YouTube
 *
 * เก็บใน projects/_posting/ (อยู่ใต้ .gitignore และไม่ถูกใส่ในแพ็กเกจลูกค้า — มีโทเค็น)
 *   accounts.json  การตั้งค่า + บัญชีเพจ/ช่อง (โทเค็นอยู่ที่นี่ที่เดียว ห้ามส่งออกไปหน้าแผงข้างตรงๆ)
 *   queue.json     รายการคลิปในคิว
 *
 * ไฟล์นี้เป็นตรรกะล้วน (อ่าน/เขียนไฟล์ จัดคิว คำนวณเวลา prompt) — การเรียก Facebook/YouTube อยู่ใน social.mjs
 * ข้อยกเว้นกฎ "ห้ามใช้ API" ของโปรเจกต์: ผู้ใช้อนุญาตให้ขั้นโพสต์ใช้ Facebook Graph API + YouTube Data API (28 ต.ค. 2026)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ROOT } from './config.mjs'
import { GENRES, MIX_GENRES, CATEGORIES as CLIP_CATEGORIES } from '../../extension/prompts.js'

/** หมวดหมู่หัวข้อ — ชุดเดียวกับตอนหาหัวข้อ (extension/prompts.js) ใช้จับคู่คลิปกับเพจ/ช่อง */
export const CATEGORIES = GENRES
/** หมวดที่ AI ตรวจคลิปเลือกได้ — ไม่รวมโหมดเฉพาะ (พระสอนธรรม) ซึ่งได้หมวดจากคลิปเท่านั้น */
export const AI_CATEGORIES = MIX_GENRES

// เทสต์ตั้ง POSTING_DIR ไปโฟลเดอร์ชั่วคราว — ไม่แตะคิว/โทเค็นจริงของผู้ใช้
export const POSTING_DIR = process.env.POSTING_DIR || join(ROOT, 'projects', '_posting')
const ACCOUNTS_FILE = () => join(POSTING_DIR, 'accounts.json')
const QUEUE_FILE = () => join(POSTING_DIR, 'queue.json')

/** สถานะของคลิปในคิว — ลำดับตามเส้นทางปกติ */
export const STATUS = {
  review: 'รอตรวจ',
  scheduled: 'ตั้งเวลาแล้ว',
  posting: 'กำลังโพสต์',
  posted: 'โพสต์แล้ว',
  failed: 'โพสต์ไม่สำเร็จ',
  rejected: 'ตีกลับ',
}

export const DEFAULT_SETTINGS = {
  enabledAt: null, // เปิดโหมดเมื่อไร — คลิปที่เสร็จหลังเวลานี้เข้าคิวเอง (คลิปเก่าเพิ่มเองจากคลัง)
  autoCheck: true, // คลิปเข้าคิวแล้วให้ AI ตรวจทันที
  autoApprove: false, // AI ให้ผ่าน → อนุมัติ + ลงช่องเวลาถัดไปเอง (ค่าเริ่มต้นปิด — ให้คนดูก่อน)
  // ออโต้ทั้งหมดแบบ "ไม่ตรวจ — โพสต์เลย": ใช้คู่กับ autoApprove · คลิปที่ AI เคยบอกให้แก้ยังรอคนดู
  // คลิปจากผลิตต่อเนื่องทำตามโหมดที่เลือกในหน้านั้น (item.auto) ไม่ใช่ค่านี้
  skipCheck: false,
  slots: ['12:00', '19:00'], // ช่องเวลาประจำวัน
  autoPull: false, // ดึงคลิปจากคลังเข้าคิวเอง ให้มีคลิปรอโพสต์ครบทุกช่องเวลาของวัน (clipsToPull)
  google: { clientId: '', clientSecret: '' }, // OAuth client ของ Google Cloud (ประเภท Desktop app) — ใช้ร่วมทุกช่อง
  // OAuth client ของ Drive แยกจาก YouTube — Drive อาจอยู่คนละบัญชี/คนละโปรเจกต์ Google Cloud
  driveClient: { clientId: '', clientSecret: '' },
  // Google Drive ที่พักคลิประหว่างรอโพสต์: { refreshToken, email, name, folderId } · null = ไม่ใช้
  // คลิปขึ้น Drive ตอนเข้าคิว และย้ายไปถังขยะเมื่อโพสต์ครบ / ตีกลับ / เอาออกจากคิว
  drive: null,
}

function readJson(file, fallback) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback
  } catch {
    return fallback
  }
}

function writeJson(file, data) {
  mkdirSync(POSTING_DIR, { recursive: true })
  writeFileSync(file + '.tmp', JSON.stringify(data, null, 2))
  renameSync(file + '.tmp', file)
}

// ── บัญชี + การตั้งค่า ─────────────────────────────────────────────

export function loadAccounts() {
  const raw = readJson(ACCOUNTS_FILE(), {})
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      ...raw.settings,
      google: { ...DEFAULT_SETTINGS.google, ...raw.settings?.google },
      driveClient: { ...DEFAULT_SETTINGS.driveClient, ...raw.settings?.driveClient },
    },
    facebook: Array.isArray(raw.facebook) ? raw.facebook : [],
    youtube: Array.isArray(raw.youtube) ? raw.youtube : [],
  }
}

export function saveAccounts(data) {
  writeJson(ACCOUNTS_FILE(), data)
  return data
}

export function updateAccounts(mutate) {
  const data = loadAccounts()
  mutate(data)
  return saveAccounts(data)
}

/** เหลือ 4 ตัวท้าย — ให้ผู้ใช้จำได้ว่าใส่ตัวไหนไว้ โดยไม่ส่งโทเค็นเต็มออกไปหน้าเว็บ */
export const mask = (secret) => (secret ? `••••${String(secret).slice(-4)}` : '')

/** มุมมองที่ส่งให้แผงข้าง — ไม่มีโทเค็น/secret ตัวเต็ม */
export function publicAccounts(data = loadAccounts()) {
  return {
    settings: {
      ...data.settings,
      google: { clientId: data.settings.google.clientId, clientSecret: mask(data.settings.google.clientSecret), ready: !!(data.settings.google.clientId && data.settings.google.clientSecret) },
      driveClient: { clientId: data.settings.driveClient.clientId, clientSecret: mask(data.settings.driveClient.clientSecret), ready: !!(data.settings.driveClient.clientId && data.settings.driveClient.clientSecret) },
      drive: data.settings.drive?.refreshToken
        ? { connected: true, email: data.settings.drive.email, name: data.settings.drive.name, folderLink: data.settings.drive.folderId ? `https://drive.google.com/drive/folders/${data.settings.drive.folderId}` : null }
        : { connected: false },
    },
    facebook: data.facebook.map(({ token, ...a }) => ({ ...a, token: mask(token) })),
    youtube: data.youtube.map(({ refreshToken, ...a }) => ({ ...a, connected: !!refreshToken })),
  }
}

/** ปลายทางทั้งหมดในรูป "fb:<id>" / "yt:<id>" */
export function allTargets(data = loadAccounts()) {
  return [...data.facebook.map((a) => `fb:${a.id}`), ...data.youtube.filter((a) => a.refreshToken).map((a) => `yt:${a.id}`)]
}

/**
 * หมวดของคลิป (ชื่อหมวดแบบเดียวกับที่ตั้งให้เพจ) จากโปรไฟล์ที่ทำตอนผลิต projects/<slug>/00_ref/profile.json
 * ไม่มีโปรไฟล์ / หมวดไม่รู้จัก → null (ให้ AI ระบุทีหลัง)
 */
export function clipCategory(slug, root = ROOT) {
  try {
    const profile = JSON.parse(readFileSync(join(root, 'projects', slug, '00_ref', 'profile.json'), 'utf8'))
    return CLIP_CATEGORIES.find((c) => c.id === profile.category)?.name ?? null
  } catch {
    return null
  }
}

/**
 * ลำดับเพจของโหมด "แบ่งเพจ" — quota { "fb:<id>": จำนวนคลิป } เช่น เพจ 1 = 3 · เพจ 2 = 2
 * → [เพจ1, เพจ2, เพจ1, เพจ2, เพจ1] (สลับกันไป ไม่ลงเพจเดียวติดกันหมด) · คลิปที่ n ใช้ลำดับที่ n (วนซ้ำเมื่อเกิน)
 * keys = ปลายทางที่ยังเชื่อมอยู่ (เรียงตามที่แสดง) — เพจที่ถูกลบไปแล้วไม่นับ
 */
export function pageSequence(quota, keys) {
  // smooth weighted round-robin: กระจายเพจให้ห่างกันเท่าๆ กัน (3/2 → ก ข ก ข ก ไม่ใช่ ก ก ข ก ข)
  const pages = keys.map((k) => ({ k, w: Math.max(0, Math.floor(Number(quota?.[k]) || 0)), cur: 0 })).filter((p) => p.w > 0)
  const total = pages.reduce((a, p) => a + p.w, 0)
  const seq = []
  for (let i = 0; i < total; i++) {
    let best = null
    for (const p of pages) {
      p.cur += p.w
      if (!best || p.cur > best.cur) best = p
    }
    best.cur -= total
    seq.push(best.k)
  }
  return seq
}

/** บัญชีนี้รับคลิปหมวดนี้ไหม — ไม่ได้เลือกหมวด = รับทุกหมวด · คลิปที่ยังไม่รู้หมวดไปเฉพาะบัญชีที่รับทุกหมวด */
export function acceptsCategory(account, category) {
  const cats = account?.categories ?? []
  return !cats.length || (!!category && cats.includes(category))
}

/** ปลายทางตามหมวดของคลิป */
export function targetsFor(data, category) {
  return [
    ...data.facebook.filter((a) => acceptsCategory(a, category)).map((a) => `fb:${a.id}`),
    ...data.youtube.filter((a) => a.refreshToken && acceptsCategory(a, category)).map((a) => `yt:${a.id}`),
  ]
}

/** หมวดที่ถูกต้องเท่านั้น ไม่ซ้ำ */
export const cleanCategories = (list) => [...new Set((Array.isArray(list) ? list : []).filter((c) => CATEGORIES.includes(c)))]

export function findTarget(data, key) {
  const [kind, id] = String(key).split(':')
  if (kind === 'fb') return { kind: 'facebook', account: data.facebook.find((a) => a.id === id) }
  if (kind === 'yt') return { kind: 'youtube', account: data.youtube.find((a) => a.id === id) }
  return { kind: null, account: null }
}

export const newId = () => randomUUID().slice(0, 8)

/** ช่องเวลา "HH:MM" ที่ถูกต้อง เรียง ไม่ซ้ำ */
export function cleanSlots(slots) {
  const list = (Array.isArray(slots) ? slots : String(slots ?? '').split(/[\s,]+/))
    .map((s) => /^(\d{1,2}):(\d{2})$/.exec(String(s).trim()))
    .filter((m) => m && Number(m[1]) < 24 && Number(m[2]) < 60)
    .map((m) => `${m[1].padStart(2, '0')}:${m[2]}`)
  return [...new Set(list)].sort()
}

// ── คิว ────────────────────────────────────────────────────────────

export function loadQueue() {
  const raw = readJson(QUEUE_FILE(), [])
  return Array.isArray(raw) ? raw : []
}

export function saveQueue(queue) {
  writeJson(QUEUE_FILE(), queue)
  return queue
}

/** ข้อความโพสต์เริ่มต้นจาก post.json ที่ ChatGPT เขียนไว้ตอนทำคลิป (ชื่อ 3 แบบ + คำบรรยาย + แฮชแท็ก) */
export function postFromFile(postJson) {
  if (!postJson) return { title: '', titles: [], description: '', hashtags: [] }
  const titles = (postJson.titles ?? []).map((t) => String(t).trim()).filter(Boolean)
  return { title: titles[0] ?? '', titles, description: String(postJson.description ?? '').trim(), hashtags: cleanHashtags(postJson.hashtags) }
}

export function cleanHashtags(tags) {
  const list = (Array.isArray(tags) ? tags : String(tags ?? '').split(/[\s,]+/))
    .map((t) => String(t).trim().replace(/\s+/g, ''))
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`))
    .filter((t) => t.length > 1)
  return [...new Set(list)]
}

/**
 * คลิปใหม่เข้าคิว — สถานะแรกคือรอตรวจ
 * category = หมวดหมู่หัวข้อ (AI ระบุตอนตรวจ หรือผู้ใช้เลือกเอง) · targetsEdited = ผู้ใช้ติ๊กปลายทางเอง (ระบบไม่เลือกให้ตามหมวดอีก)
 */
export function newItem({ slug, file, title, post, targets = [] }) {
  return {
    id: newId(),
    slug,
    file,
    title,
    status: 'review',
    addedAt: Date.now(),
    ai: null,
    category: null,
    categoryBy: null, // 'ai' | 'manual'
    post: postFromFile(post),
    targets,
    targetsEdited: false,
    scheduleAt: null,
    results: {},
    history: [],
  }
}

/**
 * คลิปที่ควรเข้าคิวเอง: ไฟล์หลัก <slug>.mp4 ที่เสร็จหลังเปิดโหมด และยังไม่เคยอยู่ในคิว (รวมที่ตีกลับ/โพสต์แล้ว)
 * videos = ผลของ listVideos() · คืนรายการ {slug, file, title}
 */
export function videosToEnroll(videos, queue, enabledAt) {
  if (!enabledAt) return []
  const known = new Set(queue.map((q) => `${q.slug}/${q.file}`))
  const out = []
  for (const v of videos) {
    const main = v.files?.find((f) => f.name === `${v.slug}.mp4`) ?? v.files?.[0]
    if (!main || main.createdAt < enabledAt || known.has(`${v.slug}/${main.name}`)) continue
    out.push({ slug: v.slug, file: main.name, title: v.title ?? v.slug })
  }
  return out
}

/** สถานะที่ถือว่า "ยังรอโพสต์" — นับว่าคิวมีคลิปพอสำหรับช่องเวลาหรือยัง */
const WAITING = new Set(['review', 'scheduled', 'posting'])

/**
 * ดึงคลิปจากคลังเอง: คลิปที่รอโพสต์น้อยกว่าจำนวนช่องเวลาต่อวัน → หยิบคลิปที่เก่าที่สุดมาเติมให้ครบ
 * ไม่หยิบคลิปที่เคยอยู่ในคิวแล้ว (โพสต์แล้ว/ตีกลับ/เอาออก/โพสต์พลาด) — ผู้ใช้ตัดสินไปแล้ว
 */
export function clipsToPull(videos, queue, slots) {
  const need = cleanSlots(slots).length - queue.filter((q) => WAITING.has(q.status)).length
  if (need <= 0) return []
  const known = new Set(queue.map((q) => `${q.slug}/${q.file}`))
  return videos
    .map((v) => {
      const main = v.files?.find((f) => f.name === `${v.slug}.mp4`) ?? v.files?.find((f) => f.main) ?? v.files?.[0]
      return main && { slug: v.slug, file: main.name, title: v.title ?? v.slug, at: main.createdAt ?? v.updatedAt ?? 0 }
    })
    .filter((v) => v && !known.has(`${v.slug}/${v.file}`))
    .sort((a, b) => a.at - b.at)
    .slice(0, need)
    .map(({ at, ...v }) => v)
}

// ── บอกผู้ใช้ว่าโพสต์ไปไหนบ้าง (แจ้งเตือนบนเครื่อง + บรรทัด "โพสต์ล่าสุด" ในแผงข้าง) ──

/** "เพจธรรมะ ✓ · ช่องธรรมะ ✗ (โควตาหมด)" */
export function resultSummary(item) {
  return (item.targets ?? []).map((k) => {
    const r = item.results?.[k]
    return r?.ok ? `${r.name ?? k} ✓` : `${r?.name ?? k} ✗ (${r?.error ?? 'ยังไม่ได้โพสต์'})`
  }).join(' · ')
}

const postEvent = (item) => ({
  id: item.id,
  kind: item.status,
  title: item.title,
  at: item.finishedAt,
  text: resultSummary(item),
  links: Object.values(item.results ?? {}).filter((r) => r.ok && r.url).map((r) => ({ name: r.name, url: r.url })),
})

/**
 * เหตุการณ์ที่เกิดหลังเวลา since — โพสต์เสร็จ (posted) / โพสต์พลาดบางที่ (failed) / AI ไม่ให้ผ่าน รอคนดู (held)
 * finishedAt = เวลาที่พยายามโพสต์รอบล่าสุดจบ (ทั้งสำเร็จและพลาด)
 */
export function postingEvents(queue, since = 0) {
  const out = []
  for (const q of queue) {
    if ((q.status === 'posted' || q.status === 'failed') && q.finishedAt > since) out.push(postEvent(q))
    if (q.status === 'review' && q.ai?.status === 'done' && q.ai.verdict !== 'pass' && q.ai.checkedAt > since) {
      out.push({ id: q.id, kind: 'held', title: q.title, at: q.ai.checkedAt, text: `AI ให้แก้ก่อนโพสต์: ${q.ai.summary || 'ดูรายละเอียดในแท็บรอตรวจ'}`, links: [] })
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

/** คลิปที่จบการโพสต์ล่าสุด (สำเร็จหรือพลาด) */
export function lastPosted(queue) {
  const done = queue.filter((q) => (q.status === 'posted' || q.status === 'failed') && q.finishedAt)
  if (!done.length) return null
  return postEvent(done.reduce((a, b) => (b.finishedAt > a.finishedAt ? b : a)))
}

/** ข้อความเต็มที่จะโพสต์ — คำบรรยาย + แฮชแท็ก */
export function caption(post) {
  const tags = cleanHashtags(post?.hashtags).join(' ')
  return [String(post?.description ?? '').trim(), tags].filter(Boolean).join('\n\n')
}

// ── ช่องเวลา ──────────────────────────────────────────────────────

/**
 * ช่องเวลาว่างถัดไป (เวลาเครื่อง) — ต้องห่างจากตอนนี้อย่างน้อย leadMs และยังไม่มีคลิปอื่นจองช่องเดียวกัน
 * taken = เวลา (ms) ที่คลิปอื่นตั้งไว้แล้ว
 */
export function nextFreeSlot(slots, taken = [], now = Date.now(), { leadMs = 5 * 60_000, days = 60 } = {}) {
  const list = cleanSlots(slots)
  if (!list.length) return null
  const busy = new Set(taken.filter(Boolean).map((t) => Math.round(t / 60_000)))
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  for (let d = 0; d < days; d++) {
    for (const slot of list) {
      const [h, m] = slot.split(':').map(Number)
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate() + d, h, m).getTime()
      if (at - now >= leadMs && !busy.has(Math.round(at / 60_000))) return at
    }
  }
  return null
}

// ── Google Drive ──────────────────────────────────────────────────

const DRIVE_KEEP = new Set(['review', 'scheduled', 'posting', 'failed']) // ยังรอโพสต์ → ควรอยู่บน Drive
const DRIVE_RETRY_MS = 30 * 60_000

/** คลิปถัดไปที่ต้องอัปขึ้น Drive (พลาดแล้วเว้น 30 นาทีก่อนลองใหม่) */
export function nextDriveUpload(queue, now = Date.now()) {
  return queue.find((q) => DRIVE_KEEP.has(q.status) && q.status !== 'posting' && !q.drive?.fileId && !(q.drive?.error && now - (q.drive.at ?? 0) < DRIVE_RETRY_MS))
}

/** คลิปที่จบแล้ว (โพสต์ครบ / ตีกลับ / เอาออก) แต่ยังค้างบน Drive → ต้องลบ */
export function driveToTrash(queue) {
  return queue.filter((q) => q.drive?.fileId && !DRIVE_KEEP.has(q.status))
}

/** คลิปที่ถึงเวลาโพสต์ — เรียงตามเวลา */
export function dueItems(queue, now = Date.now()) {
  return queue.filter((q) => q.status === 'scheduled' && q.scheduleAt && q.scheduleAt <= now).sort((a, b) => a.scheduleAt - b.scheduleAt)
}

// ── AI ตรวจคลิป (ChatGPT ผ่านหน้าเว็บ — ไม่ใช้ API) ────────────────

export const QC_FRAMES = 8

/** เวลาที่จะตัดภาพตัวอย่าง — กระจายทั้งคลิป ไม่เอาเฟรมแรก/สุดท้ายพอดี */
export function frameTimes(seconds, count = QC_FRAMES) {
  const total = Number(seconds) > 0 ? Number(seconds) : count
  return Array.from({ length: count }, (_, i) => Math.round(((i + 0.5) / count) * total * 10) / 10)
}

export function qcPrompt({ title, script, post, seconds, times, language = 'th' }) {
  const th = language !== 'en'
  const stamp = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`
  return `คุณคือคนตรวจคุณภาพ (QC) คลิปการ์ตูนสั้นก่อนโพสต์ลง Facebook Page และ YouTube งานนี้คือหาจุดที่ทำให้คลิปดูไม่มืออาชีพหรือเสี่ยงโดนลดการมองเห็น

ชื่อเรื่อง: "${title}"
ความยาวคลิป: ${Math.round(seconds || 0)} วินาที · ภาษาคลิป: ${language === 'zh' ? 'จีน' : th ? 'ไทย' : 'อังกฤษ'}

ภาพที่แนบ ${times.length} ภาพคือเฟรมจากคลิปตามลำดับเวลา: ${times.map((t, i) => `ภาพ ${i + 1} = ${stamp(t)}`).join(', ')}

บทพากย์:
${String(script ?? '').slice(0, 5000) || '(ไม่มีบท)'}

ข้อความที่จะโพสต์:
ชื่อ: ${post?.title || '(ยังไม่มี)'}
คำบรรยาย: ${post?.description || '(ยังไม่มี)'}
แฮชแท็ก: ${cleanHashtags(post?.hashtags).join(' ') || '(ยังไม่มี)'}

═══════════════════════════════════════
ตรวจตามนี้:
1. ภาพตรงกับเนื้อเรื่องในบทไหม ตัวละครหน้าตาเหมือนกันทุกภาพไหม
2. ตัวอักษรในภาพสะกดถูกไหม อ่านออกไหม มีตัวอักษรเพี้ยน/ภาษาต่างดาวไหม
3. ภาพผิดปกติ: มือ/นิ้วเกิน หน้าเบี้ยว วัตถุละลาย ภาพว่าง ภาพซ้ำ
4. เนื้อหาเสี่ยงผิดนโยบาย Facebook/YouTube: ความรุนแรง เลือด เรื่องเพศ ข้อมูลสุขภาพที่ผิด คำกล่าวอ้างเกินจริง ใช้ชื่อแบรนด์/คนดังเสียหาย
5. ข้อความโพสต์: ชื่อดึงดูดแต่ไม่หลอก (clickbait เกินเนื้อหา) คำบรรยายสะกดถูก แฮชแท็กตรงเรื่อง

ให้คะแนน 0–100 (80 ขึ้นไป = โพสต์ได้เลย) verdict เป็น "pass" เมื่อไม่มีปัญหาร้ายแรง หรือ "fix" เมื่อควรแก้ก่อนโพสต์
issues: ปัญหาที่เจอ ข้อละ 1 ประโยค ระบุภาพที่/เวลา ถ้าเกี่ยวกับภาพ (ไม่มีปัญหาให้เป็น [])
category: หมวดหมู่ของคลิปนี้ เลือก 1 หมวดจากรายการนี้เท่านั้น สะกดตรงตัว:
${AI_CATEGORIES.map((c) => `- ${c}`).join('\n')}
เขียน summary และ issues เป็นภาษาไทย ตอบเป็น JSON ก้อนเดียวเท่านั้น ไม่มีคำนำ รูปแบบนี้เป๊ะๆ:
{"score": 85, "verdict": "pass", "summary": "สรุป 1–2 ประโยค", "issues": ["..."], "category": "${AI_CATEGORIES[0]}"}`
}

/** อ่านผลตรวจจากคำตอบของ ChatGPT — ทนต่อ ```json``` และข้อความนำหน้า */
export function parseQc(text) {
  const raw = String(text ?? '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('อ่านผลตรวจจากคำตอบของ ChatGPT ไม่ออก')
  let data
  try {
    // ChatGPT บางครั้งขึ้นบรรทัดใหม่จริงในสตริง — JSON ไม่รับ แปลงเป็นช่องว่าง
    data = JSON.parse(raw.slice(start, end + 1).replace(/\r?\n/g, ' '))
  } catch {
    throw new Error('ผลตรวจจาก ChatGPT ไม่ใช่ JSON ที่ถูกต้อง')
  }
  const score = Math.max(0, Math.min(100, Math.round(Number(data.score))))
  if (!Number.isFinite(score)) throw new Error('ผลตรวจไม่มีคะแนน')
  const verdict = data.verdict === 'pass' || data.verdict === 'fix' ? data.verdict : score >= 80 ? 'pass' : 'fix'
  const issues = (Array.isArray(data.issues) ? data.issues : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 12)
  // หมวดต้องตรงรายการ — สะกดเพี้ยนเล็กน้อย (ช่องว่าง) ยังจับคู่ได้ · ไม่ตรงเลย = ไม่รู้หมวด
  const squash = (v) => String(v ?? '').replace(/\s+/g, '')
  const category = CATEGORIES.find((c) => squash(c) === squash(data.category)) ?? null
  return { score, verdict, summary: String(data.summary ?? '').trim(), issues, category }
}
