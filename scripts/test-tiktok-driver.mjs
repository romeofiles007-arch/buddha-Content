// Execute the production content driver through its runtime listener, without a browser/network.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
const domSource = readFileSync(new URL('../extension/tiktok-dom.js', import.meta.url), 'utf8')
const driverSource = readFileSync(new URL('../extension/content-tiktok.js', import.meta.url), 'utf8')
function fixture({ signedIn = 'romeo', missingPrivacy = false, confirm = true, cancellation = false, cancelDuringAccount = false, resetAi = false, replaceCaption = false, delayedStudio = false, cdnAvatar = false, caption = 'คำบรรยาย #ธรรมะ' } = {}) {
  let listener, uploads = 0, clicks = 0, progress = 0, accountReads = 0, menuOpen = false, onCancel, rerendered = false, readyChecks = 0
  const results = [], memory = new Map()
  const node = (extra = {}) => ({ textContent: '', getClientRects: () => [{}], getAttribute: () => null, matches: () => false, focus() {}, click() {}, dispatchEvent() {}, ...extra })
  class Textarea { constructor() { this._value = '' } get value() { return this._value } set value(v) { this._value = v } }
  const editor = Object.assign(new Textarea(), node({ tagName: 'TEXTAREA' }))
  const replacement = Object.assign(new Textarea(), node({ tagName: 'TEXTAREA' })); replacement.value = 'different caption'
  const options = ['Everyone', 'Friends', 'Only you'].map((textContent, i) => node({ textContent, value: ['public', 'friends', 'private'][i] }))
  const privacy = node({ tagName: 'SELECT', value: 'public', options, getAttribute: n => n === 'aria-label' ? 'Who can watch this video' : null })
  Object.defineProperty(privacy, 'selectedOptions', { get: () => options.filter(o => o.value === privacy.value) })
  const ai = node({ textContent: 'AI-generated content', checked: false, click() { this.checked = !this.checked } })
  const alerts = [], body = { innerText: '' }
  const post = node({ textContent: 'Post', disabled: false, click() { clicks++; if (confirm) { body.innerText = 'Video posted'; alerts.push(node({ innerText: 'Video posted' })) } } })
  let markedProfile = false
  const profile = node({ textContent: 'Profile', getAttribute: n => n === 'href' ? `/@${signedIn}` : null, matches: () => !cdnAvatar || markedProfile, closest: () => null, setAttribute: () => { markedProfile = true } })
  const avatar = node({ click: () => { menuOpen = true } })
  const avatarImage = node({ getAttribute: n => n === 'src' ? 'https://p16.tiktokcdn.com/tos-alisg-avt-0068/account.jpeg' : null, closest: () => avatar })
  const document = {
    body,
    querySelector: selector => selector.includes('input[type="file"]') ? (++readyChecks >= (delayedStudio ? 2 : 1) ? node() : null) : null,
    querySelectorAll: selector => {
      if (selector === 'a[href*="/@"]') { accountReads++; return (cdnAvatar && !menuOpen) || (delayedStudio && readyChecks < 2) || (cancelDuringAccount && accountReads > 1 && !menuOpen) ? [] : [profile] }
      if (selector.startsWith('[data-e2e="profile-icon"]')) return cdnAvatar ? [] : [avatar]
      if (selector === 'img') return cdnAvatar ? [avatarImage] : []
      if (selector === '[contenteditable="true"], textarea') return [rerendered ? replacement : editor]
      if (selector === 'select, button, [role="combobox"]') return missingPrivacy ? [] : [privacy]
      if (selector.startsWith('label,')) return [ai]
      if (selector === 'button, [role="button"]') return [post]
      if (selector.includes('[role="alert"]')) return alerts
      return []
    },
  }
  const ctx = {
    URL, console, document, location: { href: 'https://www.tiktok.com/tiktokstudio/upload' },
    HTMLTextAreaElement: Textarea, Event: class {},
    sessionStorage: { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) },
    chrome: { runtime: { onMessage: { addListener: fn => { listener = fn } }, sendMessage: async () => { uploads++; return { ok: true } } } },
    bridgeHelpers: {
      heartbeat: (_id, cancel) => { onCancel = cancel; return () => {} }, sleep: async () => { if (cancelDuringAccount) onCancel() },
      waitFor: async (fn, { label }) => { for (let i = 0; i < 3; i++) { const value = await fn(); if (value) { if (cancelDuringAccount && label === 'ชื่อบัญชี TikTok') onCancel(); if (label === 'TikTok อัปโหลดเสร็จและพร้อมโพสต์') { if (resetAi) ai.checked = false; if (replaceCaption) rerendered = true } return value } } throw new Error(`รอ ${label} เกินเวลา`) },
      toBridge: async (type, body) => {
        if (type === 'RESULT') { results.push(body.meta); return { ok: true } }
        progress++; return { ok: true, status: 'running', cancelled: cancellation && progress > 1 }
      },
    },
  }
  runInNewContext(domSource, ctx)
  runInNewContext(driverSource, ctx)
  const message = { type: 'RUN_JOB', job: { id: 'fixture-job', kind: 'tiktok-post', payload: { username: 'romeo', caption, privacy: 'private', aigc: true } } }
  return { invoke: () => new Promise(resolve => listener(message, {}, resolve)), results, state: () => ({ uploads, clicks, caption: editor.value, privacy: privacy.value, aigc: ai.checked }) }
}

test('full driver uploads, sets caption/visibility/AI, and publishes exactly once', async () => {
  const f = fixture(); await f.invoke()
  assert.deepEqual(f.state(), { uploads: 1, clicks: 1, caption: 'คำบรรยาย #ธรรมะ', privacy: 'private', aigc: true })
  assert.equal(f.results[0].ok, true)
  assert.equal(f.results[0].published, true)
  await f.invoke()
  assert.equal(f.state().clicks, 1)
  assert.equal(f.results[1].needsVerification, true)
})
test('full driver refuses a wrong account before uploading', async () => {
  const f = fixture({ signedIn: 'other' }); await f.invoke()
  assert.equal(f.state().uploads, 0); assert.equal(f.state().clicks, 0)
  assert.match(f.results[0].error, /ไม่ตรง/)
  assert.equal(f.results[0].needsVerification, false)
})
test('missing visibility controls and cancellation prevent the publish action', async () => {
  for (const args of [{ missingPrivacy: true }, { cancellation: true }]) {
    const f = fixture(args); await f.invoke()
    assert.equal(f.state().clicks, 0)
    assert.equal(f.results[0].ok, false)
    assert.equal(f.results[0].needsVerification, false)
  }
})
test('losing confirmation after one publish produces an uncertain result, never another click', async () => {
  const f = fixture({ confirm: false }); await f.invoke()
  assert.equal(f.state().clicks, 1)
  assert.equal(f.results[0].ok, false)
  assert.equal(f.results[0].needsVerification, true)
})
test('a changed AI disclosure stops publishing, and success words in the caption never confirm it', async () => {
  const changed = fixture({ resetAi: true }); await changed.invoke()
  assert.equal(changed.state().clicks, 0)
  const caption = fixture({ confirm: false, caption: 'Video posted' }); await caption.invoke()
  assert.equal(caption.results[0].published, undefined)
  assert.equal(caption.results[0].needsVerification, true)
})
test('cancellation during the final account menu read prevents publishing', async () => {
  const f = fixture({ cancelDuringAccount: true }); await f.invoke()
  assert.equal(f.state().clicks, 0)
  assert.match(f.results[0].error, /ยกเลิก/)
  assert.equal(f.results[0].needsVerification, false)
})
test('replacing the caption editor during upload cannot publish a stale caption', async () => {
  const f = fixture({ replaceCaption: true }); await f.invoke()
  assert.equal(f.state().clicks, 0)
  assert.equal(f.results[0].needsVerification, false)
})
test('account detection waits until TikTok Studio has finished rendering its uploader', async () => {
  const f = fixture({ delayedStudio: true }); await f.invoke()
  assert.equal(f.results[0].ok, true)
  assert.equal(f.state().clicks, 1)
})
test('the current Studio avatar opens its own account menu before identity verification', async () => {
  const f = fixture({ cdnAvatar: true }); await f.invoke()
  assert.equal(f.results[0].ok, true)
  assert.equal(f.state().clicks, 1)
})
