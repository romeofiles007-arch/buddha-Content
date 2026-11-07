/**
 * แผนกนกนางนวล — โหมดโพสต์อัตโนมัติบน bridge
 *
 *   คลิปทำเสร็จ → เข้าคิว "รอตรวจ" → AI ตรวจ (ChatGPT ผ่านหน้าเว็บ) + คนตรวจ → อนุมัติ + ตั้งเวลา → โพสต์ Facebook Page / YouTube
 *
 * แยกจากขั้นทำคลิปทั้งหมด: อ่านคลิปจากคลังวิดีโอเท่านั้น ไม่แก้ไฟล์ของ project
 * งาน AI ตรวจเข้าคิว ChatGPT เดียวกับขั้นอื่น (ทุกงานเปิดแชตใหม่ จึงไม่ปนกัน) และตรวจเองเฉพาะตอนคิว ChatGPT ว่าง — ไม่หน่วงการทำคลิป
 * bridge ต้องเปิดอยู่ตอนถึงเวลาโพสต์ (คนโพสต์คือเครื่องนี้)
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve, sep, basename } from 'node:path'
import { randomBytes } from 'node:crypto'
import { ROOT } from '../pipeline/lib/config.mjs'
import { run } from '../pipeline/lib/ffmpeg.mjs'
import { clipSource, readPost, postPrompt, parsePost, savePost } from '../pipeline/lib/post.mjs'
import {
  POSTING_DIR, loadAccounts, updateAccounts, publicAccounts, allTargets, findTarget, newId, cleanSlots, targetsFor, cleanCategories, CATEGORIES, AI_CATEGORIES, clipCategory,
  loadQueue, saveQueue, newItem, postFromFile, cleanHashtags, videosToEnroll, clipsToPull, caption, nextFreeSlot, dueItems,
  frameTimes, qcPrompt, parseQc, STATUS, nextDriveUpload, driveToTrash, postingEvents, lastPosted, STORY_EVERY, storyDue, postsSinceStory,
  loadPosted, recordPosted, backfillPosted, clipKey, onePerPlatform, platformOf, PLATFORM_NAME, takenFor, nextSlotFor, readyItems, reorganizeQueue, multiAccountPlatforms, slotsFor, nextSlotForItem,
} from '../pipeline/lib/posting.mjs'
import { facebookPageInfo, facebookUpload, facebookStory, facebookPhotoStory, youtubeAuthUrl, youtubeConnect, youtubeUpload, DRIVE_SCOPES, driveConnect, driveUpload, driveTrash } from '../pipeline/lib/social.mjs'
import { listVideos } from './videos.js'
import { runTikTokJob, tiktokUsername } from '../pipeline/lib/tiktok-browser.mjs'
import { prepareRiddleStory } from '../pipeline/lib/riddle.mjs'
import { createDeliveryLedger, stageDelivery, stageCover, deliveryDestination, importDeliveryHistory } from '../pipeline/lib/delivery-ledger.mjs'

const PROJECTS = join(ROOT, 'projects')
const TICK_MS = 30_000
const MIN_POST_GAP_MS = 30 * 60_000
/** เวลาที่โพสต์สำเร็จล่าสุด (ทุกปลายทาง) — ใช้เว้นระยะไม่ให้โพสต์รัว */
function lastPostAt(queue) {
  let last = 0
  for (const q of queue) {
    for (const r of Object.values(q.results ?? {})) if (r?.ok && Number(r.at) > last) last = Number(r.at)
    if (Number(q.postedAt) > last) last = Number(q.postedAt)
  }
  return last
}
const ENROLL_EVERY_MS = 2 * 60_000
const OAUTH_TTL_MS = 15 * 60_000

export function createPosting({ jobs, enqueue, json, readBody, log, port, token, pipelineBusy = () => false, scheduler = true, deps = {} }) {
  const fb = { info: deps.facebookPageInfo ?? facebookPageInfo, upload: deps.facebookUpload ?? facebookUpload, story: deps.facebookStory ?? facebookStory, photoStory: deps.facebookPhotoStory ?? facebookPhotoStory }
  const yt = { connect: deps.youtubeConnect ?? youtubeConnect, upload: deps.youtubeUpload ?? youtubeUpload }
  const drive = { connect: deps.driveConnect ?? driveConnect, upload: deps.driveUpload ?? driveUpload, trash: deps.driveTrash ?? driveTrash }
  const videosOf = deps.listVideos ?? listVideos
  const prepareCover = deps.stageCover ?? stageCover
  const prepareRiddle = deps.prepareRiddleStory ?? prepareRiddleStory
  const redirectUri = `http://127.0.0.1:${port}`
  const oauthStates = new Map() // state → { expires, kind: 'youtube' | 'drive' }
  let uploading = false
  let driveBusy = false
  let ticking = false
  let lastEnroll = 0
  let tiktokConnection = null
  const deliveries = createDeliveryLedger(POSTING_DIR)
  let historySeeded = null
  // สมุดบันทึกห้ามโพสต์ซ้ำ: คลิปที่โพสต์ไปก่อนมีกฎนี้ → เติมจากผลโพสต์ในคิว
  try {
    const added = backfillPosted(loadQueue())
    if (added) log(`โพสต์อัตโนมัติ: บันทึกคลิปที่เคยโพสต์แล้ว ${added} รายการ (กฎห้ามโพสต์ซ้ำในแพลตฟอร์มเดิม)`)
  } catch (err) {
    log(`โพสต์อัตโนมัติ: อ่านประวัติการโพสต์ไม่ได้ — ${err.message}`)
  }

  // โปรแกรมถูกปิดกลางการโพสต์ → ไม่รู้ว่าขึ้นไปแล้วหรือยัง ห้ามโพสต์ซ้ำเอง ให้คนดูในเพจก่อนกดลองใหม่
  {
    const queue = loadQueue()
    let changed = false
    for (const q of queue) {
      if (q.status === 'posting') {
        const interrupted = jobs.get(q.tiktokJobId)
        if (interrupted) Object.assign(interrupted, { cancelled: true, status: 'error', error: 'โปรแกรมถูกปิดระหว่างโพสต์ TikTok — ตรวจในบัญชีก่อนลองใหม่' })
        q.status = 'failed'
        q.error = 'โปรแกรมถูกปิดระหว่างโพสต์ — ดูในเพจ/ช่องก่อนว่าขึ้นไปแล้วหรือยัง แล้วค่อยกดลองใหม่'
        q.results ??= {}
        for (const key of q.targets ?? []) if (!q.results[key]?.ok && q.results[key]?.needsVerification !== false) {
          q.results[key] = { ...q.results[key], ok: false, needsVerification: true, error: 'โปรแกรมหยุดระหว่างส่ง — ระงับปลายทางนี้เพื่อป้องกันโพสต์ซ้ำ', at: Date.now() }
        }
        changed = true
      }
      // รุ่นก่อน 1.0.11: คลิปที่ไม่มีปลายทางถูกนับว่า "โพสต์แล้ว" ทั้งที่ไม่ได้ขึ้นที่ไหน → คืนเป็นพลาด ให้กดลองใหม่ได้
      if (q.status === 'posted' && !Object.values(q.results ?? {}).some((r) => r?.ok)) {
        q.status = 'failed'
        q.postedAt = null
        q.error = 'คลิปนี้ไม่ได้ขึ้นเพจหรือช่องไหนเลย (ตอนนั้นไม่มีปลายทาง) — ตรวจว่าเพิ่มเพจแล้ว แล้วกดลองใหม่'
        changed = true
      }
    }
    if (changed) saveQueue(queue)
  }

  const note = (item, text) => {
    item.history = [...(item.history ?? []), { at: Date.now(), text }].slice(-30)
  }

  function mutateItem(id, fn) {
    const queue = loadQueue()
    const item = queue.find((q) => q.id === id)
    if (!item) throw new Error('ไม่พบคลิปนี้ในคิว')
    const out = fn(item, queue)
    saveQueue(queue)
    return out ?? item
  }

  const videoPath = (item) => join(PROJECTS, item.slug, '06_render', item.file)

  async function seedDeliveryHistory() {
    if (!historySeeded) historySeeded = importDeliveryHistory(deliveries, loadQueue(), loadAccounts(), videoPath)
      .catch(error => { historySeeded = null; throw error })
    return historySeeded
  }

  /** เพจ/ช่องที่เพิ่งเพิ่ม → ติ๊กให้คลิปที่ยังรอตรวจทุกคลิป (ค่าเริ่มต้น "ลงทุกที่") */
  /**
   * คลิปที่ยังรอตรวจและผู้ใช้ยังไม่ได้ติ๊กปลายทางเอง → เลือกเพจ/ช่องใหม่ตามหมวดของคลิป
   * เรียกหลังเพิ่ม/ลบบัญชี หรือเปลี่ยนหมวดที่บัญชีรับ (คลิปที่อนุมัติแล้วไม่เปลี่ยน)
   */
  function retarget() {
    const data = loadAccounts()
    saveQueue(loadQueue().map((q) => (q.status === 'review' && !q.targetsEdited ? { ...q, targets: targetsFor(data, q.category, { clip: clipKey(q) }) } : q)))
  }

  function collectTikTokConnection() {
    if (tiktokConnection?.status !== 'running') return
    const job = jobs.get(tiktokConnection.jobId)
    if (job?.status === 'queued' || job?.status === 'running') {
      if (Date.now() - tiktokConnection.startedAt < 3 * 60_000) return
      Object.assign(job, { cancelled: true, status: 'error', error: 'รอ TikTok เกินเวลา — เปิด Chrome ล็อกอิน แล้วกดเชื่อมต่ออีกครั้ง' })
    }
    const result = job?.result?.meta
    const username = tiktokUsername(result?.username)
    if (job?.status !== 'done' || result?.ok !== true || !username) {
      tiktokConnection = { status: 'error', error: String(result?.error ?? job?.error ?? 'อ่านบัญชี TikTok ไม่สำเร็จ — ล็อกอิน TikTok Studio แล้วเชื่อมต่อใหม่') }
      return
    }
    updateAccounts(data => {
      const old = data.tiktok.find(a => a.username === username)
      const info = { username, name: String(result.name ?? username).slice(0, 100), checkedAt: Date.now() }
      if (old) Object.assign(old, info)
      else data.tiktok.push({ id: newId(), ...info, privacy: 'private', aigc: true, addedAt: Date.now() })
    })
    tiktokConnection = { status: 'done', username }
    retarget()
    log(`โพสต์อัตโนมัติ: เชื่อม TikTok @${username} ผ่าน Chrome แล้ว`)
  }

  /** เติมหมวดจากคลิปและปลายทางที่ว่าง — ไม่ทับเพจที่เลือก/อนุมัติไว้แล้ว */
  function fillTargets(item, accounts) {
    let changed = false
    if (!item.category && !item.categoryBy) {
      const category = clipCategory(item.slug)
      if (category) {
        Object.assign(item, { category, categoryBy: 'clip' })
        changed = true
      }
    }
    if (!item.targetsEdited && !item.targets?.length) {
      const targets = targetsFor(accounts, item.category, { clip: clipKey(item) })
      if (targets.length) {
        item.targets = targets
        changed = true
      }
    }
    return changed
  }

  /** คิวเก่า/เพจที่ลบแล้วเชื่อมใหม่: เติมให้เห็นก่อนถึงเวลาโพสต์ โดยคงเวลาเดิม */
  function repairMissingTargets() {
    const accounts = loadAccounts()
    const queue = loadQueue()
    let changed = false
    for (const item of queue) {
      if (item.status !== 'review' && item.status !== 'scheduled') continue
      if (fillTargets(item, accounts)) changed = true
    }
    if (changed) saveQueue(queue)
  }

  // ── เข้าคิวเอง ──
  async function enroll({ force = false } = {}) {
    if (!force && Date.now() - lastEnroll < ENROLL_EVERY_MS) return
    lastEnroll = Date.now()
    const accounts = loadAccounts()
    const { settings } = accounts
    if (!settings.enabledAt) return
    const fresh = videosToEnroll(await videosOf(), loadQueue(), settings.enabledAt)
    if (!fresh.length) return
    const queue = loadQueue()
    for (const v of fresh) {
      const item = newItem({ ...v, post: readPost(v.slug) })
      fillTargets(item, accounts)
      note(item, 'คลิปทำเสร็จ เข้าคิวรอตรวจ')
      queue.push(item)
      log(`โพสต์อัตโนมัติ: "${v.title}" เข้าคิวรอตรวจ`)
    }
    saveQueue(queue)
  }

  /**
   * ดึงคลิปจากคลังเอง (สวิตช์ "ดึงคลิปจากคลังเอง") — เติมคิวให้มีคลิปรอโพสต์ครบทุกช่องเวลาของวัน เก่าสุดก่อน
   * เข้าคิวแบบเดียวกับกด "เพิ่มจากคลังวิดีโอ": ผ่าน AI ตรวจ / อนุมัติเอง ตามสวิตช์เดิม
   */
  async function pull() {
    const { settings } = loadAccounts()
    if (!settings.enabledAt || !settings.autoPull) return
    const queue = loadQueue()
    const picks = clipsToPull(await videosOf(), queue, settings.slots)
    if (!picks.length) return
    const accounts = loadAccounts()
    for (const v of picks) {
      const category = clipCategory(v.slug)
      const item = newItem({ ...v, post: readPost(v.slug), targets: targetsFor(accounts, category ?? null, { clip: clipKey(v) }) })
      if (category) Object.assign(item, { category, categoryBy: 'clip' })
      note(item, 'ดึงจากคลังเอง (เติมให้ครบทุกช่องเวลา)')
      queue.push(item)
      log(`โพสต์อัตโนมัติ: ดึง "${v.title}" จากคลังเข้าคิวเอง`)
    }
    saveQueue(queue)
  }

  /**
   * 🏭 ผลิตต่อเนื่อง: คลิปเสร็จ → เข้าคิวทันที (ไม่ต้องรอรอบดึงคลิป 2 นาที / ไม่ต้องเปิดโหมดโพสต์ทั้งระบบ)
   *   mode 'ai'  = AI ตรวจก่อน ผ่านแล้วลงช่องเวลาถัดไปเอง (ไม่ผ่าน → รอคนตรวจ)
   *   mode 'now' = ลงช่องเวลาถัดไปทันที ไม่ตรวจ
   */
  /**
   * pages = ปลายทางที่ผลิตต่อเนื่องแบ่งให้คลิปนี้ (โหมด "แบ่งเพจ") — ใช้ตามนั้นเลย ไม่กรองตามหมวด เพราะผู้ใช้เลือกเอง
   * ไม่ส่งมา = เพจ/ช่องที่รับหมวดของคลิป แพลตฟอร์มละ 1 ที่ (กฎห้ามโพสต์ซ้ำ) · หมวดอ่านจากโปรไฟล์ของคลิปเลย (เดิมไม่มีหมวด → เพจที่ตั้งหมวดไว้ไม่รับ คลิปค้างในคิว)
   */
  async function enqueueAuto(slug, mode = 'ai', pages = null) {
    const video = (await videosOf()).find((v) => v.slug === slug)
    const main = video?.files?.find((f) => f.name === `${slug}.mp4`) ?? video?.files?.[0]
    if (!main) throw new Error('ไม่พบไฟล์วิดีโอของคลิปนี้')
    const queue = loadQueue()
    const accounts = loadAccounts()
    const known = new Set(allTargets(accounts))
    // แบ่งเพจจากผลิตต่อเนื่อง — ยังต้องผ่านกฎห้ามโพสต์ซ้ำ (แพลตฟอร์มละ 1 ปลายทาง · ไม่ลงแพลตฟอร์มที่เคยลงแล้ว)
    const chosen = onePerPlatform((Array.isArray(pages) ? pages : []).filter((k) => known.has(k)), { clip: clipKey({ slug, file: main.name }) })
    let item = queue.find((q) => q.slug === slug && q.file === main.name)
    if (!item) {
      item = newItem({ slug, file: main.name, title: video.title ?? slug, post: readPost(slug) })
      queue.push(item)
    }
    if (!item.category) {
      const category = clipCategory(slug)
      if (category) Object.assign(item, { category, categoryBy: 'clip' })
    }
    if (chosen.length) {
      item.targets = chosen
      item.targetsEdited = true // AI ระบุหมวดทีหลังก็ไม่เปลี่ยนเพจที่แบ่งไว้
      note(item, `แบ่งเพจ: ${chosen.map((k) => findTarget(accounts, k).account?.name ?? k).join(', ')}`)
    } else if (!item.targetsEdited) item.targets = targetsFor(accounts, item.category, { clip: clipKey({ slug, file: main.name }) })
    item.auto = mode
    note(item, mode === 'now' ? 'ผลิตต่อเนื่อง: เข้าคิว → ตั้งเวลาโพสต์เองทันที' : 'ผลิตต่อเนื่อง: เข้าคิว → AI ตรวจ ผ่านแล้วตั้งเวลาเอง')
    saveQueue(queue)
    log(`โพสต์อัตโนมัติ: "${item.title}" เข้าคิวจากผลิตต่อเนื่อง (${mode === 'now' ? 'ตั้งเวลาทันที' : 'AI ตรวจก่อน'})`)
    scheduleAuto()
    return loadQueue().find((q) => q.id === item.id)
  }

  /**
   * คลิปที่จะตั้งเวลาเองโดยไม่รอคนกด: มาจากผลิตต่อเนื่อง (item.auto) หรือเปิด "อนุมัติเองเมื่อ AI ให้ผ่าน" ไว้
   * 'now' = ไม่ต้องตรวจ · อย่างอื่น = ต้องรอ AI ให้ผ่านก่อน
   */
  const selfScheduling = (item, settings) => item.status === 'review' && !!(item.auto || settings.autoApprove)
  /** ไม่ตรวจ — โพสต์เลย: ใช้กับคลิปทั่วไป (ไม่ใช่ผลิตต่อเนื่อง) ที่ AI ไม่เคยบอกให้แก้ */
  const skipsCheck = (item, settings) => !!(settings.skipCheck && settings.autoApprove) && !item.auto && !(item.ai?.status === 'done' && item.ai.verdict !== 'pass')
  const cleared = (item, settings) => item.auto === 'now' || (item.ai?.status === 'done' && item.ai.verdict === 'pass') || skipsCheck(item, settings)

  /**
   * คลิปพร้อมตั้งเวลาแต่ไม่มีข้อความโพสต์ (ตอนทำคลิปขอ ChatGPT ไม่สำเร็จ) → ให้ ChatGPT เขียนให้เอง ไม่ค้างรอคน
   * ขอครั้งเดียวต่อคลิป — พลาดแล้วให้คนกด "คิดชื่อคลิป + คำบรรยาย" ในคลังเอง ไม่วนขอซ้ำ
   * รอเหมือน AI ตรวจ: ไม่แย่ง ChatGPT ตอนกำลังทำคลิป
   */
  function fillPosts() {
    const queue = loadQueue()
    const { settings } = loadAccounts()
    let changed = false
    for (const item of queue) {
      if (item.postJob?.status !== 'running') continue
      const job = jobs.get(item.postJob.jobId)
      if (!job || job.status === 'error') {
        item.postJob = { status: 'error', error: job?.error ?? 'งานเขียนข้อความโพสต์หายไปจากคิว ChatGPT' }
        note(item, 'ChatGPT เขียนข้อความโพสต์ไม่สำเร็จ — กด "คิดชื่อคลิป + คำบรรยาย" ในคลังวิดีโอเอง')
      } else if (job.status === 'done') {
        try {
          item.post = postFromFile(savePost(item.slug, parsePost(job.result?.text)))
          item.postJob = { status: 'done' }
          note(item, 'ChatGPT เขียนข้อความโพสต์ให้แล้ว')
        } catch (err) {
          item.postJob = { status: 'error', error: err.message }
          note(item, `อ่านข้อความโพสต์จาก ChatGPT ไม่ได้ — ${err.message}`)
        }
      } else continue
      changed = true
    }
    const chatgptBusy = [...jobs.values()].some((j) => j.agent === 'chatgpt' && (j.status === 'queued' || j.status === 'running'))
    if (!chatgptBusy && !pipelineBusy()) {
      const next = queue.find((q) => selfScheduling(q, settings) && cleared(q, settings) && !q.post?.title && !q.postJob && !postFromFile(readPost(q.slug))?.title)
      if (next) {
        const job = enqueue('chatgpt', 'prompt', { prompt: postPrompt(clipSource(next.slug)), newChat: true, label: 'คิดชื่อคลิป + คำบรรยาย' })
        next.postJob = { status: 'running', jobId: job.id, startedAt: Date.now() }
        note(next, 'ยังไม่มีข้อความโพสต์ — ให้ ChatGPT เขียนให้')
        log(`โพสต์อัตโนมัติ: "${next.title}" ยังไม่มีข้อความโพสต์ ให้ ChatGPT เขียนให้`)
        changed = true
      }
    }
    if (changed) saveQueue(queue)
  }

  /** คลิปที่ตั้งเวลาเองได้และพร้อมแล้ว → ลงช่องเวลาถัดไป (เรียกทุกรอบ — เพิ่งเชื่อมเพจ/เพิ่งได้ข้อความโพสต์ทีหลังก็ตั้งเวลาให้) */
  function scheduleAuto() {
    const queue = loadQueue()
    const accounts = loadAccounts()
    let changed = false
    for (const item of queue) {
      if (!selfScheduling(item, accounts.settings) || !cleared(item, accounts.settings)) continue
      if (!item.post?.title) {
        const post = postFromFile(readPost(item.slug))
        if (post?.title) {
          item.post = post
          changed = true
        }
      }
      if (!item.targetsEdited && !item.targets?.length) item.targets = targetsFor(accounts, item.category, { clip: clipKey(item) })
      if (!item.targets?.length || !item.post?.title) continue // ยังไม่มีเพจ/ช่อง หรือยังไม่มีข้อความโพสต์ → รอ
      const at = nextSlotForItem(accounts, queue, item) // ตามเวลาของเพจที่คลิปจะลง · เพจอื่นช่องเดียวกันได้
      if (!at) continue
      item.status = 'scheduled'
      item.scheduleAt = at
      note(item, item.auto === 'now' ? 'ตั้งเวลาเองทันที (ผลิตต่อเนื่อง)'
        : item.auto ? 'AI ให้ผ่าน → ตั้งเวลาเอง (ผลิตต่อเนื่อง)'
          : item.ai?.verdict === 'pass' ? 'AI ให้ผ่าน → อนุมัติเองและลงช่องเวลาถัดไป'
            : 'ออโต้แบบไม่ตรวจ → อนุมัติเองและลงช่องเวลาถัดไป')
      log(`โพสต์อัตโนมัติ: "${item.title}" ตั้งเวลาโพสต์ ${new Date(at).toLocaleString('th-TH')}`)
      changed = true
    }
    if (changed) saveQueue(queue)
  }

  // ── AI ตรวจ ──
  async function startCheck(id) {
    const item = loadQueue().find((q) => q.id === id)
    if (!item) throw new Error('ไม่พบคลิปนี้ในคิว')
    if (item.ai?.status === 'running') return item
    const file = videoPath(item)
    if (!existsSync(file)) throw new Error('ไม่พบไฟล์วิดีโอ — อาจถูกลบหรือเปลี่ยนชื่อไปแล้ว')
    const seconds = (await videosOf()).find((v) => v.slug === item.slug)?.files.find((f) => f.name === item.file)?.seconds ?? null
    const times = frameTimes(seconds)
    const dir = join(POSTING_DIR, 'frames', item.id)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const attachments = []
    for (const [i, t] of times.entries()) {
      const out = join(dir, `frame_${i + 1}.jpg`)
      await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', out])
      if (existsSync(out)) attachments.push({ name: `frame_${i + 1}.jpg`, type: 'image/jpeg', base64: readFileSync(out).toString('base64') })
    }
    if (!attachments.length) throw new Error('ตัดภาพตัวอย่างจากคลิปไม่ได้')
    const source = clipSource(item.slug)
    const prompt = qcPrompt({ title: item.title, script: source.script, post: item.post, seconds, times, language: source.language })
    const job = enqueue('chatgpt', 'prompt', { prompt, newChat: true, attachments, label: 'นกนางนวลตรวจคลิป' })
    return mutateItem(id, (it) => {
      it.ai = { status: 'running', jobId: job.id, startedAt: Date.now() }
      note(it, 'ส่งให้ AI ตรวจ')
    })
  }

  /** ผลตรวจที่ ChatGPT ตอบกลับแล้ว → เก็บลงคิว (+ อนุมัติเองถ้าตั้งไว้) */
  function collectChecks() {
    const queue = loadQueue()
    const accounts = loadAccounts()
    const { settings } = accounts
    let changed = false
    for (const item of queue) {
      if (item.ai?.status !== 'running') continue
      const job = jobs.get(item.ai.jobId)
      if (!job) {
        item.ai = { status: 'error', error: 'งานตรวจหายไปจากคิว ChatGPT — กดตรวจใหม่' }
        changed = true
        continue
      }
      if (job.status === 'error') {
        item.ai = { status: 'error', error: job.error ?? 'ChatGPT ตรวจไม่สำเร็จ' }
        changed = true
        continue
      }
      if (job.status !== 'done') continue
      try {
        item.ai = { status: 'done', ...parseQc(job.result?.text), checkedAt: Date.now() }
        note(item, `AI ตรวจแล้ว: ${item.ai.verdict === 'pass' ? 'ผ่าน' : 'ควรแก้'} ${item.ai.score}/100`)
        // หมวดจาก AI — ไม่ทับหมวดที่ผู้ใช้เลือกเอง · ปลายทางเลือกให้ใหม่ถ้าผู้ใช้ยังไม่ได้ติ๊กเอง
        // คลิปโหมดเฉพาะ (พระสอนธรรม) ได้หมวดจากคลิปเอง — AI เลือกหมวดนี้ไม่ได้ จึงห้ามทับ
        if (item.ai.category && item.categoryBy !== 'manual' && !(item.category && !AI_CATEGORIES.includes(item.category))) {
          item.category = item.ai.category
          item.categoryBy = 'ai'
          if (item.status === 'review' && !item.targetsEdited) item.targets = targetsFor(accounts, item.category, { clip: clipKey(item) })
          note(item, `AI ระบุหมวด: ${item.category}`)
        }
      } catch (err) {
        item.ai = { status: 'error', error: err.message, raw: String(job.result?.text ?? '').slice(0, 1500) }
      }
      changed = true
      if (settings.autoApprove && item.status === 'review' && item.ai.status === 'done' && item.ai.verdict === 'pass' && item.targets?.length && item.post?.title) {
        const at = nextSlotForItem(loadAccounts(), queue, item)
        if (at) {
          item.status = 'scheduled'
          item.scheduleAt = at
          note(item, 'AI ให้ผ่าน → อนุมัติเองและลงช่องเวลาถัดไป')
        }
      }
    }
    if (changed) saveQueue(queue)
  }

  /** ตรวจเองทีละคลิป เฉพาะตอนคิว ChatGPT ว่างและไม่มีขั้นทำคลิปกำลังรัน — ไม่แย่งคิวกับการทำคลิป */
  async function autoCheck() {
    const { settings } = loadAccounts()
    const queue = loadQueue()
    // คลิปจากผลิตต่อเนื่องแบบ "AI ตรวจก่อน" ตรวจเสมอ แม้ปิดตรวจอัตโนมัติของทั้งระบบ
    // ออโต้แบบไม่ตรวจ → คลิปทั่วไปไม่ต้องส่ง AI (ไม่เปลืองคิว ChatGPT) · ผลิตต่อเนื่องแบบ "AI ตรวจ" ยังตรวจ
    const wants = (q) => q.status === 'review' && !q.ai && ((settings.autoCheck && !skipsCheck(q, settings)) || q.auto === 'ai')
    if (!queue.some(wants) || pipelineBusy()) return
    const chatgptBusy = [...jobs.values()].some((j) => j.agent === 'chatgpt' && (j.status === 'queued' || j.status === 'running'))
    if (chatgptBusy) return
    if (queue.some((q) => q.ai?.status === 'running')) return
    const next = queue.find(wants)
    if (next) await startCheck(next.id).catch((err) => mutateItem(next.id, (it) => { it.ai = { status: 'error', error: err.message } }))
  }

  // ── Facebook Story ตามรอบ: ภาพ "ไขปริศนาธรรม" ของคลิป (riddle.mjs) ──
  // ผู้ใช้ (5 พ.ย. 2026): Story ให้เป็นภาพปริศนาแบบเวทีทอง แทนการตัดคลิปลงทีละตอน
  // คลิปที่ไม่มีภาพปริศนา (คลิปเก่า/ภาษาอื่น) → ข้าม ไม่นับรอบ โพสต์ถัดไปจะลองใหม่
  // คืนผลเสมอ ไม่ throw — โพสต์หน้าเพจขึ้นไปแล้ว Story พลาดต้องไม่ทำให้นับว่าโพสต์ไม่สำเร็จ
  async function postStory(account, file, identity, itemId, title, slug) {
    const destination = `facebook-story:${account.pageId}`
    const posted = []
    let ticket, parts
    try {
      parts = await prepareRiddle(slug, POSTING_DIR)
      if (!parts) {
        log(`โพสต์อัตโนมัติ: "${title}" ไม่มีภาพปริศนาธรรม — ข้าม Story ของ ${account.name} รอบนี้ (ลองกับโพสต์ถัดไป)`)
        return { ok: false, skipped: true, error: 'คลิปนี้ไม่มีภาพปริศนาธรรม', needsVerification: false, at: Date.now() }
      }
      const claim = deliveries.reserve({ identity, destination, itemId })
      if (claim.status === 'done') return { ok: true, duplicateSkipped: true, at: Date.now() }
      if (claim.status === 'blocked') throw Object.assign(new Error('ยังไม่รู้ผล Story ครั้งก่อนของคลิปนี้ — ไม่ลงซ้ำ'), { needsVerification: true })
      ticket = claim.ticket
      posted.push((await fb.photoStory({ pageId: account.pageId, token: account.token, file: parts.file })).postId)
      deliveries.complete(ticket, { postIds: posted, destination, riddle: parts.riddle.answer })
      log(`โพสต์อัตโนมัติ: "${title}" ลง Story ปริศนาธรรม (เฉลย: ${parts.riddle.answer}) ของ ${account.name} แล้ว`)
      mutateItem(itemId, it => note(it, `${account.name}: ลง Story ปริศนาธรรมแล้ว (เฉลย: ${parts.riddle.answer})`))
      return { ok: true, parts: 1, postIds: posted, riddle: parts.riddle.answer, at: Date.now() }
    } catch (err) {
      // ตอนแรกขึ้นไปแล้วแต่ตอนถัดไปพลาด หรือขาดคำตอบหลังสั่งเผยแพร่ → ไม่รู้ผลแน่ ห้ามลงซ้ำ
      const needsVerification = err.needsVerification === true || posted.length > 0
      if (ticket) try { deliveries.fail(ticket, { message: err.message, needsVerification }) } catch {}
      log(`โพสต์อัตโนมัติ: "${title}" ลง Story ของ ${account.name} ไม่สำเร็จ — ${err.message}${posted.length ? ` (ขึ้นไปแล้ว ${posted.length} ตอน)` : ''}`)
      mutateItem(itemId, it => note(it, `${account.name}: ลง Story ไม่สำเร็จ${posted.length ? ` (ขึ้นไปแล้ว ${posted.length} ตอน)` : ''} — ${err.message}`))
      return { ok: false, error: err.message, needsVerification, parts: posted.length, at: Date.now() }
    } finally {
      if (parts) await parts.remove().catch(() => {})
    }
  }

  // ── โพสต์ ──
  async function postItem(id) {
    const accounts = loadAccounts()
    try { await seedDeliveryHistory() } catch (error) {
      return mutateItem(id, it => { it.status = 'failed'; it.error = error.message; it.finishedAt = Date.now(); it.results ??= {}; for (const key of it.targets ?? []) if (!it.results[key]?.ok) it.results[key] = { ok: false, error: error.message, needsVerification: true, at: Date.now() } })
    }
    let item = mutateItem(id, (it) => {
      fillTargets(it, accounts)
      it.status = 'posting'
      it.error = null
      it.results ??= {}
      note(it, 'เริ่มโพสต์')
    })
    // ไม่มีที่ให้โพสต์ = พลาด — เคยนับเป็น "โพสต์แล้ว" เพราะไม่มีปลายทางไหนพลาด ทั้งที่ไม่ได้ขึ้นที่ไหนเลย
    if (!item.targets?.length) {
      return mutateItem(id, (it) => {
        it.status = 'failed'
        it.finishedAt = Date.now()
        it.error = 'ไม่มีเพจหรือช่องที่จะโพสต์ — เพิ่มเพจในแท็บตั้งค่า (หรือตั้งให้เพจรับหมวดของคลิปนี้) แล้วกดลองใหม่'
        note(it, 'โพสต์ไม่ได้: ไม่มีเพจหรือช่องปลายทาง')
        log(`โพสต์อัตโนมัติ: "${it.title}" ไม่มีเพจหรือช่องปลายทาง — ไม่ได้โพสต์`)
      })
    }
    let file = videoPath(item)
    const text = caption(item.post)
    const results = { ...item.results }
    const blocked = [] // ปลายทางที่ข้ามตามกฎห้ามโพสต์ซ้ำ
    let identity, staged, cover = null
    try {
      staged = await stageDelivery(file, item, POSTING_DIR)
      file = staged.file; identity = staged.identity
    } catch (error) {
      if (staged) await staged.remove().catch(() => {})
      return mutateItem(id, it => { it.status = 'failed'; it.error = error.message; it.finishedAt = Date.now(); for (const key of it.targets ?? []) if (!it.results[key]?.ok) it.results[key] = { ok: false, error: error.message, needsVerification: false, at: Date.now() } })
    }
    // ภาพปก (05_images/cover.png) ไปพร้อมคลิปทุกที่ — เตรียมไม่ได้ก็โพสต์ต่อโดยไม่มีปก
    try { cover = await prepareCover(join(PROJECTS, item.slug, '05_images', 'cover.png'), POSTING_DIR) } catch (error) {
      log(`โพสต์อัตโนมัติ: เตรียมภาพปก "${item.title}" ไม่ได้ — โพสต์โดยไม่มีปก (${error.message})`)
    }
    mutateItem(id, it => { it.deliverySnapshot = { file, sha256: identity.sha256, ...(cover ? { cover: cover.file } : {}) } })
    async function sendTarget(key) {
      if (results[key]?.ok) return
      const { kind, account } = findTarget(accounts, key)
      // กฎห้ามโพสต์ซ้ำ — ด่านสุดท้ายก่อนส่ง: คลิปนี้ลงแพลตฟอร์มนี้แล้ว (คิวนี้หรือคิวก่อน) = ไม่ส่งเด็ดขาด
      // ปลายทางของแพลตฟอร์มเดียวกันส่งทีละอัน จึงเห็นผลของอันก่อนเสมอ
      const p = platformOf(key)
      const prior = loadPosted()[clipKey(item)]?.[p] ?? Object.entries(results).find(([k, r]) => r?.ok && platformOf(k) === p)?.[1]
      const block = () => {
        blocked.push({ key, reason: `ข้าม ${account?.name ?? key}: คลิปนี้ลง ${PLATFORM_NAME[p] ?? p} ไปแล้วที่ ${prior.name ?? prior.key} — ห้ามโพสต์คลิปเดิมซ้ำในแพลตฟอร์มเดิม` })
        log(`โพสต์อัตโนมัติ: "${item.title}" ${blocked.at(-1).reason}`)
      }
      // ปลายทางจริงเดียวกัน (เช่นเชื่อมเพจเดิมใหม่ ID ในโปรแกรมเปลี่ยน) → ให้ deliveries ตัดสิน: เคยขึ้นแล้ว = นับว่าโพสต์แล้ว ไม่อัปซ้ำ
      const sameDestination = !!prior && !!account && (prior.destination ? prior.destination === deliveryDestination(kind, account) : prior.key === key)
      if (prior && !sameDestination) return block()
      let ticket, started = false, destination
      try {
        if (!account) throw new Error('บัญชีนี้ถูกลบออกไปแล้ว')
        if (!existsSync(file)) throw new Error('ไม่พบไฟล์วิดีโอ')
        if (kind === 'youtube' && !account.refreshToken) throw new Error('ช่องนี้ยังไม่ได้เชื่อมต่อ')
        destination = deliveryDestination(kind, account)
        const claim = deliveries.reserve({ identity, destination, itemId: id })
        if (claim.status === 'done') {
          results[key] = { ...claim.result, ok: true, destination, duplicateSkipped: true, name: account.name, at: Date.now() }
          recordPosted(clipKey(item), key, { name: account.name, at: results[key].at, url: claim.result?.url ?? null, destination, title: item.title })
          mutateItem(id, it => { it.results = { ...it.results, [key]: results[key] } })
          return
        }
        // สมุดบันทึกว่าคลิปนี้ขึ้นปลายทางนี้แล้ว แต่ไฟล์เปลี่ยน (ทำใหม่) จน deliveries ไม่รู้จัก → ยังเป็นคลิปเดิม ห้ามส่ง
        if (sameDestination) {
          if (claim.ticket) try { deliveries.fail(claim.ticket, { message: 'ห้ามโพสต์คลิปเดิมซ้ำในแพลตฟอร์มเดิม', needsVerification: false }) } catch {}
          return block()
        }
        if (claim.status === 'blocked' || results[key]?.needsVerification) throw Object.assign(new Error('ยังไม่รู้ผลการส่งครั้งก่อน — ระงับปลายทางนี้เพื่อป้องกันโพสต์ซ้ำ'), { needsVerification: true })
        ticket = claim.ticket
        results[key] = { ok: false, destination, needsVerification: true, error: 'กำลังส่ง — หากขาดการยืนยันจะไม่ส่งซ้ำ', name: account.name, at: Date.now() }
        mutateItem(id, it => { it.results = { ...it.results, [key]: results[key] } })
        let out
        started = true
        if (kind === 'facebook') {
          out = await fb.upload({ pageId: account.pageId, token: account.token, file, title: item.post.title, description: text, cover: cover?.file ?? null })
        } else if (kind === 'tiktok') {
          out = await runTikTokJob({ jobs, enqueue, payload: { username: account.username, privacy: account.privacy ?? 'private', aigc: account.aigc !== false, file, cover: !!cover, caption: text || item.post.title }, onStart: job => mutateItem(id, it => { it.tiktokJobId = job.id }) }, { timeoutMs: deps.tiktokTimeoutMs, pollMs: deps.tiktokPollMs })
        } else if (kind === 'youtube') {
          const { clientId, clientSecret } = accounts.settings.google
          if (!account.refreshToken) throw new Error('ช่องนี้ยังไม่ได้เชื่อมต่อ')
          out = await yt.upload({ clientId, clientSecret, refreshToken: account.refreshToken, file, title: item.post.title, description: text, tags: item.post.hashtags, privacy: account.privacy ?? 'public', cover: cover?.file ?? null })
        } else throw new Error('ไม่รู้จักปลายทางนี้')
        if (kind !== 'tiktok' && !out?.postId) throw new Error('ปลายทางไม่ส่งเลขโพสต์กลับมา — หยุดเพื่อป้องกันโพสต์ซ้ำ')
        deliveries.complete(ticket, { ...out, destination })
        results[key] = { ok: true, ...out, destination, name: account.name, at: Date.now() }
        recordPosted(clipKey(item), key, { name: account.name, at: results[key].at, url: out.url ?? null, destination, title: item.title })
        log(`โพสต์อัตโนมัติ: "${item.title}" ขึ้น ${account.name} แล้ว${out.url ? ` ${out.url}` : ''}`)
        if (out.coverError) {
          log(`โพสต์อัตโนมัติ: "${item.title}" บน ${account.name} ตั้งภาพปกไม่ได้ — ${out.coverError}`)
          mutateItem(id, it => note(it, `${account.name}: โพสต์แล้วแต่ตั้งภาพปกไม่ได้ (${out.coverError})`))
        }
      } catch (err) {
        let needsVerification = started ? err.needsVerification !== false : err.needsVerification === true
        if (ticket) try { deliveries.fail(ticket, { message: err.message, needsVerification }) } catch { needsVerification = true }
        results[key] = { ok: false, error: err.message, destination, name: account?.name ?? key, at: Date.now(), needsVerification }
        log(`โพสต์อัตโนมัติ: "${item.title}" ขึ้น ${account?.name ?? key} ไม่สำเร็จ — ${err.message}`)
      }
      // Story ตามรอบของเพจ — ทำหลังโพสต์หน้าเพจสำเร็จเท่านั้น พลาดก็ไม่กระทบโพสต์หลัก
      if (kind === 'facebook' && results[key]?.ok && !results[key].duplicateSkipped && storyDue(loadQueue(), key, account, id)) {
        results[key] = { ...results[key], story: await postStory(account, file, identity, id, item.title, item.slug) }
      }
      mutateItem(id, (it) => { it.results = { ...it.results, [key]: results[key] }; if (kind === 'tiktok') it.tiktokJobId = null })
    }
    // Each platform has an independent connection. Keep a platform's own accounts
    // serial, while a slow upload on one platform cannot hold the other two.
    const groups = new Map()
    for (const key of new Set(item.targets ?? [])) {
      const platform = key.split(':')[0]
      if (!groups.has(platform)) groups.set(platform, [])
      groups.get(platform).push(key)
    }
    try {
      const settled = await Promise.allSettled([...groups.values()].map(async keys => { for (const key of keys) await sendTarget(key) }))
      const rejected = settled.find(result => result.status === 'rejected')
      if (rejected) throw rejected.reason
      return mutateItem(id, (it) => {
      // ปลายทางที่ข้ามตามกฎห้ามโพสต์ซ้ำ → เอาออกจากรายการ (ไม่นับว่าพลาด) แต่จดไว้ในประวัติ
      const skip = new Set(blocked.map((b) => b.key))
      it.targets = (it.targets ?? []).filter((k) => !skip.has(k))
      for (const b of blocked) note(it, b.reason)
      const failed = it.targets.filter((k) => !results[k]?.ok)
      it.results = results
      if (!failed.length && blocked.length && !Object.values(results).some((r) => r?.ok)) {
        // ทุกปลายทางโดนกฎ — ไม่มีอะไรขึ้นจากคิวนี้
        it.status = 'failed'
        it.finishedAt = Date.now()
        it.error = blocked.map((b) => b.reason).join(' · ')
        return
      }
      it.status = failed.length ? 'failed' : 'posted'
      it.postedAt = failed.length ? it.postedAt ?? null : Date.now()
      it.finishedAt = Date.now() // ใช้แจ้งผู้ใช้ว่าโพสต์ไปไหนบ้าง (สำเร็จหรือพลาด) — postingEvents
      it.error = failed.length ? failed.map((k) => `${results[k]?.name ?? k}: ${results[k]?.error ?? 'ไม่สำเร็จ'}`).join(' · ') : null
      note(it, failed.length ? `โพสต์ไม่สำเร็จ ${failed.length} ที่` : 'โพสต์ครบทุกที่แล้ว')
      })
    } finally {
      await staged.remove().catch(error => log(`เก็บไฟล์ส่งชั่วคราวไว้ก่อน: ${error.message}`))
      if (cover) await cover.remove().catch(() => {})
      mutateItem(id, it => { it.deliverySnapshot = null })
    }
  }

  async function postDue() {
    if (uploading) return
    const queue = loadQueue()
    // เว้นอย่างน้อย 30 นาทีระหว่างโพสต์อัตโนมัติ — 3 พ.ย. 2026 กด "ลองโพสต์ใหม่" ทีละคลิป (scheduleAt = ตอนนี้)
    // ทำให้ TikTok ได้ 5 คลิปใน 5 นาที · คลิปที่ค้างหลังเปิดเครื่องก็ทยอยออกทีละคลิปเช่นกัน
    // เว้น 30 นาทีทีละเพจ — เพจอื่นโพสต์คลิปของตัวเองในช่องเวลาเดียวกันได้ (โพสต์พร้อมกันได้แต่คนละคลิป)
    const [item] = readyItems(queue, MIN_POST_GAP_MS)
    if (!item) return
    uploading = true
    try {
      await postItem(item.id)
    } finally {
      uploading = false
    }
  }

  // ── Google Drive: ขึ้นตอนเข้าคิว · ลง (ถังขยะ) เมื่อโพสต์ครบ/ตีกลับ/เอาออก ──
  async function syncDrive() {
    const { settings } = loadAccounts()
    const d = settings.drive
    if (driveBusy || !d?.refreshToken) return
    driveBusy = true
    try {
      // Drive ใช้ OAuth client ของตัวเอง (แยกจาก YouTube — อาจคนละบัญชี/คนละโปรเจกต์)
      const auth = { clientId: settings.driveClient.clientId, clientSecret: settings.driveClient.clientSecret, refreshToken: d.refreshToken }
      for (const item of driveToTrash(loadQueue())) {
        try {
          await drive.trash({ ...auth, fileId: item.drive.fileId })
          mutateItem(item.id, (it) => {
            it.drive = { removedAt: Date.now() }
            note(it, 'ลบคลิปออกจาก Google Drive แล้ว (อยู่ในถังขยะ 30 วัน)')
          })
        } catch (err) {
          log(`โพสต์อัตโนมัติ: ลบ "${item.title}" ออกจาก Drive ไม่ได้ — ${err.message}`)
        }
      }
      const next = nextDriveUpload(loadQueue())
      if (!next) return
      const file = videoPath(next)
      if (!existsSync(file)) return
      mutateItem(next.id, (it) => { it.drive = { uploading: true, at: Date.now() } })
      try {
        const out = await drive.upload({ ...auth, folderId: d.folderId, file, name: `${next.title}.mp4` })
        if (out.folderId !== d.folderId) updateAccounts(({ settings: st }) => { if (st.drive) st.drive.folderId = out.folderId })
        mutateItem(next.id, (it) => {
          it.drive = { fileId: out.fileId, link: out.link, uploadedAt: Date.now() }
          note(it, 'อัปโหลดขึ้น Google Drive แล้ว')
        })
        log(`โพสต์อัตโนมัติ: "${next.title}" ขึ้น Google Drive แล้ว`)
      } catch (err) {
        mutateItem(next.id, (it) => { it.drive = { error: err.message, at: Date.now() } })
        log(`โพสต์อัตโนมัติ: อัป "${next.title}" ขึ้น Drive ไม่ได้ — ${err.message}`)
      }
    } finally {
      driveBusy = false
    }
  }

  async function tick() {
    if (ticking) return
    ticking = true
    try {
      collectTikTokConnection()
      await enroll().catch((err) => log(`โพสต์อัตโนมัติ: ดึงคลิปเข้าคิวไม่ได้ — ${err.message}`))
      await pull().catch((err) => log(`โพสต์อัตโนมัติ: ดึงคลิปจากคลังไม่ได้ — ${err.message}`))
      repairMissingTargets()
      collectChecks()
      fillPosts()
      scheduleAuto()
      await autoCheck().catch(() => {})
      await postDue()
      await syncDrive().catch((err) => log(`โพสต์อัตโนมัติ: Google Drive — ${err.message}`))
    } finally {
      ticking = false
    }
  }
  // เฉพาะ bridge ตัวจริง — bridge ทดสอบ (port อื่น) ใช้คิวไฟล์เดียวกัน ถ้าวนด้วยจะโพสต์คลิปเดียวกันซ้ำสองที่
  if (scheduler) setInterval(() => tick().catch((err) => log(`โพสต์อัตโนมัติ: ${err.message}`)), TICK_MS).unref()

  // ── มุมมองให้แผงข้าง ──
  async function view() {
    collectTikTokConnection()
    await enroll({ force: true }).catch(() => {})
    repairMissingTargets()
    collectChecks()
    const videos = await videosOf()
    const bySlug = new Map(videos.map((v) => [v.slug, v]))
    const postedLog = loadPosted()
    const raw = loadQueue()
    const accData = loadAccounts()
    const queue = raw.filter((q) => q.status !== 'removed').map((q) => {
      const v = bySlug.get(q.slug)
      const f = v?.files.find((x) => x.name === q.file)
      // คลิปที่ยังไม่มีข้อความโพสต์ตอนเข้าคิว แต่ตอนนี้มี post.json แล้ว → เติมให้ (ไม่ทับที่ผู้ใช้แก้)
      const post = !q.post?.title && v?.post ? postFromFile(v.post) : q.post
      // postedOn = แพลตฟอร์มที่คลิปนี้ลงไปแล้ว (สมุดบันทึกห้ามโพสต์ซ้ำ) — แผงใช้ล็อกช่องติ๊กของแพลตฟอร์มนั้น
      return { ...q, post, thumb: v?.thumb ?? null, video: f?.url ?? null, seconds: f?.seconds ?? null, missing: !f, postedOn: postedLog[clipKey(q)] ?? null, nextSlot: q.status === 'review' ? nextSlotForItem(accData, raw, q) : null }
    })
    const inQueue = new Set(queue.map((q) => `${q.slug}/${q.file}`))
    const library = videos
      .map((v) => ({ slug: v.slug, title: v.title, thumb: v.thumb, file: v.files.find((f) => f.main)?.name ?? v.files[0]?.name, updatedAt: v.updatedAt }))
      .filter((v) => v.file && !inQueue.has(`${v.slug}/${v.file}`))
    const pub = publicAccounts()
    const allQueue = loadQueue() // นับแบบเดียวกับตอนโพสต์ (รวมคลิปที่เอาออกจากคิวแล้ว)
    // อีกกี่โพสต์ถึงรอบ Story ของแต่ละเพจ (โพสต์ที่ storyIn = 1 คือโพสต์ถัดไป)
    pub.facebook = pub.facebook.map((a) => (Number(a.storyEvery) > 0 ? { ...a, storyIn: Math.max(1, Number(a.storyEvery) - postsSinceStory(allQueue, `fb:${a.id}`, a.storySince)) } : a))
    return { ...pub, tiktokConnection, queue, library, statusLabels: STATUS, categories: CATEGORIES, uploading, redirectUri, nextSlot: (() => {
      // ช่องว่างถัดไปของเพจไหนก็ได้ (ช่องเวลาต่อเพจ)
      const keys = allTargets()
      const free = (keys.length ? keys : [null]).map((k) => nextFreeSlot(slotsFor(accData, k ? [k] : []), k ? takenFor(raw, [k]) : [])).filter(Boolean)
      return free.length ? Math.min(...free) : null
    })() }
  }

  function oauthPage(res, ok, message) {
    const color = ok ? '#8a6100' : '#ae402f'
    res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    const safe = String(message).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>เชื่อมต่อ YouTube</title>
<body style="font:16px/1.6 'Noto Sans Thai','Leelawadee UI',system-ui,sans-serif;background:#fbf4e2;color:#3a2a00;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px">
<div style="max-width:440px;background:#fffaf0;border:2px solid ${color};border-radius:14px;padding:24px"><h1 style="margin:0 0 8px;font-size:20px;color:${color}">${ok ? '✓ เชื่อมต่อช่องแล้ว' : 'เชื่อมต่อไม่สำเร็จ'}</h1><p style="margin:0">${safe}</p><p style="margin:12px 0 0;color:#6b5a2a">ปิดแท็บนี้แล้วกลับไปที่แผงข้าง ธรรมะ Auto ได้เลย</p></div></body>`)
  }

  async function handle(req, res, url) {
    const path = url.pathname
    const host = req.headers.host ?? ''
    const localHost = host === `127.0.0.1:${port}` || host === `localhost:${port}`

    // Google ส่งกลับมาที่ http://127.0.0.1:<port>/?code=…&state=… (redirect แบบ loopback ของแอป Desktop)
    if (req.method === 'GET' && path === '/' && url.searchParams.has('state') && oauthStates.has(url.searchParams.get('state'))) {
      const state = url.searchParams.get('state')
      const { expires, kind } = oauthStates.get(state)
      oauthStates.delete(state)
      if (!localHost || Date.now() > expires) return oauthPage(res, false, 'ลิงก์เชื่อมต่อหมดอายุ — กดเชื่อมต่อใหม่จากแผงข้าง'), true
      if (url.searchParams.get('error')) return oauthPage(res, false, `Google ตอบว่า: ${url.searchParams.get('error')}`), true
      try {
        const { settings: st } = loadAccounts()
        const { clientId, clientSecret } = kind === 'drive' ? st.driveClient : st.google
        if (kind === 'drive') {
          const acc = await drive.connect({ clientId, clientSecret, code: url.searchParams.get('code'), redirectUri })
          updateAccounts(({ settings }) => {
            // บัญชีเดิม → เก็บโฟลเดอร์เดิมไว้ · บัญชีใหม่ → สร้างโฟลเดอร์ใหม่ตอนอัปครั้งแรก
            const sameAccount = settings.drive?.email && settings.drive.email === acc.email
            settings.drive = { refreshToken: acc.refreshToken, email: acc.email, name: acc.name, folderId: sameAccount ? settings.drive.folderId ?? null : null, connectedAt: Date.now() }
          })
          log(`โพสต์อัตโนมัติ: เชื่อมต่อ Google Drive (${acc.email}) แล้ว`)
          if (scheduler) setTimeout(() => tick().catch(() => {}), 200)
          return oauthPage(res, true, `Google Drive ของ ${acc.email} พร้อมเก็บคลิปแล้ว`), true
        }
        const ch = await yt.connect({ clientId, clientSecret, code: url.searchParams.get('code'), redirectUri })
        let id
        updateAccounts((data) => {
          const old = data.youtube.find((a) => a.channelId === ch.channelId)
          if (old) Object.assign(old, { name: ch.name, refreshToken: ch.refreshToken })
          else data.youtube.push({ id: (id = newId()), name: ch.name, channelId: ch.channelId, refreshToken: ch.refreshToken, privacy: 'public', addedAt: Date.now() })
        })
        if (id) retarget()
        log(`โพสต์อัตโนมัติ: เชื่อมต่อช่อง YouTube "${ch.name}" แล้ว`)
        return oauthPage(res, true, `ช่อง "${ch.name}" พร้อมโพสต์แล้ว`), true
      } catch (err) {
        return oauthPage(res, false, err.message), true
      }
    }

    if (!path.startsWith('/api/posting')) return false
    if (!localHost || req.headers['x-bridge-token'] !== token) return json(res, 401, { error: 'token ไม่ถูกต้อง' }), true

    try {
      if (req.method === 'GET' && path === '/api/posting/tiktok/job') {
        const id = url.searchParams.get('id')
        const job = jobs.get(id)
        const item = loadQueue().find(q => q.status === 'posting' && q.tiktokJobId === id)
        if (!item || !job || job.agent !== 'tiktok' || job.kind !== 'tiktok-post' || job.status !== 'running' || job.cancelled) return json(res, 409, { error: 'งาน TikTok นี้ไม่ได้กำลังโพสต์แล้ว' }), true
        const file = item.deliverySnapshot?.file ?? videoPath(item)
        if (item.deliverySnapshot && (!resolve(file).startsWith(resolve(POSTING_DIR, 'staging') + sep) || !/^[a-f0-9-]{36}\.mp4$/.test(basename(file)))) return json(res, 409, { error: 'ไฟล์ส่ง TikTok ไม่ตรงกับงานนี้' }), true
        const cover = item.deliverySnapshot?.cover
        const coverOk = cover && resolve(cover).startsWith(resolve(POSTING_DIR, 'staging') + sep) && /^[a-f0-9-]{36}\.jpg$/.test(basename(cover)) && existsSync(cover)
        return json(res, 200, { file, ...(coverOk ? { cover } : {}), username: job.payload.username, caption: job.payload.caption }), true
      }
      if (req.method === 'GET' && path === '/api/posting') return json(res, 200, await view()), true
      // เบาๆ สำหรับแจ้งเตือน (background ถามทุกนาที) + บรรทัด "โพสต์ล่าสุด" — ไม่ดึงคลัง/ไม่ไล่คิวแบบ view()
      if (req.method === 'GET' && path === '/api/posting/recent') {
        const now = Date.now()
        const queue = loadQueue()
        return json(res, 200, { now, events: postingEvents(queue, Number(url.searchParams.get('since')) || now), last: lastPosted(queue) }), true
      }
      if (req.method !== 'POST') return json(res, 404, { error: 'ไม่มี endpoint นี้' }), true
      const body = await readBody(req)

      // ── ตั้งค่า + บัญชี ──
      if (path === '/api/posting/settings') {
        const beforeSlots = loadAccounts()
        updateAccounts(({ settings }) => {
          if (typeof body.enabled === 'boolean') settings.enabledAt = body.enabled ? settings.enabledAt ?? Date.now() : null
          if (typeof body.autoCheck === 'boolean') settings.autoCheck = body.autoCheck
          if (typeof body.autoApprove === 'boolean') settings.autoApprove = body.autoApprove
          if (typeof body.autoPull === 'boolean') settings.autoPull = body.autoPull
          if (typeof body.skipCheck === 'boolean') settings.skipCheck = body.skipCheck
          if (body.slots !== undefined) settings.slots = cleanSlots(body.slots)
        })
        // เปลี่ยนเวลากลาง → คลิปที่ตั้งตามช่องเดิมย้ายไปช่องใหม่ (ไม่ย้ายข้ามเพจ)
        if (body.slots !== undefined) retime(beforeSlots, 'เปลี่ยนเวลาโพสต์กลาง')
        // เพิ่งเปิดดึงเอง / เพิ่มช่องเวลา → เติมคิวเลย ผู้ใช้เห็นทันที ไม่ต้องรอรอบถัดไป
        await pull().catch((err) => log(`โพสต์อัตโนมัติ: ดึงคลิปจากคลังไม่ได้ — ${err.message}`))
        return json(res, 200, await view()), true
      }
      // Google client ของ YouTube (/google) และของ Drive (/drive/client) เก็บแยกกัน
      if (path === '/api/posting/google' || path === '/api/posting/drive/client') {
        const key = path === '/api/posting/google' ? 'google' : 'driveClient'
        const clientId = String(body.clientId ?? '').trim()
        const clientSecret = String(body.clientSecret ?? '').trim()
        if (!/\.apps\.googleusercontent\.com$/.test(clientId)) return json(res, 400, { error: 'Client ID ต้องลงท้ายด้วย .apps.googleusercontent.com' }), true
        updateAccounts(({ settings }) => {
          // เปลี่ยน client ของ Drive → การเชื่อมต่อเดิมใช้ไม่ได้แล้ว ต้องเชื่อมต่อใหม่
          if (key === 'driveClient' && settings.driveClient.clientId && settings.driveClient.clientId !== clientId) settings.drive = null
          settings[key].clientId = clientId
          if (clientSecret && !clientSecret.startsWith('••••')) settings[key].clientSecret = clientSecret
        })
        if (!loadAccounts().settings[key].clientSecret) return json(res, 400, { error: 'ใส่ Client secret ด้วย' }), true
        return json(res, 200, await view()), true
      }
      if (path === '/api/posting/facebook') {
        const pageId = String(body.pageId ?? '').trim()
        const token = String(body.token ?? '').trim()
        if (!/^\d{5,}$/.test(pageId)) return json(res, 400, { error: 'Page ID ต้องเป็นตัวเลข (ดูได้ในหน้าเกี่ยวกับของเพจ)' }), true
        if (token.length < 20) return json(res, 400, { error: 'ใส่ Page access token ให้ครบ' }), true
        const page = await fb.info({ pageId, token }) // ตรวจว่าใช้ได้จริงก่อนบันทึก
        const name = String(body.name ?? '').trim() || page.name
        let id
        updateAccounts((data) => {
          const old = data.facebook.find((a) => a.pageId === pageId)
          if (old) Object.assign(old, { name, token, checkedAt: Date.now() })
          else data.facebook.push({ id: (id = newId()), name, pageId, token, addedAt: Date.now(), checkedAt: Date.now() })
        })
        if (id) retarget()
        log(`โพสต์อัตโนมัติ: เพิ่มเพจ "${name}"`)
        return json(res, 200, await view()), true
      }
      if (path === '/api/posting/tiktok/connect') {
        if (tiktokConnection?.status === 'running') return json(res, 200, await view()), true
        const job = enqueue('tiktok', 'tiktok-account', { label: 'ตรวจบัญชี TikTok' })
        tiktokConnection = { status: 'running', jobId: job.id, startedAt: Date.now() }
        return json(res, 200, await view()), true
      }
      if (path === '/api/posting/tiktok/update') {
        if (!['public', 'friends', 'private'].includes(body.privacy)) return json(res, 400, { error: 'เลือกการมองเห็น TikTok ก่อน' }), true
        let found = false
        updateAccounts(data => {
          const account = data.tiktok.find(a => a.id === body.id)
          if (account) { found = true; account.privacy = body.privacy; if (typeof body.aigc === 'boolean') account.aigc = body.aigc }
        })
        if (!found) return json(res, 404, { error: 'ไม่พบบัญชี TikTok นี้' }), true
        return json(res, 200, await view()), true
      }
      // ลง Story ทุก N โพสต์ (0 = ปิด) — เปลี่ยนค่าแล้วเริ่มนับใหม่ ไม่เอาโพสต์เก่ามานับ
      if (path === '/api/posting/facebook/update') {
        const every = Number(body.storyEvery)
        if (!STORY_EVERY.includes(every)) return json(res, 400, { error: 'ค่ารอบ Story ไม่ถูกต้อง' }), true
        let found = false
        updateAccounts((data) => {
          const a = data.facebook.find((x) => x.id === body.id)
          if (a) { found = true; if (Number(a.storyEvery ?? 0) !== every) a.storySince = Date.now(); a.storyEvery = every }
        })
        if (!found) return json(res, 404, { error: 'ไม่พบเพจนี้' }), true
        return json(res, 200, await view()), true
      }
      if (path === '/api/posting/facebook/remove' || path === '/api/posting/youtube/remove' || path === '/api/posting/tiktok/remove') {
        const kind = path.includes('facebook') ? 'facebook' : path.includes('tiktok') ? 'tiktok' : 'youtube'
        updateAccounts((data) => { data[kind] = data[kind].filter((a) => a.id !== body.id) })
        const key = `${{ facebook: 'fb', youtube: 'yt', tiktok: 'tk' }[kind]}:${body.id}`
        saveQueue(loadQueue().map((q) => (q.status === 'posted' ? q : { ...q, targets: (q.targets ?? []).filter((k) => k !== key) })))
        return json(res, 200, await view()), true
      }
      // หมวดที่เพจ/ช่องนี้รับ — ว่าง = รับทุกหมวด
      if (path === '/api/posting/account/categories') {
        const kind = body.kind === 'youtube' ? 'youtube' : body.kind === 'tiktok' ? 'tiktok' : 'facebook'
        let found = false
        updateAccounts((data) => {
          const a = data[kind].find((x) => x.id === body.id)
          if (a) {
            a.categories = cleanCategories(body.categories)
            found = true
          }
        })
        if (!found) return json(res, 404, { error: 'ไม่พบบัญชีนี้' }), true
        retarget()
        return json(res, 200, await view()), true
      }
      if (path === '/api/posting/youtube/connect') {
        const { clientId, clientSecret } = loadAccounts().settings.google
        if (!clientId || !clientSecret) return json(res, 400, { error: 'ใส่ Google Client ID และ Client secret ก่อน' }), true
        const state = randomBytes(16).toString('hex')
        oauthStates.set(state, { expires: Date.now() + OAUTH_TTL_MS, kind: 'youtube' })
        return json(res, 200, { url: youtubeAuthUrl({ clientId, redirectUri, state }) }), true
      }
      if (path === '/api/posting/drive/connect') {
        const { clientId, clientSecret } = loadAccounts().settings.driveClient
        if (!clientId || !clientSecret) return json(res, 400, { error: 'ใส่ Client ID และ Client secret ของ Google Drive ก่อน' }), true
        const state = randomBytes(16).toString('hex')
        oauthStates.set(state, { expires: Date.now() + OAUTH_TTL_MS, kind: 'drive' })
        return json(res, 200, { url: youtubeAuthUrl({ clientId, redirectUri, state, scopes: DRIVE_SCOPES }) }), true
      }
      if (path === '/api/posting/drive/remove') {
        // เลิกเชื่อมต่อเท่านั้น — คลิปที่อยู่บน Drive แล้วไม่ถูกลบ (ไม่มีสิทธิ์เข้าไปลบแล้ว) บอกผู้ใช้ในหน้าจอ
        updateAccounts(({ settings }) => { settings.drive = null })
        return json(res, 200, await view()), true
      }
      if (path === '/api/posting/youtube/update') {
        if (!['public', 'unlisted', 'private'].includes(body.privacy)) return json(res, 400, { error: 'ค่าความเป็นส่วนตัวไม่ถูกต้อง' }), true
        updateAccounts((data) => {
          const a = data.youtube.find((x) => x.id === body.id)
          if (a) a.privacy = body.privacy
        })
        return json(res, 200, await view()), true
      }

      // ── คิว ──
      if (path === '/api/posting/add') {
        await seedDeliveryHistory() // Preserve removed legacy successes before replacing their queue row.
        const slug = String(body.slug ?? '')
        const file = String(body.file ?? '')
        if (!/^[^\\/.][^\\/]*$/.test(slug) || !/^[^\\/]+\.mp4$/i.test(file) || !existsSync(join(PROJECTS, slug, '06_render', file))) return json(res, 400, { error: 'ไม่พบคลิปนี้' }), true
        const queue = loadQueue().filter((q) => !(q.slug === slug && q.file === file && q.status === 'removed'))
        if (!queue.some((q) => q.slug === slug && q.file === file)) {
          const v = (await videosOf()).find((x) => x.slug === slug)
          const item = newItem({ slug, file, title: v?.title ?? slug, post: readPost(slug) })
          fillTargets(item, loadAccounts())
          note(item, 'เพิ่มจากคลังวิดีโอ')
          queue.push(item)
        }
        saveQueue(queue)
        return json(res, 200, await view()), true
      }
      if (path === '/api/posting/item') {
        mutateItem(body.id, (it) => {
          if (it.status === 'posting' || it.status === 'posted') throw new Error('คลิปนี้โพสต์ไปแล้ว แก้ไม่ได้')
          if (body.post) {
            it.post = {
              ...it.post,
              title: String(body.post.title ?? it.post.title ?? '').trim().slice(0, 200),
              description: String(body.post.description ?? it.post.description ?? '').slice(0, 5000),
              hashtags: cleanHashtags(body.post.hashtags ?? it.post.hashtags),
            }
          }
          // เลือกหมวดเอง (null = ไม่รู้หมวด) → ปลายทางตามหมวดใหม่ ถ้ายังไม่ได้ติ๊กเอง
          if (body.category !== undefined) {
            it.category = CATEGORIES.includes(body.category) ? body.category : null
            it.categoryBy = it.category ? 'manual' : null
            if (!it.targetsEdited) it.targets = targetsFor(loadAccounts(), it.category, { clip: clipKey(it) })
          }
          if (Array.isArray(body.targets)) {
            const valid = new Set(allTargets())
            const picked = body.targets.filter((k) => valid.has(k))
            // กฎห้ามโพสต์ซ้ำ: แพลตฟอร์มละ 1 ปลายทาง · แพลตฟอร์มที่คลิปนี้เคยลงแล้วเลือกไม่ได้
            const used = loadPosted()[clipKey(it)] ?? {}
            const posted = picked.filter((k) => used[platformOf(k)] && !it.results?.[k]?.ok)
            if (posted.length) {
              const p = platformOf(posted[0])
              throw new Error(`คลิปนี้เคยโพสต์ลง ${PLATFORM_NAME[p] ?? p} แล้ว (${used[p].name ?? used[p].key}) — ห้ามโพสต์คลิปเดิมซ้ำในแพลตฟอร์มเดิม`)
            }
            const perPlatform = new Map()
            for (const k of picked) perPlatform.set(platformOf(k), (perPlatform.get(platformOf(k)) ?? 0) + 1)
            const dup = [...perPlatform].find(([, n]) => n > 1)
            if (dup) throw new Error(`เลือกได้ ${PLATFORM_NAME[dup[0]] ?? dup[0]} เพจ/ช่องเดียวต่อคลิป — คลิปเดียวกันลงหลายเพจผิดกฎชุมชน (คลิปซ้ำ)`)
            it.targets = picked
            it.targetsEdited = true
          }
          // กลับไปให้ระบบเลือกปลายทางตามหมวด
          if (body.resetTargets) {
            it.targetsEdited = false
            it.targets = targetsFor(loadAccounts(), it.category, { clip: clipKey(it) })
          }
        })
        return json(res, 200, await view()), true
      }
      // เวลาโพสต์ของเพจนี้เอง (ผู้ใช้: ตั้งค่าแต่ละเพจต่างกันได้) — ว่าง = กลับไปใช้เวลากลาง
      if (path === '/api/posting/account/slots') {
        const kind = ['youtube', 'tiktok'].includes(body.kind) ? body.kind : 'facebook'
        const beforeSlots = loadAccounts()
        let found = false
        updateAccounts((data) => {
          const a = (data[kind] ?? []).find((x) => x.id === body.id)
          if (!a) return
          const list = cleanSlots(body.slots)
          if (list.length) a.slots = list
          else delete a.slots
          found = true
        })
        if (!found) return json(res, 404, { error: 'ไม่พบบัญชีนี้' }), true
        retime(beforeSlots, 'เปลี่ยนเวลาของเพจ')
        return json(res, 200, await view()), true
      }
      if (path === '/api/posting/approve-all') {
        const count = approveAll()
        return json(res, 200, { ...(await view()), approvedAll: count }), true
      }
      if (path === '/api/posting/reorganize') {
        const out = reorganize('กดจัดคิวใหม่')
        return json(res, 200, { ...(await view()), reorganized: out }), true
      }
      if (path === '/api/posting/check') {
        await startCheck(body.id)
        return json(res, 200, await view()), true
      }
      if (path === '/api/posting/approve') {
        const queue = loadQueue()
        const { settings } = loadAccounts()
        const taken = takenFor(queue, queue.find((q) => q.id === body.id)?.targets, body.id) // ช่องเวลาต่อเพจ
        const at = body.when === 'now' ? Date.now() : body.when === 'next' ? nextFreeSlot(slotsFor(loadAccounts(), queue.find((q) => q.id === body.id)?.targets), taken) : Number(body.when)
        if (!Number.isFinite(at) || !at) return json(res, 400, { error: body.when === 'next' ? 'ยังไม่ได้ตั้งช่องเวลาประจำ — ตั้งในแท็บตั้งค่า หรือเลือกวันเวลาเอง' : 'เลือกวันเวลาโพสต์ก่อน' }), true
        if (body.when !== 'now' && at < Date.now() - 60_000) return json(res, 400, { error: 'เวลาที่เลือกผ่านไปแล้ว' }), true
        mutateItem(body.id, (it) => {
          if (!it.post?.title?.trim()) throw new Error('ยังไม่มีชื่อโพสต์ — ใส่ชื่อก่อนอนุมัติ')
          if (!it.targets?.length) {
            const done = Object.keys(loadPosted()[clipKey(it)] ?? {}).map((p) => PLATFORM_NAME[p] ?? p)
            throw new Error(done.length ? `คลิปนี้ลง ${done.join(' และ ')} ไปแล้ว — ห้ามโพสต์ซ้ำในแพลตฟอร์มเดิม (เหลือเฉพาะแพลตฟอร์มที่ยังไม่เคยลง)` : 'ยังไม่ได้เลือกเพจหรือช่องที่จะโพสต์')
          }
          if (it.status === 'posting' || it.status === 'posted') throw new Error('คลิปนี้โพสต์ไปแล้ว')
          it.status = 'scheduled'
          it.scheduleAt = at
          note(it, body.when === 'now' ? 'อนุมัติ · โพสต์ทันที' : `อนุมัติ · ตั้งเวลา ${new Date(at).toLocaleString('th-TH')}`)
        })
        if (body.when === 'now' && scheduler) setTimeout(() => tick().catch(() => {}), 200)
        return json(res, 200, await view()), true
      }
      if (path === '/api/posting/unschedule') {
        mutateItem(body.id, (it) => {
          if (it.status !== 'scheduled') throw new Error('คลิปนี้ไม่ได้อยู่ในรายการตั้งเวลา')
          it.status = 'review'
          it.scheduleAt = null
          note(it, 'ยกเลิกเวลา กลับไปรอตรวจ')
        })
        return json(res, 200, await view()), true
      }
      if (path === '/api/posting/reject') {
        mutateItem(body.id, (it) => {
          if (it.status === 'posting' || it.status === 'posted') throw new Error('คลิปนี้โพสต์ไปแล้ว')
          it.status = 'rejected'
          it.scheduleAt = null
          note(it, `ตีกลับ${body.reason ? `: ${body.reason}` : ''}`)
        })
        return json(res, 200, await view()), true
      }
      if (path === '/api/posting/restore') {
        mutateItem(body.id, (it) => {
          if (it.status !== 'rejected') throw new Error('คลิปนี้ไม่ได้ถูกตีกลับ')
          it.status = 'review'
          note(it, 'ดึงกลับมารอตรวจ')
        })
        return json(res, 200, await view()), true
      }
      if (path === '/api/posting/retry') {
        const pending = loadQueue().find(q => q.id === body.id)
        if (pending?.status === 'failed' && !(pending.targets ?? []).some(k => !pending.results?.[k]?.ok && !pending.results?.[k]?.needsVerification)) {
          return json(res, 409, { error: 'ไม่มีปลายทางที่ส่งซ้ำได้อย่างปลอดภัย — ผลที่ยังไม่ชัดเจนถูกระงับเพื่อป้องกันโพสต์ซ้ำ' }), true
        }
        mutateItem(body.id, (it) => {
          if (it.status !== 'failed') throw new Error('คลิปนี้ไม่ได้โพสต์พลาด')
          it.status = 'scheduled'
          it.scheduleAt = Date.now()
          note(it, 'ลองโพสต์ใหม่ (เฉพาะที่พลาด)')
        })
        if (scheduler) setTimeout(() => tick().catch(() => {}), 200)
        return json(res, 200, await view()), true
      }
      if (path === '/api/posting/remove') {
        const queue = loadQueue()
        const item = queue.find((q) => q.id === body.id)
        if (item?.status === 'posting') return json(res, 409, { error: 'กำลังโพสต์อยู่ — รอให้เสร็จก่อน' }), true
        // เก็บไว้เป็นสถานะ removed (ซ่อน) — ไม่งั้นรอบเข้าคิวเองจะดึงคลิปนี้กลับมาอีก · เพิ่มคืนจากคลังได้
        if (item) {
          item.status = 'removed'
          item.scheduleAt = null
          note(item, 'เอาออกจากคิว')
          saveQueue(queue)
        }
        rmSync(join(POSTING_DIR, 'frames', String(body.id).replace(/[^\w-]/g, '')), { recursive: true, force: true })
        return json(res, 200, await view()), true
      }
      return json(res, 404, { error: 'ไม่มี endpoint นี้' }), true
    } catch (err) {
      return json(res, 500, { error: String(err.message) }), true
    }
  }

  /**
   * จัดคิวใหม่ตามช่องเวลาต่อเพจ (เลือกเพจใหม่ให้กระจาย · ลงช่องว่างแรกของแต่ละเพจ) — คลิปที่ติ๊กเพจเอง/แบ่งเพจไว้/เลือกเวลาเองไม่แตะ
   * ไม่ทำระหว่างกำลังโพสต์ (คิวกำลังเปลี่ยน)
   */
  /** เปลี่ยนเวลาโพสต์ (กลาง/ของเพจ) → คลิปที่ตั้งตามช่องเดิมย้ายไปช่องว่างแรกตามเวลาใหม่ · ไม่ย้ายคลิปข้ามเพจ */
  function retime(beforeData, reason) {
    if (uploading) return
    const old = loadQueue()
    const { queue, rescheduled } = reorganizeQueue(old, loadAccounts(), { retarget: false, before: beforeData })
    if (!rescheduled) return
    for (const q of queue) {
      const o = old.find((x) => x.id === q.id)
      if (o && o.scheduleAt !== q.scheduleAt) note(q, `${reason}: ย้ายเวลาเป็น ${new Date(q.scheduleAt).toLocaleString('th-TH')}`)
    }
    saveQueue(queue)
    log(`โพสต์อัตโนมัติ: ${reason} — ย้ายเวลา ${rescheduled} คลิปตามช่องใหม่`)
  }

  /**
   * ✓ โพสต์ทั้งหมดเลย (ไม่ตรวจ) — ผู้ใช้ (8 พ.ย. 2026): "บอกไม่ต้องตรวจให้ post ได้เลย และแบ่งกันระหว่าง 2 เพจ"
   * คลิปรอตรวจทุกคลิป → ข้าม AI ตรวจ (auto 'now') · ไม่มีชื่อโพสต์ให้ ChatGPT เขียนให้ (ที่เคยพลาดก็ลองใหม่) ·
   * กระจายเพจให้คลิปละ 1 เพจต่อแพลตฟอร์ม (ที่ติ๊กเองหลายเพจก็เหลือเพจเดียว) · แล้วลงช่องเวลาของเพจนั้นเอง
   * คลิปที่ AI บอกให้แก้ / ไม่มีไฟล์ ก็ไปด้วย — ผู้ใช้สั่งเองว่าไม่ต้องตรวจ
   */
  function approveAll() {
    if (uploading) throw new Error('กำลังโพสต์อยู่ — รอโพสต์เสร็จแล้วค่อยกดอีกครั้ง')
    const accounts = loadAccounts()
    const queue = loadQueue()
    const picked = queue.filter((q) => q.status === 'review')
    if (!picked.length) return 0
    for (const q of picked) {
      q.auto = 'now'
      if (q.postJob?.status === 'error') q.postJob = null
      if (q.targetsEdited) q.targets = onePerPlatform(q.targets ?? [], { clip: clipKey(q), queue: queue.filter((x) => x.id !== q.id) })
      note(q, 'โพสต์ทั้งหมดเลย (ไม่ตรวจ) — รอชื่อโพสต์/ช่องเวลาของเพจ')
    }
    const { queue: spread } = reorganizeQueue(queue, accounts)
    saveQueue(spread)
    log(`โพสต์อัตโนมัติ: โพสต์ทั้งหมดเลย (ไม่ตรวจ) ${picked.length} คลิป — กระจายเพจและตั้งเวลาให้เอง`)
    fillPosts()
    scheduleAuto()
    return picked.length
  }

  function reorganize(reason) {
    if (uploading) throw new Error('กำลังโพสต์อยู่ — รอโพสต์เสร็จแล้วค่อยจัดคิวใหม่')
    const before = loadQueue()
    const accounts = loadAccounts()
    const { queue, retargeted, rescheduled } = reorganizeQueue(before, accounts)
    const name = (k) => findTarget(accounts, k).account?.name ?? k
    for (const q of queue) {
      const old = before.find((x) => x.id === q.id)
      const moved = old && (old.targets ?? []).join() !== q.targets.join()
      const timed = old && old.scheduleAt !== q.scheduleAt
      if (moved || timed) note(q, `จัดคิวใหม่ (${reason}): ${moved ? `ลง ${q.targets.map(name).join(', ') || '—'}` : ''}${moved && timed ? ' · ' : ''}${timed ? `เวลา ${new Date(q.scheduleAt).toLocaleString('th-TH')}` : ''}`)
    }
    saveQueue(queue)
    log(`โพสต์อัตโนมัติ: จัดคิวใหม่ (${reason}) — เปลี่ยนเพจ ${retargeted} คลิป · เปลี่ยนเวลา ${rescheduled} คลิป`)
    return { retargeted, rescheduled }
  }
  // รุ่นที่เปลี่ยนเป็นช่องเวลาต่อเพจ: จัดคิวเดิมใหม่ครั้งเดียวตอนเปิดโปรแกรม
  // (เฉพาะตอนมีแพลตฟอร์มที่มีหลายเพจ — เพจเดียวไม่มีอะไรให้กระจาย)
  if (!loadAccounts().settings.perPageQueueAt) {
    try {
      if (multiAccountPlatforms(loadAccounts()).size) {
        reorganize('เปลี่ยนเป็นช่องเวลาต่อเพจ')
        updateAccounts((a) => { a.settings.perPageQueueAt = Date.now() }) // จดเฉพาะตอนจัดจริง — เพิ่มเพจที่สองทีหลังจะได้จัดให้ตอนเปิดครั้งถัดไป
      }
    } catch (err) {
      log(`โพสต์อัตโนมัติ: จัดคิวใหม่ไม่ได้ — ${err.message}`)
    }
  }

  return { handle, busy: () => uploading || driveBusy, tick, syncDrive, enqueueAuto, reorganize }
}
