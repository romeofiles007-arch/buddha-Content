(() => {
  if (globalThis.__dhamma_tiktok) return
  globalThis.__dhamma_tiktok = true
  const D = globalThis.DhammaTikTokDom
  const H = globalThis.bridgeHelpers
  let active = null

  async function readAccount() {
    D.checkPage(document, location.href)
    try { return D.account(document) } catch {
      const avatar = [...document.querySelectorAll('[data-e2e="profile-icon"], [data-e2e="user-avatar"], button[aria-label*="profile" i], button[aria-label*="account" i]')].find(D.visible)
      if (avatar) { avatar.click(); await H.sleep(300) }
      return D.account(document)
    }
  }
  async function run(job) {
    let attempt = null
    let cancelled = false
    const stopBeat = H.heartbeat(job.id, () => { cancelled = true })
    const assertActive = async () => {
      if (cancelled) throw new Error('งาน TikTok ถูกยกเลิกแล้ว')
      D.checkPage(document, location.href)
      const state = await H.toBridge('PROGRESS', { id: job.id }, { tries: 1 })
      if (!state?.ok || state.cancelled || state.status !== 'running') throw new Error('งาน TikTok ไม่ได้กำลังทำงานแล้ว — หยุดเพื่อไม่ให้โพสต์ซ้ำ')
    }
    const wait = (fn, label, timeout = 30_000) => H.waitFor(async () => {
      if (cancelled) throw new Error('งาน TikTok ถูกยกเลิกแล้ว')
      D.checkPage(document, location.href)
      return fn()
    }, { timeout, interval: 400, label })
    try {
      if (job.kind === 'tiktok-inspect') return { ok: true, url: location.href, ...D.inspectStudio(document) }
      if (job.kind === 'tiktok-account') return { ok: true, ...await readAccount() }
      if (job.kind !== 'tiktok-post') throw new Error('ไม่รู้จักงาน TikTok นี้')
      attempt = D.claimAttempt(sessionStorage, job.id)
      await assertActive()
      D.assertAccount(await readAccount(), job.payload.username)
      // A fresh dedicated upload page is opened by the worker for every job.
      await wait(() => document.querySelector('input[type="file"]'), 'ช่องเลือกวิดีโอ TikTok')
      const upload = await chrome.runtime.sendMessage({ type: 'TIKTOK_SET_FILE', jobId: job.id })
      if (!upload?.ok) throw new Error(upload?.error ?? 'ใส่ไฟล์วิดีโอใน TikTok ไม่สำเร็จ')
      const editor = await wait(() => [...document.querySelectorAll('[contenteditable="true"], textarea')].find(D.visible), 'ช่องคำบรรยาย TikTok', 10 * 60_000)
      editor.focus()
      if (editor.tagName === 'TEXTAREA') {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor, job.payload.caption)
        editor.dispatchEvent(new Event('input', { bubbles: true }))
      } else {
        const selection = window.getSelection(), range = document.createRange()
        range.selectNodeContents(editor); selection.removeAllRanges(); selection.addRange(range)
        document.execCommand('insertText', false, job.payload.caption)
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: job.payload.caption }))
      }
      const captionText = (node = editor) => String(node?.value ?? node?.innerText ?? node?.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (captionText() !== String(job.payload.caption).replace(/\s+/g, ' ').trim()) throw new Error('ข้อความคำบรรยาย TikTok ไม่ตรง — ตรวจในหน้าอัปโหลดแล้วลองใหม่')
      const labels = D.privacyLabels[job.payload.privacy]
      if (!labels) throw new Error('ยังไม่ได้เลือกการมองเห็นของคลิป TikTok')
      const privacy = D.privacyControl(document)
      if (!privacy) throw new Error('ไม่พบตัวเลือกการมองเห็น TikTok — หน้าเว็บอาจเปลี่ยน กรุณาตรวจหน้าอัปโหลด')
      if (privacy.tagName === 'SELECT') {
        const option = [...privacy.options].find(option => D.exact(D.text(option), labels))
        if (!option) throw new Error('บัญชี TikTok นี้ไม่มีตัวเลือกการมองเห็นที่เลือกไว้')
        privacy.value = option.value
        privacy.dispatchEvent(new Event('change', { bubbles: true }))
      } else if (!D.exact(D.text(privacy), labels)) {
        privacy.click()
        const option = await wait(() => [...document.querySelectorAll('[role="option"], [role="menuitemradio"], [role="menuitem"]')].find(node => D.visible(node) && D.exact(D.text(node), labels)), 'ตัวเลือกการมองเห็น TikTok')
        option.click()
      }
      const selectedPrivacy = () => {
        const current = D.privacyControl(document)
        return current && D.exact(D.text(current.tagName === 'SELECT' ? current.selectedOptions[0] : current), labels)
      }
      await wait(selectedPrivacy, 'ยืนยันการมองเห็น TikTok', 5000)
      let ai = D.aiControl(document)
      if (!ai) {
        D.findButton(document, ['More options', 'Show more', 'ตัวเลือกเพิ่มเติม', 'แสดงเพิ่มเติม'])?.click()
        ai = await wait(() => D.aiControl(document), 'ป้ายกำกับเนื้อหา AI ของ TikTok', 5000)
      }
      ai = ai.matches('label') ? ai.querySelector('input, [role="switch"], [role="checkbox"]') : ai
      if (!ai) throw new Error('ไม่พบสวิตช์ป้ายกำกับ AI ของ TikTok')
      if (D.checked(ai) !== (job.payload.aigc === true)) ai.click()
      await wait(() => D.checked(ai) === (job.payload.aigc === true), 'ยืนยันป้ายกำกับ AI ของ TikTok', 5000)
      const post = await wait(() => {
        const error = [...document.querySelectorAll('[role="alert"]')].find(node => /upload failed|couldn.t upload|อัปโหลดไม่สำเร็จ/i.test(D.text(node)))
        if (error) throw new Error(D.text(error))
        const button = D.findButton(document, ['Post', 'Publish', 'โพสต์', 'เผยแพร่'])
        const uploading = [...document.querySelectorAll('[role="progressbar"]')].some(node => D.visible(node) && Number(node.getAttribute('aria-valuenow') ?? 0) < 100)
        return D.enabled(button) && !uploading ? button : null
      }, 'TikTok อัปโหลดเสร็จและพร้อมโพสต์', 10 * 60_000)
      D.assertAccount(await readAccount(), job.payload.username)
      await assertActive()
      if (cancelled) throw new Error('งาน TikTok ถูกยกเลิกแล้ว — หยุดก่อนโพสต์')
      D.assertAccount(D.account(document), job.payload.username)
      let finalAi = D.aiControl(document)
      if (finalAi?.matches('label')) finalAi = finalAi.querySelector('input, [role="switch"], [role="checkbox"]')
      const finalEditor = [...document.querySelectorAll('[contenteditable="true"], textarea')].find(D.visible)
      if (!selectedPrivacy() || !finalAi || D.checked(finalAi) !== (job.payload.aigc === true) || !D.enabled(post) || post.isConnected === false || !finalEditor || finalEditor.isConnected === false || captionText(finalEditor) !== String(job.payload.caption).replace(/\s+/g, ' ').trim()) throw new Error('การตั้งค่า TikTok เปลี่ยนระหว่างอัปโหลด — หยุดก่อนโพสต์')
      const before = D.publicationSignals(document)
      attempt.beforePublish()
      post.click() // Exactly one publish action. A missing result must not repeat it.
      const result = await wait(() => D.published(document, job.payload.username, location.href, before), 'TikTok ยืนยันว่าโพสต์สำเร็จ', 90_000)
      attempt.complete(result)
      return { ok: true, ...result }
    } catch (error) {
      return { ok: false, error: String(error.message), needsVerification: error.needsVerification === true || attempt?.submitted === true }
    } finally { stopBeat() }
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === 'PING') { respond({ ok: true, url: location.href }); return }
    if (message.type !== 'RUN_JOB') return
    const job = message.job
    if (active && active.id !== job.id) { respond({ ok: false, error: 'TikTok กำลังทำงานก่อนหน้าอยู่' }); return }
    if (!active) {
      const promise = run(job).then(meta => H.toBridge('RESULT', { id: job.id, meta }))
      active = { id: job.id, promise }
      promise.finally(() => { if (active?.id === job.id) active = null }).catch(() => {})
    }
    active.promise.then(() => respond({ ok: true })).catch(error => respond({ ok: false, error: error.message }))
    return true
  })
})()
