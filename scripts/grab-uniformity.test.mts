import assert from 'node:assert/strict'
import { CameraRig, MAX_GESTURE_STEP_RAD } from '../src/camera/rig.ts'
import { angularDistance } from '../src/camera/pose.ts'
import { capGestureRotation } from '../src/camera/grab.ts'
import { ephemerisAt } from '../src/ephemeris.ts'

const e = ephemerisAt(new Date('2026-10-20T22:34:00Z'))
const turns: number[] = []
const grabTurns: number[] = []
for (const lat of [0, 45, 80, 88.9]) {
  const rig = new CameraRig()
  rig.setPose({ lon: 12, lat, dist: 4, roll: 0 })
  const before = { ...rig.pose }
  rig.spin(100, 0, 880, e, 16 / 9, 100)
  turns.push(angularDistance(before.lon, before.lat, rig.pose.lon, rig.pose.lat) * 180 / Math.PI)

  const grabbedRig = new CameraRig()
  grabbedRig.setPose({ lon: 12, lat, dist: 4, roll: 0 })
  const grabBefore = { ...grabbedRig.pose }
  const held = grabbedRig.grab({ nx: 0, ny: 0 }, { nx: 0.125, ny: 0 }, e, 16 / 9, 100)
  if (!held) grabbedRig.spin(100, 0, 880, e, 16 / 9, 100)
  grabTurns.push(angularDistance(grabBefore.lon, grabBefore.lat, grabbedRig.pose.lon, grabbedRig.pose.lat) * 180 / Math.PI)
}
const reference = turns[0]!
const grabReference = grabTurns[0]!
for (const [i, turn] of turns.entries()) {
  assert.ok(Math.abs(turn - reference) <= reference * 0.05, `100 px drag at ring index ${i} moved ${turn}°, expected ${reference}° ±5%`)
  const grabbed = grabTurns[i]!
  assert.ok(Math.abs(grabbed - grabReference) <= grabReference * 0.05, `100 px grab/fallback drag at ring index ${i} moved ${grabbed}°, expected ${grabReference}° ±5%`)
}

assert.equal(capGestureRotation(MAX_GESTURE_STEP_RAD * 3, MAX_GESTURE_STEP_RAD), MAX_GESTURE_STEP_RAD)
{
  const rig = new CameraRig()
  rig.setPose({ lon: 0, lat: 0, dist: 4 })
  const before = { ...rig.pose }
  rig.spin(100_000, 0, 880, e, 16 / 9, 100)
  const step = angularDistance(before.lon, before.lat, rig.pose.lon, rig.pose.lat)
  assert.ok(step <= MAX_GESTURE_STEP_RAD + 1e-8, `single event turn ${step} exceeds the cap`)
}

// Pick the screen vertical direction that heads toward the north pole, then cross it in small continuous events.
{
  const direction = (dy: number): number => {
    const rig = new CameraRig()
    rig.setPose({ lon: 0, lat: 88.9, dist: 4 })
    rig.spin(0, dy, 880, e, 16 / 9, 100)
    return rig.pose.lat - 88.9
  }
  const dy = direction(1) > 0 ? 1 : -1
  const rig = new CameraRig()
  rig.setPose({ lon: 0, lat: 88.9, dist: 4 })
  let prior = { ...rig.pose }
  let crossed = false
  let priorStep = 0
  for (let i = 0; i < 30; i++) {
    rig.spin(0, dy * 5, 880, e, 16 / 9, 120 + i * 16)
    const moved = angularDistance(prior.lon, prior.lat, rig.pose.lon, rig.pose.lat) * 180 / Math.PI
    assert.ok(moved > 0 && moved < 0.5, `pole-crossing step ${i} jumped or reversed (${moved}°)`)
    if (rig.pose.lon !== prior.lon && Math.abs(rig.pose.lon - prior.lon) > 90) crossed = true
    if (crossed) assert.ok(rig.pose.lat < 90, 'latitude reflects smoothly after crossing the pole')
    priorStep = moved
    prior = { ...rig.pose }
  }
  assert.ok(crossed, 'continuous vertical drag crosses the pole instead of sticking')
  assert.ok(priorStep > 0)
}
console.log('grab-uniformity.test: ok')
