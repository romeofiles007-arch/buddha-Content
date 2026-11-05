(() => {
  if (globalThis.__dhamma_tiktok) return
  globalThis.__dhamma_tiktok = true
  const D = globalThis.DhammaTikTokDom
  const H = globalThis.bridgeHelpers
  let active = null
  let accountMenuOpened = false
  function closeAccountMenu() {
    if (!accountMenuOpened) return
    accountMenuOpened = false
    D.avatarTrigger(document)?.click()
  }

  async function readAccount({ keepOpen = false } = {}) {
    D.checkPage(document, location.href)
    try { return D.account(document) } catch {
      const avatar = D.avatarTrigger(document)
      if (!avatar) throw new Error('ยังอ่านบัญชี TikTok ไม่ได้ — เปิดเมนูรูปโปรไฟล์แล้วเชื่อมต่อใหม่')
      avatar.click()
      accountMenuOpened = true
      try { return await H.waitFor(() => {
        try { return D.account(document, { fromAvatar: true }) } catch { return null }
      }, { timeout: 5000, interval: 200, label: 'ชื่อบัญชี TikTok' }) }
      finally { if (!keepOpen) closeAccountMenu() }
    }
  }
  // กด "แก้ไขหน้าปก" → แท็บอัปโหลด → ใส่ไฟล์ปก (ผ่าน background) → ยืนยัน แล้วรอหน้าต่างปิด
  async function setCover(wait, jobId) {
    const button = await wait(() => D.coverButton(document), 'ปุ่มแก้ไขหน้าปก TikTok', 15_000)
    button.click()
    const dialog = await wait(() => D.coverDialog(document), 'หน้าต่างภาพปก TikTok', 15_000)
    const tab = await wait(() => D.coverUploadTab(dialog), 'แท็บอัปโหลดหน้าปก TikTok', 10_000)
    tab.click()
    // ช่องไฟล์ของแท็บอัปโหลดอาจโผล่หลังกดแท็บ — ลองใส่ไฟล์ซ้ำจนกว่าจะเจอ
    let upload
    await wait(async () => {
      upload = await chrome.runtime.sendMessage({ type: 'TIKTOK_SET_COVER', jobId })
      return upload?.ok === true
    }, 'ช่องอัปโหลดภาพปก TikTok', 10_000).catch(() => { throw new Error(upload?.error ?? 'ใส่ไฟล์ภาพปก TikTok ไม่สำเร็จ') })
    await new Promise(resolve => setTimeout(resolve, 1500)) // ให้ TikTok โหลดภาพตัวอย่างก่อน
    const confirm = await wait(() => {
      const current = D.coverDialog(document)
      const node = current && D.coverConfirm(current)
      return D.enabled(node) ? node : null
    }, 'ปุ่มยืนยันภาพปก TikTok', 30_000)
    confirm.click()
    await wait(() => !D.coverDialog(document), 'TikTok บันทึกภาพปก', 30_000)
  }

  async function run(job) {
    let attempt = null
    let cancelled = false
    let phase = 'open'
    const stopBeat = H.heartbeat(job.id, () => { cancelled = true })
    // 5 พ.ย. 2026: กดแท็บอัปโหลดในหน้าต่างภาพปก แล้ว TikTok เปิดหน้าต่างเลือกไฟล์ของ Windows ค้างไว้
    // ระหว่างนั้นหน้าเว็บหยุดทั้งหน้า (ไม่มีสัญญาณกลับ → "ขาดการติดต่อ") — ระบบใส่ไฟล์ผ่าน debugger เองอยู่แล้ว
    // จึงยกเลิกทุกการคลิกที่ช่องเลือกไฟล์ระหว่างทำงาน (คลิกที่ยกเลิกแล้ว browser ไม่เปิดหน้าต่างเลือกไฟล์)
    const blockPicker = (event) => { if (event.target instanceof HTMLInputElement && event.target.type === 'file') event.preventDefault() }
    document.addEventListener('click', blockPicker, true)
    document.documentElement.dataset.dhammaBlockPicker = '1' // ชั้นที่สองในสคริปต์ของหน้าเว็บ (background ฉีดไว้) — ช่องไฟล์ที่ไม่ได้อยู่ในหน้า
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
      await wait(() => document.querySelector('[data-e2e="select_video_button"], input[type="file"]'), 'หน้าอัปโหลด TikTok Studio พร้อมใช้งาน', 60_000)
      if (job.kind === 'tiktok-inspect') return { ok: true, url: location.href, ...D.inspectStudio(document) }
      if (job.kind === 'tiktok-account') return { ok: true, ...await readAccount() }
      if (job.kind !== 'tiktok-post') throw new Error('ไม่รู้จักงาน TikTok นี้')
      attempt = D.claimAttempt(sessionStorage, job.id)
      await assertActive()
      D.assertAccount(await readAccount(), job.payload.username)
      // A fresh dedicated upload page is opened by the worker for every job.
      await wait(() => document.querySelector('input[type="file"]'), 'ช่องเลือกวิดีโอ TikTok')
      phase = 'upload'
      const upload = await chrome.runtime.sendMessage({ type: 'TIKTOK_SET_FILE', jobId: job.id })
      if (!upload?.ok) throw new Error(upload?.error ?? 'ใส่ไฟล์วิดีโอใน TikTok ไม่สำเร็จ')
      const publishReady = () => {
        const error = [...document.querySelectorAll('[role="alert"]')].find(node => /upload failed|couldn.t upload|อัปโหลดไม่สำเร็จ/i.test(D.text(node)))
        if (error) throw new Error(D.text(error))
        const button = D.findButton(document, ['Post', 'Publish', 'โพสต์', 'เผยแพร่'])
        const uploading = [...document.querySelectorAll('[role="progressbar"]')].some(node => D.visible(node) && Number(node.getAttribute('aria-valuenow') ?? 0) < 100)
        return D.enabled(button) && !uploading ? button : null
      }
      await wait(publishReady, 'TikTok ประมวลผลวิดีโอพร้อมแก้ไข', 10 * 60_000)
      phase = 'caption'
      const findEditor = () => [...document.querySelectorAll('[contenteditable="true"], textarea')].find(D.visible)
      await wait(findEditor, 'ช่องคำบรรยาย TikTok', 10 * 60_000)
      const captionText = (node = findEditor()) => String(node?.value ?? node?.innerText ?? node?.textContent ?? '').replace(/\s+/g, ' ').trim()
      const expectedCaption = String(job.payload.caption).replace(/\s+/g, ' ').trim()
      // TikTok เติมชื่อไฟล์ลงช่องคำบรรยายเองหลังประมวลผลวิดีโอ (4 พ.ย. 2026 ได้ "ชื่อไฟล์+คำบรรยาย")
      // → กรอกทับใหม่ (เลือกทั้งหมดแล้วพิมพ์) จนกว่าจะตรง สูงสุด 3 รอบ
      const ensureCaption = async () => {
        for (let round = 0; round < 3; round++) {
          if (captionText() === expectedCaption) return
          const editor = await wait(findEditor, 'ช่องคำบรรยาย TikTok', 30_000)
          editor.focus()
          if (editor.tagName === 'TEXTAREA') {
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor, job.payload.caption)
            editor.dispatchEvent(new Event('input', { bubbles: true }))
          } else {
            const inserted = await chrome.runtime.sendMessage({ type: 'TIKTOK_SET_CAPTION', jobId: job.id })
            if (!inserted?.ok) throw new Error(inserted?.error ?? 'กรอกคำบรรยาย TikTok ไม่สำเร็จ')
          }
          try { return await wait(() => captionText() === expectedCaption, 'ยืนยันคำบรรยาย TikTok', 5000) } catch (error) {
            if (cancelled || !/เกิน/.test(error.message)) throw error // หมดเวลาเท่านั้นที่ลองกรอกใหม่
          }
        }
        throw new Error(`คำบรรยายใน TikTok ไม่ตรงกับที่ส่ง หลังกรอกใหม่ 3 รอบ (ในช่องขึ้นต้นว่า "${captionText().slice(0, 50)}")`)
      }
      await ensureCaption()
      phase = 'settings'
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
      let confirmedAi = false
      await wait(() => {
        let current = D.aiControl(document)
        if (current?.matches('label')) current = current.querySelector('input, [role="switch"], [role="checkbox"]')
        if (current && D.checked(current) === (job.payload.aigc === true)) return true
        const confirm = job.payload.aigc === true && !confirmedAi ? D.aiConfirmation(document) : null
        if (confirm && D.enabled(confirm)) { confirmedAi = true; confirm.click() }
        return false
      }, 'ยืนยันป้ายกำกับ AI ของ TikTok', 5000)
      // ภาพปก — ไม่บังคับ: ทำไม่ได้ก็ปิดหน้าต่างแล้วโพสต์ต่อด้วยปกที่ TikTok เลือกเอง
      let coverError = null
      if (job.payload.cover) {
        phase = 'cover'
        try { await setCover(wait, job.id) } catch (error) {
          if (cancelled) throw error
          coverError = String(error.message)
          // ปิดหน้าต่างภาพปก: กดยกเลิก → ไม่ปิดก็กด Esc แล้วยกเลิกซ้ำ (5 พ.ย. 2026 กดยกเลิกครั้งเดียวแล้วหน้าต่างค้าง)
          // ปิดไม่ได้จริงๆ = หยุดก่อนโพสต์ และบอกสาเหตุที่ตั้งปกไม่ได้ด้วย
          for (let round = 0; round < 3 && D.coverDialog(document); round++) {
            const dialog = D.coverDialog(document)
            const cancel = D.coverCancel(dialog)
            if (round > 0 || !cancel) {
              for (const target of [dialog, document.activeElement, document]) target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
              await new Promise(resolve => setTimeout(resolve, 500))
            }
            D.coverCancel(D.coverDialog(document) ?? dialog)?.click()
            await wait(() => !D.coverDialog(document), 'ปิดหน้าต่างภาพปก TikTok', 5000).catch(() => {})
          }
          if (D.coverDialog(document)) throw new Error(`ตั้งภาพปก TikTok ไม่ได้ (${coverError}) และปิดหน้าต่างภาพปกไม่ได้ — หยุดก่อนโพสต์`)
        }
        phase = 'settings'
      }
      await wait(publishReady, 'TikTok อัปโหลดเสร็จและพร้อมโพสต์', 10 * 60_000)
      // TikTok อาจเติมชื่อไฟล์ทีหลังตอนวิดีโอประมวลผลเสร็จ → ตรวจ/กรอกคำบรรยายอีกรอบก่อนโพสต์
      phase = 'caption'
      await ensureCaption()
      phase = 'settings'
      // กล่องแนะนำของ TikTok ("ดูตัวอย่างวิดีโอบนโทรศัพท์ … เข้าใจแล้ว") บังปุ่มโพสต์ — 4 พ.ย. 2026 กดโพสต์แล้วไม่ไปไหน
      // ต้องปิดให้หมดก่อนกดโพสต์ ปิดไม่ได้ = หยุดก่อนโพสต์ (ลองใหม่ได้ ไม่เสี่ยงโพสต์ซ้ำ)
      if (D.tipDismissButtons(document).length) {
        for (const tip of D.tipDismissButtons(document)) tip.click()
        await wait(() => !D.tipDismissButtons(document).length, 'ปิดกล่องแนะนำของ TikTok ที่บังปุ่มโพสต์', 5000)
      }
      D.assertAccount(await readAccount({ keepOpen: true }), job.payload.username)
      await assertActive()
      if (cancelled) throw new Error('งาน TikTok ถูกยกเลิกแล้ว — หยุดก่อนโพสต์')
      D.assertAccount(D.account(document), job.payload.username)
      closeAccountMenu()
      let finalAi = D.aiControl(document)
      if (finalAi?.matches('label')) finalAi = finalAi.querySelector('input, [role="switch"], [role="checkbox"]')
      const finalEditor = findEditor()
      const post = publishReady()
      const checks = { privacy: !!selectedPrivacy(), ai: !!finalAi && D.checked(finalAi) === (job.payload.aigc === true), publishButton: D.enabled(post) && post.isConnected !== false, caption: !!finalEditor && finalEditor.isConnected !== false && captionText(finalEditor) === expectedCaption, noTips: !D.tipDismissButtons(document).length }
      if (Object.values(checks).some(ok => !ok)) throw new Error(`การตั้งค่า TikTok เปลี่ยนระหว่างอัปโหลด (${Object.keys(checks).filter(key => !checks[key]).join(', ')}) — หยุดก่อนโพสต์`)
      const before = D.publicationSignals(document)
      phase = 'publish'
      attempt.beforePublish()
      post.click() // Exactly one publish action. A missing result must not repeat it.
      const result = await wait(() => D.published(document, job.payload.username, location.href, before), 'TikTok ยืนยันว่าโพสต์สำเร็จ', 90_000)
      attempt.complete(result)
      return { ok: true, ...result, ...(coverError ? { coverError } : {}) }
    } catch (error) {
      let diagnostic
      if (job.kind === 'tiktok-post' || job.payload?.inspect === true) {
        try { diagnostic = D.inspectStudio(document) } catch {}
      }
      return { ok: false, error: String(error.message), phase, needsVerification: error.needsVerification === true || attempt?.submitted === true, ...(diagnostic ? { diagnostic } : {}) }
    } finally { closeAccountMenu(); stopBeat(); document.removeEventListener('click', blockPicker, true); delete document.documentElement.dataset.dhammaBlockPicker }
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
