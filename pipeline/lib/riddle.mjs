/**
 * ภาพ "ไขปริศนาธรรม" สำหรับ Facebook Story — แนวเกมทายคำจากภาพของรายการเวทีทอง
 * ผู้ใช้ (5 พ.ย. 2026): Story ให้เป็นโพสต์ภาพไขปริศนาธรรม แนวภาพทันสมัย มีเฉลยเล็กๆ มุมล่าง
 *
 *   ChatGPT: ออกแบบโจทย์มาพร้อม Shot List รอบแรก (บรรทัด riddle.png | RIDDLE | ...) → 04_shotlist/riddle.json
 *   Flow:    วาดเฉพาะภาพชิ้นส่วนปริศนา (ไม่มีตัวอักษร) ต่อท้ายภาพปก → 05_images/riddle.png
 *   ระบบ:    เขียนหัวข้อ คำถาม และเฉลยลงภาพเอง (ffmpeg + ASS ฟอนต์ไทยวางสระถูก) ตอนจะลง Story
 *
 * ทำเฉพาะคลิปพากย์ไทย — การเล่นเสียงคำแบบเวทีทองเป็นของภาษาไทย
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { projectDir } from './config.mjs'
import { run } from './ffmpeg.mjs'

export const RIDDLE_NAME = 'riddle.png'
export const riddlePath = (slug) => join(projectDir(slug, 'images'), RIDDLE_NAME)
const riddleFile = (slug) => join(projectDir(slug, 'shotlist'), 'riddle.json')

/** กฎสำหรับ ChatGPT รอบแรก — ขอโจทย์ปริศนาต่อท้ายปก (คลิปไทยเท่านั้น) */
export function riddleRequest(language = 'th', theme = null) {
  if (language !== 'th') return ''
  return `- ต่อท้ายอีกบรรทัด "=== RIDDLE ===" ตามด้วยโจทย์ "ไขปริศนาธรรม" 1 บรรทัด สำหรับลง Facebook Story แบบเกมทายคำจากภาพของรายการเวทีทอง:
  riddle.png | RIDDLE | ANSWER: <คำธรรมะ 2–4 พยางค์> | READ: <คำอ่านของคำตอบ แยกพยางค์ด้วย - เช่น ขัน-ติ> | PIECES: <ภาพชิ้นที่ 1> = <คำที่อ่าน> + <ภาพชิ้นที่ 2> = <คำที่อ่าน> (+ ชิ้นที่ 3 ถ้าจำเป็น) | MEANING: <ความหมายของคำตอบ 1 ประโยคสั้น ไม่เกิน 45 ตัวอักษร>
  · คำตอบเป็นคำธรรมะที่เกี่ยวกับเรื่องของคลิปนี้${theme?.dhamma ? ` (หลักธรรมแกนของคลิป: ${theme.dhamma} — ใช้คำนี้หรือคำในหลักธรรมนี้ถ้าทำเป็นภาพได้)` : ''}
  · ภาพแต่ละชิ้นเป็นสิ่งของ สัตว์ หรือท่าทางที่คนไทยเห็นแล้วเรียกชื่อได้ทันที เอาชื่อทุกชิ้นมาอ่านต่อกันแล้วได้เสียงเป็นคำตอบ (พ้องเสียงได้ เช่น ขันน้ำ = "ขัน") · 2–3 ชิ้น ห้ามเกิน
  · คำที่อ่านของทุกชิ้นต่อกันต้องตรงกับ READ ทุกพยางค์ — เทียบเสียงตามคำอ่านจริง ระวังตัวสะกด (เช่น โลภ อ่านว่า โลบ ไม่ใช่ โลก)
  · ห้ามเล่นกับตัวอักษรเด็ดขาด: ห้ามลบ/ตัด/เติม/เปลี่ยนตัวอักษร ห้ามมีตัวอักษรหรือคำในภาพ — ทุกชิ้นต้องเป็นภาพของจริงที่อ่านชื่อแล้วได้เสียง
  · ทำเป็นภาพไม่ได้จริงๆ ให้เลือกคำธรรมะคำอื่นที่ทำได้ ดีกว่าโจทย์ที่ผิด
  · ห้ามใช้พระพุทธเจ้า พระพุทธรูป พระสงฆ์ หรือของสูงเป็นชิ้นปริศนา · ต้องทายได้จริง ไม่กำกวมจนไม่มีใครตอบถูก`
}

/** ดึงโจทย์ปริศนาจากคำตอบของ ChatGPT ตามที่เขียนมา (ยังไม่ตรวจว่าถูก) → { answer, read, pieces: [{ picture, sound }], meaning } */
export function parseRiddleDraft(text) {
  const line = /^(?:[ \t>*•-]+)?\**riddle\.png\**[ \t:|]*(.+)$/im.exec(String(text ?? ''))?.[1]
  if (!line) return null
  const field = (key) => new RegExp(`${key}\\s*[:：]\\s*([^|]+)`, 'i').exec(line)?.[1]?.trim() ?? ''
  const answer = field('ANSWER').replace(/^["“”']+|["“”']+$/g, '')
  const pieces = field('PIECES').split(/\s*\+\s*/).map((part) => {
    const [picture, sound] = part.split(/\s*=\s*/)
    return { picture: String(picture ?? '').replace(/^\(?\d+\)?[.)]?\s*/, '').trim(), sound: String(sound ?? '').replace(/["“”']/g, '').trim() }
  }).filter((p) => p.picture)
  const read = field('READ').replace(/["“”']/g, '')
  return { answer, ...(read && { read }), pieces, meaning: field('MEANING') }
}

// ชิ้นที่เล่นกับตัวอักษร/คำ ไม่ใช่เกมทายคำจากภาพ และบังคับให้ Flow วาดตัวหนังสือ
// 8 พ.ย. 2026: "รูปโลก + มือลบตัว ก" เฉลย "โลภ" — ผิดทั้งกติกาและเสียง (โลก − ก = โล · โลภ อ่าน โลบ)
const LETTER_PLAY = /ลบ|ตัด|เติม|ถอด|เอาออก|ไม่มี|แทนที่|เปลี่ยนเป็น|ตัวอักษร|อักษร|ตัว\s*[ก-ฮ](?![ก-๙])|พยัญชนะ|วรรณยุกต์|คำว่า|ข้อความ|ป้ายชื่อ|[−–]\s*[ก-ฮ]|-\s*[ก-ฮ](?![ก-๙])/
const sounds = (s) => String(s ?? '').replace(/[\s\-–·.,()]/g, '')

/**
 * โจทย์ผิดตรงไหน (null = ใช้ได้) — โค้ดตรวจเอง ไม่เชื่อ ChatGPT
 *   ภาพ 2–3 ชิ้น · ห้ามชิ้นที่เล่นกับตัวอักษร · คำที่อ่านของทุกชิ้นต่อกันต้องตรงกับคำอ่าน (READ) หรือตัวสะกดของคำตอบ
 */
export function riddleProblem(r) {
  if (!r?.answer) return 'ไม่มีคำตอบ'
  const pieces = r.pieces ?? []
  if (pieces.length < 2 || pieces.length > 3) return 'ต้องมีภาพ 2–3 ชิ้น'
  for (const p of pieces) {
    if (!p.sound) return `ชิ้น "${p.picture}" ไม่ได้บอกว่าอ่านว่าอะไร`
    if (LETTER_PLAY.test(p.picture) || LETTER_PLAY.test(p.sound)) return `ชิ้น "${p.picture}" เล่นกับตัวอักษร — ต้องเป็นภาพของจริงที่อ่านชื่อแล้วได้เสียง`
  }
  const joined = sounds(pieces.map((p) => p.sound).join(''))
  const ok = [r.answer, r.read].filter(Boolean).map(sounds)
  if (!ok.includes(joined)) return `อ่านชื่อภาพต่อกันได้ "${pieces.map((p) => p.sound).join(' + ')}" ไม่ตรงกับคำตอบ "${r.answer}"${r.read ? ` (อ่านว่า ${r.read})` : ''}`
  return null
}

/** โจทย์ปริศนาที่ผ่านการตรวจ — โจทย์ผิด = null (ไม่วาด ไม่ลง Story) */
export function parseRiddle(text) {
  const r = parseRiddleDraft(text)
  return r && !riddleProblem(r) ? r : null
}

export function saveRiddle(slug, riddle) {
  if (riddle) writeFileSync(riddleFile(slug), JSON.stringify(riddle, null, 2), 'utf8')
}

export function readRiddle(slug) {
  try { return existsSync(riddleFile(slug)) ? JSON.parse(readFileSync(riddleFile(slug), 'utf8')) : null } catch { return null }
}

export const hasRiddleImage = (slug) => existsSync(riddlePath(slug))

/** "ช็อต" ภาพปริศนาสำหรับส่งให้ Flow — ไม่มีโจทย์ = null (คลิปเก่า/คลิปภาษาอื่น ไม่ทำ) */
export function riddleShot(slug) {
  const riddle = readRiddle(slug)
  if (!riddle || riddleProblem(riddle)) return null // โจทย์ผิด (เช่นของเก่าก่อนมีการตรวจ) ไม่ต้องเสียเวลาวาด
  const pieces = riddle.pieces.map((p, i) => `(${i + 1}) ${p.picture}`).join(' + ')
  return {
    filename: RIDDLE_NAME,
    shot: 'RIDDLE',
    // ห้ามมีคำว่า ปก/cover/thumbnail — extension จับคู่ภาพพิเศษจากคำใน prompt
    prompt: `ภาพปริศนาทายคำจากภาพ (picture rebus riddle) — ภาพ ${riddle.pieces.length} ชิ้นเรียงกัน คั่นด้วยเครื่องหมาย + ตัวใหญ่สีขาวขอบมน: ${pieces}`,
  }
}

/** ส่วนท้ายของ brief ที่ส่งให้ Flow — สไตล์ทันสมัยของภาพนี้แทน Style Bible ของคลิป */
export function riddleBriefLines(shot) {
  return [
    '=== RIDDLE (สร้างต่อจากภาพปก เป็นภาพสุดท้าย) ===',
    `${shot.filename} ${shot.prompt} | ภาพนี้ใช้สไตล์ของตัวเองแทน Style Bible ของคลิป: ภาพประกอบ flat vector ทันสมัย สีสดสะอาด เงานุ่ม มุมมนแบบไอคอนแอป พื้นหลังไล่สีเรียบเต็มเฟรม (คราม-ม่วง หรือ ฟ้า-เขียวมิ้นต์) ไม่มีฉาก ไม่มีตัวละครของคลิป · แต่ละชิ้นวาดใหญ่ ชัด อยู่บนการ์ดสีขาวขอบมนของตัวเอง เห็นแล้วเรียกชื่อได้ทันที · จัดชิ้นทั้งหมดไว้ช่วงกลางภาพ (ระหว่าง 25% ถึง 85% ของความสูง) ด้านบนและล่างเป็นพื้นหลังไล่สีเรียบๆ · ห้ามมีตัวอักษร ตัวเลข หรือคำใดๆ ในภาพเด็ดขาด ยกเว้นเครื่องหมาย + · ตั้งชื่อภาพ "riddle.png RIDDLE" (ชื่อไฟล์ไม่ต้องเขียนลงในภาพ)`,
  ]
}

// ── ภาพ Story: เขียนหัวข้อ คำถาม และเฉลยลงบนภาพปริศนา ──

const assText = (s) => String(s ?? '').replace(/[{}\\]/g, '').replace(/\r?\n/g, '\\N').trim()

/** ข้อความบนภาพ (ASS 1080×1920) — เฉลยตัวเล็กที่มุมขวาล่างแบบเวทีทอง */
export function riddleAss(riddle) {
  const font = 'Leelawadee UI'
  const sound = riddle.pieces.map((p) => p.sound).filter(Boolean).join(' + ')
  // หลายบรรทัด = array — ขึ้นบรรทัดด้วย \N ของ ASS (assText ตัด \ ในข้อความทิ้ง)
  const line = (style, text) => `Dialogue: 0,0:00:00.00,0:00:05.00,${style},,0,0,0,,${[text].flat().filter(Boolean).map(assText).join('\\N')}`
  // เฉลยกับความหมายเป็นคนละกล่อง วางซ้อนขึ้นไปทีละบรรทัด — เดิมอยู่กล่องเดียว 2 บรรทัด พื้นของแต่ละบรรทัดทับกัน
  const lineAt = (style, text, marginV) => `Dialogue: 0,0:00:00.00,0:00:05.00,${style},,0,0,${marginV},,${assText(text)}`
  const meaning = shortMeaning(riddle.meaning)
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Head,${font},104,&H00FFFFFF,&H00FFFFFF,&H00573A1E,&H00573A1E,-1,0,0,0,100,100,2,0,3,22,0,8,60,60,120,222
Style: Ask,${font},56,&H00FFFFFF,&H00FFFFFF,&H30573A1E,&H30573A1E,-1,0,0,0,100,100,0,0,3,14,0,8,70,70,300,222
Style: Cta,${font},46,&H00FFFFFF,&H00FFFFFF,&H30573A1E,&H30573A1E,-1,0,0,0,100,100,0,0,3,14,0,2,70,70,150,222
Style: Ans,${font},30,&H00FFFFFF,&H00FFFFFF,&H40000000,&H40000000,0,0,0,0,100,100,0,0,3,10,0,3,36,36,40,222
Style: Mean,${font},26,&H00FFFFFF,&H00FFFFFF,&H40000000,&H40000000,0,0,0,0,100,100,0,0,3,8,0,3,36,36,40,222

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${line('Head', 'ไขปริศนาธรรม')}
${line('Ask', 'ภาพนี้คือคำธรรมะว่าอะไร?')}
${line('Cta', 'ทายแล้วตอบกลับ Story นี้ได้เลย')}
${meaning ? `${line('Mean', meaning)}\n` : ''}${lineAt('Ans', `เฉลย: ${riddle.answer}${sound ? ` (${sound})` : ''}`, meaning ? 102 : 40)}
`
}

/** ความหมายใต้เฉลย: บรรทัดเดียว (ไม่ตัดคำ WrapStyle 2) — ยาวเกินตัดที่ช่องว่างแล้วใส่ … ไม่ล้นขอบภาพ */
export function shortMeaning(text, max = 48) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  if ([...s].length <= max) return s
  const cut = [...s].slice(0, max).join('')
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}…`
}

/**
 * ภาพ Story พร้อมลง (JPG 1080×1920) ไว้ในโฟลเดอร์ชั่วคราวของ posting — คืน { file, remove }
 * ไม่มีโจทย์หรือภาพปริศนา = null (ข้าม Story รอบนี้)
 */
export async function prepareRiddleStory(slug, postingDir) {
  const riddle = readRiddle(slug)
  const image = riddlePath(slug)
  if (!riddle || riddleProblem(riddle) || !existsSync(image)) return null // โจทย์ผิด = ไม่ลง Story (ไม่นับรอบ)
  const dir = join(postingDir, 'staging', `riddle-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  const remove = async () => rmSync(dir, { recursive: true, force: true })
  try {
    writeFileSync(join(dir, 'riddle.ass'), riddleAss(riddle), 'utf8')
    // ffmpeg บน Windows escape path ใน filter ยาก → รันในโฟลเดอร์ของไฟล์ .ass แล้วอ้างชื่อไฟล์เปล่าๆ
    await run('ffmpeg', ['-y', '-v', 'error', '-i', image,
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,subtitles=riddle.ass',
      '-frames:v', '1', '-q:v', '3', 'story.jpg'], { cwd: dir })
    return { file: join(dir, 'story.jpg'), riddle, remove }
  } catch (error) {
    await remove()
    throw error
  }
}
