/** The zoom floor over a block of deeper height tiles: as low as its texel allows inside, a cone outside, the global floor elsewhere: npm test */
import assert from 'node:assert/strict'
import { deeperFloorAt } from '../src/coverage/coverage.ts'
import { CameraRig as Rig } from '../src/camera/rig.ts'
import { SITE_CONE, angularDistance, floorDist, siteAltR } from '../src/camera/pose.ts'

const GLOBAL = 0.4738, DEEP = 0.0593
// The Apollo 11 sample block: lon 20..25, lat 0..5.
const texelKmAt = (lon0: number, lat: number): number => { const lon = ((lon0 % 360) + 540) % 360 - 180; return (lon >= 20 && lon <= 25 && lat >= 0 && lat <= 5 ? DEEP : GLOBAL) }
const view = { shortPx: 900, fovDeg: 30, texelKmAt, globalTexelKm: GLOBAL }
const globalFloor = floorDist(GLOBAL, 900, 30)

// Inside the block: one 59 m texel per canvas pixel above the ground, far below the global floor.
const inside = deeperFloorAt(22.5, 2.5, view)
assert.ok(Math.abs(inside - (1 + siteAltR(59.3, 900, 30))) < 1e-9, `inside ${inside}`)
assert.ok(inside < 1.06 && inside < globalFloor - 0.39)
// Anywhere else nothing finer is within reach: Infinity, so the global floor rules.
assert.equal(deeperFloorAt(-120, -60, view), Infinity)
assert.equal(deeperFloorAt(100, 40, view), Infinity)
// Past the edge the floor rises as a cone, never a step: monotone with distance and never below the exact cone from the block's nearest point (the search only errs high, by under a third).
let prev = inside
for (const dLon of [0.01, 0.05, 0.2, 0.8, 2, 5, 10]) {
  const f = deeperFloorAt(25 + dLon, 2.5, view)
  // The block's nearest point is on its east edge (lon 25), a little south of the parallel 2.5 (a parallel is not a great circle).
  let edge = Infinity
  for (let i = 0; i <= 50000; i++) edge = Math.min(edge, angularDistance(25 + dLon, 2.5, 25, i * 0.0001))
  const exact = 1 + siteAltR(59.3, 900, 30) + SITE_CONE * edge
  assert.ok(f >= prev - 1e-9, `rises at ${dLon}`)
  assert.ok(f >= exact - 1e-6 && f <= exact + 0.3 * (exact - 1), `cone at ${dLon}: ${f} vs ${exact}`)
  prev = f
}
// Once the cone is above the global floor the caller's min() leaves the global floor.
assert.ok(deeperFloorAt(25 + 30, 2.5, view) >= globalFloor || deeperFloorAt(25 + 30, 2.5, view) === Infinity)
// Longitude wraps and the poles do not throw.
assert.ok(deeperFloorAt(22.5 + 360, 2.5, view) === inside)
assert.doesNotThrow(() => deeperFloorAt(0, 89.9, view))

// The rig honours it per position: low over the block, the global floor beside it.
const rig = new Rig()
rig.setFloor(globalFloor)
rig.deepFloor = (lon, lat) => deeperFloorAt(lon, lat, view)
assert.ok(rig.floorAt(22.5, 2.5) < 1.06)
assert.equal(rig.floorAt(-120, -60), globalFloor)
// A camera over the block can sit at the block's floor and no lower.
rig.setPose({ lon: 22.5, lat: 2.5, dist: 1.0001 })
assert.ok(Math.abs(rig.pose.dist - inside) < 1e-9, `clamped to ${rig.pose.dist}`)
// Owner item 7 ("the view shifts unexpectedly" on a low flight): a camera that rides the floor past a block's edge must climb a slope, not a
// staircase. The ladder's cone used to start at the rung that hit (constant while it hit, then a jump of a third of the distance when the
// next rung in took over: 16 km steps at 50 km up); from the bisected edge the floor is SITE_CONE-Lipschitz along any track.
{
  const tc = (lon0: number, lat: number): number => { const lon = ((lon0 % 360) + 540) % 360 - 180; return lon >= -51 && lon <= -50 && lat >= 25.5 && lat <= 26.5 ? 0.0074 : 0.0592 }
  const v = { shortPx: 1200, fovDeg: 50, texelKmAt: tc, globalTexelKm: 0.47 }
  for (const [lat, dLat] of [[26, 0], [25.9, 0.0013], [26.6, -0.0007]] as const) {
    const steps: number[] = []
    let worst = 0
    let p = { lon: -50.2, lat }
    let fp = deeperFloorAt(p.lon, p.lat, v)
    for (let i = 1; i <= 800; i++) {
      const q = { lon: -50.2 + i * 0.004, lat: lat + i * dLat }
      const fq = deeperFloorAt(q.lon, q.lat, v)
      const step = Math.abs(fq - fp)
      steps.push(step)
      // SITE_CONE radii per radian of ground, plus the bisection's metre.
      worst = Math.max(worst, step / (SITE_CONE * angularDistance(p.lon, p.lat, q.lon, q.lat) + 1e-6))
      p = q; fp = fq
    }
    assert.ok(worst <= 1.001, `floor steps faster than its cone along lat ${lat}: ${worst.toFixed(2)}x`)
    // Not vacuous: the old ladder (`?flooredge=0`) steps on the same track.
    let legacyWorst = 0
    for (let i = 1; i <= 800; i++) {
      const a = { lon: -50.2 + (i - 1) * 0.004, lat: lat + (i - 1) * dLat }, b = { lon: -50.2 + i * 0.004, lat: lat + i * dLat }
      legacyWorst = Math.max(legacyWorst, Math.abs(deeperFloorAt(b.lon, b.lat, { ...v, edge: false }) - deeperFloorAt(a.lon, a.lat, { ...v, edge: false })) / (SITE_CONE * angularDistance(a.lon, a.lat, b.lon, b.lat)))
    }
    assert.ok(legacyWorst > 10, `the legacy ladder steps along lat ${lat} (${legacyWorst.toFixed(1)}x its cone)`)
    const sorted = [...steps].filter((x) => x > 0).sort((a, b) => a - b)
    const median = sorted[sorted.length >> 1]
    assert.ok(Math.max(...steps) <= 3 * median, `a floor step above 3x the median along lat ${lat}: ${(Math.max(...steps) * 1737.4).toFixed(2)} km vs ${(median * 1737.4).toFixed(3)} km`)
  }
  // The rig flying that track at 35 km (Vallis Schröteri, dist 1.02, below the spin altitude) climbs with it, frame by frame, without a lift.
  const r = new Rig()
  r.setFloor(1.05)
  r.deepFloor = (lo, la) => deeperFloorAt(lo, la, v)
  let last = NaN
  const lifts: number[] = []
  for (let i = 0; i <= 400; i++) {
    r.setPose({ lon: -50.5 + i * 0.004, lat: 26, dist: 1.02 })
    if (i) lifts.push(r.pose.dist - last)
    last = r.pose.dist
  }
  const up = lifts.filter((x) => x > 1e-12).sort((a, b) => a - b)
  assert.ok(up.length > 20, 'the track leaves the block and the floor lifts the camera')
  assert.ok(up.at(-1)! <= 3 * up[up.length >> 1], `a lift above 3x the median: ${(up.at(-1)! * 1737.4).toFixed(2)} km vs ${(up[up.length >> 1] * 1737.4).toFixed(3)} km`)
}
console.log('deeper-floor ok')
