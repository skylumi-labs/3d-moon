// In motion the applied white never moves more than MOTION_MAX_STEP_STOPS in one frame, at any frame interval (the rate caps alone allow 0.17 stop at 30 Hz).
import assert from 'node:assert/strict'
import { MOTION_MAX_STEP_STOPS, adaptExposure } from '../src/post/exposureControl.ts'

const LOG2 = Math.LOG2E
for (const dt of [1 / 120, 1 / 60, 1 / 30, 1 / 20, 1 / 15]) {
  for (const jump of [0.5, 2, 6, -0.5, -2, -6]) {
    let cur = 0
    const target = jump / LOG2
    for (let i = 0; i < 600; i++) {
      const next = adaptExposure(cur, target, dt, { inMotion: true, expsnap: true })
      assert.ok(Math.abs(next - cur) * LOG2 <= MOTION_MAX_STEP_STOPS + 1e-9, `dt ${dt} jump ${jump}: step ${(Math.abs(next - cur) * LOG2).toFixed(4)} stops`)
      cur = next
    }
    assert.ok(Math.abs(cur - target) * LOG2 < 0.01, `dt ${dt} jump ${jump}: converges (${(cur * LOG2).toFixed(3)} of ${jump})`)
  }
}
// expsnap=0 is unchanged by the cap.
const legacy = adaptExposure(0, 6 / LOG2, 1 / 30, { inMotion: true, expsnap: false })
assert.ok(legacy * LOG2 > 0 && legacy * LOG2 <= 0.5, 'legacy path untouched')
console.log('exposure-motion-cap.test: ok')
