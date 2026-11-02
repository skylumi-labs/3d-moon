/**
 * Touch controls (owner's Pixel session 7 Oct 2026): zoom-out keeps the Moon in the frame, a swipe goes the way the finger
 * goes after a journey left a free orientation, a drag on the Moon holds the point under the finger, a twist rolls the view.
 */
import assert from 'node:assert/strict'
import { Quaternion, Vector3 } from 'three'
import { CameraRig } from '../src/camera/rig.ts'
import { angularDistance, D_MAX, homePose, pickSphere, type ViewCamera } from '../src/camera/pose.ts'
import { newTwistState, recentreRotation, spinRotation, twistDeg, twistStep } from '../src/camera/grab.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { TILT_CLICK_UNITS, TILT_HOLD_UNITS_PER_S, EasedButton, axisUnits, sideControlStep } from '../src/ui/touchControlsLogic.ts'

const e = ephemerisAt(new Date('2026-10-20T22:34:00Z'))
const aspect = 0.5
const NOW = 1000
const near = (a: number, b: number, tol: number, msg: string): void => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`)
const ndcOf = (cam: ViewCamera, P: Vector3): { x: number; y: number } | null => {
  const d = P.clone().sub(cam.pos)
  const z = -d.dot(cam.back)
  if (z <= 0) return null
  return { x: d.dot(cam.right) / z / (cam.tanHalf * aspect), y: d.dot(cam.up) / z / cam.tanHalf }
}
/** A rig whose free orientation is turned away from the Moon, as after a grabbed journey (settle). */
const freed = (yawDeg: number, rollDeg = 0): CameraRig => {
  const r = new CameraRig()
  r.setPose({ ...homePose(e), dist: 2 })
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yawDeg * Math.PI / 180)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rollDeg * Math.PI / 180))
  r.setFreeOrientation([q.x, q.y, q.z, q.w])
  r.settle(e, aspect, NOW, r.camera(e, aspect, NOW))
  return r
}

// 1. Zoom out from a free orientation stops at D_MAX and the Moon stays in the frame.
{
  const r = freed(14)
  for (let i = 0; i < 80; i++) r.zoomCentre(1.15, e, aspect, NOW + i)
  assert.ok(r.pose.dist <= D_MAX + 1e-9, `distance ${r.pose.dist} past D_MAX`)
  const c = ndcOf(r.camera(e, aspect, NOW + 100), new Vector3())
  assert.ok(c && Math.abs(c.x) < 0.6 && Math.abs(c.y) < 0.6, `Moon centre left the frame: ${JSON.stringify(c)}`)
}

// 2. A swipe moves the picture the way the finger moves, with a free orientation rolled 0/90/180 deg (the old pose-axes drag ran sideways).
for (const roll of [0, 90, 180]) {
  const r = freed(0, roll)
  r.pose.dist = 3
  const cam0 = r.camera(e, aspect, NOW)
  const P = pickSphere(cam0, 0, 0, aspect)!
  const before = ndcOf(cam0, P)!
  r.spin(40, 0, 400, e, aspect, NOW + 16)
  const after = ndcOf(r.camera(e, aspect, NOW + 16), P)!
  assert.ok(after.x > before.x + 1e-3 && Math.abs(after.y - before.y) < 2e-3 * 5, `roll ${roll}: finger right moved the Moon by (${after.x - before.x}, ${after.y - before.y})`)
  const r2 = freed(0, roll)
  r2.pose.dist = 3
  r2.spin(0, 40, 400, e, aspect, NOW + 16)
  const a2 = ndcOf(r2.camera(e, aspect, NOW + 16), pickSphere(cam0, 0, 0, aspect)!)!
  assert.ok(a2.y < -1e-3 && Math.abs(a2.x) < 1e-2, `roll ${roll}: finger down moved the Moon by (${a2.x}, ${a2.y})`)
}

// 3. Grab: the point under the finger stays under the finger, over a long drag.
{
  const r = new CameraRig()
  r.setPose({ ...homePose(e), dist: 4 })
  let from = { nx: -0.1, ny: 0.1 }
  const P = r.pickMoon(from.nx, from.ny, e, aspect, NOW)!
  for (let i = 1; i <= 20; i++) {
    const to = { nx: -0.1 + i * 0.015, ny: 0.1 - i * 0.01 }
    assert.ok(r.grab(from, to, e, aspect, NOW + i * 16))
    from = to
  }
  const at = ndcOf(r.camera(e, aspect, NOW + 400), P)!
  assert.ok(Math.hypot(at.x - from.nx, at.y - from.ny) < 5e-3, `grabbed point drifted to (${at.x}, ${at.y}) vs (${from.nx}, ${from.ny})`)
  // Off the disc there is nothing to grab.
  assert.equal(r.grab({ nx: 0, ny: 0 }, { nx: 0.99, ny: 0.99 }, e, aspect, NOW + 500), false)
}

// 3b. Grab after rig.settle() (free orientation, rolled 90): the point stays under the finger.
{
  const r = freed(0, 90)
  r.pose.dist = 4
  let from = { nx: -0.1, ny: 0.1 }
  const P = r.pickMoon(from.nx, from.ny, e, aspect, NOW)!
  for (let i = 1; i <= 20; i++) {
    const to = { nx: -0.1 + i * 0.012, ny: 0.1 - i * 0.008 }
    assert.ok(r.grab(from, to, e, aspect, NOW + i * 16))
    from = to
  }
  const at = ndcOf(r.camera(e, aspect, NOW + 400), P)!
  assert.ok(Math.hypot(at.x - from.nx, at.y - from.ny) < 5e-3, `settled grab drifted to (${at.x}, ${at.y}) vs (${from.nx}, ${from.ny})`)
}

// 3c. A coalesced swipe near the far-view limb is bounded; ordinary point-lock above stays exact.
{
  const r = new CameraRig()
  r.setPose({ ...homePose(e), dist: 12 })
  const before = r.camera(e, aspect, NOW)
  assert.ok(r.pickMoon(0.25, 0, e, aspect, NOW) && r.pickMoon(0.3, 0, e, aspect, NOW), 'both samples hit near the visible limb')
  assert.equal(r.grab({ nx: 0.25, ny: 0 }, { nx: 0.3, ny: 0 }, e, aspect, NOW + 16), true)
  const after = r.camera(e, aspect, NOW + 16)
  const angle = Math.acos(Math.max(-1, Math.min(1, before.back.dot(after.back)))) * 180 / Math.PI
  assert.ok(angle <= 8.001, `one coalesced near-limb sample is limited to 8 deg, got ${angle}`)
}

// 4. Twist: a point right of centre follows the fingers' counter-clockwise turn (it ends up above where it was).
{
  const r = new CameraRig()
  r.setPose({ ...homePose(e), dist: 4 })
  const P = r.pickMoon(0.2, 0, e, aspect, NOW)!
  const deg = twistDeg({ x: 100, y: 200 }, { x: 200, y: 200 }, { x: 100, y: 200 }, { x: 200, y: 180 })
  assert.ok(deg > 5, 'a counter-clockwise turn is positive')
  r.twist(deg, e, aspect, NOW + 16)
  const cam = r.camera(e, aspect, NOW + 16)
  const c = ndcOf(cam, P)!
  assert.ok(c.y > 0.01, `the point should rise with a counter-clockwise twist, got y ${c.y}`)
}
// 4b. The same after rig.settle() (free orientation, rolled 30 deg away from the base): 90 deg of twist turns the picture 90 about the screen centre.
for (const roll of [0, 30]) {
  const r = freed(8, roll)
  r.pose.dist = 4
  const cam0 = r.camera(e, aspect, NOW)
  const P = pickSphere(cam0, 0.2, 0, aspect)!
  r.twist(90, e, aspect, NOW + 16)
  const c = ndcOf(r.camera(e, aspect, NOW + 16), P)!
  // Frame spots are in half-heights/widths; compare as angle about the middle in a square frame (aspect-corrected).
  const ang = Math.atan2(c.y / 1, (c.x * aspect) / 1) * 180 / Math.PI
  near(ang, 90, 5, `settled twist, offset roll ${roll}`)
}
// 4c. Latching: a pinching hand's jitter (+-1.5 deg per step with a 3 % spread change) never rolls the view; a real twist rolls the full angle once latched.
{
  const st = newTwistState()
  let total = 0
  for (let i = 0; i < 60; i++) total += twistStep(st, i % 2 ? 1.5 : -0.5, 1.03)
  assert.equal(total, 0)
  const st2 = newTwistState()
  let t2 = 0
  for (let i = 0; i < 30; i++) t2 += twistStep(st2, 3, 1.002)
  near(t2, 90, 1e-9, 'a latched twist follows the whole 90 deg')
  const st3 = newTwistState()
  let t3 = 0
  for (let i = 0; i < 30; i++) t3 += twistStep(st3, 0.4, 1.0)
  assert.ok(t3 > 11, 'a slow steady twist latches once it has built up')
}
// A half turn the short way round the +-180 seam: the angle stays within (-180, 180] and is not a whole lap.
{
  const d = twistDeg({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: -100, y: 1 })
  assert.ok(Math.abs(d) <= 180 && Math.abs(Math.abs(d) - 180) < 1, `wraps to the short way: ${d}`)
}

// 5. Pure helpers.
{
  const cam: ViewCamera = { pos: new Vector3(0, 0, 5), right: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0), back: new Vector3(0, 0, 1), tanHalf: 0.27 }
  assert.equal(recentreRotation(cam, 0.5), null)
  const away: ViewCamera = { ...cam, back: new Vector3(Math.sin(1), 0, Math.cos(1)), right: new Vector3(Math.cos(1), 0, -Math.sin(1)) }
  assert.ok(recentreRotation(away, 0.5)!.angle > 0.5)
  assert.equal(spinRotation(cam, 0, 0, 0.01), null)
}

// 6. Recentre is rate-limited per zoom step, and decided once per gesture.
{
  // A settled view pitched 60 deg away from the Moon, close in (a landing view): one 2 % pinch-out turns it by a few degrees, not tens.
  const r = freed(0)
  r.pose.dist = 1.02
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 40 * Math.PI / 180)
  r.setFreeOrientation([q.x, q.y, q.z, q.w])
  r.settle(e, aspect, NOW, r.camera(e, aspect, NOW))
  const before = r.camera(e, aspect, NOW)
  r.zoomCentre(1.02, e, aspect, NOW + 1)
  const after = r.camera(e, aspect, NOW + 1)
  const turned = Math.acos(Math.max(-1, Math.min(1, before.back.dot(after.back)))) * 180 / Math.PI
  assert.ok(turned < 3.5, `one 2 % step turned the view by ${turned} deg`)
  // Look at Earth (centre far outside the frame) then a touch settled it: a pinch-out leaves the view alone.
  const away = freed(0)
  away.pose.dist = 2
  const q2 = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 172 * Math.PI / 180)
  away.setFreeOrientation([q2.x, q2.y, q2.z, q2.w])
  away.settle(e, aspect, NOW, away.camera(e, aspect, NOW))
  const b2 = away.camera(e, aspect, NOW)
  for (let i = 0; i < 20; i++) away.zoomCentre(1.02, e, aspect, NOW + 1 + i)
  const a2 = away.camera(e, aspect, NOW + 30)
  const t2 = Math.acos(Math.max(-1, Math.min(1, b2.back.dot(a2.back)))) * 180 / Math.PI
  assert.ok(t2 < 1, `a look away was recentred by ${t2} deg`)
}

// 7. The settled item-8 state: a free orientation with the Moon off-axis and rolled; a swipe moves a picked DISC point with the finger.
{
  const r = freed(10, 60)
  r.pose.dist = 3
  const cam0 = r.camera(e, aspect, NOW)
  const centre = ndcOf(cam0, new Vector3())!
  assert.ok(Math.hypot(centre.x, centre.y) > 0.01, 'the Moon centre is off-axis in this case')
  const P = pickSphere(cam0, -0.3, 0, aspect)!
  const before = ndcOf(cam0, P)!
  r.spin(40, 0, 400, e, aspect, NOW + 16)
  const after = ndcOf(r.camera(e, aspect, NOW + 16), P)!
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 1e-3, 'the swipe moved the disc point')
  // Roll 60 turns the screen right to a mix of the free frame's axes; the point must go with the finger (right), not sideways.
  assert.ok(after.x - before.x > 1e-3, `finger right moved the point by (${after.x - before.x}, ${after.y - before.y})`)
}

// 8. Past the far limit (settled from farther out), a pinch-out never snaps in, and a pinch-in acts from where it is.
{
  const r = freed(0)
  r.pose.dist = 16
  r.zoom(1.02, NOW)
  assert.ok(r.pose.dist >= 16 - 1e-9, `pinch-out from 16 moved to ${r.pose.dist}`)
  r.zoom(0.98, NOW + 1)
  assert.ok(r.pose.dist < 16 && r.pose.dist > 15, `pinch-in from 16 moved to ${r.pose.dist}`)
}

// Side controls must move the actual camera in the direction shown by their icons.
{
  const r = new CameraRig()
  r.setFloor(1)
  r.setPose({ ...homePose(e), dist: 1.5, pitch: 10, roll: 0 })
  const point = r.pickMoon(0.2, 0, e, aspect, NOW)!
  const before = ndcOf(r.camera(e, aspect, NOW), point)!
  const ccw = sideControlStep('counterclockwise', 400, 30)
  r.twist(ccw.rollDeg, e, aspect, NOW + 16)
  const after = ndcOf(r.camera(e, aspect, NOW + 16), point)!
  assert.ok(after.y > before.y, `counter-clockwise button should rotate the landmark upward: ${before.y} -> ${after.y}`)
  const cwRig = new CameraRig()
  cwRig.setFloor(1)
  cwRig.setPose({ ...homePose(e), dist: 1.5, pitch: 10, roll: 0 })
  const cwPoint = cwRig.pickMoon(0.2, 0, e, aspect, NOW)!
  const beforeCw = ndcOf(cwRig.camera(e, aspect, NOW), cwPoint)!
  const cw = sideControlStep('clockwise', 400, 30)
  cwRig.twist(cw.rollDeg, e, aspect, NOW + 16)
  const afterCw = ndcOf(cwRig.camera(e, aspect, NOW + 16), cwPoint)!
  assert.ok(afterCw.y < beforeCw.y, `clockwise button should rotate the landmark downward: ${beforeCw.y} -> ${afterCw.y}`)

  const rightRig = new CameraRig()
  rightRig.setFloor(1)
  rightRig.setPose({ ...homePose(e), dist: 1.5, pitch: 10, roll: 0 })
  const rightPoint = rightRig.pickMoon(0.2, 0, e, aspect, NOW)!
  const beforeRight = ndcOf(rightRig.camera(e, aspect, NOW), rightPoint)!
  rightRig.spin(20, 0, 400, e, aspect, NOW + 16)
  const afterRight = ndcOf(rightRig.camera(e, aspect, NOW + 16), rightPoint)!
  assert.ok(afterRight.x > beforeRight.x, `right arrow should move the landmark right: ${beforeRight.x} -> ${afterRight.x}`)
  const leftRig = new CameraRig()
  leftRig.setFloor(1)
  leftRig.setPose({ ...homePose(e), dist: 1.5, pitch: 10, roll: 0 })
  const leftPoint = leftRig.pickMoon(0.2, 0, e, aspect, NOW)!
  const beforeLeft = ndcOf(leftRig.camera(e, aspect, NOW), leftPoint)!
  leftRig.spin(-20, 0, 400, e, aspect, NOW + 16)
  const afterLeft = ndcOf(leftRig.camera(e, aspect, NOW + 16), leftPoint)!
  assert.ok(afterLeft.x < beforeLeft.x, `left arrow should move the landmark left: ${beforeLeft.x} -> ${afterLeft.x}`)

  const up = sideControlStep('up', 400, 30)
  const down = sideControlStep('down', 400, 30)
  const pitch0 = r.pose.pitch ?? 0
  const beforeUp = ndcOf(r.camera(e, aspect, NOW + 16), point)!
  r.tilt(up.tiltPx, 400, NOW + 32)
  assert.ok((r.pose.pitch ?? 0) > pitch0, 'tilt-up increases pitch toward the horizon')
  const afterUp = ndcOf(r.camera(e, aspect, NOW + 32), point)!
  assert.ok(afterUp.y < beforeUp.y, `tilt-up (toward the horizon) moves the landmark down the frame: ${beforeUp.y} -> ${afterUp.y}`)
  const pitchUp = r.pose.pitch ?? 0
  r.tilt(down.tiltPx, 400, NOW + 48)
  assert.ok((r.pose.pitch ?? 0) < pitchUp, 'tilt-down moves pitch opposite tilt-up')
  const afterDown = ndcOf(r.camera(e, aspect, NOW + 48), point)!
  assert.ok(afterDown.y > afterUp.y, `tilt-down moves the landmark back up: ${afterUp.y} -> ${afterDown.y}`)
}

// 9. A steep view zooms toward its centre (dolly.ts): the ground point at the middle of the screen stays there, the camera moves along the ray.
{
  const r = new CameraRig()
  r.setFloor(1)
  r.setPose({ lon: -62.28473, lat: 60.20232, dist: 1.3, pitch: 40, roll: 0 })
  const reportEphemeris = ephemerisAt(new Date('2026-10-08T03:07:16Z'))
  const centreOf = (): { x: number; y: number; z: number } => {
    const hit = pickSphere(r.camera(reportEphemeris, 0.45, NOW + 1), 0, 0, 0.45)!
    return { x: hit.x, y: hit.y, z: hit.z }
  }
  const before = centreOf()
  r.zoomCentre(1.02, reportEphemeris, 0.45, NOW + 1)
  const after = centreOf()
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z) < 1e-6, 'the centre target stays put')
}

// 10. The reported 2026-10-08 high-pitch drag has bounded coast after release, even when each pointer sample is fast.
{
  const r = new CameraRig()
  r.setFloor(1)
  r.setPose({ lon: -62.28473, lat: 60.20232, dist: 1.062757, pitch: 58.01, roll: 0 })
  const reportEphemeris = ephemerisAt(new Date('2026-10-08T03:07:16Z'))
  const wide = 1280 / 720
  const from = { nx: 2 * 670 / 1280 - 1, ny: 1 - 2 * 430 / 720 }
  const to = { nx: 2 * 880 / 1280 - 1, ny: 1 - 2 * 140 / 720 }
  let prev = from
  for (let i = 1; i <= 10; i++) {
    const at = { nx: from.nx + (to.nx - from.nx) * i / 10, ny: from.ny + (to.ny - from.ny) * i / 10 }
    assert.ok(r.grab(prev, at, reportEphemeris, wide, NOW + i * 16), `sample ${i} remains a surface grab`)
    prev = at
  }
  const released = { ...r.pose }
  r.release(NOW + 10 * 16 + 16)
  for (let t = NOW + 10 * 16 + 32; t < NOW + 1800; t += 16) r.step(t, 0.016)
  const coast = angularDistance(released.lon, released.lat, r.pose.lon, r.pose.lat)
  const visibleField = r.fovDeg * (released.dist - 1 - r.groundAt(released.lon, released.lat)) * Math.PI / 180
  assert.ok(coast < visibleField * 0.55,
    `release coast was ${coast * 180 / Math.PI} deg in a ${visibleField * 180 / Math.PI} deg surface field`)
}

// 12. The tilt pair (owner review 2026-10-23, #11): one press of Look up tilts the rig by one frame step toward the horizon, Look down the opposite, through the
// same axisUnits the stick uses; the rig clamps at its own limit; a held half runs at TILT_HOLD_UNITS_PER_S steps a second after the hold delay.
{
  const r = new CameraRig()
  r.setFloor(1)
  r.setPose({ lon: 20, lat: 10, dist: 1.3, pitch: 0, roll: 0 })
  const shortCss = 800, fov = r.fovDeg
  const up = axisUnits('tilt', TILT_CLICK_UNITS, shortCss, fov)
  assert.ok(up.tiltPx > 0 && up.rollDeg === 0 && up.movePx === 0, 'Look up is a tilt and nothing else')
  r.tilt(up.tiltPx, shortCss, NOW)
  near(r.pose.pitch ?? 0, 0.15 * fov, 1e-9, 'one press tilts by FRAME_STEP_FRACTION of the view')
  r.tilt(axisUnits('tilt', -TILT_CLICK_UNITS, shortCss, fov).tiltPx, shortCss, NOW + 16)
  near(r.pose.pitch ?? 0, 0, 1e-9, 'Look down undoes it')
  r.tilt(axisUnits('tilt', -TILT_CLICK_UNITS, shortCss, fov).tiltPx, shortCss, NOW + 32)
  assert.equal(r.pose.pitch ?? 0, 0, 'and never below straight down')
  for (let i = 0; i < 200; i++) r.tilt(up.tiltPx, shortCss, NOW + 48 + i)
  assert.ok((r.pose.pitch ?? 0) <= r.tiltLimit() + 1e-9, `held, the tilt stops at the rig's limit (${r.pose.pitch} <= ${r.tiltLimit()})`)
  const held = new EasedButton()
  held.press(TILT_CLICK_UNITS)
  let total = 0
  for (let i = 0; i < 60; i++) total += held.tick(1 / 60, TILT_HOLD_UNITS_PER_S)
  assert.ok(total > TILT_CLICK_UNITS + 0.5 * TILT_HOLD_UNITS_PER_S && total < TILT_CLICK_UNITS + TILT_HOLD_UNITS_PER_S, `one second held gives ${total} steps`)
}

// 11. Near a pole, zooming a settled orientation leaves the pose where it was (no longitude flip).
{
  const r = new CameraRig()
  r.setFloor(1)
  r.setPose({ lon: 120, lat: 88.7, dist: 1.8, pitch: 0, roll: 0 })
  r.setFreeOrientation([0, 0, 0, 1])
  const reportEphemeris = ephemerisAt(new Date('2026-10-08T03:07:16Z'))
  r.zoomCentre(1.02, reportEphemeris, 0.65, NOW + 1)
  assert.ok(Math.abs(r.pose.lat - 88.7) < 1e-9 && Math.abs(r.pose.lon - 120) < 1e-9, `near-pole zoom moved the pose to ${r.pose.lon}, ${r.pose.lat}`)
}
console.log('touch-controls: ok')
