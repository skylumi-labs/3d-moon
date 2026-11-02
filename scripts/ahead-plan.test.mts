/** Exposure look-ahead for the Sun's arrival in the earth-eclipses-sun journey. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import type { Exposure } from '../src/post/exposure.ts'
import { type Ahead, ExposureController } from '../src/post/exposureControl.ts'
import { AHEAD_S, aheadExposureReusable, aheadMemoMustReset, aheadRefreshSet, firstArrivalS, sunArrivalAheadS } from '../src/post/aheadPlan.ts'

const LOG2E = Math.LOG2E

assert.deepEqual(aheadRefreshSet(5, 4, 2), { indices: [4, 0], next: 1 }, 'round robin wraps at the end')
assert.deepEqual(aheadRefreshSet(0, 3, 2), { indices: [], next: 0 }, 'an empty list has no refreshes')
assert.deepEqual(aheadRefreshSet(3, 2, 8), { indices: [2, 0, 1], next: 2 }, 'perFrame at least count visits all entries once')
const flightA = {}, flightB = {}
assert.equal(aheadMemoMustReset(flightA, flightB, 10, 10, 100, 116, 0), true, 'a replacement flight clears every old prediction')
assert.equal(aheadMemoMustReset(flightA, flightA, 10, 11, 100, 116, 0), true, 'an ephemeris bucket change clears predictions')
assert.equal(aheadMemoMustReset(flightA, flightA, 10, 10, 100, 116, 1), true, 'an exposure cut clears predictions')
assert.equal(aheadMemoMustReset(flightA, flightA, 10, 10, 100, 1200, 0), true, 'a jumped clock clears predictions')
assert.equal(aheadMemoMustReset(flightA, flightA, 10, 10, 100, 116, 0), false, 'continuous flight frames reuse the memo')
assert.equal(aheadExposureReusable(true, true), false, 'a stale owner invalidates frozen exposure on this frame')
assert.equal(aheadExposureReusable(true, false), true, 'a valid owner may keep frozen exposure')
assert.equal(aheadExposureReusable(true, aheadMemoMustReset(flightA, flightB, 10, 10, 100, 116, 0)), false, 'owner validation runs before a cached frozen frame is accepted')
{
  const count = 7, perFrame = 2
  let cursor = 0
  const seen = new Set<number>()
  for (let call = 0; call < Math.ceil(count / perFrame); call++) {
    const batch = aheadRefreshSet(count, cursor, perFrame)
    batch.indices.forEach((i) => seen.add(i))
    cursor = batch.next
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6], 'every offset is refreshed within ceil(count/perFrame) calls')
}
const raw = (white: number): Exposure => ({
  white, preExpose: 1, esLevel: white * 1e-3, esLevelView: white * 1e-3, longMax: 0.05, hdr: 1, starLift: 0, whiteFloored: false, frameBrightest: white,
  search: { best: white, bestA: white, esMax: 0.5, hits: 10, samples: 100, sunlitFraction: 0.3, eclipseLevel: 0 },
})

// Pure scan.
assert.equal(firstArrivalS(() => false, 3, 8), null)
assert.equal(firstArrivalS(() => true, 3, 8), null, 'already bright at the start: nothing to announce')
const at = firstArrivalS((t) => t >= 6.1, 3, 8)
assert.ok(at !== null && at >= 6.1 && at < 6.16, `arrival placed within the refine tolerance: ${at}`)
assert.ok(Math.abs(sunArrivalAheadS((t) => t >= 2, 8)! - 2) < 0.06, 'a Sun inside the regular horizon is announced too (a transient can fall between its samples)')
assert.equal(sunArrivalAheadS(() => true, 8), null, 'in view already')
assert.equal(sunArrivalAheadS((t) => t >= 6, 2.5), null, 'journey ends before the horizon')
assert.ok(sunArrivalAheadS((t) => t >= 6, 8)! >= 6)

// The Sun peeks out past the Earth's limb for 0.3 s, 6.0 s into an 8 s journey (0.5 -> 50 white point, 6.6 stops), then is covered
// again. The regular look-ahead samples 0.6 s apart and can step right over it.
const DUR = 8, BASE = 0.5, SUN = 50, FROM = 6.05, TO = 6.35
const sunIn = (t: number) => t >= FROM && t <= TO
const rawAt = (t: number) => raw(sunIn(t) ? SUN : BASE)
function run(withScan: boolean): { maxStep: number } {
  const c = new ExposureController()
  let prev = c.step(rawAt(0), 0).white
  let maxStep = 0
  const dt = 1 / 60
  for (let i = 1; i <= DUR * 60; i++) {
    const t = i * dt
    const ahead: Ahead[] = AHEAD_S.map((o) => ({ t: o, raw: rawAt(t + o) }))
    if (withScan) {
      const a = sunArrivalAheadS((o) => sunIn(t + o), DUR - t)
      if (a !== null) ahead.push({ t: a, raw: rawAt(t + a) })
    }
    const w = c.step(rawAt(t), t * 1000, false, ahead).white
    maxStep = Math.max(maxStep, Math.abs(Math.log(w / prev)) * LOG2E)
    prev = w
  }
  return { maxStep }
}
const old = run(false), planned = run(true)
assert.ok(old.maxStep > 2, `without the scan the unseen Sun is a cut: ${old.maxStep.toFixed(2)} stops in one frame`)
assert.ok(planned.maxStep < 0.1, `with the scan it is a ramp: ${planned.maxStep.toFixed(3)} stops per frame`)

// Production wiring: the subject transition's ahead list asks for the scan.
const src = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
assert.match(src, /sunArrivalAheadS\(/, 'main.ts announces the Sun arrival')
console.log(`ahead-plan.test.mts: one-frame step ${old.maxStep.toFixed(2)} -> ${planned.maxStep.toFixed(3)} stops: ok`)
