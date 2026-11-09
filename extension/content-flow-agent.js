(() => {
if (globalThis.__cartoon_flow_agent) return // ฉีดซ้ำ → ไม่เพิ่ม listener ซ้ำ
globalThis.__cartoon_flow_agent = true

/**
 * ขับ Google Flow (flow.google.com) แบบ Agent — ตรวจกับหน้าเว็บจริงแล้ว (ก.ย. 2026)
 *
 *   1. เปิด/สร้าง project
 *   2. ตั้งช่องพิมพ์ปกติเป็น Image · 16:9 หรือ 9:16 · Nano Banana 2 Lite · x1 แล้วอ่าน "Generating will use N credits"
 *      ถ้าไม่ใช่ 0 credits → หยุดทันที ไม่เปิดอะไรต่อ
 *   3. เปิด Agent → Agent settings: ตั้ง Image default ชุดเดียวกัน + Confirm before generating = Never → Save
 *   4. วาง prompt (Style Bible + Character Bible + Shot List) แล้วกด Enter
 *
 * ข้อความที่แผงข้างส่งมา:
 *   FLOW_AGENT_RUN  { prompt, expected, model, dryRun }  → { ok, credits, projectUrl }
 *   FLOW_AGENT_STATUS                                    → { ok, images, busy }
 *   FLOW_AGENT_RENAME { prompt }                         → { ok, names }   สั่ง agent ตั้งชื่อ "00_00_00.png SHOT 01"
 *   FLOW_AGENT_LIST                                      → { ok, images: [{ id, name, filename }] }
 *   FLOW_AGENT_IMAGE  { id }                             → { ok, base64 (PNG), width, height }
 */
const VERSION = chrome.runtime.getManifest().version
// flow-text.js โหลดก่อนไฟล์นี้ (manifest + CONTENT_FILES ใน background.js) — เทียบชื่อรุ่นไม่สนภาษา · ปิดเมนู · ตรวจหน้าที่ถูกแปล
const { sameModel, labelText, pageTranslated, TRANSLATED_HINT, escapeMenus, strayMenu } = globalThis.CartoonFlowText
/** ข้อความ error ที่ส่งกลับ — หน้าถูก Chrome แปลอยู่ให้บอกสาเหตุนี้ก่อน เพราะเป็นต้นเหตุที่ทำให้หาปุ่มไม่เจอ */
const errorText = (err) => `[extension ${VERSION}] ${pageTranslated() ? `${TRANSLATED_HINT} · ` : ''}${err.message}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const FLOW_PROMPT_GAP_MS = 2 * 60_000 // เว้นอย่างน้อย 2 นาทีระหว่างคำสั่งที่ส่งให้ Flow
const FLOW_LAST_PROMPT_KEY = 'flowLastPromptAt'
const Q = globalThis.DhammaFlowQuota
let expectedAccount = ''
const accountEmail = () => Q.emailOf(Q.profileLabel(document))
async function verifiedAccountEmail() {
  let detail = ''
  for (let attempt = 0; attempt < 10; attempt++) {
    // รอบสุดท้ายขอรายละเอียดว่าเห็นอะไรบนหน้า — ใช้แก้ตอนหน้า Flow เปลี่ยน
    const result = await chrome.runtime.sendMessage({ type: 'FLOW_ACCOUNT_IDENTITY', diagnose: attempt === 9 })
    if (result?.ok && result.email) return result.email
    if (result?.error) { detail = ` (${result.error})`; break }
    await sleep(1000)
  }
  throw new Error(`FLOW_ACCOUNTS_EXHAUSTED: อ่านบัญชี Google Flow ปัจจุบันไม่ได้ — หยุดก่อนสร้างภาพ${detail}`)
}
class FlowQuotaError extends Error {
  constructor(quota) { super(quota.reason); this.quota = quota }
}
function checkAccountQuota() {
  const email = accountEmail() || expectedAccount
  if (expectedAccount && !Q.sameAccount(email, expectedAccount)) throw new Error('FLOW_ACCOUNTS_EXHAUSTED: บัญชี Flow เปลี่ยนระหว่างทำงาน — หยุดก่อนส่งคำสั่งสร้างภาพ')
  const lines = [
    ...$$('[role="alert"], flow-error-tile, mat-snack-bar-container').filter(visible).map(el => el.innerText ?? ''),
    ...(SEL.agentPanel()?.innerText ?? '').split('\n').filter(s => /^\s*(?:you|daily |free |image |video |generation |usage |limit |คุณ|ใช้โควต้า|ถึงขีดจำกัด)/i.test(s)),
  ]
  const quota = lines.map(s => Q.quotaNotice(s)).find(Boolean)
  if (quota) {
    if (!email) throw new Error('FLOW_ACCOUNTS_EXHAUSTED: Flow แจ้งลิมิตแต่อ่านบัญชีปัจจุบันไม่ได้ — กรุณาตรวจหน้า Flow')
    throw new FlowQuotaError({ ...quota, email })
  }
}

async function waitBeforeNextPrompt() {
  // เก็บเวลาใน storage.local เพื่อคงระยะห่างแม้ Flow โหลดหน้าใหม่หรือ service worker เริ่มใหม่
  const saved = await chrome.storage.local.get(FLOW_LAST_PROMPT_KEY)
  const last = Number(saved[FLOW_LAST_PROMPT_KEY]) || 0
  const remaining = Math.min(FLOW_PROMPT_GAP_MS, Math.max(0, last + FLOW_PROMPT_GAP_MS - Date.now()))
  if (remaining) await sleep(remaining)
}

async function waitFor(fn, { timeout = 20_000, interval = 250, label = 'หน้าเว็บ' } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    if (jobCancelled) throw new JobCancelled() // กดหยุดแล้ว — เลิกทันทีแม้อยู่ระหว่างรอนาน
    if (running && expectedAccount) checkAccountQuota()
    const value = fn()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`รอ ${label} ไม่เจอ (${Math.round(timeout / 1000)} วิ) — หน้า Google Flow อาจเปลี่ยน`)
    await sleep(interval)
  }
}

/** คลิกแบบคนจริง — ปุ่ม Material บางตัว (เช่น Settings ของ Agent) ไม่รับ .click() เปล่าๆ */
function realClick(el) {
  el.scrollIntoView({ block: 'center' })
  const r = el.getBoundingClientRect()
  const opts = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 }
  el.dispatchEvent(new PointerEvent('pointerdown', opts))
  el.dispatchEvent(new MouseEvent('mousedown', opts))
  el.dispatchEvent(new PointerEvent('pointerup', opts))
  el.dispatchEvent(new MouseEvent('mouseup', opts))
  el.dispatchEvent(new MouseEvent('click', opts))
}

/** ส่ง Enter ให้ช่อง prompt ผ่านอินพุตของเบราว์เซอร์ หลังตรวจว่าข้อความและปุ่มส่งพร้อมแล้ว */
async function trustedEnter(editor, prompt) {
  editor.scrollIntoView({ block: 'center' })
  editor.focus()
  await sleep(150)
  if (document.activeElement !== editor) throw new Error('โฟกัสช่อง prompt ของ Flow ไม่ได้')
  if (text(editor) !== String(prompt).replace(/\s+/g, ' ').trim()) throw new Error('ข้อความในช่อง prompt เปลี่ยนก่อนกด Enter — ยังไม่ได้ส่ง')
  const result = await chrome.runtime.sendMessage({ type: 'FLOW_TRUSTED_ENTER' })
  if (!result?.ok) throw new Error(`กด Enter เพื่อส่ง prompt ไม่สำเร็จ: ${result?.error ?? 'ไม่มีคำตอบจาก service worker'}`)
}

const text = (el) => (el?.innerText ?? '').replace(/\s+/g, ' ').trim()
const visible = (el) => !!el && el.getBoundingClientRect().width > 0
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

/**
 * ข้อความบนหน้า Flow ทั้งภาษาอังกฤษและไทย — บัญชีที่ตั้งภาษาไทย Flow จะเป็นภาษาไทยทั้งหน้า
 * (background เปิดด้วย ?hl=en อยู่แล้ว ชุดภาษาไทยเป็นตัวสำรองเมื่อหน้าเปลี่ยนภาษาเอง) — คำไทยตรวจกับหน้าจริงแล้ว (ก.ย. 2026)
 */
const L = {
  newProject: /new project|โปรเจ็กต์ใหม่/i,
  settingsTrigger: ['Settings trigger', 'ทริกเกอร์การตั้งค่า'],
  agentSettings: ['Settings', 'การตั้งค่า'],
  send: ['Start generation', 'เริ่มสร้าง'],
  close: ['Close', 'ปิด'],
  back: ['Back', 'กลับ'],
  stop: ['Stop', 'หยุด', 'หยุดสร้าง'],
  save: ['Save', 'บันทึก'],
  image: ['Image', 'รูปภาพ'],
  modelFamily: ['Select model family', 'เลือกกลุ่มผลิตภัณฑ์โมเดล'],
  agentImageModel: ['Image generation default model', 'โมเดลเริ่มต้นของการสร้างรูปภาพ'],
  editableText: ['Editable text', 'ข้อความที่แก้ไขได้'],
  creditsPane: /Generating will use|การสร้างจะใช้/i,
  credits: /(?:Generating will use|การสร้างจะใช้)\s*(\d+)\s*(?:credits?|เครดิต)/i,
  imageDefault: /Image generation default|ค่าเริ่มต้นสำหรับการสร้างรูปภาพ/,
  videoDefault: /Video generation default|ค่าเริ่มต้นของการสร้างวิดีโอ/,
  never: /^(Never|ไม่เลย)/,
  failedTile: /failed to generate|Something went wrong|สร้างไม่สำเร็จ|สร้างไม่ได้|เกิดข้อผิดพลาด/i,
  highDemand: /experiencing high demand|มีผู้ใช้งานจำนวนมาก|มีความต้องการสูง/gi,
}
/** ปุ่มที่ aria-label ตรงกับคำใดคำหนึ่งในรายการ (อังกฤษ/ไทย) */
const byAria = (labels, root = document, tag = 'button') => $$(tag, root).filter((b) => labels.includes(b.getAttribute('aria-label')))
/** ข้อความท้ายปุ่มตรงกับคำใดคำหนึ่ง เช่น "image รูปภาพ" → "รูปภาพ" */
const lastWordIs = (el, labels) => [labels].flat().includes(text(el).split(' ').pop())

const SEL = {
  newProject: () => $$('button').find((b) => L.newProject.test(text(b)) && visible(b)),
  agentChip: () => document.querySelector('button.agent-mode-chip'),
  settingsTrigger: () => byAria(L.settingsTrigger).find(visible),
  // ต.ค. 2026 หัวหน้า project มีปุ่มเฟือง "Settings/การตั้งค่า" (View mode · Grid size) เพิ่มมาชื่อซ้ำกัน และอยู่ก่อนใน DOM
  // → เจาะจงปุ่มในช่องพิมพ์ (ไอคอน tune) ไม่งั้นไปเปิดแผงผิดแล้วรอ Agent settings จนหมดเวลา
  agentSettings: () => {
    const btns = byAria(L.agentSettings).filter(visible)
    return btns.find((b) => b.closest('flow-base-prompt-box, flow-creative-agent-prompt-box, flow-prompt-box')) ?? btns.find((b) => text(b) === 'tune')
  },
  agentPanel: () => document.querySelector('flow-agent-panel'),
  editor: () => $$('flow-prompt-box .ProseMirror, flow-base-prompt-box .ProseMirror').find(visible) ?? $$('.ProseMirror[contenteditable="true"]').find(visible),
  send: () => byAria(L.send).find(visible),
}

const agentOn = () => SEL.agentChip()?.getAttribute('aria-pressed') === 'true'

/**
 * เปิด/ปิดโหมด Agent แล้วตรวจผล — ปุ่มถูกวาดใหม่ทุกครั้งที่สลับ (element เปลี่ยนตัว)
 * ลำดับ pointer+mouse event บางครั้งไม่ติด ส่วน .click() บางครั้งไม่ติด → สลับวิธีแล้วลองซ้ำ
 */
/**
 * ปุ่ม Agent ในช่องพิมพ์ — Flow ซ่อนปุ่มนี้เมื่อหน้ากว้างไม่ถึง ~1000px (หน้าแบบมือถือ เช่นแผงข้างของ Chrome บีบแท็บ)
 * หน้าแคบ → ขอ background ซูมแท็บ Flow ออก (แท็บนี้แท็บเดียว) หน้าเลยกว้างพอ ไม่ต้องให้ผู้ใช้ปิดแผงข้างเอง
 */
async function agentChip() {
  const find = () => (visible(SEL.agentChip()) ? SEL.agentChip() : null)
  if (!find() && window.innerWidth < 1000) await chrome.runtime.sendMessage({ type: 'FLOW_WIDEN' }).catch(() => null)
  try {
    return await waitFor(find, { label: 'ปุ่ม Agent' })
  } catch (err) {
    if (window.innerWidth < 1000) {
      throw new Error(`หน้า Google Flow แคบเกินไป (${window.innerWidth}px) ซูมหน้าออกแล้วยังไม่พอ Flow จึงซ่อนปุ่ม Agent — ปิดแผงข้างของ Chrome บนแท็บ Flow หรือขยายหน้าต่าง Chrome ให้กว้างขึ้น แล้วกดทำต่อ`)
    }
    throw err
  }
}

async function setAgent(on) {
  for (let attempt = 0; attempt < 6 && agentOn() !== on; attempt++) {
    const chip = await agentChip()
    if (attempt % 2 === 0) chip.click()
    else realClick(chip)
    await waitFor(() => agentOn() === on, { timeout: 2500, label: 'สลับโหมด Agent' }).catch(() => null)
    await sleep(300)
  }
  if (agentOn() !== on) throw new Error(`${on ? 'เปิด' : 'ปิด'}โหมด Agent ไม่สำเร็จ — กดปุ่ม Agent ในช่องพิมพ์ของ Flow เองแล้วสั่งใหม่`)
}

/** ปุ่มตัวเลือกใน toggle group — จับจากข้อความท้ายปุ่ม เช่น "16:9", "x1", "Image" */
function toggle(root, label) {
  return $$('button[role="radio"]', root).find((b) => text(b).split(' ').pop() === label || text(b).endsWith(label))
}

async function choose(root, label) {
  const btn = await waitFor(() => toggle(root, label), { label: `ตัวเลือก ${label}` })
  if (btn.getAttribute('aria-checked') !== 'true') {
    realClick(btn)
    await sleep(300)
  }
}

const menuItems = () => $$('[role="menuitem"]').filter(visible)

/**
 * ก่อนเปิดเมนูโมเดล: มีเมนูอื่นค้างอยู่ (เมนูของภาพ · ตัวเลือกสื่อ ไม่ใช่รายการรุ่น) → ปิดด้วย Escape แล้วทำต่อ
 * ไม่กดรายการใดในเมนูนั้น และไม่หยุดทั้งงาน (เจอจริงที่ Ebook Plus 0.2.5: หยุดทั้งงานเพราะเมนูค้าง)
 * ส่ง Escape ให้ตัวเมนูก่อน ไม่กด backdrop — กันไปปิดแผงตั้งค่าที่กำลังใช้อยู่
 */
async function closeStrayMenus() {
  if (!strayMenu(menuItems().map(labelText))) return
  escapeMenus(document, { documentToo: false, backdrop: false })
  const closed = await waitFor(() => !menuItems().length, { timeout: 1500, label: 'ปิดเมนูที่ค้าง' }).catch(() => false)
  if (!closed) {
    escapeMenus(document, { backdrop: false })
    await waitFor(() => !menuItems().length, { timeout: 1500, label: 'ปิดเมนูที่ค้าง' }).catch(() => null)
  }
}

/** เปิดเมนูรุ่นแล้วกดรุ่นที่ต้องการ — เทียบชื่อแบบไม่สนภาษาแต่ทั้งคำ ไม่เจอ → ปิดเมนู ไม่กดอะไร (ลองรอบถัดไป) */
async function pickModelFromMenu(modelBtn, model) {
  await closeStrayMenus()
  realClick(modelBtn)
  const item = await waitFor(() => menuItems().find((m) => sameModel(labelText(m), model)), {
    timeout: 5000,
    label: `เมนูโมเดล ${model}`,
  }).catch(() => null)
  if (item) realClick(item)
  else escapeMenus(document, { backdrop: false }) // เมนูไม่เปิด/ถูกวาดทับ/ไม่มีรุ่นนี้ → ปิดแล้วลองรอบใหม่
  await sleep(700)
}

async function openProject() {
  if (/\/project\//.test(location.pathname)) return
  const btn = await waitFor(SEL.newProject, { timeout: 30_000, label: 'ปุ่ม New project / โปรเจ็กต์ใหม่' })
  realClick(btn)
  await waitFor(() => /\/project\//.test(location.pathname), { timeout: 30_000, label: 'project ใหม่' })
  await waitFor(SEL.editor, { timeout: 30_000, label: 'ช่องพิมพ์ของ project' })
}

/** ช่องพิมพ์ปกติ (ไม่ใช่ agent) มีตัวบอกจำนวน credit — ใช้ตรวจว่าชุดนี้ฟรีจริงก่อนให้ agent ใช้ */
async function verifyFreeSettings(model, ratio = "16:9") {
  // project ใหม่ของ Flow (ก.ย. 2026) เปิดแชต Agent ด้านขวาเอง → ช่องพิมพ์ปกติที่มีปุ่ม Agent/ตัวเลือกโมเดลถูกซ่อน → ปิดแชตก่อน
  const chatPanel = SEL.agentPanel()
  if (visible(chatPanel) && !SEL.settingsTrigger() && !visible(SEL.agentChip())) {
    const close = byAria(L.close, chatPanel).find(visible)
    if (close) {
      realClick(close)
      await waitFor(() => visible(SEL.agentChip()), { timeout: 10_000, label: 'ช่องพิมพ์หลังปิดแชต Agent' })
      await sleep(500)
    }
  }
  await setAgent(false)
  await waitFor(SEL.settingsTrigger, { label: 'ปุ่มตั้งค่าโมเดล' })

  // แผงตั้งค่าโมเดลวาดใหม่ทุกครั้งที่เปลี่ยนตัวเลือก (เช่น Video → Image) → ห้ามเก็บ element ไว้ใช้ซ้ำ ต้อง query ใหม่ทุกครั้ง
  const pane = () => $$('.cdk-overlay-pane').find((p) => visible(p) && L.creditsPane.test(text(p)))
  const readPane = () => {
    const p = pane()
    if (!p) return null
    const on = (label) => $$('button[role="radio"]', p).find((b) => lastWordIs(b, label))?.getAttribute('aria-checked') === 'true'
    const modelBtn = byAria(L.modelFamily, p)[0]
    return {
      modelBtn,
      state: {
        image: on(L.image),
        ratio: on(ratio),
        x1: on('x1'),
        model: labelText(modelBtn).replace(/arrow_drop_down/, '').replace(/^\S+\s/, '').trim(),
        sameModel: sameModel(labelText(modelBtn), model),
      },
      credits: Number((L.credits.exec(text(p)) ?? [])[1]),
    }
  }
  // ชื่อรุ่นเทียบไม่สนภาษา (หน้าแปลแล้วเป็น "นาโน บานานา 2 Lite") — ตัวตรวจ 0 credits ด้านล่างยังเป็นด่านสุดท้ายเสมอ
  const ready = (st) => st.image && st.ratio && st.x1 && st.sameModel

  let cur = null
  for (let attempt = 1; attempt <= 4; attempt++) {
    if (!pane()) {
      realClick(await waitFor(SEL.settingsTrigger, { label: 'ปุ่มตั้งค่าโมเดล' }))
      await waitFor(pane, { label: 'หน้าตั้งค่าโมเดล' })
      await sleep(400)
    }
    cur = readPane()
    if (cur && ready(cur.state)) break
    for (const label of [L.image, ratio]) {
      const btn = $$('button[role="radio"]', pane() ?? document).find((b) => lastWordIs(b, label))
      if (btn && btn.getAttribute('aria-checked') !== 'true') {
        realClick(btn)
        await sleep(600) // Image/Video สลับแล้วแผงวาดตัวเลือกโมเดลใหม่
      }
    }
    cur = readPane()
    if (cur?.modelBtn && !cur.state.sameModel) await pickModelFromMenu(cur.modelBtn, model)
    const x1 = $$('button[role="radio"]', pane() ?? document).find((b) => text(b).split(' ').pop() === 'x1')
    if (x1 && x1.getAttribute('aria-checked') !== 'true') {
      realClick(x1)
      await sleep(500)
    }
    cur = readPane()
    if (cur && ready(cur.state)) break
    if (attempt === 4) {
      const st = cur?.state ?? {}
      throw new Error(`ตั้งโมเดลในช่องพิมพ์ของ Flow ไม่สำเร็จ (ตอนนี้: ${st.image ? 'Image' : 'ไม่ใช่ Image'} · ${st.model || '?'} · ${st.x1 ? 'x1' : 'ไม่ใช่ x1'})`)
    }
  }
  await sleep(500)
  const credits = readPane()?.credits
  // ปิดแผงตั้งค่า: Escape ถึงตัวเมนู + document + backdrop · ยังไม่ปิดลองอีกครั้ง ไม่หยุดงานเพราะเรื่องนี้
  for (let i = 0; i < 2 && pane(); i++) {
    escapeMenus()
    await waitFor(() => !pane(), { timeout: 1500, label: 'ปิดแผงตั้งค่า' }).catch(() => null)
  }
  await sleep(400)
  return credits
}

/** รอจน DOM ของ element หยุดเปลี่ยน — แผง Agent settings โหลดค่าที่บันทึกไว้จาก server แล้ววาดใหม่หลังเปิดไม่กี่ร้อยมิลลิวินาที */
async function waitSettled(getRoot, { quietMs = 1200, timeout = 15_000 } = {}) {
  const deadline = Date.now() + timeout
  let last = ''
  let since = Date.now()
  while (Date.now() < deadline) {
    const root = getRoot()
    const snapshot = root ? root.innerHTML.length + '|' + $$('[aria-checked="true"], input:checked', root).length + '|' + text(root) : ''
    if (snapshot !== last) {
      last = snapshot
      since = Date.now()
    } else if (root && Date.now() - since >= quietMs) return root
    await sleep(200)
  }
  return getRoot()
}

async function configureAgent(model, { dryRun, ratio = "16:9" }) {
  await setAgent(true)
  const openPanel = () => (visible(SEL.agentPanel()) && L.imageDefault.test(text(SEL.agentPanel())) ? SEL.agentPanel() : null)
  if (!openPanel()) realClick(await waitFor(SEL.agentSettings, { label: 'ปุ่ม Settings ของ Agent' }))
  await waitFor(openPanel, { label: 'Agent settings' })
  await waitSettled(openPanel)

  // ทุกครั้งต้อง query ใหม่ — แผงวาดใหม่แล้ว element เดิมหลุดจากหน้า คลิกไปก็ไม่มีผล
  const read = () => {
    const panel = openPanel()
    if (!panel) return null
    const labels = $$('.settings-section-label', panel)
    const imageLabel = labels.find((l) => L.imageDefault.test(text(l)))
    const videoLabel = labels.find((l) => L.videoDefault.test(text(l)))
    const inImage = (el) =>
      imageLabel && imageLabel.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING &&
      (!videoLabel || videoLabel.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)
    const imageButtons = $$('button[role="radio"]', panel).filter(inImage)
    const never = $$('mat-radio-button', panel).find((r) => L.never.test(text(r)))
    const modelBtn = byAria(L.agentImageModel, panel)[0]
    const checked = (re) => text(imageButtons.find((b) => b.getAttribute('aria-checked') === 'true' && re.test(text(b)))).split(' ').pop()
    return {
      panel,
      imageButtons,
      neverInput: never?.querySelector('input[type="radio"]'),
      modelBtn,
      state: {
        confirm: never?.querySelector('input')?.checked ? 'Never' : 'Always',
        ratio: checked(/:/),
        count: checked(/(^|\s)x\d$/),
        model: labelText(modelBtn).replace(/arrow_drop_down/, '').replace(/^\S+\s/, '').trim(),
        sameModel: sameModel(labelText(modelBtn), model),
      },
    }
  }
  const ok = (st) => st.confirm === 'Never' && st.ratio === ratio && st.count === 'x1' && st.sameModel

  for (let attempt = 1; attempt <= 4; attempt++) {
    let cur = read()
    if (!cur) throw new Error('แผง Agent settings ปิดไปเอง')
    if (ok(cur.state)) break

    // Confirm before generating = Never → agent สร้างภาพต่อเนื่องเองโดยไม่ต้องรอกดยืนยันทีละชุด
    if (cur.state.confirm !== 'Never' && cur.neverInput) {
      realClick(cur.neverInput)
      await sleep(400)
    }
    for (const label of [ratio, 'x1']) {
      cur = read()
      const btn = cur?.imageButtons.find((b) => text(b).split(' ').pop() === label)
      if (!btn) throw new Error(`ไม่พบตัวเลือก ${label} ใน Agent settings`)
      if (btn.getAttribute('aria-checked') !== 'true') {
        realClick(btn)
        await sleep(400)
      }
    }
    cur = read()
    if (cur?.modelBtn && !cur.state.sameModel) await pickModelFromMenu(cur.modelBtn, model)
    await waitSettled(openPanel, { quietMs: 600, timeout: 5000 })
    if (attempt === 4 && !ok(read()?.state ?? {})) {
      const st = read()?.state ?? {}
      throw new Error(`ตั้ง Agent settings ไม่สำเร็จ (ตอนนี้: ${st.confirm} · ${st.ratio} · ${st.count} · ${st.model}) — ตั้งเองในแผง Agent settings เป็น Never · ${ratio} · x1 · ${model} แล้วกด Save แล้วสั่งใหม่`)
    }
  }

  const final = read()
  const summary = final.state
  if (dryRun) {
    realClick(byAria(L.back, final.panel)[0])
  } else {
    realClick(await waitFor(() => $$('button', openPanel() ?? document).find((b) => L.save.includes(text(b))), { label: 'ปุ่ม Save/บันทึก' }))
    await waitFor(() => !openPanel(), { timeout: 10_000, label: 'บันทึก Agent settings' })
  }
  await sleep(800)
  return summary
}

/** แนบรูปตัวละครเป็น ingredient ของ agent (วางด้วย paste เหมือน Ctrl+V) */
async function attachImages(editor, attachments) {
  if (!attachments?.length) return
  const chips = () => document.querySelectorAll('flow-ingredient-chip').length
  const before = chips()
  const dt = new DataTransfer()
  for (const a of attachments) dt.items.add(new File([Uint8Array.from(atob(a.base64), (c) => c.charCodeAt(0))], a.name, { type: a.type }))
  editor.focus()
  editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  await waitFor(() => chips() >= before + attachments.length && !document.querySelector('flow-ingredient-chip mat-progress-spinner, flow-ingredient-chip [role="progressbar"]'), {
    timeout: 60_000,
    interval: 500,
    label: 'Flow อัปโหลดรูปตัวละคร',
  })
  await sleep(1000)
}

async function sendPrompt(prompt, attachments) {
  if (expectedAccount && !Q.sameAccount(await verifiedAccountEmail(), expectedAccount)) throw new Error('FLOW_ACCOUNTS_EXHAUSTED: บัญชี Flow เปลี่ยนระหว่างทำงาน')
  checkAccountQuota()
  await waitBeforeNextPrompt()
  if (expectedAccount && !Q.sameAccount(await verifiedAccountEmail(), expectedAccount)) throw new Error('FLOW_ACCOUNTS_EXHAUSTED: บัญชี Flow เปลี่ยนระหว่างทำงาน')
  checkAccountQuota()
  await attachImages(await waitFor(SEL.editor, { label: 'ช่องพิมพ์' }), attachments)
  // แนบรูปแล้ว Flow วาดช่องพิมพ์ใหม่ (element เดิมหลุดจากหน้า — ตรวจกับหน้าจริงแล้ว) → ต้องหาช่องพิมพ์ใหม่ทุกครั้ง
  const pasteText = async () => {
    const editor = await waitFor(SEL.editor, { label: 'ช่องพิมพ์' })
    editor.focus()
    // รอบก่อนส่งไม่สำเร็จอาจทิ้ง prompt ไว้ในช่อง อย่าวางต่อท้ายจนยาวเป็นสองเท่า
    document.execCommand('selectAll', false)
    document.execCommand('delete', false)
    if (text(SEL.editor())) return false
    const data = new DataTransfer()
    data.setData('text/plain', prompt)
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    await sleep(500)
    if (!text(SEL.editor())) {
      SEL.editor()?.focus()
      document.execCommand('insertText', false, prompt)
      await sleep(400)
    }
    return text(SEL.editor()) === String(prompt).replace(/\s+/g, ' ').trim()
  }
  let pasted = false
  for (let attempt = 0; attempt < 3 && !pasted; attempt++) {
    pasted = await pasteText()
    if (!pasted) await sleep(1500)
  }
  if (!pasted) throw new Error('วาง prompt ลงช่องพิมพ์ของ Flow ไม่ได้')
  await waitFor(() => (SEL.send() && !SEL.send().disabled ? SEL.send() : null), { label: 'ปุ่มส่งพร้อมใช้งาน' })
  await chrome.storage.local.set({ [FLOW_LAST_PROMPT_KEY]: Date.now() })
  await trustedEnter(await waitFor(SEL.editor, { label: 'ช่องพิมพ์' }), prompt)
  await waitFor(() => agentBusy() || !text(SEL.editor()), { timeout: 15_000, label: 'Flow รับ prompt' })
}

const agentBusy = () => !!byAria(L.stop).find(visible)

// ── ภาพใน project ──
// grid เป็น virtual scroll (แสดงเฉพาะที่อยู่บนจอ) → จำภาพทุกใบที่เคยโผล่ด้วย MutationObserver
// ชื่อภาพ = aria-label ของ tile ซึ่ง agent เปลี่ยนเป็น "00_00_00.png SHOT 01" ได้ตามที่สั่ง
const tiles = new Map() // mediaId → { name, src }
const tilePrompts = new Map() // mediaId → prompt ที่ใช้สร้างภาพ (อ่านจากหน้าแก้ภาพของ Flow)
let tilesProject = null

function collectTiles() {
  // จำตาม id ของ project ไม่ใช่ URL เต็ม — เปิดหน้าแก้ภาพ (/edit/…) หรือ ?hl=en เปลี่ยน ต้องไม่ล้างรายการภาพ
  const project = /\/project\/([^/?#]+)/.exec(location.pathname)?.[1] ?? null
  if (project !== tilesProject) { tiles.clear(); tilePrompts.clear(); tilesProject = project }
  if (!project) return tiles
  for (const tile of $$('flow-grid-tile-container')) {
    const img = tile.querySelector('img[data-media-id]')
    if (!img) continue
    const id = img.dataset.mediaId
    tiles.set(id, { name: tile.getAttribute('aria-label') ?? '', src: img.currentSrc || img.src || tiles.get(id)?.src })
  }
  return tiles
}
new MutationObserver(() => collectTiles()).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'src'] })

/** เลื่อน grid จนสุดเพื่อให้ tile ทุกใบถูก render อย่างน้อยครั้งหนึ่ง แล้วกลับขึ้นบน */
/** กล่องที่เลื่อนได้จริงของ grid — ไม่ใช่ cdk-virtual-scroll-viewport (สูงเท่าเนื้อหา) แต่เป็น .cdk-virtual-scrollable ที่ครอบอยู่ */
function gridScroller() {
  const viewport = document.querySelector('cdk-virtual-scroll-viewport')
  if (!viewport) return null
  for (let el = viewport; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el)
    if (/(auto|scroll)/.test(overflowY) && el.scrollHeight > el.clientHeight + 10) return el
  }
  return viewport.closest('.cdk-virtual-scrollable') ?? viewport
}

async function scanAllTiles() {
  collectTiles()
  // วิธีหลัก: ย่อหน้าจอชั่วคราว → virtual scroll วาด tile ทุกใบพร้อมกัน (ทดสอบกับ project 366 ภาพแล้ว)
  // เลื่อนทีละช่วงช้ามากเมื่อแท็บอยู่เบื้องหลัง เพราะ Chrome ชะลอ timer/การวาดของแท็บที่มองไม่เห็น
  const html = document.documentElement
  const oldZoom = html.style.zoom
  html.style.zoom = '0.06'
  window.dispatchEvent(new Event('resize'))
  let last = -1
  for (let i = 0; i < 20; i++) {
    await sleep(700)
    collectTiles()
    const loaded = $$('flow-grid-tile-container img[data-media-id]').length
    if (loaded === last && i >= 3) break
    last = loaded
  }
  html.style.zoom = oldZoom
  window.dispatchEvent(new Event('resize'))
  await sleep(500)

  // สำรอง: เลื่อนทีละช่วง เผื่อบาง tile ยังไม่ถูกวาด
  const scroller = gridScroller()
  if (!scroller) return tiles
  scroller.scrollTop = 0
  await sleep(500)
  for (let guard = 0; guard < 600; guard++) {
    collectTiles()
    const before = scroller.scrollTop
    scroller.scrollTop += Math.max(200, scroller.clientHeight * 0.7)
    await sleep(450) // ให้ virtual scroll วาด tile แถวใหม่ + โหลด src
    if (scroller.scrollTop === before) break
  }
  collectTiles()
  scroller.scrollTop = 0
  return tiles
}

// ชื่อภาพที่เก็บกลับ: timecode ของช็อต · cover.png (ภาพปกคลิป) · riddle.png (ภาพปริศนาธรรมสำหรับ Story)
const TIMECODE_NAME = /(\d{2}_\d{2}_\d{2}(?:_\d)?\.png|cover\.png|riddle\.png)/i

/** ภาพจาก flow-content.google เป็น JPEG → แปลงเป็น PNG ให้ตรงกับชื่อไฟล์ตาม Blueprint กฎ 4 */
/**
 * src ของ tile เป็นภาพย่อ (…/asb/…=s512-rw → 286×512) — ขอภาพเต็มด้วย =s0 (768×1376)
 * ภาพย่อทำให้คลิปเบลอ และ Kie/Seedance ปฏิเสธภาพกว้างไม่ถึง 300px (ตรวจกับหน้าเว็บจริง ก.ย. 2026)
 */
function fullSize(src) {
  try {
    const url = new URL(src)
    if (url.protocol !== 'https:' || !(url.hostname === 'flow.google.com' || url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com'))) return src
    // authuser selects the signed-in Google account. A resize suffix belongs
    // to the path, never to that query value (authuser=1=s0 returns 403).
    url.pathname = url.pathname.replace(/=[swh]\d+[^/=]*$/, '') + '=s0'
    return url.href
  } catch { return src }
}

async function imageAsPngBase64(src) {
  const blob = await fetch(fullSize(src)).then((r) => {
    if (!r.ok) throw new Error(`โหลดภาพไม่ได้ (${r.status})`)
    return r.blob()
  })
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  canvas.getContext('2d').drawImage(bitmap, 0, 0)
  const png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
  let binary = ''
  for (let i = 0; i < png.length; i += 0x8000) binary += String.fromCharCode(...png.subarray(i, i + 0x8000))
  return { base64: btoa(binary), width: bitmap.width, height: bitmap.height }
}

let running = false
let currentJobId = null
let jobCancelled = false
// ── งานจากโปรแกรมในเครื่อง (pipeline/5_images.mjs ผ่าน bridge) — ทำครบทั้งเส้นในแท็บนี้ ──

/** ส่งถึง bridge ผ่าน service worker — ลองใหม่ถ้า worker กำลังถูกปลุก; RESULT/PARTIAL ต้องได้ ok จริง */
async function toBridge(type, body, { tries = 6 } = {}) {
  let last
  for (let i = 0; i < tries; i++) {
    try {
      const res = await chrome.runtime.sendMessage({ type, body })
      if (type === 'PROGRESS' && res?.cancelled) throw new JobCancelled()
      if (res?.ok || type === 'PROGRESS') return res
      last = res?.error ?? 'bridge ไม่รับ'
    } catch (err) {
      if (err instanceof JobCancelled) throw err
      last = String(err?.message ?? err)
    }
    await sleep(1500 * (i + 1))
  }
  throw new Error(`ส่งภาพกลับโปรแกรมในเครื่องไม่สำเร็จ: ${last}`)
}
/** bridge ยกเลิกงานนี้แล้ว (โปรแกรมที่สั่งถูกปิด/เริ่มใหม่) → หยุดทันที ปล่อยแท็บให้งานถัดไป */
class JobCancelled extends Error {
  constructor() {
    super('งานนี้ถูกยกเลิกแล้ว')
  }
}
const PNG_BATCH = 4 // ส่งกลับทีละ 4 ใบ กัน payload ใหญ่เกิน
const RETRY_BATCH = 10 // สั่งซ้ำทีละไม่เกิน 10 ช็อต — ชุดใหญ่ทำให้ "The agent failed" บ่อย
const SAFE_AFTER = 2 // ช็อตที่ล้มเหลวครบกี่ครั้งแล้วให้ agent เขียนภาพใหม่ให้ปลอดภัยขึ้น
const MAX_STALLS = 3 // รอบติดกันที่ไม่ได้ภาพเพิ่มเลย → เลิก (autopilot จะเปิด project ใหม่สั่งต่อเอง)
const IDLE_MS = 75_000 // agent หยุดนิ่งนานเท่านี้ = จบรอบ (ระหว่างภาพปุ่ม Stop อาจหายแวบๆ)
const ROUND_MAX_MS = 45 * 60_000
// Flow คิวเต็ม ("The agent is experiencing high demand") → สั่งซ้ำทันทีก็โดนปฏิเสธอีก รอเว้นช่วงยาวขึ้นเรื่อยๆ (2 → 4 → 8 → 15 นาที)
const BUSY_WAITS_MS = [2, 4, 8, 15].map((m) => m * 60_000)
const BUSY_MAX_MS = 40 * 60_000 // รอรวมเกินนี้ → เลิก ให้ autopilot เปิด project ใหม่สั่งต่อ

const shotLine = (s) => (s.prompt ? `${s.filename} ${s.prompt}` : `${s.filename} SHOT`)

function renameInstruction(shots) {
  const first = shots.find((s) => s.prompt) ?? shots[0]
  const example = first.prompt ? `${first.filename} ${first.prompt}` : `${first.filename} SHOT 01`
  return `เปลี่ยนชื่อ แต่ละ shot ให้ตรงตาม prompt ที่ส่งให้ เช่น

${example}

ก็แก้ชื่อเป็น ${first.filename} ${(/SHOT\s*\d+/i.exec(first.prompt ?? '') ?? ['SHOT 01'])[0]}

ห้ามสร้างภาพใหม่ แค่เปลี่ยนชื่อภาพที่มีอยู่ให้ครบทุกภาพ ใช้ชื่อไฟล์ตาม shot list เป๊ะๆ`
}

/** agent หยุดกลางทาง (high demand / agent failed / ทำไม่ครบ) → สั่งต่อเฉพาะช็อตที่ขาด ใน project เดิม ตัวละครจึงยังเหมือนเดิม */
/** agent ตอบกลับเป็นแผน/คำถาม ("ต้องการให้เริ่มสร้างภาพไหม") แทนที่จะสร้างภาพ → สั่งให้เริ่มเลย */
function goInstruction(shots) {
  return `ยังไม่มีไฟล์ภาพตามรายการนี้ที่โปรแกรมเก็บกลับมาได้ กรุณาใช้เครื่องมือสร้างภาพจริง ไม่ใช่เพียงตอบว่าสร้างแล้ว
สร้างเฉพาะ ${shots.length} ภาพในชุดนี้ ไม่ต้องถามยืนยันและไม่ต้องสรุปแผนอีก ใช้ Style Bible และ Character Bible เดิม (lock ตัวละคร)
ตั้งชื่อแต่ละภาพเป็นชื่อไฟล์หน้าบรรทัดเป๊ะๆ เช่น "${shots[0].filename} SHOT" (ชื่อภาพเท่านั้น ห้ามเขียนลงในภาพ)

${shots.map(shotLine).join('\n\n')}`
}

function continueInstruction(batch, { remaining, safer }) {
  const naming = `ตั้งชื่อแต่ละภาพเป็นชื่อไฟล์ตามหน้าบรรทัดเป๊ะๆ เช่น "${batch[0].filename} SHOT" (ชื่อภาพเท่านั้น ห้ามเขียนชื่อไฟล์ เลข SHOT หรือ @TAG ลงในภาพ)`
  if (safer) {
    return `ช็อตต่อไปนี้สร้างไม่สำเร็จหลายครั้งแล้ว (Failed) — น่าจะติดตัวกรองเนื้อหา
ปรับภาพให้ปลอดภัยขึ้นแต่ยังเล่าเรื่องเดิม: ไม่มีเลือด บาดแผล อาวุธกระทบร่างกาย การทำร้าย หรือหน้าน่ากลัวแบบสมจริง
ใช้วิธีเล่าอ้อม เช่น เงา สัญลักษณ์ มุมกล้องไกล หรือท่าทางตกใจแบบการ์ตูน · Style Bible และ Character Bible เดิมทุกอย่าง (lock ตัวละคร)
${naming}

${batch.map(shotLine).join('\n\n')}`
  }
  return `ยังขาดภาพอีก ${remaining} ช็อต — รอบนี้สร้าง ${batch.length} ช็อตนี้ก่อน ใช้ Style Bible และ Character Bible เดิมทุกอย่าง (lock ตัวละครเหมือนภาพที่ทำไปแล้ว)
${naming}

${batch.map(shotLine).join('\n\n')}`
}

/** ภาพที่ Flow สร้างไม่สำเร็จ ("Sorry, this image failed to generate") + agent ล้มเหลวทั้งรอบ ("The agent failed") */
function failureCounts() {
  // grid เป็น virtual scroll → นับได้เฉพาะใบที่วาดอยู่ ใช้บอกสาเหตุใน log ไม่ได้ใช้ตัดสินใจ
  const imageFailed =
    $$('flow-error-tile').filter((el) => !el.closest('flow-agent-panel')).length +
    $$('flow-grid-tile-container').filter((t) => !t.querySelector('flow-error-tile') && L.failedTile.test(t.innerText ?? '')).length
  const panel = SEL.agentPanel()?.innerText ?? ''
  const agentFailed = (panel.match(/The agent failed/gi) ?? []).length
  const highDemand = (panel.match(L.highDemand) ?? []).length
  return { imageFailed, agentFailed, highDemand }
}

/** รอ agent ทำงานจนนิ่ง — คืนจำนวนภาพใหม่ของรอบนี้ */
async function waitAgentIdle(job, { before, expected, stage, onTick }) {
  const started = Date.now()
  const requested = new Set(job.payload.shots.map(s => s.filename))
  let last = -1
  let idleSince = null
  for (let tick = 1; ; tick++) {
    await sleep(5000)
    checkAccountQuota()
    // เก็บภาพที่ตั้งชื่อแล้วระหว่างที่ agent ยังวาดอยู่ทุก 15 วิ — ไม่ต้องรอให้ agent นิ่ง 75 วิก่อนค่อยเริ่มดึง
    if (onTick && tick % 3 === 0) await onTick().catch(() => {})
    const made = collectTiles().size - before
    if (made !== last) {
      last = made
      await toBridge('PROGRESS', { id: job.id, progress: { done: namedPicks(requested).size, total: expected, stage } })
    } else {
      await toBridge('PROGRESS', { id: job.id }) // heartbeat
    }
    if (agentBusy()) {
      idleSince = null
    } else {
      idleSince ??= Date.now()
      if (Date.now() - idleSince > IDLE_MS) return made
    }
    if (Date.now() - started > ROUND_MAX_MS) return made
  }
}

/** ภาพที่ตั้งชื่อ timecode แล้ว — grid เรียงใหม่สุดก่อน ชื่อซ้ำจึงได้ใบล่าสุด */
function namedPicks(wanted) {
  const picks = new Map()
  for (const t of tiles.values()) {
    const filename = TIMECODE_NAME.exec(t.name)?.[1]
    if (filename && wanted.has(filename) && !picks.has(filename) && t.src) picks.set(filename, t.src)
  }
  return picks
}

/**
 * พ.ย. 2026: Flow ตั้งชื่อภาพเองเป็นคำบรรยายภาษาอังกฤษ ("Man walking on garden pathway") ไม่ใช้ชื่อที่ Agent ตั้ง
 * → ชื่อ timecode หาไม่เจอเลย (ได้ 0/23 ทั้งที่ Agent สร้างภาพครบ) · แต่ prompt ของแต่ละภาพยังมี "SHOT 14" / cover อยู่
 * เปิดภาพในหน้าแก้ภาพ (คลิก tile → /edit/…) อ่าน prompt แล้วกดกลับ — อ่านอย่างเดียว ไม่แก้ภาพ
 */
const shotNo = (s) => Number((/\bSHOT\s*0*(\d+)/i.exec(s ?? '') ?? [])[1]) || null
// ภาพพิเศษที่ไม่มีเลขช็อต — จับคู่จากคำใน prompt (prompt ภาพปริศนาห้ามมีคำว่าปก/thumbnail และกลับกัน)
const SPECIAL_SHOTS = [{ name: 'cover.png', re: /\bcover\b|thumbnail|ภาพปก/i }, { name: 'riddle.png', re: /\briddle\b|\brebus\b|ปริศนา/i }]
const tileImg = (id) => document.querySelector(`flow-grid-tile-container img[data-media-id="${CSS.escape(id)}"]`)
const inEditor = () => /\/edit\//.test(location.pathname)

async function backToGrid() {
  if (inEditor()) history.back()
  await waitFor(() => !inEditor() && document.querySelector('flow-grid-tile-container img[data-media-id]'), { timeout: 15_000, label: 'กลับหน้า project' })
  await sleep(400)
}

async function readTilePrompt(id) {
  if (tilePrompts.has(id)) return tilePrompts.get(id)
  // รูปที่อัปโหลดเองชื่อเป็นชื่อไฟล์ (เช่น buddha_1.jpg) ไม่มี prompt — ไม่ต้องเปิด
  const name = tiles.get(id)?.name ?? ''
  if (/\.(jpe?g|png|webp|gif)$/i.test(name) && !TIMECODE_NAME.test(name)) { tilePrompts.set(id, ''); return '' }
  const img = tileImg(id)
  if (!img) return null // ยังไม่ถูกวาดใน grid — รอบหน้าค่อยอ่าน
  let prompt = ''
  try {
    img.click()
    let shownAt = 0
    const box = await waitFor(() => {
      if (!inEditor()) return null
      // ต้องเป็นหน้าแก้ของภาพนี้จริง ไม่ใช่ภาพก่อนหน้าที่ยังค้าง
      const same = [...document.querySelectorAll('flow-image-editor img')].some((i) => (i.currentSrc || i.src).includes(id) || i.dataset.mediaId === id)
      if (!same) return null
      const el = document.querySelector('flow-expandable-prompt')
      if (el && text(el)) return el
      // ภาพที่อัปโหลดเอง (รูปตัวละครอ้างอิง) ไม่มี prompt — เปิดภาพแล้ว 3 วิยังไม่มีช่อง prompt = ไม่มี ไม่ต้องรอ 15 วิ
      shownAt ||= Date.now()
      return Date.now() - shownAt > 3000 ? 'none' : null
    }, { timeout: 15_000, label: 'prompt ของภาพ' })
    prompt = box === 'none' ? '' : text(box)
  } catch (err) {
    // อ่านไม่ทัน (หน้าช้า/แท็บอยู่เบื้องหลัง) ≠ ไม่มี prompt — ลองใหม่รอบหน้า ยอมแพ้หลังพลาด 3 ครั้ง
    console.warn('[cartoon-auto] อ่าน prompt ของภาพไม่ได้', id, err.message)
    const fails = (tileReadFails.get(id) ?? 0) + 1
    tileReadFails.set(id, fails)
    promptStats.failed++
    await backToGrid().catch(() => {})
    if (fails < 3) return null
    tilePrompts.set(id, '')
    return ''
  }
  await backToGrid().catch(() => {})
  tilePrompts.set(id, prompt) // ภาพตัวละครที่แนบไปไม่มี prompt — จำไว้ ไม่เปิดซ้ำ
  return prompt
}
const tileReadFails = new Map()
/** สรุปการจับคู่รอบล่าสุด — ใส่ในข้อความ error ให้รู้ว่าติดตรงไหน */
const promptStats = { tiles: 0, skipped: 0, read: 0, withShot: 0, failed: 0 }

/** เพิ่มภาพที่จับคู่ช็อตได้จาก prompt (ต่อจากภาพที่ตั้งชื่อ timecode แล้ว) — เรียกตอน Agent ว่างเท่านั้น */
async function promptPicks(wanted, shots, { skip = new Set(), beat = async () => {} } = {}) {
  // skip = ภาพที่มีอยู่ก่อนเริ่มงานนี้ — project เดิมอาจมีภาพของ shot list ชุดก่อน เลข SHOT ซ้ำแต่คนละฉาก ห้ามจับคู่
  const picks = namedPicks(wanted)
  const byNo = new Map()
  const specials = new Map() // ชื่อไฟล์ภาพพิเศษที่ยังหาไม่เจอ → คำใน prompt ที่ใช้จับคู่
  for (const s of shots) {
    if (!wanted.has(s.filename) || picks.has(s.filename)) continue
    const n = shotNo(s.prompt) ?? shotNo(s.shot)
    if (n) byNo.set(n, s.filename)
    else {
      const special = SPECIAL_SHOTS.find((x) => x.name === String(s.filename).toLowerCase())
      if (special) specials.set(s.filename, special.re)
    }
  }
  if (!byNo.size && !specials.size) return picks
  const taken = new Set([...picks.values()])
  const match = (id) => {
    if (skip.has(id)) return
    const t = tiles.get(id)
    const p = tilePrompts.get(id)
    if (!t?.src || !p || taken.has(t.src)) return
    const n = shotNo(p)
    const filename = n ? byNo.get(n) : [...specials].find(([, re]) => re.test(p))?.[0] ?? null
    if (!filename || picks.has(filename)) return
    picks.set(filename, t.src)
    taken.add(t.src)
    if (n) byNo.delete(n)
    else specials.delete(filename)
  }
  for (const id of tiles.keys()) match(id)
  // ย่อหน้าจอชั่วคราวให้ grid วาด tile ครบทุกใบ (แบบเดียวกับ scanAllTiles) แล้วไล่อ่าน prompt ใบที่ยังไม่รู้
  const html = document.documentElement
  const oldZoom = html.style.zoom
  html.style.zoom = '0.06'
  window.dispatchEvent(new Event('resize'))
  await sleep(1200)
  try {
    collectTiles()
    let n = 0
    for (const id of [...tiles.keys()]) {
      if (!byNo.size && !specials.size) break
      if (skip.has(id) || tilePrompts.has(id) || picks.size >= wanted.size) continue
      await readTilePrompt(id)
      collectTiles()
      match(id)
      if (++n % 5 === 0) await beat() // heartbeat กัน bridge คิดว่างานเงียบ
    }
  } finally {
    html.style.zoom = oldZoom
    window.dispatchEvent(new Event('resize'))
    await sleep(400)
  }
  Object.assign(promptStats, {
    tiles: tiles.size,
    skipped: [...tiles.keys()].filter((id) => skip.has(id)).length,
    read: [...tilePrompts.keys()].filter((id) => !skip.has(id)).length,
    withShot: [...tilePrompts.entries()].filter(([id, p]) => !skip.has(id) && shotNo(p)).length,
  })
  return picks
}

/**
 * หน้าต่างที่ Flow เด้งทับหน้าเว็บ:
 *   ข่าวรุ่นใหม่ (เช่น "Nano Banana 2.1 · Get started") → ปิดให้เอง ไม่มีผลกับบัญชี
 *   หน้ารับเงื่อนไขครั้งแรกของบัญชี ("Experience and shape AI tools… Next / Sign out") → ไม่กดแทน ให้เจ้าของบัญชียอมรับเอง
 */
async function clearFlowDialogs() {
  for (let i = 0; i < 4; i++) {
    const dialogs = $$('mat-dialog-container').filter(visible)
    if (!dialogs.length) return
    const terms = dialogs.find((d) => $$('button', d).some((b) => /^(sign out|ออกจากระบบ)$/i.test(text(b))))
    if (terms) throw new Error('บัญชี Google นี้ยังไม่ได้ยอมรับเงื่อนไขการใช้ Google Flow ครั้งแรก — เปิดแท็บ Flow ของบัญชีนี้ อ่านแล้วกด Next ให้ครบเอง แล้วกดทำคลิปอีกครั้ง')
    const top = dialogs.at(-1)
    const close = $$('button', top).find((b) => /^(get started|got it|close|dismiss|เริ่มต้นใช้งาน|รับทราบ|ปิด)$/i.test(text(b)) || L.close.includes(b.getAttribute('aria-label')))
    if (!close) return // ไม่รู้จักหน้าต่างนี้ — ไม่กดมั่ว ปล่อยให้ขั้นถัดไปแจ้งว่าหาปุ่มไม่เจอ
    realClick(close)
    await sleep(800)
  }
}

/**
 * ตั้งชื่อ project ใน Flow เป็นชื่อเรื่อง — ชื่อเริ่มต้นของ Flow เป็นวันที่ ("Sep 17 - 18:54") หาในรายการ project ยาก
 * ช่องชื่ออยู่หัวหน้า project: input.editable-text-input (aria-label "Editable text") ตรวจกับหน้าเว็บจริงแล้ว (ก.ย. 2026)
 * ตั้งไม่สำเร็จไม่ถือว่างานพัง — แค่ชื่อไม่เปลี่ยน
 */
async function renameProject(title) {
  const name = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)
  if (!name) return
  const input = await waitFor(() => [...$$('input.editable-text-input'), ...byAria(L.editableText, document, 'input')].find(visible), { timeout: 15_000, label: 'ช่องชื่อ project' }).catch(() => null)
  if (!input || input.value === name) return
  input.focus()
  input.select()
  // Angular อ่านค่าจาก event — ตั้งค่าผ่าน setter ของ input จริง แล้วยิง input/change ให้ครบ
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, name)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  for (const type of ['keydown', 'keyup']) input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
  input.blur()
  input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  await sleep(1500)
  if (!document.title.includes(name.slice(0, 20)) && input.value !== name) console.warn('[cartoon-auto] ตั้งชื่อ project ใน Flow ไม่สำเร็จ')
}

async function runImageJob(job) {
  const { prompt, shots, model = 'Nano Banana 2 Lite', aspect = '16:9', attachments = [], projectTitle } = job.payload
  const email = await verifiedAccountEmail()
  expectedAccount = job.payload.expectedAccount || email
  const expected = shots.length
  const wanted = new Set(shots.map((s) => s.filename))
  const saved = new Set()
  // เซฟภาพที่ได้ทุกรอบทันที (PARTIAL) — ถ้ารอบหลังพัง ภาพที่ได้แล้วไม่หาย
  async function saveNew(picks) {
    const entries = [...picks].filter(([name]) => !saved.has(name))
    for (let i = 0; i < entries.length; i += PNG_BATCH) {
      const files = []
      for (const [name, src] of entries.slice(i, i + PNG_BATCH)) {
        try {
            files.push({ name, base64: (await imageAsPngBase64(src)).base64 })
          } catch {} // src หมดอายุ → รอบหน้าสแกนใหม่ได้ src ใหม่
        }
        if (!files.length) continue
        await toBridge('PARTIAL', { id: job.id, files })
        for (const f of files) saved.add(f.name)
        await toBridge('PROGRESS', { id: job.id, progress: { done: saved.size, total: expected, stage: 'save' } })
      }
    }

    currentJobId = job.id
    jobCancelled = false
    // heartbeat ทุก 20 วิตลอดงาน — บางช่วง (รอ Agent ว่าง 10 นาที · เว้นระยะ prompt 2 นาที · อ่าน prompt ภาพ) ไม่ได้ส่ง progress
    // bridge เงียบเกิน 6 นาทีจะส่งงานซ้ำ · ถ้าตอบว่ายกเลิกแล้ว → ตั้งธงให้ waitFor หยุดงาน
    const pulse = setInterval(() => {
      toBridge('PROGRESS', { id: job.id }, { tries: 1 }).catch((err) => { if (err instanceof JobCancelled) jobCancelled = true })
    }, 20_000)
    try {
    const { flowAccountLimits = {} } = await chrome.storage.local.get('flowAccountLimits')
    if (flowAccountLimits[email]?.retryAt > Date.now()) throw new FlowQuotaError({ ...flowAccountLimits[email], email })
    checkAccountQuota()
    await clearFlowDialogs()
    await openProject()
    await clearFlowDialogs()
    await renameProject(projectTitle).catch(() => {})
    tiles.clear() // A reused content-script world must not retain a previous project's tiles.
    await toBridge('PROGRESS', { id: job.id, progress: { done: 0, total: expected, stage: 'project', projectUrl: location.href } })
    await scanAllTiles()
    const before = collectTiles().size
    // ภาพเก่าใน project: เก็บเฉพาะที่ตั้งชื่อไฟล์ตรงแล้ว · ไม่จับคู่จากเลข SHOT เพราะอาจเป็น shot list ชุดก่อน (คนละฉาก)
    const oldTiles = new Set(tiles.keys())
    Object.assign(promptStats, { tiles: 0, skipped: 0, read: 0, withShot: 0, failed: 0 })
    const pick = () => promptPicks(wanted, shots, { skip: oldTiles, beat: () => toBridge('PROGRESS', { id: job.id }) })
    await saveNew(namedPicks(wanted))
    if (saved.size) {
      // The pipeline owns the complete style/cover prompt. Let it rebuild only missing shots.
      await toBridge('RESULT', { id: job.id, files: [], meta: { recovered: true, projectUrl: location.href, expected, named: saved.size } })
      return
    }
    const credits = await verifyFreeSettings(model, aspect)
    if (credits !== 0) throw new Error(`ชุด ${model} · x1 ใช้ ${Number.isFinite(credits) ? credits : '?'} credits ไม่ใช่ 0 — หยุดไว้ก่อน ไม่ได้สั่ง agent`)
    await configureAgent(model, { dryRun: false, ratio: aspect })
    await sendPrompt(prompt, attachments)
    // รูปตัวละครที่แนบไปกลายเป็น tile ใน project ด้วย — นับเป็นฐานใหม่ ไม่งั้นถูกนับว่าเป็น "ภาพใหม่ที่ยังไม่ตั้งชื่อ"
    await sleep(3000)
    const base = Math.max(before, collectTiles().size)
    let stalls = 0
    let nudges = 0
    const tries = new Map(shots.map((s) => [s.filename, 1])) // จำนวนครั้งที่สั่งแต่ละช็อตไปแล้ว
    const failuresAtStart = failureCounts()
    let seenHighDemand = failuresAtStart.highDemand
    let busyWaits = 0
    let busyWaited = 0
    for (let round = 1; ; round++) {
      const beforeRound = collectTiles().size
      await waitAgentIdle(job, { before, expected, stage: 'generate', onTick: () => saveNew(namedPicks(wanted)) })
      const newThisRound = collectTiles().size - beforeRound
      await scanAllTiles()
      if (agentBusy()) await waitFor(() => !agentBusy(), { timeout: 10 * 60_000, interval: 2000, label: 'Agent ว่าง' }).catch(() => null)
      let picks = agentBusy() ? namedPicks(wanted) : await pick()

      // ยังไม่มีภาพใหม่เลย = agent หยุดถามยืนยัน/สรุปแผน → สั่งให้เริ่มสร้าง (ห้ามสั่งเปลี่ยนชื่อ เพราะไม่มีภาพให้เปลี่ยน)
      if (collectTiles().size - base <= 0 && !picks.size && nudges < 3) {
        nudges++
        if (agentBusy()) await waitFor(() => !agentBusy(), { timeout: 10 * 60_000, interval: 2000, label: 'Agent ว่าง' })
        await sendPrompt(goInstruction(shots))
        continue
      }

      // มีภาพใหม่แต่จับคู่ช็อตไม่ได้เลยทั้งจากชื่อและ prompt → ทางสุดท้าย: ให้ agent ตั้งชื่อ
      // (Flow รุ่น พ.ย. 2026 ตั้งชื่อภาพเอง ชื่อที่ agent ตั้งมักไม่ติด จึงไม่สั่งถ้าจับคู่จาก prompt ได้แล้ว)
      const unnamed = collectTiles().size - base - picks.size
      if (unnamed > 0 && !picks.size) {
        await toBridge('PROGRESS', { id: job.id, progress: { done: picks.size, total: expected, stage: 'rename' } })
        await sendPrompt(renameInstruction(shots.filter((s) => !picks.has(s.filename))))
        await sleep(3000)
        await waitAgentIdle(job, { before, expected, stage: 'rename' })
        await scanAllTiles()
        picks = await pick()
      }
      await saveNew(picks)

      const missing = shots.filter((s) => !saved.has(s.filename))
      if (!missing.length) break
      const failures = failureCounts()
      const failed = {
        images: failures.imageFailed - failuresAtStart.imageFailed,
        agent: failures.agentFailed - failuresAtStart.agentFailed,
      }
      await toBridge('PROGRESS', { id: job.id, progress: { done: saved.size, total: expected, stage: 'retry', failed } })

      // Flow คิวเต็ม → ไม่นับเป็นรอบที่ล้ม รอให้คิวว่างก่อนแล้วสั่งช็อตเดิมใหม่
      if (failures.highDemand > seenHighDemand) {
        seenHighDemand = failures.highDemand
        const wait = BUSY_WAITS_MS[Math.min(busyWaits++, BUSY_WAITS_MS.length - 1)]
        if (busyWaited + wait > BUSY_MAX_MS) break
        busyWaited += wait
        console.warn(`[cartoon-auto] Flow คิวเต็ม (high demand) — รอ ${wait / 60_000} นาทีแล้วลองใหม่`)
        for (const until = Date.now() + wait; Date.now() < until; ) {
          await toBridge('PROGRESS', { id: job.id, progress: { done: saved.size, total: expected, stage: 'busy', retryAt: until } }) // heartbeat กัน bridge คิดว่าแท็บหลุด
          await sleep(20_000)
        }
        if (agentBusy()) await waitFor(() => !agentBusy(), { timeout: 10 * 60_000, interval: 2000, label: 'Agent ว่าง' })
        await sendPrompt(continueInstruction(missing.slice(0, RETRY_BATCH), { remaining: missing.length, safer: false }))
        continue
      }
      busyWaits = 0
      stalls = newThisRound > 0 ? 0 : stalls + 1
      if (stalls >= MAX_STALLS) break

      // ช็อตที่ขาด: ตัวที่ลองน้อยครั้งก่อน · ลองครบ SAFE_AFTER แล้วยังไม่ได้ → ขอแบบปลอดภัยขึ้นแยกชุด
      const safer = missing.filter((s) => tries.get(s.filename) >= SAFE_AFTER)
      const normal = missing.filter((s) => tries.get(s.filename) < SAFE_AFTER)
      const useSafer = safer.length && (!normal.length || round % 2 === 0)
      const batch = (useSafer ? safer : normal).slice(0, RETRY_BATCH)
      // ช็อตที่ขอแบบปลอดภัยไปแล้วหลายรอบก็ยังไม่ได้ → เลิกขอ ให้ภาพข้างเคียงค้างแทน
      if (useSafer && batch.every((s) => tries.get(s.filename) >= SAFE_AFTER + 2)) break
      for (const s of batch) tries.set(s.filename, tries.get(s.filename) + 1)
      if (agentBusy()) await waitFor(() => !agentBusy(), { timeout: 10 * 60_000, interval: 2000, label: 'Agent ว่าง' })
      await sendPrompt(continueInstruction(batch, { remaining: missing.length, safer: useSafer }))
    }

    if (!saved.size) {
      // บอกสิ่งที่เห็นจริง: มีภาพใหม่ไหม อ่าน prompt ได้กี่ใบ แท็บถูกซ่อนไหม Agent ตอบอะไรล่าสุด
      const s = promptStats
      const lastReply = text([...document.querySelectorAll('flow-chat-bubble')].at(-1)).slice(0, 160)
      throw new Error(`Flow ยังไม่ส่งไฟล์ภาพตามรายการชุดนี้กลับมา (0/${expected}) — ภาพทั้งหมด ${collectTiles().size} ใบ (เก่า ${oldTiles.size}) · อ่าน prompt ภาพใหม่ได้ ${s.read} ใบ มีเลข SHOT ${s.withShot} · อ่านไม่ทัน ${s.failed} ครั้ง · แท็บ${document.hidden ? 'ถูกซ่อนอยู่ (เปิดแท็บ Flow ไว้ด้านหน้า)' : 'เปิดอยู่'} · Agent ตอบล่าสุด: "${lastReply}"`)
    }
    await toBridge('RESULT', { id: job.id, files: [], meta: { generated: saved.size, expected, named: saved.size, projectUrl: location.href } })
  } catch (error) {
    // กดหยุดงาน → กด Stop ของ Flow Agent ด้วย ไม่งั้น Agent ฝั่ง Google วาดต่อเองจนครบ (เปลืองโควต้า)
    if (error instanceof JobCancelled || jobCancelled) {
      const stop = byAria(L.stop).find(visible)
      if (stop) realClick(stop)
    }
    if (error instanceof FlowQuotaError) {
      if (/\/project\//.test(location.pathname)) {
        await scanAllTiles()
        await saveNew(namedPicks(wanted))
      }
    }
    throw error
  } finally {
    clearInterval(pulse)
    expectedAccount = ''
    currentJobId = null
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // หน้าตรวจความพร้อม: เห็นปุ่ม New project หรืออยู่ใน project = ล็อกอินแล้ว · เห็นปุ่ม Sign in = ยัง
  if (msg.type === 'PING') {
    const signIn = $$('a, button').some((el) => visible(el) && /^\s*sign in\s*$|เข้าสู่ระบบ/i.test(text(el)))
    const inside = /\/project\//.test(location.pathname) || !!SEL.newProject()
    sendResponse({ ok: true, loggedIn: signIn ? false : inside ? true : null, url: location.href, running, translated: pageTranslated() })
    return
  }
  if (msg.type === 'RUN_JOB' && msg.job?.kind === 'generate-images') {
    // bridge ส่งงานเดิมซ้ำ (คิดว่าเงียบหาย) ขณะที่แท็บนี้ยังทำงานนั้นอยู่ → ไม่เริ่มใหม่
    // เดิมเริ่มใหม่แล้ววาง shot list ทั้งชุดให้ Agent ซ้ำ → Agent สร้างภาพไม่หยุดจนเกือบ 100 ภาพ
    if (running && msg.job.id === currentJobId) {
      toBridge('PROGRESS', { id: msg.job.id }, { tries: 1 }).catch(() => {})
      sendResponse({ ok: true, duplicate: true })
      return
    }
    // งานเก่ายังวิ่งอยู่ (เช่นกดเริ่มใหม่) → bridge ยกเลิกงานเก่าให้ภายใน ~2 นาที มันจะหยุดเองที่ heartbeat ถัดไป รอก่อนแทนการปัดตก
    const start = running ? waitFor(() => !running, { timeout: 3 * 60_000, interval: 2000, label: 'งาน Flow ก่อนหน้าหยุด' }) : Promise.resolve()
    // ผลและ error ส่งผ่าน toBridge เอง — service worker อาจถูกปิดระหว่างงาน 30 นาที ทำให้ sendResponse หาย
    start
      .then(() => {
        if (running) throw new Error('กำลังส่งงานให้ Flow อยู่แล้ว')
        running = true
        return runImageJob(msg.job).finally(() => (running = false))
      })
      .then(() => sendResponse({ ok: true }))
      .catch(async (err) => {
        expectedAccount = ''
        if (err instanceof FlowQuotaError) {
          const limits = (await chrome.storage.local.get('flowAccountLimits')).flowAccountLimits ?? {}
          limits[err.quota.email] = { retryAt: err.quota.retryAt, reason: err.quota.reason }
          await chrome.storage.local.set({ flowAccountLimits: limits })
          await toBridge('RESULT', { id: msg.job.id, files: [], meta: { flowQuota: err.quota } }).catch(() => {})
          sendResponse({ ok: true, reported: true })
          return
        }
        const message = errorText(err)
        await toBridge('ERROR', { id: msg.job.id, message }).catch(() => {})
        sendResponse({ ok: true, reported: true })
      })
    return true
  }

  const reply = (fn) => {
    ;(async () => {
      try {
        sendResponse({ ok: true, ...(await fn()) })
      } catch (err) {
        sendResponse({ ok: false, error: errorText(err) })
      }
    })()
    return true
  }

  if (msg.type === 'FLOW_AGENT_STATUS') {
    collectTiles()
    sendResponse({ ok: true, running, images: tiles.size, busy: agentBusy(), url: location.href })
    return
  }

  // สั่ง agent เปลี่ยนชื่อภาพตาม shot list แล้วรอจน agent ทำเสร็จ
  if (msg.type === 'FLOW_AGENT_RENAME') {
    return reply(async () => {
      if (agentBusy()) throw new Error('Flow Agent ยังทำงานอยู่ — รอให้สร้างภาพเสร็จก่อน')
      await sendPrompt(msg.prompt)
      await sleep(3000)
      await waitFor(() => !agentBusy(), { timeout: 20 * 60_000, interval: 2000, label: 'Agent เปลี่ยนชื่อภาพ' })
      await sleep(1500)
      await scanAllTiles()
      return { names: [...tiles.values()].map((t) => t.name) }
    })
  }

  // รายการภาพทั้งหมดใน project + ชื่อ timecode ที่อ่านได้
  if (msg.type === 'FLOW_AGENT_LIST') {
    return reply(async () => {
      await scanAllTiles()
      return {
        images: [...tiles.entries()].map(([id, t]) => ({ id, name: t.name, filename: TIMECODE_NAME.exec(t.name)?.[1] ?? null })),
      }
    })
  }

  if (msg.type === 'FLOW_AGENT_IMAGE') {
    return reply(async () => {
      const tile = tiles.get(msg.id)
      if (!tile?.src) throw new Error('ไม่พบภาพนี้ในหน้า Flow')
      return imageAsPngBase64(tile.src)
    })
  }

  if (msg.type !== 'FLOW_AGENT_RUN') return
  if (running) {
    sendResponse({ ok: false, error: 'กำลังส่งงานให้ Flow อยู่แล้ว' })
    return
  }
  running = true
  ;(async () => {
    const model = msg.model ?? 'Nano Banana 2 Lite'
    const aspect = msg.aspect ?? '16:9'
    try {
      await openProject()
      tiles.clear()
      const credits = await verifyFreeSettings(model, aspect)
      if (credits !== 0) {
        throw new Error(`ชุด ${model} · x1 ใช้ ${Number.isFinite(credits) ? credits : '?'} credits ไม่ใช่ 0 — หยุดไว้ก่อน ไม่ได้สั่ง agent`)
      }
      const agent = await configureAgent(model, { dryRun: !!msg.dryRun, ratio: aspect })
      const imagesBefore = collectTiles().size
      if (!msg.dryRun) await sendPrompt(msg.prompt, msg.attachments)
      sendResponse({ ok: true, credits, agent, imagesBefore, projectUrl: location.href })
    } catch (err) {
      sendResponse({ ok: false, error: errorText(err) })
    } finally {
      running = false
    }
  })()
  return true
})
})()
