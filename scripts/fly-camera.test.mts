/**
 * Free-flying camera controls: forward and back keep the altitude and the heading, tilt works at every distance within a limit
 * that keeps the Moon in view, the compass reads and resets the heading, and the heading turn leaves the position alone.
 */
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { CameraRig } from '../src/camera/rig.ts'
import { forwardTangent, tiltLimitDeg, viewHeadingDeg, wrapHeading } from '../src/camera/fly.ts'
import { PITCH_MAX, homePose, reliefShare, sizeRatio } from '../src/camera/pose.ts'
import { stickMotion } from '../src/ui/touchControlsLogic.ts'
import { ephemerisAt } from '../src/ephemeris.ts'

const e = ephemerisAt(new Date('2026-10-20T22:34:00Z'))
const aspect = 1.6
const NOW = 1000
const near = (a: number, b: number, tol: number, msg: string): void => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`)
const rigAt = (dist: number, lat = 20, lon = 30, roll = 0, pitch = 0): CameraRig => {
  const r = new CameraRig()
  r.setFloor(1.05)
  r.setPose({ lon, lat, dist, roll, pitch })
  return r
}
const heading = (r: CameraRig, t = NOW): number => r.headingDeg(e, aspect, t)

// 1. Forward keeps the distance from the centre (the altitude) and the heading, and moves toward where the top of the screen points.
for (const [dist, pitch, roll] of [[1.3, 0, 0], [1.3, 40, 25], [2, 0, -70], [4, 0, 140]] as const) {
  const r = rigAt(dist, 20, 30, roll, pitch)
  if (pitch) r.tilt(0.0001, 800, NOW) // the visitor's own tilt
  const cam0 = r.camera(e, aspect, NOW)
  const fwd = forwardTangent(cam0)
  for (let i = 0; i < 20; i++) r.moveForward(14, 800, e, aspect, NOW + i)
  const cam1 = r.camera(e, aspect, NOW + 100)
  near(cam1.pos.length(), cam0.pos.length(), 1e-9, `dist ${dist}: altitude is kept`)
  // The camera turned rigidly with the surface it flew over, so it is still heading the way it moves (a compass reading drifts with the
  // convergence of the meridians along any great circle that is not the equator or a meridian, as on Earth).
  const last = r.camera(e, aspect, NOW + 100).pos.clone()
  r.moveForward(2, 800, e, aspect, NOW + 101)
  const stepEnd = r.camera(e, aspect, NOW + 102).pos.clone().sub(last).normalize()
  assert.ok(stepEnd.dot(forwardTangent(r.camera(e, aspect, NOW + 102))) > 0.999, `dist ${dist}: still flying the way the screen top points`)
  const step = cam1.pos.clone().sub(cam0.pos).normalize()
  assert.ok(step.dot(fwd) > 0.9, `dist ${dist}: moved along the forward tangent (${step.dot(fwd)})`)
  // Back undoes forward.
  r.moveForward(-2, 800, e, aspect, NOW + 199)
  for (let i = 0; i < 20; i++) r.moveForward(-14, 800, e, aspect, NOW + 200 + i)
  const cam2 = r.camera(e, aspect, NOW + 300)
  assert.ok(cam2.pos.distanceTo(cam0.pos) < 1e-6 * Math.max(1, dist), `dist ${dist}: back returns (${cam2.pos.distanceTo(cam0.pos)})`)
}

// 1b. Forward over a pole keeps going (no snap) and a sidestep is perpendicular to forward.
{
  const r = rigAt(1.5, 80, 0, 0, 0)
  const start = r.camera(e, aspect, NOW).pos.clone()
  for (let i = 0; i < 400; i++) r.moveForward(14, 800, e, aspect, NOW + i)
  assert.ok(r.camera(e, aspect, NOW + 500).pos.distanceTo(start) > 0.3, 'flew a good way')
  assert.ok(Number.isFinite(heading(r, NOW + 500)), 'finite heading over the pole')
  // Due north from the equator keeps the compass at exactly 0, due east along it at 90.
  const m = rigAt(1.5, 0, 0, 0, 0)
  for (let i = 0; i < 50; i++) m.moveForward(14, 800, e, aspect, NOW + i)
  near(heading(m, NOW + 60), 0, 1e-6, 'a meridian flight keeps north up')
  const q = rigAt(1.5, 0, 0, -90, 0)
  near(wrapHeading(heading(q)), 90, 1e-6, 'roll -90 reads east')
  for (let i = 0; i < 50; i++) q.moveForward(14, 800, e, aspect, NOW + i)
  near(wrapHeading(heading(q, NOW + 60)), 90, 1e-6, 'an equator flight keeps its heading')
  near(q.camera(e, aspect, NOW + 60).pos.length(), q.camera(e, aspect, NOW).pos.length(), 1e-12, 'and its altitude')
  const s = rigAt(2, 10, 10)
  const c0 = s.camera(e, aspect, NOW)
  s.moveSideways(14, 800, e, aspect, NOW)
  const d = s.camera(e, aspect, NOW + 1).pos.clone().sub(c0.pos).normalize()
  assert.ok(Math.abs(d.dot(forwardTangent(c0))) < 0.05, 'a sidestep is not forward')
  assert.ok(d.dot(c0.right) > 0.9, 'positive sidestep goes to the screen right')
}

// 2. Tilt works at every distance, within a limit that shrinks toward the Moon's limb and keeps it in view; it is not a script's pitch.
{
  assert.equal(tiltLimitDeg(1.2, PITCH_MAX, 30, reliefShare(1.2)), PITCH_MAX, 'near the surface the full limit')
  let prev = Infinity
  for (const d of [1.5, 1.8, 2, 2.2, 2.4, 3, 6, 12]) {
    const lim = tiltLimitDeg(d, PITCH_MAX, 30, reliefShare(d))
    assert.ok(lim > 0 && lim <= PITCH_MAX + 1e-9, `limit at ${d}: ${lim}`)
    assert.ok(lim <= prev + 1e-9, `limit shrinks with distance (${d}: ${lim} after ${prev})`)
    prev = lim
  }
  for (const d of [2.6, 4, 6, 9, 12]) {
    const r = rigAt(d)
    r.tilt(1e6, 800, NOW)
    near(r.pose.pitch ?? 0, r.tiltLimit(), 1e-9, `tilt at ${d} stops at the limit`)
    assert.ok((r.pose.pitch ?? 0) > 3, `tilt at ${d} is felt`)
    // The Moon's centre is still in the frame (|ndc| < 1 both ways) at the limit.
    const cam = r.camera(e, aspect, NOW)
    const toCentre = cam.pos.clone().negate().normalize()
    const z = toCentre.dot(cam.back.clone().negate())
    const ndcY = toCentre.dot(cam.up) / z / cam.tanHalf
    const ndcX = toCentre.dot(cam.right) / z / (cam.tanHalf * aspect)
    assert.ok(z > 0 && Math.abs(ndcY) < 1 && Math.abs(ndcX) < 1, `the Moon stays in view at ${d}: ${ndcX}, ${ndcY}`)
    assert.ok(sizeRatio(d, cam.tanHalf) > 0)
    r.tilt(-1e6, 800, NOW + 1)
    assert.equal(r.pose.pitch, 0, 'tilting back reaches straight down')
    assert.equal(r.effectivePitch(), 0)
  }
  // Tilting in orbit really leaves straight-down: the view axis turns away from the Moon's centre.
  const o = rigAt(6)
  const flat = o.camera(e, aspect, NOW)
  o.tilt(60, 800, NOW)
  const tilted = o.camera(e, aspect, NOW)
  assert.ok(flat.back.dot(tilted.back) < 0.9999, 'the camera tilted in orbit')
  assert.ok(tilted.pos.distanceTo(flat.pos) < 1e-12, 'the position did not move')
  // Zooming in from orbit keeps the visitor's tilt (within the limit); a scripted pitch far out still shows nothing.
  const scripted = rigAt(6, 20, 30, 0, 40)
  assert.equal(scripted.effectivePitch(), 0, 'a scripted pitch far out is not felt')
}

// 3. Auto-level does not run while tilted (the roll is the heading then).
{
  const r = rigAt(6)
  r.tilt(60, 800, NOW)
  assert.ok(r.effectivePitch() >= 1, 'tilted enough')
  r.pose.roll = 40
  r.spin(10, 0, 800, e, aspect, NOW + 1)
  r.release(NOW + 200)
  let moved = false
  for (let t = NOW + 300; t < NOW + 2500; t += 16) if (r.step(t, 0.016) && r.levelling()) moved = true
  assert.ok(!moved, 'no levelling while tilted')
}

// 4. Heading: it reads, turns, and resets to north.
{
  const r = rigAt(2, 20, 30, 0, 0)
  near(heading(r), 0, 1e-6, 'north up reads 0')
  r.turnHeading(90, NOW)
  near(wrapHeading(heading(r)), 90, 1e-6, 'turning the picture counter-clockwise by 90 reads east at the top')
  // The position does not move when the heading turns.
  const p0 = r.camera(e, aspect, NOW).pos.clone()
  r.turnHeading(33, NOW)
  assert.ok(r.camera(e, aspect, NOW).pos.distanceTo(p0) < 1e-12)
  // Reset north: eased, ends at 0 from either side.
  for (const start of [120, -75, 179]) {
    const q = rigAt(3, 15, -20, 0, 0)
    q.turnHeading(start, NOW)
    q.resetNorth(e, aspect, NOW)
    let last = Math.abs(wrapHeading(heading(q)))
    for (let t = NOW + 16; t < NOW + 1200; t += 16) {
      q.step(t, 0.016)
      const h = Math.abs(wrapHeading(heading(q, t)))
      assert.ok(h <= last + 1e-6, 'monotone approach to north')
      last = h
    }
    near(heading(q, NOW + 1200), 0, 1e-3, `reset from ${start}`)
  }
  // A tilted view resets its heading too, and keeps its tilt.
  const t = rigAt(1.3, 0, 0, 50, 0)
  t.tilt(150, 800, NOW)
  const tilt0 = t.pose.pitch
  t.resetNorth(e, aspect, NOW)
  for (let k = NOW + 16; k < NOW + 1200; k += 16) t.step(k, 0.016)
  near(heading(t, NOW + 1200), 0, 1e-3, 'tilted view reset')
  assert.equal(t.pose.pitch, tilt0)
  // The settled (free orientation) camera turns about the vertical too.
  const f = rigAt(2, 10, 10)
  f.settle(e, aspect, NOW, f.camera(e, aspect, NOW))
  const hs = heading(f)
  f.turnHeading(40, NOW + 1)
  near(wrapHeading(heading(f, NOW + 1) - hs), 40, 1e-4, 'settled heading turn')
}

// 4b. Joystick right yaws the view right (the heading grows) and left yaws it left, at every tilt, roll and latitude.
for (const lat of [0, 80, -80]) for (const pitch of [0, 45, 90]) for (const roll of [0, 90, 180]) {
  for (const [push, sign] of [[1, 1], [-1, -1]] as const) {
    const r = rigAt(1.3, lat, 30, roll, pitch)
    const h0 = heading(r)
    r.turnHeading(stickMotion('turn', push, 0.05, 800, 30).rollDeg, NOW)
    const d = wrapHeading(heading(r) - h0)
    assert.ok(d * sign > 0.01, `stick ${push > 0 ? 'right' : 'left'} at lat ${lat} pitch ${pitch} roll ${roll} turned the heading by ${d}`)
  }
}

// 6. The viewHeading of a plain camera over the pole is finite.
{
  const r = rigAt(2, 89, 0)
  assert.ok(Number.isFinite(viewHeadingDeg(r.camera(e, aspect, NOW), new Vector3(0, 0, 1))))
  assert.ok(Number.isFinite(homePose(e).roll))
}
console.log('fly-camera: ok')
