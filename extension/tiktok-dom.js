(() => {
  const text = node => String(node?.innerText ?? node?.textContent ?? '').replace(/\s+/g, ' ').trim()
  const visible = node => !!node && (!node.getClientRects || node.getClientRects().length > 0)
  const username = value => {
    const name = String(value ?? '').trim().replace(/^@/, '').toLowerCase()
    return /^[a-z0-9._]{1,24}$/.test(name) ? name : null
  }
  const ownProfile = '[data-e2e="nav-profile"], [data-e2e="profile-icon"], [data-e2e="user-avatar"], [data-tt-account-profile]'
  function checkPage(doc, url) {
    if (/\/login(?:[/?]|$)/.test(url) || /Log in to TikTok|เข้าสู่ระบบ TikTok/.test(doc.body?.innerText ?? '')) throw new Error('กรุณาล็อกอิน TikTok Studio ใน Chrome แล้วเชื่อมต่ออีกครั้ง')
    if (doc.querySelector('iframe[src*="captcha"], [id*="captcha-verify"], [class*="captcha_verify"], [data-e2e="captcha"]')) throw new Error('พบ CAPTCHA — เปิดแท็บ TikTok และยืนยันด้วยตัวเอง แล้วลองใหม่')
  }
  function account(doc) {
    const links = [...doc.querySelectorAll('a[href*="/@"]')].filter(visible)
    const link = links.find(a => a.matches(ownProfile) || a.closest(ownProfile) || (/^(?:View profile|Profile|ดูโปรไฟล์|โปรไฟล์)$/i.test(text(a)) && a.closest('header, nav, [role="menu"], [role="navigation"], [role="dialog"]')))
    const path = link && new URL(link.getAttribute('href'), 'https://www.tiktok.com').pathname
    const name = path && /^\/@([^/]+)\/?$/.exec(path)?.[1]
    if (!username(name)) throw new Error('ยังอ่านบัญชี TikTok ไม่ได้ — เปิด TikTok Studio แล้วเปิดเมนูโปรไฟล์ให้เห็นชื่อบัญชี จากนั้นเชื่อมต่อใหม่')
    return { username: username(name), name: username(name) }
  }
  function assertAccount(actual, expected) {
    if (!username(expected) || username(actual?.username) !== username(expected)) throw new Error(`บัญชี TikTok ไม่ตรง — ต้องล็อกอิน @${expected} แต่ขณะนี้เป็น @${actual?.username ?? '?'}`)
  }
  const publicationSignals = doc => [...doc.querySelectorAll('[role="alert"], [role="status"], [data-e2e="upload-success"]')].filter(visible).map(node => ({ node, text: text(node) }))
  function published(doc, expected, url, before = []) {
    const current = new URL(url, 'https://www.tiktok.com')
    const match = /^\/@([^/]+)\/video\/\d+\/?$/.exec(current.pathname)
    if (current.origin === 'https://www.tiktok.com' && match && username(match[1]) === username(expected)) return { published: true, username: username(expected), url: current.origin + current.pathname }
    // Upload complete/100% alone deliberately does not satisfy this condition.
    const fresh = publicationSignals(doc).filter(signal => !before.some(old => old.node === signal.node && old.text === signal.text))
    if (!fresh.some(signal => /^(?:Video (?:posted|published)(?: successfully)?|Your video has been posted|โพสต์วิดีโอ(?:สำเร็จ|แล้ว)|เผยแพร่วิดีโอ(?:สำเร็จ|แล้ว))[.!\s]*$/i.test(signal.text))) return null
    return { published: true, username: username(expected) }
  }
  function claimAttempt(storage, id) {
    const key = `dhamma-tiktok-${id}`
    if (storage.getItem(key)) throw Object.assign(new Error('หยุดงาน TikTok ซ้ำ — ตรวจในบัญชีก่อนลองใหม่'), { needsVerification: true })
    storage.setItem(key, JSON.stringify({ phase: 'preparing', at: Date.now() }))
    let submitted = false
    return {
      get submitted() { return submitted },
      beforePublish() { storage.setItem(key, JSON.stringify({ phase: 'publishing', at: Date.now() })); submitted = true },
      complete(result) { storage.setItem(key, JSON.stringify({ phase: 'done', at: Date.now(), result })) },
    }
  }
  const privacyLabels = {
    public: ['Everyone', 'ทุกคน', 'สาธารณะ'],
    friends: ['Friends', 'เพื่อน'],
    private: ['Only you', 'Only me', 'เฉพาะคุณ', 'เฉพาะฉัน'],
  }
  const exact = (value, choices) => choices.some(choice => value.toLowerCase() === choice.toLowerCase())
  const findButton = (doc, choices) => [...doc.querySelectorAll('button, [role="button"]')].find(node => visible(node) && exact(text(node), choices))
  const enabled = node => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true'
  function privacyControl(doc) {
    return [...doc.querySelectorAll('select, button, [role="combobox"]')].find(node => visible(node) && (/(?:Who can watch|Who can view|ผู้ที่สามารถดู|ใคร.*ดูวิดีโอ)/i.test(node.getAttribute('aria-label') ?? '') || exact(text(node), Object.values(privacyLabels).flat())))
  }
  function aiControl(doc) {
    return [...doc.querySelectorAll('label, [role="switch"], [role="checkbox"], input[type="checkbox"]')].find(node => {
      if (!visible(node)) return false
      const label = text(node) || node.getAttribute('aria-label') || text(node.closest('label'))
      return /AI.generated content|เนื้อหาที่สร้าง(?:ขึ้น)?ด้วย AI/i.test(label)
    })
  }
  const checked = node => node.checked === true || node.getAttribute('aria-checked') === 'true'
  globalThis.DhammaTikTokDom = { text, visible, username, checkPage, account, assertAccount, published, publicationSignals, claimAttempt, privacyLabels, exact, findButton, enabled, privacyControl, aiControl, checked }
})()
