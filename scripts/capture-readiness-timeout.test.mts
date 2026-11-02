import assert from 'node:assert/strict'
import { waitForCaptureReadiness } from '../src/capture/readiness.ts'

let now = 0
let attempts = 0
const stalled = await waitForCaptureReadiness(306, async () => {
  attempts++
  return { ready: false as const, why: { wanted: 12, resident: 11, inflight: 1 } }
}, {
  now: () => now,
  sleep: async (ms) => { now += ms },
  timeoutMs: 40,
})
assert.deepEqual(stalled, {
  i: 306,
  waitedMs: 40,
  resident: false,
  timedOut: true,
  why: { wanted: 12, resident: 11, inflight: 1 },
})
assert.equal(attempts, 4, 'readiness retries are bounded by the injected clock')

now = 0
const ready = await waitForCaptureReadiness(7, async () => ({ ready: true as const, value: 'stable' }), {
  now: () => now,
  sleep: async (ms) => { now += ms },
  timeoutMs: 40,
})
assert.deepEqual(ready, { i: 7, waitedMs: 0, resident: true, value: 'stable' })

// Ending a capture while it waits aborts before another draw/retry can run.
let active = true, cancelledSteps = 0
const cancellation = waitForCaptureReadiness(8, async () => {
  cancelledSteps++
  return { ready: false as const, why: 'loading' }
}, {
  now: () => 0,
  sleep: async () => { active = false },
  cancelled: () => !active,
})
assert.deepEqual(await cancellation, { i: 8, waitedMs: 0, resident: false, cancelled: true })
assert.equal(cancelledSteps, 1, 'a cancelled readiness loop never starts another draw')

console.log('capture-readiness-timeout.test.mts: bounded timeout and ready result ok')
