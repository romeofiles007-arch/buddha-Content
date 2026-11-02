// เทสต์: งาน Flow เปิดเป็นแท็บในหน้าต่างเดิม ไม่เปิดหน้าต่างใหม่ (ผู้ใช้ 31 ต.ค. 2026: "ให้เปิดเป็นแท็บใหม่นะ")
//   node scripts/test-flow-tab.mjs
// โหลด extension/background.js จริงใน vm พร้อม chrome จำลอง — ไม่เปิดเบราว์เซอร์
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import * as flowNavigation from '../extension/flow-navigation.js'

const EXT = join(fileURLToPath(new URL('..', import.meta.url)), 'extension')
const bgSource = readFileSync(join(EXT, 'background.js'), 'utf8')
const manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'))

let passed = 0
const test = async (name, fn) => {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

/** chrome จำลอง: tabs = [{ id, windowId, url, incognito }] · windows = [{ id, incognito }] · focused = id หน้าต่างล่าสุด */
function makeChrome({ tabs, windows, focused, session = {}, translated = false }) {
  const calls = []
  const rec = (name, value) => (...args) => {
    calls.push([name, ...args])
    return Promise.resolve(typeof value === 'function' ? value(...args) : value)
  }
  const event = () => ({ addListener: () => {}, removeListener: () => {} })
  const onUpdated = {
    addListener: (fn) => queueMicrotask(() => fn(tabs[0]?.id, { status: 'complete' })),
    removeListener: () => {},
  }
  const chrome = {
    runtime: { onInstalled: event(), onStartup: event(), onMessage: event(), getManifest: () => manifest, reload: () => {} },
    alarms: { onAlarm: event(), create: () => {} },
    notifications: { onClicked: event() },
    storage: {
      local: { get: async () => ({}), set: rec('storage.local.set') },
      session: { get: async () => ({ ...session }), set: rec('storage.session.set') },
    },
    sidePanel: { setPanelBehavior: async () => {}, setOptions: rec('sidePanel.setOptions'), open: async () => {} },
    tabs: {
      query: rec('tabs.query', (q) => (q.windowId != null ? tabs.filter((t) => t.windowId === q.windowId) : tabs)),
      update: rec('tabs.update', (id) => tabs.find((t) => t.id === id)),
      create: rec('tabs.create', () => tabs[0]),
      move: rec('tabs.move', (id, { windowId }) => Object.assign(tabs.find((t) => t.id === id), { windowId })),
      sendMessage: rec('tabs.sendMessage', { ok: true }),
      onUpdated,
    },
    windows: {
      create: rec('windows.create', { id: 999 }),
      getAll: rec('windows.getAll', () => windows),
      getLastFocused: rec('windows.getLastFocused', () => windows.find((w) => w.id === focused) ?? null),
      get: rec('windows.get', (id) => windows.find((w) => w.id === id)),
    },
    scripting: { executeScript: rec('scripting.executeScript', [{ result: translated }]) },
  }
  return { chrome, calls }
}

function loadBackground(env) {
  const { chrome, calls } = makeChrome(env)
  const ctx = vm.createContext({ ...flowNavigation, chrome, console: { log() {}, warn() {} }, setTimeout, clearTimeout, queueMicrotask, URL, fetch: async () => ({ ok: false, status: 500 }) })
  vm.runInContext(bgSource.replace(/^import \{[^\n]+\} from '\.\/flow-navigation\.js'\r?\n/m, ''), ctx)
  return { ctx, calls }
}
const names = (calls) => calls.map((c) => c[0])
// ออบเจกต์ที่สร้างใน vm มี prototype ต่างกับของเทสต์ — เทียบผ่าน JSON
const args = (calls, name) => JSON.parse(JSON.stringify(calls.find((c) => c[0] === name)?.slice(1) ?? null))

await test('แท็บ Flow ในหน้าต่างหลัก: ปิดแผงข้างเฉพาะแท็บนี้ ไม่ย้าย ไม่เปิดหน้าต่างใหม่', async () => {
  const tabs = [
    { id: 7, windowId: 1, url: 'https://flow.google.com/' },
    { id: 3, windowId: 1, url: 'https://github.com/' },
  ]
  const { ctx, calls } = loadBackground({ tabs, windows: [{ id: 1 }], focused: 1 })
  await ctx.keepFlowInTab(tabs[0])
  assert.deepEqual(args(calls, 'sidePanel.setOptions'), [{ tabId: 7, enabled: false }])
  assert.ok(!names(calls).includes('tabs.move'))
  assert.ok(!names(calls).includes('windows.create'))
})

await test('แท็บ Flow ที่รุ่นก่อนย้ายไปอยู่หน้าต่างแยก → ย้ายกลับเป็นแท็บท้ายสุดของหน้าต่างที่ใช้ล่าสุด', async () => {
  const tabs = [
    { id: 7, windowId: 2, url: 'https://flow.google.com/' },
    { id: 3, windowId: 1, url: 'https://github.com/' },
    { id: 4, windowId: 5, url: 'https://example.com/' },
  ]
  const { ctx, calls } = loadBackground({ tabs, windows: [{ id: 5 }, { id: 1 }, { id: 2 }], focused: 1 })
  await ctx.keepFlowInTab(tabs[0])
  assert.deepEqual(args(calls, 'tabs.move'), [7, { windowId: 1, index: -1 }])
  assert.ok(!names(calls).includes('windows.create'))
})

await test('หน้าต่างล่าสุดคือหน้าต่างของ Flow เอง → ย้ายไปหน้าต่างปกติอื่น · ไม่มีหน้าต่างอื่น → อยู่ที่เดิม', async () => {
  const tabs = [
    { id: 7, windowId: 2, url: 'https://flow.google.com/' },
    { id: 3, windowId: 1, url: 'https://github.com/' },
  ]
  const a = loadBackground({ tabs, windows: [{ id: 2 }, { id: 1 }], focused: 2 })
  await a.ctx.keepFlowInTab(tabs[0])
  assert.deepEqual(args(a.calls, 'tabs.move'), [7, { windowId: 1, index: -1 }])

  const only = [{ id: 7, windowId: 2, url: 'https://flow.google.com/' }]
  const b = loadBackground({ tabs: only, windows: [{ id: 2 }], focused: 2 })
  await b.ctx.keepFlowInTab(only[0])
  assert.ok(!names(b.calls).includes('tabs.move'))
})

await test('ไม่ย้ายข้ามหน้าต่างไม่ระบุตัวตน (incognito) กับหน้าต่างปกติ', async () => {
  const tabs = [
    { id: 7, windowId: 2, url: 'https://flow.google.com/', incognito: false },
    { id: 3, windowId: 1, url: 'https://github.com/', incognito: true },
  ]
  const { ctx, calls } = loadBackground({ tabs, windows: [{ id: 2 }, { id: 1, incognito: true }], focused: 1 })
  await ctx.keepFlowInTab(tabs[0])
  assert.ok(!names(calls).includes('tabs.move'))
})

await test('งานสร้างภาพ: ปิดแผงข้างก่อนใช้แท็บ Flow เดิม โดยไม่โหลดหน้าแรกทับบัญชีที่เลือก', async () => {
  const tabs = [
    { id: 7, windowId: 1, url: 'https://flow.google.com/' },
    { id: 3, windowId: 1, url: 'https://github.com/' },
  ]
  const { ctx, calls } = loadBackground({ tabs, windows: [{ id: 1 }], focused: 1 })
  await ctx.handleJob({ id: 'j1', agent: 'flow', kind: 'generate-images', payload: { agent: 'flow' } })
  const order = names(calls)
  assert.ok(!order.includes('windows.create'), 'ห้ามเปิดหน้าต่างใหม่')
  const panelOff = order.indexOf('sidePanel.setOptions')
  const load = order.indexOf('tabs.update')
  assert.ok(panelOff >= 0 && load > panelOff, 'ต้องปิดแผงข้างก่อนโหลดหน้า Flow')
  assert.deepEqual(JSON.parse(JSON.stringify(calls[load].slice(1))), [7, { active: true }])
  assert.equal(calls.find((c) => c[0] === 'tabs.sendMessage')[1], 7)
})

await test('ทำต่อ: ใช้แท็บบัญชีใหม่ที่เลือก ไม่กลับแท็บหรือโปรเจกต์ของบัญชีเก่า', async () => {
  const tabs = [
    { id: 7, windowId: 1, url: 'https://flow.google.com/project/old?authuser=0', lastAccessed: 10 },
    { id: 8, windowId: 1, url: 'https://flow.google.com/?authuser=1', active: true, lastAccessed: 20 },
  ]
  const { ctx, calls } = loadBackground({ tabs, windows: [{ id: 1 }], focused: 1, session: { flowTabId: 7 } })
  await ctx.handleJob({ id: 'resume', agent: 'flow', kind: 'generate-images', payload: { projectUrl: tabs[0].url } })
  assert.equal(calls.find(c => c[0] === 'tabs.sendMessage')[1], 8)
  assert.ok(!calls.some(c => c[0] === 'tabs.update' && c[2]?.url))
  assert.ok(calls.some(c => c[0] === 'storage.session.set' && c[1]?.flowTabId === 8))
})
await test('ทำต่อบนหน้าที่แปลอยู่: หยุดพร้อมเหตุผลแทนโหลดบัญชีเก่ากลับมาหรือสั่งสร้างภาพ', async () => {
  const tabs = [{ id: 7, windowId: 1, url: 'https://flow.google.com/?authuser=1', active: true }]
  const { ctx, calls } = loadBackground({ tabs, windows: [{ id: 1 }], focused: 1, translated: true })
  await assert.rejects(ctx.handleJob({ id: 'resume-translated', agent: 'flow', kind: 'generate-images', payload: { projectUrl: 'https://flow.google.com/project/old' } }), /ปิดการแปล/)
  assert.ok(!calls.some(c => c[0] === 'tabs.update' && c[2]?.url))
  assert.ok(!calls.some(c => c[0] === 'tabs.sendMessage'))
})

await test('โค้ดไม่มีการเปิดหน้าต่างใหม่แล้ว · ไม่ขอสิทธิ์อ่านจอ (system.display) ที่ไม่ใช้แล้ว', () => {
  assert.doesNotMatch(bgSource, /chrome\.windows\.create/)
  assert.doesNotMatch(bgSource, /ensureWideFlow|flowWindowBounds/)
  assert.ok(!manifest.permissions.includes('system.display'))
  assert.ok(manifest.permissions.includes('sidePanel'))
})

await test('read-only TikTok inspection preserves the uploaded form; posting always starts fresh', async () => {
  for (const kind of ['tiktok-inspect', 'tiktok-post']) {
    const tabs = [{ id: 7, windowId: 1, url: 'https://www.tiktok.com/tiktokstudio/upload' }]
    const { ctx, calls } = loadBackground({ tabs, windows: [{ id: 1 }], focused: 1 })
    ctx.fetch = async () => ({ ok: true, json: async () => ({}) })
    await ctx.handleJob({ id: 'tk1', agent: 'tiktok', kind, payload: { preserve: true } })
    assert.equal(calls.some(c => c[0] === 'tabs.update' && c[2]?.url), kind === 'tiktok-post')
    if (kind === 'tiktok-inspect') {
      assert.ok(calls.some(c => c[0] === 'scripting.executeScript'), 'inspection reads existing TikTok tabs directly')
      assert.ok(!calls.some(c => c[0] === 'tabs.create'), 'inspection cannot replace a user upload with a new tab')
    }
  }
})

console.log(`\nผ่าน ${passed} ข้อ`)
