// เทสต์: กด "ตรวจอัปเดต" แล้วเห็นว่าเครื่องนี้เป็นรุ่นไหน + เห็นเมื่อ extension ตัวใหม่มาแล้วแต่ Chrome ยังไม่โหลด
//   node scripts/test-update-version.mjs
// ไม่เปิดเบราว์เซอร์ / ไม่ต่อ GitHub — สร้างโฟลเดอร์จำลองใน temp แล้วเรียก installedVersion ตรงๆ
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { installedVersion } from '../bridge/ui.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
let passed = 0
const test = (name, fn) => {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

function fakeInstall({ version, manifest = '9.9.9' }) {
  const dir = mkdtempSync(join(tmpdir(), 'dhamma-ver-'))
  mkdirSync(join(dir, 'extension'))
  writeFileSync(join(dir, 'extension', 'manifest.json'), JSON.stringify({ version: manifest }))
  if (version) writeFileSync(join(dir, 'VERSION.json'), JSON.stringify(version))
  return dir
}

test('ติดตั้งจาก ZIP แล้วอัปเดตในโปรแกรม: บอก commit จาก VERSION.json + version ของ extension บนดิสก์', () => {
  const dir = fakeInstall({ version: { commit: '893286a', sha: '893286a1234567890abcdef1234567890abcdef0', repo: 'https://github.com/x/y' }, manifest: '1.0.3' })
  try {
    assert.deepEqual(installedVersion(dir), { commit: '893286a', extension: '1.0.3' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ติดตั้งจาก ZIP ยังไม่เคยอัปเดต (commit unknown): ไม่เดารุ่น', () => {
  const dir = fakeInstall({ version: { commit: 'unknown', sha: null, repo: 'https://github.com/x/y' } })
  try {
    assert.deepEqual(installedVersion(dir), { commit: null, extension: '9.9.9' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ไม่มี VERSION.json / manifest อ่านไม่ได้: คืน null ไม่ล้ม', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dhamma-ver-'))
  try {
    assert.deepEqual(installedVersion(dir), { commit: null, extension: null })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('โฟลเดอร์ git (เครื่องนี้): commit = HEAD และ extension = manifest จริง', () => {
  const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  const ext = JSON.parse(readFileSync(join(ROOT, 'extension', 'manifest.json'), 'utf8')).version
  assert.deepEqual(installedVersion(ROOT), { commit: head, extension: ext })
})

test('แผงข้าง: มีปุ่มโหลดตัวใหม่ · เทียบ version บนดิสก์กับตัวที่ Chrome รัน · ตรวจแล้วบอกรุ่น', () => {
  const html = readFileSync(join(ROOT, 'extension', 'sidepanel.html'), 'utf8')
  const js = readFileSync(join(ROOT, 'extension', 'sidepanel.js'), 'utf8')
  assert.match(html, /id="reloadExt"/)
  assert.match(js, /installed\.extension !== running/)
  assert.match(js, /\$\('reloadExt'\)\.addEventListener\('click'[\s\S]{0,200}if \(busy \|\| localBusy\(\)\) return[\s\S]{0,300}chrome\.runtime\.reload\(\)/)
  assert.match(js, /เป็นรุ่นล่าสุดแล้ว ✓\$\{where\}/)
})

console.log(`\nผ่าน ${passed} ข้อ`)
