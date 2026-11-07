// Local bridge adapter. TikTok itself is driven through the signed-in Chrome tab.
export const tiktokUsername = value => {
  const name = String(value ?? '').trim().replace(/^@/, '')
  return /^[a-zA-Z0-9._]{1,24}$/.test(name) ? name.toLowerCase() : null
}

export function tiktokFailure(message, needsVerification = true) {
  return Object.assign(new Error(message), { needsVerification })
}

/** ชื่อไฟล์ที่ TikTok เห็นตอนอัปโหลด — TikTok เอาชื่อไฟล์ (ไม่มีนามสกุล) ไปใส่ช่องคำบรรยายเอง จึงใช้ชื่อโพสต์แทน UUID */
export function tiktokUploadName(title) {
  const clean = String(title ?? '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
  const cut = [...clean].slice(0, 80).join('').replace(/[ .]+$/, '')
  return `${cut || 'video'}.mp4`
}

/**
 * หลังโพสต์: เปิดหน้ารายการโพสต์ใน Studio แล้วดูว่าโพสต์ใหม่ใช้คำบรรยายของเรา หรือ TikTok ใช้ชื่อไฟล์แทน
 * คืน { status: 'ok' | 'filename' | 'unknown', sample? } — ตรวจไม่ได้ = unknown (ไม่นับว่าพลาด)
 */
export async function verifyTikTokCaption({ jobs, enqueue, caption, stems }, { timeoutMs = 3 * 60_000, pollMs = 500 } = {}) {
  const job = enqueue('tiktok', 'tiktok-verify', { caption, stems, noRetry: true })
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const current = jobs.get(job.id)
    if (current) current.watchedAt = Date.now()
    if (!current || current.cancelled || current.status === 'error') return { status: 'unknown' }
    if (current.status === 'done') {
      const meta = current.result?.meta
      return ['ok', 'filename'].includes(meta?.status) ? { status: meta.status, sample: String(meta.sample ?? '') } : { status: 'unknown' }
    }
    if (Date.now() >= deadline) {
      Object.assign(current, { cancelled: true, status: 'error', error: 'ตรวจคำบรรยาย TikTok เกินเวลา' })
      return { status: 'unknown' }
    }
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }
}

export async function runTikTokJob({ jobs, enqueue, payload, onStart }, { timeoutMs = 15 * 60_000, pollMs = 500 } = {}) {
  const job = enqueue('tiktok', 'tiktok-post', { ...payload, noRetry: true })
  onStart?.(job)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const current = jobs.get(job.id)
    if (current) current.watchedAt = Date.now()
    if (!current || current.cancelled || current.status === 'error') {
      throw tiktokFailure(current?.error ?? 'งาน TikTok หายไป — ตรวจใน TikTok ก่อนลองใหม่')
    }
    if (current.status === 'done') {
      const result = current.result?.meta
      if (result?.ok === false) throw tiktokFailure(String(result.error ?? 'TikTok โพสต์ไม่สำเร็จ'), result.needsVerification !== false)
      if (result?.ok !== true || result.published !== true || tiktokUsername(result.username) !== tiktokUsername(payload.username)) {
        throw tiktokFailure('ยังยืนยันไม่ได้ว่า TikTok โพสต์สำเร็จในบัญชีที่เลือก — ตรวจใน TikTok ก่อนลองใหม่')
      }
      let url
      if (result.url) {
        try {
          const parsed = new URL(result.url)
          if (parsed.origin !== 'https://www.tiktok.com' || !new RegExp(`^/@${tiktokUsername(payload.username).replace(/\./g, '\\.')}/video/\\d+/?$`, 'i').test(parsed.pathname)) throw new Error()
          url = parsed.origin + parsed.pathname
        } catch { throw tiktokFailure('ลิงก์โพสต์ TikTok ไม่ตรงกับบัญชีที่เลือก — ตรวจใน TikTok ก่อนลองใหม่') }
      }
      return { ...(url ? { url } : {}), privacy: payload.privacy, published: true, ...(result.coverError ? { coverError: String(result.coverError) } : {}) }
    }
    if (Date.now() >= deadline) {
      Object.assign(current, { cancelled: true, status: 'error', error: 'รอ TikTok เกินเวลา — เปิด Chrome และตรวจบัญชี/โพสต์ก่อนลองใหม่' })
      throw tiktokFailure(current.error)
    }
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }
}
