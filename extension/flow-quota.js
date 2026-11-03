// Shared by the content script, worker and offline regressions. No browser side effects.
;(() => {
  const emailOf = value => String(value ?? '').match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]?.toLowerCase() ?? ''
  // Self-contained so Chrome can serialize this function into the page's isolated world.
  function profileLabel(root = document) {
    for (const el of root.querySelectorAll('[aria-label], [title]')) {
      for (const attr of ['aria-label', 'title']) {
        const label = el.getAttribute(attr) ?? ''
        if (/(?:Google Account|บัญชี Google).*@/i.test(label)) return label
      }
    }
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) { const label = profileLabel(el.shadowRoot); if (label) return label }
    }
    return ''
  }
  function quotaNotice(value, now = Date.now()) {
    const reason = String(value ?? '').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim()
    // Only error/status text supplied by the caller, never the user's conversation/prompt.
    if (/your prompt|prompt mentions|example|e\.g\./i.test(reason)) return null
    if (/batch limit|per (?:request|command|batch)|ต่อ(?:คำสั่ง|ครั้ง|ชุด)/i.test(reason) && !/daily|account|รายวัน/i.test(reason)) return null
    const limited = /(?:you(?:'ve| have)?|your account has)\s+(?:reached|exceeded|hit)\s+(?:your |the |its )?(?:(?:daily|free|image|generation|video|usage|account)\s+){0,4}(?:limit|quota)(?:\b|s\b)/i.test(reason)
      || /you (?:have no more|have used (?:up )?all (?:of )?your) (?:free |daily )?(?:image |video )?generations?(?: today)?/i.test(reason)
      || /^(?:daily |free |image |video |generation |usage )*(?:generation )?limit (?:has been )?(?:reached|exceeded)\b/i.test(reason)
      || /(?:คุณ)?(?:ใช้|ถึง)(?:โควต้า|ขีดจำกัด|ลิมิต)(?:การ)?(?:สร้างภาพ|สร้างวิดีโอ|รายวัน)?(?:ครบ|หมด|แล้ว)/.test(reason)
      || /^(?:คุณ)?(?:สร้างภาพ|สร้างวิดีโอ)(?:ถึง|ครบ)(?:ขีดจำกัด|ลิมิต|โควต้า)(?:รายวัน)?แล้ว/.test(reason)
    if (!limited) return null
    const interval = /(?:try again|retry|resets?|ลองอีกครั้ง|อีก)\s*(?:in\s*)?(\d+)\s*(minutes?|mins?|hours?|hrs?|นาที|ชั่วโมง)/i.exec(reason)
    const wait = interval ? Number(interval[1]) * (/hour|hr|ชั่วโมง/i.test(interval[2]) ? 3600000 : 60000) : 86400000
    return { reason: reason.slice(0, 500), retryAt: now + Math.min(7 * 86400000, Math.max(60000, wait)) }
  }
  function nextAccount(accounts, current, limits = {}, excluded = [], now = Date.now()) {
    const email = emailOf(current)
    const list = accounts.filter((a, i, all) => emailOf(a.email) && all.findIndex(b => emailOf(b.email) === emailOf(a.email)) === i)
    const at = list.findIndex(a => emailOf(a.email) === email)
    const skip = new Set(excluded.map(emailOf))
    for (let offset = 1; offset <= list.length; offset++) {
      const a = list[(at + offset + list.length) % list.length]
      const key = emailOf(a.email)
      if (key !== email && !a.signedOut && !skip.has(key) && !(Number(limits[key]?.retryAt) > now)) return a
    }
    return null
  }
  globalThis.DhammaFlowQuota = { emailOf, profileLabel, quotaNotice, nextAccount, sameAccount: (label, email) => !!emailOf(email) && emailOf(label) === emailOf(email) }
})()
