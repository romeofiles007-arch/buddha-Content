// เครดิตคงเหลือค้างบนสุดของแผงข้าง — ผู้ใช้ (21 พ.ย. 2026): "ให้มีสถานะเครดิตทุกอย่างแสดงค้างไว้ด้านบน เช่น elevenlab และ kie"
//   node --test scripts/test-credits.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { elevenCredits, allCredits } from '../pipeline/lib/credits.mjs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const reply = (status, body) => async () => new Response(JSON.stringify(body), { status })

test('ElevenLabs: คำนวณคงเหลือจากใช้ไป/โควตา และวันรีเซ็ต', async () => {
  process.env.ELEVENLABS_API_KEY = 'test-only'
  const r = await elevenCredits(reply(200, { character_count: 27450, character_limit: 30000, tier: 'starter', next_character_count_reset_unix: 1797000000 }))
  assert.deepEqual(r, { used: 27450, limit: 30000, remaining: 2550, tier: 'starter', resetAt: 1797000000000 })
})

test('ElevenLabs: key จำกัดสิทธิ์ → บอกให้เปิด User: Read (ไม่พังทั้งแถบ)', async () => {
  process.env.ELEVENLABS_API_KEY = 'test-only'
  const r = await elevenCredits(reply(401, { detail: { status: 'missing_permissions', message: 'missing user_read' } }))
  assert.match(r.error, /User: Read/)
  assert.equal(r.short, 'key ไม่มีสิทธิ์อ่าน')
})

test('รวมทุกบริการ: มี key ไหนค่อยแสดง · จำไว้ 5 นาที', async () => {
  process.env.ELEVENLABS_API_KEY = 'test-only'
  process.env.KIE_API_KEY = ''
  let calls = 0
  const fetchImpl = async () => (calls++, new Response(JSON.stringify({ character_count: 1, character_limit: 10 })))
  const a = await allCredits({ refresh: true, now: 1_000, fetchImpl })
  assert.deepEqual(a.services.map((s) => s.id), ['elevenlabs'])
  await allCredits({ now: 2_000, fetchImpl })
  assert.equal(calls, 1, 'ภายใน 5 นาทีใช้ค่าที่จำไว้')
  await allCredits({ now: 1_000 + 5 * 60_000 + 1, fetchImpl })
  assert.equal(calls, 2)
})

test('แผงข้าง: แถบเครดิต + ปุ่มหยุดทุกอย่าง + ผลิตครั้งต่อไป อยู่ในแถบค้างบนสุด', () => {
  const html = read('extension/sidepanel.html')
  const dock = html.slice(html.indexOf('id="topDock"'), html.indexOf('id="genreBox"'))
  for (const id of ['creditBar', 'haltBar', 'prodNext']) assert.ok(dock.includes(`id="${id}"`), `${id} ต้องอยู่ในแถบบนสุด`)
  assert.match(read('extension/agents.css'), /\.topDock \{ position: sticky;/)
  assert.match(read('bridge/ui.js'), /path === '\/api\/credits'/)
})
