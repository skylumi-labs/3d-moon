// The star limiting-magnitude cull (R59): pure limit maths, the draw range on the real StarPass geometry, and the revert switch.
import assert from 'node:assert/strict'
import { COLOUR_MAX, PEAK_W, VISIBLE_FLOOR, countWithin, drawCount, limitingMag, starMagOf } from '../src/sky/starLimit.ts'
import { skyCullGain } from '../src/sky/skyStars.ts'
import { dotIf0 } from '../src/sky/starDots.ts'

assert.deepEqual(starMagOf(''), { mode: 'auto' })
assert.deepEqual(starMagOf('?starmag=off'), { mode: 'off' })
assert.deepEqual(starMagOf('?starmag=0'), { mode: 'off' })
assert.deepEqual(starMagOf('?starmag=5.5'), { mode: 'fixed', mag: 5.5 })
assert.deepEqual(starMagOf('?starmag=9'), { mode: 'auto' }, 'out of range is ignored')
assert.deepEqual(starMagOf('?starmag=x'), { mode: 'auto' })

// The limit is where a star's peak equals the floor: a star at the limit is drawn, one a full step fainter is not.
const if0 = 40, white = 1
const m = limitingMag(if0, white)
const peak = (mag: number) => Math.pow(10, -0.4 * mag) * if0 * PEAK_W * COLOUR_MAX
assert.ok(peak(m - 0.25) >= white * VISIBLE_FLOOR, 'a star one step brighter than the limit is above the floor (the limit rounds toward drawing more)')
assert.ok(peak(m + 0.01) < white * VISIBLE_FLOOR * Math.pow(10, 0.1), 'a star past the limit is below the floor within one step')
assert.ok(peak(m + 0.5) < white * VISIBLE_FLOOR, 'a star well past the limit is below the floor')
assert.ok(limitingMag(if0 * 100, white) > m + 4.9, '100x more light per pixel: 5 magnitudes deeper')
assert.ok(limitingMag(if0, white * 100) < m - 4.9, 'a brighter exposure white hides fainter stars')
assert.ok(limitingMag(if0, white, 8) > m, 'the boost lift never culls more')
assert.equal(limitingMag(0, white), Infinity, 'no scale: no cull')
assert.equal(limitingMag(if0, 0), Infinity, 'no exposure given: no cull')
assert.equal(limitingMag(NaN, white), Infinity)

const mags = Float32Array.from([-1.4, 0.1, 2, 3.5, 3.5, 5, 6.4, 6.5])
assert.equal(countWithin(mags, 3.5), 5, 'ties at the limit are kept')
assert.equal(countWithin(mags, -2), 0)
assert.equal(countWithin(mags, 99), 8)
assert.equal(countWithin(mags, Infinity), 8)
assert.equal(drawCount({ mode: 'off' }, mags, 1e-9, 1), 8, 'off: whole catalogue whatever the exposure')
assert.equal(drawCount({ mode: 'auto' }, mags, 0, 1), 8, 'auto without a scale: whole catalogue')
assert.equal(drawCount({ mode: 'fixed', mag: 3.5 }, mags, 1e9, 1), 5)
assert.ok(drawCount({ mode: 'auto' }, mags, 1e-3, 1) < 8, 'a very dim pixel scale culls')
assert.equal(drawCount({ mode: 'auto' }, mags, 1e6, 1), 8, 'a very bright one keeps all')
// The sky lift's gain reaches the cull: a lifted sky draws fainter stars than the same pixel scale unlifted, and hdr 1 (night-side exposure) adds nothing.
{
  const if0 = 5e-3, white = 0.19   // roughly the Home lens beside a sunlit Moon
  const plain = drawCount({ mode: 'auto' }, Float32Array.from([0, 2, 4, 6, 6.5]), if0, white, 80)
  const lifted = drawCount({ mode: 'auto' }, Float32Array.from([0, 2, 4, 6, 6.5]), if0, white, 80 * skyCullGain(70, 0))
  assert.ok(lifted >= plain, 'the lift never culls more')
  assert.equal(skyCullGain(70, 1), 1)
}
// The native dots (sky/starDots.ts) re-run the cull at the canvas pixel: on a 0.35 motion grid the target's own limit is over two magnitudes
// shallower (bigger pixels, less I/F each), the rescaled one is the full-resolution limit, so a grid step never changes which stars are drawn.
{
  const s = 0.35, if0Full = 5e-3, white = 0.19
  assert.equal(limitingMag(dotIf0(if0Full * s * s, 1 / s), white), limitingMag(if0Full, white), 'the canvas-scale limit is the full-resolution limit')
  assert.ok(limitingMag(if0Full * s * s, white) < limitingMag(if0Full, white) - 2, 'the target-scale limit on a 0.35 grid is much shallower')
}
console.log('star-limit ok')
