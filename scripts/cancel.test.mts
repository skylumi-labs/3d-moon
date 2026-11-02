/** A cancelled pin journey always ends somewhere sane (journey/cancel.ts). tsx scripts/cancel.test.mts */
import assert from 'node:assert/strict'
import { afterGrab, cancelJourneyAndContinuation, isTap, keepPatchLoad, onCancel, viewpointJourneyBusy } from '../src/journey/cancel.ts'
import { planFly, type FlyEnd, SAMPLES } from '../src/journey/path.ts'
import { homePose, type Pose } from '../src/camera/pose.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { JourneyLifecycle } from '../src/journey/lifecycle.ts'

// Policy: a date change never cancels a pin journey; a grab stops it for a tap to resume; nothing running means a plain stop.
assert.equal(onCancel('clock', true), 'continue')
assert.equal(onCancel('grab', true), 'stop-resumable')
assert.equal(onCancel('other', true), 'stop')

// A wheel notch or tap on a free camera keeps the patch download (#185); a script that owned the camera still cancels it.
assert.equal(keepPatchLoad('grab', false), true)
assert.equal(keepPatchLoad('grab', true), false)
assert.equal(keepPatchLoad('other', false), false)
assert.equal(keepPatchLoad('other', true), false)
assert.equal(keepPatchLoad('clock', false), false)
for (const c of ['clock', 'grab', 'other'] as const) assert.equal(onCancel(c, false), 'stop')

// A tap resumes; a drag, a long press and the wheel release.
const d = { x: 100, y: 100, at: 1000 }
assert.equal(isTap(d, { x: 103, y: 102, at: 1120 }), true)
assert.equal(isTap(d, { x: 140, y: 100, at: 1120 }), false, 'a drag')
assert.equal(isTap(d, { x: 100, y: 100, at: 1900 }), false, 'a long press')
assert.equal(isTap(d, { x: 100, y: 100, at: 1100 }, true), false, 'a wheel')
assert.equal(afterGrab(true, true), 'resume')
assert.equal(afterGrab(true, false), 'release')
assert.equal(afterGrab(false, true), 'release')

// A canvas gesture ends the active tween journey and its deferred panorama continuation together.
{
  const lifecycle = new JourneyLifecycle()
  const generation = lifecycle.begin('apollo17', 'Apollo 17', 'ground', 100)
  lifecycle.sample(generation, 'approach', 0.4)
  let pendingPanorama: string | null = 'ALSEP'
  assert.equal(onCancel('grab', true), 'stop-resumable')
  cancelJourneyAndContinuation(lifecycle, () => { pendingPanorama = null })
  assert.equal(lifecycle.state?.status, 'cancelled', 'the flight journey ends as cancelled')
  assert.equal(pendingPanorama, null, 'the deferred panorama open is cancelled')
}

// Resuming plans from where the journey stopped (any point along it, including the dark one over the pole) to the same end:
// the resumed plan lands on the target exactly and keeps a body in frame at every sample.
const e = ephemerisAt(new Date('2026-10-20T19:00:00Z'))
const P = (lon: number, lat: number, dist: number): Pose => ({ lon, lat, dist, roll: 0, pitch: 0 })
const end: FlyEnd = { pose: P(-20.08, 9.62, 1.5), fovDeg: 30, aimShift: 0, aimShiftX: 0, look: 0 }
for (const stop of [P(0, 83, 1.78), P(-150, -60, 3), homePose(e)]) {
  for (const aspect of [375 / 812, 1.6]) {
    const plan = planFly(e, { pose: stop, fovDeg: 30, aimShift: 0, aimShiftX: 0, look: 0 }, end, { aspect })
    const s1 = plan.at(1)
    assert.ok(Math.abs(s1.pose.dist - 1.5) < 1e-9 && Math.abs(s1.pose.lat - 9.62) < 1e-6, `lands on the target from ${JSON.stringify(stop)}`)
    assert.ok(plan.minCover >= 0.02, `body in frame (${plan.minCover})`)
    assert.ok(plan.ms >= 1500 && plan.ms <= 9000)
    assert.ok(SAMPLES > 0)
  }
}
// Escape stops a running or loading journey; with none, it is free to go Home.
assert.equal(viewpointJourneyBusy('travelling', false), true)
assert.equal(viewpointJourneyBusy('loading', false), true)
assert.equal(viewpointJourneyBusy(undefined, true), true, 'a scripted camera counts even without a journey record')
assert.equal(viewpointJourneyBusy('arrived', false), false)
assert.equal(viewpointJourneyBusy('cancelled', false), false, 'the second Escape goes Home')
assert.equal(viewpointJourneyBusy(undefined, false), false)
console.log('cancel.test ok')
