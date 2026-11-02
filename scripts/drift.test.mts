// A still camera stays still: no idle orbit unless ?auto=1 (owner, 4 Oct 2026: "the Moon slowly drifts off to the side").
import assert from 'node:assert/strict'
import { CameraRig, idleOrbitOn } from '../src/camera/rig.ts'

assert.equal(idleOrbitOn('', false), false, 'off by default')
assert.equal(idleOrbitOn('?auto=0', false), false)
assert.equal(idleOrbitOn('?auto=1', false), true, 'opt in')
assert.equal(idleOrbitOn('?auto=1', true), false, 'never in a captured still')

function driftOver(seconds: number, auto: boolean): number {
  const rig = new CameraRig()
  rig.auto = auto
  rig.setPose({ lon: 10, lat: 5, dist: 3 })
  const t0 = 1_000_000
  let now = t0
  rig.step(now, 0.016)
  for (let i = 0; i < seconds * 60; i++) { now += 1000 / 60; rig.step(now, 1 / 60) }
  return Math.abs(rig.pose.lon - 10) + Math.abs(rig.pose.lat - 5)
}
const rig0 = new CameraRig()
assert.equal(rig0.auto, false, 'the rig starts without an idle orbit')
assert.equal(driftOver(120, rig0.auto), 0, 'no drift in 120 s of stillness')
assert.ok(driftOver(120, true) > 30, 'control: with the idle orbit on the camera does move (0.6 deg/s)')
console.log('drift ok')
