/**
 * Service worker — วนรับงานจาก bridge แล้วส่งต่อให้ content script ของเว็บที่เกี่ยวข้อง
 *
 * ข้อควรระวังของ MV3: service worker ถูกฆ่าเมื่อ idle ~30 วิ
 * จึงตั้ง alarm ทุก 1 นาทีมาปลุกให้ poll ใหม่ และ long-poll ฝั่ง bridge ตั้งไว้ 25 วิ
 * เพื่อให้จบก่อนถูกฆ่า
 */

const NATIVE_HOST = 'com.dhamma_auto.bridge'
import { preferredFlowTab, flowHomeUrl, flowJobNavigation } from './flow-navigation.js'
import { switchFlowAccount, inspectFlowAccounts, flowIdentity } from './flow-account-switch.js'
import { insertTikTokCaption } from './tiktok-caption.js'

const AGENTS = {
  chatgpt: { match: 'https://chatgpt.com/', pattern: ['https://chatgpt.com/*', 'https://chat.openai.com/*'], key: 'chatTabId' },
  // Google Flow ย้ายจาก labs.google/fx/tools/flow มาที่ flow.google.com แล้ว
  // ?hl=en: บัญชีที่ตั้งภาษาไทย Flow จะเป็นภาษาไทย (ปุ่ม "โปรเจ็กต์ใหม่") — ตัวขับหาปุ่มจากข้อความอังกฤษ จึงบังคับภาษาอังกฤษเสมอ
  flow: { match: 'https://flow.google.com/?hl=en', pattern: 'https://flow.google.com/*', key: 'flowTabId' },
  tiktok: { match: 'https://www.tiktok.com/tiktokstudio/upload', pattern: 'https://www.tiktok.com/tiktokstudio/*', key: 'tiktokTabId' },
}
const CONTENT_FILES = {
  chatgpt: ['selectors.js', 'content-common.js', 'content-chatgpt.js'],
  flow: ['flow-text.js', 'flow-quota.js', 'content-flow-agent.js'],
  tiktok: ['content-common.js', 'tiktok-dom.js', 'content-tiktok.js'],
}

async function settings() {
  const { port = 8785, token = '', enabled = false } = await chrome.storage.local.get(['port', 'token', 'enabled'])
  return { base: `http://127.0.0.1:${port}`, token, enabled }
}

async function post(path, body) {
  const { base, token } = await settings()
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bridge-token': token },
    body: JSON.stringify(body),
  })
}

/** ส่งผลลัพธ์ให้ bridge จนกว่าจะรับจริง — bridge อาจกำลังเปิดใหม่ หรือเน็ตในเครื่องสะดุดชั่วครู่ */
async function postReliable(path, body, { tries = 8 } = {}) {
  let lastError = ''
  for (let i = 0; i < tries; i++) {
    try {
      const res = await post(path, body)
      if (res.ok) return { ok: true }
      lastError = `bridge ตอบ ${res.status}: ${await res.text()}`
      if (res.status === 400 || res.status === 404) break // ส่งซ้ำก็ไม่ผ่าน
    } catch (err) {
      lastError = String(err?.message ?? err)
    }
    await new Promise((r) => setTimeout(r, Math.min(15_000, 1000 * 2 ** i)))
  }
  return { ok: false, error: lastError }
}

async function setStatus(text) {
  await chrome.storage.local.set({ status: text, statusAt: Date.now() })
}

/**
 * หา tab ของเว็บเป้าหมาย — ใช้แท็บที่เปิดอยู่แล้วเสมอ (แท็บเดียวกับที่แผงข้างใช้) มีไม่มีจริงๆ ค่อยเปิดใหม่
 * เลขแท็บเก็บใน storage.session ร่วมกับแผงข้าง (chatTabId / flowTabId)
 */
const opening = {} // agent → Promise ระหว่างเปิดแท็บใหม่ กันเปิดซ้อนสองแท็บ
async function ensureTab(agent) {
  const { pattern, match, key } = AGENTS[agent]
  const tabs = await chrome.tabs.query({ url: pattern })
  const { [key]: savedId } = await chrome.storage.session.get(key)
  // TikTok uses its own tab so navigating for a job never discards a user's upload draft.
  const existing = agent === 'flow' ? preferredFlowTab(tabs, savedId) : tabs.find((t) => t.id === savedId) ?? (agent === 'tiktok' ? null : tabs.find((t) => !t.discarded) ?? tabs[0])
  if (existing) {
    if (existing.id !== savedId) await chrome.storage.session.set({ [key]: existing.id })
    if (agent === 'flow') await chrome.storage.local.set({ flowAccountHome: flowHomeUrl(existing.url) })
    return existing
  }
  if (opening[agent]) return opening[agent]
  const home = agent === 'flow' ? flowHomeUrl((await chrome.storage.local.get('flowAccountHome')).flowAccountHome) : match
  opening[agent] = openTab(home, key).finally(() => delete opening[agent])
  return opening[agent]
}

// ปิดแท็บโพสต์ TikTok ที่ extension เปิดเองในรอบก่อนๆ (ไม่แตะแท็บ TikTok ที่ผู้ใช้เปิดเอง)
// chrome.tabs.remove ปิดได้แม้หน้ามีหน้าต่างถาม "ออกจากเว็บไซต์?" ค้างอยู่
async function closeFreshTikTokTabs() {
  const { freshTikTokTabs = [] } = await chrome.storage.local.get('freshTikTokTabs')
  if (!freshTikTokTabs.length) return
  await chrome.storage.local.set({ freshTikTokTabs: [] })
  await Promise.all(freshTikTokTabs.map(async (id) => {
    // เลขแท็บเริ่มนับใหม่เมื่อเปิด Chrome ใหม่ → ปิดเฉพาะแท็บที่ยังเป็นหน้า TikTok Studio
    const tab = await chrome.tabs.get(id).catch(() => null)
    if (tab && /^https:\/\/www\.tiktok\.com\/tiktokstudio\//.test(tab.url ?? tab.pendingUrl ?? '')) await chrome.tabs.remove(id).catch(() => {})
  }))
}

async function openTab(match, key) {
  const tab = await chrome.tabs.create({ url: match, active: false })
  await chrome.storage.session.set({ [key]: tab.id })
  await new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
    setTimeout(resolve, 30_000)
  })
  await new Promise((r) => setTimeout(r, 2000)) // เผื่อ SPA render ต่ออีกนิด
  return tab
}

/**
 * Flow เป็นแท็บในหน้าต่างเดิมเสมอ — ไม่เปิดหน้าต่างใหม่
 * ผู้ใช้ (31 ต.ค. 2026): "มันเปิดหน้าต่างใหม่ตอน google flow เลยงง ให้เปิดเป็นแท็บใหม่นะ"
 *
 * เหตุที่เคยย้ายไปหน้าต่างแยก: แผงข้างของ Chrome บีบแท็บเหลือ ~350-1000px แล้ว Flow ซ่อนปุ่ม Agent (หน้าแบบมือถือ)
 * ตอนนี้ปิดแผงข้างเฉพาะแท็บ Flow แทน: ตอนดูแท็บ Flow แผงหลบให้ หน้ากว้างเต็มหน้าต่าง · แท็บอื่นยังเห็นแผงตามปกติ
 * แผงข้างแค่แสดงความคืบหน้า (งานจริงรันในโปรแกรมในเครื่อง) ซ่อนบนแท็บ Flow จึงไม่กระทบงาน
 * ต้องเรียกก่อนโหลดหน้า Flow เพื่อให้ Flow วาดช่องพิมพ์แบบกว้างตั้งแต่แรก
 */
/**
 * Flow ซ่อนปุ่ม Agent เมื่อหน้ากว้างไม่ถึง ~1000px — แผงข้างยังบีบแท็บ Flow ได้ (เปิดแผงทั้งหน้าต่าง/ผู้ใช้เปิดเอง
 * หรือแท็บบัญชีที่เลือกไว้ไม่ได้โหลดใหม่หลังซ่อนแผง) → ซูมแท็บนี้ออกให้หน้ากว้างพอ แผงข้างยังเปิดดูความคืบหน้าได้
 * ซูมเฉพาะแท็บนี้ (per-tab) ไม่กระทบแท็บ Flow อื่นหรือการซูมของผู้ใช้ · หน้ากว้างพออยู่แล้วไม่แตะเลย
 */
const FLOW_MIN_WIDTH = 1040
async function widenFlowTab(tabId) {
  const [probe] = await chrome.scripting.executeScript({ target: { tabId }, func: () => window.innerWidth }).catch(() => [])
  const width = Number(probe?.result) || 0
  if (!width || width >= FLOW_MIN_WIDTH) return { width }
  const zoom = await chrome.tabs.getZoom(tabId).catch(() => 1)
  const full = width * zoom // ความกว้างของหน้าที่ซูม 100%
  const want = Math.max(0.5, Math.floor((full / FLOW_MIN_WIDTH) * 20) / 20) // ทีละ 5% ปัดลงให้กว้างเกินเกณฑ์
  if (want >= zoom - 0.001) return { width, zoom } // ซูมออกได้แค่นี้แล้ว
  await chrome.tabs.setZoomSettings(tabId, { mode: 'automatic', scope: 'per-tab' }).catch(() => {})
  await chrome.tabs.setZoom(tabId, want).catch(() => {})
  await new Promise((r) => setTimeout(r, 1500)) // ให้ Flow วาดช่องพิมพ์แบบกว้างใหม่
  console.log(`หน้า Flow แคบ ${width}px → ซูมแท็บ ${Math.round(want * 100)}% (กว้าง ≈ ${Math.round(full / want)}px)`)
  return { width: Math.round(full / want), zoom: want }
}

async function keepFlowInTab(tab) {
  await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false }).catch(() => {})
  // แท็บ Flow ที่รุ่นก่อนย้ายไปอยู่หน้าต่างแยกตัวเดียว → ย้ายกลับมาเป็นแท็บท้ายสุดของหน้าต่างหลัก (หน้าต่างที่ว่างแล้วปิดเอง)
  const sameWindow = await chrome.tabs.query({ windowId: tab.windowId }).catch(() => [])
  if (sameWindow.length !== 1) return
  const others = (await chrome.windows.getAll({ windowTypes: ['normal'] }).catch(() => [])).filter(
    (w) => w.id !== tab.windowId && !!w.incognito === !!tab.incognito,
  )
  if (!others.length) return
  const last = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null)
  const target = others.find((w) => w.id === last?.id) ?? others[0]
  await chrome.tabs.move(tab.id, { windowId: target.id, index: -1 }).catch(() => {})
}

/** โหลด URL ในแท็บแล้วรอจนเสร็จ (สูงสุด 30 วิ) + เผื่อ SPA render อีกนิด */
async function loadInTab(tabId, url, settleMs) {
  await chrome.tabs.update(tabId, { url, active: true })
  await new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
    setTimeout(resolve, 30_000)
  })
  await new Promise((r) => setTimeout(r, settleMs))
}

/**
 * Chrome แปลหน้าไปแล้ว (คลาส translated-ltr/rtl ที่ <html>) — ชื่อปุ่ม/รุ่น/ไอคอนเปลี่ยนทั้งหน้า ตัวขับหาปุ่มไม่เจอ
 * no-translate.js กันไว้ตั้งแต่เริ่มโหลดแล้ว ถ้ายังหลุด → โหลดใหม่หนึ่งครั้งก่อนส่งงาน (ยังแปลอยู่ ตัวขับบอกสาเหตุใน error เอง)
 */
async function reloadIfTranslated(tabId, url, settleMs, { preserveContext = false } = {}) {
  const [probe] = await chrome.scripting
    .executeScript({ target: { tabId }, func: () => /\btranslated-(ltr|rtl)\b/.test(document.documentElement.className || '') })
    .catch(() => [])
  if (!probe?.result) return
  if (preserveContext) throw new Error('หน้า Flow ถูก Chrome แปลอยู่ — ปิดการแปลบนแท็บบัญชีที่เลือกแล้วกดทำต่อ ระบบจะไม่โหลดลิงก์เก่าทับบัญชีนี้')
  console.warn('หน้าเว็บถูก Chrome แปลอยู่ — โหลดใหม่หนึ่งครั้ง', url)
  await loadInTab(tabId, url, settleMs)
}

async function handleJob(job) {
  await setStatus(`กำลังทำ ${job.kind}`)
  const agent = job.payload.agent ?? jobAgent(job)
  if (agent !== 'tiktok' || job.kind !== 'tiktok-post') return runJob(job, agent)
  // 5 พ.ย. 2026: โพสต์ TikTok ขาดการติดต่อ 3 รอบ ทั้งที่แท็บยังทำงาน — Chrome หน่วงตัวจับเวลาของแท็บที่ไม่อยู่บนจอ
  // (สัญญาณแรกจากแท็บมาถึงช้าไป 2 นาทีกว่า) → service worker ส่งสัญญาณแทนระหว่างเปิดแท็บและรอผล ไม่เกิน 12 นาที
  // งานถูกยกเลิกแล้วก็หยุดส่ง · แท็บค้างจริงเกิน 12 นาที bridge จะตัดสินว่าหลุดตามปกติ
  const until = Date.now() + 12 * 60_000
  const keepAlive = setInterval(async () => {
    if (Date.now() > until) return clearInterval(keepAlive)
    const state = await post('/progress', { id: job.id }).then((res) => res.json()).catch(() => null)
    if (state?.cancelled || (state && state.status !== 'running')) clearInterval(keepAlive)
  }, 20_000)
  try {
    return await runJob(job, agent)
  } finally {
    clearInterval(keepAlive)
  }
}

// ตรวจหลังโพสต์ว่า TikTok ใช้คำบรรยายของเราจริง (ไม่ใช่ชื่อไฟล์) — อ่านหน้ารายการโพสต์เท่านั้น ไม่กดอะไร
const TIKTOK_POSTS_URL = 'https://www.tiktok.com/tiktokstudio/content'
async function verifyTikTokCaption(payload) {
  const tab = await chrome.tabs.create({ url: TIKTOK_POSTS_URL, active: false })
  const loaded = () => new Promise((resolve) => {
    const listener = (id, info) => { if (id === tab.id && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(listener); resolve() } }
    chrome.tabs.onUpdated.addListener(listener)
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve() }, 30_000)
  })
  try {
    await loaded()
    const deadline = Date.now() + 75_000
    let reloaded = false
    for (;;) {
      const [found] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [payload],
        func: ({ caption, stems }) => {
          const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
          const lines = String(document.body?.innerText ?? '').split('\n').map(norm).filter(Boolean)
          const bad = lines.find((line) => stems.some((stem) => stem && line === norm(stem)))
          if (bad) return { status: 'filename', sample: bad.slice(0, 120) }
          const prefix = norm(caption).slice(0, 40)
          const good = prefix && lines.find((line) => line.startsWith(prefix))
          if (good) return { status: 'ok', sample: good.slice(0, 120) }
          return null
        },
      }).catch(() => [])
      if (found?.result) return { ok: true, ...found.result }
      if (Date.now() > deadline) return { ok: true, status: 'unknown' }
      // รายการโพสต์อาจยังไม่มีโพสต์ใหม่ — โหลดหน้าใหม่หนึ่งครั้งกลางทาง
      if (!reloaded && Date.now() > deadline - 45_000) { reloaded = true; await chrome.tabs.reload(tab.id).catch(() => {}); await loaded() }
      await new Promise((r) => setTimeout(r, 3000))
    }
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {})
  }
}

async function runJob(job, agent) {
  if (agent === 'tiktok' && job.kind === 'tiktok-verify') {
    const meta = await verifyTikTokCaption(job.payload).catch((err) => ({ ok: false, error: String(err.message) }))
    await postReliable('/result', { id: job.id, meta })
    return
  }
  if (agent === 'tiktok' && job.kind === 'tiktok-inspect' && job.payload.preserve === true) {
    const tabs = await chrome.tabs.query({ url: AGENTS.tiktok.pattern })
    const snapshots = []
    for (const tab of tabs) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['tiktok-dom.js'] })
      const [snapshot] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ url: location.href, ...globalThis.DhammaTikTokDom.inspectStudio(document) }) })
      snapshots.push({ tabId: tab.id, ...snapshot?.result })
    }
    await postReliable('/result', { id: job.id, meta: { ok: true, runtimeVersion: chrome.runtime.getManifest().version, tabs: snapshots } })
    return
  }
  // A failed Studio draft can still trigger beforeunload. Never navigate it for a new publish attempt.
  const freshTikTokPost = agent === 'tiktok' && job.kind === 'tiktok-post'
  // งาน TikTok รับทีละงาน → แท็บโพสต์ของรอบก่อนๆ ที่ยังเปิดอยู่เป็นของเก่าทั้งหมด ปิดก่อนเปิดใหม่
  if (freshTikTokPost) await closeFreshTikTokTabs()
  const tab = freshTikTokPost ? await openTab(AGENTS.tiktok.match, AGENTS.tiktok.key) : await ensureTab(agent)
  if (freshTikTokPost) {
    const { freshTikTokTabs = [] } = await chrome.storage.local.get('freshTikTokTabs')
    await chrome.storage.local.set({ freshTikTokTabs: [...freshTikTokTabs, tab.id].slice(-20) })
  }

  if (agent === 'flow' && ['flow-switch-account', 'flow-account-inspect'].includes(job.kind)) {
    const action = job.kind === 'flow-account-inspect' ? inspectFlowAccounts : switchFlowAccount
    const meta = await action({ chrome, tabId: tab.id, payload: job.payload,
      heartbeat: async () => {
        const res = await post('/progress', { id: job.id, progress: { stage: 'switch-account' } })
        return res.json()
      },
    })
    await postReliable('/result', { id: job.id, meta })
    await setStatus(meta.exhausted ? 'บัญชี Flow ติดลิมิตครบแล้ว — รอโควต้าคืน' : job.kind === 'flow-account-inspect' ? 'ตรวจบัญชี Flow แล้ว' : 'สลับบัญชี Flow แล้ว')
    return
  }

  if (freshTikTokPost) {
    await chrome.tabs.update(tab.id, { active: true })
    // กันหน้าเว็บเปิดหน้าต่างเลือกไฟล์ของ Windows (หน้าเว็บหยุดทั้งหน้าจนกว่าจะมีคนกดปิด) — ทำงานเมื่อ content script ติดธงไว้เท่านั้น
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        if (window.__dhammaPickerGuard) return
        window.__dhammaPickerGuard = true
        const blocked = (input) => input?.type === 'file' && document.documentElement.dataset.dhammaBlockPicker === '1'
        const click = HTMLInputElement.prototype.click
        HTMLInputElement.prototype.click = function () { if (!blocked(this)) return click.call(this) }
        const showPicker = HTMLInputElement.prototype.showPicker
        if (showPicker) HTMLInputElement.prototype.showPicker = function () { if (!blocked(this)) return showPicker.call(this) }
      },
    }).catch((err) => console.warn('ติดตั้งตัวกันหน้าต่างเลือกไฟล์ใน TikTok ไม่ได้', err))
  }
  else if (agent === 'tiktok') await loadInTab(tab.id, AGENTS.tiktok.match, 1500)

  // Flow: เริ่มจากหน้าแรกทุกครั้ง → content script กด New project ได้ project ใหม่ต่อคลิป
  if (agent === 'flow' && job.kind === 'generate-images') {
    const navigation = flowJobNavigation(tab.url, job.payload)
    if (navigation.error) throw new Error(navigation.error)
    await keepFlowInTab(tab) // เป็นแท็บ ไม่ใช่หน้าต่างใหม่ · แผงข้างหลบบนแท็บนี้ หน้า Flow จึงกว้างพอมีปุ่ม Agent
    if (navigation.navigate) {
      await loadInTab(tab.id, navigation.url, 3000)
    } else await chrome.tabs.update(tab.id, { active: true })
    await reloadIfTranslated(tab.id, navigation.url, 3000, { preserveContext: !navigation.navigate })
    await widenFlowTab(tab.id) // หลังโหลด เพราะซูมแบบ per-tab ถูกล้างเมื่อเปลี่ยนหน้า
  }

  // ChatGPT: แชตใหม่ = โหลดหน้าแรกใหม่ (แบบเดียวกับแผงข้าง) — กดปุ่ม New chat จาก content script ไม่ได้ผลกับหน้ารุ่นใหม่ (ต.ค. 2026)
  // โหลดจากตรงนี้ก่อนส่งงาน เพราะถ้าให้ content script โหลดหน้าเอง ตัวมันจะหายไปกลางงาน
  if (agent === 'chatgpt' && job.kind === 'prompt' && job.payload.newChat !== false) {
    await chrome.tabs.update(tab.id, { url: AGENTS.chatgpt.match })
    await new Promise((resolve) => {
      const listener = (id, info) => {
        if (id === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener)
          resolve()
        }
      }
      chrome.tabs.onUpdated.addListener(listener)
      setTimeout(resolve, 30_000)
    })
    await new Promise((r) => setTimeout(r, 2500)) // หน้า SPA render ช่องพิมพ์ต่ออีกนิด
    await reloadIfTranslated(tab.id, AGENTS.chatgpt.match, 2500)
  }

  const response = await chrome.tabs.sendMessage(tab.id, { type: 'RUN_JOB', job }).catch(async (err) => {
    // content script ยังไม่ถูกฉีด (เช่นเปิดหน้าค้างไว้ตั้งแต่ก่อนติดตั้ง) → ฉีดเองแล้วลองใหม่
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: CONTENT_FILES[agent] ?? CONTENT_FILES.chatgpt,
    })
    return chrome.tabs.sendMessage(tab.id, { type: 'RUN_JOB', job })
  })

  if (response?.ok) {
    await setStatus(`เสร็จ ${job.kind}`)
  } else if (response) {
    await postReliable('/error', { id: job.id, message: response.error ?? 'ไม่มีคำตอบจาก content script' })
    await setStatus(`ล้มเหลว: ${response.error ?? 'ไม่ทราบสาเหตุ'}`)
  }
  // ไม่มี response = service worker ถูกปลุกใหม่ระหว่างรอ — content script ยังทำงานต่อและส่งผลเอง
}

function jobAgent(job) {
  return job.agent ?? 'chatgpt'
}

/**
 * แต่ละเว็บ (ChatGPT / Flow) มีคิวของตัวเอง — งาน Flow ที่ใช้ 30 นาทีต้องไม่บังงาน ChatGPT
 * และห้ามรับงานใหม่ของเว็บเดียวกันจนกว่างานเดิมจะจบ (ใช้แท็บเดียวกัน)
 */
const busy = new Set()
let polling = false
async function pollLoop() {
  if (polling) return
  polling = true
  try {
    for (;;) {
      const { base, token, enabled } = await settings()
      if (!enabled || !token) {
        await setStatus('ปิดอยู่')
        return
      }
      // แผงข้างกำลังถาม ChatGPT ตรงๆ (หัวข้อ/บท/prompt ภาพ) → ยังไม่รับงาน ChatGPT จาก bridge
      // ไม่งั้นงานจากคิว (เช่น AI ตรวจคลิปของโหมดโพสต์) โหลดแท็บใหม่ทับคำตอบที่กำลังมา
      const { chatAskUntil = 0 } = await chrome.storage.session.get('chatAskUntil')
      const free = Object.keys(AGENTS).filter((a) => !busy.has(a) && !(a === 'chatgpt' && chatAskUntil > Date.now()))
      if (!free.length) {
        await new Promise((r) => setTimeout(r, 5000))
        continue
      }
      const results = await Promise.all(
        free.map(async (agent) => {
          try {
            const res = await fetch(`${base}/job?agent=${agent}`, { headers: { 'x-bridge-token': token } })
            if (res.status === 401) return 'auth'
            if (res.status !== 200) return 'idle'
            const job = await res.json()
            busy.add(agent)
            handleJob({ ...job, agent })
              .catch((err) => {
                let message = String(err?.message ?? err)
                // แท็บหายกลางงาน = มีคนปิดแท็บ Flow / ChatGPT ที่ extension เปิดให้
                if (/No tab with id/i.test(message)) {
                  message = `แท็บ ${agent === 'tiktok' ? 'TikTok' : agent === 'flow' ? 'Google Flow' : 'ChatGPT'} ถูกปิดระหว่างทำงาน — อย่าปิดแท็บที่ extension เปิดให้ (${message})`
                }
                return postReliable('/error', { id: job.id, message })
              })
              .finally(() => busy.delete(agent))
            return 'job'
          } catch {
            return 'offline'
          }
        }),
      )
      if (results.includes('auth')) {
        await setStatus('token ไม่ตรงกับ .env')
        return
      }
      if (results.every((r) => r === 'offline')) {
        await setStatus('ต่อ bridge ไม่ได้ — รัน node bridge/server.js หรือยัง')
        await new Promise((r) => setTimeout(r, 5000))
      } else if (!results.includes('job') && !busy.size) {
        await setStatus('รองาน...')
      }
    }
  } finally {
    polling = false
  }
}

/**
 * แผงข้างเปิดมาแล้วพร้อมใช้: ให้ native host เปิด bridge (ถ้ายังไม่เปิด) และส่ง token มา
 * ตั้งค่าเองทั้งหมด — ผู้ใช้ไม่ต้องคัดลอกรหัสหรือรันไฟล์ใดๆ
 */
async function ensureApp() {
  let info
  try {
    info = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { type: 'ensure' })
  } catch (err) {
    const notInstalled = /not found|forbidden/i.test(String(err?.message))
    return {
      ok: false,
      error: notInstalled
        ? 'ยังไม่ได้เชื่อมกับ Chrome (ตัวติดตั้งยังไม่ได้รันจนจบ หรือย้ายโฟลเดอร์มา)'
        : `ติดต่อโปรแกรมไม่ได้: ${err?.message ?? err}`,
    }
  }
  if (!info?.ok) return { ok: false, error: info?.error ?? 'เปิดโปรแกรมไม่สำเร็จ' }

  await chrome.storage.local.set({ port: info.port, token: info.token, enabled: true })
  pollLoop()
  return { ok: true, url: info.url, token: info.token }
}

/**
 * ทำคลิปอัตโนมัติจบ (สำเร็จหรือหยุดกลางทาง) → แจ้งเตือนบนเครื่อง แม้ปิดแผงข้างไปแล้ว
 * เช็กทุกนาทีพร้อม alarm ที่ปลุก service worker อยู่แล้ว
 */
async function checkAutopilot() {
  const { base, token, enabled } = await settings()
  if (!enabled || !token) return
  const a = await fetch(`${base}/api/autopilot`, { headers: { 'x-bridge-token': token } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  const st = a?.status
  // ตัวเลข % บนไอคอน extension
  const running = a?.run?.status === 'running' || st?.status === 'running'
  const badge = running ? `${a?.progress?.percent ?? 0}%` : st?.status === 'done' && Date.now() - st.updatedAt < 30 * 60_000 ? '✓' : ['failed', 'error'].includes(st?.status) ? '!' : ''
  chrome.action.setBadgeText({ text: badge }).catch(() => {})
  if (badge) chrome.action.setBadgeBackgroundColor({ color: running ? '#0a7488' : st?.status === 'done' ? '#2b7552' : '#b8432a' }).catch(() => {})
  if (!st || !['done', 'failed'].includes(st.status)) return
  const key = `${st.slug}:${st.updatedAt}`
  const { notifiedAutopilot } = await chrome.storage.local.get('notifiedAutopilot')
  if (notifiedAutopilot === key) return
  await chrome.storage.local.set({ notifiedAutopilot: key })
  if (Date.now() - st.updatedAt > 30 * 60_000) return // งานเก่าตั้งแต่ก่อนเปิด Chrome — ไม่ต้องเตือน
  const done = st.status === 'done'
  chrome.notifications.create(key, {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: done ? 'ทำคลิปเสร็จแล้ว 🎬' : 'ทำคลิปอัตโนมัติหยุดกลางทาง',
    message: done ? st.title : `${st.title}\n${st.error ?? ''}\nกดทำคลิปอัตโนมัติอีกครั้งเพื่อทำต่อ`,
    priority: 2,
    requireInteraction: true,
  })
}

/**
 * โพสต์อัตโนมัติ: โพสต์เสร็จ / พลาดบางที่ / AI ให้คลิปรอคนดู → แจ้งเตือนบนเครื่อง บอกว่าโพสต์ไปไหนบ้าง (แม้ปิดแผงข้าง)
 * จำเวลาที่ถามล่าสุดใน storage — ครั้งแรกเริ่มนับจากตอนนี้ ไม่เด้งของเก่าย้อนหลัง
 */
const POST_ALERT = {
  posted: '📣 โพสต์แล้ว',
  failed: '⚠️ โพสต์ไม่สำเร็จบางที่',
  held: '🔍 AI ให้คลิปนี้รอคนดูก่อนโพสต์',
}
async function checkPosting() {
  const { base, token, enabled } = await settings()
  if (!enabled || !token) return
  const { postingSeen } = await chrome.storage.local.get('postingSeen')
  const r = await fetch(`${base}/api/posting/recent?since=${postingSeen ?? Date.now()}`, { headers: { 'x-bridge-token': token } })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
  if (!r) return
  await chrome.storage.local.set({ postingSeen: r.now })
  for (const e of (r.events ?? []).slice(-5)) { // ปิดเครื่องไปนาน — เด้งแค่ 5 อันล่าสุด ที่เหลือดูในแท็บ "โพสต์แล้ว"
    chrome.notifications.create(`post:${e.kind}:${e.id}:${e.at}`, {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: POST_ALERT[e.kind] ?? '📣 โพสต์อัตโนมัติ',
      message: `${e.title}\n${e.text}`,
      priority: e.kind === 'posted' ? 0 : 2,
      requireInteraction: e.kind !== 'posted', // พลาด/รอคนดู ต้องค้างไว้ให้เห็น
    })
  }
}

chrome.notifications?.onClicked.addListener(async (id) => {
  chrome.notifications.clear(id)
  // แจ้งเตือนของโพสต์อัตโนมัติ → แผงข้างเปิดหน้าโพสต์ที่แท็บ "โพสต์แล้ว" (รอตรวจ ถ้าเป็นคลิปที่ AI ให้รอ)
  if (id.startsWith('post:')) await chrome.storage.session.set({ openPosting: id.split(':')[1] === 'held' ? 'review' : 'posted' }).catch(() => {})
  const win = await chrome.windows.getLastFocused().catch(() => null)
  if (win) chrome.sidePanel.open({ windowId: win.id }).catch(() => {})
})

// กดไอคอน = เลื่อนแผงข้างออกมา
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('poll', { periodInMinutes: 1 })
  pollLoop()
})
chrome.runtime.onStartup.addListener(pollLoop)
chrome.alarms?.onAlarm.addListener(() => {
  pollLoop()
  checkAutopilot()
  checkPosting()
  checkExtensionUpdate()
})

/**
 * ไฟล์ของ extension เปลี่ยน (แก้โค้ดแล้ว) → reload ตัวเองเมื่อไม่มีงานค้าง ไม่ต้องเข้า chrome://extensions เอง
 * ลายนิ้วมือตอนโหลดเก็บใน storage.session (ล้างเองทุกครั้งที่ extension reload)
 */
async function checkExtensionUpdate() {
  const { base, token, enabled } = await settings()
  if (!enabled || !token) return
  const info = await fetch(`${base}/ext-version`, { headers: { 'x-bridge-token': token } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  if (!info?.version) return
  const { extVersion } = await chrome.storage.session.get('extVersion')
  if (!extVersion) return chrome.storage.session.set({ extVersion: info.version })
  if (extVersion === info.version || info.busy || busy.size) return
  chrome.runtime.reload()
}
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'FLOW_WIDEN') {
    if (!_sender.tab?.id || !/^https:\/\/flow\.google\.com\//.test(_sender.tab.url ?? '')) {
      sendResponse({ ok: false, error: 'คำขอไม่ได้มาจากแท็บ Google Flow' })
      return
    }
    widenFlowTab(_sender.tab.id).then((r) => sendResponse({ ok: true, ...r })).catch((error) => sendResponse({ ok: false, error: error.message }))
    return true
  }
  if (msg.type === 'FLOW_ACCOUNT_IDENTITY') {
    if (!_sender.tab?.id || !/^https:\/\/flow\.google\.com\//.test(_sender.tab.url ?? '')) {
      sendResponse({ ok: false, error: 'คำขอไม่ได้มาจากแท็บ Google Flow' })
      return
    }
    flowIdentity(chrome, _sender.tab.id, { diagnose: msg.diagnose === true }).then(email => sendResponse({ ok: !!email, email })).catch(error => sendResponse({ ok: false, error: error.message }))
    return true
  }
  if (msg.type === 'TIKTOK_SET_FILE' || msg.type === 'TIKTOK_SET_CAPTION' || msg.type === 'TIKTOK_SET_COVER') {
    ;(async () => {
      const tabId = _sender.tab?.id
      const { tiktokTabId } = await chrome.storage.session.get('tiktokTabId')
      if (!tabId || tabId !== tiktokTabId || !/^https:\/\/www\.tiktok\.com\/tiktokstudio\//.test(_sender.tab?.url ?? '')) throw new Error('คำขอไฟล์ไม่ได้มาจากแท็บ TikTok ที่กำลังทำงาน')
      const { base, token } = await settings()
      const res = await fetch(`${base}/api/posting/tiktok/job?id=${encodeURIComponent(msg.jobId)}`, { headers: { 'x-bridge-token': token } })
      const info = await res.json()
      if (!res.ok || !info.file) throw new Error(info.error ?? 'งานอัปโหลด TikTok ถูกยกเลิกแล้ว')
      const target = { tabId }
      const command = (method, params) => new Promise((resolve, reject) => chrome.debugger.sendCommand(target, method, params, result => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(result)))
      let attached = false
      try {
        await new Promise((resolve, reject) => chrome.debugger.attach(target, '1.3', () => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve()))
        attached = true
        if (msg.type === 'TIKTOK_SET_CAPTION') {
          if (typeof info.caption !== 'string') throw new Error('ไม่พบคำบรรยายที่ผูกกับงาน TikTok นี้')
          await insertTikTokCaption(command, info.caption)
          return { ok: true }
        }
        const cover = msg.type === 'TIKTOK_SET_COVER'
        if (cover && !info.cover) throw new Error('ไม่มีภาพปกที่ผูกกับงาน TikTok นี้')
        const { root } = await command('DOM.getDocument', { depth: -1, pierce: true })
        const inputs = []
        // ช่องวิดีโอ: accept เป็นวิดีโอ (หรือไม่ระบุ) · ช่องภาพปก: accept เป็นรูปภาพเท่านั้น
        const wanted = accept => cover ? !!accept && /image|png|jpe?g/i.test(accept) && !/video/i.test(accept) : !accept || /video|mp4|mov|webm/i.test(accept)
        const walk = node => {
          if (node.nodeName === 'INPUT') {
            const attrs = Object.fromEntries(Array.from({ length: (node.attributes?.length ?? 0) / 2 }, (_, i) => [node.attributes[i * 2], node.attributes[i * 2 + 1]]))
            if (attrs.type === 'file' && wanted(attrs.accept)) inputs.push(node)
          }
          for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? []), ...(node.contentDocument ? [node.contentDocument] : [])]) walk(child)
        }
        walk(root)
        if (inputs.length !== 1) throw new Error(cover ? 'ไม่พบช่องอัปโหลดภาพปก TikTok ที่แน่นอน' : 'ไม่พบช่องอัปโหลดวิดีโอ TikTok ที่แน่นอน — กรุณาตรวจหน้า TikTok Studio')
        await command('DOM.setFileInputFiles', { nodeId: inputs[0].nodeId, files: [cover ? info.cover : info.file] })
        return { ok: true }
      } finally {
        if (attached) await new Promise(resolve => chrome.debugger.detach(target, () => resolve()))
      }
    })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }))
    return true
  }
  if (msg.type === 'FLOW_TRUSTED_ENTER') {
    const sender = _sender
    if (!sender.tab?.id || !/^https:\/\/flow\.google\.com\//.test(sender.tab.url ?? '')) {
      sendResponse({ ok: false, error: 'คำขอไม่ได้มาจากแท็บ Google Flow' })
      return
    }
    ;(async () => {
      const target = { tabId: sender.tab.id }
      const command = (method, params) => new Promise((resolve, reject) => {
        chrome.debugger.sendCommand(target, method, params, (result) =>
          chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(result))
      })
      let attached = false
      try {
        await new Promise((resolve, reject) => {
          chrome.debugger.attach(target, '1.3', () =>
            chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve())
        })
        attached = true
        const enter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
        await command('Input.dispatchKeyEvent', { type: 'keyDown', ...enter, text: '\r', unmodifiedText: '\r' })
        await command('Input.dispatchKeyEvent', { type: 'keyUp', ...enter })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err?.message ?? String(err) }
      } finally {
        if (attached) await new Promise((resolve) => chrome.debugger.detach(target, () => resolve()))
      }
    })().then(sendResponse)
    return true
  }
  // วาง prompt ลงช่องพิมพ์ของ ChatGPT จากฝั่งหน้าเว็บเอง (world MAIN) — paste ที่ยิงจาก content script ไม่ลงช่องพิมพ์ (เจอจริง ต.ค. 2026)
  if (msg.type === 'CHATGPT_PASTE') {
    if (!_sender.tab?.id || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(_sender.tab.url ?? '')) {
      sendResponse({ ok: false, error: 'คำขอไม่ได้มาจากแท็บ ChatGPT' })
      return
    }
    chrome.scripting
      .executeScript({
        target: { tabId: _sender.tab.id },
        world: 'MAIN',
        args: [msg.text, msg.selectors],
        func: (text, selectors) => {
          const el = selectors.map((s) => document.querySelector(s)).find(Boolean)
          if (!el) return false
          el.focus()
          const data = new DataTransfer()
          data.setData('text/plain', text)
          el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
          return true
        },
      })
      .then(([r]) => sendResponse({ ok: !!r?.result, error: r?.result ? undefined : 'ไม่เจอช่องพิมพ์' }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }))
    return true
  }
  if (msg.type === 'ENSURE_APP') {
    ensureApp().then(sendResponse)
    return true
  }
  if (msg.type === 'WAKE') {
    pollLoop()
    sendResponse({ ok: true })
  }
  if (msg.type === 'PARTIAL' || msg.type === 'RESULT' || msg.type === 'ERROR') {
    const path = { PARTIAL: '/partial', RESULT: '/result', ERROR: '/error' }[msg.type]
    postReliable(path, msg.body).then(async (result) => {
      sendResponse(result)
      // แท็บ TikTok ที่เปิดใหม่ให้โพสต์นี้ → งานจบแล้วปิดทิ้ง ทั้งสำเร็จและพลาด (สาเหตุส่งเข้า bridge แล้ว)
      // ผู้ใช้ (5 พ.ย. 2026): แท็บที่โพสต์พลาดค้างพร้อมไฟล์วิดีโอทีละแท็บ จนดูเหมือนเรียกไฟล์อะไรไม่รู้ขึ้นมาเอง
      // เหลือไว้เฉพาะกรณีไม่แน่ใจว่าโพสต์ขึ้นไหม ให้ตรวจในแท็บได้ (รอบโพสต์ถัดไปจะปิดให้)
      const tabId = _sender.tab?.id
      if (!tabId || msg.type === 'PARTIAL' || !result?.ok || msg.body?.meta?.needsVerification) return
      const { freshTikTokTabs = [] } = await chrome.storage.local.get('freshTikTokTabs')
      if (!freshTikTokTabs.includes(tabId)) return
      await chrome.storage.local.set({ freshTikTokTabs: freshTikTokTabs.filter((id) => id !== tabId) })
      setTimeout(() => chrome.tabs.remove(tabId).catch(() => {}), 3000)
    })
    return true
  }
  // PROGRESS ทุก 20 วิ = heartbeat ด้วย — ปลุก service worker และบอก bridge ว่างานยังไม่หลุด
  if (msg.type === 'PROGRESS') {
    if (!polling) pollLoop()
    post('/progress', msg.body)
      .then((res) => res.json())
      .then((data) => sendResponse({ ok: data?.ok === true, status: data?.status, cancelled: !!data?.cancelled }))
      .catch(() => sendResponse({ ok: true }))
    return true
  }
})
