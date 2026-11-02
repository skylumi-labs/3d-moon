import assert from 'node:assert/strict'
import { EXPOSURE_MOVING_MS, exposureReusable, exposureWindowMs } from '../src/post/motionGrid.ts'

assert.equal(exposureWindowMs(40, false), EXPOSURE_MOVING_MS, 'user gestures keep their existing window')
for (const [lastBlockMs, scripted, expected] of [
  [4, true, 66],
  [40, true, 200],
  [200, true, 400],
] as const) {
  assert.equal(exposureWindowMs(lastBlockMs, scripted), expected, `${lastBlockMs} ms block, scripted=${scripted}`)
}

const base = { gestureOn: true, hasSearch: true, cutFrames: 0, ownsExposure: false, now: 1200, searchAt: 1000 }
assert.equal(exposureReusable({ ...base, windowMs: 200 }), false, 'the custom window is exclusive at its end')
assert.equal(exposureReusable({ ...base, now: 1199, windowMs: 200 }), true, 'a custom window is used instead of the default')
assert.equal(exposureReusable(base), false, 'without an override the existing 66 ms window remains')
console.log('exposure-window.test.mts: ok')
