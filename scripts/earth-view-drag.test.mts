/** Regression for the first sky drag from the settled, far Earth view on a phone. */
import assert from 'node:assert/strict'
import { CameraRig } from '../src/camera/rig.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { EARTH_VIEW_FOV_DEG, momentPose } from '../src/momentPose.ts'
import { angularDistance } from '../src/camera/pose.ts'

const e = ephemerisAt(new Date('2026-10-09T12:00:00Z'))
const aspect = 412 / 915
const shortSide = 412
const rig = new CameraRig()
rig.setPose(momentPose({ at: 'earth' }, e))
rig.fovDeg = EARTH_VIEW_FOV_DEG
// The `now` moment's settled view is at the Earth distance, looking back at
// the Moon. A completed scripted turn may still be handed off on pointerdown.
rig.lookAtMoon(false, 0, e, aspect)
const rendered = rig.camera(e, aspect, 4000)
rig.settle(e, aspect, 4000, rendered)
rig.takeOver(4000)
rig.dragging = true

const initial = { ...rig.pose }
let prior = { ...rig.pose }
for (let i = 1; i <= 14; i++) {
  rig.spin(160 / 14, 0, shortSide, e, aspect, 4000 + i * 16)
  const current = { ...rig.pose }
  assert.ok(
    angularDistance(prior.lon, prior.lat, current.lon, current.lat) > 1e-8,
    `the first horizontal sky-drag sample ${i} must move the pose`,
  )
  prior = current
}
assert.ok(angularDistance(initial.lon, initial.lat, rig.pose.lon, rig.pose.lat) > 0.1,
  'the 160 px first drag makes a visible orbit at the far limit')

// An active Earth look remains a body-following look while the pose turns;
// taking it over must not leave an animation that writes the old pose back.
const earthLook = new CameraRig()
earthLook.setPose(momentPose({ at: 'earth' }, e))
earthLook.fovDeg = EARTH_VIEW_FOV_DEG
earthLook.lookToward((cam) => e.earthKm.clone().divideScalar(1737.4).sub(cam.pos), false, 0, e, aspect)
const earthBefore = { ...earthLook.pose }
earthLook.spin(160 / 14, 0, shortSide, e, aspect, 4016)
assert.ok(angularDistance(earthBefore.lon, earthBefore.lat, earthLook.pose.lon, earthLook.pose.lat) > 1e-4,
  'a body-look target does not swallow sky spin')
assert.ok(earthLook.hasActiveScriptState(4016), 'an Earth look stays deliberate while following the body')
console.log('earth-view-drag.test.mts: settled Earth view responds from its first horizontal sample; active body look remains deliberate')
