import assert from 'node:assert/strict'
import { ephemerisAt } from '../src/ephemeris.ts'
import { momentPose } from '../src/momentPose.ts'
import { ARCHIVED_MOMENTS, MOMENTS } from '../src/moments.ts'
import { flyTanHalf, poseBasis } from '../src/camera/pose.ts'
import { Vector3 } from 'three'

const ordered = ['first-light', 'earthrise']
assert.equal(MOMENTS.some((m) => m.id === 'land-like-apollo17'), false, 'the powered descent is not offered as a moment')
assert.ok(ARCHIVED_MOMENTS.some((m) => m.id === 'land-like-apollo17'), 'the archived powered descent source remains available')
for (const gone of ['edge-of-night', 'into-sunlight', 'earthshine']) assert.equal(MOMENTS.some((m) => m.id === gone), false, `${gone} is removed`)
const actual = ordered.map((id) => MOMENTS.findIndex((m) => m.id === id))
assert.ok(actual.every((i) => i >= 0), 'cinematic horizon and Earthrise moments exist')
assert.deepEqual(actual, [...actual].sort((a, b) => a - b), 'Play all encounters the sequence in order')

const date = new Date('2026-10-20T19:00:00Z')
const e = ephemerisAt(date)
const sun = e.sunKm.clone().normalize()
const expectedVisibility = new Map([['first-light', 'partial']])
for (const [id, angle] of [['first-light', 138.31]] as const) {
  const m = MOMENTS.find((x) => x.id === id)!
  assert.equal(m.time().getTime() <= Date.now(), true, `${id} uses a real past/present sky time`)
  assert.equal(m.camera.at, 'solarHorizon')
  if (m.camera.at !== 'solarHorizon') continue
  const pose = momentPose(m.camera, e)
  assert.ok(Math.abs(m.camera.sunAngleDeg - angle) < 1e-6)
  assert.equal(pose.dist, 1.5)
  assert.equal(pose.pitch, 35)
  assert.equal(pose.roll, 90)

  // The camera sees the Moon's apparent disc, which dips below its local tangent by acos(1/r).
  // Classify the real solar disc against that limb instead of assuming the surface-normal altitude is visibility.
  const base = poseBasis(e, pose)
  const moonLimb = Math.asin(1 / pose.dist)
  const sunRadius = Math.asin(695700 / e.sunKm.length())
  const centerFromMoon = Math.acos(Math.max(-1, Math.min(1, -base.back.dot(sun))))
  const visibility = centerFromMoon + sunRadius < moonLimb ? 'hidden' : centerFromMoon - sunRadius > moonLimb ? 'clear' : 'partial'
  assert.equal(visibility, expectedVisibility.get(id), `${id} is ${visibility}`)

  // Rebuild the same local pitch rotation used by the rig and prove the Sun and Moon center both fit the shot.
  const pitch = (pose.pitch ?? 0) * Math.PI / 180
  const viewUp = base.up.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(base.back, Math.sin(pitch))
  const viewBack = base.back.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(base.up, -Math.sin(pitch))
  const depth = -sun.dot(viewBack)
  assert.ok(depth > 0, `${id} Sun is in front of the camera`)
  const tangent = flyTanHalf(1, m.fovDeg)
  const limbFromCameraCenter = Math.abs(pitch - moonLimb)
  assert.ok(limbFromCameraCenter < Math.atan(tangent), `${id} lunar limb is in frame`)
  const sunX = sun.dot(base.right) / depth, sunY = sun.dot(viewUp) / depth
  assert.ok(Math.abs(sunX) < tangent && Math.abs(sunY) < tangent, `${id} Sun projects inside the frame`)
  const moonDepth = -new Vector3().copy(base.back).negate().dot(viewBack)
  const moonY = new Vector3().copy(base.back).negate().dot(viewUp) / moonDepth
  assert.ok(moonDepth > 0 && Math.abs(moonY) < tangent, `${id} Moon center projects inside the frame`)
}
const earthrise = MOMENTS.find((m) => m.id === 'earthrise')!
assert.equal(earthrise.camera.at, 'earthrise')
assert.equal(earthrise.look, 'earth')
assert.equal(earthrise.fovDeg, 10.5)
console.log('moments.test ok')
