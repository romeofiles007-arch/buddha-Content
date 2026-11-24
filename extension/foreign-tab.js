/**
 * แท็บที่เปิดอยู่เป็นงานของระบบอื่นไหม — แผงข้างของ extension โชว์คู่กับทุกแท็บ
 * ผู้ใช้ติดตั้งธรรมะ Auto กับ Cartoon Auto ในโปรไฟล์ Chrome เดียวกัน เห็นแผงธรรมะคู่กับโปรเจกต์ Flow ของ Cartoon
 * (ภูเขาไฟโตบา · 24 พ.ย. 2026) แล้วเข้าใจว่าธรรมะทำคลิปทั่วไปที่ไม่มีหมวดนี้ → แผงต้องบอกตรงๆ ว่าแท็บนี้ไม่ใช่ของเรา
 *
 * ดูสองอย่าง:
 *  1. ป้ายเจ้าของแท็บ (tab-claim.js) ของระบบอื่นที่ยังทำงานอยู่ → บอกชื่อระบบนั้นได้
 *  2. โปรเจกต์ Google Flow ที่ไม่อยู่ในรายการโปรเจกต์ของคลิปธรรมะ (bridge /api/flow-projects)
 * อ่านรายการไม่ได้ (โปรแกรมในเครื่องปิดอยู่) → ไม่เตือน ดีกว่าเตือนผิด
 */
import { CLAIM_TTL_MS } from './tab-claim.js'

const AI_SITE = /^https:\/\/(chatgpt\.com|chat\.openai\.com|flow\.google\.com|labs\.google)\//i
const FLOW_SITE = /^https:\/\/(flow\.google\.com|labs\.google)\//i
const PROJECT_ID = /\/project\/([0-9a-f][0-9a-f-]{7,})/i

export const flowProjectId = (url) => (FLOW_SITE.test(url ?? '') ? url.match(PROJECT_ID)?.[1]?.toLowerCase() ?? null : null)

/**
 * @returns {null | { owner: string | null }} null = ไม่ต้องเตือน · owner = ชื่อระบบที่ถือแท็บอยู่ (รู้ชื่อเมื่อมีป้าย)
 */
export function foreignTab({ url, claim, ownId, ownProjects, now = Date.now() }) {
  if (!AI_SITE.test(url ?? '')) return null
  const live = claim?.id && now - Number(claim.at || 0) < CLAIM_TTL_MS
  if (live && claim.id === ownId) return null
  if (live) return { owner: claim.name || null }
  const id = flowProjectId(url)
  if (!id || !ownProjects) return null
  return ownProjects.has(id) ? null : { owner: null }
}

export function foreignTabText(found) {
  if (found.owner) {
    return `${found.owner} กำลังใช้แท็บนี้อยู่ — แผงข้างของธรรมะโชว์คู่กับทุกแท็บจึงเห็นด้วยกัน · ธรรมะ Auto ไม่ได้ทำงานในแท็บนี้`
  }
  return 'โปรเจกต์ Google Flow นี้ไม่ได้สร้างจากคลิปของธรรมะ Auto — เป็นของ Cartoon Auto หรือระบบอื่นที่ติดตั้งในโปรไฟล์ Chrome เดียวกัน · แผงข้างโชว์คู่กับทุกแท็บจึงเห็นด้วยกัน ธรรมะ Auto ทำเฉพาะคลิปพุทธศาสนา'
}
