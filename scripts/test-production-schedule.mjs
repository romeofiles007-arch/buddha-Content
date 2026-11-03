import test from 'node:test'
import assert from 'node:assert/strict'
import { scheduleFromFields, scheduleFields, scheduleCopy, nextProductionStart } from '../extension/production-schedule.js'

const fields = { start: 'now', time: '22:00', count: '5', unlimited: false, pause: 'random', min: '20', max: '40' }

test('legacy no-rest, fixed-rest, range and unlimited schedules round trip', () => {
  for (const count of [0, 5]) for (const [delayMin, delayMax] of [[0, 0], [20, 20], [20, 40]]) {
    const saved = { count, start: 'daily', time: '22:00', delayMin, delayMax }
    assert.deepEqual(scheduleFromFields(scheduleFields(saved)), saved)
  }
})
test('continuous requires the explicit checkbox; empty count never becomes unlimited', () => {
  assert.throws(() => scheduleFromFields({ ...fields, count: '' }), /จำนวนคลิป/)
  assert.throws(() => scheduleFromFields({ ...fields, count: '0' }), /จำนวนคลิป/)
  assert.throws(() => scheduleFromFields({ ...fields, count: '1.5' }), /จำนวนคลิป/)
  assert.equal(scheduleFromFields({ ...fields, count: '', unlimited: true }).count, 0)
})
test('rest modes ignore inactive inputs and reject incomplete or reversed ranges', () => {
  assert.deepEqual(scheduleFromFields({ ...fields, pause: 'none', min: '', max: '' }), { count: 5, start: 'now', time: '22:00', delayMin: 0, delayMax: 0 })
  assert.equal(scheduleFromFields({ ...fields, pause: 'fixed', min: '12', max: '' }).delayMax, 12)
  for (const patch of [{ min: '' }, { max: '' }, { min: '41' }, { max: '721' }, { min: '-1' }]) {
    assert.throws(() => scheduleFromFields({ ...fields, ...patch }), /พัก/)
  }
})
test('scheduled starts need a valid time while start-now does not', () => {
  assert.throws(() => scheduleFromFields({ ...fields, start: 'at', time: '' }), /เวลา/)
  assert.throws(() => scheduleFromFields({ ...fields, start: 'daily', time: '24:01' }), /เวลา/)
  assert.equal(scheduleFromFields({ ...fields, time: '' }).start, 'now')
})
test('next start rolls a past or exactly current time to tomorrow', () => {
  const now = new Date(2026, 10, 3, 22, 0, 0)
  assert.equal(nextProductionStart('22:00', now).getDate(), 4)
  assert.equal(nextProductionStart('21:00', now).getDate(), 4)
  assert.equal(nextProductionStart('23:00', now).getDate(), 3)
})
test('copy distinguishes production timing, rest after completion and continuous daily behavior', () => {
  const now = new Date(2026, 10, 3, 23)
  const s = scheduleFromFields({ ...fields, start: 'daily' })
  const copy = scheduleCopy(s, now)
  assert.match(copy.headline, /ทุกวัน.*22:00.*5 คลิป/)
  assert.match(copy.detail, /20–40.*หลัง.*เสร็จ/)
  assert.match(copy.firstStart, /พรุ่งนี้/)
  assert.match(scheduleCopy({ ...s, count: 0 }, now).detail, /จนกดหยุด/)
  assert.doesNotMatch(scheduleCopy({ ...s, count: 0 }, now).headline, /วันละ/)
  assert.equal(scheduleCopy({ ...s, start: 'now' }, now).action, 'เริ่มผลิต 5 คลิป')
})
