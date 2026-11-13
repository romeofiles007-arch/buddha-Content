/**
 * พระพุทธเจ้าของฉัน — ภาพอ้างอิงพระพุทธเจ้าที่ผู้ใช้เลือกเอง (กล่อง "🪷 พระพุทธเจ้าของฉัน" ในแผงข้าง)
 *
 * ใช้กับหมวด 1 (พุทธประวัติ & พุทธพจน์): มีภาพชุดนี้ = คลิปใหม่แนบภาพนี้ให้ ChatGPT/Flow แทน
 * พระพุทธรูปไทยที่ระบบโหลดจาก Wikimedia ให้เอง (ไม่มี = โหลดให้เหมือนเดิม — ดู clip_profile.mjs)
 *
 * เก็บที่ characters/buddha/ (ไม่ขึ้น git — เป็นภาพที่ผู้ใช้เลือกเอง)
 *   monk.json       { description, images: [ชื่อไฟล์] }  ← โครงและกติกาเดียวกับ "พระของฉัน"
 *   buddha_*.png    รูปที่วาง/เลือกในแผงข้าง (สูงสุด 4 รูป)
 *
 * คลิปที่ทำไปแล้วไม่เปลี่ยนตาม — แต่ละคลิปจำภาพที่แนบไว้ใน projects/<คลิป>/00_ref/
 */
import { join } from 'node:path'
import { ROOT } from './config.mjs'
import { readSelfMonk, updateSelfMonk, addSelfMonkImage, removeSelfMonkImage, MAX_SELF_IMAGES } from './self_monk.mjs'

export const MY_BUDDHA_DIR = join(ROOT, 'characters', 'buddha')
export const MAX_MY_BUDDHA_IMAGES = MAX_SELF_IMAGES

export const readMyBuddha = (dir = MY_BUDDHA_DIR) => readSelfMonk(dir)
/** ผู้ใช้เลือกภาพเองไว้แล้วหรือยัง */
export const myBuddhaReady = (dir = MY_BUDDHA_DIR) => readMyBuddha(dir).images.length > 0
export const updateMyBuddha = (body, dir = MY_BUDDHA_DIR) => updateSelfMonk(body, dir)
export const addMyBuddhaImage = (body, dir = MY_BUDDHA_DIR) => addSelfMonkImage(body, dir, 'buddha')
export const removeMyBuddhaImage = (name, dir = MY_BUDDHA_DIR) => removeSelfMonkImage(name, dir)
