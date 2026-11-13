/**
 * ขั้นที่ 4 แบบหลายรอบ — ขอ OUTPUT 5 จาก ChatGPT ทีละชุดช็อต
 *
 * คลิป 5 นาที ≈ 120 ช็อต ถ้าขอรวดเดียว ChatGPT มักตอบไม่ครบหรือตัดกลางคัน
 *   รอบแรก:  Style Bible + Character Bible + shot ชุดแรก
 *   รอบถัดไป: ส่ง Bible จากรอบแรกกลับไป (ห้ามแก้) + shot ชุดที่ยังขาด
 * คำตอบแต่ละรอบเก็บที่ 04_shotlist/rounds/NN.txt แล้วรวมเป็น shots.json + agent_brief.txt
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { projectDir } from './config.mjs'
import { blueprint, parseShotList, flowPrompt, orientationRule, aspectOf, stripSafeArea, clipLanguage, imageLanguageRule } from './prompts.mjs'
import { activeCharacter, characterRule, bodyStyleRule } from './character.mjs'
import { readProfile } from './clip_profile.mjs'
import { categoryRule } from '../../extension/prompts.js'
import { coverRequest, parseCover, saveCoverPrompt, readCoverPrompt, coverShot, coverBriefLines } from './cover.mjs'
import { riddleRequest, parseRiddle, parseRiddleDraft, riddleProblem, saveRiddle } from './riddle.mjs'
import { themeOf } from './topics.mjs'
import { orientationOf } from './prompts.mjs'
import { continuityProblems, continuityReport, SHOT_VARIETY_RULE } from './continuity.mjs'

export const SHOTS_PER_ROUND = 40
const SHOT_LIST_MARK = /^\s*=+\s*SHOT LIST\s*=+\s*$/m

export function shotlistFiles(slug) {
  const dir = projectDir(slug, 'shotlist')
  return {
    dir,
    rounds: join(dir, 'rounds'),
    slots: join(dir, 'slots.json'),
    shots: join(dir, 'shots.json'),
    redone: join(dir, 'redone.json'),
    brief: join(dir, 'agent_brief.txt'),
    raw: join(dir, 'output5_raw.txt'),
  }
}

export function readRounds(slug) {
  const { rounds } = shotlistFiles(slug)
  if (!existsSync(rounds)) return []
  return readdirSync(rounds)
    .filter((f) => /^\d+\.txt$/.test(f))
    .sort()
    .map((f) => readFileSync(join(rounds, f), 'utf8'))
}

export function resetRounds(slug) {
  const f = shotlistFiles(slug)
  rmSync(f.rounds, { recursive: true, force: true })
  for (const file of [f.shots, f.brief, f.raw, f.redone]) rmSync(file, { force: true })
}

/** ช็อตที่เคยขอให้เขียนใหม่แล้ว — ขอซ้ำช็อตละครั้งเดียว กันวนขอไม่จบ */
function readRedone(slug) {
  try {
    return new Set(JSON.parse(readFileSync(shotlistFiles(slug).redone, 'utf8')))
  } catch {
    return new Set()
  }
}

function markRedone(slug, filenames) {
  const all = readRedone(slug)
  for (const name of filenames) all.add(name)
  writeFileSync(shotlistFiles(slug).redone, JSON.stringify([...all], null, 2))
}

/** Style Bible + Character Bible + Rules = ทุกอย่างก่อนบรรทัด "=== SHOT LIST ===" ของรอบแรก */
export function briefHead(raw) {
  const mark = raw.search(SHOT_LIST_MARK)
  // ไม่มีบรรทัดหัว SHOT LIST → ตัดก่อน shot แรกแทน
  const firstShot = raw.search(/^(?:[ \t>*•-]+|\d+[.)][ \t]+)?\**\d{2}_\d{2}_\d{2}(?:_\d)?\.png/m)
  const cut = mark >= 0 ? mark : firstShot
  const head = cut >= 0 ? raw.slice(0, cut) : raw
  // ตัดคำเกริ่นของ ChatGPT ("แน่นอนครับ ...") — Bible เริ่มที่หัวข้อ 5.1 / VISUAL STYLE DNA
  const start = head.search(/^.*(?:5\.1\b|VISUAL STYLE DNA|STYLE BIBLE).*$/im)
  return (start > 0 ? head.slice(start) : head).trim()
}

const bibleOf = (raws) => raws.map(briefHead).find((h) => h.length) ?? ''

const slotLine = (s) =>
  `${s.filename} | SHOT ${String(s.shot).padStart(2, '0')} | ${s.duration}s | ${s.continuation ? '(ภาพต่อเนื่องจากช็อตก่อน) ' : ''}${s.narration}`

const outputRules = (language) => `- ตอบเป็นข้อความล้วนในแชต ห้ามใส่ code block ครอบคำตอบ อย่าสร้างไฟล์
- ทุก shot ขึ้นต้นด้วยชื่อไฟล์ที่ให้มาเป๊ะๆ ที่ต้นบรรทัด (ห้ามใส่เลขข้อ ตัวหนา หรือ bullet หน้าชื่อไฟล์) ตามด้วย | คั่นแต่ละ field
- รูปแบบ field: SHOT NN | Chars: @TAG | Env: ... | Action: ... | Frame: ...
- Env ต้องเป็นฉากที่มีรายละเอียดตาม BACKGROUNDS ใน Style Bible: สถานที่ + ของประกอบฉาก 3–6 ชิ้นที่เข้ากับเรื่อง + แสง/เวลา/บรรยากาศ + โทนสีหลักตาม COLOR MOOD ของ Style Bible ให้ตรงอารมณ์ของบรรทัดนั้น (โทนหลักเย็นสบายตา ห้ามแสงทอง/โทนเหลืองทั้งภาพ · ห้ามเขียนแค่ "พื้นหลังสีเรียบ") — ฉากสีเดียวล้วนใช้เฉพาะช็อต pattern interrupt / reveal
- ช็อตต่อเนื่องในสถานที่เดิม ใช้ของประกอบฉากชุดเดิมให้ต่อเนื่อง แต่เปลี่ยนมุมกล้องให้เห็นส่วนอื่นของฉาก
- เว้น 1 บรรทัดว่างระหว่าง shot
- ช็อตที่กำกับว่า "ภาพต่อเนื่อง" ให้เป็น mini-sequence ของช็อตก่อนหน้า ไม่ใช่ฉากใหม่
- ใส่ pattern interrupt ทุก 15-30 วิ ตามกฎ 6
- ตัวละครทุกตัวต้องมี @TAG และห้ามเปลี่ยนรูปร่าง/สี/อุปกรณ์ข้ามช็อต
${SHOT_VARIETY_RULE}
${imageLanguageRule(language)}`

/**
 * prompt ของรอบถัดไป — null เมื่อทุกช็อตมี prompt แล้ว
 * @returns {{ prompt: string, round: number, batch: number, remaining: number } | null}
 */
export function nextRoundPrompt(config, slug, { title, timecodeText }) {
  const f = shotlistFiles(slug)
  const slots = JSON.parse(readFileSync(f.slots, 'utf8'))
  const raws = readRounds(slug)
  const { shots, missing } = parseShotList(raws.join('\n\n'), slots)
  // ครบทุกช็อตแล้ว — เหลือแค่ช็อตที่ภาพซ้ำกับช็อตข้างเคียง ขอเขียนใหม่ช็อตละครั้ง
  if (!missing.length) return redoRoundPrompt(config, slug, { title }, { shots, raws })

  const missingSet = new Set(missing)
  const batch = slots.filter((s) => missingSet.has(s.filename)).slice(0, SHOTS_PER_ROUND)
  const round = raws.length + 1
  const language = clipLanguage(config, slug)
  const OUTPUT_RULES = outputRules(language)

  // Bible มาจากรอบแรกที่มี 5.1/5.2 จริง (รอบต่อๆ ไปขึ้นต้นด้วย SHOT LIST เลย)
  const bible = bibleOf(raws)
  if (!bible) {
    // ตัวละครของฉัน: กำหนด Character Bible จากรูป/คำอธิบายที่ผู้ใช้ให้ แทนตัวละครตัวอย่างของ Blueprint
    const character = activeCharacter(slug)
    const profile = readProfile(slug)
    const charRule = characterRule(character, profile)
    const catRule = categoryRule(profile, 'image')
    return {
      round,
      batch: batch.length,
      remaining: missing.length,
      attachCharacter: !!character?.images.length,
      prompt: `${blueprint(config)}

═══════════════════════════════════════
สร้าง OUTPUT 5 สำหรับคลิปนี้

หัวข้อ: "${title}"

Timecode Map ของทั้งคลิป (ใช้ออกแบบตัวละครและเรื่องให้ครบทั้งคลิป):
${timecodeText}

คลิปนี้มีทั้งหมด ${slots.length} ช็อต — รอบนี้เขียน shot เฉพาะ ${batch.length} ช็อตแรกด้านล่าง (ช็อตที่เหลือจะขอในรอบถัดไป)
ห้ามเพิ่ม ห้ามลด ห้ามแก้ชื่อไฟล์:
${batch.map(slotLine).join('\n')}

ข้อกำหนดของ output:
- เรียงตามนี้: 5.1 Style Bible → 5.2 Character Bible (ครอบคลุมตัวละครของทั้งคลิป) → 5.3 Shot List
- ส่วน 5.3 ต้องขึ้นต้นด้วยบรรทัด "=== SHOT LIST ===" แล้วตามด้วย shot
${OUTPUT_RULES}${orientationRule(config) ? `\n${orientationRule(config)}` : ''}
${bodyStyleRule(character, profile)}${charRule ? `\n${charRule}` : ''}${catRule ? `\n${catRule}` : ''}
${coverRequest(orientationOf(config) === 'portrait', language)}${riddleRequest(language, themeOf(slug)) ? `\n${riddleRequest(language, themeOf(slug))}` : ''}`,
    }
  }

  // ช็อต 3 อันก่อนชุดนี้ — ให้ภาพต่อเนื่องข้ามรอบได้
  const firstIndex = slots.findIndex((s) => s.filename === batch[0].filename)
  const before = shots.slice(Math.max(0, firstIndex - 3), firstIndex).filter((s) => s.prompt)

  return {
    round,
    batch: batch.length,
    remaining: missing.length,
    prompt: `${blueprint(config)}

═══════════════════════════════════════
เขียน Shot List (OUTPUT 5.3) ต่อสำหรับคลิป "${title}"

ใช้ Style Bible และ Character Bible นี้เท่านั้น — ห้ามแก้ ห้ามเพิ่มตัวละครที่ไม่มี @TAG:
${bible}

${before.length ? `ช็อตก่อนหน้า (เพื่อความต่อเนื่อง ไม่ต้องเขียนซ้ำ):\n${before.map((s) => `${s.filename} ${s.prompt}`).join('\n\n')}\n\n` : ''}เขียน shot เฉพาะ ${batch.length} ช็อตนี้ ห้ามเพิ่ม ห้ามลด ห้ามแก้ชื่อไฟล์:
${batch.map(slotLine).join('\n')}

ข้อกำหนดของ output:
- ไม่ต้องเขียน 5.1 และ 5.2 ซ้ำ — ขึ้นต้นคำตอบด้วยบรรทัด "=== SHOT LIST ===" แล้วตามด้วย shot ทันที
${OUTPUT_RULES}${orientationRule(config) ? `\n${orientationRule(config)}` : ''}${categoryRule(readProfile(slug), 'image') ? `\n${categoryRule(readProfile(slug), 'image')}` : ''}`,
  }
}

/**
 * รอบ "เขียนใหม่" — ช็อตที่ตัวละครชุดเดิมและระยะภาพกลุ่มเดิมติดกันหลายช็อต (ภาพออกมาเหมือนกันทั้งแถว)
 * ขอช็อตละครั้งเดียว (จำไว้ใน redone.json) — ไม่มีอะไรต้องแก้แล้ว = null คือจบขั้นนี้
 */
function redoRoundPrompt(config, slug, { title }, { shots, raws }) {
  const done = readRedone(slug)
  const problems = continuityProblems(shots).filter((p) => !done.has(p.filename))
  if (!problems.length) return null
  const byName = new Map(shots.map((s) => [s.filename, s]))
  const order = shots.map((s) => s.filename)
  const language = clipLanguage(config, slug)
  const lines = problems.map((p) => {
    const s = byName.get(p.filename)
    const prev = byName.get(order[order.indexOf(p.filename) - 1])
    return [
      slotLine(s),
      `  ของเดิม: ${s.prompt}`,
      `  ต้องแก้เพราะ: ${p.reason}`,
      prev?.prompt ? `  ช็อตก่อนหน้า (ห้ามซ้ำกับช็อตนี้): ${prev.prompt}` : null,
    ].filter(Boolean).join('\n')
  })
  markRedone(slug, problems.map((p) => p.filename))
  return {
    round: raws.length + 1,
    batch: problems.length,
    remaining: 0,
    redo: true,
    prompt: `เขียน shot ใหม่เฉพาะ ${problems.length} ช็อตด้านล่างของคลิป "${title}" — ภาพชุดนี้ซ้ำกับช็อตข้างเคียงจนคลิปดูไม่ต่อเนื่อง

ใช้ Style Bible และ Character Bible เดิมเท่านั้น ห้ามแก้ ห้ามเพิ่มตัวละครใหม่:
${bibleOf(raws)}

ช็อตที่ต้องเขียนใหม่ (ห้ามเพิ่ม ห้ามลด ห้ามแก้ชื่อไฟล์):
${lines.join('\n\n')}

ข้อกำหนดของ output:
- ขึ้นต้นคำตอบด้วยบรรทัด "=== SHOT LIST ===" แล้วตามด้วยเฉพาะช็อตข้างบนนี้ ห้ามเขียนช็อตอื่น
- แต่ละช็อตต้องเปลี่ยนระยะภาพให้ต่างจากช็อตก่อนหน้า (wide / medium / close-up / macro) และเปลี่ยนมุมกล้องกับสิ่งที่อยู่ในเฟรมให้คนดูเห็นของใหม่ — ยังอยู่ฉากเดิมและเล่าบรรทัดเดิมเหมือนเดิม
- บรรทัดไหนพูดถึงคนหรือคำสอน ให้ดึงตัวละครหลักเข้ามาอยู่ในภาพแทนภาพธรรมชาติล้วน
${outputRules(language)}${orientationRule(config) ? `\n${orientationRule(config)}` : ''}${categoryRule(readProfile(slug), 'image') ? `\n${categoryRule(readProfile(slug), 'image')}` : ''}`,
  }
}

/** เก็บคำตอบของรอบ แล้วรวมทุกรอบเป็น shots.json + agent_brief.txt */
export function saveRound(slug, raw) {
  const f = shotlistFiles(slug)
  mkdirSync(f.rounds, { recursive: true })
  const n = readRounds(slug).length + 1
  writeFileSync(join(f.rounds, `${String(n).padStart(2, '0')}.txt`), raw, 'utf8')
  return mergeRounds(slug)
}

export function mergeRounds(slug) {
  const f = shotlistFiles(slug)
  const slots = JSON.parse(readFileSync(f.slots, 'utf8'))
  const raws = readRounds(slug)
  const all = raws.join('\n\n')
  const parsed = parseShotList(all, slots)
  const missing = parsed.missing
  // prompt ที่ส่งไป Flow ต้องไม่มีคำสั่งเว้นพื้นที่ว่าง (ภาพจะมีแถบว่าง)
  const shots = parsed.shots.map((s) => (s.prompt ? { ...s, prompt: stripSafeArea(s.prompt).trim() } : s))
  const head = stripSafeArea(bibleOf(raws))

  // ต่อ shot ด้วยชื่อไฟล์ที่เราคำนวณไว้เอง กันกรณี AI พิมพ์ชื่อไฟล์ตกหล่น
  const agentBrief = `${head}\n\n=== SHOT LIST ===\n\n${shots
    .filter((s) => s.prompt)
    .map((s) => `${s.filename} ${s.prompt}`)
    .join('\n\n')}`

  // prompt ปกคลิปจากรอบแรก (ไม่มี = Flow ออกแบบเองตอนสร้างภาพ)
  const cover = parseCover(all)
  if (cover) saveCoverPrompt(slug, cover)
  // โจทย์ภาพปริศนาธรรมสำหรับ Facebook Story (คลิปไทย) — Flow วาดต่อท้ายภาพปก
  // โจทย์ผิด (เล่นกับตัวอักษร / อ่านไม่ตรงคำตอบ) ไม่บันทึก → ไม่วาด ไม่ลง Story — แจ้งเหตุผลใน log
  const riddle = parseRiddle(all)
  if (riddle) saveRiddle(slug, riddle)
  else if (parseRiddleDraft(all)) console.warn(`   ปริศนาธรรมใช้ไม่ได้ — ${riddleProblem(parseRiddleDraft(all))} (ข้าม Story ของคลิปนี้)`)
  // ปกคลิปต่อท้ายคำสั่ง Flow — สร้างเป็นภาพสุดท้าย (5_images.mjs ตัด brief ที่หัว SHOT LIST แล้วใส่ปกเองอีกที)
  const titleFile = join(projectDir(slug, 'script'), 'title.txt')
  const title = existsSync(titleFile) ? readFileSync(titleFile, 'utf8').trim() : slug
  const briefWithCover = [agentBrief, ...coverBriefLines(coverShot(slug, title), aspectOf() === '9:16')].join('\n\n')

  writeFileSync(f.raw, all, 'utf8')
  writeFileSync(f.shots, JSON.stringify(shots, null, 2))
  writeFileSync(f.brief, agentBrief, 'utf8')
  // ช็อตที่ภาพซ้ำกับข้างเคียง (ขอเขียนใหม่ในรอบถัดไป) + สรุปไว้ขึ้น log
  const problems = continuityProblems(shots)
  return {
    total: slots.length,
    withPrompt: shots.length - missing.length,
    missing,
    problems,
    continuityNote: continuityReport(shots),
    hasBible: head.length > 0,
    coverPrompt: readCoverPrompt(slug),
    rounds: raws.length,
    agentBrief,
    flowPrompt: flowPrompt(briefWithCover, undefined, slug),
    aspect: aspectOf(),
    shots: shots.map((s) => ({ filename: s.filename, start: s.start, narration: s.narration, prompt: s.prompt })),
  }
}
