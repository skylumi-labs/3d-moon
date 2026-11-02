/**
 * The ridge view, the lift-off camera, the journey scrubber's progress mapping:
 *   npm test
 */
import assert from 'node:assert/strict'
import { flyTanHalf } from '../src/camera/pose.ts'
import { CameraRig } from '../src/camera/rig.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { RIDGE_SITE, RIDGE_TIME, observerAt, skyState } from '../src/ridge/observer.ts'
import { FLY_START, LIFT_END, LIFT_FOV_DEG, LIFT_HEIGHT_KM, RIDGE_FOV_DEG, endPose, horizonDipDeg, journeyFrame, liftHeightKm, moonFramedCamera } from '../src/ridge/journey.ts'
import { airmass, refractionArcmin, skyLevelIF, transmission } from '../src/ridge/sky.ts'
import { ridgeExit } from '../src/ridge/exit.ts'
import { HELD_MAX, JourneyScrub, type JourneyHandle, SCRUB_KEY_S, SCRUB_KEY_SHARE, SCRUB_PAGE_SHARE, clamp01, progressOfTimed, progressToValue, scrubKeyTarget, t0AtProgress, valueToProgress } from '../src/journey/scrub.ts'
import { MOON_R_KM } from '../src/glsl/common.ts'

const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`)
const e = ephemerisAt(RIDGE_TIME)
const obs = observerAt(e)
function ctxFor(aspect: number) {
  return { e, aspect, obs }
}

// 1. The preset: moon-v1's ridge moment. A crescent 16% lit, low in the evening twilight, the Sun about 10 degrees down.
{
  const st = skyState(e, obs)
  near(e.illuminatedFraction, 0.16, 0.01, 'lit share')
  assert.ok(st.moon.alt > 2.5 && st.moon.alt < 4, `moon altitude ${st.moon.alt}`)
  assert.ok(st.sun.alt < -8 && st.sun.alt > -12, `sun altitude ${st.sun.alt}`)
  // The observer's frame is orthonormal and sits on the Earth's surface (6371 km + 1.5 km) about 400,000 km from the Moon.
  near(obs.zenith.dot(obs.north), 0, 1e-9, 'zenith.north')
  near(obs.zenith.dot(obs.east), 0, 1e-9, 'zenith.east')
  near(obs.pos.clone().sub(e.earthKm.clone().divideScalar(MOON_R_KM)).length() * MOON_R_KM, 6371 + RIDGE_SITE.heightM / 1000, 1e-6, 'observer height')
  const dKm = obs.pos.length() * MOON_R_KM
  assert.ok(dKm > 356000 && dKm < 407000, `Moon distance ${dKm}`)
}

// 2. Start: exactly the observer, looking at the Moon's centre, up along the zenith, the telephoto lens, on the ground.
for (const aspect of [1.6, 0.5]) {
  const f = journeyFrame(0, ctxFor(aspect))
  assert.ok(f.cam.pos.distanceTo(obs.pos) < 1e-9, 'start position')
  near(f.cam.back.dot(obs.pos.clone().normalize()), 1, 1e-12, 'looks at the Moon')
  near(f.cam.up.dot(f.cam.back), 0, 1e-12, 'up perpendicular')
  near(f.cam.up.dot(obs.zenith), Math.sqrt(1 - obs.zenith.dot(f.cam.back) ** 2), 1e-9, 'up is the zenith, projected')
  near(f.cam.tanHalf, flyTanHalf(aspect, RIDGE_FOV_DEG), 1e-9, 'lens at the start')
  near(f.altKm, RIDGE_SITE.heightM / 1000, 1e-6, 'height at the start')
  near(f.air, 1, 1e-9, 'air at the start')
  assert.equal(f.ridge, 1)
  assert.equal(f.liftKm, 0)
}

// 3. End: exactly the pose the site's own dolly zoom lands on, so the rig can take over with no pop.
for (const aspect of [1.6, 0.5]) {
  const f = journeyFrame(1, ctxFor(aspect))
  const rig = new CameraRig()
  rig.setPose(endPose(e, aspect))
  rig.fovDeg = 30
  const c = rig.camera(e, aspect, 0)
  assert.ok(f.cam.pos.distanceTo(c.pos) < 1e-9, `end position ${f.cam.pos.toArray()} vs ${c.pos.toArray()}`)
  assert.ok(f.cam.right.distanceTo(c.right) < 1e-9 && f.cam.up.distanceTo(c.up) < 1e-9 && f.cam.back.distanceTo(c.back) < 1e-9, 'end axes')
  near(f.cam.tanHalf, c.tanHalf, 1e-9, 'end lens')
  assert.equal(f.air, 0)
  assert.equal(f.ridge, 0)
  // Past the end is the end.
  assert.ok(journeyFrame(7, ctxFor(aspect)).cam.pos.distanceTo(c.pos) < 1e-9)
  assert.ok(journeyFrame(-3, ctxFor(aspect)).cam.pos.distanceTo(obs.pos) < 1e-9)
}

// 4. Along the way: the camera only rises, the air only thins, the ridge only sinks, the Moon only grows in the sky,
// and no step is a pop (position, axes, lens change a little per 1/1000 of the journey).
{
  const aspect = 1.6
  let prev = journeyFrame(0, ctxFor(aspect))
  const N = 1000
  let maxAxes = 0, maxLens = 0
  for (let i = 1; i <= N; i++) {
    const f = journeyFrame(i / N, ctxFor(aspect))
    assert.ok(f.altKm >= prev.altKm - 1e-9, `altitude falls at ${i / N}`)
    assert.ok(f.air <= prev.air + 1e-12, `air thickens at ${i / N}`)
    assert.ok(f.ridge <= prev.ridge + 1e-12, `ridge rises at ${i / N}`)
    assert.ok(f.liftKm >= prev.liftKm - 1e-12, 'lift falls')
    assert.ok(Math.asin(1 / f.cam.pos.length()) >= Math.asin(1 / prev.cam.pos.length()) - 1e-12, `Moon shrinks at ${i / N}`)
    maxAxes = Math.max(maxAxes, Math.acos(Math.min(1, f.cam.back.dot(prev.cam.back))), Math.acos(Math.min(1, f.cam.up.dot(prev.cam.up))))
    maxLens = Math.max(maxLens, Math.abs(Math.log(f.cam.tanHalf / prev.cam.tanHalf)))
    prev = f
  }
  assert.ok(maxAxes < 0.015, `axes step ${maxAxes} rad`)
  assert.ok(maxLens < 0.06, `lens step ${maxLens}`)
  // The lift: 120 km, the lens 40 degrees, at the end of its phase; the air is gone (under 1 in 10,000) and the ridge is far below.
  const top = journeyFrame(LIFT_END, ctxFor(aspect))
  near(top.liftKm, LIFT_HEIGHT_KM, 1e-6, 'top of the lift')
  assert.ok(top.air < 1e-4 && top.ridge === 0, 'space at the top of the lift')
  assert.ok(journeyFrame(FLY_START, ctxFor(aspect)).altKm > 50, 'nearly at the top when the fly begins')
  near(liftHeightKm(0), 0, 1e-12, 'lift 0')
  near(liftHeightKm(1), LIFT_HEIGHT_KM, 1e-9, 'lift 1')
  assert.ok(LIFT_FOV_DEG > RIDGE_FOV_DEG)
  // The horizon dips further the higher you go: 0 on the ground, about 11 degrees at 120 km.
  near(horizonDipDeg(0), 0, 1e-9, 'dip 0')
  near(horizonDipDeg(120), 10.9, 0.3, 'dip 120 km')
}

// 5. The Moon stays found by the exposure search at any lens: a wide lens is narrowed to one that fills the frame.
{
  const wide = journeyFrame(0.3, ctxFor(1.6)).cam
  const s = moonFramedCamera(wide)
  const moonTan = Math.tan(Math.asin(1 / wide.pos.length()))
  assert.ok(s.tanHalf < wide.tanHalf && Math.abs(s.tanHalf - moonTan / 0.85) < 1e-12)
  const narrow = journeyFrame(1, ctxFor(1.6)).cam
  assert.equal(moonFramedCamera(narrow).tanHalf, narrow.tanHalf)
}

// 6. The air: values at the Moon's altitude.
{
  near(airmass(90), 1, 0.01, 'zenith airmass')
  near(airmass(3.2), 14.4, 0.6, 'airmass at 3.2 deg')
  near(refractionArcmin(45), 1, 0.05, 'refraction at 45 deg')
  const t = transmission(3.4, 1, 1.6)
  assert.ok(t[0] > t[1] && t[1] > t[2], 'reddened')
  assert.equal(transmission(3.4, 0)[1], 1, 'no air, no dimming')
  assert.ok(skyLevelIF(-10, 3) > skyLevelIF(-10, 60) && skyLevelIF(-6, 3) > skyLevelIF(-10, 3))
}

// 7. Progress mapping: a timed journey put at u shows u, exactly, at that moment; clamped; the slider maps both ways.
for (const ms of [2200, 24000, 48000]) {
  for (const now of [0, 1234.5, 9e6]) {
    for (const u of [0, 0.001, 0.25, 0.5, 0.999, 1]) {
      near(progressOfTimed(now, t0AtProgress(now, u, ms), ms), u, 1e-9, `timed u=${u}`)
    }
    // It then runs on from there: monotone in time, and reaches 1 after the rest of its duration.
    const t0 = t0AtProgress(now, 0.4, ms)
    let prev = -1
    for (let k = 0; k <= 10; k++) {
      const p = progressOfTimed(now + k * 0.1 * ms, t0, ms)
      assert.ok(p >= prev)
      prev = p
    }
    assert.equal(progressOfTimed(now + 0.6 * ms, t0, ms), 1)
  }
}
assert.equal(t0AtProgress(100, 5, 10), 90)
assert.equal(t0AtProgress(100, -5, 10), 100)
assert.equal(clamp01(NaN), 0)
near(valueToProgress(500, 0, 1000), 0.5, 1e-12, 'slider to progress')
near(progressToValue(0.25, -990, 732), -990 + 0.25 * 1722, 1e-9, 'progress to slider')
assert.equal(valueToProgress(5, 5, 5), 0)

// 8. The scrubber: dragging holds the journey at the dragged progress (forward and backward, exactly), freezes its own clock meanwhile,
// and letting go leaves it there to run on.
{
  const log: string[] = []
  let u = 0.1
  const h: JourneyHandle = { id: 't', label: 't', get: () => u, set: (x) => { u = x; log.push(`set ${x}`) }, freeze: (on) => log.push(`freeze ${on}`) }
  const s = new JourneyScrub()
  s.begin(0.5)
  assert.equal(s.held, false, 'no journey attached: nothing to hold')
  s.attach(h)
  assert.equal(s.progress(), 0.1)
  s.begin(0.6)
  assert.ok(s.held && u === 0.6 && s.progress() === 0.6)
  u = 0.61 // the journey's own clock moved it a little: the next frame puts it back
  s.hold()
  assert.equal(u, 0.6)
  s.move(0.95)
  assert.equal(u, 0.95)
  s.move(0.2) // backward
  assert.equal(u, 0.2)
  s.move(7)
  assert.equal(u, HELD_MAX, 'a held drag stops short of the end: completion is the release, not the finger arriving')
  assert.ok(HELD_MAX < 1 && HELD_MAX > 0.998)
  s.move(-2)
  assert.equal(u, 0)
  s.end()
  assert.ok(!s.held)
  u = 0.3 // released: the journey runs on by itself
  s.hold()
  assert.equal(u, 0.3)
  assert.equal(s.progress(), 0.3)
  assert.deepEqual(log.filter((l) => l.startsWith('freeze')), ['freeze true', 'freeze false'])
  // Changing the journey mid-drag releases the drag.
  s.begin(0.4)
  s.attach(null)
  assert.ok(!s.held && s.current === null)
  assert.equal(log.filter((l) => l.startsWith('freeze')).length, 4)
}

// 8b. A drag in a moment's lead-in (the approach before its flight or orbit; the slider used to be disabled there) carries over:
// the lead-in starts the journey at the dragged progress, and the hold passes to the journey's own handle, which stays held at the
// same progress until the finger lets go. A plain handle change still releases.
{
  const log: string[] = []
  let started: number | null = null
  const lead: JourneyHandle = { id: 'lead-in', label: 'l', leadIn: true, get: () => 0, set: (x) => { if (x > 0) started = x } }
  let u = 0
  const flight: JourneyHandle = { id: 'cinematic', label: 'f', get: () => u, set: (x) => { u = x; log.push(`set ${x}`) }, freeze: (on) => log.push(`freeze ${on}`) }
  const s = new JourneyScrub()
  s.attach(lead)
  s.begin(0) // a press on the thumb at 0: the approach runs on
  assert.equal(started, null, 'a press at 0 does not cut the approach')
  s.move(0.4)
  assert.equal(started, 0.4, 'dragging past 0 starts the journey there')
  s.attach(flight) // the next frame: the journey has its clock and its own handle
  assert.ok(s.held, 'the drag goes on across the hand-over')
  assert.equal(u, 0.4, 'the journey is put at the held progress at once')
  assert.deepEqual(log, ['freeze true', 'set 0.4'])
  s.move(0.1)
  assert.equal(u, 0.1)
  s.hold()
  assert.equal(u, 0.1)
  s.end()
  assert.ok(!s.held)
  assert.equal(log.at(-1), 'freeze false')
  // From the journey to nothing (cancelled, ended): released.
  s.begin(0.3)
  s.attach(null)
  assert.ok(!s.held)
  // A lead-in that ends with no journey after it (the moment was cancelled) releases too.
  s.attach(lead)
  s.begin(0)
  s.attach(null)
  assert.ok(!s.held)
}

// 8c. Keys on the slider step whole seconds from where the journey is (the range's own step was a thousandth: 0.03 s of a 30 s flight per press).
{
  const near = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${a} vs ${b}`)
  near(scrubKeyTarget('ArrowRight', 0.5, 20), 0.5 + SCRUB_KEY_S / 20)
  near(scrubKeyTarget('ArrowUp', 0.5, 20), 0.5 + SCRUB_KEY_S / 20)
  near(scrubKeyTarget('ArrowLeft', 0.5, 20), 0.5 - SCRUB_KEY_S / 20)
  near(scrubKeyTarget('ArrowDown', 0.5, 30), 0.5 - SCRUB_KEY_S / 30)
  near(scrubKeyTarget('ArrowRight', 0.5), 0.5 + SCRUB_KEY_SHARE)
  near(scrubKeyTarget('ArrowRight', 0.5, 4), 0.5 + SCRUB_PAGE_SHARE)
  near(scrubKeyTarget('PageUp', 0.1, 20), 0.1 + SCRUB_PAGE_SHARE)
  near(scrubKeyTarget('PageDown', 0.1, 20), 0)
  assert.equal(scrubKeyTarget('ArrowLeft', 0.02, 20), 0, 'back to the start, never below')
  assert.equal(scrubKeyTarget('ArrowRight', 0.99, 20), 1)
  assert.equal(scrubKeyTarget('Home', 0.7, 20), 0)
  assert.equal(scrubKeyTarget('End', 0.2, 20), 1)
  assert.equal(scrubKeyTarget('a', 0.2, 20), null)
  assert.equal(scrubKeyTarget('Enter', 0.2, 20), null)
  // A step of a 20 s flight is at least a tenth of the journey's thousandths a range step was.
  assert.ok(SCRUB_KEY_S / 20 >= 0.05)
}

// 10. Every way out of the ridge restores the idle orbit and keeps the ridge's date; the Back to now chip shows whenever
// the clock is not live (Lift off and Skip agree on the destination time).
{
  const off = ridgeExit({ autoAllowed: true, live: false })
  assert.equal(off.auto, true, 'the idle orbit comes back')
  assert.equal(off.keepTime, true)
  assert.equal(off.showBackToNow, true, 'a ridge date is not the present: the chip shows')
  assert.equal(ridgeExit({ autoAllowed: true, live: true }).showBackToNow, false)
  assert.equal(ridgeExit({ autoAllowed: false, live: false }).auto, false, '?auto=0 and still captures stay still')
}

// 11. The wiring in main.ts (a text check: the renderer cannot run here). dropRidge restores the idle orbit through
// ridgeExit; the panel's look/earth buttons leave through skipRidge; no exit resets the clock to now on its own.
{
  const { readFileSync } = await import('node:fs')
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const fn = (name: string): string => { const i = main.indexOf(`function ${name}(`); return main.slice(i, main.indexOf('\n}\n', i)) }
  assert.match(fn('dropRidge'), /rig\.auto = ridgeExit\(/, 'dropRidge restores the idle orbit')
  assert.doesNotMatch(fn('skipRidge'), /time = new Date\(\)/, 'skip keeps the ridge date, like lift-off')
  // The time panel's look/earth buttons are gone (the one bar has Home); Home and the clock leave the ridge through the same exits.
  assert.match(fn('goHome'), /takeCurrentScriptCamera\(\)/, 'Home leaves the ridge (takeCurrentScriptCamera drops it)')
  assert.match(fn('setClock'), /dropRidge\(\)/, 'a time change leaves the ridge')
}

// 12. The look-back never shows an empty frame (audit 7: 9 s of black): while the camera looks back at the Earth the Earth's limb is inside the frame
// and the (just set) Sun, whose glare would fill it, is outside it.
{
  const aspect = 1.6
  const earthC = e.earthKm.clone().divideScalar(MOON_R_KM)
  const toSun = e.sunKm.clone().sub(e.earthKm).normalize()
  let looked = 0
  for (let i = 0; i <= 200; i++) {
    const f = journeyFrame(0.34 + (0.2 * i) / 200, ctxFor(aspect))
    if (f.earthLook < 0.99) continue
    looked++
    const down = f.cam.pos.clone().sub(earthC).normalize()
    const fwd = f.cam.back.clone().negate()
    const fromDown = Math.acos(Math.min(1, Math.max(-1, fwd.dot(down.clone().negate()))))
    const limb = Math.PI / 2 - f.dipDeg * Math.PI / 180
    const half = Math.atan(f.cam.tanHalf)
    assert.ok(Math.abs(limb - fromDown) < half * 0.95, `the limb is in the frame at ${i}: off-centre ${(limb - fromDown) * 57.3} deg, half field ${half * 57.3}`)
    const sunOff = Math.acos(Math.min(1, fwd.dot(toSun)))
    assert.ok(sunOff > Math.atan(f.cam.tanHalf * Math.hypot(1, aspect)), `the Sun is out of the frame at ${i}`)
  }
  assert.ok(looked > 20, 'the look-back lasts')
}
console.log('journey.test: ok')
