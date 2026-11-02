/** The fly-to tween eases BOTH aim shifts, so a moment's descent never snaps the sideways aim (wave 1 P1-1). tsx scripts/tween.test.mts */
import assert from 'node:assert/strict'
import { blendFloorDistance, floorBlendDuration, floorBoundEndDistance, sampleEffectiveFloorState, sampleFloorBlend, sampleFloorCorrection, tweenAt, planFly, type FlyTween } from '../src/camera/tween.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { CameraRig } from '../src/camera/rig.ts'

const e = ephemerisAt(new Date('2026-10-20T19:00:00Z'))
const pose = { lon: 0, lat: 0, dist: 4, roll: 0, pitch: 0 }
const plan = planFly(e,
  { pose, fovDeg: 30, aimShift: 0.2, aimShiftX: 0.4, look: 0 },
  { pose: { ...pose, dist: 1.3 }, fovDeg: 30, aimShift: 0, aimShiftX: 0, look: 0 }, { aspect: 1.6, ms: 2200 })
const tw: FlyTween = { t0: 1000, plan }

const s0 = tweenAt(tw, 1000)
assert.equal(s0.aimX, 0.4, 'starts at the aim the previous moment left')
assert.equal(s0.aim, 0.2)
const mid = tweenAt(tw, 2100)
assert.ok(mid.aimX > 0 && mid.aimX < 0.4, `sideways aim eases in between (${mid.aimX})`)
assert.ok(Math.abs(mid.aimX - 0.2) < 1e-9, 'the ease is symmetric about its midpoint')
const end = tweenAt(tw, 3200)
assert.equal(end.aimX, 0, 'ends at zero, so startDescent finds nothing to snap')
assert.equal(end.done, true)
assert.equal(blendFloorDistance(1.1, 1.1, 0.5), 1.1, 'an unchanged floor cannot move the endpoint')
assert.ok(blendFloorDistance(1.1, 1.2, 0.5) > 1.1 && blendFloorDistance(1.1, 1.2, 0) === 1.1 && blendFloorDistance(1.1, 1.2, 1) === 1.2, 'a raised arrival floor blends over the lag window')
const floorBlend = { from: 1.2, to: 1.1, t0: 5000 }
assert.equal(sampleFloorBlend(floorBlend, 5000), 1.2, 'floor blend starts at the instant the floor changes')
assert.ok(sampleFloorBlend(floorBlend, 5200) < 1.2 && sampleFloorBlend(floorBlend, 5200) > 1.1, 'a lowered floor is followed gradually')
assert.ok(Math.abs(sampleFloorBlend(floorBlend, 5000 + floorBlendDuration(floorBlend)) - 1.1) < 1e-12, 'a larger floor blend completes after its scaled duration')
assert.equal(floorBlendDuration({ from: 1.2, to: 1.21, t0: 0 }), 400, 'small floor changes use the 400 ms minimum')
assert.ok(Math.abs(floorBlendDuration(floorBlend) - 1000 * 0.1 / 0.06) < 1e-9, 'duration scales at 0.06 radii per second')
const largestFloorBlend = { from: 1.1, to: 1.3, t0: 0 }
assert.ok(Math.abs(floorBlendDuration(largestFloorBlend) - 1000 * 0.2 / 0.06) < 1e-9, 'a 0.2 radius floor change uses the scaled duration')
for (let t = 16; t <= floorBlendDuration(largestFloorBlend); t += 16) {
  assert.ok(Math.abs(sampleFloorBlend(largestFloorBlend, t) - sampleFloorBlend(largestFloorBlend, t - 16)) <= 1e-3 + 1e-12,
    `the largest supported floor blend stays within 1e-3 per 16 ms at ${t} ms`)
}
const changedMidFlight = { from: 2.35, to: 1.4, t0: 7000 }
assert.equal(sampleFloorBlend(changedMidFlight, 7000), 2.35, 'a mid-flight floor update begins at the distance shown in the previous frame')
assert.ok(sampleFloorBlend(changedMidFlight, 7200) < 2.35 && sampleFloorBlend(changedMidFlight, 7200) > 1.4,
  'the floor lag is measured from its own change time, independently of the tween progress')
const floorRig = new CameraRig(); floorRig.setFloor(1.4); floorRig.setPose({ lon: 0, lat: 0, dist: 1.2 }, 1.2)
assert.equal(floorRig.pose.dist, 1.2, 'the endpoint clamp itself follows the blended floor instead of snapping to the new floor')
assert.equal(floorBoundEndDistance(true, 1.2, 1.1), 1.1, 'a floor-bound planned endpoint follows a lowered floor')
assert.equal(floorBoundEndDistance(true, 1.2, 1.3), 1.3, 'a floor-bound planned endpoint follows a raised floor')
assert.equal(floorBoundEndDistance(false, 1.25, 1.1), 1.25, 'a freely requested endpoint does not move below its requested distance')
const blendState = { from: 1.2, to: 1.4, t0: 0, base: 1.2 }
const freeFloorState = sampleEffectiveFloorState(1.5, 1.4, blendState, floorBlendDuration(blendState), false, 1.5)
const boundFloorState = sampleEffectiveFloorState(1.2, 1.4, blendState, floorBlendDuration(blendState), true, 1.2)
assert.ok(freeFloorState.floor === 1.4 && Math.abs(freeFloorState.dist - 1.5) < 1e-12, 'the effective true floor does not move a freely requested endpoint')
assert.ok(boundFloorState.floor === 1.4 && Math.abs(boundFloorState.dist - 1.4) < 1e-12, 'the same effective floor sets a floor-bound planned endpoint')
// R12: a changed endpoint contributes a continuous correction to every sampled pose, including a drop that finishes well before arrival.
for (const [changeAt, delta] of [[300, -0.1], [800, 0.1], [1700, -0.08], [2200, 0.08]]) {
  const from = 1.2 - delta
  const blend = { from, to: 1.2, t0: changeAt }
  const planned = (ms: number): number => 1.8 - 0.6 * Math.min(2400, ms) / 2400
  const distAt = (ms: number): number => sampleFloorCorrection(planned(ms), blend, ms)
  const averageFrameRate = (0.6 + Math.abs(delta)) / 2400 * 16
  let prior = distAt(0)
  for (let ms = 16; ms <= 2800; ms += 16) {
    const current = distAt(ms)
    assert.ok(Math.abs(current - prior) < averageFrameRate * 3, `floor ${delta > 0 ? 'rise' : 'drop'} at ${changeAt}ms stays continuous (${prior} -> ${current})`)
    prior = current
  }
  const duration = floorBlendDuration(blend)
  if (changeAt + duration <= 2400) assert.ok(Math.abs(distAt(2400) - (1.2 + delta)) < 1e-9, `floor correction has reached the endpoint at arrival when its blend finished before arrival (${changeAt})`)
  assert.ok(Math.abs(distAt(changeAt + duration) - planned(changeAt + duration) - delta) < 1e-9, 'the corrected endpoint is applied after the size-scaled blend')
}
const firstFloorChange = { from: 1.3, to: 1.2, t0: 300, base: 1.3 }
const secondFloorChange = { from: sampleFloorBlend(firstFloorChange, 500), to: 1.25, t0: 500, base: firstFloorChange.base }
assert.ok(Math.abs(sampleFloorCorrection(1.5, firstFloorChange, 500) - sampleFloorCorrection(1.5, secondFloorChange, 500)) < 1e-12,
  'a second floor update carries forward the correction already applied')
// R13: a single effective floor constrains every tween frame while shifting the same planned path.
for (const [name, from, to] of [['drop', 1.3, 1.2], ['rise', 1.2, 1.3]] as const) {
  const t0 = name === 'rise' ? 5000 : 1000
  const blend = { from, to, t0, base: from }
  const times = Array.from({ length: 28 }, (_, i) => t0 - 16 + i * 16)
  const shown = times.map((time) => {
    const path = 1.4 + (time - t0) * 0.00024
    const state = sampleEffectiveFloorState(path, to, blend, time, true, 0.9)
    return { time, floor: state.floor, dist: Math.max(state.floor, state.dist), path }
  })
  for (const frame of shown) assert.ok(frame.dist >= frame.floor, `${name}: displayed distance stays above the effective floor at ${frame.time}`)
  const averageUncorrectedStep = Math.abs(shown.at(-1)!.path - shown[0].path) / (shown.length - 1)
  for (let i = 1; i < shown.length; i++) {
    const step = Math.abs(shown[i]!.dist - shown[i - 1]!.dist)
    assert.ok(step <= Math.max(3 * averageUncorrectedStep, 1e-3), `${name}: no floor jump at ${shown[i]!.time}ms (${shown[i - 1]!.dist} -> ${shown[i]!.dist})`)
  }
  assert.ok(Math.abs(shown[1]!.dist - shown[1]!.path) < 1e-12, `${name}: starts continuously at the prior floor`)
  const completeFrame = times.findIndex((time) => time >= t0 + floorBlendDuration(blend))
  if (completeFrame >= 0) assert.ok(Math.abs(shown[completeFrame]!.floor - to) < 1e-12, `${name}: reaches the true floor after its scaled duration`)
  assert.ok(shown[6]!.dist >= shown[6]!.floor, `${name}: remains clamped after arrival`)
}
// Monotone: no step larger than a frame's share.
let prev = 0.4
for (let t = 1000; t <= 3200; t += 16) { const x = tweenAt(tw, t).aimX; assert.ok(x <= prev + 1e-12 && prev - x < 0.03, `step at ${t}`); prev = x }
console.log('tween ok')
