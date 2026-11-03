// The real Flow agent rejected a 26-image command (its reported cap was 24).
// Use the same conservative size as the content driver's retry commands.
export const FLOW_BATCH_SIZE = 10

/** Keep batches and account changes serialized; completion means files written by the bridge. */
export async function generateWithFailover({ payload, runJob, promptFor, onProgress, onSwitch = () => {} }) {
  const allShots = payload.shots
  const files = new Map()
  const tried = new Set()
  const batch = shots => shots.slice(0, FLOW_BATCH_SIZE)
  const prompt = shots => {
    if (typeof promptFor !== 'function') throw new Error('ขาดตัวสร้าง prompt ของชุดภาพ Flow — หยุดก่อนส่งรายการเกินขนาด')
    return promptFor(shots)
  }
  const first = batch(allShots)
  let request = typeof promptFor === 'function' || allShots.length > FLOW_BATCH_SIZE ? { ...payload, shots: first, prompt: prompt(first) } : payload
  let currentProject = payload.projectUrl
  for (let attempt = 0; attempt < allShots.length + 20; attempt++) {
    const committed = files.size
    const result = await runJob({ agent: 'flow', kind: 'generate-images', payload: request, timeoutMs: 100 * 60000, onProgress: p => {
      if (p.projectUrl) currentProject = p.projectUrl
      onProgress?.({ ...p, ...(p.done != null ? { done: committed + Math.max(0, Math.min(request.shots.length, Number(p.done) || 0)) } : {}), total: allShots.length })
    } })
    currentProject = result.meta?.projectUrl ?? currentProject
    // The bridge returns paths only after PARTIAL has actually been written to disk.
    for (const file of result.files ?? []) {
      const name = file.name ?? String(file).split(/[\\/]/).pop()
      if (request.shots.some(s => s.filename === name)) files.set(name, file)
    }
    const quota = result.meta?.flowQuota
    const remaining = allShots.filter(s => !files.has(s.filename))
    const batchComplete = request.shots.every(s => files.has(s.filename))
    if (!quota && remaining.length && (result.meta?.recovered || batchComplete)) {
      if (files.size === committed) throw new Error('Flow ไม่ได้ส่งไฟล์ภาพเพิ่ม — หยุดก่อนสั่งชุดเดิมวนซ้ำ')
      let project
      try { project = new URL(currentProject) } catch {}
      if (project?.origin !== 'https://flow.google.com' || !/\/project\//.test(project.pathname)) throw new Error('Flow ไม่ได้ส่ง URL โปรเจกต์ของชุดภาพกลับมา — หยุดก่อนใช้โปรเจกต์ผิดคลิป')
      const shots = batch(remaining)
      request = { ...request, shots, prompt: prompt(shots), projectUrl: project.href, newProject: false }
      continue
    }
    if (!quota || !remaining.length) {
      const { flowQuota: _quota, ...meta } = result.meta ?? {}
      return { ...result, files: [...files.values()], meta: { ...meta, generated: files.size, expected: allShots.length, named: files.size } }
    }
    if (!quota.email || tried.has(quota.email.toLowerCase())) throw new Error('FLOW_ACCOUNTS_EXHAUSTED: Flow กลับบัญชีเดิมที่ติดลิมิต — หยุดเพื่อไม่สลับวน')
    tried.add(quota.email.toLowerCase())
    onSwitch(quota, remaining.length)
    let next
    try {
      next = await runJob({ agent: 'flow', kind: 'flow-switch-account', payload: { limitedEmail: quota.email, retryAt: quota.retryAt, reason: quota.reason, excludedEmails: [...tried] }, timeoutMs: 2 * 60000, onProgress })
    } catch (error) {
      throw new Error(`FLOW_ACCOUNTS_EXHAUSTED: สลับบัญชี Flow ต่อไม่ได้ — ${error.message}`)
    }
    if (next.meta?.exhausted) throw new Error(`FLOW_ACCOUNTS_EXHAUSTED: บัญชี Flow ที่ล็อกอินไว้ติดลิมิตครบแล้ว — รอโควต้าคืน${next.meta.retryAt ? ` (ตรวจใหม่หลัง ${new Date(next.meta.retryAt).toLocaleString('th-TH')})` : ''}`)
    if (!next.meta?.email || tried.has(next.meta.email.toLowerCase())) throw new Error('FLOW_ACCOUNTS_EXHAUSTED: ยืนยันบัญชี Flow ใหม่ไม่ได้ — หยุดก่อนส่งคำสั่งสร้างภาพ')
    const shots = batch(remaining)
    currentProject = null
    request = { ...payload, shots, prompt: prompt(shots), projectUrl: null, newProject: true, expectedAccount: next.meta.email }
  }
  throw new Error('Flow ทำชุดภาพไม่คืบหน้าภายในจำนวนรอบที่กำหนด — เก็บไฟล์ที่ได้แล้วและหยุดรอ')
}
