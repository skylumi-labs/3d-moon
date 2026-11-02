import assert from 'node:assert/strict'
import { CameraRig } from '../src/camera/rig.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { MOON_R_KM, EARTH_R_KM } from '../src/glsl/common.ts'
import { earthTransition, subjectTransitionAt, EARTH_TRANSITION_MS } from '../src/journey/subjectTransition.ts'
import { subEarthPose } from '../src/camera/pose.ts'
const e = ephemerisAt(new Date('2027-08-02T10:30:00Z'))
for (const aspect of [390 / 844, 1.6]) {
  const rig = new CameraRig(), from = rig.camera(e, aspect, 0)
  rig.setPose(subEarthPose(e, 4)); rig.fovDeg = 4.5; rig.aimShift = .35; rig.aimShiftX = .25
  rig.lookToward(cam => e.earthKm.clone().divideScalar(MOON_R_KM).sub(cam.pos), false, 0, e, aspect)
  const to = rig.camera(e, aspect, 0)
  const j = earthTransition(from, to, e.earthKm.clone().divideScalar(MOON_R_KM), e.moonZ, aspect, 0)
  assert.equal(j.direct, false)
  assert.ok(Math.abs(j.waypoint.length() - 5) < 1e-9, 'the default waypoint is 5 radii out')
  const far = earthTransition(from, to, e.earthKm.clone().divideScalar(MOON_R_KM), e.moonZ, aspect, 0, 16)
  assert.ok(Math.abs(far.waypoint.length() - 16) < 1e-9, 'a moment may ask for a farther waypoint (the 2027 eclipse: a small Moon beside the Earth)')
  assert.equal(subjectTransitionAt(j, 0).cam, from)
  assert.equal(subjectTransitionAt(j, EARTH_TRANSITION_MS).cam, to)
  let holdCount = 0, previous = from, worstStep = 0
  for (let i = 1; i <= 900; i++) {
    const sample = subjectTransitionAt(j, i * 10), cam = sample.cam
    for (const v of [...cam.pos.toArray(), ...cam.up.toArray(), cam.tanHalf]) assert.ok(Number.isFinite(v))
    assert.ok(cam.pos.length() >= 4 - 1e-9, 'never passes through the Moon')
    assert.ok(Math.abs(cam.up.dot(cam.back)) < 1e-9)
    worstStep = Math.max(worstStep, cam.back.angleTo(previous.back))
    if (sample.phase === 'earthrise-hold') {
      holdCount++
      const earth = j.earth.clone().sub(cam.pos), moon = cam.pos.clone().negate()
      const angularSeparation = earth.angleTo(moon)
      const earthRadius = Math.asin(EARTH_R_KM / MOON_R_KM / earth.length()), moonRadius = Math.asin(1 / moon.length())
      assert.ok(angularSeparation > earthRadius + moonRadius, 'Earth clears actual lunar limb')
      assert.ok(earth.angleTo(cam.back.clone().negate()) + earthRadius < Math.atan(cam.tanHalf * Math.min(1, aspect)), 'Earth fits short-side frustum')
      assert.ok(moon.angleTo(cam.back.clone().negate()) + moonRadius < Math.atan(cam.tanHalf * Math.min(1, aspect)), 'Moon fits same composition')
    }
    previous = cam
  }
  assert.ok(holdCount >= 205, '2.1-second shared-body hold (drifting in, never a still)')
  assert.ok(worstStep < .06, 'bounded sampled orientation')
  for (const u of [.4, .63, .78, 1]) {
    const before = subjectTransitionAt(j, u * j.durationMs - .00001).cam, after = subjectTransitionAt(j, u * j.durationMs + .00001).cam
    assert.ok(before.pos.distanceTo(after.pos) < 1e-7, `continuous position at ${u}`)
    assert.ok(before.back.distanceTo(after.back) < 1e-7, `continuous orientation at ${u}`)
    assert.ok(Math.abs(before.tanHalf - after.tanHalf) < 1e-7, `continuous lens at ${u}`)
  }
}
console.log('subject-transition.test.mts: staged Earthrise, 2.1s unoccluded geometry hold, exact endpoints, pose/lens handoffs and mobile frustum: ok (pixels unrun)')
