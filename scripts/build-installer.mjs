#!/usr/bin/env node
/**
 * สร้างไฟล์ติดตั้งสำหรับลูกค้า: dist/DhammaAuto-Setup-<version>.exe
 *
 *   node scripts/build-installer.mjs
 *
 * 1. สร้างแพ็กเกจด้วย build-package.mjs (โค้ด + node + ffmpeg + Python/เสียง Edge · ตรวจว่าไม่มี key ของเราติดไป)
 * 2. ห่อเป็น Setup.exe ด้วย Inno Setup (installer/DhammaAuto.iss)
 * เลขรุ่นมาจาก extension/manifest.json
 *
 * ต้องมี Inno Setup 6: winget install --id JRSoftware.InnoSetup -e --scope user
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../pipeline/lib/config.mjs'

const iscc = [
  join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Inno Setup 6', 'ISCC.exe'),
  join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Inno Setup 6', 'ISCC.exe'),
].find((p) => existsSync(p))
if (!iscc) throw new Error('ไม่พบ Inno Setup 6 — winget install --id JRSoftware.InnoSetup -e --scope user')

const version = JSON.parse(readFileSync(join(ROOT, 'extension', 'manifest.json'), 'utf8')).version

console.log('▸ สร้างแพ็กเกจ')
execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-package.mjs')], { cwd: ROOT, stdio: 'inherit' })

console.log(`\n▸ ห่อเป็น Setup.exe (รุ่น ${version}) — บีบอัดนานหลายนาที`)
execFileSync(iscc, [`/DAppVer=${version}`, '/Q', join(ROOT, 'installer', 'DhammaAuto.iss')], { cwd: join(ROOT, 'installer'), stdio: 'inherit' })

const out = join(ROOT, 'dist', `DhammaAuto-Setup-${version}.exe`)
console.log(`\n✅ ${out} (${(statSync(out).size / 1048576).toFixed(0)} MB)`)
console.log('ส่งไฟล์นี้ไฟล์เดียวให้ลูกค้า — ดับเบิลคลิก ถัดไป → ติดตั้ง แล้วทำ Load unpacked ใน Chrome ตามหน้าจบ')
