// UI choices map to the scheduler's existing settings; no scheduling happens here.
const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const invalid = (field, message) => Object.assign(new Error(message), { field })
function integer(value, min, max, field, message) {
  const n = Number(value)
  if (String(value).trim() === '' || !Number.isInteger(n) || n < min || n > max) throw invalid(field, message)
  return n
}

export function scheduleFields(s) {
  return { start: s.start, time: s.time, count: s.count || 5, unlimited: s.count === 0,
    pause: !s.delayMin && !s.delayMax ? 'none' : s.delayMin === s.delayMax ? 'fixed' : 'random',
    min: s.delayMin || (s.delayMax ? 0 : 20), max: s.delayMax || 40 }
}

export function scheduleFromFields(f) {
  if (!['now', 'at', 'daily'].includes(f.start)) throw invalid('prodStart', 'เลือกเวลาเริ่มผลิต')
  if (f.start !== 'now' && !clock.test(f.time)) throw invalid('prodTime', 'เลือกเวลาเริ่มผลิตให้ครบ')
  const count = f.unlimited ? 0 : integer(f.count, 1, 100, 'prodCount', 'ใส่จำนวนคลิปเป็นจำนวนเต็ม 1–100 คลิป')
  let delayMin = 0, delayMax = 0
  if (f.pause !== 'none') {
    if (!['fixed', 'random'].includes(f.pause)) throw invalid('prodPauseMode', 'เลือกวิธีพักหลังแต่ละคลิป')
    delayMin = integer(f.min, 0, 720, 'prodDelayMin', 'ใส่เวลาพักเป็นจำนวนเต็ม 0–720 นาที')
    delayMax = f.pause === 'fixed' ? delayMin : integer(f.max, 0, 720, 'prodDelayMax', 'ใส่เวลาพักสูงสุดเป็นจำนวนเต็ม 0–720 นาที')
    if (delayMax < delayMin) throw invalid('prodDelayMax', 'เวลาพักสูงสุดต้องไม่น้อยกว่าเวลาพักเริ่มต้น')
  }
  return { count, start: f.start, time: f.time, delayMin, delayMax }
}

export function nextProductionStart(time, now = new Date()) {
  const d = new Date(now)
  const [h, m] = time.split(':').map(Number)
  d.setHours(h, m, 0, 0)
  if (d <= now) d.setDate(d.getDate() + 1)
  return d
}

export function scheduleCopy(s, now = new Date()) {
  const amount = s.count ? `${s.count} คลิป` : 'ต่อเนื่องจนกดหยุด'
  const headline = s.start === 'daily' && s.count ? `ทุกวัน ${s.time} น. · วันละ ${amount}`
    : `${s.start === 'now' ? 'เริ่มตอนนี้' : `เริ่ม ${s.time} น.`} · ${amount}`
  const rest = !s.delayMax ? 'ทำคลิปถัดไปทันทีหลังคลิปก่อนหน้าเสร็จ'
    : `พัก ${s.delayMin === s.delayMax ? s.delayMin : `${s.delayMin}–${s.delayMax}`} นาที หลังคลิปก่อนหน้าเสร็จ`
  const date = s.start === 'now' ? null : nextProductionStart(s.time, now)
  return { headline, detail: rest + (s.start === 'daily' && !s.count ? ' · ทำต่อจนกดหยุด ไม่เริ่มชุดใหม่ทุกวัน' : ''),
    firstStart: date ? `เริ่ม${date.toDateString() === new Date(now).toDateString() ? 'วันนี้' : 'พรุ่งนี้'} ${s.time} น.${s.start === 'daily' && s.count ? ' แล้วทำซ้ำทุกวัน' : ''}` : 'เริ่มเมื่อกดปุ่มด้านล่าง',
    action: s.start === 'daily' && s.count ? 'เปิดผลิตทุกวัน' : s.start !== 'now' ? 'ตั้งเวลาเริ่มผลิต' : `เริ่มผลิต${s.count ? ` ${amount}` : 'ต่อเนื่อง'}` }
}
