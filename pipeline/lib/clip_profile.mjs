/**
 * โปรไฟล์ของคลิป — หมวด (พุทธประวัติ / พระเกจิ / ธรรมะทั่วไป) + ข้อมูลพระเกจิ + ภาพอ้างอิง
 *
 * เก็บที่ projects/<slug>/00_ref/
 *   profile.json   { category, monk?: { name, wiki, wikiTitle, url, summary, images: [{ file, source, page }] } }
 *   monk_*.jpg     ภาพอ้างอิงพระเกจิจาก Wikimedia Commons (ใช้แนบให้ ChatGPT/Flow วาดตัวละครให้ตรงกับท่าน)
 *   buddha_*.jpg   หมวดพุทธประวัติ: ภาพพระพุทธรูปอ้างอิง (ใช้วาด @buddha)
 *
 * หมวดมาจาก: แนวที่เลือก/คอลัมน์ Genre ของหัวข้อ → ถ้าไม่รู้ ดูจากชื่อเรื่อง
 * ดึงข้อมูลจากวิกิพีเดียภาษาไทยผ่าน API สาธารณะ (ไม่ต้องใช้ key) — ล้มเหลวก็ทำคลิปต่อได้ แค่ไม่มีภาพอ้างอิง
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { createHash } from 'node:crypto'
import { ROOT, loadConfig } from './config.mjs'
import { categoryOf, monkInTitle, ART_STYLES, RETIRED_ART_STYLES, BUDDHA_NARRATIONS } from '../../extension/prompts.js'
import { readSelfMonk, selfMonkReady, SELF_NOT_READY } from './self_monk.mjs'

const UA = { 'user-agent': 'DhammaAuto/1.0 (personal Dhamma video tool; Wikimedia API)' }
const WIKI_API = 'https://th.wikipedia.org/w/api.php'
const MAX_REF_IMAGES = 3

export const refDir = (slug) => join(ROOT, 'projects', slug, '00_ref')
const profileFile = (slug) => join(refDir(slug), 'profile.json')

export function readProfile(slug) {
  if (!slug) return null
  try {
    const profile = existsSync(profileFile(slug)) ? JSON.parse(readFileSync(profileFile(slug), 'utf8')) : null
    // ลายเส้นที่เลิกใช้แล้ว (ภาพวาดจีน) → อ่านเป็นลายเส้นที่มาแทน ไม่แก้ไฟล์ของคลิป
    if (profile && RETIRED_ART_STYLES[profile.artStyle]) profile.artStyle = RETIRED_ART_STYLES[profile.artStyle]
    return profile
  } catch {
    return null
  }
}

function saveProfile(slug, profile) {
  mkdirSync(refDir(slug), { recursive: true })
  writeFileSync(profileFile(slug), JSON.stringify(profile, null, 2))
  return profile
}

const BUDDHA_WORDS = /พระพุทธเจ้า|พุทธพจน์|พุทธประวัติ|ตรัส|สิทธัตถะ|ตรัสรู้|ปรินิพพาน|ธรรมบท|พระสูตร|ชาดก|พุทธกาล|พระศาสดา|พระพุทธองค์/
const MONK_PREFIX = /(หลวงปู่|หลวงพ่อ|หลวงตา|พระอาจารย์|ครูบา|สมเด็จพระ)\s*([^\s"“”'‘’,:?!]+(?:\s+[^\s"“”'‘’,:?!]+)?)/

// ชื่อเรื่องแบบเหตุการณ์/ชวนสงสัย → เล่าเรื่อง · แบบคำสอน/หลักธรรม → สอนธรรม (ใช้ตอนตั้ง "สุ่ม")
const STORY_TITLE = /ใคร|ทำไม|คืน|วันที่|ครั้ง|เมื่อ|ก่อน|หลัง|เรื่อง|เหตุการณ์|ชาย|หญิง|นาง|องค์สุดท้าย|ย้อนรอย|\?/
const TEACH_TITLE = /คำสอน|หลักธรรม|^จง|ข้อ|ประการ|ไตรลักษณ์|อริยสัจ|วัฏ|พรหมวิหาร|อิทธิบาท|พุทธพจน์|ตนแล/

/**
 * ลายเส้น + วิธีเล่าของคลิป ตามตั้งค่าคลิปตอนเริ่มทำ ("สุ่ม" = เลือกตอนนี้แล้วจำไว้กับคลิป ทุกขั้นใช้แบบเดียวกัน)
 */
function clipStyle(category, title) {
  const config = loadConfig()
  const pick = (list) => list[Math.floor(Math.random() * list.length)]
  // ผลิตต่อเนื่องส่ง CLIP_ART_STYLE / CLIP_NARRATION มาแทนตั้งค่าคลิป (สุ่มต่อคลิปโดยไม่แก้ค่าของผู้ใช้)
  // โหมดพระสอนธรรม: การ์ตูนหน้าเหมือนพระเสมอ (ลายเส้นภาพวาดเป็นสัดส่วนสมจริง ไม่ใช่การ์ตูน — ผู้ใช้เลือกการ์ตูน)
  if (category === 'self') return { artStyle: 'doodle' }
  const chosen = process.env.CLIP_ART_STYLE || config.art?.style
  const art = RETIRED_ART_STYLES[chosen] ?? chosen
  const artStyle =ART_STYLES[art] && art !== 'random' ? art : art === 'random' ? pick(Object.keys(ART_STYLES).filter((k) => k !== 'random')) : 'doodle'
  if (category !== 'buddha') return { artStyle }
  const want = process.env.CLIP_NARRATION || config.script?.buddhaNarration
  const t = String(title ?? '')
  const narration = BUDDHA_NARRATIONS[want] && want !== 'random' ? want
    : want === 'random' ? (TEACH_TITLE.test(t) ? 'teach' : STORY_TITLE.test(t) ? 'story' : pick(['teach', 'story']))
    : 'teach'
  return { artStyle, narration }
}

/** เดาหมวดจากชื่อเรื่อง */
export function detectCategory(title) {
  const t = String(title ?? '')
  if (monkInTitle(t) || MONK_PREFIX.test(t)) return 'monk'
  if (BUDDHA_WORDS.test(t)) return 'buddha'
  return 'dhamma'
}

/** พระเกจิของคลิป: จากรายชื่อก่อน ไม่อยู่ในรายชื่อใช้คำในชื่อเรื่อง ("หลวงปู่xxx") ไปค้นวิกิพีเดีย */
function monkFromTitle(title) {
  const known = monkInTitle(title)
  if (known) return { name: known.name, wiki: known.wiki, aka: known.aka }
  const m = String(title ?? '').match(MONK_PREFIX)
  return m ? { name: `${m[1]}${m[2]}`.trim(), wiki: `${m[1]}${m[2]}`.trim() } : null
}

async function wikiQuery(params) {
  const url = new URL(WIKI_API)
  for (const [k, v] of Object.entries({ action: 'query', format: 'json', redirects: '1', ...params })) url.searchParams.set(k, v)
  // วิกิพีเดียจำกัดความถี่ (429) — รอแล้วลองใหม่ 2 ครั้ง
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) })
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 15_000 * (attempt + 1)))
      continue
    }
    if (!res.ok) throw new Error(`วิกิพีเดียตอบ ${res.status}`)
    return res.json()
  }
}

/** หน้าวิกิพีเดียของพระเกจิ: ชื่อหน้า ลิงก์ ประวัติย่อ ภาพหลัก และรายชื่อไฟล์ภาพในหน้า */
async function findWikiPage(query) {
  const j = await wikiQuery({
    generator: 'search', gsrsearch: query, gsrlimit: '1',
    prop: 'extracts|pageimages|images|info', exintro: '1', explaintext: '1', exchars: '2500',
    piprop: 'thumbnail|name', pithumbsize: '1024', imlimit: '30', inprop: 'url',
  })
  const page = Object.values(j.query?.pages ?? {})[0]
  if (!page) return null
  return {
    title: page.title,
    url: page.fullurl,
    summary: String(page.extract ?? '').trim(),
    mainImage: page.thumbnail?.source ?? null,
    mainName: page.pageimage ? `File:${page.pageimage}` : null,
    files: (page.images ?? []).map((i) => i.title),
  }
}

/** ลิงก์ภาพขนาดไม่เกิน 1024px ของไฟล์ใน Commons — ข้ามไอคอน/โลโก้/แผนที่/svg */
async function fileThumbs(files) {
  const wanted = files.filter((f) => /\.(jpe?g|png)$/i.test(f) && !/icon|logo|flag|map|seal|ตรา|แผนที่|ธง|symbol/i.test(f))
  if (!wanted.length) return []
  const j = await wikiQuery({ titles: wanted.slice(0, 20).join('|'), prop: 'imageinfo', iiprop: 'url|size', iiurlwidth: '1024' })
  return Object.values(j.query?.pages ?? {})
    .map((p) => ({ name: p.title, info: p.imageinfo?.[0] }))
    .filter((p) => p.info?.thumburl && p.info.width >= 300 && p.info.height >= 300)
    .map((p) => ({ name: p.name, url: p.info.thumburl, page: p.info.descriptionurl }))
}

/** โหลดภาพ — seen = ลายนิ้วมือของภาพที่ได้แล้ว (ภาพหลักของหน้ามักซ้ำกับในรายการไฟล์ภายใต้ชื่อ namespace อื่น) */
async function download(url, file, seen) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`โหลดภาพไม่ได้ (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 5_000 || buf.length > 6 * 1024 * 1024) throw new Error('ขนาดภาพไม่เหมาะ')
  const hash = createHash('sha1').update(buf).digest('hex')
  if (seen.has(hash)) throw new Error('ภาพซ้ำ')
  seen.add(hash)
  writeFileSync(file, buf)
}

/** ดึงประวัติ + ภาพอ้างอิงของพระเกจิจากวิกิพีเดีย/Commons → เก็บใน 00_ref/ */
async function fetchMonk(slug, monk, log) {
  let page = await findWikiPage(monk.wiki || monk.name)
  if (!page && monk.wiki && monk.wiki !== monk.name) page = await findWikiPage(monk.name)
  if (!page) {
    log(`   ไม่พบหน้าวิกิพีเดียของ ${monk.name} — ทำต่อโดยไม่มีภาพอ้างอิง`)
    return { ...monk, fetchedAt: Date.now(), images: [] }
  }
  const candidates = []
  if (page.mainImage) candidates.push({ name: page.mainName, url: page.mainImage, page: page.mainName ? `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.mainName)}` : page.url })
  // ภาพอื่นในหน้ามักเป็นวัด อาคาร พระธาตุ หรือภาพหมู่ — ใช้เฉพาะไฟล์ที่ชื่อมีชื่อท่าน (ไม่งั้น Flow วาดผิดคน)
  const names = [monk.name, ...(monk.aka ?? [])].map((n) => n.replace(/^(ท่าน|หลวงปู่|หลวงพ่อ|หลวงตา|สมเด็จพระ)/, '').split(/[\s(]/)[0]).filter((n) => n.length >= 2)
  const own = (f) => names.some((n) => f.includes(n))
  for (const t of await fileThumbs(page.files.filter(own)).catch(() => [])) if (!candidates.some((c) => c.name === t.name)) candidates.push(t)
  const images = []
  const seen = new Set()
  for (const c of candidates) {
    if (images.length >= MAX_REF_IMAGES) break
    const ext = (extname(new URL(c.url).pathname).toLowerCase().match(/\.(jpe?g|png)$/)?.[0] ?? '.jpg').replace('.jpeg', '.jpg')
    const file = `monk_${images.length + 1}${ext}`
    try {
      await download(c.url, join(refDir(slug), file), seen)
      images.push({ file, source: c.url, page: c.page })
    } catch {}
  }
  log(`   ${monk.name}: ${page.title} · ภาพอ้างอิง ${images.length} รูป (Wikimedia Commons)`)
  return { ...monk, wikiTitle: page.title, url: page.url, summary: page.summary, fetchedAt: Date.now(), images }
}

/**
 * ภาพอ้างอิงพระพุทธเจ้า (หมวด 1) — พระพุทธรูปไทยที่คนไทยคุ้นตา จากวิกิพีเดียไทย/Commons
 * ไม่มีภาพถ่ายจริงของพระพุทธเจ้า → ใช้พระพุทธรูปเป็นแบบพระพักตร์ พระเกศ จีวร และรัศมี
 * โหลดครั้งเดียวเก็บที่ refs/buddha/ แล้วคัดลอกไปไว้ใน 00_ref/ ของแต่ละคลิป
 */
const BUDDHA_PAGES = ['พระพุทธชินราช', 'พระศรีศากยมุนี', 'พระพุทธสิหิงค์']
const BUDDHA_CACHE = join(ROOT, 'refs', 'buddha')

async function buddhaCache(log) {
  const manifestFile = join(BUDDHA_CACHE, 'buddha.json')
  if (existsSync(manifestFile)) {
    const cached = JSON.parse(readFileSync(manifestFile, 'utf8'))
    if (cached.images?.length && cached.images.every((i) => existsSync(join(BUDDHA_CACHE, i.file)))) return cached.images
  }
  mkdirSync(BUDDHA_CACHE, { recursive: true })
  const j = await wikiQuery({ titles: BUDDHA_PAGES.join('|'), prop: 'pageimages|info', piprop: 'thumbnail|name', pithumbsize: '1024', inprop: 'url' })
  const pages = Object.values(j.query?.pages ?? {}).filter((p) => p.thumbnail?.source)
  pages.sort((a, b) => BUDDHA_PAGES.indexOf(a.title) - BUDDHA_PAGES.indexOf(b.title))
  const images = []
  const seen = new Set()
  for (const p of pages) {
    if (images.length >= MAX_REF_IMAGES) break
    const ext = (extname(new URL(p.thumbnail.source).pathname).toLowerCase().match(/\.(jpe?g|png)$/)?.[0] ?? '.jpg').replace('.jpeg', '.jpg')
    const file = `buddha_${images.length + 1}${ext}`
    try {
      await download(p.thumbnail.source, join(BUDDHA_CACHE, file), seen)
      images.push({ file, name: p.title, source: p.thumbnail.source, page: p.fullurl })
    } catch {}
  }
  if (!images.length) throw new Error('ไม่ได้ภาพพระพุทธรูปสักรูป')
  writeFileSync(manifestFile, JSON.stringify({ images }, null, 2))
  log(`   โหลดภาพอ้างอิงพระพุทธรูป ${images.length} รูป: ${images.map((i) => i.name).join(', ')} (Wikimedia Commons)`)
  return images
}

/** คัดลอกภาพพระพุทธรูปไปไว้ในคลิป */
async function fetchBuddha(slug, log) {
  const images = await buddhaCache(log)
  for (const i of images) copyFileSync(join(BUDDHA_CACHE, i.file), join(refDir(slug), i.file))
  log(`   ภาพอ้างอิงพระพุทธเจ้า ${images.length} รูป (${images.map((i) => i.name).join(', ')})`)
  return { fetchedAt: Date.now(), images }
}

/**
 * โปรไฟล์ของคลิป — สร้างครั้งแรกแล้วเก็บไว้ (เรียกซ้ำได้ ไม่ดึงซ้ำ)
 * genre = แนวที่ผู้ใช้เลือก หรือคอลัมน์ Genre ของหัวข้อที่ ChatGPT เสนอ
 */
export async function ensureProfile(slug, { title, genre, log = console.log } = {}) {
  let profile = readProfile(slug)
  if (!profile) {
    const category = categoryOf(genre)?.id ?? detectCategory(title)
    // โหมดพระสอนธรรมต้องมีรูปหน้าพระก่อน — ไม่งั้นได้พระหน้าใครก็ไม่รู้
    if (category === 'self' && !selfMonkReady()) throw new Error(SELF_NOT_READY)
    profile = { category, title, ...clipStyle(category, title) }
    // จำชื่อพระไว้กับคลิป (เปลี่ยนชื่อในแผงข้างทีหลัง คลิปเดิมยังใช้ชื่อเดิม)
    if (category === 'self') profile.self = { name: readSelfMonk().name }
    if (category === 'monk') {
      const monk = monkFromTitle(title)
      // หมวดพระเกจิแต่ชื่อเรื่องไม่มีชื่อท่าน → ถือเป็นธรรมะทั่วไป (ไม่มีใครให้ดึงภาพ)
      if (monk) profile.monk = monk
      else profile.category = 'dhamma'
    }
    saveProfile(slug, profile)
    log(`   หมวดของคลิป: ${profile.category}${profile.monk ? ` · ${profile.monk.name}` : ''}${profile.narration ? ` · วิธีเล่า ${profile.narration}` : ''} · ลายเส้น ${profile.artStyle}`)
  }
  // ยังไม่เคยดึงสำเร็จ (เช่น เน็ตหลุดรอบก่อน) → ลองใหม่
  if (profile.category === 'monk' && profile.monk && !profile.monk.fetchedAt) {
    mkdirSync(refDir(slug), { recursive: true })
    try {
      profile.monk = await fetchMonk(slug, profile.monk, log)
      saveProfile(slug, profile)
    } catch (err) {
      log(`   ดึงข้อมูล${profile.monk.name}จากวิกิพีเดียไม่ได้ (${err.message}) — ทำต่อโดยไม่มีภาพอ้างอิง จะลองใหม่รอบหน้า`)
    }
  }
  if (profile.category === 'buddha' && !profile.buddha?.fetchedAt) {
    mkdirSync(refDir(slug), { recursive: true })
    try {
      profile.buddha = await fetchBuddha(slug, log)
      saveProfile(slug, profile)
    } catch (err) {
      log(`   หาภาพพระพุทธรูปอ้างอิงไม่ได้ (${err.message}) — ทำต่อโดยไม่มีภาพอ้างอิง จะลองใหม่รอบหน้า`)
    }
  }
  return profile
}

/** ภาพอ้างอิงของคลิป (path เต็ม) — หมวดพระเกจิ = ภาพท่าน · หมวดพุทธประวัติ = พระพุทธรูป */
export function profileImages(profile, slug) {
  const list = profile?.monk?.images ?? profile?.buddha?.images ?? []
  return list.map((i) => join(refDir(slug), i.file)).filter((f) => existsSync(f))
}
