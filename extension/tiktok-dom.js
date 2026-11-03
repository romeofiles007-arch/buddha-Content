(() => {
  const text = node => String(node?.innerText ?? node?.textContent ?? '').replace(/\s+/g, ' ').trim()
  const visible = node => !!node && (!node.getClientRects || node.getClientRects().length > 0)
  const username = value => {
    const name = String(value ?? '').trim().replace(/^@/, '').toLowerCase()
    return /^[a-z0-9._]{1,24}$/.test(name) ? name : null
  }
  const ownProfile = '[data-e2e="nav-profile"], [data-e2e="profile-icon"], [data-e2e="user-avatar"], [data-dhamma-tiktok-current-account]'
  function checkPage(doc, url) {
    if (/\/login(?:[/?]|$)/.test(url) || /Log in to TikTok|เข้าสู่ระบบ TikTok/.test(doc.body?.innerText ?? '')) throw new Error('กรุณาล็อกอิน TikTok Studio ใน Chrome แล้วเชื่อมต่ออีกครั้ง')
    if (doc.querySelector('iframe[src*="captcha"], [id*="captcha-verify"], [class*="captcha_verify"], [data-e2e="captcha"]')) throw new Error('พบ CAPTCHA — เปิดแท็บ TikTok และยืนยันด้วยตัวเอง แล้วลองใหม่')
    const page = text(doc.body)
    if (/^เกิดข้อผิดพลาด\s+โปรดลองอีกครั้ง\s+ลองใหม่(?:\s+(?:โปรไฟล์|การตั้งค่า|ออกจากระบบ))*$/.test(page) || /^Something went wrong[.!]?\s+Please try again[.!]?\s+Try again(?:\s+(?:Profile|Settings|Log out))*$/i.test(page)) throw new Error('TikTok แสดงหน้าเกิดข้อผิดพลาด — กรุณาตรวจแท็บ TikTok และการเชื่อมต่อก่อนลองใหม่')
  }
  function account(doc, { fromAvatar = false } = {}) {
    const links = [...doc.querySelectorAll('a[href*="/@"]')].filter(visible).filter(link => {
      try { const url = new URL(link.getAttribute('href'), 'https://www.tiktok.com'); return url.protocol === 'https:' && ['www.tiktok.com', 'tiktok.com'].includes(url.hostname) } catch { return false }
    })
    let link = links.find(a => a.matches(ownProfile) || a.closest(ownProfile) || (/^(?:View profile|Profile|ดูโปรไฟล์|โปรไฟล์)$/i.test(text(a)) && a.closest('header, nav, [role="menu"], [role="navigation"], [role="dialog"]')))
    if (!link && fromAvatar) {
      const menuLinks = links.filter(a => !a.closest('[contenteditable="true"], textarea') && /^\/@[^/]+\/?$/.test(new URL(a.getAttribute('href'), 'https://www.tiktok.com').pathname))
      if (menuLinks.length === 1) { link = menuLinks[0]; link.setAttribute?.('data-dhamma-tiktok-current-account', 'true') }
    }
    const path = link && new URL(link.getAttribute('href'), 'https://www.tiktok.com').pathname
    const name = path && /^\/@([^/]+)\/?$/.exec(path)?.[1]
    if (!username(name)) throw new Error('ยังอ่านบัญชี TikTok ไม่ได้ — เปิด TikTok Studio แล้วเปิดเมนูโปรไฟล์ให้เห็นชื่อบัญชี จากนั้นเชื่อมต่อใหม่')
    return { username: username(name), name: username(name) }
  }
  function avatarTrigger(doc) {
    const explicit = [...doc.querySelectorAll('[data-e2e="profile-icon"], [data-e2e="user-avatar"], button[aria-label*="profile" i], button[aria-label*="account" i]')].find(visible)
    if (explicit) return explicit
    // Observed on TikTok Studio 2026-11-02: avatar buttons have no label/e2e;
    // identify the unique avatar image rather than a generated CSS class.
    const buttons = [...new Set([...doc.querySelectorAll('img')].filter(visible).filter(image => {
      try { return /\/tos-[^/]*-avt-/.test(new URL(image.getAttribute('src'), 'https://www.tiktok.com').pathname) } catch { return false }
    }).map(image => image.closest('button, [role="button"]')).filter(visible))]
    return buttons.length === 1 ? buttons[0] : null
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
  const findButton = (doc, choices) => [...doc.querySelectorAll('button, [role="button"], .more-collapse')].find(node => visible(node) && exact(text(node), choices))
  const enabled = node => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true'
  function privacyControl(doc) {
    return [...doc.querySelectorAll('select, button, [role="combobox"]')].find(node => visible(node) && (/(?:Who can watch|Who can view|ผู้ที่สามารถดู|ใคร.*ดูวิดีโอ)/i.test(node.getAttribute('aria-label') ?? '') || exact(text(node), Object.values(privacyLabels).flat())))
  }
  function aiControl(doc) {
    const row = doc.querySelector('[data-e2e="aigc_container"]')
    if (visible(row)) {
      // Studio's switch input has no accessible name; the dedicated setting row
      // supplies its identity. Never take a neighboring disclosure/upload switch.
      const switches = [...row.querySelectorAll('input[role="switch"], input[type="checkbox"], [role="switch"]')]
      return switches.length === 1 ? switches[0] : null
    }
    return [...doc.querySelectorAll('label, [role="switch"], [role="checkbox"], input[type="checkbox"]')].find(node => {
      if (!visible(node)) return false
      const label = text(node) || node.getAttribute('aria-label') || text(node.closest('label'))
      return /AI.generated content|เนื้อหาที่สร้าง(?:ขึ้น)?(?:ด้วย|โดย) AI/i.test(label)
    })
  }
  const checked = node => node.checked === true || node.getAttribute('aria-checked') === 'true'
  function aiConfirmation(doc) {
    const dialogs = [...doc.querySelectorAll('[role="dialog"]')].filter(visible).filter(node => /^Labeling AI-generated content(?:\s|$)/i.test(text(node)))
    return dialogs.length === 1 ? findButton(dialogs[0], ['Turn on']) : null
  }
  function inspectStudio(doc) {
    const controls = [...doc.querySelectorAll('button, input, select, [role="button"], [role="combobox"], [role="switch"], [contenteditable="true"]')].filter(visible).filter(node => !['password', 'email', 'tel'].includes(node.type)).slice(0, 100).map(node => ({
      tag: node.tagName, role: node.getAttribute('role'), type: node.getAttribute('type'), label: node.getAttribute('aria-label'), placeholder: node.getAttribute('placeholder'), e2e: node.getAttribute('data-e2e'), className: node.getAttribute('class'), ariaChecked: node.getAttribute('aria-checked'),
      ...(node.tagName === 'BUTTON' || node.getAttribute('role') === 'button' ? { text: text(node).slice(0, 120) } : {}),
    }))
    const profiles = [...doc.querySelectorAll('a[href*="/@"]')].filter(visible).map(node => ({ href: node.getAttribute('href'), e2e: node.getAttribute('data-e2e'), text: text(node).slice(0, 80) }))
    const describe = node => node ? { tag: node.tagName, className: node.getAttribute('class'), role: node.getAttribute('role'), label: node.getAttribute('aria-label'), e2e: node.getAttribute('data-e2e'), title: node.getAttribute('title'), alt: node.getAttribute('alt'), text: text(node).slice(0, 100) } : null
    const avatars = [...doc.querySelectorAll('img, [class*="avatar" i], [class*="profile" i], [class*="user-info" i]')].filter(visible).slice(0, 30).map(node => {
      const src = node.getAttribute('src')
      return { ...describe(node), ...(src && /^https:/.test(src) ? { imagePath: new URL(src).pathname } : {}), parent: describe(node.parentElement), grandparent: describe(node.parentElement?.parentElement) }
    })
    const navigation = [...doc.querySelectorAll('a[href]')].filter(visible).map(node => ({ path: new URL(node.getAttribute('href'), 'https://www.tiktok.com').pathname, text: text(node).slice(0, 100), e2e: node.getAttribute('data-e2e'), className: node.getAttribute('class') })).filter(link => /^\/(?:tiktokstudio|@|creator)/.test(link.path)).slice(0, 40)
    const settingRows = [...doc.querySelectorAll('div, span')].filter(visible).filter(node => node.children?.length === 0 && /^(?:AI.generated content|เนื้อหาที่สร้าง(?:ขึ้น)?(?:ด้วย|โดย) AI)$/i.test(text(node))).slice(0, 2).map(node => {
      const row = node.closest('[data-e2e="aigc_container"]') ?? node.parentElement?.parentElement
      return { label: describe(node), parent: describe(node.parentElement), row: describe(row), children: [...(row?.querySelectorAll('*') ?? [])].slice(0, 30).map(child => ({ ...describe(child), checked: child.checked, ariaChecked: child.getAttribute('aria-checked'), dataState: child.getAttribute('data-state') })) }
    })
    return { controls, profiles, avatars, navigation, settingRows, pageText: text(doc.body).slice(0, 4000) }
  }
  globalThis.DhammaTikTokDom = { text, visible, username, checkPage, account, avatarTrigger, assertAccount, published, publicationSignals, claimAttempt, privacyLabels, exact, findButton, enabled, privacyControl, aiControl, aiConfirmation, checked, inspectStudio }
})()
