/**
 * เพลงพื้นหลัง (BGM) — config.render.bgmFile เป็นได้ทั้งไฟล์เดียว หรือโฟลเดอร์เพลง
 * โฟลเดอร์ → เลือกเพลงหนึ่งเพลงต่อคลิปจากชื่อคลิป (คลิปต่างกันได้เพลงต่างกัน · ตัดต่อคลิปเดิมซ้ำได้เพลงเดิม)
 */
import { existsSync, statSync, readdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { createHash } from 'node:crypto'

export const BGM_AUDIO_EXT = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']

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

/**
 * @returns {{ file: string|null, warning?: string }}
 */
export function resolveBgm(path, slug) {
  if (!path) return { file: null }
  if (!existsSync(path)) return { file: null, warning: `ไม่พบเพลงพื้นหลังที่ ${path} (ไดรฟ์ไม่ได้เสียบ หรือย้ายที่) — คลิปนี้ไม่มีเพลง` }
  if (!statSync(path).isDirectory()) return { file: path }
  const tracks = listBgmTracks(path)
  if (!tracks.length) return { file: null, warning: `โฟลเดอร์เพลง ${path} ไม่มีไฟล์เพลง (${BGM_AUDIO_EXT.join(' ')}) — คลิปนี้ไม่มีเพลง` }
  const n = createHash('sha1').update(String(slug)).digest().readUInt32BE(0)
  return { file: tracks[n % tracks.length] }
}
