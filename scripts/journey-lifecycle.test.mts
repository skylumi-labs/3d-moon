import assert from 'node:assert/strict'
import { JourneyLifecycle, orbitAngleDeg, ORBIT_SECONDS, ORBIT_SUNSET_AFTER_DEG, ORBIT_SUNRISE_AFTER_DEG, MAX_FLIGHT_SECONDS } from '../src/journey/lifecycle.ts'
import { dateBlend } from '../src/journey/dateTransition.ts'
import { CameraRig } from '../src/camera/rig.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
const l = new JourneyLifecycle(), first = l.begin('a11', 'Apollo 11', 'moon', 0)
l.sample(first, 'approach', .5)
l.cancel()
assert.equal(l.arrive(first, 10), false, 'cancelled data cannot deliver stale arrival')
const next = l.begin('a17', 'Apollo 17', 'ground', 11)
assert.equal(l.current(first), false)
assert.equal(l.state!.arrivalAt, null)
l.sample(first, 'descent', 1)
assert.equal(l.state!.progress, 0)
assert.equal(l.arrive(next, 20), true)
assert.equal(l.arrive(next, 22), false, 'arrival exactly once')
assert.equal(l.state!.arrivalAt, 20)
assert.equal(ORBIT_SECONDS, 25)
assert.ok(ORBIT_SECONDS <= MAX_FLIGHT_SECONDS && MAX_FLIGHT_SECONDS === 30, 'the orbit lasts at most 30 s (owner 2026-10-22)')
assert.equal(orbitAngleDeg(0), 0)
assert.equal(orbitAngleDeg(1), 360)
let angle = 0
for (let i = 1; i <= 400; i++) { const a = orbitAngleDeg(i / 400); assert.ok(a >= angle); angle = a }
{
  // The owner's pace (2026-10-20, retimed to 25 s on 2026-10-22): from a lit start the Sun goes behind the limb ~118 deg after the start and comes
  // out ~23 deg later; the camera is slow there and faster elsewhere, never slower than 1.5 deg/s (the audit's freeze check), and starts and ends at rest.
  const N = 3000, speed = (i: number): number => (orbitAngleDeg((i + 1) / N) - orbitAngleDeg(i / N)) * N / ORBIT_SECONDS
  const at = (deg: number): number => { let i = 0; while (orbitAngleDeg(i / N) < deg) i++; return i }
  const sunset = at(ORBIT_SUNSET_AFTER_DEG), sunrise = at(ORBIT_SUNRISE_AFTER_DEG)
  let slow = Infinity, fast = 0
  for (let i = Math.round(N * 0.03); i < Math.round(N * 0.97); i++) slow = Math.min(slow, speed(i))
  for (let i = sunset; i < sunrise; i++) fast = Math.max(fast, speed(i))
  assert.ok(slow >= 1.5, `never under 1.5 deg/s (${slow.toFixed(2)})`)
  assert.ok(fast <= 7.5, `slow across the sunset and sunrise (${fast.toFixed(2)} deg/s)`)
  assert.ok(speed(Math.round(N * 0.7)) >= 2.5 * fast, 'faster round the rest of the Moon')
  assert.ok(sunset / N * ORBIT_SECONDS > 4 && sunset / N * ORBIT_SECONDS < 9, 'the Sun sets a few seconds into the flight, after the lit side has been seen')
  assert.ok(sunrise / N * ORBIT_SECONDS < ORBIT_SECONDS / 2, 'and is out again before the half way mark')
  assert.ok((sunrise - sunset) / N * ORBIT_SECONDS > 4.5, 'and stays behind the Moon long enough to read as a beat')
  assert.ok(speed(0) < 1 && speed(N - 1) < 1, 'rests at both ends')
}
assert.equal(dateBlend(0, 0), 0)
assert.equal(dateBlend(300, 0), .5)
assert.equal(dateBlend(600, 0), 1)
const e = ephemerisAt(new Date('2026-10-01T00:00:00Z'))
for (const aspect of [390 / 844, 1.6]) for (const u of [.1, .5, .9]) {
  const rig = new CameraRig()
  rig.setPose({ lon: 10, lat: 5, dist: 6 })
  const now = 2200 * u, rendered = rig.camera(e, aspect, now)
  rig.settle(e, aspect, now, rendered)
  const after = rig.camera(e, aspect, now + 10000)
  assert.ok(after.pos.distanceTo(rendered.pos) < 1e-10)
  assert.ok(after.back.distanceTo(rendered.back) < 1e-10)
  assert.ok(after.up.distanceTo(rendered.up) < 1e-10)
  assert.ok(Math.abs(after.tanHalf - rendered.tanHalf) < 1e-12)
  rig.step(now + 10000, .1)
  assert.equal(rig.gliding(), false, 'no glide survives the settle')
  rig.zoom(.99, now + 10001)
  const zoomed = rig.camera(e, aspect, now + 10001)
  assert.ok(zoomed.pos.distanceTo(after.pos) < after.pos.length() * .02, 'first wheel makes only requested small motion')
  rig.orbit(1, 0, 900, now + 10002)
  assert.equal(rig.mode, 'fly')
}
console.log('journey-lifecycle.test.mts: generations, arrival, literal full winding, date blend, exact Stop/lens and first wheel: ok')
