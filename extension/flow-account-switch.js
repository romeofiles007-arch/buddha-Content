import './flow-quota.js'
import { flowHomeUrl } from './flow-navigation.js'
const Q = globalThis.DhammaFlowQuota
const LIMITS_KEY = 'flowAccountLimits'
const CHOOSER = 'https://accounts.google.com/AccountChooser?continue=https%3A%2F%2Fflow.google.com%2F'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const isFlow = value => { try { return new URL(value).origin === 'https://flow.google.com' } catch { return false } }
const isChooser = value => { try { const u = new URL(value); return u.origin === 'https://accounts.google.com' && /\/(?:AccountChooser|v3\/signin\/accountchooser)$/i.test(u.pathname) } catch { return false } }

/** The policy is independent of Chrome so identity and exhaustion have deterministic tests. */
export async function rotateAccount({ currentEmail, payload, store, list, select, identity, now = Date.now() }) {
  const current = Q.emailOf(currentEmail)
  if (!current || current !== Q.emailOf(payload.limitedEmail)) throw new Error('บัญชี Flow เปลี่ยนระหว่างตรวจลิมิต — หยุดก่อนสลับบัญชี')
  const limits = await store.get()
  const retryAt = Number(payload.retryAt)
  limits[current] = { retryAt: Number.isFinite(retryAt) && retryAt > now ? Math.min(retryAt, now + 7 * 86400000) : now + 86400000, reason: String(payload.reason ?? 'Flow account limit').slice(0, 500) }
  await store.set(limits) // Persist before leaving the exhausted account.
  const accounts = await list()
  if (!accounts.some(a => Q.emailOf(a.email) === current)) throw new Error('ไม่พบบัญชี Flow เดิมในรายชื่อ Google — กรุณาตรวจการเข้าสู่ระบบ')
  const next = Q.nextAccount(accounts, current, limits, payload.excludedEmails, now)
  if (!next) {
    const resets = accounts.filter(a => !a.signedOut).map(a => Number(limits[Q.emailOf(a.email)]?.retryAt)).filter(n => n > now)
    return { exhausted: true, retryAt: resets.length ? Math.min(...resets) : null }
  }
  await select(next.email)
  const actual = await identity()
  if (!Q.sameAccount(actual, next.email)) throw new Error('ยืนยันบัญชี Flow หลังสลับไม่ตรง — ไม่ได้ส่งคำสั่งสร้างภาพ')
  return { email: Q.emailOf(next.email), previousEmail: current }
}

export async function flowIdentity(chrome, tabId, { diagnose = false } = {}) {
  const tab = await chrome.tabs.get(tabId)
  if (!isFlow(tab.url)) return ''
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: Q.profileLabel })
  if (Q.emailOf(r?.result)) return Q.emailOf(r.result)
  // Google renders the profile within a component; closed roots remain visible to accessibility.
  // 2026-11-04 Flow's new layout: also look in child frames and in image/menu controls, but only
  // controls (never page text such as prompts) whose name ties an email to an account/profile.
  return withDebugger(chrome, tabId, async command => {
    const snapshot = async () => {
      const frames = [null]
      try {
        const { frameTree } = await command('Page.getFrameTree')
        const walk = tree => { for (const child of tree.childFrames ?? []) { frames.push(child.frame.id); walk(child) } }
        walk(frameTree)
      } catch {}
      const trees = []
      for (const frameId of frames) {
        try { trees.push((await command('Accessibility.getFullAXTree', frameId ? { frameId } : {})).nodes ?? []) } catch {}
      }
      return trees
    }
    const trees = await snapshot()
    const seen = []
    for (const nodes of trees) {
      const labels = nodes.filter(n => !n.ignored && CONTROL_ROLES.includes(n.role?.value)).map(n => n.name?.value ?? '')
      const hit = labels.find(label => /(?:Google Account|บัญชี Google).*@/i.test(label)) ?? labels.find(label => ACCOUNT_WORDS.test(label) && Q.emailOf(label))
      if (hit) return Q.emailOf(hit)
      seen.push(...labels.filter(label => ACCOUNT_WORDS.test(label)))
    }
    const email = await accountPanelIdentity(command, trees, snapshot, async () => (await chrome.tabs.get(tabId)).url === tab.url)
    // A manual account change/navigation while the panel was read invalidates the result.
    if (email && (await chrome.tabs.get(tabId)).url === tab.url) return email
    if (diagnose) {
      const masked = [...new Set(seen)].slice(0, 5).map(label => label.replace(/[^\s@()]+@/g, '***@').slice(0, 80))
      throw new Error(`ไม่พบปุ่มบัญชี Google บนหน้า Flow${masked.length ? ` (ปุ่มที่เกี่ยวกับบัญชีที่เห็น: ${masked.join(' | ')})` : ' (ไม่เห็นปุ่มบัญชีเลย — หน้า Flow อาจยังโหลดไม่เสร็จหรือออกจากระบบอยู่)'}`)
    }
    return ''
  })
}
const CONTROL_ROLES = ['button', 'link', 'img', 'image', 'menuitem', 'menuitemradio', 'tab']
const ACCOUNT_WORDS = /account|บัญชี|profile|โปรไฟล์|signed in|ลงชื่อเข้าใช้/i

/** New Flow avatar labels contain no email. Read only its named account dialog,
 * never arbitrary page text or the Google account chooser. Restore only panels we opened. */
async function accountPanelIdentity(command, initialTrees, snapshot, stillCurrent) {
  const panels = trees => trees.flatMap(nodes => nodes.filter(n => !n.ignored && n.role?.value === 'dialog' && /^(?:Account settings|การตั้งค่าบัญชี)$/i.test(n.name?.value ?? '')).map(panel => ({ nodes, panel })))
  const descendants = ({ nodes, panel }) => {
    const byId = new Map(nodes.map(n => [n.nodeId, n]))
    return nodes.filter(n => {
      const visited = new Set()
      for (let p = n; p && !visited.has(p.nodeId); p = byId.get(p.parentId)) {
        if (p.nodeId === panel.nodeId) return true
        visited.add(p.nodeId)
      }
      return false
    })
  }
  const click = async node => {
    const { object } = await command('DOM.resolveNode', { backendNodeId: node.backendDOMNodeId })
    await command('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true, functionDeclaration: 'function() { this.click(); return true }' })
  }
  let trees = initialTrees
  let opened = false
  let openedPanelId
  const panelId = panel => panel.backendDOMNodeId ?? panel.nodeId
  if (!panels(trees).length) {
    const buttons = trees.flat().filter(n => !n.ignored && n.role?.value === 'button' && /^(?:Account details|รายละเอียดบัญชี)$/i.test(n.name?.value ?? '') && n.backendDOMNodeId)
    if (buttons.length !== 1) return ''
    await click(buttons[0])
    opened = true
  }
  try {
    for (let tick = 0; tick < 10; tick++) {
      if (opened) trees = await snapshot()
      const found = panels(trees)
      if (found.length > 1) return ''
      if (found.length === 1) {
        if (opened) openedPanelId = panelId(found[0].panel)
        const emails = [...new Set(descendants(found[0]).filter(n => !n.ignored && n.role?.value === 'StaticText').map(n => (n.name?.value ?? '').trim()).filter(s => Q.emailOf(s) === s.toLowerCase()).map(Q.emailOf))].filter(Boolean)
        return emails.length === 1 ? emails[0] : ''
      }
      if (!opened) return ''
      await sleep(200)
    }
    return ''
  } finally {
    if (opened && openedPanelId != null && await stillCurrent()) {
      const found = panels(await snapshot())
      if (found.length === 1 && panelId(found[0].panel) === openedPanelId && await stillCurrent()) {
        const close = descendants(found[0]).filter(n => !n.ignored && n.role?.value === 'button' && /^(?:Close account (?:panel|settings)|ปิดแผงบัญชี)$/i.test(n.name?.value ?? '') && n.backendDOMNodeId)
        if (close.length === 1) await click(close[0])
      }
    }
  }
}

async function withDebugger(chrome, tabId, fn) {
  const target = { tabId }
  const command = (method, params = {}) => new Promise((resolve, reject) => chrome.debugger.sendCommand(target, method, params, result => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(result)))
  await new Promise((resolve, reject) => chrome.debugger.attach(target, '1.3', () => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve()))
  try { return await fn(command) } finally { await new Promise(resolve => chrome.debugger.detach(target, () => resolve())) }
}

/** Only account row names/status are read. Never inspect login fields, cookies or credentials. */
async function chooserAccounts(chrome, tabId, selectEmail) {
  if (!isChooser((await chrome.tabs.get(tabId)).url)) throw new Error('Google ต้องการเข้าสู่ระบบหรือยืนยันตัวตน — กรุณาจัดการในเบราว์เซอร์ก่อน')
  return withDebugger(chrome, tabId, async command => {
    const { nodes } = await command('Accessibility.getFullAXTree')
    const accounts = []
    for (const node of nodes) {
      if (node.ignored || node.role?.value !== 'link' || !node.backendDOMNodeId) continue
      const email = Q.emailOf(node.name?.value)
      if (!email || accounts.some(a => a.email === email)) continue
      const { object } = await command('DOM.resolveNode', { backendNodeId: node.backendDOMNodeId })
      const { result } = await command('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true, functionDeclaration: `function() { const row=this.closest('li')||this; return {text:row.innerText||'',disabled:this.getAttribute('aria-disabled')==='true'} }` })
      const signedOut = !!result?.value?.disabled || /signed out|ออกจากระบบ|ลงชื่อออก/i.test(result?.value?.text ?? '')
      accounts.push({ email, signedOut })
      if (selectEmail && email === Q.emailOf(selectEmail)) {
        if (signedOut) throw new Error('บัญชี Google ถัดไปออกจากระบบอยู่ — กรุณาเข้าสู่ระบบก่อน')
        await command('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true, functionDeclaration: 'function() { this.click(); return true }' })
        return accounts
      }
    }
    if (selectEmail) throw new Error('รายชื่อบัญชี Google เปลี่ยนก่อนเลือก — หยุดเพื่อไม่เลือกผิดบัญชี')
    if (!accounts.length) throw new Error('อ่านรายชื่อบัญชี Google ที่ล็อกอินไว้ไม่ได้ — กรุณาตรวจหน้าเลือกบัญชี')
    return accounts
  })
}

/** Diagnostic inventory in a disposable tab; never change the selected Flow account/project. */
export async function inspectFlowAccounts({ chrome, tabId, payload = {}, heartbeat = async () => {} }) {
  const email = await flowIdentity(chrome, tabId)
  if (payload.identityOnly === true) return { email, version: chrome.runtime.getManifest().version }
  const tab = await chrome.tabs.create({ url: CHOOSER, active: false })
  try {
    for (let tick = 0; tick < 30; tick++) {
      if (tick % 5 === 0 && (await heartbeat())?.cancelled) throw new Error('งานตรวจบัญชีถูกยกเลิกแล้ว')
      if (isChooser((await chrome.tabs.get(tab.id)).url)) {
        try {
          const accounts = await chooserAccounts(chrome, tab.id)
          return { email, accounts, limits: (await chrome.storage.local.get(LIMITS_KEY))[LIMITS_KEY] ?? {}, version: chrome.runtime.getManifest().version }
        } catch (e) { if (!/อ่านรายชื่อ/.test(e.message)) throw e }
      }
      await sleep(1000)
    }
    throw new Error('อ่านรายชื่อบัญชี Google ไม่สำเร็จ')
  } finally { await chrome.tabs.remove(tab.id) }
}

export async function switchFlowAccount({ chrome, tabId, payload, heartbeat = async () => {} }) {
  let cancelled = false
  let selectedEmail = ''
  const pulse = async () => { const r = await heartbeat(); if (r?.cancelled) { cancelled = true; throw new Error('งานสลับบัญชีถูกยกเลิกแล้ว') } }
  const wait = async fn => {
    for (let tick = 0; tick < 45; tick++) {
      if (cancelled) throw new Error('งานสลับบัญชีถูกยกเลิกแล้ว')
      const value = await fn()
      if (value) return value
      if (tick % 5 === 0) await pulse()
      await sleep(1000)
    }
    throw new Error('Google ต้องการเข้าสู่ระบบหรือยืนยันตัวตน หรือสลับบัญชีไม่สำเร็จ — หยุดก่อนสร้างภาพ')
  }
  await pulse()
  const currentEmail = await flowIdentity(chrome, tabId)
  const result = await rotateAccount({ currentEmail, payload,
    store: { get: async () => (await chrome.storage.local.get(LIMITS_KEY))[LIMITS_KEY] ?? {}, set: limits => chrome.storage.local.set({ [LIMITS_KEY]: limits }) },
    list: async () => {
      await chrome.tabs.update(tabId, { url: CHOOSER, active: true })
      await wait(async () => isChooser((await chrome.tabs.get(tabId)).url))
      return wait(async () => {
        try { return await chooserAccounts(chrome, tabId) } catch (e) { if (/อ่านรายชื่อ/.test(e.message)) return null; throw e }
      })
    },
    select: async email => { await pulse(); selectedEmail = email; await chooserAccounts(chrome, tabId, email) },
    identity: async () => {
      await wait(async () => isFlow((await chrome.tabs.get(tabId)).url))
      const home = flowHomeUrl((await chrome.tabs.get(tabId)).url)
      // The chooser returns the observed /u/N/ account route, sometimes in Thai.
      await chrome.tabs.update(tabId, { url: home, active: true })
      const email = await wait(async () => {
        if ((await chrome.tabs.get(tabId)).status !== 'complete') return ''
        const actual = await flowIdentity(chrome, tabId).catch(() => '')
        return Q.sameAccount(actual, selectedEmail) ? actual : ''
      })
      await chrome.storage.local.set({ flowAccountHome: home })
      await chrome.storage.session.set({ flowTabId: tabId })
      return email
    },
  })
  return result
}
