import test from 'node:test'
import assert from 'node:assert/strict'
import { insertTikTokCaption } from '../extension/tiktok-caption.js'

// command จำลอง: ตอบ Runtime.evaluate ตามลำดับที่ให้ (focus, เลือกครบ?, …) แล้วจดทุกคำสั่ง
const fake = (answers) => {
  const calls = []
  const command = async (method, params) => {
    calls.push({ method, params })
    return method === 'Runtime.evaluate' ? { result: { value: answers.shift() } } : {}
  }
  return { calls, command }
}

test('trusted caption input selects text inside the focused editor, then inserts exact text', async () => {
  const { calls, command } = fake([true, true, true]) // focus ได้ · Ctrl+A เลือกครบ · ตรวจซ้ำก่อนพิมพ์
  await insertTikTokCaption(command, 'ข้อความ “รัก”\n#ธรรมะ')
  assert.deepEqual(calls.map((c) => c.method), ['Runtime.evaluate', 'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent', 'Runtime.evaluate', 'Runtime.evaluate', 'Input.insertText'])
  assert.equal(calls[1].params.modifiers, 2)
  assert.deepEqual(calls[1].params.commands, ['selectAll'])
  assert.equal(calls.at(-1).params.text, 'ข้อความ “รัก”\n#ธรรมะ')
})

// 5 พ.ย. 2026: Ctrl+A ผ่าน debugger ไม่เลือกข้อความ → คำบรรยายไปต่อท้ายชื่อไฟล์ที่ TikTok ใส่ไว้
test('Ctrl+A that does not select falls back to a page range, and is checked again before typing', async () => {
  const { calls, command } = fake([true, false, undefined, true]) // focus · ไม่ครบ · เลือกด้วย Range · ครบแล้ว
  await insertTikTokCaption(command, 'caption')
  assert.deepEqual(calls.map((c) => c.method), ['Runtime.evaluate', 'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent', 'Runtime.evaluate', 'Runtime.evaluate', 'Runtime.evaluate', 'Input.insertText'])
  assert.match(calls[4].params.expression, /selectNodeContents/)
})

test('text that still is not selected never gets the caption appended to it', async () => {
  const { calls, command } = fake([true, false, undefined, false])
  await assert.rejects(() => insertTikTokCaption(command, 'caption'), /เลือกข้อความเดิม/)
  assert.ok(!calls.some((c) => c.method === 'Input.insertText'))
})

test('missing or ambiguous editor stops before any text input', async () => {
  const { calls, command } = fake([false])
  await assert.rejects(() => insertTikTokCaption(command, 'caption'), /คำบรรยาย/)
  assert.deepEqual(calls.map((c) => c.method), ['Runtime.evaluate'])
})
