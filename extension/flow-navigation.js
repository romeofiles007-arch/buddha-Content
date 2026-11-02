// Flow account selection belongs to the user's chosen tab. Do not restore an
// old project URL over that tab: its owner can pull Google back to account 0.
const HOME = 'https://flow.google.com/?hl=en'
const flowUrl = value => {
  try { const url = new URL(value); return url.origin === 'https://flow.google.com' ? url : null } catch { return null }
}
export function preferredFlowTab(tabs, savedId) {
  const available = tabs.filter(tab => flowUrl(tab.url) && !tab.discarded)
  const recent = list => [...list].sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0]
  const latest = recent(available)
  // Chrome has an active tab in every window. Recency must win even after the
  // user returns to ChatGPT in the window where they selected the new account.
  if (latest?.lastAccessed) return latest
  const active = recent(available.filter(tab => tab.active))
  if (active) return active
  const saved = available.find(tab => tab.id === savedId)
  return saved ?? latest ?? null
}
export function flowHomeUrl(value) {
  const url = flowUrl(value)
  if (!url) return HOME
  url.pathname = url.pathname.replace(/\/project\/.*$/, '/')
  url.hash = ''
  url.searchParams.set('hl', 'en')
  return url.href
}
export function flowJobNavigation(currentUrl, payload = {}) {
  const current = flowUrl(currentUrl)
  const saved = flowUrl(payload.projectUrl)
  // Resume in the currently selected account/workspace. If the user switched
  // accounts, openProject creates a project there rather than reopening the old owner's.
  if (current && saved && /\/project\//.test(saved.pathname)) {
    if (/\/project\//.test(current.pathname) && current.pathname !== saved.pathname) {
      return { navigate: false, url: current.href, error: 'โปรเจกต์ Flow ที่เปิดอยู่เป็นคนละโปรเจกต์ — เปิดหน้าแรก Flow ของบัญชีที่ต้องการ แล้วกดทำต่อ ระบบจะสร้างโปรเจกต์ของคลิปนี้ในบัญชีที่เลือกและไม่กลับบัญชีเดิม' }
    }
    return { navigate: false, url: current.href }
  }
  if (current && !/\/project\//.test(current.pathname)) return { navigate: false, url: current.href }
  return { navigate: true, url: flowHomeUrl(currentUrl) }
}
