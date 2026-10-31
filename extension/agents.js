import { SPRITE_REGISTRATION } from './sprite-registration.js'

// สถานะแผนกใช้ภาพและสคริปต์ในส่วนขยายเท่านั้น
export const DEPARTMENTS = [
  // duty = หน้าที่เต็มๆ ขึ้นในป้ายตอนเอาเมาส์ชี้ตัวละคร
  { id: 'chatgpt', name: 'ChatGPT', role: 'เขียนบท · กำกับภาพ', animal: 'พระภิกษุนักเรียบเรียง', duty: 'คิดหัวข้อ เขียนบท แบ่งช็อต และเขียน prompt ภาพทุกช็อต — ทำงานในแท็บ ChatGPT' },
  { id: 'flow', name: 'Google Flow', role: 'วาดภาพ', animal: 'ช่างศิลป์', duty: 'วาดภาพทุกช็อตและภาพปกด้วย Google Flow แบบ 0 credits — ทำงานในแท็บ Flow' },
  { id: 'meta', name: 'Kie API', role: 'ทำแอนิเมชัน', animal: 'ผู้ช่วยจัดฉาก', duty: 'รับภาพฉากสำคัญจาก Google Flow ส่งให้ Kie API ทำแอนิเมชัน แล้วส่งคลิปให้แผนกตัดต่อ — ปิดได้เพื่อใช้ภาพนิ่ง' },
  { id: 'voice', name: 'เสียงพากย์', role: 'ในเครื่อง', animal: 'นักพากย์', duty: 'อ่านบทเป็นเสียงพากย์ แล้วจับเวลาแต่ละประโยค — ทำในเครื่องนี้ ไม่ต้องเปิดเว็บ' },
  { id: 'edit', name: 'ตัดต่อ', role: 'ในเครื่อง', animal: 'ผู้ช่วยตัดต่อ', duty: 'รวมภาพ คลิป เสียงพากย์ เพลง และซับไตเติล เป็นไฟล์วิดีโอ — ทำในเครื่องนี้' },
]
export const AGENT_WORD = { working: 'กำลังทำงาน', waiting: 'รอคิว', idle: 'ว่าง', offline: 'ไม่ได้ต่อ' }
export const HANDOFF = [
  { key: 'script', id: 'chatgpt', label: 'เขียนบท' },
  { key: 'voice', id: 'voice', label: 'เสียง' },
  { key: 'art', id: 'chatgpt', label: 'กำกับภาพ' },
  { key: 'images', id: 'flow', label: 'วาดภาพ' },
  { key: 'clips', id: 'meta', label: 'แอนิเมชัน' },
  { key: 'edit', id: 'edit', label: 'ตัดต่อ' },
]

// ตัวละครวัดไทย 3D: ภาพ 12 เฟรมในตาราง 4×3 เล่นด้วย CSS เท่านั้น
export const SPRITE_COLUMNS = 4
export const SPRITE_ROWS = 3
export const SPRITE_FRAMES = SPRITE_COLUMNS * SPRITE_ROWS
export const TEMPLE_ASSETS = Object.fromEntries(DEPARTMENTS.map(({ id }) => [id, `adult-${id}`]))
// Retain the export consumed by the existing department selector.
export const SEA_ASSETS = TEMPLE_ASSETS

export function spritePosition(index) {
  if (!Number.isInteger(index) || index < 0 || index >= SPRITE_FRAMES) throw new RangeError('Invalid sprite frame')
  return [(index % SPRITE_COLUMNS) * 100 / (SPRITE_COLUMNS - 1), Math.floor(index / SPRITE_COLUMNS) * 100 / (SPRITE_ROWS - 1)]
}

export function spritePose(id, index) {
  spritePosition(index) // Validate the frame before using its registration.
  return (SPRITE_REGISTRATION[id] ?? SPRITE_REGISTRATION.chatgpt)[index]
}

export function spriteKeyframes(id) {
  const declarations = index => {
    const [x,y] = spritePosition(index)
    const pose = spritePose(id,index)
    return `background-position: ${x}% ${y}%; transform: translate(${pose.x}%, ${pose.y}%) scale(${pose.scale});`
  }
  return Array.from({length:SPRITE_FRAMES},(_,index)=>`${index*100/SPRITE_FRAMES}% { ${declarations(index)} }`).join('\n') + `\n100% { ${declarations(0)} }`
}
export const SPRITE_KEYFRAMES = spriteKeyframes('chatgpt')

export function portrait(id) {
  if (!document.getElementById('temple-sprite-frames')) {
    const style = document.createElement('style')
    style.id = 'temple-sprite-frames'
    style.textContent = Object.keys(TEMPLE_ASSETS).map(id =>
      `[data-character='${id}'], .floatMascot[data-agent='${id}'] { --sprite-animation: temple-work-${id}; }\n@keyframes temple-work-${id} { ${spriteKeyframes(id)} }`
    ).join('\n')
    document.head.append(style)
  }
  const span = document.createElement('span')
  span.className = 'sea-portrait temple-portrait'
  span.dataset.character = Object.hasOwn(TEMPLE_ASSETS,id) ? id : 'chatgpt'
  span.setAttribute('aria-hidden', 'true')
  const animal = SEA_ASSETS[id] ?? SEA_ASSETS.chatgpt
  // markup คงที่ ไม่รับ HTML จาก API
  span.innerHTML = `<span class="sea-frame"><span class="sprite-pose"></span><img class="sea-strip" src="agents/${animal}.png" alt="" draggable="false"></span>
    <span class="sea-wait"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h10M7 21h10M8 4v3c0 3 8 7 8 10v3M16 4v3c0 3-8 7-8 10v3"/><path d="M9 18h6"/></svg></span>
    <span class="sea-sweat"><svg viewBox="0 0 20 24" fill="currentColor"><path d="M10 2C7 7 3 12 3 16a7 7 0 0 0 14 0c0-4-4-9-7-14Z"/></svg></span>
    <span class="sea-bubbles"><i></i><i></i></span>`
  const image = span.querySelector('img')
  span.querySelector('.sprite-pose').style.backgroundImage = `url("${image.src}")`
  // รักษาสัดส่วนเฟรมจริง โดยไม่ทำให้ช่องสถานะกระโดด
  const fit = () => {
    if (image.naturalWidth && image.naturalHeight) span.style.setProperty('--sprite-ratio', (image.naturalWidth / SPRITE_COLUMNS) / (image.naturalHeight / SPRITE_ROWS))
  }
  image.addEventListener('load', fit, { once: true })
  if (image.complete) fit()
  return span
}
const el = (tag, className, text = '') => Object.assign(document.createElement(tag), { className, textContent: text })
const text = (node, value) => { if (node.textContent !== value) node.textContent = value }
export const elapsed = (since, now = Date.now()) => {
  const start = typeof since === 'number' ? since : Date.parse(since)
  if (!Number.isFinite(start) || !since) return ''
  const seconds = Math.max(0, Math.floor((now - start) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function createAgentsView(bar, onDetails = () => {}) {
  const rows = new Map()
  const list = bar.querySelector('#agentList')
  const dots = bar.querySelector('#agentDots')
  const summary = bar.querySelector('#agentSummary')
  const scene = bar.querySelector('.agentScene')
  const route = bar.querySelector('#agentRoute')
  const routeCaption = bar.querySelector('#agentRouteCaption')
  const steps = []
  // สร้างครั้งเดียว เก็บ node เดิมไว้เพื่อไม่ให้ท่าทางเริ่มใหม่ทุกรอบ
  for (const d of DEPARTMENTS) {
    const row = el('li', 'agent')
    row.dataset.agent = d.id
    row.dataset.state = 'offline'
    const art = portrait(d.id)
    const who = el('span', 'who', d.name)
    const role = el('span', 'agentRole', d.role)
    const doing = el('span', 'doing')
    const state = el('span', 'agentState')
    const time = el('span', 'time')
    const meta = el('span', 'agentMeta')
    meta.append(state, time)
    const error = el('button', 'agentError', 'มีปัญหา · ดูรายละเอียด')
    error.type = 'button'
    error.hidden = true
    error.addEventListener('click', onDetails)
    row.append(art, who, role, doing, meta, error)
    list.append(row)
    const mini = el('span', 'agent-mini')
    mini.dataset.state = 'offline'
    mini.append(portrait(d.id))
    dots.append(mini)
    rows.set(d.id, { row, mini, doing, state, time, error })
  }
  for (const s of HANDOFF) {
    const step = el('li', 'agentStage')
    step.dataset.stage = s.key
    const art = portrait(s.id)
    const label = el('span', 'stageLabel', s.label)
    const link = el('span', 'stageLink')
    link.setAttribute('aria-hidden', 'true')
    link.append(el('i', 'handoffBubble'), el('i', 'handoffBubble'))
    step.append(art, label, link)
    route.append(step)
    steps.push(step)
  }
  const pause = () => { bar.dataset.hidden = String(document.hidden) }
  document.addEventListener('visibilitychange', pause)
  pause()

  function update(data) {
    const agents = DEPARTMENTS.map(d => ({ ...d, state: 'offline', doing: 'โปรแกรมในเครื่องยังไม่เปิด', ...data?.agents?.find(a => a.id === d.id), animal: d.animal, name: d.name }))
    const auto = data?.autopilot
    const current = HANDOFF.findIndex(s => s.key === auto?.current)
    const failed = auto?.status === 'failed' || auto?.status === 'error'
    const running = auto?.status === 'running' || auto?.status === 'working'
    for (const a of agents) {
      const r = rows.get(a.id)
      const state = Object.hasOwn(AGENT_WORD, a.state) ? a.state : 'offline'
      const problem = a.failed || a.error || (failed && HANDOFF[current]?.id === a.id) || HANDOFF.some(s => s.id === a.id && auto?.departments?.[s.key]?.status === 'failed')
      r.row.dataset.state = state
      r.mini.dataset.state = state
      r.row.dataset.failed = String(Boolean(problem))
      r.mini.dataset.failed = String(Boolean(problem))
      text(r.state, problem ? 'มีปัญหา' : AGENT_WORD[state])
      text(r.doing, a.doing || (state === 'idle' ? 'พร้อมรับงาน' : AGENT_WORD[state]))
      r.doing.title = a.doing || ''
      const time = state === 'working' || state === 'waiting' ? elapsed(a.since) : ''
      text(r.time, time)
      r.time.title = time ? `ใช้เวลา ${time}` : ''
      r.error.hidden = !problem
      const label = `${a.animal} · ${a.name}: ${problem ? 'มีปัญหา' : AGENT_WORD[state]} · ${r.doing.textContent}${time ? ' · ใช้เวลา ' + time : ''}`
      r.row.setAttribute('aria-label', label)
      r.mini.title = label
    }
    route.hidden = !auto
    routeCaption.hidden = !auto
    route.dataset.running = String(running && !failed)
    for (let i = 0; i < steps.length; i++) {
      const stage = steps[i]
      stage.dataset.state = i === current ? (running ? 'working' : 'idle') : 'idle'
      stage.dataset.current = String(i === current)
      stage.dataset.failed = String(failed && i === current)
      stage.dataset.transfer = String(running && !failed && i === current - 1)
      if (i === current) stage.setAttribute('aria-current', 'step')
      else stage.removeAttribute('aria-current')
      stage.setAttribute('aria-label', `${HANDOFF[i].label}${i === current ? failed ? ' · มีปัญหา' : ' · ขั้นปัจจุบัน' : ''}`)
    }
    const stageName = HANDOFF[current]?.label ?? 'เริ่มงาน'
    text(routeCaption, failed ? `ติดที่${stageName} · กดดูรายละเอียดด้านล่าง` : auto?.status === 'done' ? 'ทำคลิปเสร็จแล้ว' : current > 0 ? `ส่งต่อ: ${HANDOFF[current - 1].label} → ${stageName}` : `ตอนนี้: ${stageName}`)
    const working = agents.filter(a => a.state === 'working')
    const waiting = agents.filter(a => a.state === 'waiting')
    const allOffline = agents.every(a => a.state === 'offline')
    const status = failed ? 'มีปัญหา' : auto?.status === 'done' ? 'ทำเสร็จแล้ว' : working.length ? working.map(a => a.name).join(', ') : waiting.length ? 'มีงานรอคิว' : allOffline ? 'ไม่ได้ต่อ' : 'ว่าง'
    text(summary, auto ? `${auto.title || 'ทำคลิปอัตโนมัติ'} · ${status}` : `ใครทำอะไรอยู่ · ${status}`)
    summary.title = summary.textContent
    scene.dataset.active = String(working.length > 0)
  }
  update(null)
  return { update }
}
