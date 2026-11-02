// Post-gesture exposure settle: the brightness follows the new frame within ~0.5 s (not 2-3 s), monotonically, to the same rest value.
import assert from 'node:assert/strict'
import type { Exposure } from '../src/post/exposure.ts'
import { ExposureController, SETTLE_RATES, stepLog } from '../src/post/exposureControl.ts'

const stops = (a: number, b: number) => Math.abs(Math.log(a / b)) * Math.LOG2E
function raw(white: number, hdr = 1): Exposure {
  return { white, preExpose: 1, esLevel: white * 1e-3, esLevelView: white * 1e-3, longMax: 0.05, hdr, starLift: 0, whiteFloored: false, frameBrightest: white,
    search: { best: white, bestA: white, esMax: 0.5, hits: 10, samples: 100, sunlitFraction: 0.3, eclipseLevel: 0 } } as unknown as Exposure
}
// gap (stops, signed: + the scene got brighter) per fps: after 0.5 s the picture is within 0.05 stop, never overshoots, never reverses.
for (const fps of [30, 60, 120]) for (const gap of [0.5, 0.9, -0.5, -0.9]) {
  const target = Math.pow(2, gap)
  for (const settle of [true, false]) {
    const c = new ExposureController()
    c.step(raw(1), 0, false)
    let t = 0, prev = 1, within = -1
    const dt = 1000 / fps
    for (let i = 0; i < fps * 6; i++) {
      t += dt
      // a gap below the 1-stop cut limit is an ordinary step, not a cut
      const w = c.step(raw(target), t, false, [], false, false, settle).white
      const s = gap > 0 ? w - prev : prev - w
      assert.ok(s >= -1e-9, `monotonic (gap ${gap}, fps ${fps})`)
      assert.ok(gap > 0 ? w <= target * (1 + 1e-9) : w >= target * (1 - 1e-9), `no overshoot (gap ${gap}, fps ${fps})`)
      if (within < 0 && stops(w, target) < 0.05) within = t
      prev = w
    }
    assert.ok(stops(prev, target) < 1e-3 + 1e-9, `rest value is the target either way (gap ${gap}, settle ${settle})`)
    if (settle) assert.ok(within >= 0 && within <= 600, `settle: within 0.05 stop in ${within} ms (gap ${gap}, fps ${fps})`)
    else if (gap < 0 && Math.abs(gap) > 0.8) assert.ok(within > 800, `the eye-pace ease stays slow without settle (${within} ms, gap ${gap})`)
  }
}
// Larger gaps (the step function the controller applies once a move is accepted): 0.05 stop inside 0.5 s at any frame rate, no overshoot.
for (const fps of [30, 60, 120]) for (const gap of [1, 2, 3, 5, -1, -2, -3, -5]) {
  let cur = 0; const dt = 1 / fps; let within = -1
  for (let i = 1; i <= fps * 3; i++) {
    cur = stepLog(cur, gap / Math.LOG2E, dt, gap > 0, false, false, true)
    assert.ok(Math.abs(cur * Math.LOG2E) <= Math.abs(gap) + 1e-9, 'no overshoot')
    if (within < 0 && Math.abs(gap - cur * Math.LOG2E) < 0.05) within = i * dt * 1000
  }
  assert.ok(within >= 0 && within <= (Math.abs(gap) > 3 ? 700 : 520), `gap ${gap} fps ${fps}: ${within} ms`)
}
// The settle never slows the ordinary approach and is off during a journey.
assert.ok(stepLog(0, 1, 0.016, false, false, false, true) >= stepLog(0, 1, 0.016, false), 'settle is at least as fast')
assert.equal(stepLog(0, -1, 0.016, false, true, false, true), stepLog(0, -1, 0.016, false, true, false, false), 'a scripted journey keeps its own rate')
assert.ok(SETTLE_RATES.tau <= 0.1)
console.log('exposure-settle ok')

// Rest-settle: at rest, a raw target that wanders by under the dead band neither moves the picture nor asks for a frame.
{
  const { ExposureController, REST_DEADBAND_STOPS } = await import('../src/post/exposureControl.ts')
  const base = { white: 0.5, esLevel: 0.01, longMax: 0.06, hdr: 0.5, starLift: 0, whiteFloored: false, frameBrightest: 0.5, preExpose: 1, esLevelView: 0.01, search: { hits: 100, samples: 100 } } as never
  const c = new ExposureController()
  c.step(base, 0, true)
  let t = 0
  for (let i = 0; i < 30; i++) c.step(base, (t += 16))
  assert.equal(c.moving, false, 'settled')
  const wander = (k: number) => ({ ...(base as object), white: 0.5 * Math.pow(2, k * REST_DEADBAND_STOPS * 0.5), longMax: 0.06 + (k % 2) * 0.001 }) as never
  let moved = false
  for (let i = 0; i < 40; i++) { const o = c.step(wander(i % 2), (t += 16)); moved ||= c.moving; assert.equal(o.white, 0.5) }
  assert.equal(moved, false, 'wander inside the dead band never keeps the loop drawing')
  const big = c.step({ ...(base as object), white: 0.5 * Math.pow(2, 0.5) } as never, (t += 16))
  assert.ok(big.white > 0.5 && c.moving, 'a real change still moves it')
  for (let i = 0; i < 400; i++) c.step({ ...(base as object), white: 0.5 * Math.pow(2, 0.5) } as never, (t += 16))
  assert.equal(c.moving, false)
}
console.log('exposure rest dead band ok')
