import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { CameraRig } from '../src/camera/rig.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { MOON_R_KM } from '../src/glsl/common.ts'
import { lookTransitionAt, LOOK_TRANSITION_MS, type LookTransition } from '../src/journey/lookTransition.ts'
const e = ephemerisAt(new Date('2028-12-31T16:51:55Z'))
for (const aspect of [1.6, .46]) for (const subject of ['earth', 'sun'] as const) {
 const rig = new CameraRig(); rig.setPose({ lon: e.subEarth.lon, lat: e.subEarth.lat, dist: 5, roll: 0 })
 const from = rig.camera(e, aspect, 0), target = (subject === 'earth' ? e.earthKm : e.sunKm).clone().divideScalar(MOON_R_KM)
 rig.lookToward(cam => target.clone().sub(cam.pos), false, 0, e, aspect)
 const to = rig.camera(e, aspect, 0)
 const j: LookTransition = { t0: 0, from, to, target, targetRadius: (subject === 'earth' ? 6371 : 695700) / MOON_R_KM, aspect, subject, restoreAuto: false, generation: 1 }
 assert.equal(lookTransitionAt(j, 0).cam, from); assert.equal(lookTransitionAt(j, LOOK_TRANSITION_MS).cam, to)
 for (let i = 0; i <= 220; i++) {
  const c = lookTransitionAt(j, i * 10).cam, forward = c.back.clone().negate()
  const moonDir = c.pos.clone().negate(), targetDir = target.clone().sub(c.pos)
  const moonMargin = forward.angleTo(moonDir) - Math.asin(1 / c.pos.length()), targetMargin = forward.angleTo(targetDir) - Math.asin(j.targetRadius / targetDir.length())
  assert.ok(Math.min(moonMargin, targetMargin) <= Math.atan(c.tanHalf * Math.min(1, aspect)) + .001, 'at least an actual body limb stays in vertical frustum')
  assert.ok(Number.isFinite(c.tanHalf) && c.tanHalf > 0)
 }
 const reverse: LookTransition = { ...j, from: to, to: from, target: new Vector3(), targetRadius: 1, subject: 'moon' }
 assert.equal(lookTransitionAt(reverse, LOOK_TRANSITION_MS).cam, from)
}
console.log('look-transition.test.mts: Sun/Earth framed turns, reversibility and exact endpoints: ok (pixels unrun)')
