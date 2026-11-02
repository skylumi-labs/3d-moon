import assert from 'node:assert/strict'
import { CameraRig } from '../src/camera/rig.ts'
import { angularDistance } from '../src/camera/pose.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { EARTH_VIEW_FOV_DEG, momentPose } from '../src/momentPose.ts'

// Match ?moment=now on a 412 x 915 phone: the Earth-distance pose, the
// moment's narrow lens and zero aim shift, with its settled Moon-facing view.
const e = ephemerisAt(new Date('2026-10-09T12:00:00Z'))
const aspect = 412 / 915
const rig = new CameraRig()
rig.setPose(momentPose({ at: 'earth' }, e))
rig.fovDeg = EARTH_VIEW_FOV_DEG
rig.aimShift = 0
rig.aimShiftX = 0
rig.lookAtMoon(false, 0, e, aspect)
const rendered = rig.camera(e, aspect, 4000)
rig.settle(e, aspect, 4000, rendered)
rig.takeOver(4000)

// A settled Moon-facing view at the Earth distance: the grab-or-spin handoff must move on every sample.
assert.ok(rig.pickMoon(0, 0, e, aspect, 4001), 'the initial finger point hits the Moon')

const initial = { ...rig.pose }
let priorX = 0
for (let step = 1; step <= 12; step++) {
  const nextX = step * 10
  const from = { nx: (priorX / 412) * 2, ny: 0 }
  const to = { nx: (nextX / 412) * 2, ny: 0 }
  const now = 4000 + step * 16
  const grabbed = rig.grab(from, to, e, aspect, now)
  if (!grabbed) rig.spin(nextX - priorX, 0, 412, e, aspect, now)
  assert.ok(angularDistance(initial.lon, initial.lat, rig.pose.lon, rig.pose.lat) > 1e-8,
    `horizontal grab-or-spin sample ${step} must not be swallowed`)
  priorX = nextX
}
assert.ok(angularDistance(initial.lon, initial.lat, rig.pose.lon, rig.pose.lat) > 0.1,
  'the 120 px drag makes a visible orbit')
console.log('grab-fallback.test.mts: a no-motion grab falls through to spin on the first sample')
