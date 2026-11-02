/** Keep the pipeline in charge of attempts: each bridge job finishes before navigating accounts. */
export async function generateWithFailover({ payload, runJob, promptFor, onProgress, onSwitch = () => {} }) {
  const allShots = payload.shots
  const files = new Map()
  const tried = new Set()
  let request = payload
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await runJob({ agent: 'flow', kind: 'generate-images', payload: request, timeoutMs: 100 * 60000, onProgress })
    // The bridge returns paths only after PARTIAL has actually been written to disk.
    for (const file of result.files ?? []) {
      const name = file.name ?? String(file).split(/[\\/]/).pop()
      if (allShots.some(s => s.filename === name)) files.set(name, file)
    }
    const quota = result.meta?.flowQuota
    const remaining = allShots.filter(s => !files.has(s.filename))
    if (!quota && result.meta?.recovered && remaining.length) {
      request = { ...request, shots: remaining, prompt: promptFor(remaining), projectUrl: result.meta.projectUrl, newProject: false }
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
    request = { ...payload, shots: remaining, prompt: promptFor(remaining), projectUrl: null, newProject: true, expectedAccount: next.meta.email }
  }
  throw new Error('FLOW_ACCOUNTS_EXHAUSTED: สลับบัญชี Flow ถึงจำนวนสูงสุดแล้ว')
}
