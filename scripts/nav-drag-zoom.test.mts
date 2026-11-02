/**
 * Owner review of rc-v1.3 (10 Oct 2026): "the Moon turns as I zoom in", "I drag to the side and it turns ... it should just go
 * straight", "it shouldn't wiggle", suspecting the pole. Pure camera maths: a zoom changes only the distance, and a drag on the
 * Moon slides the picture under the finger without twisting it about the line of sight, at any latitude and across either pole.
 */
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { CameraRig } from '../src/camera/rig.ts'
import { pickSphere, type ViewCamera } from '../src/camera/pose.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { EasedButton, BUTTON_LABELS, ZOOM_CLICK_OCTAVES } from '../src/ui/touchControlsLogic.ts'

const e = ephemerisAt(new Date('2026-10-20T22:34:00Z'))
const aspect = 1440 / 900
const D = 180 / Math.PI
const angleDeg = (a: Vector3, b: Vector3): number => Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) * D

const project = (cam: ViewCamera, P: Vector3): { x: number; y: number } => {
  const d = P.clone().sub(cam.pos), z = -d.dot(cam.back)
  return { x: d.dot(cam.right) / (z * cam.tanHalf * aspect), y: d.dot(cam.up) / (z * cam.tanHalf) }
}
/** On-screen angle (deg) of the line between two fixed surface points: it changes only if the picture twists. */
const lineAngle = (cam: ViewCamera, A: Vector3, B: Vector3): number => {
  const a = project(cam, A), b = project(cam, B)
  return Math.atan2(b.y - a.y, (b.x - a.x) * aspect) * D
}
const wrap = (d: number): number => ((d + 540) % 360) - 180
/** Heading: where lunar north points on screen, degrees from screen-up. */
const heading = (cam: ViewCamera): number => {
  const N = e.moonZ.clone()
  N.addScaledVector(cam.back, -N.dot(cam.back))
  return Math.atan2(N.dot(cam.right), N.dot(cam.up)) * D
}
const rigAt = (lat: number, roll = 0, dist = 3): CameraRig => {
  const r = new CameraRig()
  r.setFloor(1.05)
  r.setPose({ lon: 20, lat, dist, roll })
  return r
}

// 1. A zoom step changes the distance and nothing else: longitude, latitude, roll, camera-up and heading are exactly as they were.
for (const lat of [0, 45, 70, 85, -80]) for (const roll of [0, 37, -120]) {
  const r = rigAt(lat, roll)
  const before = { ...r.pose }
  const camBefore = r.camera(e, aspect, 0)
  const h0 = heading(camBefore)
  for (let i = 1; i <= 20; i++) {
    r.zoomCentre(i < 12 ? 0.92 : 1.08, e, aspect, i * 16)
    const cam = r.camera(e, aspect, i * 16)
    assert.ok(Math.abs(wrap(heading(cam) - h0)) < 1e-9, `lat ${lat} roll ${roll} step ${i}: heading changed`)
    assert.ok(cam.up.distanceTo(camBefore.up) < 1e-9, `lat ${lat} roll ${roll} step ${i}: camera-up changed`)
  }
  assert.equal(r.pose.lon, before.lon)
  assert.equal(r.pose.lat, before.lat)
  assert.equal(r.pose.roll, before.roll)
  assert.notEqual(r.pose.dist, before.dist, 'the distance did change')
}

// 2. Zoom keeps the centre of the view where it is: the surface point under the screen centre is the same before and after.
{
  const r = rigAt(65)
  const P = pickSphere(r.camera(e, aspect, 0), 0, 0, aspect)!
  for (let i = 1; i <= 15; i++) r.zoomCentre(0.9, e, aspect, i * 16)
  const c = project(r.camera(e, aspect, 300), P)
  assert.ok(Math.hypot(c.x, c.y) < 1e-9, `the centre point drifted to (${c.x}, ${c.y})`)
}

// 3. A horizontal drag on the Moon does not twist the picture, from the equator to the pole (the old lon/lat solver twisted it by
// sin(latitude) times the longitude moved: 38 deg at 60, 69 deg at 70 over a 12-step drag), and it moves the surface along the
// screen's horizontal, to the right when the finger goes right.
for (const lat of [0, 30, 60, 70, 80, 88, -75]) for (const roll of [0, 90, -150]) {
  const r = rigAt(lat, roll)
  const cam0 = r.camera(e, aspect, 0)
  const A = pickSphere(cam0, -0.12, 0, aspect)!, B = pickSphere(cam0, 0.12, 0, aspect)!
  const C = pickSphere(cam0, 0, 0, aspect)!
  const a0 = lineAngle(cam0, A, B)
  let x = 0
  for (let i = 1; i <= 24; i++) {
    const prev = x
    x += 0.025
    assert.ok(r.grab({ nx: prev, ny: 0 }, { nx: x, ny: 0 }, e, aspect, i * 16), `lat ${lat} roll ${roll} step ${i}: the grab holds`)
    const cam = r.camera(e, aspect, i * 16)
    assert.ok(Math.abs(wrap(lineAngle(cam, A, B) - a0)) < 0.2, `lat ${lat} roll ${roll} step ${i}: the picture twisted ${wrap(lineAngle(cam, A, B) - a0)} deg`)
    const c = project(cam, C)
    assert.ok(Math.abs(c.y) < 0.02, `lat ${lat} roll ${roll} step ${i}: the surface left the horizontal by ${c.y}`)
    assert.ok(c.x > 0, 'the centre point followed the finger to the right')
  }
}

// 4. The same for a vertical drag, and for the sky-drag path (spin).
for (const lat of [0, 60, 80, -80]) {
  for (const mode of ['grab', 'spin'] as const) {
    const r = rigAt(lat)
    const cam0 = r.camera(e, aspect, 0)
    const A = pickSphere(cam0, 0, -0.12, aspect)!, B = pickSphere(cam0, 0, 0.12, aspect)!
    const a0 = lineAngle(cam0, A, B)
    let y = 0
    for (let i = 1; i <= 24; i++) {
      const prev = y
      y += 0.025
      if (mode === 'grab') r.grab({ nx: 0, ny: prev }, { nx: 0, ny: y }, e, aspect, i * 16)
      else r.spin(0, -(y - prev) / 2 * 900, 900, e, aspect, i * 16)
      assert.ok(Math.abs(wrap(lineAngle(r.camera(e, aspect, i * 16), A, B) - a0)) < 0.5, `${mode} lat ${lat} step ${i}: vertical drag twisted the picture`)
    }
  }
}

// 5. Across the pole: a long drag straight over it keeps the camera's up direction continuous (no 180 deg flip, no wiggle) and
// the picture untwisted, whichever way the starting roll points.
for (const lat of [80, 87, -84]) for (const roll of [0, 60, 200 - 360]) {
  const r = rigAt(lat, roll)
  const cam0 = r.camera(e, aspect, 0)
  const N0 = e.moonZ.clone()
  N0.addScaledVector(cam0.back, -N0.dot(cam0.back)).normalize()
  const sgn = lat > 0 ? -1 : 1
  const vx = N0.dot(cam0.right) * sgn, vy = N0.dot(cam0.up) * sgn
  let prevUp = cam0.up.clone()
  let prevCam = cam0
  let maxLat = Math.abs(r.pose.lat)
  let crossed = false
  let prevLon = r.pose.lon
  for (let i = 1; i <= 120; i++) {
    // The finger moves along one fixed screen line, the one that carries the surface toward the pole at the start (the camera
    // goes the other way): a great circle over the pole, one rotation axis for the whole drag.
    r.grab({ nx: 0, ny: 0 }, { nx: 0.03 * vx / aspect, ny: 0.03 * vy }, e, aspect, i * 16)
    const cam = r.camera(e, aspect, i * 16)
    assert.ok(angleDeg(prevUp, cam.up) < 3.5, `lat ${lat} roll ${roll} step ${i}: camera-up jumped ${angleDeg(prevUp, cam.up)} deg`)
    const twist = (cam.up.dot(prevCam.right) - cam.right.dot(prevCam.up)) / 2 * D
    assert.ok(Math.abs(twist) < 0.05, `lat ${lat} roll ${roll} step ${i}: the view twisted ${twist} deg about the line of sight at the pole`)
    prevCam = cam
    prevUp = cam.up.clone()
    maxLat = Math.max(maxLat, Math.abs(r.pose.lat))
    if (Math.abs(wrap(r.pose.lon - prevLon)) > 90) crossed = true
    prevLon = r.pose.lon
  }
  assert.ok(maxLat > 89 || crossed, `lat ${lat} roll ${roll}: the drag went over the pole`)
}

// 6. A grab still holds the point under the finger (the trackball solve is exact for a rigid view), even at 85 deg where the old
// point-lock gave up and handed over to a spin.
for (const lat of [0, 60, 85]) {
  const r = rigAt(lat, 25)
  let from = { nx: -0.1, ny: 0.1 }
  const P = pickSphere(r.camera(e, aspect, 0), from.nx, from.ny, aspect)!
  for (let i = 1; i <= 20; i++) {
    const to = { nx: -0.1 + i * 0.012, ny: 0.1 - i * 0.008 }
    assert.ok(r.grab(from, to, e, aspect, i * 16))
    from = to
  }
  const c = project(r.camera(e, aspect, 400), P)
  assert.ok(Math.hypot(c.x - from.nx, c.y - from.ny) < 2e-3, `lat ${lat}: the grabbed point drifted to (${c.x}, ${c.y}) vs (${from.nx}, ${from.ny})`)
}

// 7. Side buttons ease: a click is spread over several frames (no single frame takes more than a third of it), it arrives in full,
// a held button repeats after the delay at a steady rate, and the result does not depend on the frame rate.
{
  for (const fps of [30, 60, 144]) {
    const b = new EasedButton()
    b.press(ZOOM_CLICK_OCTAVES)
    b.release()
    let total = 0, biggest = 0, frames = 0
    while (b.active && frames < 600) { const u = b.tick(1 / fps, 1.2); total += u; biggest = Math.max(biggest, u); frames++ }
    assert.ok(Math.abs(total - ZOOM_CLICK_OCTAVES) < 1e-6, `${fps} fps: the click delivered ${total}`)
    assert.ok(biggest < ZOOM_CLICK_OCTAVES * (fps === 30 ? 0.35 : 0.2), `${fps} fps: the biggest frame took ${biggest}`)
    assert.ok(frames > fps * 0.2, `${fps} fps: the glide lasted ${frames} frames`)
  }
  const held = new EasedButton()
  held.press(0.35)
  let total = 0
  for (let i = 0; i < 60; i++) total += held.tick(1 / 60, 1.2) // one second held
  assert.ok(total > 0.35 + 0.6 && total < 0.35 + 1.2, `one second held gives ${total} octaves`)
  held.release()
  let tail = 0
  for (let i = 0; i < 120; i++) tail += held.tick(1 / 60, 1.2)
  assert.ok(tail > 0 && !held.active, 'releasing lets the glide finish and stop')
}

// 8. The tooltips say what each button is: zoom is distance, look up and down is the view angle (the owner heard "altitude").
assert.match(BUTTON_LABELS.zoomIn, /Zoom in/)
assert.match(BUTTON_LABELS.zoomOut, /Zoom out/)
assert.match(BUTTON_LABELS.lookUp, /^Look up \(tilt/)
assert.match(BUTTON_LABELS.lookDown, /^Look down \(tilt/)
assert.doesNotMatch(Object.values(BUTTON_LABELS).join(' '), /altitude/i)

console.log('nav-drag-zoom: ok')
