// ⏹ หยุดทุกอย่าง — ผู้ใช้ (21 พ.ย. 2026): "บางทีปุ่มหยุดใช้ไม่ได้ มันยังทำงานเอง"
//   node --test scripts/test-halt.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHalt, strayProcesses, HALTED_MESSAGE } from '../bridge/halt.js'
import { createRunner } from '../bridge/runner.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('สวิตช์หยุดเก็บลงไฟล์ — โปรแกรมรีสตาร์ทแล้วยังหยุดอยู่', () => {
  const dir = mkdtempSync(join(tmpdir(), 'halt-'))
  try {
    const file = join(dir, 'runtime', 'halt.json')
    const a = createHalt(file)
    assert.equal(a.on(), false)
    a.set(true)
    assert.equal(createHalt(file).on(), true, 'อ่านใหม่แล้วต้องยังหยุดอยู่')
    a.set(false)
    assert.equal(createHalt(file).on(), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('process ที่หลุดการควบคุม: เฉพาะของโปรแกรมนี้ ไม่แตะ bridge และไม่แตะโปรแกรมอื่นบนเครื่องเดียวกัน', () => {
  const root = 'C:\\Git\\buddha-Content-main'
  const list = [
    { pid: 10, name: 'node.exe', cmd: '"C:\\Program Files\\nodejs\\node.exe" C:\\Git\\buddha-Content-main\\pipeline\\autopilot.mjs --auto-topic' },
    { pid: 11, name: 'python.exe', cmd: 'C:\\py\\python.exe C:\\Git\\buddha-Content-main\\tts\\cloud\\edge_synth.py job.json' },
    { pid: 12, name: 'ffmpeg.exe', cmd: 'ffmpeg -i C:\\Git\\buddha-Content-main\\projects\\x\\02_audio\\a.wav out.mp4' },
    { pid: 13, name: 'node.exe', cmd: '"C:\\Program Files\\nodejs\\node.exe" C:\\Git\\buddha-Content-main\\bridge\\server.js' },
    // แอปตำนานจีน (โค้ดชุดเดียวกัน) บนเครื่องเดียวกัน — ห้ามแตะ
    { pid: 14, name: 'node.exe', cmd: '"C:\\Program Files\\nodejs\\node.exe" C:\\Git\\china\\pipeline\\autopilot.mjs' },
    { pid: 15, name: 'chrome.exe', cmd: 'chrome.exe C:\\Git\\buddha-Content-main\\pipeline\\x' },
    { pid: 16, name: 'node.exe', cmd: 'node pipeline/autopilot.mjs' },
    // โฟลเดอร์ชื่อขึ้นต้นเหมือนกัน (สำเนาเก่า) ไม่ใช่ของโปรแกรมนี้
    { pid: 17, name: 'node.exe', cmd: 'node C:\\Git\\buddha-Content-main-old\\pipeline\\autopilot.mjs' },
  ]
  assert.deepEqual(strayProcesses(root, list, { selfPid: 1 }).map((p) => p.pid), [10, 11, 12])
  // path ภาษาไทยของเครื่องพัฒนา (E:\พุทธ) ก็ต้องหาเจอ
  assert.deepEqual(strayProcesses('E:\\พุทธ', [{ pid: 20, name: 'node.exe', cmd: 'node E:\\พุทธ\\pipeline\\2_tts.mjs x' }], { selfPid: 1 }).map((p) => p.pid), [20])
})

test('ระหว่างหยุดทุกอย่าง: ไม่เริ่มขั้นใหม่ของ pipeline', () => {
  let on = true
  const runner = createRunner({ log: () => {}, halted: () => on })
  assert.throws(() => runner.start('timecode', 'x'), /หยุดทุกอย่างไว้อยู่/)
  on = false
  assert.equal(typeof runner.start, 'function')
})

test('runner เรียกสคริปต์ด้วย path เต็ม (ปุ่มหยุดหา process ที่หลุดได้)', () => {
  const src = read('bridge/runner.js')
  assert.doesNotMatch(src, /\['pipeline\//, 'ห้ามเหลือ path สั้น pipeline/...')
  assert.match(src, /const P = \(file\) => join\(ROOT, 'pipeline', file\)/)
})

test('bridge: ระหว่างหยุด ไม่ส่งงานให้แท็บ · งานใหม่ถูกปฏิเสธ · ผลิตต่อเนื่อง/โพสต์อัตโนมัติไม่เริ่มเอง', () => {
  const server = read('bridge/server.js')
  assert.match(server, /if \(halt\?\.on\(\) \|\| !canDispatchJob/)
  assert.match(server, /const pending = halt\.on\(\) \? null/)
  assert.match(server, /if \(halt\?\.on\(\)\) Object\.assign\(job, \{ status: 'error', error: HALTED_MESSAGE/)
  assert.match(read('bridge/production.js'), /if \(!state\.active \|\| halted\(\)\) return/)
  assert.match(read('bridge/posting.js'), /async function tick\(\) \{\n\s+\/\/[^\n]*\n\s+if \(halted\(\)\) return/)
  assert.ok(HALTED_MESSAGE.includes('ทำงานต่อ'))
})

test('ปุ่มหยุดทุกอย่าง: หยุดผลิต + ยกเลิกงานทุกแท็บ + กวาด process ที่หลุด · ปุ่มหยุดคลิปเดิมยังยกเลิกงานในแท็บด้วย', () => {
  const ui = read('bridge/ui.js')
  assert.match(ui, /function stopEverything\(\) \{\n\s+halt\?\.set\(true\)\n\s+production\.stop\(\)\n\s+cancelRun\('หยุดทุกอย่างโดยผู้ใช้', \{ all: true \}\)/)
  assert.match(ui, /killStray\(ROOT, log\)/)
  assert.match(ui, /path === '\/api\/run\/stop'\) \{\n\s+return json\(res, 200, cancelRun\(\)\), true/)
})

test('แผงข้าง: แถบหยุดทุกอย่างบนสุด + สั่งทุกแท็บหยุดทันที', () => {
  const html = read('extension/sidepanel.html')
  assert.ok(html.indexOf('id="haltBar"') < html.indexOf('id="studioHero"'), 'แถบหยุดต้องอยู่บนสุด')
  assert.match(read('extension/sidepanel.js'), /type: 'STOP_ALL_TABS'/)
  assert.match(read('extension/background.js'), /msg\.type === 'STOP_ALL_TABS'/)
})
