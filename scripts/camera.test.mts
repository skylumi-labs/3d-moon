/**
 * Camera floor, zoom law and the way back from the floor:
 *   npm test
 */
import assert from 'node:assert/strict'
import { D_MAX, D_MIN, FLY_FOV_DEG, HOME_DIST, homePose, litSideViewPoint, wrapLon, underCamera, PITCH_MAX, clampDist, floorDist, flyTanHalf, reliefShare, sizeRatio, zoomDist, angularDistance } from '../src/camera/pose.ts'
import { CameraRig } from '../src/camera/rig.ts'
import { TILT_START_PX, newTwoFingerState, twoFingerStep } from '../src/camera/gesture.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { H_TEXEL_KM } from '../src/moon/tiles/grid.ts'
import { spinRadiansPerPixel } from '../src/camera/grab.ts'

const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`)

// litSideViewPoint (no longer used by Home, which is the real sky) moves toward the Sun when the Earth-facing point is more than
// 70 degrees from it. The antipodal fallback follows a meridian through north.
{
  const earth = { lon: 12.5, lat: -8.25 }
  const at70 = { lon: 82.5, lat: -8.25 }
  const unchanged = litSideViewPoint(earth, at70, 70)
  assert.equal(unchanged.lon, earth.lon)
  assert.equal(unchanged.lat, earth.lat)

  const antipodal = litSideViewPoint({ lon: 0, lat: 0 }, { lon: 180, lat: 0 }, 70)
  near(angularDistance(antipodal.lon, antipodal.lat, 180, 0) * 180 / Math.PI, 70, 1e-8, 'antipodal result separation')
  near(wrapLon(antipodal.lon - 180), 0, 1e-8, 'antipodal north meridian longitude')
  near(antipodal.lat, 70, 1e-8, 'antipodal north meridian latitude')

  const before = litSideViewPoint({ lon: 0, lat: 0 }, { lon: 69.999, lat: 0 }, 70)
  const after = litSideViewPoint({ lon: 0, lat: 0 }, { lon: 70.001, lat: 0 }, 70)
  assert.ok(angularDistance(before.lon, before.lat, after.lon, after.lat) < 0.00004, 'view is continuous across the 70 degree threshold')

  const wrapped = litSideViewPoint({ lon: 179, lat: 10 }, { lon: -179, lat: 80 }, 70)
  assert.ok(wrapped.lon >= -180 && wrapped.lon <= 180, 'longitude is wrapped across the antimeridian')
  assert.ok(Number.isFinite(wrapped.lon) && Number.isFinite(wrapped.lat), 'pole/antimeridian geometry stays finite')
  const polar = litSideViewPoint({ lon: 37, lat: 90 }, { lon: -22, lat: -90 }, 70)
  assert.ok(Number.isFinite(polar.lon) && Number.isFinite(polar.lat), 'antipodal poles stay finite')
  for (const solar of [{ lon: 0, lat: 0 }, { lon: 180, lat: 0 }]) {
    const point = litSideViewPoint({ lon: 0, lat: 0 }, solar, 70)
    assert.ok(Number.isFinite(point.lon) && Number.isFinite(point.lat), 'coincident and antipodal inputs stay finite')
  }
}

// 1. Floor from the data: DESIGN-M2.md section 7 (1.45 at 880 px, 1.55 at 1080 px with LOLA's 0.474 km).
near(H_TEXEL_KM, 0.4741, 5e-4, 'height texel')
near(floorDist(H_TEXEL_KM, 880), 1.45, 0.01, 'floor 880 px')
near(floorDist(H_TEXEL_KM, 1080), 1.55, 0.01, 'floor 1080 px')
// One texel per pixel at that distance: altitude = texel x px / (2 tan 15 deg).
{
  const d = floorDist(H_TEXEL_KM, 1000)
  const altKm = (d - 1) * 1737.4
  near(altKm * 2 * Math.tan(15 * Math.PI / 180) / 1000, H_TEXEL_KM, 1e-6, 'one texel per pixel')
}
// A sharper canvas stops earlier, a smaller one goes lower, never below the surface, and the size is capped.
assert.ok(floorDist(H_TEXEL_KM, 1170) > floorDist(H_TEXEL_KM, 880))
assert.ok(floorDist(H_TEXEL_KM, 300) > 1)
assert.equal(floorDist(H_TEXEL_KM, 5000), floorDist(H_TEXEL_KM, 1200))
// Without tiles the floor is the milestone-1 value.
near(D_MIN, 3.58, 0.01, 'D_MIN')
assert.equal(clampDist(1.2), D_MIN)
assert.equal(clampDist(1.2, 1.45), 1.45)
assert.equal(clampDist(99, 1.45), 12)

// 2. Zoom law: the far end is the old one, the near end scales the altitude, and it is continuous and monotone.
near(zoomDist(10, 0.9), 9, 1e-12, 'far zoom')
near(zoomDist(3, 0.9), 2.7, 1e-12, 'zoom at 3')
near(zoomDist(1.5, 0.9), 1 + 0.5 * 0.9, 1e-12, 'zoom at 1.5')
near(zoomDist(2, 0.5), 1.5, 1e-12, 'zoom at 2')
{
  let prev = -1
  for (let d = 1.05; d <= 6; d += 0.01) {
    const z = zoomDist(d, 0.9)
    assert.ok(z < d && z > 1, `zoom stays above the surface at ${d}`)
    assert.ok(z > prev, 'monotone in distance')
    prev = z
  }
  // Repeated zoom-in never crosses the floor, and takes many steps to reach it (no last-stretch cliff).
  let d = 2.5, steps = 0
  while (d > 1.45 + 1e-6 && steps < 500) { d = clampDist(zoomDist(d, 0.9), 1.45); steps++ }
  assert.ok(steps > 10 && steps < 500, `steps to floor ${steps}`)
}

// Sky rotation grows sublinearly with altitude, and tends continuously to zero at the surface.
{
  const perPx = (alt: number) => spinRadiansPerPixel(alt, 30, 880)
  assert.equal(perPx(0), 0)
  assert.ok(perPx(0.5) > perPx(0.49), 'response is continuous and increasing near the limb')
  assert.ok(perPx(11) < perPx(0.5) * 8, 'the far view no longer turns 22x faster than a low view')
  assert.ok(perPx(11) < 30 * Math.PI / 180 * 11 / 880, 'the response is below the old linear altitude law')
}

// The bounded response also holds for a free view, and a grab reaching the limb hands off without a large turn.
{
  const e = ephemerisAt(new Date('2026-10-20T22:34:00Z'))
  const rig = new CameraRig()
  rig.setFloor(1.01)
  rig.setPose({ lon: 0, lat: 0, dist: 12, roll: 0 })
  rig.setFreeOrientation([0, 0, 0, 1])
  const start = { ...rig.pose }
  rig.spin(100, 0, 880, e, 16 / 9, 100)
  const farTurn = angularDistance(start.lon, start.lat, rig.pose.lon, rig.pose.lat) * 180 / Math.PI
  assert.ok(farTurn < 14, `100 px sky drag at far range turns ${farTurn} degrees`)
  rig.setPose({ lon: 0, lat: 0, dist: 4, roll: 0 })
  const grabbed = rig.grab({ nx: 0, ny: 0 }, { nx: 0.5, ny: 0 }, e, 16 / 9, 200, 880)
  assert.equal(grabbed, true, 'the disc drag solver holds a point near the limb')
  const beforeLimbHandoff = { ...rig.pose }
  assert.equal(rig.grab({ nx: 0.5, ny: 0 }, { nx: 0.8, ny: 0 }, e, 16 / 9, 216, 880), false, 'a point beyond the limb hands off to sky rotation')
  rig.spin(235, 0, 880, e, 16 / 9, 216)
  const handoffTurn = angularDistance(beforeLimbHandoff.lon, beforeLimbHandoff.lat, rig.pose.lon, rig.pose.lat) * 180 / Math.PI
  assert.ok(handoffTurn < 16, `the sky handoff turns ${handoffTurn} degrees instead of jumping`)
}

// 3. Way back from the floor: the rig's dolly zoom interpolates distance and the Moon's apparent size on log
// scales and derives the field from both (rig.ts camera()). From the floor to the Earth view the field must stay finite.
{
  const aspect = 16 / 9
  const A = { dist: 1.45, tanHalf: flyTanHalf(aspect) }
  const B = { dist: 221, tanHalf: Math.tan(Math.asin(1 / 221)) / 0.85 }
  const rA = sizeRatio(A.dist, A.tanHalf), rB = sizeRatio(B.dist, B.tanHalf)
  let last = A.tanHalf
  for (let k = 0; k <= 1.0001; k += 0.02) {
    const dist = Math.exp(Math.log(A.dist) + (Math.log(B.dist) - Math.log(A.dist)) * k)
    const ratio = Math.exp(Math.log(rA) + (Math.log(rB) - Math.log(rA)) * k)
    const tanHalf = Math.tan(Math.asin(Math.min(1, 1 / dist))) / ratio
    assert.ok(Number.isFinite(tanHalf) && tanHalf > 0, `field at ${k}`)
    assert.ok(tanHalf <= last * 1.0001 + 1e-9 || k === 0, `field never widens on the way out (k=${k})`)
    last = tanHalf
    assert.ok(dist >= A.dist - 1e-9)
  }
  near(last, B.tanHalf, 1e-9, 'ends at the Earth view field')
  assert.ok(FLY_FOV_DEG === 30)
}

// 4. Pitch (toward the horizon), felt only near the ground.
{
  const e = ephemerisAt(new Date('2026-10-20T22:34:00Z'))
  const aspect = 16 / 9
  const rig = new CameraRig()
  rig.setFloor(1.45)
  const cam = (pitch: number | undefined, dist: number) => {
    rig.setPose({ lon: -20, lat: 10, dist, roll: 0, pitch })
    return rig.camera(e, aspect, 0)
  }
  const vec = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z]
  // No pitch, or a pitch of 0: the same camera to the last bit.
  assert.deepEqual(vec(cam(undefined, 1.5).back), vec(cam(0, 1.5).back))
  // Position never changes with pitch; the view turns by exactly the pitch about the camera's right axis.
  const flat = cam(0, 1.5), tilted = cam(30, 1.5)
  assert.deepEqual(vec(flat.pos), vec(tilted.pos))
  near(Math.acos(Math.min(1, flat.back.dot(tilted.back))) * 180 / Math.PI, 30, 1e-6, 'pitch angle')
  near(tilted.right.dot(flat.right), 1, 1e-9, 'pitch is a turn about the right axis')
  // Looking toward the horizon: the view direction (-back) tilts toward the camera's up.
  assert.ok(-tilted.back.dot(flat.up) > 0.49, 'tilts toward up')
  // From 2.4 radii up the pitch is not applied at all, and it fades smoothly below.
  assert.deepEqual(vec(cam(40, 2.4).back), vec(cam(0, 2.4).back))
  assert.deepEqual(vec(cam(40, 5).back), vec(cam(0, 5).back))
  assert.equal(reliefShare(2.4), 0)
  assert.equal(reliefShare(1.8), 1)
  assert.equal(reliefShare(1.5), 1)
  let prev = 2
  for (let d = 1.7; d <= 2.5; d += 0.01) { const w = reliefShare(d); assert.ok(w <= prev + 1e-12 && w >= 0 && w <= 1); prev = w }
  // tilt(): a drag down turns toward the horizon, up turns back; clamped to [0, PITCH_MAX].
  rig.setPose({ lon: 0, lat: 0, dist: 1.5, roll: 0, pitch: 0 })
  rig.tilt(100, 720, 1)
  assert.ok((rig.pose.pitch ?? 0) > 0)
  near(rig.pose.pitch ?? 0, 100 * FLY_FOV_DEG / 720, 1e-9, 'one px turns the view by the angle a px spans')
  rig.tilt(1e6, 720, 2)
  assert.equal(rig.pose.pitch, PITCH_MAX)
  rig.tilt(-1e6, 720, 3)
  assert.equal(rig.pose.pitch, 0)
}
// 5. Idle pitch: above the relief's reach it has no effect, so it is dropped; zooming out, turning, and zooming back in must not
// bring the tilted horizon back unasked (Pose.pitch used to survive invisibly above 2.4 radii).
{
  const rig = new CameraRig()
  rig.setFloor(1.45)
  rig.setPose({ lon: 0, lat: 0, dist: 1.5, roll: 0, pitch: 40 })
  rig.zoom(1.0, 1)
  assert.equal(rig.pose.pitch, 40, 'kept while the relief is in reach')
  for (let i = 0; i < 40; i++) rig.zoom(1.2, 2 + i)
  assert.ok(rig.pose.dist > 2.4)
  assert.equal(rig.pose.pitch, 0, 'dropped above 2.4 radii')
  for (let i = 0; i < 60; i++) rig.zoom(1 / 1.2, 100 + i)
  assert.ok(rig.pose.dist < 1.6)
  assert.equal(rig.pose.pitch ?? 0, 0, 'and not back after zooming in')
  rig.setPose({ dist: 5, pitch: 30 })
  assert.equal(rig.pose.pitch, 0, 'setPose drops it too')
}

// 6. Two fingers: a pinch zooms and never tilts; two fingers moving together tilt, after a start threshold, and a wobble does not.
{
  const A0 = { x: 100, y: 300 }, B0 = { x: 200, y: 300 }
  // Pinch out with a sloppy centroid drift of 0.6 px per step downward on both fingers, 100 steps.
  let st = newTwoFingerState(), tilt = 0, zoom = 1
  let a = { ...A0 }, b = { ...B0 }
  for (let i = 0; i < 100; i++) {
    const na = { x: a.x - 0.5, y: a.y + 0.6 }, nb = { x: b.x + 0.5, y: b.y + 0.6 }
    const r = twoFingerStep(a, b, na, nb, st)
    tilt += r.tilt
    zoom *= r.zoom
    a = na
    b = nb
  }
  assert.equal(tilt, 0, 'a pinch with a drifting centroid tilts nothing')
  assert.ok(zoom < 0.7, `the pinch still zooms (${zoom})`)
  // Both fingers dragging down together: nothing under the start threshold, then tilt.
  st = newTwoFingerState(); a = { ...A0 }; b = { ...B0 }
  let first = -1, total = 0
  for (let i = 0; i < 40; i++) {
    const na = { x: a.x, y: a.y + 2 }, nb = { x: b.x, y: b.y + 2 }
    const r = twoFingerStep(a, b, na, nb, st)
    if (r.tilt && first < 0) first = i
    total += r.tilt
    a = na
    b = nb
  }
  assert.ok(first >= 6 && first <= 8, `the tilt starts after about ${TILT_START_PX} px of travel (step ${first})`)
  assert.ok(total > 60, `and then follows the fingers (${total} px)`)
  // Fingers moving opposite ways (a scissor / twist) never tilt, and a hand tremor under the deadband does nothing.
  st = newTwoFingerState()
  let t2 = 0
  for (let i = 0; i < 50; i++) t2 += twoFingerStep({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 3 }, { x: 100, y: -3 }, st).tilt
  for (let i = 0; i < 50; i++) t2 += twoFingerStep({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0.2 }, { x: 100, y: 0.2 }, st).tilt
  assert.equal(t2, 0)
}

// 5. The navigator (WP1): Home is an orbit pose, never the Earth view; the range is [floor, 12]; wheel and pinch never leave it.
{
  const e = ephemerisAt(new Date('2026-10-20T22:34:00Z'))
  const aspect = 1.6
  const rig = new CameraRig()
  rig.setFloor(1.45)
  assert.equal(rig.mode, 'fly', 'a fresh rig is in fly mode: there is no Earth view to leave')
  rig.setPose(homePose(e))
  near(rig.pose.dist, HOME_DIST, 1e-12, 'home distance')
  near(rig.pose.lon, e.subEarth.lon, 1e-12, 'home is over the sub-Earth point')
  near(rig.pose.roll, homePose(e).roll, 1e-12, 'home roll is the celestial-north-up roll')
  assert.equal(D_MAX, 12)
  // Hammer the zoom both ways: the pose never leaves [floor, 12] and the mode never changes.
  let lo = Infinity, hi = 0
  for (let i = 0; i < 400; i++) {
    rig.zoomCentre(i % 3 === 0 ? 1.15 : 0.8, e, aspect, i * 16)
    lo = Math.min(lo, rig.pose.dist); hi = Math.max(hi, rig.pose.dist)
    assert.equal(rig.mode, 'fly')
  }
  for (let i = 0; i < 300; i++) rig.zoom(1.2, 10000 + i)
  assert.ok(rig.pose.dist <= 12 + 1e-9 && lo >= 1.45 - 1e-9, `range ${lo}..${rig.pose.dist}`)
  near(rig.pose.dist, 12, 1e-9, 'zoomed all the way out stops at 12')
  // The rubber band stretches only the picture (the pose stays on the limit), then springs back within a quarter second.
  const shown = rig.camera(e, aspect, 20000).pos.length()
  assert.ok(shown > 12 && shown <= 12 * 1.0801, `rubber ${shown}`)
  rig.step(20000 + 200, 0.016)
  for (let t = 20200; t < 20700; t += 16) rig.step(t, 0.016)
  near(rig.camera(e, aspect, 20700).pos.length(), 12, 1e-3, 'the rubber band springs back')
  for (let i = 0; i < 300; i++) rig.zoom(0.8, 30000 + i)
  near(rig.pose.dist, 1.45, 1e-9, 'zoomed all the way in stops at the floor')
  // Tilt works far out too (free-flying camera controls): it tilts toward the limb, limited so the Moon stays in view.
  rig.setPose({ dist: 5 })
  rig.tilt(200, 800, 1)
  assert.ok((rig.pose.pitch ?? 0) > 0, 'tilt works far out')
  assert.ok((rig.pose.pitch ?? 0) <= rig.tiltLimit() + 1e-9, 'within the limit')
}

// 6. Zoom goes toward the view centre, never the cursor: 4x in leaves the pose's longitude, latitude and roll exactly as they were
// (the owner, 10 Oct 2026: "the Moon turns as I zoom in ... should just zoom in where I am").
for (const [w, h] of [[1440, 900], [390, 844]] as const) {
  const e = ephemerisAt(new Date('2026-10-20T22:34:00Z'))
  const aspect = w / h
  for (const lat of [0, 45, 80, -85]) {
    const rig = new CameraRig()
    rig.setFloor(1.45)
    rig.setPose({ lon: 33, lat, dist: 6, roll: 20 })
    const before = { ...rig.pose }
    const upBefore = rig.camera(e, aspect, 0).up.clone()
    let f = 1
    while (f > 0.25 + 1e-9) { rig.zoomCentre(0.9, e, aspect, 1); f *= 0.9 }
    assert.ok(rig.pose.dist < 6 * 0.9, 'it zoomed')
    assert.equal(rig.pose.lon, before.lon, `${w}x${h} lat ${lat}: longitude unchanged`)
    assert.equal(rig.pose.lat, before.lat, `${w}x${h} lat ${lat}: latitude unchanged`)
    assert.equal(rig.pose.roll, before.roll, `${w}x${h} lat ${lat}: roll unchanged`)
    assert.ok(rig.camera(e, aspect, 1).up.distanceTo(upBefore) < 1e-9, `${w}x${h} lat ${lat}: camera-up unchanged`)
  }
}

// 7. Inertia: a fast release carries on and dies away (0.35 s), a held release stops at once, and a fly-to hands its speed on.
{
  const e = ephemerisAt(new Date('2026-10-20T22:34:00Z'))
  const rig = new CameraRig()
  rig.setFloor(1.45)
  rig.setPose({ ...homePose(e), dist: 4 })
  for (let i = 0; i < 10; i++) rig.orbit(20, 0, 800, 1000 + i * 16)
  rig.release(1000 + 9 * 16 + 20)
  const lon0 = rig.pose.lon
  let t = 1200
  for (let i = 0; i < 20; i++) { rig.step(t, 0.016); t += 16 }
  const moved = Math.abs(wrapLon(rig.pose.lon - lon0))
  assert.ok(moved > 0.5, `inertia carries on (${moved} deg in 0.3 s)`)
  for (let i = 0; i < 400; i++) { rig.step(t, 0.016); t += 16 }
  const rest = rig.pose.lon
  for (let i = 0; i < 30; i++) { rig.step(t, 0.016); t += 16 }
  assert.equal(rig.pose.lon, rest, 'and stops')
  const held = new CameraRig()
  held.setFloor(1.45)
  held.setPose({ ...homePose(e), dist: 4 })
  for (let i = 0; i < 10; i++) held.orbit(20, 0, 800, 1000 + i * 16)
  held.release(1000 + 9 * 16 + 400)
  const l1 = held.pose.lon
  held.step(2000, 0.016)
  assert.equal(held.pose.lon, l1, 'a held finger leaves no inertia')
  // The idle orbit is off until 20 s without input, then 0.6 deg/s.
  const idle = new CameraRig()
  idle.auto = true // opt-in (?auto=1): the rig no longer orbits by default
  idle.setPose({ ...homePose(e) })
  idle.lastInputAt = 0
  const i0 = idle.pose.lon
  idle.step(19000, 0.016)
  assert.equal(idle.pose.lon, i0, 'no idle orbit before 20 s')
  idle.step(21000, 1)
  near(wrapLon(idle.pose.lon - i0), 0.6, 1e-9, 'idle orbit 0.6 deg/s')
}

// 8. Home glides to the home pose in 1.5 to 3 s, ends exactly there, and a takeOver mid-flight stops where the camera is.
{
  const e = ephemerisAt(new Date('2026-10-20T22:34:00Z'))
  const rig = new CameraRig()
  rig.setFloor(1.45)
  rig.setPose({ lon: 120, lat: -40, dist: 1.8, roll: 0, pitch: 30 })
  rig.fovDeg = 4
  rig.glideTo(homePose(e), 0, { fovDeg: FLY_FOV_DEG, aimShift: 0, aimShiftX: 0 })
  assert.ok(rig.gliding())
  rig.step(800, 0.016)
  const mid = rig.takeOver(800)
  assert.ok(!rig.gliding(), 'a takeOver ends the glide')
  assert.ok(mid.pose.dist > 1.8 && mid.pose.dist < HOME_DIST, 'mid-flight')
  assert.ok(Math.abs(mid.velocity.lon) + Math.abs(mid.velocity.lat) > 1, 'and reports its speed')
  const r2 = new CameraRig()
  r2.setFloor(1.45)
  r2.setPose({ lon: 120, lat: -40, dist: 1.8, roll: 0 })
  r2.glideTo(homePose(e), 0)
  let t = 0
  while (r2.gliding() && t < 5000) { t += 16; r2.step(t, 0.016) }
  assert.ok(t >= 1500 && t <= 3100, `fly-to takes ${t} ms`)
  near(r2.pose.dist, HOME_DIST, 1e-9, 'ends at home')
  near(wrapLon(r2.pose.lon - e.subEarth.lon), 0, 1e-9, 'over the sub-Earth point')
  // Never settles: takeOver leaves the rig in fly mode with no look offset to bake.
  assert.ok(!r2.hasScriptState(), 'no script state after Home')
}

// 9. One drag rule (owner 2026-10-31): the rig has no drag mode and no hook into the clock or the Sun, so no drag can change the lighting.
{
  const rig = new CameraRig() as unknown as Record<string, unknown>
  for (const k of ['dragMode', 'turnHook', 'spinHook', 'spinMinAlt', 'scripted', 'sunFollows', 'spinsMoon', 'spinMoon']) assert.equal(k in rig, false, `rig.${k} is gone`)
  void underCamera
}

// The settle exemption (issue 186): a camera frozen below the floor by settle() keeps its height only where the floor is no higher.
// Dragging it out over ground whose floor is ~100x higher lifts it, and setFloor lifts it again.
{
  const eph = ephemerisAt(new Date('2026-10-20T22:34:00Z'))
  const aspect = 1.6
  const rig = new CameraRig()
  rig.setFloor(1.08)
  // A funnel floor near lon 0 / lat 0 (1.0003 R), the global 1.08 R elsewhere.
  rig.deepFloor = (lon, lat) => (angularDistance(lon, lat, 0, 0) < 0.0001 ? 1.0003 : 1.08)
  rig.setPose({ lon: 0, lat: 0, dist: 1.0003, roll: 0, pitch: 0 })
  rig.settle(eph, aspect, 1000, rig.camera(eph, aspect, 1000))
  // Same floor: the camera is not lifted at the settle point.
  rig.orbit(1, 0, 800, 1010)
  assert.ok(rig.pose.dist < 1.0004, `stays in the funnel while the floor is unchanged: ${rig.pose.dist}`)
  for (let i = 0; i < 80; i++) rig.orbit(200, 0, 800, 1020 + i * 16)
  assert.ok(angularDistance(rig.pose.lon, rig.pose.lat, 0, 0) > 0.0001, 'the drag left the funnel')
  assert.ok(rig.pose.dist >= rig.floorAt(rig.pose.lon, rig.pose.lat) - 1e-9, `lifted to the floor outside the funnel: ${rig.pose.dist} vs ${rig.floorAt(rig.pose.lon, rig.pose.lat)}`)
  // And it stays clamped when dragged on.
  for (let i = 0; i < 20; i++) rig.orbit(-40, 10, 800, 3000 + i * 16)
  assert.ok(rig.pose.dist >= rig.floorAt(rig.pose.lon, rig.pose.lat) - 1e-9, 'the clamp holds after the exemption ended')
  // A floor that rises under a settled camera lifts it.
  const r2 = new CameraRig()
  r2.setFloor(1.0003)
  r2.setPose({ lon: 20, lat: 0, dist: 1.0003, roll: 0, pitch: 0 })
  r2.settle(eph, aspect, 1000, r2.camera(eph, aspect, 1000))
  r2.setFloor(1.05)
  assert.ok(r2.pose.dist >= 1.05 - 1e-9, `setFloor lifts a settled camera below the new floor: ${r2.pose.dist}`)
}

console.log('camera.test: ok')
