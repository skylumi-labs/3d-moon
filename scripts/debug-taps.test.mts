import assert from 'node:assert/strict'
import { DEBUG_TAPS, DEBUG_TAP_WINDOW_MS, pushTap, tapTime } from '../src/ui/debugTaps.ts'

const run = (times: number[]): boolean[] => {
  let taps: number[] = []
  return times.map((t) => { const r = pushTap(taps, t); taps = r.taps; return r.fired })
}
assert.equal(DEBUG_TAPS, 5)
assert.equal(DEBUG_TAP_WINDOW_MS, 3000)
assert.deepEqual(run([0, 100, 200, 300, 400]), [false, false, false, false, true], 'five quick presses open it')
assert.deepEqual(run([0, 100, 200, 300]), [false, false, false, false], 'four do not')
assert.deepEqual(run([0, 1000, 2000, 3000, 3001]), [false, false, false, false, false], 'five spread over more than 3 s do not (the first one aged out)')
assert.deepEqual(run([0, 750, 1500, 2250, 3000]), [false, false, false, false, true], 'the fifth exactly 3 s after the first counts')
assert.deepEqual(run([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), [false, false, false, false, true, false, false, false, false, true], 'the count restarts after it fires')
// Slow frames: the handlers run late but each press keeps its own timestamp, so the count follows the presses, not the handler clock.
{
  const stamps = [1000, 1150, 1300, 1450, 1600]
  let taps: number[] = []
  const fired = stamps.map((t) => { const r = pushTap(taps, tapTime({ timeStamp: t }, 99999)); taps = r.taps; return r.fired })
  assert.deepEqual(fired, [false, false, false, false, true], 'five presses 150 ms apart fire even if every handler ran 700 ms late')
  assert.equal(tapTime({ timeStamp: 0 }, 42), 42, 'no usable timestamp falls back')
  assert.equal(tapTime({}, 7), 7)
  assert.equal(tapTime({ timeStamp: Number.NaN }, 7), 7)
}
console.log('debug-taps: ok')
