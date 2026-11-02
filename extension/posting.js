// งานประชาสัมพันธ์ · โหมดโพสต์อัตโนมัติ — หน้าจอในแผงข้าง
// คุยกับ bridge ที่ /api/posting* เท่านั้น (ดู bridge/posting.js) · ไม่แตะสถานะของขั้นทำคลิป
// โทเค็นเพจ/ช่องไม่เคยถูกส่งกลับมาหน้านี้ — bridge ส่งมาแค่ 4 ตัวท้าย

const GULL_SVG = `<svg class="gullIcon" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 35 24 26v26L9 43Zm15-9 24-12v50L24 52M12 44v11h8V49M48 24l8-4m-8 25 8 4M54 34h6"/></svg>`

const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue
    if (key.startsWith('aria-') || key.startsWith('data-')) node.setAttribute(key, value === true ? '' : value)
    else if (key === 'on') for (const [ev, fn] of Object.entries(value)) node.addEventListener(ev, fn)
    else node[key] = value
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false))
  return node
}

const fmtWhen = (ms) => (ms ? new Date(ms).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '')
const fmtDur = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '')
/** ค่าให้ <input type=datetime-local> (เวลาเครื่อง) */
const toLocalInput = (ms) => {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * กด "เชื่อมต่อ" (Drive/YouTube) แล้วต้องบันทึก Google client ที่กรอกไว้ก่อนไหม
 *   typed — ค่าในช่องตอนนี้ · saved — ค่าที่ bridge มี (secret เป็นแบบปิดบัง ••••xxxx)
 *   คืน {} = เชื่อมต่อได้เลย · {save} = บันทึกค่านี้ก่อน · {error} = กรอกไม่ครบ
 */
export function clientToSave(typed, saved = {}) {
  const clientId = String(typed.clientId ?? '').trim()
  const clientSecret = String(typed.clientSecret ?? '').trim()
  const newSecret = !!clientSecret && !clientSecret.startsWith('••••')
  if (saved.ready && clientId === saved.clientId && !newSecret) return {}
  if (!clientId && !newSecret) return { error: 'ใส่ Client ID และ Client secret ก่อน แล้วกดเชื่อมต่ออีกครั้ง' }
  if (!clientId) return { error: 'ใส่ Client ID ด้วย (ลงท้ายด้วย .apps.googleusercontent.com)' }
  if (!newSecret && !saved.clientSecret) return { error: 'ใส่ Client secret ด้วย (ขึ้นต้นด้วย GOCSPX-)' }
  return { save: { clientId, clientSecret } }
}

/** ＋ เพิ่มเวลา: เวลาที่เสนอให้ — ต่อจากเวลาสุดท้าย 3 ชั่วโมง (วนข้ามเที่ยงคืน) ไม่ซ้ำของเดิม */
export function suggestSlot(slots) {
  const mins = slots.map((s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }).sort((a, b) => a - b)
  if (!mins.length) return '12:00'
  const taken = new Set(mins)
  let t = mins.at(-1)
  for (let i = 0; i < 8; i++) {
    t = (t + 180) % 1440
    if (!taken.has(t)) break
  }
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

export function initPosting({ api, localApp }) {
  const root = document.getElementById('posting')
  const body = document.getElementById('postingBody')
  const statusEl = document.getElementById('postingStatus')
  let app = null
  let data = null
  let tab = 'review'
  let timer = null
  let busy = false
  const openVideos = new Set() // id ของคลิปที่กางดูวิดีโอไว้ — คงไว้ข้ามการวาดใหม่
  const openCats = new Set() // บัญชีที่กางรายการหมวดไว้
  const catTimers = new Map()
  const drafts = new Map() // id → {title, description, hashtags} ที่พิมพ์ค้างยังไม่บันทึก
  const saveTimers = new Map()

  function setStatus(text, kind = '') {
    statusEl.className = 'status' + (kind === 'error' ? ' err' : kind === 'ok' ? ' ok' : '')
    statusEl.textContent = ''
    if (kind === 'busy') statusEl.append(el('span', { className: 'spinner' }))
    statusEl.append(text)
  }

  async function call(path, payload, okText) {
    if (busy && payload) return
    busy = !!payload
    try {
      if (payload) setStatus('กำลังบันทึก…', 'busy')
      data = await api(app, path, payload)
      if (payload) setStatus(okText ?? 'บันทึกแล้ว', 'ok')
      render()
      return data
    } catch (err) {
      setStatus(err.message, 'error')
      throw err
    } finally {
      busy = false
    }
  }

  /** startTab — เปิดที่แท็บไหน (เช่น 'posted' จากบรรทัด "โพสต์ล่าสุด") · ไม่ส่ง = แท็บเดิม */
  async function open(startTab) {
    if (startTab) tab = startTab
    root.hidden = false
    document.getElementById('closePosting').focus()
    setStatus('กำลังโหลด…', 'busy')
    try {
      app = await localApp()
      data = await api(app, '/api/posting')
      setStatus('')
      render()
    } catch (err) {
      setStatus(err.message, 'error')
    }
    clearInterval(timer)
    timer = setInterval(refresh, 6000)
  }

  function close() {
    root.hidden = true
    clearInterval(timer)
  }

  /** ดึงสถานะใหม่เป็นระยะ — ไม่วาดทับตอนผู้ใช้กำลังพิมพ์/เลือกอยู่ */
  async function refresh() {
    if (root.hidden || busy || !app) return
    const active = document.activeElement
    if (active && root.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return
    if (saveTimers.size || catTimers.size) return
    if (typedUnsaved()) return
    try {
      data = await api(app, '/api/posting')
      render()
    } catch {}
  }

  // ── ชื่อเพจ/ช่องจากรหัสปลายทาง ──
  function targetList() {
    return [
      ...(data?.facebook ?? []).map((a) => ({ key: `fb:${a.id}`, kind: 'fb', name: a.name })),
      ...(data?.youtube ?? []).filter((a) => a.connected).map((a) => ({ key: `yt:${a.id}`, kind: 'yt', name: a.name })),
    ]
  }
  const targetName = (key) => targetList().find((t) => t.key === key)?.name ?? 'บัญชีที่ถูกลบ'
  const kindTag = (kind) => el('span', { className: `kind ${kind}` }, kind === 'fb' ? 'FB' : 'YT')

  // ── วาดทั้งหน้า ──
  function render() {
    if (!data) return
    const items = data.queue ?? []
    const groups = {
      review: items.filter((q) => q.status === 'review'),
      scheduled: items.filter((q) => q.status === 'scheduled' || q.status === 'posting').sort((a, b) => (a.scheduleAt ?? 0) - (b.scheduleAt ?? 0)),
      posted: items.filter((q) => q.status === 'posted' || q.status === 'failed').sort((a, b) => (b.postedAt ?? b.addedAt) - (a.postedAt ?? a.addedAt)),
      rejected: items.filter((q) => q.status === 'rejected'),
    }
    const failed = groups.posted.filter((q) => q.status === 'failed').length
    const on = !!data.settings.enabledAt
    const accounts = targetList().length

    const hero = el('div', { className: 'pHero' })
    hero.insertAdjacentHTML('afterbegin', GULL_SVG)
    hero.append(
      el('div', {},
        el('h3', {}, 'ประชาสัมพันธ์ · เผยแพร่สื่อธรรมะ'),
        el('p', {}, el('span', { className: `pState${on ? '' : ' off'}` }, on ? 'เปิดอยู่' : 'ปิดอยู่'), on ? ' · คลิปที่ทำเสร็จเข้าคิวรอตรวจเอง' : ' · เปิดได้ในแท็บตั้งค่า'),
        el('p', {}, accounts ? `${accounts} ปลายทาง` : 'ยังไม่มีเพจหรือช่อง', data.nextSlot ? ` · ช่องเวลาว่างถัดไป ${fmtWhen(data.nextSlot)}` : '', data.uploading ? ' · กำลังอัปโหลด…' : ''),
      ),
    )

    const tabs = el('div', { className: 'seg pTabs', role: 'tablist', 'aria-label': 'รายการโพสต์' },
      ...[
        ['review', 'รอตรวจ', groups.review.length],
        ['scheduled', 'ตั้งเวลาแล้ว', groups.scheduled.length],
        ['posted', 'โพสต์แล้ว', groups.posted.length, failed],
        ['settings', 'ตั้งค่า', null],
      ].map(([id, label, n, warn]) =>
        el('button', { type: 'button', role: 'tab', 'aria-pressed': String(tab === id), 'aria-selected': String(tab === id), on: { click: () => { tab = id; render() } } },
          label, n != null ? el('span', { className: warn ? 'n bad' : 'n', title: warn ? `${n} คลิป · โพสต์พลาด ${warn}` : undefined }, warn ? `พลาด ${warn}` : String(n)) : null),
      ),
    )

    let panel
    if (tab === 'review') panel = renderReview(groups.review, groups.rejected)
    else if (tab === 'scheduled') panel = renderScheduled(groups.scheduled)
    else if (tab === 'posted') panel = renderPosted(groups.posted)
    else panel = renderSettings()

    body.replaceChildren(hero, tabs, statusEl, panel)
    // จำค่าตอนวาด — ใช้บอกว่าผู้ใช้พิมพ์อะไรค้างไว้ที่ยังไม่บันทึก
    for (const i of fieldsOf(body)) i.dataset.saved = i.value
  }

  // ช่องข้อความในหน้าตั้งค่า (Page ID, โทเค็น, Client ID/secret, ช่องเวลา)
  const fieldsOf = (node) => node.querySelectorAll('input[type=text], input[type=password]')
  /** มีค่าที่พิมพ์/วางไว้แต่ยังไม่บันทึก — วาดใหม่อัตโนมัติจะลบทิ้ง (เคยลบ Client ID ที่วางไว้ทุก 6 วินาที) */
  // เฉพาะแท็บตั้งค่า — ช่องในแท็บรอตรวจบันทึกเองอยู่แล้ว (drafts/saveTimers)
  const typedUnsaved = () => tab === 'settings' && [...fieldsOf(body)].some((i) => i.dataset.saved !== undefined && i.value !== i.dataset.saved)

  /**
   * ปุ่มเชื่อมต่อ Drive/YouTube: บันทึก Google client ที่กรอกไว้ให้ก่อน (ไม่ต้องหาปุ่มบันทึกเอง) แล้วเปิดหน้าขอสิทธิ์
   * note — ข้อความใต้ปุ่ม ผู้ใช้เห็นทันที (บรรทัดสถานะอยู่บนสุดของหน้า มือถือมองไม่เห็น)
   *        หาใหม่ทุกครั้ง เพราะบันทึกสำเร็จแล้วหน้าถูกวาดใหม่
   */
  async function saveThenConnect({ typed, saved, savePath, connectPath, waitText, note }) {
    const show = (text) => {
      const msg = body.querySelector(`[data-note="${note}"]`)
      if (msg) Object.assign(msg, { textContent: text, hidden: !text })
      if (text) setStatus(text, 'error')
    }
    const plan = clientToSave(typed, saved)
    if (plan.error) return show(plan.error)
    try {
      show('')
      if (plan.save) await call(savePath, plan.save, 'บันทึก Google client แล้ว')
      const { url } = await api(app, connectPath, {})
      setStatus(waitText, 'busy')
      chrome.tabs.create({ url })
    } catch (err) {
      show(err.message) // call() วาดหน้าใหม่ไม่ได้ตอนล้ม — ช่องที่กรอกและข้อความนี้ยังอยู่
    }
  }

  // ── รอตรวจ ──
  function renderReview(list, rejected) {
    const wrap = el('div', { className: 'pList' })
    if (!targetList().length) {
      wrap.append(el('p', { className: 'pWarn' }, 'ยังไม่มีเพจ Facebook หรือช่อง YouTube — เพิ่มในแท็บตั้งค่าก่อน ถึงจะอนุมัติโพสต์ได้'))
    }
    wrap.append(renderLibrary())
    if (!list.length) wrap.append(el('p', { className: 'pEmpty' }, data.settings.enabledAt ? 'ยังไม่มีคลิปรอตรวจ — คลิปที่ทำเสร็จจะมาอยู่ที่นี่เอง' : 'ยังไม่มีคลิปรอตรวจ — เปิดโหมดในแท็บตั้งค่า หรือเพิ่มคลิปจากคลังด้านบน'))
    const ul = el('ul', { className: 'pList' }, list.map(reviewCard))
    wrap.append(ul)
    if (rejected.length) {
      wrap.append(el('details', {},
        el('summary', {}, `ตีกลับ (${rejected.length})`),
        el('ul', { className: 'pList', style: 'margin-top:8px' }, rejected.map((q) => el('li', { className: 'pCard' },
          head(q),
          el('div', { className: 'pActions' },
            el('button', { type: 'button', className: 'ghost', on: { click: () => call('/api/posting/restore', { id: q.id }, 'ดึงกลับมารอตรวจแล้ว') } }, '↩ ดึงกลับมารอตรวจ'),
            el('button', { type: 'button', className: 'ghost', on: { click: () => call('/api/posting/remove', { id: q.id }, 'เอาออกจากคิวแล้ว') } }, 'เอาออกจากคิว'),
          ))))))
    }
    return wrap
  }

  function renderLibrary() {
    const lib = data.library ?? []
    return el('details', { className: 'pBox' },
      el('summary', {}, `＋ เพิ่มคลิปจากคลังวิดีโอ (${lib.length})`),
      lib.length
        ? el('ul', { className: 'pList pLibrary' }, lib.map((v) => el('li', {},
          v.thumb ? el('img', { className: 'pThumb', src: `${app.url}${v.thumb.slice(1)}&k=${app.token}`, alt: '', loading: 'lazy' }) : el('span', { className: 'pThumb' }),
          el('span', {}, v.title),
          el('button', { type: 'button', className: 'ghost', on: { click: () => call('/api/posting/add', { slug: v.slug, file: v.file }, `เพิ่ม "${v.title}" เข้าคิวแล้ว`) } }, 'เพิ่ม'),
        )))
        : el('p', { className: 'hint' }, 'คลิปทุกเรื่องในคลังอยู่ในคิวแล้ว'),
    )
  }

  function head(q, extra = []) {
    const thumb = q.thumb ? el('img', { className: 'pThumb', src: `${app.url}${q.thumb.slice(1)}&k=${app.token}`, alt: '', loading: 'lazy' }) : el('span', { className: 'pThumb' })
    return el('div', { className: 'pHead' }, thumb,
      el('div', {},
        el('p', { className: 'pTitle' }, q.title),
        el('p', { className: 'pMeta' }, [fmtDur(q.seconds), `เข้าคิว ${fmtWhen(q.addedAt)}`].filter(Boolean).join(' · ')),
        el('div', { className: 'pBadges' }, q.category ? el('span', { className: 'pBadge gold' }, q.category) : null, aiBadge(q), driveBadge(q), q.missing ? el('span', { className: 'pBadge bad' }, 'ไม่พบไฟล์วิดีโอ') : null, ...extra),
      ))
  }

  /** สถานะคลิปบน Google Drive — แสดงเฉพาะตอนเชื่อมต่อ Drive แล้ว */
  function driveBadge(q) {
    const d = q.drive
    if (d?.fileId) return el('a', { className: 'pBadge pass', href: d.link, target: '_blank', rel: 'noopener', title: 'เปิดไฟล์ใน Google Drive' }, 'อยู่บน Drive ↗')
    if (d?.removedAt) return el('span', { className: 'pBadge', title: 'อยู่ในถังขยะของ Drive 30 วัน' }, 'ลบจาก Drive แล้ว')
    if (!data.settings.drive?.connected) return null
    if (d?.error) return el('span', { className: 'pBadge bad', title: d.error }, 'ขึ้น Drive ไม่สำเร็จ')
    if (d?.uploading) return el('span', { className: 'pBadge gold' }, 'กำลังขึ้น Drive…')
    if (['review', 'scheduled', 'failed'].includes(q.status)) return el('span', { className: 'pBadge' }, 'รอขึ้น Drive')
    return null
  }

  function aiBadge(q) {
    const ai = q.ai
    if (!ai) return el('span', { className: 'pBadge' }, 'AI ยังไม่ตรวจ')
    if (ai.status === 'running') return el('span', { className: 'pBadge gold' }, 'AI กำลังตรวจ…')
    if (ai.status === 'error') return el('span', { className: 'pBadge bad' }, 'AI ตรวจไม่สำเร็จ')
    return el('span', { className: `pBadge ${ai.verdict === 'pass' ? 'pass' : 'fix'}` }, `AI ${ai.verdict === 'pass' ? 'ให้ผ่าน' : 'แนะนำให้แก้'} ${ai.score}/100`)
  }

  function aiBlock(q) {
    const ai = q.ai
    const recheck = (label) => el('button', { type: 'button', className: 'ghost', disabled: q.missing, on: { click: () => call('/api/posting/check', { id: q.id }, 'ส่งให้ AI ตรวจแล้ว — รอ ChatGPT ตอบราว 1 นาที').catch(() => {}) } }, label)
    if (!ai) return el('div', { className: 'pAi' }, el('p', {}, 'ให้ ChatGPT ดูภาพจากคลิป 8 ภาพ + บท + ข้อความโพสต์ แล้วบอกจุดที่ควรแก้'), recheck('🤖 ให้ AI ตรวจ'))
    if (ai.status === 'running') return el('div', { className: 'pAi' }, el('p', {}, el('span', { className: 'spinner' }), 'ChatGPT กำลังดูคลิปนี้ (ในแท็บ ChatGPT) …'))
    if (ai.status === 'error') return el('div', { className: 'pAi' }, el('p', { className: 'status err' }, ai.error), recheck('ลองตรวจใหม่'))
    return el('div', { className: 'pAi' },
      el('p', {}, el('strong', {}, ai.verdict === 'pass' ? '✓ ' : '⚠ '), ai.summary || (ai.verdict === 'pass' ? 'ไม่พบปัญหาร้ายแรง' : 'มีจุดที่ควรแก้')),
      ai.issues?.length ? el('ul', {}, ai.issues.map((s) => el('li', {}, s))) : null,
      recheck('ตรวจใหม่'),
    )
  }

  function videoBlock(q) {
    const d = el('details', { open: openVideos.has(q.id) }, el('summary', {}, 'ดูคลิป'))
    const mount = () => {
      if (!d.open || d.querySelector('video') || !q.video) return
      d.append(el('video', { controls: true, preload: 'metadata', src: `${app.url}${q.video.slice(1)}&k=${app.token}` }))
    }
    d.addEventListener('toggle', () => {
      if (d.open) openVideos.add(q.id)
      else openVideos.delete(q.id)
      mount()
    })
    mount()
    return d
  }

  /** บันทึกข้อความโพสต์ที่แก้ (หน่วง 700 ms หลังหยุดพิมพ์) */
  function queueSave(q) {
    clearTimeout(saveTimers.get(q.id))
    saveTimers.set(q.id, setTimeout(async () => {
      saveTimers.delete(q.id)
      const post = drafts.get(q.id)
      if (!post) return
      try {
        data = await api(app, '/api/posting/item', { id: q.id, post })
        drafts.delete(q.id)
        setStatus('บันทึกข้อความโพสต์แล้ว', 'ok')
      } catch (err) {
        setStatus(err.message, 'error')
      }
    }, 700))
  }

  async function flush(q) {
    if (!saveTimers.has(q.id)) return
    clearTimeout(saveTimers.get(q.id))
    saveTimers.delete(q.id)
    const post = drafts.get(q.id)
    if (post) data = await api(app, '/api/posting/item', { id: q.id, post })
    drafts.delete(q.id)
  }

  function postForm(q) {
    const draft = drafts.get(q.id) ?? { title: q.post?.title ?? '', description: q.post?.description ?? '', hashtags: (q.post?.hashtags ?? []).join(' ') }
    const edit = (field, value) => {
      drafts.set(q.id, { ...(drafts.get(q.id) ?? draft), [field]: value })
      queueSave(q)
    }
    const titleInput = el('input', { type: 'text', value: draft.title, maxLength: 200, on: { input: (e) => edit('title', e.target.value) } })
    const options = (q.post?.titles ?? []).filter(Boolean)
    const chips = options.length > 1
      ? el('div', { className: 'pTitles', role: 'group', 'aria-label': 'ชื่อที่ ChatGPT เสนอ' }, options.map((t) => el('button', {
        type: 'button', 'aria-pressed': String(t === draft.title),
        on: { click: (e) => { titleInput.value = t; edit('title', t); e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))) } },
      }, t)))
      : null
    const noText = !q.post?.title && !q.post?.description
    return el('div', { className: 'pList', style: 'gap:8px' },
      noText ? el('p', { className: 'pWarn' }, 'คลิปนี้ยังไม่มีข้อความโพสต์ — พิมพ์เอง หรือกด "คิดชื่อคลิป + คำบรรยาย" ในคลังวิดีโอ') : null,
      el('label', { className: 'pField' }, 'ชื่อโพสต์ (YouTube ใช้ได้ไม่เกิน 100 ตัวอักษร)', titleInput, chips),
      el('label', { className: 'pField' }, 'คำบรรยาย', el('textarea', { value: draft.description, maxLength: 5000, on: { input: (e) => edit('description', e.target.value) } })),
      el('label', { className: 'pField' }, 'แฮชแท็ก (เว้นวรรคระหว่างแท็ก)', el('input', { type: 'text', value: draft.hashtags, on: { input: (e) => edit('hashtags', e.target.value) } })),
    )
  }

  /** หมวดของคลิป — AI ระบุตอนตรวจ หรือเลือกเอง · ใช้เลือกเพจ/ช่องที่รับหมวดนี้ */
  function categoryPicker(q) {
    const select = el('select', {
      'aria-label': 'หมวดของคลิป',
      on: { change: (e) => call('/api/posting/item', { id: q.id, category: e.target.value || null }, 'เปลี่ยนหมวดแล้ว').catch(() => {}) },
    },
    el('option', { value: '', selected: !q.category }, '— ยังไม่รู้หมวด —'),
    (data.categories ?? []).map((c) => el('option', { value: c, selected: q.category === c }, c)))
    const by = q.category ? (q.categoryBy === 'ai' ? ' · AI ระบุ' : ' · เลือกเอง') : q.ai ? '' : ' · AI จะระบุให้ตอนตรวจ'
    return el('label', { className: 'pField' }, `หมวดของคลิป${by}`, select)
  }

  function targetPicker(q) {
    const all = targetList()
    if (!all.length) return el('p', { className: 'hint' }, 'ยังไม่มีเพจหรือช่อง — เพิ่มในแท็บตั้งค่า')
    const chosen = new Set(q.targets ?? [])
    return el('fieldset', { className: 'pField', style: 'border:0;padding:0;margin:0' },
      el('legend', { style: 'padding:0;margin-bottom:4px' }, 'โพสต์ลง',
        q.targetsEdited
          ? el('span', {}, ' · เลือกเอง ', el('button', { type: 'button', className: 'linkBtn', on: { click: () => call('/api/posting/item', { id: q.id, resetTargets: true }, 'เลือกปลายทางตามหมวดแล้ว').catch(() => {}) } }, 'เลือกตามหมวด'))
          : el('span', {}, q.category ? ' · เลือกตามหมวดให้แล้ว' : ' · เพจ/ช่องที่รับทุกหมวด')),
      el('div', { className: 'pTargets' }, all.map((t) => el('label', { className: 'pTarget' },
        el('input', {
          type: 'checkbox', checked: chosen.has(t.key),
          on: { change: (e) => {
            if (e.target.checked) chosen.add(t.key)
            else chosen.delete(t.key)
            call('/api/posting/item', { id: q.id, targets: [...chosen] }, 'บันทึกปลายทางแล้ว').catch(() => {})
          } },
        }),
        kindTag(t.kind), t.name))),
    )
  }

  function reviewCard(q) {
    const when = el('input', { type: 'datetime-local', value: toLocalInput(q.scheduleAt ?? data.nextSlot ?? Date.now() + 3600_000) })
    const approve = async (whenValue, label) => {
      try {
        await flush(q)
        await call('/api/posting/approve', { id: q.id, when: whenValue }, label)
      } catch {}
    }
    const nextLabel = data.nextSlot ? `✓ อนุมัติ · ${fmtWhen(data.nextSlot)}` : '✓ อนุมัติ · ช่องเวลาถัดไป'
    return el('li', { className: 'pCard' },
      head(q),
      aiBlock(q),
      videoBlock(q),
      postForm(q),
      categoryPicker(q),
      targetPicker(q),
      el('div', { className: 'pActions' },
        el('button', { type: 'button', className: 'primary', disabled: q.missing, on: { click: () => approve('next', 'อนุมัติแล้ว · ลงช่องเวลาถัดไป') } }, nextLabel),
      ),
      el('div', { className: 'pWhen' },
        el('label', { className: 'pField' }, 'หรือเลือกเวลาเอง', when),
        el('button', { type: 'button', className: 'ghost', disabled: q.missing, on: { click: () => approve(new Date(when.value).getTime(), 'อนุมัติแล้ว · ตั้งเวลาตามที่เลือก') } }, 'อนุมัติตามเวลานี้'),
        el('button', { type: 'button', className: 'ghost', disabled: q.missing, on: { click: () => { if (confirm(`โพสต์ "${q.title}" ตอนนี้เลยไหม?`)) approve('now', 'กำลังโพสต์…') } } }, 'โพสต์ทันที'),
      ),
      el('div', { className: 'pActions' },
        el('button', { type: 'button', className: 'ghost', on: { click: () => { const reason = prompt('ตีกลับเพราะอะไร (เว้นว่างได้)'); if (reason !== null) call('/api/posting/reject', { id: q.id, reason }, 'ตีกลับแล้ว').catch(() => {}) } } }, '✕ ตีกลับ'),
      ),
    )
  }

  // ── ตั้งเวลาแล้ว ──
  function renderScheduled(list) {
    if (!list.length) return el('p', { className: 'pEmpty' }, 'ยังไม่มีคลิปที่ตั้งเวลา — อนุมัติคลิปในแท็บรอตรวจก่อน')
    return el('ul', { className: 'pList' }, list.map((q) => {
      const posting = q.status === 'posting'
      const when = el('input', { type: 'datetime-local', value: toLocalInput(q.scheduleAt) })
      return el('li', { className: 'pCard' },
        head(q, [el('span', { className: 'pBadge gold' }, posting ? 'กำลังโพสต์…' : `โพสต์ ${fmtWhen(q.scheduleAt)}`)]),
        el('div', { className: 'pTargets' }, (q.targets ?? []).map((k) => el('span', { className: 'pTarget' }, kindTag(k.slice(0, 2)), targetName(k)))),
        !q.targets?.length ? el('p', { className: 'pWarn' }, 'ยังไม่มีเพจหรือช่องปลายทาง — กดยกเลิกเวลา แล้วเลือกหมวดและเพจในแท็บรอตรวจ ก่อนตั้งเวลาใหม่') : null,
        el('p', { className: 'pMeta' }, q.post?.title ?? ''),
        posting
          ? el('p', { className: 'status' }, el('span', { className: 'spinner' }), 'กำลังอัปโหลด — อย่าปิดโปรแกรมในเครื่อง')
          : el('div', { className: 'pWhen' },
            el('label', { className: 'pField' }, 'เปลี่ยนเวลา', when),
            el('button', { type: 'button', className: 'ghost', disabled: !q.targets?.length, on: { click: () => call('/api/posting/approve', { id: q.id, when: new Date(when.value).getTime() }, 'เปลี่ยนเวลาแล้ว').catch(() => {}) } }, 'บันทึกเวลา'),
            el('button', { type: 'button', className: 'ghost', disabled: !q.targets?.length, on: { click: () => { if (confirm(`โพสต์ "${q.title}" ตอนนี้เลยไหม?`)) call('/api/posting/approve', { id: q.id, when: 'now' }, 'กำลังโพสต์…').catch(() => {}) } } }, 'โพสต์ตอนนี้'),
            el('button', { type: 'button', className: 'ghost', on: { click: () => call('/api/posting/unschedule', { id: q.id }, 'ยกเลิกเวลาแล้ว กลับไปรอตรวจ').catch(() => {}) } }, 'ยกเลิกเวลา'),
          ),
      )
    }))
  }

  // ── โพสต์แล้ว / พลาด ──
  function renderPosted(list) {
    if (!list.length) return el('p', { className: 'pEmpty' }, 'ยังไม่มีคลิปที่โพสต์')
    return el('ul', { className: 'pList' }, list.map((q) => {
      const fail = q.status === 'failed'
      return el('li', { className: `pCard ${fail ? 'fail' : 'done'}` },
        head(q, [el('span', { className: `pBadge ${fail ? 'bad' : 'pass'}` }, fail ? 'โพสต์ไม่สำเร็จ' : `โพสต์แล้ว ${fmtWhen(q.postedAt)}`)]),
        el('ul', { className: 'pResults' }, (q.targets ?? []).map((k) => {
          const r = q.results?.[k]
          return el('li', {}, kindTag(k.slice(0, 2)), el('strong', {}, r?.name ?? targetName(k)),
            r?.ok ? el('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'เปิดโพสต์ ↗') : el('span', { className: 'err' }, r?.error ?? 'ยังไม่ได้โพสต์'),
            r?.ok && r.privacy && r.privacy !== 'public' ? el('span', { className: 'pBadge fix' }, r.privacy === 'private' ? 'ส่วนตัว' : 'ไม่เป็นสาธารณะ') : null)
        })),
        // บอกเหตุผลเมื่อไม่มีปลายทางไหนแสดงผล (เช่น ไม่มีเพจ/ช่องเลย หรือผลเก่าเป็นของเพจที่ลบไปแล้ว)
        fail && q.error && !(q.targets ?? []).some((k) => q.results?.[k]) ? el('p', { className: 'status err' }, q.error) : null,
        el('div', { className: 'pActions' },
          fail ? el('button', { type: 'button', className: 'primary', on: { click: () => call('/api/posting/retry', { id: q.id }, 'กำลังลองโพสต์ใหม่ (เฉพาะที่พลาด)…').catch(() => {}) } }, '↻ ลองโพสต์ใหม่เฉพาะที่พลาด') : null,
          el('button', { type: 'button', className: 'ghost', on: { click: () => call('/api/posting/remove', { id: q.id }, 'เอาออกจากรายการแล้ว').catch(() => {}) } }, 'เอาออกจากรายการ'),
        ),
      )
    }))
  }

  // ── ตั้งค่า + บัญชี ──
  /** หมวดที่เพจ/ช่องรับ — ไม่ติ๊กเลย = รับทุกหมวด · บันทึกเองหลังหยุดติ๊ก 0.6 วิ */
  function catPicker(kind, a) {
    const key = `${kind}:${a.id}`
    const cats = new Set(a.categories ?? [])
    const summaryText = () => (cats.size ? `รับ ${cats.size} หมวด: ${[...cats].slice(0, 2).join(', ')}${cats.size > 2 ? ' …' : ''}` : 'รับคลิปทุกหมวด')
    const summary = el('summary', {}, summaryText())
    const save = () => {
      summary.textContent = summaryText()
      clearTimeout(catTimers.get(key))
      catTimers.set(key, setTimeout(async () => {
        catTimers.delete(key)
        try {
          data = await api(app, '/api/posting/account/categories', { kind, id: a.id, categories: [...cats] })
          setStatus(`บันทึกหมวดของ ${a.name} แล้ว — คลิปที่รอตรวจถูกเลือกปลายทางใหม่ตามหมวด`, 'ok')
          render()
        } catch (err) {
          setStatus(err.message, 'error')
        }
      }, 600))
    }
    const boxes = (data.categories ?? []).map((c) => el('label', { className: 'pCat' },
      el('input', { type: 'checkbox', checked: cats.has(c), on: { change: (e) => { if (e.target.checked) cats.add(c); else cats.delete(c); save() } } }), c))
    const d = el('details', { className: 'pCats', open: openCats.has(key) }, summary,
      el('p', { className: 'hint' }, 'ติ๊กหมวดที่ให้ลงบัญชีนี้ — ไม่ติ๊กเลย = ลงทุกหมวด · คลิปที่ AI ยังไม่ระบุหมวดจะลงเฉพาะบัญชีที่รับทุกหมวด'),
      el('div', { className: 'pCatGrid' }, boxes),
      el('button', { type: 'button', className: 'ghost', on: { click: () => { cats.clear(); boxes.forEach((b) => { b.querySelector('input').checked = false }); save() } } }, 'ล้าง = รับทุกหมวด'))
    d.addEventListener('toggle', () => (d.open ? openCats.add(key) : openCats.delete(key)))
    return d
  }

  // Google ขึ้น "redirect_uri_mismatch" = สร้าง client เป็นแบบ Web application (Desktop app รับที่อยู่ 127.0.0.1 ทุกพอร์ตเอง)
  const redirectHelp = () => el('li', {}, 'ขึ้น "redirect_uri_mismatch" (คำขอของแอปนี้ไม่ถูกต้อง) = เลือกประเภทผิดเป็น Web application → สร้างใหม่เป็น Desktop app แล้ววาง Client ID/secret ใหม่ · หรือเพิ่ม Authorized redirect URI ของ client เดิมเป็น ',
    el('code', {}, data.redirectUri ?? 'http://127.0.0.1:<พอร์ต>'), ' (ไม่มี / ท้าย)')

  function renderSettings() {
    const s = data.settings
    const toggle = (key, label, help, checked) => el('label', { className: 'pSwitch' },
      el('input', { type: 'checkbox', checked, on: { change: (e) => call('/api/posting/settings', { [key]: e.target.checked }, 'บันทึกแล้ว').catch(() => {}) } }),
      el('span', {}, label, el('small', {}, help)))
    // ช่องเวลาประจำวัน: ตาราง เลือกเวลา/ลบ/เพิ่ม แล้วบันทึกเองทันที (bridge เรียงและตัดตัวซ้ำให้)
    const list = s.slots ?? []
    const saveSlots = (next, ok) => call('/api/posting/settings', { slots: next }, ok).catch(() => {})
    const slotTable = el('div', { className: 'pSlotBox' },
      el('div', { className: 'pSlotHead' }, 'เวลาโพสต์ประจำวัน', el('small', {}, 'โพสต์ทุกวันตามเวลาเหล่านี้ · แก้แล้วบันทึกเอง')),
      el('ol', { className: 'pSlots' }, list.map((t, i) => el('li', {},
        el('span', { className: 'pSlotN' }, `ช่อง ${i + 1}`),
        el('input', {
          type: 'time', value: t, step: 300, required: true, 'aria-label': `เวลาช่อง ${i + 1}`,
          on: { change: (e) => { if (e.target.value) saveSlots(list.map((x, j) => (j === i ? e.target.value : x)), `เปลี่ยนเป็น ${e.target.value} น. แล้ว`) } },
        }),
        el('button', {
          type: 'button', className: 'ghost pSlotDel', 'aria-label': `ลบเวลา ${t}`, title: list.length <= 1 ? 'ต้องมีอย่างน้อย 1 เวลา' : `ลบเวลา ${t}`,
          disabled: list.length <= 1,
          on: { click: () => saveSlots(list.filter((_, j) => j !== i), `ลบเวลา ${t} แล้ว`) },
        }, '✕'),
      ))),
      el('button', { type: 'button', className: 'ghost', on: { click: () => { const t = suggestSlot(list); saveSlots([...list, t], `เพิ่มเวลา ${t} น. แล้ว — แตะที่เวลาเพื่อเปลี่ยนได้`) } } }, '＋ เพิ่มเวลา'),
    )

    // ปุ่มเดียวแทนการเปิด 3 สวิตช์เอง: เปิดโหมด + AI ตรวจเอง + อนุมัติเองเมื่อ AI ให้ผ่าน
    const allAuto = !!s.enabledAt && !!s.autoApprove && (!!s.autoCheck || !!s.skipCheck)
    const fullAuto = el('label', { className: 'pSwitch pMain' },
      el('input', {
        type: 'checkbox', checked: allAuto,
        on: { change: (e) => call('/api/posting/settings', e.target.checked ? { enabled: true, autoCheck: true, autoApprove: true } : { autoApprove: false },
          e.target.checked ? 'เปิดออโต้ทั้งหมดแล้ว — คลิปที่ผลิตเสร็จจะตรวจและโพสต์เองตามเวลาโพสต์' : 'ปิดออโต้แล้ว — คลิปที่ AI ให้ผ่านจะรอคนกดอนุมัติ').catch(() => {}) },
      }),
      el('span', {}, '🤖 ออโต้ทั้งหมด',
        el('small', {}, s.skipCheck && allAuto
          ? 'ผลิตเสร็จเข้าคิวเอง → โพสต์ตามเวลาโพสต์ (ไม่ตรวจ) ไปทุกเพจ/ช่องที่รับหมวดของคลิป · ไม่มีข้อความโพสต์ให้ ChatGPT เขียนให้ · โพสต์แล้วแจ้งเตือนว่าไปไหนบ้าง'
          : 'ผลิตเสร็จเข้าคิวเอง → AI ตรวจ → ผ่านแล้วโพสต์ตามเวลาโพสต์ ไปทุกเพจ/ช่องที่รับหมวดของคลิป · ไม่ผ่านรอคนดู · ไม่มีข้อความโพสต์ให้ ChatGPT เขียนให้ · โพสต์แล้วแจ้งเตือนว่าไปไหนบ้าง')))

    // ตรวจก่อนโพสต์ (เฉพาะตอนออโต้) — ไม่ตรวจ = ได้เวลาโพสต์ทันที · คลิปที่ AI เคยบอกให้แก้ยังรอคนดู
    const skip = !!s.skipCheck
    const checkMode = allAuto ? el('div', { className: 'pCheckMode' },
      el('span', { className: 'pCheckHead' }, 'ตรวจก่อนโพสต์'),
      el('div', { className: 'seg', role: 'group', 'aria-label': 'ตรวจก่อนโพสต์' },
        [[false, '🔍 AI ตรวจ'], [true, '⚡ ไม่ตรวจ — โพสต์เลย']].map(([value, label]) => el('button', {
          type: 'button', 'aria-pressed': String(skip === value),
          on: { click: () => { if (skip !== value) call('/api/posting/settings', { skipCheck: value }, value ? 'ไม่ตรวจแล้ว — คลิปเข้าคิวแล้วได้เวลาโพสต์เลย' : 'กลับมาให้ AI ตรวจก่อนโพสต์แล้ว').catch(() => {}) } },
        }, label))),
      skip
        ? el('p', { className: 'pWarn' }, 'คลิปเข้าคิวแล้วได้เวลาโพสต์เลย ไม่มีใครดูก่อน — ถ้าภาพเพี้ยนหรือเสียงหายจะขึ้นเพจไปเลย · คลิปที่ AI เคยบอกให้แก้ยังรอคนดู · ผลิตต่อเนื่องทำตามโหมดที่เลือกในหน้านั้น')
        : el('small', {}, 'AI ดูเฟรมและบทก่อน ผ่านแล้วโพสต์ ไม่ผ่านรอคนดู (ปลอดภัยกว่า แต่ช้ากว่าเพราะตรวจทีละคลิป)'),
    ) : null

    const mode = el('section', { className: 'pBox', 'aria-label': 'การทำงาน' },
      el('h3', {}, 'การทำงาน'),
      fullAuto,
      checkMode,
      toggle('enabled', 'เปิดโหมดโพสต์อัตโนมัติ', 'คลิปที่ทำเสร็จหลังจากนี้เข้าคิวรอตรวจเอง (คลิปเก่าเพิ่มจากคลังได้)', !!s.enabledAt),
      toggle('autoPull', 'ดึงคลิปจากคลังเอง', `เติมคิวให้มีคลิปรอโพสต์ครบทุกเวลาโพสต์ของวัน (ตอนนี้ ${(s.slots ?? []).length} เวลา) · หยิบคลิปที่เก่าที่สุดที่ยังไม่เคยเข้าคิวก่อน · คลิปที่ตีกลับหรือเอาออกจะไม่ถูกดึงกลับมา`, !!s.autoPull),
      toggle('autoCheck', 'ให้ AI ตรวจเองเมื่อคลิปเข้าคิว', 'ใช้ ChatGPT ในแท็บเดิม · ตรวจเฉพาะตอนไม่มีงานทำคลิปค้างอยู่ ไม่แย่งคิว', !!s.autoCheck),
      toggle('autoApprove', 'อนุมัติเองเมื่อ AI ให้ผ่าน', 'คลิปที่ AI ให้ผ่านลงช่องเวลาถัดไปเลยโดยไม่ต้องกด — ปิดไว้ถ้าอยากดูทุกคลิปก่อน', !!s.autoApprove),
      slotTable,
      el('p', { className: 'hint' }, 'โปรแกรมในเครื่องต้องเปิดอยู่ตอนถึงเวลาโพสต์ — ถ้าปิดไว้ คลิปจะโพสต์ทันทีที่เปิดโปรแกรมครั้งถัดไป'),
    )

    // Facebook
    const pageId = el('input', { type: 'text', inputMode: 'numeric', placeholder: 'เช่น 102345678901234', autocomplete: 'off' })
    const pageToken = el('input', { type: 'password', placeholder: 'EAAB…', autocomplete: 'off' })
    const pageName = el('input', { type: 'text', placeholder: 'เว้นว่าง = ใช้ชื่อเพจจริง' })
    const fb = el('section', { className: 'pBox', 'aria-label': 'Facebook Page' },
      el('h3', {}, kindTag('fb'), 'Facebook Page'),
      data.facebook.length
        ? el('ul', { className: 'pAccounts' }, data.facebook.map((a) => el('li', {},
          el('strong', {}, a.name), el('span', { className: 'pMeta' }, `ID ${a.pageId} · โทเค็น ${a.token}`),
          el('button', { type: 'button', className: 'ghost', on: { click: () => { if (confirm(`ลบเพจ "${a.name}" ออกจากโหมดโพสต์? (โทเค็นจะถูกลบจากเครื่องนี้)`)) call('/api/posting/facebook/remove', { id: a.id }, 'ลบเพจแล้ว').catch(() => {}) } } }, 'ลบ'),
          catPicker('facebook', a))))
        : el('p', { className: 'hint' }, 'ยังไม่มีเพจ'),
      el('div', { className: 'pGrid2' },
        el('label', { className: 'pField' }, 'Page ID', pageId),
        el('label', { className: 'pField' }, 'ชื่อเรียก (ไม่บังคับ)', pageName),
      ),
      el('label', { className: 'pField' }, 'Page access token', pageToken),
      el('button', {
        type: 'button', className: 'primary',
        on: { click: async () => {
          try {
            await call('/api/posting/facebook', { pageId: pageId.value.trim(), token: pageToken.value.trim(), name: pageName.value.trim() }, 'ตรวจโทเค็นผ่าน · บันทึกเพจแล้ว')
          } catch {}
        } },
      }, 'ตรวจโทเค็นและบันทึกเพจ'),
      el('details', {}, el('summary', {}, 'หา Page ID และ Page access token ยังไง'),
        el('ol', {},
          el('li', {}, 'Page ID: เปิดเพจ → เกี่ยวกับ (About) → ความโปร่งใสของเพจ จะเห็นรหัสเพจเป็นตัวเลข'),
          el('li', {}, 'สร้างแอปที่ developers.facebook.com (ประเภท Business) แล้วเปิด Graph API Explorer'),
          el('li', {}, 'เลือกแอป → Get Page Access Token → ติ๊กสิทธิ์ pages_show_list, pages_read_engagement, pages_manage_posts → เลือกเพจ'),
          el('li', {}, 'อยากให้โทเค็นไม่หมดอายุ: แลกเป็น long-lived user token ใน Access Token Debugger ก่อน แล้วค่อยขอ Page token จากโทเค็นนั้น'),
          el('li', {}, 'คัดลอกโทเค็นของเพจมาวางด้านบน — เก็บไว้ในเครื่องนี้เท่านั้น ไม่ขึ้น GitHub ไม่อยู่ในแพ็กเกจลูกค้า'),
        )),
    )

    // YouTube
    const g = s.google
    const clientId = el('input', { type: 'text', value: g.clientId ?? '', placeholder: '….apps.googleusercontent.com', autocomplete: 'off' })
    const clientSecret = el('input', { type: 'password', value: g.clientSecret ?? '', placeholder: 'GOCSPX-…', autocomplete: 'off' })
    const yt = el('section', { className: 'pBox', 'aria-label': 'YouTube' },
      el('h3', {}, kindTag('yt'), 'ช่อง YouTube'),
      data.youtube.length
        ? el('ul', { className: 'pAccounts' }, data.youtube.map((a) => el('li', {},
          el('strong', {}, a.name),
          el('select', {
            'aria-label': `การมองเห็นของคลิปใน ${a.name}`,
            on: { change: (e) => call('/api/posting/youtube/update', { id: a.id, privacy: e.target.value }, 'บันทึกแล้ว').catch(() => {}) },
          }, [['public', 'สาธารณะ'], ['unlisted', 'ไม่เป็นสาธารณะ'], ['private', 'ส่วนตัว']].map(([v, t]) => el('option', { value: v, selected: a.privacy === v }, t))),
          a.connected ? null : el('span', { className: 'pBadge bad' }, 'ต้องเชื่อมต่อใหม่'),
          el('button', { type: 'button', className: 'ghost', on: { click: () => { if (confirm(`ลบช่อง "${a.name}" ออกจากโหมดโพสต์?`)) call('/api/posting/youtube/remove', { id: a.id }, 'ลบช่องแล้ว').catch(() => {}) } } }, 'ลบ'),
          catPicker('youtube', a))))
        : el('p', { className: 'hint' }, 'ยังไม่มีช่อง'),
      el('button', {
        type: 'button', className: 'primary',
        on: { click: () => saveThenConnect({
          typed: { clientId: clientId.value, clientSecret: clientSecret.value }, saved: g,
          savePath: '/api/posting/google', connectPath: '/api/posting/youtube/connect', note: 'yt',
          waitText: 'เลือกบัญชี/ช่องในแท็บที่เปิดขึ้น แล้วกดอนุญาต — เสร็จแล้วกลับมาที่นี่',
        }) },
      }, '＋ เชื่อมต่อช่อง YouTube'),
      el('p', { className: 'pWarn', 'data-note': 'yt', role: 'alert', hidden: true }),
      g.ready ? null : el('p', { className: 'hint' }, 'กรอก Google Client ID และ Client secret ด้านล่าง แล้วกดเชื่อมต่อได้เลย'),
      el('div', { className: 'pGrid2' },
        el('label', { className: 'pField' }, 'Google Client ID', clientId),
        el('label', { className: 'pField' }, 'Client secret', clientSecret),
      ),
      el('button', { type: 'button', className: 'ghost', on: { click: () => call('/api/posting/google', { clientId: clientId.value.trim(), clientSecret: clientSecret.value.trim() }, 'บันทึก Google client แล้ว').catch(() => {}) } }, 'บันทึก Google client'),
      el('details', {}, el('summary', {}, 'สร้าง Google OAuth client ยังไง'),
        el('ol', {},
          el('li', {}, 'เข้า console.cloud.google.com → สร้างโปรเจกต์ใหม่'),
          el('li', {}, 'APIs & Services → Library → เปิด YouTube Data API v3'),
          el('li', {}, 'OAuth consent screen → External → ใส่ชื่อแอป + อีเมล → เพิ่มอีเมลตัวเองเป็น Test user'),
          el('li', {}, 'Credentials → Create credentials → OAuth client ID → ประเภท Desktop app → คัดลอก Client ID และ Client secret มาวาง'),
          redirectHelp(),
          el('li', {}, 'กด Publish app ในหน้า consent screen (เป็น In production) — ถ้าค้างเป็น Testing การเชื่อมต่อช่องจะหมดอายุทุก 7 วัน'),
        )),
      el('p', { className: 'pWarn' }, 'ข้อจำกัดของ YouTube: โปรเจกต์ Google ที่ยังไม่ผ่านการตรวจ (audit) จะถูกล็อกคลิปที่อัปโหลดผ่าน API เป็น "ส่วนตัว" และโควตาฟรีอัปโหลดได้ราววันละ 6 คลิป — ยื่นตรวจได้ที่หน้า YouTube API Services Audit'),
    )

    // Google Drive — Google client ของตัวเอง แยกจาก YouTube (อาจคนละบัญชี/คนละโปรเจกต์)
    const dr = s.drive ?? { connected: false }
    const dc = s.driveClient ?? { ready: false }
    const driveId = el('input', { type: 'text', value: dc.clientId ?? '', placeholder: '….apps.googleusercontent.com', autocomplete: 'off' })
    const driveSecret = el('input', { type: 'password', value: dc.clientSecret ?? '', placeholder: 'GOCSPX-…', autocomplete: 'off' })
    const connectDrive = () => saveThenConnect({
      typed: { clientId: driveId.value, clientSecret: driveSecret.value }, saved: dc,
      savePath: '/api/posting/drive/client', connectPath: '/api/posting/drive/connect', note: 'drive',
      waitText: 'เลือกบัญชี Google ในแท็บที่เปิดขึ้น แล้วกดอนุญาต — เสร็จแล้วกลับมาที่นี่',
    })
    const driveBox = el('section', { className: 'pBox', 'aria-label': 'Google Drive' },
      el('h3', {}, el('span', { className: 'kind drive' }, 'DR'), 'Google Drive · ที่พักคลิป'),
      el('p', { className: 'hint' }, 'คลิปที่เข้าคิวจะอัปขึ้นโฟลเดอร์ "ธรรมะ Auto · รอโพสต์" เอง และย้ายไปถังขยะของ Drive เมื่อโพสต์ครบทุกที่ (รวมคลิปที่ตีกลับหรือเอาออกจากคิว) — ไฟล์ในเครื่องไม่ถูกลบ'),
      dr.connected
        ? el('ul', { className: 'pAccounts' }, el('li', {},
          el('strong', {}, dr.email || dr.name),
          dr.folderLink ? el('a', { href: dr.folderLink, target: '_blank', rel: 'noopener', className: 'ghost' }, 'เปิดโฟลเดอร์ ↗') : el('span', { className: 'pMeta' }, 'สร้างโฟลเดอร์ตอนอัปคลิปแรก'),
          el('button', { type: 'button', className: 'ghost', on: { click: () => { if (confirm('เลิกเชื่อมต่อ Google Drive? คลิปที่อยู่บน Drive แล้วจะไม่ถูกลบเอง ต้องลบในโฟลเดอร์เอง')) call('/api/posting/drive/remove', {}, 'เลิกเชื่อมต่อ Drive แล้ว').catch(() => {}) } } }, 'เลิกเชื่อมต่อ')))
        : el('button', { type: 'button', className: 'primary', on: { click: connectDrive } }, '＋ เชื่อมต่อ Google Drive'),
      dr.connected ? el('button', { type: 'button', className: 'ghost', on: { click: connectDrive } }, 'เปลี่ยนบัญชี / เชื่อมต่อใหม่') : null,
      el('p', { className: 'pWarn', 'data-note': 'drive', role: 'alert', hidden: true }),
      dc.ready ? null : el('p', { className: 'hint' }, 'กรอก Client ID และ Client secret ของ Drive ด้านล่าง แล้วกดเชื่อมต่อได้เลย'),
      el('div', { className: 'pGrid2' },
        el('label', { className: 'pField' }, 'Drive · Client ID', driveId),
        el('label', { className: 'pField' }, 'Drive · Client secret', driveSecret),
      ),
      el('button', { type: 'button', className: 'ghost', on: { click: () => call('/api/posting/drive/client', { clientId: driveId.value.trim(), clientSecret: driveSecret.value.trim() }, 'บันทึก Google client ของ Drive แล้ว').catch(() => {}) } }, 'บันทึก Google client ของ Drive'),
      el('details', {}, el('summary', {}, 'สร้าง Google client สำหรับ Drive ยังไง'),
        el('ol', {},
          el('li', {}, 'เข้า console.cloud.google.com ด้วยบัญชีที่จะเก็บคลิป (จะเป็นบัญชีเดียวกับ YouTube หรือคนละบัญชีก็ได้)'),
          el('li', {}, 'สร้างโปรเจกต์ (หรือใช้โปรเจกต์เดิม) → APIs & Services → Library → เปิด Google Drive API'),
          el('li', {}, 'OAuth consent screen → External → เพิ่มอีเมลบัญชีที่จะเก็บคลิปเป็น Test user แล้วกด Publish app'),
          el('li', {}, 'Credentials → Create credentials → OAuth client ID → Desktop app → คัดลอก Client ID และ Client secret มาวางด้านบน'),
          redirectHelp(),
        )),
      el('p', { className: 'hint' }, 'สิทธิ์ที่ขอเห็นได้เฉพาะไฟล์ที่โปรแกรมนี้อัปเอง ไม่เห็นไฟล์อื่นใน Drive · เปลี่ยน Client ID แล้วต้องกดเชื่อมต่อใหม่'),
    )

    return el('div', { className: 'pList' }, mode, fb, yt, driveBox)
  }

  document.getElementById('closePosting').addEventListener('click', close)
  document.getElementById('refreshPosting').addEventListener('click', () => refresh())
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close()
  })
  // กลับมาจากแท็บเชื่อมต่อ Google → ดึงรายการช่องใหม่
  window.addEventListener('focus', () => refresh())

  return { open }
}
