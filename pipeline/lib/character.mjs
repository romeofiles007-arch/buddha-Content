/**
 * ตัวละครของฉัน — ไม่ได้ตั้งไว้ = ใช้ตัวละครตาม Blueprint / ตั้งไว้ = ใช้ตัวละครนี้ทุกคลิปจนกว่าจะลบ
 *
 * เก็บที่ characters/current/ (ไม่ขึ้น git)
 *   character.json   { enabled, description, images: [ชื่อไฟล์] }
 *   <รูป>.png|jpg    รูปตัวละครที่วางด้วย Ctrl+V ในแผงข้าง (สูงสุด 4 รูป)
 *
 * ใช้ 2 ที่:
 *   - ChatGPT รอบแรกของ Shot List: แนบรูป + คำอธิบาย ให้เขียน Character Bible จากตัวละครนี้แทนของ Blueprint
 *   - Google Flow prompt แรก: แนบรูปเป็น ingredient ให้ agent ล็อกหน้าตาตัวละครตามรูป
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { ROOT } from './config.mjs'
import { readProfile, profileImages, refDir } from './clip_profile.mjs'
import { ART_STYLES, selfMonkName } from '../../extension/prompts.js'
import { readSelfMonk, SELF_DIR } from './self_monk.mjs'

export const CHARACTER_DIR = join(ROOT, 'characters', 'current')
const FILE = join(CHARACTER_DIR, 'character.json')
export const MAX_IMAGES = 4
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

export function readCharacter() {
  const data = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}
  const images = (data.images ?? []).filter((name) => existsSync(join(CHARACTER_DIR, name)))
  return { enabled: data.enabled !== false, description: data.description ?? '', images }
}

function write(data) {
  mkdirSync(CHARACTER_DIR, { recursive: true })
  writeFileSync(FILE, JSON.stringify(data, null, 2))
  return readCharacter()
}

export function updateCharacter({ enabled, description }) {
  const cur = readCharacter()
  return write({
    ...cur,
    ...(typeof enabled === 'boolean' && { enabled }),
    ...(typeof description === 'string' && { description: description.trim().slice(0, 4000) }),
  })
}

export function addCharacterImage({ type, base64 }) {
  const cur = readCharacter()
  if (cur.images.length >= MAX_IMAGES) throw new Error(`ใส่รูปตัวละครได้สูงสุด ${MAX_IMAGES} รูป — ลบรูปเก่าก่อน`)
  const ext = Object.entries(MIME).find(([, m]) => m === type)?.[0]
  if (!ext) throw new Error('รองรับเฉพาะรูป PNG / JPG / WEBP')
  const buf = Buffer.from(String(base64), 'base64')
  if (buf.length > 6 * 1024 * 1024) throw new Error('รูปใหญ่เกิน 6MB')
  mkdirSync(CHARACTER_DIR, { recursive: true })
  const name = `character_${Date.now().toString(36)}${ext}`
  writeFileSync(join(CHARACTER_DIR, name), buf)
  return write({ ...cur, images: [...cur.images, name] })
}

export function removeCharacterImage(name) {
  const cur = readCharacter()
  if (!cur.images.includes(name)) throw new Error('ไม่พบรูปนี้')
  unlinkSync(join(CHARACTER_DIR, name))
  return write({ ...cur, images: cur.images.filter((n) => n !== name) })
}

export function clearCharacter() {
  if (existsSync(CHARACTER_DIR)) for (const f of readdirSync(CHARACTER_DIR)) unlinkSync(join(CHARACTER_DIR, f))
  return readCharacter()
}

/**
 * ตัวละครหลักของคลิป
 *   - หมวดพระเกจิที่มีภาพอ้างอิง → ภาพพระเกจิของคลิปนั้น (projects/<slug>/00_ref/)
 *   - หมวดพุทธประวัติที่มีภาพพระพุทธรูป → ภาพพระพุทธรูป (ระบบหาให้เอง)
 *   - หมวดพุทธประวัติ / พระเกจิที่ไม่มีภาพ → ไม่ใช้ตัวละครของฉัน (ตัวหลักคือพระพุทธเจ้า/พระเกจิ)
 *   - อื่นๆ → ตัวละครของฉัน ถ้าเปิดไว้และมีรูปหรือคำอธิบาย
 */
export function activeCharacter(slug) {
  const profile = slug ? readProfile(slug) : null
  // โหมดพระสอนธรรม: ตัวหลักคือพระผู้ใช้เอง (รูปจาก "พระของฉัน") — ไม่ใช้ตัวละครของฉัน
  if (profile?.category === 'self') {
    const m = readSelfMonk()
    const name = selfMonkName(profile)
    return { enabled: true, description: [`พระผู้สอนในคลิป: ${name} (ตัวละคร @monk)`, m.description].filter(Boolean).join(' · '), images: m.images, dir: SELF_DIR, selfMonk: name, selfNote: m.description }
  }
  const refs = profileImages(profile, slug)
  if (refs.length && profile.monk) {
    return { enabled: true, description: `พระเกจิของคลิปนี้: ${profile.monk.name} (ตัวละคร @monk)`, images: refs.map((f) => basename(f)), dir: refDir(slug), monk: profile.monk.name }
  }
  if (refs.length && profile.buddha) {
    return { enabled: true, description: 'พระพุทธเจ้า (ตัวละคร @buddha) — อ้างอิงจากพระพุทธรูป', images: refs.map((f) => basename(f)), dir: refDir(slug), buddha: true }
  }
  if (profile?.category === 'buddha' || profile?.category === 'monk') return null
  const c = readCharacter()
  return c.enabled && (c.images.length || c.description) ? c : null
}

/** หมวดที่ตัวละครหลักต้องเป็นการ์ตูนเต็มตัวเสมอ (พระพุทธเจ้า/พระเกจิ ห้ามเป็นตัวก้าง) */
const fullBodyOf = (c, profile) => !!c?.images.length || ['buddha', 'monk', 'self'].includes(profile?.category)

/** รูปสำหรับแนบไปกับงาน (ChatGPT / Flow) */
export function characterAttachments(c = activeCharacter()) {
  if (!c) return []
  return c.images.map((name) => ({
    name,
    type: MIME[extname(name).toLowerCase()] ?? 'image/png',
    base64: readFileSync(join(c.dir ?? CHARACTER_DIR, name)).toString('base64'),
  }))
}

/** กฎตัวละครสำหรับ ChatGPT รอบแรก — แทนตัวละครตัวอย่างของ Blueprint */
export function characterRule(c = activeCharacter()) {
  if (!c) return ''
  const lines = ['- ตัวละครหลักของคลิปนี้กำหนดไว้แล้ว — ใช้ตัวละครนี้แทนตัวละครตัวอย่างใน Blueprint (กฎอื่นของ Blueprint ใช้เหมือนเดิม)']
  if (c.selfMonk) {
    lines.push(c.images.length
      ? `- รูปที่แนบ ${c.images.length} รูปคือภาพจริงของ${c.selfMonk} พระผู้สอนในคลิปนี้: เขียน Character Bible ของ @monk ตามรูปหน้า ใบหน้า วัย รูปร่าง ศีรษะโกน แว่นตา (ถ้ามี) และสีจีวรในรูปให้ละเอียด เป็นการ์ตูนเต็มตัวหน้าเหมือนท่าน อย่างเคารพตามกฎ SACRED FIGURES`
      : `- ${c.selfMonk} พระผู้สอนในคลิปนี้ (@monk): การ์ตูนเต็มตัว ห่มจีวร สงบ เมตตา อย่างเคารพตามกฎ SACRED FIGURES`)
    if (c.selfNote) lines.push(`- รายละเอียดเพิ่มเติมของท่าน: ${c.selfNote}`)
    lines.push('- ตัวละครอื่น (ญาติโยมในตัวอย่าง) ออกแบบให้เข้ากับสไตล์เดียวกัน')
    return lines.join('\n')
  }
  if (c.monk) {
    lines.push(`- รูปที่แนบ ${c.images.length} รูปคือภาพจริงของ${c.monk}: เขียน Character Bible ของ @monk ตามใบหน้า รูปร่าง วัย สีจีวร และอัฐบริขารในรูป เป็นการ์ตูนเต็มตัวอย่างเคารพตามกฎ SACRED FIGURES`)
    lines.push('- ตัวละครอื่น (ญาติโยม ลูกศิษย์ คนดู) ออกแบบให้เข้ากับสไตล์เดียวกัน')
    return lines.join('\n')
  }
  if (c.buddha) {
    lines.push(`- รูปที่แนบ ${c.images.length} รูปคือพระพุทธรูปไทย ใช้เป็นแบบของ @buddha: พระพักตร์สงบ อมยิ้มเล็กน้อย ขมวดพระเกศาและพระรัศมีเปลว พระกรรณยาว จีวรห่มเฉียงสีเหลืองทอง และรัศมีสีทองรอบพระเศียร`)
    lines.push('- วาด @buddha เป็นการ์ตูนเต็มตัวที่มีชีวิต ยืน เดิน นั่ง และแสดงธรรมได้ตามเรื่อง (ไม่ใช่รูปปั้น เว้นแต่ฉากนั้นเป็นพระพุทธรูปจริงๆ) อย่างเคารพตามกฎ SACRED FIGURES · ใช้หน้าตาเดียวกันทุกช็อต')
    lines.push('- พระสาวก ชาวบ้าน และกษัตริย์ในพุทธกาล ออกแบบให้เข้ากับสไตล์เดียวกัน')
    return lines.join('\n')
  }
  if (c.images.length) lines.push(`- รูปที่แนบ ${c.images.length} รูปคือตัวละครหลัก: เขียน Character Bible ตามหน้าตา ทรงผม สีผิว ชุด สี และสัดส่วนในรูปให้ละเอียด ให้ภาพทุกช็อตออกมาเป็นตัวเดียวกับในรูป`)
  if (c.description) lines.push(`- คำอธิบายตัวละครหลัก: ${c.description}`)
  lines.push('- ตัวละครรองอื่นที่เรื่องต้องใช้ ออกแบบให้เข้ากับสไตล์ของตัวละครหลัก')
  return lines.join('\n')
}

/** แบบตัวละคร: แนบรูปอ้างอิง = การ์ตูนเต็มตัว · ไม่แนบ = ตัวก้าง (stick figure) — Blueprint มีทั้ง 2 แบบ ระบบบอกว่าคลิปนี้ใช้แบบไหน */
export function bodyStyleRule(c = activeCharacter(), profile = null) {
  // ลายเส้นภาพวาด (สีน้ำพุทธกาล / ภาพวาดจีน): สัดส่วนสมจริง ไม่ใช่การ์ตูน (รายละเอียดอยู่ใน ART_STYLES ที่ต่อท้าย prompt)
  const painted = ART_STYLES[profile?.artStyle]?.body
  if (painted) return painted
  return fullBodyOf(c, profile)
    ? '- แบบตัวละคร: FULL-BODY MODE — ตัวละครทุกตัวเป็นการ์ตูนเต็มตัว มีลำตัว แขนขาหนา มือ รองเท้า เสื้อผ้าชัด ห้ามวาดเป็นตัวก้าง (stick figure) · เขียนแบบนี้ใน Character Bible ด้วย'
    : '- แบบตัวละคร: STICK MODE (ไม่มีรูปตัวละครแนบ) — ตัวละครทุกตัวเป็นตัวก้าง stick figure หัวกลมโต แขนขาเป็นเส้น · เขียนแบบนี้ใน Character Bible ด้วย'
}

/** บรรทัดแบบตัวละครสำหรับคำสั่ง Flow */
export function bodyStyleFlowNote(c = activeCharacter(), profile = null) {
  const painted = ART_STYLES[profile?.artStyle]?.bodyFlow
  if (painted) return painted
  return fullBodyOf(c, profile)
    ? 'ตัวละครทุกตัวเป็นการ์ตูนเต็มตัว (ลำตัว แขนขามีความหนา มีเสื้อผ้า) ห้ามวาดเป็นตัวก้าง'
    : 'ตัวละครทุกตัวเป็นตัวก้าง stick figure หัวกลมโต แขนขาเป็นเส้น'
}

/** ข้อความต่อท้ายคำสั่ง Flow เมื่อแนบรูปตัวละคร */
export function characterFlowNote(c = activeCharacter()) {
  if (!c?.images.length) return ''
  if (c.selfMonk) return `รูปที่แนบคือภาพจริงของ${c.selfMonk} พระผู้สอนในคลิป (ตัวละคร @monk) — วาดเป็นการ์ตูนเต็มตัวหน้าเหมือนท่าน ห่มจีวร อย่างเคารพ ล็อกใบหน้า วัย รูปร่าง และสีจีวรตามรูปในทุกภาพ ห้ามวาดล้อเลียน`
  if (c.monk) return `รูปที่แนบคือภาพจริงของ${c.monk} (ตัวละคร @monk) — วาดเป็นการ์ตูนเต็มตัวอย่างเคารพ ล็อกใบหน้า วัย รูปร่าง และสีจีวรตามรูปในทุกภาพ ห้ามวาดล้อเลียน`
  if (c.buddha) return 'รูปที่แนบคือพระพุทธรูป ใช้เป็นแบบของพระพุทธเจ้า (@buddha) — วาดเป็นการ์ตูนเต็มตัวที่มีชีวิตอย่างเคารพ พระพักตร์สงบ พระเกศาขมวด จีวรเหลืองทอง มีรัศมีทองรอบพระเศียร หน้าตาเดียวกันทุกภาพ ห้ามวาดล้อเลียน'
  return 'รูปที่แนบคือตัวละครหลัก ล็อกหน้าตา ทรงผม สี และชุดตามรูปนี้ในทุกภาพ'
}
