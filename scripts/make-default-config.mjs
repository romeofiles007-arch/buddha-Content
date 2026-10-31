// สร้าง config/default.config.json (ค่าเริ่มต้นที่ขึ้น GitHub ให้ลูกค้า) จาก config/project.config.json ของเครื่องนี้
// ใช้ค่าปัจจุบันเป็นค่าเริ่มต้น แต่ล้างสิ่งที่ผูกกับบัญชี/เครื่องของเรา — กติกาเดียวกับ scripts/build-package.mjs
// project.config.json ไม่ขึ้น repo (.gitignore) — ลูกค้าแต่ละเครื่องมีไฟล์ของตัวเอง สร้างตอนตั้งค่าครั้งแรกในแผงข้าง
// ใช้: node scripts/make-default-config.mjs   (รันใหม่ทุกครั้งที่อยากให้ค่าเริ่มต้นของลูกค้าเปลี่ยนตาม)
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(readFileSync(join(ROOT, 'config', 'project.config.json'), 'utf8'))

// เสียงที่โคลนไว้ (ElevenLabs) เป็นของบัญชีเรา → ลูกค้าเริ่มที่เสียง Edge ซึ่งฟรีและใช้ได้ทันที
if (config.tts?.elevenlabs) Object.assign(config.tts.elevenlabs, { voiceId: '', voiceName: '' })
if (config.tts) config.tts.engine = 'edge'
// Kie มีค่าใช้จ่าย — ให้ลูกค้าเปิดเองเมื่อมี API key
if (config.clips) config.clips.provider = 'off'
// โฟลเดอร์ส่งโพสต์ (Google Drive ของเรา) ไม่ใช่ของลูกค้า
if (config.autoPost) config.autoPost.dir = ''

writeFileSync(join(ROOT, 'config', 'default.config.json'), JSON.stringify(config, null, 2) + '\n')
console.log('✓ config/default.config.json — เสียง Edge · ปิด Kie · ไม่มี Voice ID / โฟลเดอร์ของเรา')
