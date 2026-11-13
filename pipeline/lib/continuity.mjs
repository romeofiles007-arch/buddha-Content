/**
 * ความต่อเนื่องของภาพ — กันช็อตที่ "เหมือนเดิมทั้งแถว" (พ.ย. 2026)
 *
 * ปัญหาจริงที่เจอ: คลิปหมวด 1 ได้ภาพผีเสื้อเกาะดอกไม้ระยะมาโคร 4 ช็อตติดกันตั้งแต่เปิดเรื่อง
 * แล้วซ้ำอีกชุดกลางเรื่อง — เรียงกันแล้วดูเป็นภาพสุ่ม ไม่เป็นเรื่อง (ภาพ 12 ใน 23 ช็อตเป็นมาโคร)
 *
 * กติกา: ช็อตที่ตัวละครชุดเดิม "และ" ระยะภาพกลุ่มเดิม ติดกันได้ไม่เกิน 2 ช็อต
 *        ช็อตที่ 3 เป็นต้นไปของแถวนั้นถือว่าซ้ำ → ขอ ChatGPT เขียนใหม่เฉพาะช็อตนั้น (ครั้งเดียวต่อช็อต)
 *
 * ระยะภาพอ่านจากช่อง Frame: ใกล้ (macro / close-up) · กลาง (medium / over-the-shoulder) · กว้าง (wide)
 * อ่านไม่ออก = ไม่ตรวจช็อตนั้น (ดีกว่าสั่งแก้มั่ว)
 */

/** ช่วงท้ายสุดของแถวซ้ำที่ยอมให้มีได้ — ช็อตที่เกินจากนี้ถือว่าซ้ำ */
export const MAX_SAME_RUN = 2
/** ระยะใกล้ทั้งคลิปไม่ควรเกินสัดส่วนนี้ (แจ้งเตือนเฉยๆ ไม่สั่งแก้รายช็อต) */
export const MAX_CLOSE_SHARE = 0.6

const field = (prompt, name) => String(prompt ?? '').match(new RegExp(`${name}\\s*:([^|]*)`, 'i'))?.[1]?.trim() ?? ''

/** ตัวละครในช็อต — เรียงแล้วต่อกัน เพื่อเทียบว่า "ชุดเดิม" ไหม */
export function shotChars(prompt) {
  const tags = (field(prompt, 'Chars').match(/@\w+/g) ?? []).map((t) => t.toLowerCase())
  return [...new Set(tags)].sort().join(',')
}

/** ระยะภาพของช็อต: 'ใกล้' | 'กลาง' | 'กว้าง' | null (อ่านไม่ออก) */
export function shotSize(prompt) {
  const frame = field(prompt, 'Frame').toLowerCase()
  if (!frame) return null
  if (/macro|close[-\s]?up|closeup|มาโคร|ระยะใกล้|โคลสอัพ/.test(frame)) return 'ใกล้'
  if (/wide|establishing|ภาพกว้าง|ระยะไกล|มุมกว้าง/.test(frame)) return 'กว้าง'
  if (/medium|over[-\s]?the[-\s]?shoulder|ระยะกลาง|ครึ่งตัว|เต็มตัว|full[-\s]shot/.test(frame)) return 'กลาง'
  return null
}

/**
 * ช็อตที่ซ้ำกับช็อตก่อนหน้าเกินกติกา
 * @param {{filename: string, shot?: number, prompt: string|null}[]} shots
 * @returns {{filename: string, reason: string}[]}
 */
export function continuityProblems(shots) {
  const problems = []
  let runChars = null
  let runSize = null
  let run = 0
  for (const s of shots) {
    if (!s.prompt) {
      run = 0
      runChars = runSize = null
      continue
    }
    const chars = shotChars(s.prompt)
    const size = shotSize(s.prompt)
    // อ่านระยะภาพไม่ออก → เริ่มนับใหม่ ไม่ตัดสินช็อตนั้น
    if (!size) {
      run = 0
      runChars = runSize = null
      continue
    }
    if (chars === runChars && size === runSize) {
      run += 1
      if (run > MAX_SAME_RUN) {
        problems.push({
          filename: s.filename,
          reason: `ซ้ำกับช็อตก่อนหน้า — ตัวละครชุดเดิม (${chars || 'ไม่มีตัวละคร'}) และระยะภาพ${size}ติดกัน ${run} ช็อต`,
        })
      }
    } else {
      run = 1
      runChars = chars
      runSize = size
    }
  }
  return problems
}

/** สรุปภาพรวมไว้ขึ้น log — คืน '' เมื่อไม่มีอะไรต้องเตือน */
export function continuityReport(shots) {
  const withPrompt = shots.filter((s) => s.prompt)
  if (!withPrompt.length) return ''
  const sizes = withPrompt.map((s) => shotSize(s.prompt)).filter(Boolean)
  const close = sizes.filter((x) => x === 'ใกล้').length
  const wide = sizes.filter((x) => x === 'กว้าง').length
  const notes = []
  if (sizes.length && close / sizes.length > MAX_CLOSE_SHARE) {
    notes.push(`ภาพระยะใกล้ ${close}/${sizes.length} ช็อต (เกิน ${Math.round(MAX_CLOSE_SHARE * 100)}%) — คลิปจะดูซ้ำ`)
  }
  if (sizes.length >= 6 && !wide) notes.push('ไม่มีภาพกว้างเลย — คนดูไม่เห็นว่าเรื่องเกิดที่ไหน')
  return notes.join(' · ')
}

/** กฎที่ต่อท้าย prompt ขั้นที่ 4 — ให้ ChatGPT คุมความหลากหลายของระยะภาพตั้งแต่แรก */
export const SHOT_VARIETY_RULE = `- ระยะภาพต้องหลากหลาย: ห้ามช็อตที่ "ตัวละครชุดเดิม + ระยะภาพกลุ่มเดิม" ติดกันเกิน 2 ช็อต (ใกล้ = macro/close-up · กลาง = medium/over-the-shoulder · กว้าง = wide) — ช็อตที่ 3 ต้องเปลี่ยนระยะภาพ หรือเปลี่ยนตัวละคร/สิ่งที่อยู่ในเฟรม
- ทั้งคลิป: ภาพระยะใกล้ไม่เกินครึ่งหนึ่งของช็อตทั้งหมด · มีภาพกว้างที่เห็นสถานที่อย่างน้อย 1 ใน 5 ช็อต · 3 ช็อตแรกต้องมีภาพกว้างหรือภาพที่เห็นตัวละครหลักอย่างน้อย 1 ช็อต
- ช่อง Frame ของทุกช็อตต้องมีคำบอกระยะภาพเป็นภาษาอังกฤษ (wide / medium / close-up / macro) — ระบบใช้คำนี้ตรวจความหลากหลาย
- ภาพประกอบธรรมชาติล้วน (ดอกไม้ ใบไม้ หยดน้ำ สัตว์) ติดกันได้ไม่เกิน 2 ช็อต แล้วต้องกลับมาที่ตัวละครหลักหรือสถานที่ของเรื่อง`
