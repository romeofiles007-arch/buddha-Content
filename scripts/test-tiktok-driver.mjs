// Execute the production content driver through its runtime listener, without a browser/network.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
const domSource = readFileSync(new URL('../extension/tiktok-dom.js', import.meta.url), 'utf8')
const driverSource = readFileSync(new URL('../extension/content-tiktok.js', import.meta.url), 'utf8')
function fixture({ signedIn = 'romeo', missingPrivacy = false, confirm = true, cancellation = false, cancelDuringAccount = false, resetAi = false, replaceCaption = false, stuckCaption = false, tip = false, stuckTip = false, delayedStudio = false, cdnAvatar = false, studioSwitch = false, ambiguousSwitch = false, aiConsent = false, replacePost = false, processing = false, contentEditable = false, caption = 'คำบรรยาย #ธรรมะ' } = {}) {
  let captionSets = 0, listener, uploads = 0, clicks = 0, progress = 0, accountReads = 0, menuOpen = false, onCancel, rerendered = false, readyChecks = 0
  const results = [], memory = new Map()
  const node = (extra = {}) => ({ textContent: '', getClientRects: () => [{}], getAttribute: () => null, matches: () => false, focus() {}, click() {}, dispatchEvent() {}, ...extra })
  class Textarea { constructor() { this._value = '' } get value() { return this._value } set value(v) { this._value = v } }
  let processingReady = !processing, processingChecks = 0
  const editor = Object.assign(new Textarea(), node({ tagName: 'TEXTAREA', focus(){ if(!processingReady) throw new Error('caption edited before upload processing finished') } }))
  if(contentEditable){editor.tagName='DIV';editor.innerText='';delete editor._value}
  // stuckCaption: the site overwrites whatever is typed (input never takes)
  const replacement = Object.assign(new Textarea(), node({ tagName: 'TEXTAREA', dispatchEvent() { if (stuckCaption) this._value = 'different caption' } })); replacement.value = 'different caption'
  const options = ['Everyone', 'Friends', 'Only you'].map((textContent, i) => node({ textContent, value: ['public', 'friends', 'private'][i] }))
  const privacy = node({ tagName: 'SELECT', value: 'public', options, getAttribute: n => n === 'aria-label' ? 'Who can watch this video' : null })
  Object.defineProperty(privacy, 'selectedOptions', { get: () => options.filter(o => o.value === privacy.value) })
  let consentOpen = false
  const ai = node({ textContent: studioSwitch ? '' : 'AI-generated content', checked: false, closest: () => null, click() { if (aiConsent) consentOpen = true; else this.checked = !this.checked } })
  const consentButton = node({ textContent: 'Turn on', click() { ai.checked = true; consentOpen = false } })
  const consentDialog = node({ textContent: 'Labeling AI-generated content Creators should label content that is completely AI-generated. Not now Turn on', querySelectorAll: () => [consentButton] })
  const aiRow = node({ textContent: 'AI-generated content', querySelectorAll: () => ambiguousSwitch ? [ai, node()] : [ai] })
  const alerts = [], body = { innerText: '' }
  const post = node({ textContent: 'Post', disabled: false, click() { clicks++; if (confirm) { body.innerText = 'Video posted'; alerts.push(node({ innerText: 'Video posted' })) } } })
  const newPost=node({textContent:'Post',disabled:false,click:()=>post.click()})
  // tip: TikTok's "preview on phone … Got it" box over the Post button (stuckTip: it will not close)
  let tipOpen = tip, tipClicks = 0
  const tipButton = node({ textContent: 'เข้าใจแล้ว', disabled: false, click() { tipClicks++; if (!stuckTip) tipOpen = false } })
  let postChanged=false
  let markedProfile = false
  const profile = node({ textContent: 'Profile', getAttribute: n => n === 'href' ? `/@${signedIn}` : null, matches: () => !cdnAvatar || markedProfile, closest: () => null, setAttribute: () => { markedProfile = true } })
  const avatar = node({ click: () => { menuOpen = !menuOpen } })
  const avatarImage = node({ getAttribute: n => n === 'src' ? 'https://p16.tiktokcdn.com/tos-alisg-avt-0068/account.jpeg' : null, closest: () => avatar })
  const document = {
    body,
    // ตัวกันหน้าต่างเลือกไฟล์ของ Windows (content-tiktok.js ติด/ถอดระหว่างทำงาน)
    documentElement: { dataset: {} },
    addEventListener() {},
    removeEventListener() {},
    querySelector: selector => selector.includes('input[type="file"]') ? (++readyChecks >= (delayedStudio ? 2 : 1) ? node() : null) : studioSwitch && selector === '[data-e2e="aigc_container"]' ? aiRow : null,
    querySelectorAll: selector => {
      if (selector === 'a[href*="/@"]') { accountReads++; if(replacePost && accountReads>1){post.isConnected=false;postChanged=true} return (cdnAvatar && !menuOpen) || (delayedStudio && readyChecks < 2) || (cancelDuringAccount && accountReads > 1 && !menuOpen) ? [] : [profile] }
      if (selector.startsWith('[data-e2e="profile-icon"]')) return cdnAvatar ? [] : [avatar]
      if (selector === 'img') return cdnAvatar ? [avatarImage] : []
      if (selector === '[contenteditable="true"], textarea') return [rerendered ? replacement : editor]
      if (selector === 'select, button, [role="combobox"]') return missingPrivacy ? [] : [privacy]
      if (selector.startsWith('label,')) return [ai]
      if (selector.startsWith('button, [role="button"]')) return [postChanged?newPost:post, ...(tipOpen ? [tipButton] : [])]
      if (selector === '[role="dialog"]') return consentOpen ? [consentDialog] : []
      if (selector === '[role="progressbar"]' && processing) {
        processingReady = ++processingChecks >= 2
        return processingReady ? [] : [node({getAttribute:key=>key==='aria-valuenow'?'50':null})]
      }
      if (selector.includes('[role="alert"]')) return alerts
      return []
    },
  }
  const ctx = {
    URL, console, document, location: { href: 'https://www.tiktok.com/tiktokstudio/upload' },
    HTMLTextAreaElement: Textarea, Event: class {},
    sessionStorage: { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) },
    chrome: { runtime: { onMessage: { addListener: fn => { listener = fn } }, sendMessage: async message => { if(message.type==='TIKTOK_SET_CAPTION'){editor.innerText=caption;captionSets++;return {ok:true}} uploads++; return { ok: true } } } },
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
  return { invoke: () => new Promise(resolve => listener(message, {}, resolve)), results, replaced: () => replacement.value, tip: () => ({ open: tipOpen, clicks: tipClicks }), sets: () => captionSets, state: () => ({ uploads, clicks, caption: contentEditable?editor.innerText:editor.value, privacy: privacy.value, aigc: ai.checked }) }
}

test('React-owned caption editors use browser text input without replacing their DOM children',async()=>{
  const f=fixture({contentEditable:true});await f.invoke()
  assert.equal(f.results[0].ok,true,f.results[0].error)
  assert.equal(f.state().caption,'คำบรรยาย #ธรรมะ')
  assert.equal(f.state().clicks,1)
})

test('caption is entered again after processing even when the box already looks right (TikTok posted the file name 7 Nov 2026)',async()=>{
  const f=fixture({contentEditable:true});await f.invoke()
  assert.equal(f.results[0].ok,true,f.results[0].error)
  assert.equal(f.sets(),2,'กรอกครั้งแรก + กรอกซ้ำก่อนกดโพสต์')
  assert.equal(f.state().clicks,1)
})

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
    assert.ok(f.results[0].diagnostic?.controls, 'failed browser posts retain visible control diagnostics for repair')
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
// 2026-11-04: TikTok refilled the caption box with the file name after processing.
test('a caption replaced during upload is re-entered and verified before publishing', async () => {
  const f = fixture({ replaceCaption: true }); await f.invoke()
  assert.equal(f.results[0].ok, true, f.results[0].error)
  assert.equal(f.replaced(), 'คำบรรยาย #ธรรมะ')
  assert.equal(f.state().clicks, 1)
})
// 2026-11-04: a "preview on phone … เข้าใจแล้ว" tip covered Post; the click never reached it.
test('a tip box over the Post button is closed before the single publish click', async () => {
  const f = fixture({ tip: true }); await f.invoke()
  assert.equal(f.results[0].ok, true, f.results[0].error)
  assert.deepEqual(f.tip(), { open: false, clicks: 1 })
  assert.equal(f.state().clicks, 1)
})
test('a tip box that will not close stops before publishing', async () => {
  const f = fixture({ tip: true, stuckTip: true }); await f.invoke()
  assert.equal(f.state().clicks, 0)
  assert.equal(f.results[0].ok, false)
  assert.equal(f.results[0].needsVerification, false)
})
test('a caption that cannot be re-entered never publishes a stale caption', async () => {
  const f = fixture({ replaceCaption: true, stuckCaption: true }); await f.invoke()
  assert.equal(f.state().clicks, 0)
  assert.equal(f.results[0].ok, false)
  assert.match(f.results[0].error, /คำบรรยาย/)
  assert.equal(f.results[0].needsVerification, false)
})

test('a re-rendered publish button is reacquired after the final account check', async()=>{
  const f=fixture({replacePost:true});await f.invoke()
  assert.equal(f.results[0].ok,true)
  assert.equal(f.state().clicks,1)
})

test('caption editing waits for upload processing before touching the editor', async()=>{
  const f=fixture({processing:true});await f.invoke()
  assert.equal(f.results[0].ok,true)
  assert.equal(f.state().clicks,1)
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

test('Studio AI setting locates its unlabeled switch inside the dedicated AIGC row', async () => {
  const f = fixture({ studioSwitch: true }); await f.invoke()
  assert.equal(f.results[0].ok, true)
  assert.equal(f.state().aigc, true)
  assert.equal(f.state().clicks, 1)
})

test('an ambiguous unlabeled AIGC row stops before publication', async () => {
  const f = fixture({ studioSwitch: true, ambiguousSwitch: true }); await f.invoke()
  assert.equal(f.results[0].ok, false)
  assert.equal(f.state().clicks, 0)
  assert.equal(f.results[0].needsVerification, false)
})

test('first-time AI labeling consent is scoped and confirmed before publishing', async () => {
  const f = fixture({ studioSwitch: true, aiConsent: true }); await f.invoke()
  assert.equal(f.results[0].ok, true)
  assert.equal(f.state().aigc, true)
  assert.equal(f.state().clicks, 1)
})
