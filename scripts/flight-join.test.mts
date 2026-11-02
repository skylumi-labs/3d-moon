/** WP7b (A5): the fly-to blends into the flight or orbit without stopping. Position, then speed, are continuous through the join. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JOIN_GLIDE_MS, cameraPosition, easeEnd, easeGlide, glideSlopeMax, planFly, ease, type FlyEnd } from '../src/journey/path.ts'
import { JOIN_LEAD_SPAN, JOIN_MAX_GAP_MS, STALL_MS, joinLead, joinLeadDecay, journeyClockStart, leadStartRate, stallShift } from '../src/journey/join.ts'
import { ORBIT_SECONDS, ORBIT_START_ARC_DEG, orbitAngleDeg } from '../src/journey/lifecycle.ts'
import { getCinematicFlight, sampleCinematicFlight } from '../src/cinematics/flights.ts'
import { homePose, type Pose } from '../src/camera/pose.ts'
import { momentPose } from '../src/momentPose.ts'
import { ephemerisAt } from '../src/ephemeris.ts'

const e = ephemerisAt(new Date('2026-10-20T19:00:00Z'))
const floorAt = () => 1.0005, groundAt = () => 0
const end = (pose: Pose, fovDeg = 30): FlyEnd => ({ pose, fovDeg, aimShift: 0, aimShiftX: 0, look: 0 })
const FPS = 60

// The lead-in keeps total progress monotone, 0 to 1, and is gone after its span.
{
  for (const seconds of [19, 25, 30, 36, 70]) {
    let prev = -1
    for (let i = 0; i <= 2000; i++) {
      const u = i / 2000
      const t = ease(u) + joinLead(u, 1, seconds)
      assert.ok(t >= prev - 1e-12, `${seconds} s flight progress is monotone at u=${u}`)
      prev = t
    }
    assert.equal(joinLead(0, 1, seconds), 0); assert.equal(joinLead(JOIN_LEAD_SPAN, 1, seconds), 0); assert.equal(joinLead(0.1, 0, seconds), 0)
    assert.ok(Math.abs((joinLead(1e-5, 1, seconds) - joinLead(0, 1, seconds)) / 1e-5 - 1) < 0.01, `${seconds} s: starts at one mean speed`)
  }
  let a = -1
  for (let i = 0; i <= 4000; i++) { const g = orbitAngleDeg(i / 4000, 1); assert.ok(g >= a - 1e-9, `orbit angle is monotone at ${i}`); a = g }
  assert.equal(orbitAngleDeg(1, 1), 360); assert.equal(orbitAngleDeg(0, 1), 0); assert.equal(orbitAngleDeg(0.5, 1), orbitAngleDeg(0.5))
}

// The time ease: zero start slope, the asked end slope, monotone.
{
  for (const c of [0, 0.05, 0.5, 1.5]) {
    let prev = -1
    for (let i = 0; i <= 1000; i++) { const k = easeEnd(i / 1000, c); assert.ok(k >= prev - 1e-12, `easeEnd(c=${c}) monotone`); prev = k }
    assert.ok(Math.abs(easeEnd(1, c) - 1) < 1e-12 && easeEnd(0, c) === 0)
    assert.ok(Math.abs((easeEnd(1, c) - easeEnd(1 - 1e-5, c)) / 1e-5 - c) < 1e-3, `end slope ${c}`)
  }
  assert.equal(easeEnd(0.37, 0), ease(0.37), 'c = 0 is the old quintic')
}

/** Speeds (R/s) of a camera path sampled at FPS, one per frame step. */
function speeds(poses: Pose[]): number[] {
  const out: number[] = []
  for (let i = 1; i < poses.length; i++) out.push(cameraPosition(e, poses[i]).distanceTo(cameraPosition(e, poses[i - 1])) * FPS)
  return out
}

function checkJoin(name: string, from: Pose, startPose: Pose, flightPose: (u: number, lead: number) => Pose, seconds: number, leadPose: (u: number) => Pose): void {
  const target = end(startPose)
  const rate = leadStartRate(leadPose, seconds)
  const p0 = leadPose(0)
  const v1 = cameraPosition(e, { ...p0, lon: p0.lon + rate.lon * 1e-3, lat: p0.lat + rate.lat * 1e-3, dist: p0.dist + rate.dist * 1e-3 }).distanceTo(cameraPosition(e, p0)) / 1e-3
  const plan = planFly(e, end(from), target, { aspect: 1.6, endRate: rate })
  assert.ok(plan.endSlope > 0, `${name}: the fly-to is planned to end moving`)
  const tweenFrames = Math.round(plan.ms / 1000 * FPS)
  const poses: Pose[] = []
  for (let i = 0; i <= tweenFrames; i++) poses.push(plan.at(i / tweenFrames).pose)
  const joinIndex = poses.length - 1
  // Position is continuous through the hand-over: the flight's first frame is the fly-to's last.
  const flightFrames = Math.round(Math.min(seconds * 0.3, 12) * FPS)
  for (let i = 1; i <= flightFrames; i++) poses.push(flightPose(i / FPS / seconds, 1))
  const v = speeds(poses)
  const first = cameraPosition(e, flightPose(0, 1)), last = cameraPosition(e, plan.at(1).pose)
  assert.ok(first.distanceTo(last) < 1e-6, `${name}: the join is continuous in position`)
  // Speed at the join (the step across it) within 20 % of the flight's starting speed.
  const atJoin = v[joinIndex] // step from the fly-to's last frame to the flight's first stepped frame
  const before = v[joinIndex - 1]
  assert.ok(Math.abs(atJoin - v1) / v1 < 0.2, `${name}: speed after the join ${atJoin.toFixed(4)} vs the flight's start ${v1.toFixed(4)} R/s`)
  assert.ok(Math.abs(before - v1) / v1 < 0.2, `${name}: speed before the join ${before.toFixed(4)} vs the flight's start ${v1.toFixed(4)} R/s`)
  // The velocity VECTOR is continuous: the angle between the fly-to's end velocity and the flight's start velocity (position space).
  {
    const dt = 0.01
    const pEnd = cameraPosition(e, plan.at(1).pose), pBefore = cameraPosition(e, plan.at(1 - dt / (plan.ms / 1000)).pose)
    const pAfter = cameraPosition(e, flightPose(dt / seconds, 1))
    const vIn = pEnd.clone().sub(pBefore), vOut = pAfter.clone().sub(pEnd)
    const angle = vIn.angleTo(vOut) * 180 / Math.PI
    assert.ok(angle < 10, `${name}: velocity direction turns ${angle.toFixed(1)} deg at the join`)
  }
  // No frame near the join drops below 30 % of its neighbours' average (the old hand-over stood at ~0).
  for (let i = Math.max(1, joinIndex - 30); i <= Math.min(v.length - 2, joinIndex + 30); i++) {
    const avg = (v[i - 1] + v[i + 1]) / 2
    assert.ok(v[i] >= 0.3 * avg, `${name}: frame ${i - joinIndex} speed ${v[i].toFixed(4)} is under 30 % of its neighbours' ${avg.toFixed(4)}`)
  }
  // And the camera keeps moving for the first second after the join (the lead-in is time-based, so even the 19 s Earthrise holds its speed).
  for (let i = joinIndex; i < Math.min(v.length, joinIndex + FPS); i++) assert.ok(v[i] > 0.5 * v1, `${name}: still moving ${i - joinIndex} frames after the join`)
  // No dip-then-restart in the first 3 s: speed stays above 30 % of the join's (the flight's own ease from rest used to leave 10 % at 1.9 s).
  for (let i = joinIndex; i < Math.min(v.length, joinIndex + 3 * FPS); i++) assert.ok(v[i] > 0.3 * v1, `${name}: speed ${(v[i] / v1).toFixed(2)} of the join's at ${((i - joinIndex) / FPS).toFixed(2)} s`)
}

// Cinematic flights: tycho-rim, surface (Copernicus), plato-rim, earthrise.
for (const id of ['tycho-rim', 'copernicus-flyover', 'plato-rim', 'apollo8-earthrise', 'solar-eclipse', 'terminator-run']) {
  const flight = getCinematicFlight(id)!
  assert.ok(flight, id)
  const at = (u: number, lead: number): Pose => sampleCinematicFlight(flight, u, e, floorAt, groundAt, lead).pose
  assert.equal(at(0, 1).lon, at(0, 0).lon, `${id}: the lead-in leaves the start pose alone`)
  assert.ok(Math.abs(at(0.5, 1).lon - at(0.5, 0).lon) < 1e-12, `${id}: the route after the lead-in is unchanged`)
  checkJoin(id, homePose(e), at(0, 0), at, flight.seconds, (u) => at(u, 1))
  checkJoin(`${id} (near start)`, { ...at(0, 0), lon: at(0, 0).lon + 15, lat: at(0, 0).lat * 0.8, dist: 3 }, at(0, 0), at, flight.seconds, (u) => at(u, 1))
}

// Fly-around: the orbit starts ORBIT_START_ARC_DEG (50) east of the sub-Sun point at 5 radii, on the lit side, well before the Sun sets behind the limb.
{
  const pose = momentPose({ at: 'sunArc', dist: 5, arcDeg: -ORBIT_START_ARC_DEG }, e)
  const at = (u: number, lead: number): Pose => ({ ...pose, lon: pose.lon + orbitAngleDeg(u, lead), roll: 0, pitch: 0 })
  checkJoin('fly-around', { ...homePose(e), lon: pose.lon + 100 }, { ...pose, roll: 0, pitch: 0 }, at, ORBIT_SECONDS, (u) => at(u, 1))
  checkJoin('fly-around (home)', homePose(e), { ...pose, roll: 0, pitch: 0 }, at, ORBIT_SECONDS, (u) => at(u, 1))
  checkJoin('fly-around (near start)', { ...pose, lon: pose.lon + 20, dist: 7 }, { ...pose, roll: 0, pitch: 0 }, at, ORBIT_SECONDS, (u) => at(u, 1))
}

// The Sun is hidden by the Moon from the camera (its centre inside the Moon's disc, 11.5 deg at 5 radii) only in the slow stretch, some seconds after the start (the lit side comes first).
{
  const pose = momentPose({ at: 'sunArc', dist: 5, arcDeg: -ORBIT_START_ARC_DEG }, e)
  const hidden = (u: number): boolean => {
    const cam = cameraPosition(e, { ...pose, lon: pose.lon + orbitAngleDeg(u), roll: 0, pitch: 0 }).normalize()
    return -e.sunDir.clone().normalize().dot(cam) > Math.cos(Math.asin(1 / 5))
  }
  assert.equal(hidden(0), false, 'the Sun is in view at the start')
  let first = -1, last = -1
  for (let i = 0; i <= 3000; i++) if (hidden(i / 3000)) { if (first < 0) first = i / 3000; last = i / 3000 }
  assert.ok(first > 0 && last > first, 'the Sun goes behind the Moon and comes out again')
  assert.ok(first * ORBIT_SECONDS > 4 && first * ORBIT_SECONDS < 9, `it sets after the lit side has been seen, within the first half of the flight (${(first * ORBIT_SECONDS).toFixed(1)} s)`)
  assert.ok((last - first) * ORBIT_SECONDS > 3, `and stays behind the Moon for a few seconds, slowly (${((last - first) * ORBIT_SECONDS).toFixed(1)} s)`)
  assert.ok(last * ORBIT_SECONDS < 14, 'the whole sunset and sunrise is in the first half')
}

// The hand-over frames: the fly-to's last frame draws the flight's start pose, so the first frame after it must move on (it used to repeat it exactly).
{
  const flight = getCinematicFlight('tycho-rim')!
  const at = (u: number): Pose => sampleCinematicFlight(flight, u, e, floorAt, groundAt, 1).pose
  const plan = planFly(e, end(homePose(e)), end(at(0)), { aspect: 1.6, endRate: leadStartRate(at, flight.seconds) })
  assert.ok(plan.endSlope > 0)
  for (const frameMs of [16.7, 33.3, 50]) {
    for (const fixed of [false, true]) {
      const t0 = 1000
      let now = t0, shown = cameraPosition(e, plan.at(0).pose), handOverAt: number | null = null, jt0 = -1, firstMove = -1
      for (let guard = 0; guard < 100000 && firstMove < 0; guard++, now += frameMs) {
        const prev = shown
        if (handOverAt === null) {
          const done = now >= t0 + plan.ms
          shown = cameraPosition(e, plan.at(Math.min(1, (now - t0) / plan.ms)).pose)
          if (done) handOverAt = now
        } else {
          if (jt0 < 0) jt0 = journeyClockStart(now, fixed ? handOverAt : null, 0, flight.seconds)
          shown = cameraPosition(e, at(Math.min(1, (now - jt0) / (flight.seconds * 1000))))
          firstMove = shown.distanceTo(prev)
        }
      }
      if (fixed) assert.ok(firstMove > 1e-5, `first frame after the join moves (${frameMs} ms frames): ${firstMove}`)
      else assert.ok(firstMove < 1e-6, `the old clock repeats the last pose: ${firstMove}`)
    }
  }
}

// The glide: easeEnd up to 1 - g, then straight on at the end slope; continuous in value, slope and curvature, monotone, ends at 1.
{
  const d = 1e-6
  for (const g of [0.1, 0.15, 0.25]) {
    for (const c of [0.001, 0.05, 0.5, glideSlopeMax(g)]) {
      let prev = -1
      for (let i = 0; i <= 2000; i++) { const k = easeGlide(i / 2000, c, g); assert.ok(k >= prev - 1e-12, `easeGlide(c=${c}, g=${g}) monotone`); prev = k }
      assert.equal(easeGlide(0, c, g), 0); assert.ok(Math.abs(easeGlide(1, c, g) - 1) < 1e-12)
      const a = 1 - g
      const slope = (x: number): number => (easeGlide(x + d, c, g) - easeGlide(x - d, c, g)) / (2 * d)
      assert.ok(Math.abs(slope(a - 1e-4) - c) < 1e-3 * Math.max(1, c) && Math.abs(slope(a + 1e-4) - c) < 1e-9 + 1e-6, `slope continuous at the glide (c=${c}, g=${g})`)
      assert.ok(Math.abs(slope(1 - 2e-6) - c) < 1e-6, 'the glide holds the end slope')
      // The eased part never needs more than END_SLOPE_MAX at its end, so it keeps the same monotone margin as easeEnd.
      assert.ok(c * a / (1 - c * g) <= 1.5 + 1e-9)
    }
  }
  assert.equal(easeGlide(0.37, 0.2, 0), easeEnd(0.37, 0.2), 'g = 0 is easeEnd')
}

// The plateau lead-in: the flight keeps most of the join's speed for its first seconds and never stalls later (rig R3 2026-10-21: Earthrise fell to
// 0.35 of the join's speed within 3 s; a 70 s flight to 0.07 of a mean speed at 15 s).
{
  for (const seconds of [19, 25, 30, 36, 45, 60, 70]) {
    const du = 1e-6, sp = (u: number): number => (ease(u + du) + joinLead(u + du, 1, seconds) - ease(u) - joinLead(u, 1, seconds)) / du
    let min3 = Infinity, minAll = Infinity
    for (let t = 0; t <= seconds * JOIN_LEAD_SPAN; t += 0.02) { const v = sp(t / seconds); if (t <= 3) min3 = Math.min(min3, v); minAll = Math.min(minAll, v) }
    assert.ok(min3 > 0.8, `${seconds} s: ${min3.toFixed(2)} of the join's speed at worst in the first 3 s`)
    assert.ok(minAll > 0.4, `${seconds} s: ${minAll.toFixed(2)} mean speeds at worst while the lead-in runs`)
  }
  // The orbit keeps its own decaying lead: the slow stretch over the sunset stays above the 1.5 deg/s freeze floor with it.
  const du = 1e-6
  for (let u = 0.04; u < 0.5; u += 0.001) {
    const degPerS = (orbitAngleDeg(u + du, 1) - orbitAngleDeg(u, 1)) / du / ORBIT_SECONDS
    assert.ok(degPerS > 1.5, `orbit at u=${u.toFixed(3)}: ${degPerS.toFixed(2)} deg/s`)
  }
  assert.ok(Math.abs(orbitAngleDeg(0.2, 1) - orbitAngleDeg(0.2) - 360 * joinLeadDecay(0.2, 1, ORBIT_SECONDS)) < 1e-9, 'the orbit uses the decaying lead')
}

// R3's own measure on the planned paths: the median speed over the fly-to's last 600 ms against the slowest 150 ms bin of the flight's first 3 s.
// The rig fails below 0.3 (rig 2026-10-21: surface 0.19, Earthrise 0.07, as the fly-to was still decelerating into the join); these keep a margin.
{
  const med = (a: number[]): number => { const s2 = [...a].sort((x, y) => x - y); return s2.length % 2 ? s2[s2.length >> 1] : (s2[s2.length / 2 - 1] + s2[s2.length / 2]) / 2 }
  const r3 = (from: Pose, flightPose: (u: number, lead: number) => Pose, seconds: number): number => {
    const at = (u: number): Pose => flightPose(u, 1)
    const plan = planFly(e, end(from), end(flightPose(0, 0)), { aspect: 0.45, endRate: leadStartRate(at, seconds) })
    const n = Math.round(plan.ms / 1000 * FPS)
    const pts: Array<[number, ReturnType<typeof cameraPosition>]> = []
    for (let i = 0; i <= n; i++) pts.push([i / FPS - plan.ms / 1000, cameraPosition(e, plan.at(i / n).pose)])
    for (let i = 1; i <= 3.2 * FPS; i++) pts.push([i / FPS, cameraPosition(e, at(i / FPS / seconds))])
    const bins = (t0: number, t1: number): number[] => {
      const out: number[] = []
      for (let a = t0; a + 0.15 <= t1 + 1e-9; a += 0.15) {
        const w = pts.filter((p) => p[0] >= a && p[0] < a + 0.15)
        let path = 0; for (let i = 1; i < w.length; i++) path += w[i][1].distanceTo(w[i - 1][1])
        out.push(path / (w[w.length - 1][0] - w[0][0]))
      }
      return out
    }
    return Math.min(...bins(0, 3).slice(1)) / med(bins(-0.6, 0))
  }
  const flightAt = (id: string) => { const f = getCinematicFlight(id)!; return [(u: number, lead: number): Pose => sampleCinematicFlight(f, u, e, floorAt, groundAt, lead).pose, f.seconds] as const }
  const orbitPose = momentPose({ at: 'sunArc', dist: 5, arcDeg: -ORBIT_START_ARC_DEG }, e)
  const [tycho] = flightAt('tycho-rim')
  // The tour's order (Next): fly-around, then Earthrise; Tycho, then the surface flight.
  const cases: Array<[string, Pose, string]> = [
    ['apollo8-earthrise', { ...orbitPose, lon: orbitPose.lon + 360, roll: 0, pitch: 0 }, 'after the fly-around'],
    ['copernicus-flyover', tycho(1, 0), 'after Tycho'],
    ['tycho-rim', homePose(e), 'from Home'],
    ['terminator-run', homePose(e), 'from Home'],
  ]
  for (const [id, from, how] of cases) {
    const [f, s] = flightAt(id)
    const ratio = r3(from, f, s)
    assert.ok(ratio > 0.6, `${id} ${how}: slowest bin in 0-3 s is ${ratio.toFixed(2)} of the arrival speed`)
  }
  assert.ok(planFly(e, end(homePose(e)), end(tycho(0, 0)), { endRate: leadStartRate((u) => tycho(u, 1), 30) }).ms - planFly(e, end(homePose(e)), end(tycho(0, 0))).ms === JOIN_GLIDE_MS, 'the glide adds to the move')
}

// Source guards: the wiring in main.ts.
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
assert.match(main, /planFly\(ephem, from, to, \{ aspect: canvasAspect\(\), ms, endRate(, feel: FLIGHT_FEEL, startRate: [^}]*)? \}\)/, 'flyTo passes the end rate to the planner (and, v2, the feel switch and the carried start rate)')
assert.match(main, /lead: joined \? 1 : 0/, 'a flight started by a fly-to leads in')
assert.match(main, /lead: instant \? 0 : 1/, 'an orbit started by a fly-to leads in')
assert.match(main, /orbitAngleDeg\(u, orbitJourney\.lead\)/, 'stepOrbit applies the lead-in')
assert.match(main, /journeyClockStart\(now, flight\.lead \? joinHandOverAt : null/, 'stepCinematic starts its clock at the hand-over frame')
assert.match(main, /journeyClockStart\(now, orbitJourney\.lead \? joinHandOverAt : null/, 'stepOrbit starts its clock at the hand-over frame')
assert.match(main, /stallShift\(flight\.lastNow \?\? null, now\)/, 'stepCinematic does not run its clock over a stalled frame')

// A stall at the join or mid-flight does not run the flight's clock over it (rig 2026-10-21: a 4.5 s hitch on Earthrise's first frame started it at u = 0.24, 14.5 s of 19 s).
{
  const seconds = 19
  const handOver = 10_000
  assert.equal(journeyClockStart(handOver + 16, handOver, 0, seconds), handOver, 'the next frame is back-dated to the hand-over')
  assert.equal(journeyClockStart(handOver + JOIN_MAX_GAP_MS, handOver, 0, seconds), handOver)
  const now = handOver + 4500
  const start = journeyClockStart(now, handOver, 0, seconds)
  assert.equal((now - start) / (seconds * 1000), 0, 'a 4.5 s stall leaves the flight at u = 0')
  assert.equal(journeyClockStart(now, null, 0.3, seconds), now - 0.3 * seconds * 1000, 'no hand-over: now, minus the resume progress')
  assert.equal(stallShift(null, 5000), 0); assert.equal(stallShift(1000, 1016), 0); assert.equal(stallShift(1000, 1000 + STALL_MS), 0)
  assert.equal(stallShift(1000, 5500), 4500)
  let lastNow: number | null = null, t0 = 0
  const us: number[] = []
  for (const f of [0, 16, 32, 4532, 4548]) { t0 += stallShift(lastNow, f); lastNow = f; us.push((f - t0) / (seconds * 1000)) }
  assert.ok(us[3] - us[2] < 0.001, 'the hitch does not skip the flight forward')
}

// Earthrise from its first frame: the whole Earth is below the horizon at u = 0 (owner 2026-10-20), 19 s long (owner 2026-10-21).
{
  const flight = getCinematicFlight('apollo8-earthrise')!
  assert.equal(flight.seconds, 19)
  const e2 = ephemerisAt(new Date('1968-12-24T16:39:39Z'))
  const earthR = Math.asin(6371 / e2.earthKm.length())
  const hiddenAt = (u: number, lead: number): boolean => {
    const pose = sampleCinematicFlight(flight, u, e2, () => 1.0005, () => 0, lead).pose
    const cam = cameraPosition(e2, pose)
    const toEarth = e2.earthKm.clone().divideScalar(1737.4).sub(cam).normalize()
    const centre = Math.acos(Math.max(-1, Math.min(1, -cam.clone().normalize().dot(toEarth))))
    return centre + earthR < Math.asin(1 / pose.dist)
  }
  assert.ok(hiddenAt(0, 0) && hiddenAt(0, 1), 'Earth hidden below the limb at the flight start')
  assert.ok(hiddenAt(0.03, 1), 'still hidden half a second in')
  assert.ok(!hiddenAt(1, 1), 'risen clear of the limb at the end')
}
console.log('flight-join.test ok')
