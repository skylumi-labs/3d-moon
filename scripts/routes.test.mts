/** Apollo paths: the data's anchors, arc-length parametrisation and the fly-along's camera. npm test */
import assert from 'node:assert/strict'
import { END_PITCH, PHONE_V_HALF_DEG, offsetBy, hopsOf, FOLLOW_PITCH, MISSING, ROUTES, cumulativeKm, flatten, overviewDistFor, pointAlong, routeShot, ease, routeOwnerCheck, smoothMaxAlt } from '../src/routes/routes.ts'
import { angularDistance } from '../src/camera/pose.ts'

const descent = ROUTES.find((r) => r.id === 'a17-descent')!, trav = ROUTES.find((r) => r.id === 'a17-traverse')!
assert.ok(descent.estimated && !trav.estimated && descent.source.length > 20 && trav.source.length > 20)
// The descent ends on the Haase lunar-module position (30.7716815 E, 20.1909097 N) within the 15 m patch shift, and starts far uprange (east).
const d = flatten(descent), last = d[d.length - 1]
assert.ok(angularDistance(last[0], last[1], 30.7716815, 20.1909097) * 1737400 < 40, `touchdown ${last}`)
assert.ok(d[0][0] > last[0] + 5, 'the approach comes from the east')
assert.equal(descent.altM![descent.altM!.length - 1], 0); assert.ok(descent.altM![0] > 10000)
// The traverse lines start and end at the lunar module / the stations: one passes within 100 m of the module.
const lm = [30.7716815, 20.1909097]
assert.ok(trav.segments.some((s) => { const e = s[s.length - 1]; return angularDistance(e[0], e[1], lm[0], lm[1]) * 1737400 < 100 }), 'a traverse ends at the LM')
assert.equal(trav.segments.length, 9)
// Arc length: monotone, and the descent is hundreds of km while the rover loops are kilometres.
const cum = cumulativeKm(d)
assert.ok(cum[cum.length - 1] > 300 && cum[cum.length - 1] < 800, `descent length ${cum[cum.length - 1]}`)
assert.ok(cumulativeKm(trav.segments[7])[trav.segments[7].length - 1] > 5 && cumulativeKm(trav.segments[7]).at(-1)! < 8)
for (let i = 1; i < cum.length; i++) assert.ok(cum[i] >= cum[i - 1])
// pointAlong: ends are the ends, the middle is half way by length, bearing points west for the descent (travel toward decreasing longitude).
const p0 = pointAlong(d, cum, 0), p1 = pointAlong(d, cum, 1), pm = pointAlong(d, cum, 0.5)
assert.ok(Math.abs(p0.lon - d[0][0]) < 1e-9 && Math.abs(p1.lon - last[0]) < 1e-9)
assert.ok(Math.abs(angularDistance(d[0][0], d[0][1], pm.lon, pm.lat) * 1737.4 - cum[cum.length - 1] / 2) < 0.05 * cum[cum.length - 1])
assert.ok(pm.bearing > 240 && pm.bearing < 300, `bearing ${pm.bearing}`)

// The camera: a pure function of progress, never below the floor, overview high, end low, roll turned to the bearing.
const view = { overviewDist: overviewDistFor(cum.at(-1)!, 30), followDist: 1.02, endDist: 1.0005, floorAt: (lon: number) => 1.0003 + 0.3 * Math.max(0, Math.min(1, (lon - 31) / 18)) }
assert.ok(view.overviewDist > 1.3 && view.overviewDist < 3, `overview ${view.overviewDist}`)
const s0 = routeShot(d, cum, 0, view), s1 = routeShot(d, cum, 1, view), sm = routeShot(d, cum, 0.5, view)
assert.ok(s0.dist >= 1.3 - 1e-3, 'start respects a high floor')
assert.ok(s0.dist > sm.dist && sm.dist > s1.dist, 'it comes down')
assert.ok(Math.abs(s0.roll) < 1e-9 && Math.abs(sm.roll + (pm.bearing - 360)) < 3, 'roll = minus the signed bearing once settled (the short way round: west is +90, not -270)')
for (let i = 0; i < 100; i++) assert.ok(Math.abs(routeShot(d, cum, (i + 1) / 100, view).roll - routeShot(d, cum, i / 100, view).roll) < 25, 'roll never jumps between steps')
assert.ok(Math.abs(s1.aim.lon - last[0]) < 1e-6, 'the shot ends on the touchdown (the camera stands just behind it, looking at it)')
assert.equal(s0.pitch, 0, 'the overview is a map'); assert.ok(Math.abs(s1.pitch - 50) < 1e-9 && Math.abs(sm.pitch - FOLLOW_PITCH) < 1e-9, 'the follow is oblique, the end lands at 50')
// The horizon stays out of a phone frame: the pitch plus the phone's vertical half-angle stays under the 84 degrees where the limb is from a kilometre up.
assert.ok(FOLLOW_PITCH + PHONE_V_HALF_DEG < 84 && END_PITCH + PHONE_V_HALF_DEG < 84, 'no horizon in a phone frame')
assert.equal(descent.utc, '1972-12-11T19:54:58Z')
for (let i = 0; i <= 100; i++) assert.ok(routeShot(d, cum, i / 100, view).dist >= view.floorAt(routeShot(d, cum, i / 100, view).lon) - 1e-9)
assert.ok(ease(0) === 0 && ease(1) === 1 && ease(0.5) === 0.5)
// Missing paths are listed, not drawn.
assert.ok(MISSING.length >= 4 && ROUTES.every((r) => r.mission === 'a17'))
console.log('routes.test ok')

// Continuity (the "no cheating" rule): sampled at 60 fps for the show's length, no channel has a step or a kink the curve itself does not have.
{
  const N = 26 * 60
  const ch = (f: (i: number) => number) => { const v = Array.from({ length: N + 1 }, (_, i) => f(i / N)); return v }
  const shots = Array.from({ length: N + 1 }, (_, i) => routeShot(d, cum, i / N, view))
  const channels: Record<string, number[]> = {
    // The followed point runs the polyline; the camera stands behind it (checked below), so the polyline's bound applies to the point.
    lon: shots.map((s) => s.aim.lon), lat: shots.map((s) => s.aim.lat), logAlt: shots.map((s) => Math.log(s.dist - 1)), roll: shots.map((s) => s.roll), pitch: shots.map((s) => s.pitch),
  }
  void ch
  let camStep = 0
  for (let i = 1; i < shots.length; i++) camStep = Math.max(camStep, angularDistance(shots[i].lon, shots[i].lat, shots[i - 1].lon, shots[i - 1].lat) * 1737.4)
  assert.ok(camStep < 1.5, `camera step per frame ${camStep} km`)
  for (const [name, v] of Object.entries(channels)) {
    const range = Math.max(...v) - Math.min(...v) || 1
    let maxStep = 0, maxKink = 0
    for (let i = 1; i < v.length; i++) maxStep = Math.max(maxStep, Math.abs(v[i] - v[i - 1]))
    for (let i = 1; i < v.length - 1; i++) maxKink = Math.max(maxKink, Math.abs(v[i + 1] - 2 * v[i] + v[i - 1]))
    // A quintic-eased move over N frames has a largest step of 1.875 range / N and a largest second difference well under 10 range / N^2 * (a few).
    // Each channel moves within its own window of the show (the rise, the follow, the fall): the bound is for that many frames.
    const frames = N * (name === 'lon' || name === 'lat' ? 0.76 : 0.12)
    assert.ok(maxStep <= 6 * range / frames * 1.875 + 1e-9, `${name} step ${maxStep} of range ${range}`)
    // lon/lat follow the polyline, whose vertices are the data's own corners (the 5 s samples): only their step is bounded.
    // logAlt meets the ground floor in a corner of its slope (continuous value), so only its step is bounded as well.
    if (name === 'roll' || name === 'pitch') assert.ok(maxKink <= 60 * range / (frames * frames) + 1e-9, `${name} kink ${maxKink} of range ${range}`)
  }
}
console.log('routes continuity ok')

// Camera ownership (review P1-1): any other owner ends the show; only its own approach tween is waited for. Neutering the owner list or the
// own-tween identity makes the Home-during-route cases below fail.
{
  const idle = { ridge: false, descent: false, flight: false, ground: false, orbitJourney: false, approach: false, tween: null, ownTween: null, phase: 'along' as const }
  const mine = {}, home = {}
  assert.equal(routeOwnerCheck(idle), 'go')
  assert.equal(routeOwnerCheck({ ...idle, phase: 'approach', tween: mine, ownTween: mine }), 'wait', 'its own approach tween is waited for')
  assert.equal(routeOwnerCheck({ ...idle, phase: 'approach', tween: home, ownTween: mine }), 'cancel', 'Home during the approach ends the show')
  assert.equal(routeOwnerCheck({ ...idle, phase: 'along', tween: home, ownTween: mine }), 'cancel', 'Home while following ends the show')
  assert.equal(routeOwnerCheck({ ...idle, phase: 'along', tween: mine, ownTween: mine }), 'cancel', 'a tween during the follow is never the show\'s')
  for (const k of ['ridge', 'descent', 'flight', 'ground', 'orbitJourney', 'approach'] as const) assert.equal(routeOwnerCheck({ ...idle, [k]: true }), 'cancel', k)
}
// The follow height meets a floor without a corner and never goes below it (review P2-6).
{
  assert.ok(smoothMaxAlt(1.01, 1.001) >= 1.01 && smoothMaxAlt(1.001, 1.01) >= 1.01)
  assert.ok(Math.abs(smoothMaxAlt(1.01, 1.00001) - 1.01) < 1e-5, 'far below the follow height the floor changes nothing')
  const ramp = (x: number): number => 1 + Math.exp(Math.log(0.0002) + (Math.log(0.05) - Math.log(0.0002)) * x)
  let maxKink = 0, maxKinkHard = 0
  const f = (x: number, hard: boolean): number => Math.log((hard ? Math.max(1.003, ramp(x)) : smoothMaxAlt(1.003, ramp(x))) - 1)
  for (let i = 1; i < 1000; i++) {
    maxKink = Math.max(maxKink, Math.abs(f((i + 1) / 1000, false) - 2 * f(i / 1000, false) + f((i - 1) / 1000, false)))
    maxKinkHard = Math.max(maxKinkHard, Math.abs(f((i + 1) / 1000, true) - 2 * f(i / 1000, true) + f((i - 1) / 1000, true)))
  }
  assert.ok(maxKink < maxKinkHard / 4, `smooth ${maxKink} vs hard ${maxKinkHard}`)
}
console.log('routes ownership ok')

// The traverse (review P1-2): a chase camera that keeps the followed point in the middle of the frame, a roll that never whips, hops that are not road.
{
  const t = flatten(trav), tc = cumulativeKm(t)
  const tv = { overviewDist: overviewDistFor(tc.at(-1)!, 30), followDist: 1 + 1 / 1737.4, endDist: 1.0006, seconds: 14, floorAt: () => 1 - 2.6 / 1737.4 }
  assert.equal(hopsOf(tc).length, 2, 'two hops between legs (2.4 and 4.9 km)')
  assert.equal(hopsOf(cum).length, 0, 'the descent has none')
  const N = 1000, shots = Array.from({ length: N + 1 }, (_, i) => routeShot(t, tc, i / N, tv))
  let maxRate = 0, maxStepKm = 0
  for (let i = 1; i <= N; i++) {
    maxRate = Math.max(maxRate, Math.abs(shots[i].roll - shots[i - 1].roll) / (14 / N))
    maxStepKm = Math.max(maxStepKm, angularDistance(shots[i].lon, shots[i].lat, shots[i - 1].lon, shots[i - 1].lat) * 1737.4)
  }
  assert.ok(maxRate < 90, `roll rate ${maxRate.toFixed(1)} deg/s`)
  assert.ok(maxStepKm < 0.2, `camera step per 0.1 % ${maxStepKm}`)
  // Mid-follow the camera stands behind the followed point by height * tan(pitch), on the line the screen's up points along.
  const m = shots[500], hKm = (m.dist - (1 - 2.6 / 1737.4)) * 1737.4
  const back = angularDistance(m.lon, m.lat, m.aim.lon, m.aim.lat) * 1737.4
  assert.ok(Math.abs(back - hKm * Math.tan(m.pitch * Math.PI / 180)) < 0.02 * hKm + 0.05, `behind by ${back} km at ${hKm} km up`)
  const o = offsetBy(10, 20, 90, 100)
  assert.ok(Math.abs(angularDistance(10, 20, o.lon, o.lat) * 1737.4 - 100) < 1e-6 && o.lon > 10, 'offsetBy goes the distance, east')
  assert.ok(Math.abs(shots[N].pitch - END_PITCH) < 1e-9)
}
console.log('routes traverse ok')
