import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'

// The driver's decisions run unchanged against small, explicit DOM fixtures.
const context = { URL, console }
try { runInNewContext(readFileSync(new URL('../extension/tiktok-dom.js', import.meta.url), 'utf8'), context) } catch (error) { if (error.code !== 'ENOENT') throw error }
const api = () => { assert.ok(context.DhammaTikTokDom, 'TikTok DOM driver is missing'); return context.DhammaTikTokDom }
const link = (href, text = 'Profile', safe = true) => ({ href, textContent: text, getAttribute: name => name === 'href' ? href : null, matches: () => safe, closest: () => safe ? {} : null, getClientRects: () => [{}] })
const document = (links = [], text = '') => ({ body: { innerText: text }, querySelectorAll: selector => selector.includes('a[') ? links : [], querySelector: () => null })

test('account detection accepts own profile navigation, never arbitrary creator links', () => {
  const D = api()
  assert.equal(D.account(document([link('/@stranger', 'creator', false), link('/@Romeo', 'Profile')])).username, 'romeo')
  assert.throws(() => D.account(document([link('/@stranger', 'creator', false)])), /บัญชี/)
})
test('login and CAPTCHA stop the attempt with recovery text', () => {
  const D = api()
  assert.throws(() => D.checkPage(document([], 'Log in to TikTok'), 'https://www.tiktok.com/login'), /ล็อกอิน/)
  const doc = document(); doc.querySelector = selector => selector.includes('captcha') ? {} : null
  assert.throws(() => D.checkPage(doc, 'https://www.tiktok.com/tiktokstudio/upload'), /CAPTCHA/)
})
test('account mismatch prevents publishing to the currently signed-in account', () => {
  assert.throws(() => api().assertAccount({ username: 'other' }, 'romeo'), /ไม่ตรง/)
  assert.doesNotThrow(() => api().assertAccount({ username: 'Romeo' }, '@romeo'))
})
test('upload acceptance is not a published result; final success matches the account', () => {
  const D = api()
  assert.equal(D.published(document([], 'Upload complete'), 'romeo', 'https://www.tiktok.com/tiktokstudio/upload'), null)
  assert.equal(D.published(document([], 'Video posted'), 'romeo', 'https://www.tiktok.com/tiktokstudio/upload'), null, 'a caption is not a completion signal')
  const alert = { innerText: 'Video posted', getClientRects: () => [{}] }
  const completed = document(); completed.querySelectorAll = () => [alert]
  assert.equal(D.published(completed, 'romeo', 'https://www.tiktok.com/tiktokstudio/upload').published, true)
  assert.equal(D.published(completed, 'romeo', 'https://www.tiktok.com/tiktokstudio/upload', [{ node: alert, text: 'Video posted' }]), null, 'an existing notice is not a new completion')
  const result = D.published(document(), 'romeo', 'https://www.tiktok.com/@romeo/video/1234')
  assert.equal(result.url, 'https://www.tiktok.com/@romeo/video/1234')
  assert.equal(D.published(document(), 'romeo', 'https://www.tiktok.com/@other/video/1234'), null)
})
test('an attempt guard persists the publishing phase and blocks duplicate delivery', () => {
  const D = api(), values = new Map()
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) }
  const attempt = D.claimAttempt(storage, 'job1')
  assert.equal(attempt.submitted, false)
  attempt.beforePublish()
  assert.equal(attempt.submitted, true)
  assert.throws(() => D.claimAttempt(storage, 'job1'), /ซ้ำ/)
  assert.equal(JSON.parse(values.get('dhamma-tiktok-job1')).phase, 'publishing')
})
