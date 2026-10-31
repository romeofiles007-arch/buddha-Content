// ตรวจไฟล์ภาพและข้อกำหนดของแถบ โดยไม่อ่านข้อมูลลับหรือเรียก bridge
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SEA_ASSETS, DEPARTMENTS, HANDOFF, elapsed } from '../extension/agents.js'

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8')
assert.deepEqual(DEPARTMENTS.map(d => [d.id, d.animal]), [
  ['chatgpt', 'พระภิกษุนักเรียบเรียง'], ['flow', 'ช่างศิลป์'], ['meta', 'ผู้ช่วยจัดฉาก'], ['voice', 'นักพากย์'], ['edit', 'ผู้ช่วยตัดต่อ'],
])
assert.deepEqual(HANDOFF.map(s => [s.key, s.id]), [
  ['script', 'chatgpt'], ['voice', 'voice'], ['art', 'chatgpt'], ['images', 'flow'], ['clips', 'meta'], ['edit', 'edit'],
])
assert.equal(elapsed(1_000, 126_000), '2:05')
assert.equal(elapsed('2026-09-17T00:00:00Z', Date.parse('2026-09-17T00:02:10Z')), '2:10')
assert.equal(elapsed(200_000, 126_000), '0:00')
assert.equal(elapsed(null), '')
assert.equal(elapsed('invalid'), '')

for (const animal of Object.values(SEA_ASSETS)) {
  const png = readFileSync(new URL('../extension/agents/' + animal + '.png', import.meta.url))
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.ok(png.readUInt32BE(16) >= 1024, animal + ': ความละเอียด atlas')
  assert.ok(Math.abs(png.readUInt32BE(16) / png.readUInt32BE(20) - 4/3) < .02, animal + ': ตาราง 4×3 ช่องสัดส่วนเท่ากัน')
  assert.equal(png[25], 6, animal + ': มี alpha โปร่งใส')
}
const scene = readFileSync(new URL('../extension/agents/temple-day.png', import.meta.url))
assert.equal(scene.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
const css = read('extension/agents.css') + read('extension/temple.css')
assert.match(css, /steps\(1, end\)/)
assert.match(css, /background-size: 400% 300%/)
assert.match(css, /prefers-reduced-motion: reduce/)
assert.match(css, /animation-play-state: paused !important/)
assert.doesNotMatch(css, /url\(['"]?https?:/)
assert.doesNotMatch(read('extension/agents.js'), /requestAnimationFrame|setInterval/)
const panel = read('extension/sidepanel.js')
assert.match(panel, /setInterval\(refreshAgents, 3000\)/)
assert.match(panel, /if \(document.hidden \|\| agentRefreshing\) return/)
assert.match(JSON.parse(read('extension/manifest.json')).version, /^\d+\.\d+\.\d+$/)
console.log('PASS: five temple departments, six pipeline stages, elapsed time, 12-frame RGBA atlases, pause and 3-second polling.');
