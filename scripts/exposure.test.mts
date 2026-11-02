/**
 * The exposure controller and the night side's single monotone function:
 *   npm test
 */
import assert from 'node:assert/strict'
import type { Exposure } from '../src/post/exposure.ts'
import { CUT_STOPS, EXPOSURE_RATES, MOTION_MAX_STEP_STOPS, ExposureController, ExposureTrack, planEnvelope, stepLinear, stepLog } from '../src/post/exposureControl.ts'
import { anchoredBrightest, computeExposure, GROUND_ONLY_HEADROOM, NIGHT_FLOOR_DEFAULT_SHARE, NIGHT_FLOOR_MAX_SHARE, nightFloorRadiance, nightFloorShare, nightSideFuse, nightSideKeyCap, nightSideLongMax, searchFrame, topShareValue, unlitDisplay, WHITE_CLIP_SHARE } from '../src/post/exposure.ts'
import { FINAL_FRAGMENT } from '../src/post/final.ts'
import { readFileSync } from 'node:fs'
import { ephemerisAt } from '../src/ephemeris.ts'
import { earthViewCamera } from '../src/camera/pose.ts'
import { applyVisibilityGrey, visibilityGrey, type VisibilityCalibration } from '../src/post/visibility.ts'
import { WHITE_FLOOR } from '../src/moon/photometry.ts'

const LOG2E = Math.LOG2E
const stops = (a: number, b: number) => Math.abs(Math.log(a / b)) * LOG2E

function raw(white: number, over: Partial<Exposure> = {}, hits = 10): Exposure {
  return {
    white, preExpose: 1, esLevel: white * 1e-3, esLevelView: white * 1e-3, longMax: 0.05, hdr: 1, starLift: 0, whiteFloored: false, frameBrightest: white,
    search: { best: white, bestA: white, esMax: 0.5, hits, samples: 100, sunlitFraction: 0.3, eclipseLevel: 0 },
    ...over,
  }
}

// 1. A step in the target is a ramp: per-frame change is bounded by the rate, at 4 fps and at 60 fps, and there is no overshoot.
for (const fps of [4, 10, 60]) {
  for (const jump of [2, 8, -2, -8, 0.5]) {
    const c = new ExposureController()
    let t = 1000
    const target = Math.pow(2, jump)
    // The jump is seen coming (a look-ahead), so it is a move, not a cut.
    let prev = c.step(raw(1), t, false, [{ t: 0.5, raw: raw(target) }]).white
    let crossed = 0
    const dt = 1 / fps
    for (let i = 0; i < 60 * fps; i++) {
      t += dt * 1000
      const w = c.step(raw(target), t).white
      const dtEff = Math.min(0.25, dt)
      const gap = stops(prev, target)
      const rate = jump > 0 ? Math.min(EXPOSURE_RATES.maxStopsPerS, EXPOSURE_RATES.upStopsPerS + EXPOSURE_RATES.burstPerStop * Math.max(0, gap - EXPOSURE_RATES.burstFromStops)) : Math.min(EXPOSURE_RATES.maxDownStopsPerS, (t < 1000 + EXPOSURE_RATES.journeySettleS * 1000 ? EXPOSURE_RATES.journeyDownStopsPerS : EXPOSURE_RATES.downStopsPerS) + EXPOSURE_RATES.downBurstPerStop * Math.max(0, gap - EXPOSURE_RATES.downBurstFromStops))
      assert.ok(stops(w, prev) <= rate * dtEff + 1e-9, `fps ${fps} jump ${jump}: step ${stops(w, prev)} stops > ${rate * dtEff}`)
      // Never past the target, and monotone toward it.
      if (jump > 0) assert.ok(w <= target * (1 + 1e-9) && w >= prev * (1 - 1e-9), `overshoot/non-monotone up ${w} ${target}`)
      else assert.ok(w >= target * (1 - 1e-9) && w <= prev * (1 + 1e-9), `overshoot/non-monotone down ${w} ${target}`)
      if (Math.abs(w - target) < 1e-6 * target) crossed++
      prev = w
    }
    assert.ok(crossed > 0, `fps ${fps} jump ${jump}: reached the target`)
  }
}

// 2. A gap of a few stops is never a jump: one frame at 5 fps moves a 1-stop gap by less than 0.3 stop (the mean luminance moves under 12%).
{
  const c = new ExposureController()
  c.step(raw(1), 0)
  const w = c.step(raw(2), 200).white
  assert.ok(stops(w, 1) < 0.31, `${stops(w, 1)} stops in one 5 fps frame`)
  assert.ok(w > 1, 'and it does move')
}

// 2b. A scripted Moon rise may catch a known brightening faster, but remains a
// bounded slew: the first frame is unchanged, there is no overshoot, and a
// one-frame meter spike is still rejected by the ordinary glitch guard.
{
  // Sampled from eclipse-entry-60-candidate-10/in-moon-d/frames.json. The
  // HDR target is the bright-disc endpoint: computeExposure can release the
  // long-exposure fuse to zero while the short exposure owns the Moon.
  const samples = [[0, 0.0119523], [15, 0.0239589], [30, 0.1062852], [45, 0.1896035], [60, 0.2183185], [65, 0.2231538], [75, 0.2223048], [90, 0.1974228], [110, 0.1575604], [150, 0.0851627]] as const
  const trajectory = (i: number) => {
    let j = 0
    while (j + 1 < samples.length && samples[j + 1][0] < i) j++
    const [i0, w0] = samples[j], [i1, w1] = samples[Math.min(j + 1, samples.length - 1)]
    const u = i1 === i0 ? 0 : Math.max(0, Math.min(1, (i - i0) / (i1 - i0)))
    return raw(w0 + (w1 - w0) * u, { hdr: i <= 65 ? 1 - i / 65 : 0 })
  }
  const ordinary = new ExposureController(), scripted = new ExposureController()
  let ordinaryAt65 = 0, scriptedAt65 = 0, scriptedHdrAt65 = 0
  const scriptedValues: number[] = []
  let previousAdapted = 0
  for (let i = 0; i <= 90; i++) {
    const t = i * 1000 / 60
    const r = trajectory(i)
    const a = ordinary.step(r, t)
    // Activate after the controller already has a live state, matching the
    // Moon subject becoming visible during the rise.
    const b = scripted.step(r, t, false, [], false, i >= 15)
    scriptedValues.push(b.white)
    if (r.white >= previousAdapted) {
      assert.ok(b.white <= r.white * (1 + 1e-9), `scripted Moon white overshot at ${i}`)
      assert.ok(b.white >= previousAdapted * (1 - 1e-9), `scripted Moon white reversed at ${i}`)
    } else {
      assert.ok(b.white >= r.white * (1 - 1e-9), `scripted Moon white undershot at ${i}`)
      assert.ok(b.white <= previousAdapted * (1 + 1e-9), `scripted Moon white reversed at ${i}`)
    }
    previousAdapted = b.white
    if (i === 0) assert.ok(Math.abs(b.white - r.white) < 1e-12, 'scripted mode does not jump on activation')
    if (i === 65) { ordinaryAt65 = a.white; scriptedAt65 = b.white; scriptedHdrAt65 = b.hdr }
  }
  assert.ok(stops(ordinaryAt65, 0.223) > 1, `ordinary meter unexpectedly caught up: ${ordinaryAt65}`)
  assert.ok(stops(scriptedAt65, 0.223) < 0.5, `scripted Moon lag remains ${stops(scriptedAt65, 0.223)} stops`)
  assert.ok(scriptedHdrAt65 < 0.35, `scripted HDR release remains ${scriptedHdrAt65}`)
  for (const i of [30, 45, 60, 65, 75]) {
    const target = trajectory(i).white
    const lag = stops(scriptedValues[i], target)
    assert.ok(lag < 0.5, `scripted Moon lag at ${i} frames remains ${lag} stops`)
  }
  const glitch = new ExposureController()
  const beforeGlitch = glitch.step(raw(0.012), 0, false, [], false, true)
  const spike = glitch.step(raw(0.223, { hdr: 0 }), 100, false, [], false, true)
  assert.ok(stops(spike.white, 0.012) < 0.01, 'scripted mode exposed a one-frame meter spike')
  assert.equal(spike.hdr, beforeGlitch.hdr, 'scripted mode exposed a one-frame HDR meter spike')
  const down = new ExposureController()
  down.step(raw(0.223), 0, false, [], false, true)
  const normalDown = down.step(raw(0.012), 100, false, [], false, true)
  const hold = raw(0.003, { whiteFloored: true, esLevel: 1e-7, esLevelView: 0, hdr: 1, starLift: 1 }, 0)
  const held = down.step(hold, 200, false, [], false, true)
  assert.equal(held.white, normalDown.white, 'scripted mode changed empty-frame white holding')
  assert.equal(held.hdr, normalDown.hdr, 'scripted mode changed empty-frame HDR holding')
}

// 3. Monotone response: a larger raw target never yields a smaller step, and equal targets converge to the same value.
{
  let last = -Infinity
  for (const target of [1.2, 1.5, 2, 4, 16, 256]) {
    const c = new ExposureController()
    c.step(raw(1), 0, false, [{ t: 0.5, raw: raw(target) }])
    // Seen coming (a look-ahead): a slew at every size. An unseen jump is a cut or a held glitch, tested in 6.
    const w = c.step(raw(target), 100, false, [{ t: 0.5, raw: raw(target) }]).white
    assert.ok(w >= last, `monotone in the target: ${w} after ${last}`)
    last = w
  }
}

// 4. Hold: a frame in which the search met no Moon and nothing set the white point keeps the last exposure; it does not fall to the floor.
{
  const c = new ExposureController()
  c.step(raw(0.2), 0)
  for (let i = 1; i < 10; i++) c.step(raw(0.2), i * 100)
  const before = c.step(raw(0.2), 1000)
  const empty = raw(0.003, { whiteFloored: true, esLevel: 1e-7, esLevelView: 0, hdr: 1, starLift: 1 }, 0)
  let held = before
  for (let i = 1; i <= 30; i++) held = c.step(empty, 1000 + i * 100)
  assert.equal(held.white, before.white, 'white held over 3 s of empty sky')
  assert.equal(held.esLevel, before.esLevel, 'key held')
  assert.equal(held.starLift, before.starLift, 'star lift held')
  // The Earth alone in the frame DOES set it (hits 0 but not floored): followed, within the rate.
  const earth = raw(0.6, { whiteFloored: false }, 0)
  c.step(earth, 4100)
  const w1 = c.step(earth, 4200).white
  assert.ok(w1 > held.white, 'an Earth in frame is followed, not held')
}

// 5. A captured still jumps to the target (deterministic frames).
{
  const c = new ExposureController()
  c.step(raw(1), 0)
  assert.ok(Math.abs(c.step(raw(64), 10, true).white - 64) < 1e-9)
}

// 6. A cut: a jump of more than CUT_STOPS in one frame that nobody saw coming snaps (a slew would show the new scene mis-exposed); the same
// jump seen coming by the look-ahead is a slew; a small step is a slew either way; a Moon leaving the frame is never a cut.
{
  const c = new ExposureController()
  c.step(raw(1), 0)
  // A one-frame raw spike nobody declared is smoothed: neither the glitch nor its recovery reaches the screen (wave 1 P1-3).
  const spike = new ExposureController()
  spike.step(raw(1), 0)
  assert.ok(stops(spike.step(raw(1024), 100).white, 1) < 0.01, 'an undeclared one-frame spike does not move the exposure')
  assert.ok(stops(spike.step(raw(1), 200).white, 1) < 0.01, 'nor does its recovery')
  // The same jump that persists for a second frame is a real change of picture: it snaps.
  const persist = new ExposureController()
  persist.step(raw(1), 0)
  persist.step(raw(1024), 100)
  assert.ok(Math.abs(persist.step(raw(1024), 200).white - 1024) < 1e-6, 'a jump that persists two frames snaps')
  // A live gesture can cross a 12-stop metering change; follow it under the per-frame motion cap.
  const moving = new ExposureController()
  let previous = moving.step(raw(0.012), 1000).white
  for (let i = 1; i <= 5; i++) {
    const white = moving.step(raw(50), 1000 + i * 1000 / 30, false, [], false, false, false, true).white
    assert.ok(stops(white, previous) <= MOTION_MAX_STEP_STOPS + 1e-9, `in-motion flip frame ${i} step ${stops(white, previous)} stops exceeds cap`)
    previous = white
  }
  const declaredMotionCut = new ExposureController()
  declaredMotionCut.step(raw(0.012), 0)
  assert.ok(Math.abs(declaredMotionCut.step(raw(50), 100, false, [], true, false, false, true).white - 50) < 1e-6, 'a declared cut still snaps during motion')
  const snapOff = new ExposureController()
  snapOff.snap = false
  snapOff.step(raw(0.012), 0)
  snapOff.step(raw(50), 100, false, [], false, false, false, true)
  assert.ok(Math.abs(snapOff.step(raw(50), 200, false, [], false, false, false, true).white - 50) < 1e-6, 'with snap off, a persistent in-motion target cuts after its second frame')
  const oscillatingDeclared = new ExposureController()
  oscillatingDeclared.step(raw(0.012), 0)
  oscillatingDeclared.step(raw(50), 100)
  oscillatingDeclared.step(raw(0.012), 200)
  assert.ok(Math.abs(oscillatingDeclared.step(raw(50), 300, false, [], true).white - 50) < 1e-6, 'a declared cut bypasses the oscillation guard')
  const nonGestureFlip = new ExposureController()
  nonGestureFlip.step(raw(0.012), 0)
  nonGestureFlip.step(raw(50), 100)
  assert.ok(Math.abs(nonGestureFlip.step(raw(50), 200).white - 50) < 1e-6, 'the same persistent flip still cuts without a gesture')
  // A cut the page declares (click, date set, teleport) snaps at once.
  assert.ok(Math.abs(c.step(raw(1024), 100, false, [], true).white - 1024) < 1e-6, 'a declared cut snaps')
  // Declared but no real jump: no snap (a declared event mid-ramp must not jump the exposure).
  const calm = new ExposureController()
  calm.step(raw(1), 0)
  assert.ok(stops(calm.step(raw(1.2), 100, false, [], true).white, 1) < CUT_STOPS, 'a declared cut over a small step is still a slew')
  const d = new ExposureController()
  d.step(raw(1), 0, false, [{ t: 0.5, raw: raw(1024) }])
  const w = d.step(raw(1024), 100, false, [{ t: 0.5, raw: raw(1024) }]).white
  assert.ok(stops(w, 1) <= EXPOSURE_RATES.maxStopsPerS * 0.1 + 1e-9, `a seen jump slews: ${stops(w, 1)}`)
  const f = new ExposureController()
  f.step(raw(1), 0)
  assert.ok(stops(f.step(raw(1.9), 100).white, 1) < CUT_STOPS, 'under CUT_STOPS is a slew')
  const g = new ExposureController()
  g.step(raw(0.2), 0)
  g.step(raw(0.003, { whiteFloored: true }, 0), 100)
  assert.ok(Math.abs(g.step(raw(0.2), 200).white - 0.2) < 1e-9, 'back from an empty frame at the same exposure: no jump')
}

// 7. The linear controls move with bounded steps and do not overshoot.
{
  let v = 0
  for (let i = 0; i < 300; i++) {
    const n = stepLinear(v, 1, 0.05)
    assert.ok(n - v <= EXPOSURE_RATES.linearPerS * 0.05 + 1e-12 && n <= 1 && n >= v)
    v = n
  }
  assert.ok(Math.abs(v - 1) < 1e-3)
  assert.equal(stepLog(0, 0, 0.1, true), 0)
}

// 8. The anticipatory envelope: never below the raw track, slope bounded, rises before the bright arrival, peak unchanged.
{
  const dtS = 0.25, slope = 1
  const rawLog = new Array(80).fill(Math.log(0.2))
  for (let i = 40; i < 44; i++) rawLog[i] = Math.log(0.6 * 50) // a bright Sun-like entry for 1 s, 5 stops up
  const env = planEnvelope(rawLog, dtS, slope)
  for (let i = 0; i < rawLog.length; i++) assert.ok(env[i] >= rawLog[i] - 1e-12, 'never clips')
  for (let i = 1; i < env.length; i++) assert.ok(Math.abs(env[i] - env[i - 1]) * LOG2E <= slope * dtS + 1e-9, 'bounded slope')
  assert.ok(env[40] === rawLog[40], 'the peak keeps its value')
  assert.ok(env[30] > rawLog[30], 'it starts rising before the arrival')
  assert.ok(env[0] === rawLog[0], 'and is at rest far from it')
  const tr = new ExposureTrack(env)
  assert.ok(Math.abs(tr.at(0) - 0.2) < 1e-9 && tr.at(1) > 0, 'the track reads by progress')
}

// 9. The night side is ONE monotone function of the earthshine-to-sunlit ratio: sweeping a phase never flips the fuse, the cap or the key.
{
  let fuse = 2, cap = 0, lm = Infinity
  let maxJump = 0, prevF = -1
  for (let lq = -12; lq >= -22; lq -= 0.05) {
    const q = Math.pow(2, lq)
    const f = nightSideFuse(q), k = nightSideKeyCap(q), l = nightSideLongMax(q, 0)
    assert.ok(f <= fuse + 1e-12, `fuse falls monotonically as the ratio falls (${lq}): ${f} after ${fuse}`)
    assert.ok(k >= cap - 1e-12 && k > 0, 'key cap rises continuously as Earthshine ratio falls')
    assert.ok(l <= lm + 1e-12 && l > 0, 'display cap is bounded; this alone is not a visibility floor')
    if (prevF >= 0) maxJump = Math.max(maxJump, Math.abs(f - prevF))
    prevF = f; fuse = f; cap = k; lm = l
  }
  assert.ok(maxJump < 0.06, `no flip: largest fuse step over a 0.05-stop sweep is ${maxJump}`)
  assert.ok(nightSideFuse(Math.pow(2, -12)) > 0.99, 'a thin crescent keeps its night side')
  assert.ok(nightSideFuse(Math.pow(2, -22)) < 0.01, 'near full Moon the night side goes')
  void cap
}

// 10. The night side's display cap: at most 0.06 beside a crescent, 0.035 with no sunlit ground.
{
  assert.ok(nightSideLongMax(Math.pow(2, -13), 1) <= 0.06 + 1e-12)
  assert.ok(nightSideLongMax(Infinity, 0) <= 0.035 + 1e-12)
  assert.ok(nightSideLongMax(Math.pow(2, -13), 0.3) <= nightSideLongMax(Math.pow(2, -13), 1) + 1e-12)
}

// 11. Anticipation: a bright frame that arrives at T is met on a higher white point when the controller can see it coming, never above its
// target, and never with a per-frame step beyond the rate.
{
  const T = 3, dt = 0.25, bright = Math.pow(2, 3)
  const run = (look: boolean) => {
    const c = new ExposureController()
    let now = 0
    c.step(raw(1), now)
    let w = 1, maxStep = 0, pre = 1
    for (let k = 1; k * dt <= T + 1e-9; k++) {
      now = k * dt * 1000
      const at = (x: number) => (x >= T - 1e-9 ? bright : 1)
      const ahead = look ? [0.6, 1.2, 1.8, 2.4].map(t => ({ t, raw: raw(at(k * dt + t)) })) : []
      const nw = c.step(raw(at(k * dt)), now, false, ahead).white
      if (k * dt < T - 1e-9) pre = nw
      else if (k * dt >= T - 1e-9 && !look) maxStep = 0
      maxStep = Math.max(maxStep, k * dt < T - 1e-9 || look ? stops(nw, w) : 0)
      assert.ok(nw <= bright + 1e-9, 'never above the target')
      w = nw
    }
    return { w, maxStep, pre }
  }
  const a = run(true), b = run(false)
  // Reactive: an unseen 3-stop jump is held for its first frame (it may be a glitch; the second frame or a declared cut snaps it). Anticipated: a slew that started early and is most of the way there.
  assert.ok(stops(b.w, 1) < 0.01, 'unseen, undeclared: the first frame is held')
  assert.ok(a.w > 0.6 * bright && a.w <= bright, `anticipated white ${a.w} at the arrival`)
  assert.ok(a.maxStep <= EXPOSURE_RATES.maxStopsPerS * 0.25 + 1e-9, `anticipation obeys the rate: ${a.maxStep}`)
  assert.ok(a.pre > 1.3, `it rose before the bright frame arrived: ${a.pre}`)
  // With nothing brighter ahead it changes nothing.
  const c = new ExposureController(); c.step(raw(1), 0)
  const w0 = c.step(raw(1), 250, false, [{ t: 1, raw: raw(1) }]).white
  assert.equal(w0, 1)
}

// 11. The white point is set at the top 1% of the frame's samples, not the maximum of maxima (wave 1 P1-2): on a thin crescent
// it sits below the brightest rim, so the crescent's ordinary pixels reach near white; a modest headroom only.
{
  assert.equal(topShareValue([], 0.01, 100), 0)
  assert.equal(topShareValue([5], 0.01, 100), 5, 'the largest when fewer than the share are lit')
  assert.equal(topShareValue([5, 1, 3, 2, 8, 7, 6, 4], 0.01, 100), 7, 'one of 100 samples exceeds it')
  // A small lit area (a far-off full Moon: 40 lit samples of a 5,040-sample frame) is exposed on a quarter of its own samples, not on its dimmest one.
  const small = Array.from({ length: 40 }, (_, i) => 0.1 + i / 100)
  assert.equal(topShareValue(small, WHITE_CLIP_SHARE, 5040), small[29], 'a quarter of a small disc exceeds the white')
  assert.equal(topShareValue(Array.from({ length: 50 }, (_, i) => i + 1), 0.1, 100), 40, '10 of 100 samples exceed it')
  assert.ok(WHITE_CLIP_SHARE >= 0.005 && WHITE_CLIP_SHARE <= 0.02, 'about the top 1% of the frame')
  assert.ok(GROUND_ONLY_HEADROOM <= 1.1, 'headroom 1.1 or less')
  const e = ephemerisAt(new Date('2026-10-13T18:00:00Z')) // a 10% crescent
  const s = searchFrame(earthViewCamera(e, 1.6), 1.6, e, null, 180)
  assert.ok(s.bestA > 0.2 * s.best, `white is set by lit ground: ${s.bestA} vs ${s.best}`)
  assert.ok(s.bestA < 0.9 * s.best, `white is below the limb-most maximum: ${s.bestA} vs ${s.best}`)
}

// 11. A site anchor pulls the white point toward the arrival frame's, in stops, and weight 0 changes nothing.
{
  const capped = anchoredBrightest(0.2, { white: 0.086, weight: 1, floorStops: 0.5 })
  assert.ok(capped >= 0.2 * Math.pow(2, -0.5), 'a site anchor cannot make the picture over half a stop brighter than the frame search')
  assert.equal(anchoredBrightest(0.02, { white: 0.086, weight: 1, floorStops: 0.5 }), 0.086, 'the brighter limit does not restrict darkening to a higher anchor')
  assert.equal(anchoredBrightest(0.2, { white: 0.086, weight: 1 }), 0.086, 'the powered-descent anchor remains uncapped')

  const e = ephemerisAt(new Date('2011-01-22T19:00:00Z'))
  const cam = earthViewCamera(e, 16 / 9, 14)
  const base = { cam, aspect: 16 / 9, canvasHeight: 1080, ephem: e, albedo: null, lonSpan: 180, preExposeOn: true }
  const free = computeExposure(base)
  assert.equal(computeExposure({ ...base, anchor: { white: 0.5, weight: 0 } }).white, free.white, 'weight 0 is the free exposure')
  const pulled = computeExposure({ ...base, anchor: { white: free.white * 4, weight: 1 } })
  assert.ok(Math.abs(Math.log2(pulled.white / (free.white * 4))) < 1e-6, 'weight 1 is the anchor')
  const half = computeExposure({ ...base, anchor: { white: free.white * 4, weight: 0.5 } })
  assert.ok(Math.abs(Math.log2(half.white / free.white) - 1) < 1e-6, 'weight 0.5 is half way in stops')
}

// 8. The night-side visibility floor across the whole phase angle 0..180 (Sun-Moon-camera; 0 = full Moon, 180 = new Moon). The floor
// stays DISABLED in production until a lossless calibration exists, so this tests the function with a synthetic calibration fixture,
// never the enablement. Phase model: lit share (1+cos a)/2; the Earth is the opposite phase, so earthshine ~ (1-cos a)/2 of its full value.
{
  const fixture: VisibilityCalibration = { id: 'synthetic floor fixture, not production calibration', bundleSha256: '1'.repeat(64), baselineEarthshineSha256: '2'.repeat(64), mariaGrey: 0.05, highlandGrey: 0.07, skyGrey: 0.01, minContrastGrey: 0.02, minDetailGrey: 0.01, earthshineMinimumGrey: 0.08 }
  let prevFuse = -1, prevCap = Infinity, below = 0
  for (let a = 0; a <= 180; a++) {
    const cosA = Math.cos(a * Math.PI / 180)
    const lit = (1 + cosA) / 2, unlit = 1 - lit
    const es = 0.16 * 3e-5 * (1 - cosA) / 2 // a modelled earthlit level, I/F
    const sunBest = Math.max(1e-9, lit * 0.2)
    const q = es / sunBest
    // The exposure's own night-side functions stay monotone in phase (so the scrub does not pump).
    const fuse = nightSideFuse(q), cap = nightSideKeyCap(q)
    assert.ok(fuse >= prevFuse - 1e-12, `fuse monotone at ${a} deg`)
    assert.ok(cap <= prevCap + 1e-12, `key cap monotone at ${a} deg`)
    prevFuse = fuse; prevCap = cap
    const baseline = 0 // the worst case the floor exists for: the night side rendered black
    assert.ok(nightSideLongMax(q, Math.min(1, lit * 4)) > 0, 'the night side has a cap to sit under')
    for (const template of [0.35, 0.65, 1]) {
      const floor = visibilityGrey(template, fixture) * unlit
      const shown = applyVisibilityGrey(baseline, 1, unlit, template, fixture)
      assert.ok(shown >= floor - 1e-12, `unlit disc at phase ${a}, template ${template}: ${shown} >= floor ${floor}`)
      // Monotone in the baseline: a brighter baseline never shows darker, so the scrub cannot start pumping.
      assert.ok(applyVisibilityGrey(baseline + 0.01, 1, unlit, template, fixture) >= shown)
      // Neuter proof: without the floor the same frame sits below it wherever the disc has any night side, so this test is sensitive to it.
      if (unlit > 0.01) { if (applyVisibilityGrey(baseline, 1, unlit, template, null) < floor) below++ }
    }
  }
  assert.ok(below > 400, `the unfloored display falls below the floor on most of the sweep (${below} cases)`)
  assert.ok(WHITE_FLOOR > 0)
}

console.log('exposure.test.mts: ok')

// 10. A scripted move lets the white fall at the journey rate; the same fall unscripted keeps the eye's pace.
{
  const fall = (journey: boolean): number => {
    let cur = Math.log(4)
    for (let i = 0; i < 30; i++) cur = stepLog(cur, 0, 1 / 30, false, journey)
    return Math.log(Math.exp(cur)) * LOG2E
  }
  const slow = fall(false), fast = fall(true)
  assert.ok(fast < slow - 0.4, `a scripted fall closes the gap faster: ${fast} vs ${slow} stops left after 1 s`)
  // The controller itself: a fall seen coming (a look-ahead on the first frame) uses the journey rate for the settle time after it.
  const c = new ExposureController()
  let t = 1000
  c.step(raw(4), t, false, [{ t: 0.6, raw: raw(2) }])
  for (let i = 0; i < 30; i++) { t += 33; c.step(raw(2), t, false, []) }
  const left = stops(c.step(raw(2), t + 33).white, 2)
  const c2 = new ExposureController()
  let t2 = 1000
  c2.step(raw(4), t2)
  for (let i = 0; i < 30; i++) { t2 += 33; c2.step(raw(2), t2, false, []) }
  assert.ok(left < stops(c2.step(raw(2), t2 + 33).white, 2), 'the controller falls faster after a scripted frame')
}
console.log('journey fall ok')

// 12. At rest the controller says so: after a step in the target the exponential approach must reach it (and `moving` go false),
// not close in for ever and stall a rounding step short. `moving` is what keeps the render loop drawing every frame.
for (const jump of [0.7, -0.7, 3, -3]) {
  for (const fps of [30, 60]) {
    const c = new ExposureController()
    let t = 1000
    c.step(raw(1, { longMax: 0.05, hdr: 1, starLift: 0.2 }), t)
    const target = Math.pow(2, jump)
    let settledAt = -1
    for (let i = 0; i < 60 * fps; i++) {
      t += 1000 / fps
      c.step(raw(target, { longMax: 0.31, hdr: 0.6, starLift: 0.45 }), t)
      if (!c.moving) { settledAt = i; break }
    }
    assert.ok(settledAt >= 0, `jump ${jump} stops at ${fps} fps: still moving after 60 s`)
    assert.ok(stops(c.state!.logWhite === 0 ? 1 : Math.exp(c.state!.logWhite), target) < 0.01, 'and it is where it was going')
    // Once at rest it stays at rest while the raw holds still.
    for (let i = 0; i < 120; i++) { t += 1000 / fps; c.step(raw(target, { longMax: 0.31, hdr: 0.6, starLift: 0.45 }), t); assert.equal(c.moving, false, 'rest holds') }
  }
}
// 12b. A frame with nothing to expose for and a brighter frame ahead the white point cannot rise toward (the target is above, the raw is not):
// nothing changes, so nothing is moving.
{
  const c = new ExposureController()
  let t = 1000
  c.step(raw(1), t)
  for (let i = 0; i < 600; i++) { t += 16; c.step(raw(1), t) }
  const empty = raw(1, { whiteFloored: true }, 0)
  let moving = false
  for (let i = 0; i < 120; i++) { t += 16; c.step(empty, t, false, [{ t: 5, raw: raw(2) }]); moving = c.moving }
  assert.equal(moving, false, 'an unreachable look-ahead target is not motion')
}
// The night floor (?nightfloor=): the radiance the Moon pass adds to unlit ground is solved against the final pass's curve, so the asked share of
// display white comes out whatever the exposure (short-only near full Moon, the long exposure beside a crescent, a blend between).
{
  assert.equal(nightFloorShare(null), NIGHT_FLOOR_DEFAULT_SHARE); assert.equal(nightFloorShare(undefined), NIGHT_FLOOR_DEFAULT_SHARE); assert.equal(nightFloorShare(''), NIGHT_FLOOR_DEFAULT_SHARE); assert.equal(nightFloorShare('0'), 0)
  assert.equal(nightFloorShare('0.008'), 0.008); assert.equal(nightFloorShare('abc'), 0); assert.equal(nightFloorShare('-1'), 0)
  assert.equal(nightFloorShare('9'), NIGHT_FLOOR_MAX_SHARE, 'capped')
  const X = (hdr: number, esOverWhite: number, longMax: number, white = 0.2) => ({ white, esLevel: esOverWhite * white, longMax, hdr, starLift: 1 })
  let cases = 0
  for (const hdr of [0, 0.3, 0.7, 1]) for (const eow of [1e-7, 1e-5, 1e-3, 1e-1]) for (const longMax of [0.035, 0.06, 0.16]) for (const white of [0.02, 0.2]) for (const share of [0.004, 0.008, 0.03]) {
    const x = X(hdr, eow, longMax, white)
    const r = nightFloorRadiance(share, x)
    const target = Math.min(share, NIGHT_FLOOR_MAX_SHARE) * (1 - hdr) + Math.min(share, 0.6 * longMax) * hdr
    const cap = hdr >= 0.05 ? 3 * x.esLevel : x.white
    assert.ok(r >= 0 && r < white, `a radiance under one white (${r}) for hdr ${hdr} es/white ${eow} longMax ${longMax} white ${white} share ${share}`)
    assert.ok(r <= cap * (1 + 1e-12), `under the radiance cap at hdr ${hdr}: ${r} <= ${cap}`)
    if (unlitDisplay(cap, x) < target) assert.equal(r, Math.min(x.white, cap), `an unreachable target stops at the cap and fails dim at hdr ${hdr}`)
    else assert.ok(r > 0, `a reachable target gets a floor at hdr ${hdr}`)
    if (r === 0) assert.fail('a positive share keeps the capped albedo contrast')
    else if (unlitDisplay(r, x) < target) assert.ok(r === Math.min(x.white, cap), `an unreachable capped target fails dim at its cap: ${unlitDisplay(r, x)} < ${target}`)
    else if (r < cap * (1 - 1e-10)) assert.ok(Math.abs(unlitDisplay(r, x) - target) < 1e-7, `displays at the target: ${unlitDisplay(r, x)} vs ${target}`)
    else assert.ok(unlitDisplay(r, x) <= target + 1e-7, `a capped solution fails dim: ${unlitDisplay(r, x)} <= ${target}`)
    if (hdr >= 0.05) assert.ok(r / x.esLevel <= 3 + 1e-12, `under three earthshine keys (${r / x.esLevel})`)
    cases++
  }
  assert.ok(cases >= 200)
  assert.equal(nightFloorRadiance(0, X(1, 1e-5, 0.06)), 0, 'off')
  assert.equal(nightFloorRadiance(Number.NaN, X(1, 1e-5, 0.06)), 0)
  assert.equal(nightFloorRadiance(0.008, { white: 0, esLevel: 0, longMax: 0.06, hdr: 1 }), 0, 'no white, no floor')
  // The display levels the floor lands on (the final pass's toe, then sRGB), for the PR's numbers. Near full Moon (hdr 0, nothing lit: the
  // white point at its floor) and beside a crescent (hdr 1, the long exposure keyed on earthshine): 0.07 (mare), 0.12 and 0.2 (highland) albedo.
  const toe = (y: number) => y * y * (3 - 2 * y) * 0.25 + 0.75 * y
  const srgb8 = (l: number) => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055)
  const levels = (share: number, x: ReturnType<typeof X>) => [0.07, 0.12, 0.2].map((a) => +srgb8(toe(unlitDisplay(nightFloorRadiance(share, x) * a / 0.12, x))).toFixed(1))
  const fullMoonFar = X(0, 1e-6 / WHITE_FLOOR, 0.039, WHITE_FLOOR)
  const crescent = X(1, 1e-5, 0.06)
  const gibbous = X(0.1, 1e-5, 0.035)
  const quarter = X(0.15, 1e-5, 0.035)
  for (const [name, x] of [['far side near full Moon', fullMoonFar], ['beside a crescent', crescent]] as const) {
    const l = levels(0.008, x)
    assert.ok(l[0] >= 10 && l[2] <= 26 && l[0] < l[1] && l[1] < l[2], `${name} at 0.008: mare ${l[0]}, 0.12 ${l[1]}, highland ${l[2]} of 255`)
    console.log(`night floor 0.008, ${name}: albedo 0.07 / 0.12 / 0.2 -> ${l.join(' / ')} of 255; 0.03 -> ${levels(0.03, x).join(' / ')}`)
  }
  for (const x of [gibbous, quarter]) {
    const l = levels(0.008, x)
    assert.ok(l[0] > 0 && l[0] < l[1] && l[1] < l[2] && l[2] - l[0] >= 7, `gibbous albedo contrast survives at hdr ${x.hdr}: ${l.join(' / ')}`)
    assert.ok(l[2] / l[0] >= 2.5, `gibbous highland to mare contrast is retained at hdr ${x.hdr}: ${l[2] / l[0]}`)
    assert.ok(nightFloorRadiance(0.008, x) <= 3 * x.esLevel, `gibbous radiance is capped at three keys (${x.hdr})`)
  }
  // The crescent's floor is far below the short exposure's reach, so a leak onto sunlit ground could not show (under a thousandth of white).
  assert.ok(nightFloorRadiance(0.008, crescent) / crescent.white < 1e-3)
  // The final pass's curve is the twin's: the shader text and its uniforms.
  for (const line of ['float x = Y / uWhite;', 'float sE = x / max(uEsLevel, 1e-9);', 'float yLong = uLongMax * (1.0 - exp(-0.7 * sE));', 'yLong += uStarLift * 0.6 * (1.0 - exp(-max(sE - 3.0, 0.0) / 12.0));', 'float fused = mix(yLong, yShort, sc.a);', 'float y = mix(x, fused, uHdr);']) {
    assert.ok(FINAL_FRAGMENT.includes(line), `final pass: ${line}`)
  }
  const finalSrc = readFileSync(new URL('../src/post/final.ts', import.meta.url), 'utf8')
  assert.ok(finalSrc.includes('u.uWhite.value = x.white * x.preExpose') && finalSrc.includes('u.uEsLevel.value = x.esLevel / x.white') && finalSrc.includes('u.uLongMax.value = x.longMax') && finalSrc.includes('u.uHdr.value = x.hdr'), 'the final pass reads the exposure the twin models')
}
console.log('exposure rest tests passed')
