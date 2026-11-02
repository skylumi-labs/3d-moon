/**
 * Unit tests for exposure fast snap and adaptation helper:
 *   node --import tsx scripts/exposure-snap.test.mts
 *
 * Verifies:
 * 1. Time series after gesture end (old vs new: ~150-300 ms fast settle vs ~3 s slow ramp)
 * 2. Strict monotonicity / no overshoot across arbitrary jumps and frame rates
 * 3. Zero oscillation (direction of change never flips)
 * 4. In-motion smoothing (prevents flicker/pumping when crossing terminator)
 * 5. Switch ?expsnap=0 (expsnap: false) exactly restores old settle behavior
 * 6. Linear helper adaptExposureWhite consistency
 */
import assert from 'node:assert/strict'
import {
  SETTLE_RATES,
  MOTION_TRACK_RATES,
  EXPOSURE_RATES,
  REST_STOPS,
  adaptExposure,
  adaptExposureWhite,
} from '../src/post/exposureControl.ts'

const LOG2E = Math.LOG2E
const stops = (cur: number, tgt: number) => Math.abs(cur - tgt) * LOG2E

console.log('Testing exposure snap & adaptation pure helper...')

// ---------------------------------------------------------------------------
// 1. Time series after gesture end: Old vs New (step up and step down)
// ---------------------------------------------------------------------------
{
  const fps = 60
  const dt = 1 / fps

  // Test 1a: Step Up (dark to bright, e.g. 0.15 I/F to 0.60 I/F = 2 stops)
  {
    const startLog = Math.log(0.15)
    const targetLog = Math.log(0.60)
    const initialGapStops = stops(startLog, targetLog)
    assert.ok(Math.abs(initialGapStops - 2) < 0.05, 'initial gap is ~2 stops')

    // New snap behavior (expsnap: true, settle: true)
    let curNew = startLog
    let at150msNew = 0
    let at200msNew = 0
    let at300msNew = 0

    for (let frame = 1; frame <= 60; frame++) {
      curNew = adaptExposure(curNew, targetLog, dt, { settle: true, expsnap: true })
      const tMs = frame * (1000 / fps)
      if (Math.abs(tMs - 150) < 10) at150msNew = stops(curNew, targetLog)
      if (Math.abs(tMs - 200) < 10) at200msNew = stops(curNew, targetLog)
      if (Math.abs(tMs - 300) < 10) at300msNew = stops(curNew, targetLog)
    }

    // New snap from a 2-stop gap, at 60 fps: the 16 stops/s cap binds early, so the residual is ~0.20 stop at 150 ms, ~0.08 at 200 ms and
    // ~0.013 (0.9%) at 300 ms. The exact landing on the target (REST_STOPS) takes ~0.4 s, which the monotonicity test covers.
    assert.ok(at150msNew < 0.25, `new settle at 150 ms should be < 0.25 stops remaining (got ${at150msNew.toFixed(4)})`)
    assert.ok(at200msNew < 0.10, `new settle at 200 ms should be < 0.10 stops remaining (got ${at200msNew.toFixed(4)})`)
    assert.ok(at300msNew < 0.02, `new settle at 300 ms should be within 0.02 stop of target (got ${at300msNew.toFixed(6)})`)

    // Old behavior (expsnap: false, settle: true)
    let curOld = startLog
    let at300msOld = 0

    for (let frame = 1; frame <= 180; frame++) {
      curOld = adaptExposure(curOld, targetLog, dt, { settle: true, expsnap: false })
      const tMs = frame * (1000 / fps)
      if (Math.abs(tMs - 300) < 10) at300msOld = stops(curOld, targetLog)
    }

    // The legacy settle (SETTLE_RATES) is quicker than the eye pace but still leaves a visible tail at 300 ms, and the snap is closer by then.
    assert.ok(at300msOld > at300msNew, `legacy settle is slower than the snap at 300 ms (old ${at300msOld.toFixed(4)}, new ${at300msNew.toFixed(4)} stops remaining)`)
  }

  // Test 1b: Step Down (bright to dark, e.g. 0.60 I/F to 0.15 I/F = -2 stops)
  {
    const startLog = Math.log(0.60)
    const targetLog = Math.log(0.15)

    let curNew = startLog
    let at150msNew = 0
    let at200msNew = 0
    let at300msNew = 0

    for (let frame = 1; frame <= 60; frame++) {
      curNew = adaptExposure(curNew, targetLog, dt, { settle: true, expsnap: true })
      const tMs = frame * (1000 / fps)
      if (Math.abs(tMs - 150) < 10) at150msNew = stops(curNew, targetLog)
      if (Math.abs(tMs - 200) < 10) at200msNew = stops(curNew, targetLog)
      if (Math.abs(tMs - 300) < 10) at300msNew = stops(curNew, targetLog)
    }

    assert.ok(at150msNew < 0.25, `new step-down at 150 ms should be < 0.25 stops remaining (got ${at150msNew.toFixed(4)})`)
    assert.ok(at200msNew < 0.10, `new step-down at 200 ms should be < 0.10 stops remaining (got ${at200msNew.toFixed(4)})`)
    assert.ok(at300msNew < 0.02, `new step-down at 300 ms should be within 0.02 stop of target (got ${at300msNew.toFixed(6)})`)

    // The legacy settle (expsnap: false) is quicker than the eye pace but still behind the snap at 300 ms.
    let curOld = startLog
    let at300msOld = 0
    for (let frame = 1; frame <= 60; frame++) {
      curOld = adaptExposure(curOld, targetLog, dt, { settle: true, expsnap: false })
      const tMs = frame * (1000 / fps)
      if (Math.abs(tMs - 300) < 10) at300msOld = stops(curOld, targetLog)
    }
    assert.ok(at300msOld > at300msNew, `legacy step-down is slower than the snap at 300 ms (old ${at300msOld.toFixed(4)}, new ${at300msNew.toFixed(4)})`)
  }
}
console.log('  ✓ Time series test passed (fast settle, snap closer than legacy at 300 ms)')

// ---------------------------------------------------------------------------
// 2. Strict Monotonicity / No Overshoot
// ---------------------------------------------------------------------------
{
  const jumpSizes = [0.2, 0.5, 1.0, 2.0, 4.0, 8.0, -0.2, -0.5, -1.0, -2.0, -4.0, -8.0]
  const fpsList = [15, 30, 60, 120]

  for (const fps of fpsList) {
    const dt = 1 / fps
    for (const jump of jumpSizes) {
      const startLog = Math.log(0.3)
      const targetLog = startLog + jump / LOG2E
      const up = jump > 0

      let cur = startLog
      for (let i = 0; i < 60 * fps; i++) {
        const next = adaptExposure(cur, targetLog, dt, { settle: true, expsnap: true })
        if (up) {
          assert.ok(next >= cur, `upward step must be non-decreasing: next ${next} < cur ${cur}`)
          assert.ok(next <= targetLog + 1e-9, `upward step must never overshoot target: next ${next} > target ${targetLog}`)
        } else {
          assert.ok(next <= cur, `downward step must be non-increasing: next ${next} > cur ${cur}`)
          assert.ok(next >= targetLog - 1e-9, `downward step must never undershoot target: next ${next} < target ${targetLog}`)
        }
        cur = next
        if (stops(cur, targetLog) <= REST_STOPS) break
      }
      assert.ok(stops(cur, targetLog) <= REST_STOPS, `jump ${jump} stops at ${fps} fps must converge to target`)
    }
  }
}
console.log('  ✓ Strict monotonicity & no overshoot test passed across all jumps and framerates')

// ---------------------------------------------------------------------------
// 3. No Oscillation (Zero Sign Reversals)
// ---------------------------------------------------------------------------
{
  for (const jump of [3.0, -3.0, 0.8, -0.8]) {
    const startLog = Math.log(0.25)
    const targetLog = startLog + jump / LOG2E
    const expectedSign = Math.sign(jump)

    let cur = startLog
    const dt = 1 / 60
    for (let i = 0; i < 60; i++) {
      const next = adaptExposure(cur, targetLog, dt, { settle: true, expsnap: true })
      const step = next - cur
      if (Math.abs(step) > 1e-8) {
        assert.equal(Math.sign(step), expectedSign, `direction of change must remain constant (no oscillation)`)
      }
      cur = next
    }
  }
}
console.log('  ✓ No oscillation test passed (zero sign flips)')

// ---------------------------------------------------------------------------
// 4. In-motion smoothing (crossing terminator without flicker or pumping)
// ---------------------------------------------------------------------------
{
  const fps = 60
  const dt = 1 / fps

  // Simulate 1 second drag crossing terminator: base target rises from 0.05 to 0.40 (~3 stops),
  // with noisy raycast perturbation (+/- 10%) on raw samples.
  let cur = Math.log(0.05)
  let maxFrameDeltaStops = 0

  for (let frame = 1; frame <= 60; frame++) {
    const progress = frame / 60
    const trueBaseWhite = 0.05 + progress * 0.35
    // Pseudorandom pseudo-noise: deterministic sin modulation
    const noise = 1 + 0.10 * Math.sin(frame * 1.7)
    const noisyRawWhite = trueBaseWhite * noise
    const rawTargetLog = Math.log(noisyRawWhite)

    const next = adaptExposure(cur, rawTargetLog, dt, { inMotion: true, expsnap: true })
    const frameDeltaStops = stops(next, cur)
    if (frameDeltaStops > maxFrameDeltaStops) maxFrameDeltaStops = frameDeltaStops
    cur = next
  }

  // Motion rate is capped by MOTION_TRACK_RATES (up to 5 stops/s * dt = ~0.083 stops/frame)
  const maxAllowedStopsPerFrame = MOTION_TRACK_RATES.upStopsPerS * dt + 1e-4
  assert.ok(
    maxFrameDeltaStops <= maxAllowedStopsPerFrame,
    `in-motion frame delta ${maxFrameDeltaStops.toFixed(4)} must be bounded by motion tracking rate ${maxAllowedStopsPerFrame.toFixed(4)}`,
  )

  // After gesture ends, settles promptly to steady target
  const finalTargetLog = Math.log(0.40)
  for (let frame = 1; frame <= 20; frame++) {
    cur = adaptExposure(cur, finalTargetLog, dt, { settle: true, expsnap: true })
  }
  assert.ok(stops(cur, finalTargetLog) < 0.01, 'promptly settles once motion ends')
}
console.log('  ✓ In-motion smoothing test passed (bounded per-frame delta, no flicker)')

// ---------------------------------------------------------------------------
// 5. Switch ?expsnap=0 (expsnap: false restores exact legacy settle)
// ---------------------------------------------------------------------------
{
  const dt = 1 / 60
  const cur = Math.log(0.2)
  const target = Math.log(0.8)

  // With expsnap: false and settle: true, must match old SETTLE_RATES calculation
  const oldOutput = adaptExposure(cur, target, dt, { settle: true, expsnap: false })

  const gap = Math.abs((target - cur) * LOG2E)
  const quick = Math.min(gap, gap * (1 - Math.exp(-dt / SETTLE_RATES.tau)), SETTLE_RATES.stopsPerS * dt)
  const slow = Math.min(gap, gap * (1 - Math.exp(-dt / EXPOSURE_RATES.upTau)), EXPOSURE_RATES.upStopsPerS * dt)
  const expectedOld = cur + Math.sign(target - cur) * Math.max(quick, slow) / LOG2E

  assert.ok(Math.abs(oldOutput - expectedOld) < 1e-9, `expsnap: false must match legacy settle calculation`)

  // At rest without settle or motion, both expsnap: true and false use identical eye-pace rate
  const restNew = adaptExposure(cur, target, dt, { settle: false, expsnap: true })
  const restOld = adaptExposure(cur, target, dt, { settle: false, expsnap: false })
  assert.ok(Math.abs(restNew - restOld) < 1e-9, `scene change at rest must use identical eye-pace rates`)
}
console.log('  ✓ Switch ?expsnap=0 test passed (exact restoration of legacy behavior)')

// ---------------------------------------------------------------------------
// 6. adaptExposureWhite helper consistency
// ---------------------------------------------------------------------------
{
  const curWhite = 0.25
  const targetWhite = 0.50
  const dt = 1 / 60

  const whiteOut = adaptExposureWhite(curWhite, targetWhite, dt, { settle: true, expsnap: true })
  const logOut = Math.exp(adaptExposure(Math.log(curWhite), Math.log(targetWhite), dt, { settle: true, expsnap: true }))

  assert.ok(Math.abs(whiteOut - logOut) < 1e-9, 'adaptExposureWhite must match exponentiated adaptExposure')

  // Edge cases
  assert.equal(adaptExposureWhite(0, 0.5, dt), 0.5, 'non-positive curWhite returns targetWhite')
  assert.equal(adaptExposureWhite(0.5, 0, dt), 0, 'non-positive targetWhite returns targetWhite')
}
console.log('  ✓ adaptExposureWhite helper test passed')

console.log('All exposure snap unit tests passed successfully.')
