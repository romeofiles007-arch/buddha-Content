/**
 * พระของฉัน — โหมด "พระสอนธรรม (ตัวเราเอง)": ผู้ใช้เป็นพระ ทำคลิปตัวเองสอนธรรม
 *
 * เก็บที่ characters/self/ (ไม่ขึ้น git — เป็นรูปหน้าของผู้ใช้)
 *   monk.json        { name, description, images: [ชื่อไฟล์] }
 *   <รูป>.png|jpg    รูปหน้าพระที่วางในแผงข้าง (สูงสุด 4 รูป)
 *
 * แยกจาก "ตัวละครของฉัน" (characters/current/) — คลิปหมวดอื่นไม่ใช้รูปชุดนี้
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { join, extname } from 'node:path'
import { ROOT } from './config.mjs'

export const SELF_DIR = join(ROOT, 'characters', 'self')
export const MAX_SELF_IMAGES = 4
const FILE = 'monk.json'
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

export const selfMime = (name) => MIME[extname(name).toLowerCase()] ?? 'image/png'

export function readSelfMonk(dir = SELF_DIR) {
  let data = {}
  try {
    if (existsSync(join(dir, FILE))) data = JSON.parse(readFileSync(join(dir, FILE), 'utf8'))
  } catch {}
  const images = (Array.isArray(data.images) ? data.images : []).filter((n) => typeof n === 'string' && existsSync(join(dir, n)))
  return { name: String(data.name ?? ''), description: String(data.description ?? ''), images }
}

/** มีรูปหน้าพระแล้ว — โหมดนี้ต้องมีก่อนเริ่มทำคลิป */
export const selfMonkReady = (dir = SELF_DIR) => readSelfMonk(dir).images.length > 0

export const SELF_NOT_READY = 'โหมดพระสอนธรรมต้องมีรูปหน้าพระก่อน — วางรูปในกล่อง "พระของฉัน" ใต้หมวดเนื้อหาในแผงข้าง (1–4 รูป)'

function write(data, dir) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, FILE), JSON.stringify(data, null, 2))
  return readSelfMonk(dir)
}

export function updateSelfMonk({ name, description } = {}, dir = SELF_DIR) {
  const cur = readSelfMonk(dir)
  return write({
    ...cur,
    ...(typeof name === 'string' && { name: name.trim().slice(0, 80) }),
    ...(typeof description === 'string' && { description: description.trim().slice(0, 1000) }),
  }, dir)
}

export function addSelfMonkImage({ type, base64 } = {}, dir = SELF_DIR) {
  const cur = readSelfMonk(dir)
  if (cur.images.length >= MAX_SELF_IMAGES) throw new Error(`ใส่รูปหน้าพระได้สูงสุด ${MAX_SELF_IMAGES} รูป — ลบรูปเก่าก่อน`)
  const ext = Object.entries(MIME).find(([, m]) => m === type)?.[0]
  if (!ext) throw new Error('รองรับเฉพาะรูป PNG / JPG / WEBP')
  const buf = Buffer.from(String(base64 ?? ''), 'base64')
  if (!buf.length) throw new Error('ไม่มีข้อมูลรูป')
  if (buf.length > 6 * 1024 * 1024) throw new Error('รูปใหญ่เกิน 6MB')
  mkdirSync(dir, { recursive: true })
  const name = `monk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${ext}`
  writeFileSync(join(dir, name), buf)
  return write({ ...cur, images: [...cur.images, name] }, dir)
}

export function removeSelfMonkImage(name, dir = SELF_DIR) {
  const cur = readSelfMonk(dir)
  // ชื่อต้องอยู่ในรายการ — กันลบไฟล์อื่นด้วยชื่อแปลกๆ (../)
  if (!cur.images.includes(name)) throw new Error('ไม่พบรูปนี้')
  unlinkSync(join(dir, name))
  return write({ ...cur, images: cur.images.filter((n) => n !== name) }, dir)
}
