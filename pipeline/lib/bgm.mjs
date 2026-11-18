/**
 * เพลงพื้นหลัง (BGM)
 *
 *   render.bgmFile  ที่อยู่เพลง: โฟลเดอร์ (รวมโฟลเดอร์ย่อย) หรือไฟล์เดียว · เว้นว่าง = โฟลเดอร์ music ในโปรแกรม
 *   render.bgmMode  'off' = ไม่ใส่เพลง · 'random' = สุ่มเพลงต่อคลิป · ชื่อเพลง (เช่น 'bells_choir_0.mp3') = ใช้เพลงนี้ทุกคลิป
 *
 * สุ่มจากชื่อคลิป → คลิปต่างกันได้เพลงต่างกัน แต่ตัดต่อคลิปเดิมซ้ำได้เพลงเดิม
 */
import { existsSync, statSync, readdirSync } from 'node:fs'
import { join, extname, relative, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { fromRoot } from './config.mjs'

export const BGM_AUDIO_EXT = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']
export const BGM_DEFAULT_DIR = 'music'

/** เพลงทุกไฟล์ในโฟลเดอร์ (รวมโฟลเดอร์ย่อย) เรียงตามชื่อ */
export function listBgmTracks(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...listBgmTracks(p))
    else if (BGM_AUDIO_EXT.includes(extname(e.name).toLowerCase())) out.push(p)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

const pickBySlug = (tracks, slug) => tracks[createHash('sha1').update(String(slug)).digest().readUInt32BE(0) % tracks.length]

/** ไฟล์เดียว หรือโฟลเดอร์ → เลือกเพลงจากชื่อคลิป (ใช้กับเพลงที่แนบให้คลิปเดียว --bgm) */
export function resolveBgm(path, slug) {
  if (!path) return { file: null }
  if (!existsSync(path)) return { file: null, warning: `ไม่พบเพลงพื้นหลังที่ ${path} (ไดรฟ์ไม่ได้เสียบ หรือย้ายที่) — คลิปนี้ไม่มีเพลง` }
  if (!statSync(path).isDirectory()) return { file: path }
  const tracks = listBgmTracks(path)
  if (!tracks.length) return { file: null, warning: `โฟลเดอร์เพลง ${path} ไม่มีไฟล์เพลง (${BGM_AUDIO_EXT.join(' ')}) — คลิปนี้ไม่มีเพลง` }
  return { file: pickBySlug(tracks, slug) }
}

/**
 * ความดังเพลงเทียบกับเสียงพากย์ (render.bgmLevel) — ค่าเริ่มต้น = ดัง (ผู้ใช้เลือก 18 พ.ย. 2026)
 * กดเลือกในแผงข้างแล้วบันทึกลง config ทันที ใช้ค่านั้นไปจนกว่าจะกดอันอื่น
 */
export const BGM_DEFAULT_LEVEL = 'loud'
export const BGM_LEVELS = {
  soft: { label: 'เบา', db: -27 },
  medium: { label: 'กลาง', db: -21 },
  loud: { label: 'ดัง', db: -16 },
  xloud: { label: 'ดังมาก', db: -12 },
}
export const bgmLevel = (config) => (BGM_LEVELS[config.render?.bgmLevel] ? config.render.bgmLevel : BGM_DEFAULT_LEVEL)
export const bgmDb = (config) => BGM_LEVELS[bgmLevel(config)].db

export const bgmSource = (config) => fromRoot(config.render?.bgmFile || BGM_DEFAULT_DIR)
export const bgmMode = (config) => config.render?.bgmMode || 'random'

/** ชื่อเพลงที่เลือกได้ (path ย่อยจากโฟลเดอร์เพลง ใช้ / คั่น) */
export function bgmTracks(config) {
  const src = bgmSource(config)
  if (!existsSync(src)) return []
  if (!statSync(src).isDirectory()) return [basename(src)]
  return listBgmTracks(src).map((f) => relative(src, f).split('\\').join('/'))
}

/** เพลงของคลิปนี้ตามตั้งค่า → { file, warning? } */
export function bgmFor(config, slug) {
  const mode = bgmMode(config)
  if (mode === 'off') return { file: null }
  const src = bgmSource(config)
  // ไม่ได้ตั้งที่อยู่เพลงเอง และไม่มีโฟลเดอร์ music → เครื่องนี้ไม่ใช้เพลง ไม่ต้องเตือน
  if (!config.render?.bgmFile && !existsSync(src)) return { file: null }
  if (mode === 'random' || !existsSync(src) || !statSync(src).isDirectory()) return resolveBgm(src, slug)
  const file = join(src, ...mode.split('/'))
  if (existsSync(file)) return { file }
  const random = resolveBgm(src, slug)
  return { ...random, warning: `ไม่พบเพลง ${mode} ในโฟลเดอร์เพลงแล้ว — ${random.file ? `สุ่มใช้ ${basename(random.file)} แทน` : random.warning}` }
}
