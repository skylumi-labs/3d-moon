/**
 * #367 known limit, fixed: a fast near-reversal re-pick (Langrenus -> Grimaldi, re-picked back mid-flight) needed more carry excursion than
 * CARRY_MAX_EXCURSION over the usual share, the bound clipped the carried velocity and the speed stepped (181 of the simulation's 2,304 re-picks over
 * 5 %, worst 81 %). The planner now takes such a turn over a shorter share of the path, so the speed is kept and the excursion stays in the bound.
 * tsx scripts/repick-carry.test.mts
 */
import assert from 'node:assert/strict'
import { ephemerisAt } from '../src/ephemeris.ts'
import { wrapLon } from '../src/camera/pose.ts'
import { CARRY_MAX_EXCURSION, CARRY_MAX_SHRINK, CARRY_SHRINK_FADE, cameraPosition, carryShrink, planFly, type FlyEnd } from '../src/journey/path.ts'
import { repickSim } from './repick-sim.mts'

const sim = repickSim()
assert.equal(sim.cases.length, 2304)
assert.equal(new Set(sim.cases.map((c) => `${c.from}|${c.first}|${c.second}|${c.u}`)).size, 2304, 'every re-pick is distinct')
assert.ok(sim.over5 <= 10, `at most 10 of 2,304 re-picks step the speed over 5 % (${sim.over5}; 181 with the bound clipping)`)
// The harder brake of a shorter turn, against the step it replaces: the camera's largest acceleration across a re-pick, the hand-off included (main 396).
const accel = Math.max(...sim.cases.map((c) => c.accel))
assert.ok(accel < 100, `the largest acceleration across a re-pick stays under 100 radii/s^2 (${accel.toFixed(1)}; 396 with the step)`)
assert.ok(sim.worst.step < 0.1, `no re-pick steps the speed by 10 % or more (worst ${(sim.worst.step * 100).toFixed(1)} %)`)
assert.ok(sim.worstInMove.inMove < 0.25, `no frame inside a new move changes speed by a quarter of its top speed (${(sim.worstInMove.inMove * 100).toFixed(1)} %)`)

// The shrink law: none below the bound, the need itself up to CARRY_MAX_SHRINK, then fading back to none (continuous: no cliff, review of this PR).
assert.equal(carryShrink(0.5), 1); assert.equal(carryShrink(NaN), 1); assert.equal(carryShrink(4), 4)
assert.equal(carryShrink(CARRY_MAX_SHRINK), CARRY_MAX_SHRINK); assert.equal(carryShrink(CARRY_SHRINK_FADE), 1); assert.equal(carryShrink(1e6), 1)
for (let n = 1; n < CARRY_SHRINK_FADE + 2; n += 0.01) assert.ok(Math.abs(carryShrink(n + 0.01) - carryShrink(n)) < 0.02, `carryShrink is continuous at ${n.toFixed(2)}`)

// The named case: the camera keeps its speed into the turn and turns back inside the excursion bound.
{
  const e = ephemerisAt(new Date('2026-10-20T19:00:00Z'))
  const end = (lon: number, lat: number): FlyEnd => ({ pose: { lon, lat, dist: 1.06, roll: 0, pitch: 0 }, fovDeg: 30, aimShift: 0, aimShiftX: 0, look: 0 })
  const first = planFly(e, end(61, -8.9), end(-68.6, -5.2), { aspect: 1.6, feel: true })
  const u = 0.44, A = first.at(u), B = first.at(u + 16 / first.ms)
  const rate = { lon: wrapLon(B.pose.lon - A.pose.lon) / 0.016, lat: (B.pose.lat - A.pose.lat) / 0.016, dist: (B.pose.dist - A.pose.dist) / 0.016, roll: (B.pose.roll - A.pose.roll) / 0.016, pitch: 0, fov: 0 }
  const from: FlyEnd = { pose: { ...A.pose }, fovDeg: A.fovDeg, aimShift: 0, aimShiftX: 0, look: 0 }
  const back = planFly(e, from, end(61, -8.9), { aspect: 1.6, feel: true, startRate: rate })
  const v = (p: typeof back, x: number) => cameraPosition(e, p.at(x + 16 / p.ms).pose).sub(cameraPosition(e, p.at(x).pose)).length() / 0.016
  const vIn = cameraPosition(e, B.pose).sub(cameraPosition(e, A.pose)).length() / 0.016
  assert.ok(Math.abs(v(back, 0) - vIn) / vIn < 0.05, `Langrenus -> Grimaldi re-picked back keeps its speed (${v(back, 0).toFixed(3)} vs ${vIn.toFixed(3)} radii/s)`)
  let minLon = Infinity
  for (let i = 0; i <= 400; i++) minLon = Math.min(minLon, back.at(i / 400).pose.lon)
  assert.ok(A.pose.lon - minLon <= CARRY_MAX_EXCURSION.angle / Math.cos(A.pose.lat * Math.PI / 180) + 1, `the turn overshoots at most the bound (${(A.pose.lon - minLon).toFixed(1)} deg of longitude)`)
  // Continuous at CARRY_MAX_SHRINK (review: the shrink switched off at 6 and the speed fell back to 17 %): a faster start keeps a share of its speed that
  // never collapses: from 1x to 3x this case's rate the kept share falls smoothly (0.97 at 1x, 0.33 at 3x; main kept 0.19 at 1x), never by 0.1 in a 5 % step.
  let prev = 1
  for (let s = 1; s <= 3.001; s += 0.05) {
    const r = { ...rate, lon: rate.lon * s, lat: rate.lat * s, dist: rate.dist * s }
    const C = cameraPosition(e, from.pose), D = cameraPosition(e, { ...from.pose, lon: from.pose.lon + r.lon * 1e-3, lat: from.pose.lat + r.lat * 1e-3, dist: from.pose.dist + r.dist * 1e-3 })
    const kept = v(planFly(e, from, end(61, -8.9), { aspect: 1.6, feel: true, startRate: r }), 0) / (D.sub(C).length() / 1e-3)
    assert.ok(kept > 0.3 && kept <= prev + 0.01 && prev - kept < 0.1, `a ${s.toFixed(2)}x start rate keeps ${(kept * 100).toFixed(0)} % of its speed (${(prev * 100).toFixed(0)} % a step before: no collapse past the shrink limit)`)
    prev = kept
  }
  // Only the travel sets the shrink: a roll rate (a 600 deg/s whip) is clipped as before and does not sharpen the turn of the position.
  const rolled = planFly(e, from, end(61, -8.9), { aspect: 1.6, feel: true, startRate: { ...rate, roll: 600 } })
  for (const x of [0.01, 0.03, 0.1, 0.3]) assert.deepEqual(rolled.at(x).pose.lon, back.at(x).pose.lon, `a roll rate leaves the travel alone (u ${x})`)
  // Without the feel there is no carry at all (?flightfeel=0 plans exactly as before).
  const off = planFly(e, from, end(61, -8.9), { aspect: 1.6, feel: false, startRate: rate })
  const offRest = planFly(e, from, end(61, -8.9), { aspect: 1.6, feel: false })
  assert.deepEqual(off.at(0.1), offRest.at(0.1), '?flightfeel=0 ignores the start rate')
}
console.log('repick-carry: ok')
