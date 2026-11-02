/** Flight feel v2 (journey/feel.ts, planFly's `feel`) and Home's minimal aim (ui/layout.ts). tsx scripts/flight-feel.test.mts */
import assert from 'node:assert/strict'
import { FEEL_ACCEL, FEEL_DECEL, FEEL_MAX_MS, FEEL_MIN_MS, FEEL_NEED_PER_RAD, feelCruise, feelDurationMs, feelEase, feelPath, flightFeelOn } from '../src/journey/feel.ts'
import { planFly, zoomPanPath, type FlyEnd } from '../src/journey/path.ts'
import { angularDistance, type Pose } from '../src/camera/pose.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { minimalAim } from '../src/ui/layout.ts'

const e = ephemerisAt(new Date('2026-10-20T19:00:00Z'))
const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`)
const P = (lon: number, lat: number, dist: number): Pose => ({ lon, lat, dist, roll: 0, pitch: 0 })
const end = (pose: Pose): FlyEnd => ({ pose, fovDeg: 30, aimShift: 0, aimShiftX: 0, look: 0 })
const HOME = P(1.14, -5.82, 6.0)
const COPERNICUS = P(-20.08, 9.62, 1.18), TYCHO = P(-11.36, -43.3, 1.225), PLATO = P(-9.3, 51.6, 1.2)

// 1. The clock: exact ends, monotone, continuous velocity from the start speed to rest, no lunge.
{
  const vel = (x: number, v0 = 0): number => (feelEase(Math.min(1, x + 1e-6), v0) - feelEase(Math.max(0, x - 1e-6), v0)) / (Math.min(1, x + 1e-6) - Math.max(0, x - 1e-6))
  for (const v0 of [0, 0.6, 1.4]) {
    near(feelEase(0, v0), 0, 1e-12, `start (v0 ${v0})`); near(feelEase(1, v0), 1, 1e-12, `end (v0 ${v0})`)
    let prev = 0
    for (let i = 1; i <= 1000; i++) { const k = feelEase(i / 1000, v0); assert.ok(k >= prev - 1e-12, `monotone at ${i / 1000} (v0 ${v0})`); prev = k }
    near(vel(0, v0), v0, 1e-3, `starts at the carried speed (v0 ${v0})`)
    near(vel(1, v0), 0, 1e-3, `arrives at rest (v0 ${v0})`)
    // Velocity is continuous across the ramp joins (no step in speed anywhere).
    for (const j of [FEEL_ACCEL, 1 - FEEL_DECEL]) near(vel(j - 1e-4, v0), vel(j + 1e-4, v0), 2e-3, `no speed step at ${j} (v0 ${v0})`)
    near(vel(0.5, v0), feelCruise(v0), 1e-4, `cruise speed (v0 ${v0})`)
  }
  // From rest: the peak is lower than the quintic's 1.88 and the old glide's 1.43, and it gets going quickly (a quarter of the way by 30 % of the time).
  assert.ok(feelCruise() < 1.36, `cruise ${feelCruise()}`)
  assert.ok(feelEase(0.3) > 0.25, `quick start: ${feelEase(0.3)} by 30 % of the time`)
  // The arrival is longer than the departure (a gentle landing, a brisk take-off).
  assert.ok(FEEL_DECEL > FEEL_ACCEL)
}

// 2. The flat path: exact ends, monotone travel, steady perceptual speed, no climb a zoom does not need.
{
  const cases: Array<[string, Pose, Pose]> = [['home-copernicus', HOME, COPERNICUS], ['home-tycho', HOME, TYCHO], ['home-plato', HOME, PLATO], ['copernicus-tycho', COPERNICUS, TYCHO], ['copernicus-home', COPERNICUS, HOME]]
  for (const [name, a, b] of cases) {
    const th = angularDistance(a.lon, a.lat, b.lon, b.lat), a0 = a.dist - 1, a1 = b.dist - 1
    const zp = zoomPanPath(th, a0, a1)
    const vwApex = zp.sPeak > 0 && zp.sPeak < zp.S ? zp.w(zp.sPeak) : Math.max(a0, a1)
    const f = feelPath(th, a0, a1, vwApex)
    near(f.at(0).alt, a0, 1e-9, `${name}: start altitude`); near(f.at(1).alt, a1, 1e-9, `${name}: end altitude`)
    near(f.at(0).p, 0, 1e-12, `${name}: no travel at the start`); near(f.at(1).p, 1, 1e-12, `${name}: all of it at the end`)
    let prevP = 0, maxAlt = 0
    for (let i = 1; i <= 200; i++) { const s = f.at(i / 200); assert.ok(s.p >= prevP - 1e-12, `${name}: travel monotone`); prevP = s.p; maxAlt = Math.max(maxAlt, s.alt) }
    assert.ok(maxAlt <= vwApex * (1 + 1e-9), `${name}: never higher than the zoom-and-pan apex (${maxAlt} vs ${vwApex})`)
    assert.ok(maxAlt <= Math.max(a0, a1, FEEL_NEED_PER_RAD * th) * (1 + 1e-6), `${name}: only as high as the travel needs (${maxAlt})`)
    // Steady perceptual speed: equal steps of k are equal steps of zoom-and-pan length (within the table's resolution).
    const step = (k0: number, k1: number): number => {
      const s0 = f.at(k0), s1 = f.at(k1)
      return Math.hypot(Math.log(s1.alt / s0.alt), th * (s1.p - s0.p) / Math.sqrt(s0.alt * s1.alt))
    }
    const steps = Array.from({ length: 20 }, (_, i) => step(i / 20, (i + 1) / 20))
    const mean = steps.reduce((x, y) => x + y, 0) / steps.length
    for (const s of steps) near(s / mean, 1, 0.05, `${name}: steady change of the picture`)
  }
  // Home to a crater is a zoom with a little travel: no climb at all above Home.
  const hc = feelPath(angularDistance(HOME.lon, HOME.lat, COPERNICUS.lon, COPERNICUS.lat), 5, 0.18)
  near(hc.apexAlt, 5, 1e-9, 'Home to Copernicus does not climb')
  // Crater to crater climbs less than the zoom-and-pan path did (the owner's "up-and-down").
  const th = angularDistance(COPERNICUS.lon, COPERNICUS.lat, TYCHO.lon, TYCHO.lat)
  const zp = zoomPanPath(th, 0.18, 0.225)
  const cc = feelPath(th, 0.18, 0.225, zp.w(zp.sPeak))
  assert.ok(cc.apexAlt < 0.75 * zp.w(zp.sPeak), `Copernicus to Tycho apex ${cc.apexAlt} vs ${zp.w(zp.sPeak)}`)
  // A pure zoom is the exponential law; a level hop stays level.
  const z = feelPath(0, 5, 0.5)
  near(z.at(0.5).alt, Math.sqrt(5 * 0.5), 1e-9, 'a pure zoom is halfway in the log of the altitude')
  const lv = feelPath(0.01, 0.5, 0.5)
  near(lv.apexAlt, 0.5, 1e-9, 'a short level hop does not climb')
}

// 2b. The path's derivatives are continuous across its table knots (linear pieces gave up to 10 % speed steps, e.g. from 50 m up to Home).
{
  for (const [name, th, a0, a1] of [['ground-home', 0.4, 0.0005, 5], ['home-tycho', 0.68, 5, 0.225], ['crater-crater', 0.93, 0.18, 0.225]] as const) {
    const f = feelPath(th, a0, a1)
    const q = (k: number): number[] => { const s = f.at(k); return [Math.log(s.alt), s.p * th] }
    const der = (k: number): number[] => { const a = q(k), b = q(k + 1e-7); return [(b[0] - a[0]) / 1e-7, (b[1] - a[1]) / 1e-7] }
    const n = 6000
    let maxD = 0, maxJump = 0, prev = der(0.0005)
    for (let i = 1; i < n; i++) {
      const d = der(0.0005 + 0.998 * i / n)
      maxD = Math.max(maxD, Math.hypot(d[0], d[1]))
      maxJump = Math.max(maxJump, Math.hypot(d[0] - prev[0], d[1] - prev[1]))
      prev = d
    }
    assert.ok(maxJump < 0.01 * maxD, `${name}: no step in the path's rate across knots (${(100 * maxJump / maxD).toFixed(2)} % of the largest rate)`)
  }
}

// 3. The planner with feel: shorter, exact ends, above the ground, and legacy untouched without it.
{
  for (const [name, b] of [['copernicus', COPERNICUS], ['tycho', TYCHO], ['plato', PLATO]] as const) {
    const legacy = planFly(e, end(HOME), end(b), { aspect: 1.6 })
    const v2 = planFly(e, end(HOME), end(b), { aspect: 1.6, feel: true })
    assert.ok(v2.ms >= FEEL_MIN_MS && v2.ms <= FEEL_MAX_MS, `${name}: duration ${v2.ms}`)
    assert.ok(v2.ms < 0.65 * legacy.ms, `${name}: v2 ${v2.ms.toFixed(0)} ms vs legacy ${legacy.ms.toFixed(0)} ms`)
    for (const k of ['lon', 'lat', 'dist'] as const) near(v2.at(1).pose[k], legacy.at(1).pose[k], 1e-9, `${name}: same end ${k}`)
    assert.ok(v2.minRadius > 1.05, `${name}: above the ground (${v2.minRadius})`)
    assert.ok(v2.apexDist <= HOME.dist + 1e-6, `${name}: no climb above Home (${v2.apexDist})`)
    assert.equal(v2.startSpeed, 0, `${name}: from rest`)
  }
  // Without feel the planner is exactly the earlier one (?flightfeel=0): two plans of the same move agree at every sample.
  const a = planFly(e, end(COPERNICUS), end(TYCHO), { aspect: 1.6 }), b = planFly(e, end(COPERNICUS), end(TYCHO), { aspect: 1.6, feel: false })
  assert.equal(a.ms, b.ms)
  for (let i = 0; i <= 40; i++) { const u = i / 40; assert.deepEqual(a.at(u), b.at(u), `legacy identical at ${u}`) }
  // Crater to crater: lower than the legacy arc.
  const l2 = planFly(e, end(COPERNICUS), end(TYCHO), { aspect: 1.6 }), v22 = planFly(e, end(COPERNICUS), end(TYCHO), { aspect: 1.6, feel: true })
  assert.ok(v22.apexDist < l2.apexDist - 0.1, `crater to crater apex ${v22.apexDist} vs ${l2.apexDist}`)
  // The pose moves continuously: no frame-to-frame jump in position at 60 fps anywhere along the move.
  const pos = (u: number) => { const s = v22.at(u).pose; const cl = Math.cos(s.lat * Math.PI / 180); return [s.dist * cl * Math.cos(s.lon * Math.PI / 180), s.dist * cl * Math.sin(s.lon * Math.PI / 180), s.dist * Math.sin(s.lat * Math.PI / 180)] }
  const frames = Math.ceil(v22.ms / 16.7)
  // Speed is continuous: from one 60 fps frame to the next the step changes by a few per cent of the largest step at most (no lurch).
  const steps: number[] = []
  let prev = pos(0)
  for (let i = 1; i <= frames; i++) { const q = pos(i / frames); steps.push(Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2])); prev = q }
  const maxStep = Math.max(...steps)
  let maxJerk = 0
  for (let i = 1; i < steps.length; i++) maxJerk = Math.max(maxJerk, Math.abs(steps[i] - steps[i - 1]))
  assert.ok(maxJerk < 0.06 * maxStep, `largest change of step between frames ${maxJerk} vs largest step ${maxStep}`)
}

// 4. A move taken over mid-flight keeps its whole velocity: position rate (direction included), lens, roll and pitch rates are continuous
// at the retarget, for a pick ahead (Copernicus), a reversal (Home) and a sideways pick, and for a hand-over plan (endRate) too.
{
  const D = Math.PI / 180
  const posOfPose = (q: Pose): number[] => { const cl = Math.cos(q.lat * D); return [q.dist * cl * Math.cos(q.lon * D), q.dist * cl * Math.sin(q.lon * D), q.dist * Math.sin(q.lat * D)] }
  type St = { pose: Pose; fovDeg: number }
  /** Velocity (Moon radii/s, Moon-fixed frame), lens rate (deg/s), roll and pitch rates of a plan at time t (s), by a one-sided difference. */
  const rates = (at: (t: number) => St, t: number, h: number) => {
    const a = at(t), b = at(t + h)
    const pa = posOfPose(a.pose), pb = posOfPose(b.pose)
    return { v: pa.map((x, i) => (pb[i] - x) / h), fov: (b.fovDeg - a.fovDeg) / h, roll: (b.pose.roll - a.pose.roll) / h, pitch: ((b.pose.pitch ?? 0) - (a.pose.pitch ?? 0)) / h }
  }
  // A first move that also changes the lens (30 -> 50 deg) and tilts, so lens and pitch rates are non-zero at the retarget.
  const lensEnd = (q: Pose, fov: number): FlyEnd => ({ ...end(q), fovDeg: fov })
  const first = planFly(e, lensEnd(HOME, 30), lensEnd({ ...TYCHO, pitch: 20 }, 50), { aspect: 1.6, feel: true })
  // Mid-way, and low in the fast final descent (where a carried descent must ease off above the ground, never be clamped).
  for (const uSwitch of [0.4, 0.75]) {
  const tSwitch = uSwitch * first.ms / 1000, h = 1e-4
  const firstAt = (t: number): St => first.at(t * 1000 / first.ms)
  const before = rates(firstAt, tSwitch - h, h)
  const here = firstAt(tSwitch)
  const r1 = rates(firstAt, tSwitch, 1e-3)
  const p0 = here.pose, p1 = firstAt(tSwitch + 1e-3).pose
  const startRate = { lon: (p1.lon - p0.lon) / 1e-3, lat: (p1.lat - p0.lat) / 1e-3, dist: (p1.dist - p0.dist) / 1e-3, roll: r1.roll, pitch: r1.pitch, fov: r1.fov }
  const speed = Math.hypot(...before.v)
  assert.ok(speed > 0.3, `the first move is under way (${speed} R/s)`)
  const sideways = P(40, -20, 1.6)
  // The first move's own largest change of velocity per 60 fps frame: the retargeted moves must turn no harder than an ordinary flight accelerates.
  let firstDv = 0
  { let pv = rates(firstAt, 0, 1e-4).v; for (let t = 0.0167; t < first.ms / 1000; t += 0.0167) { const v = rates(firstAt, t, 1e-4).v; firstDv = Math.max(firstDv, Math.hypot(...v.map((x, j) => x - pv[j]))); pv = v } }
  for (const [name, target, endRate] of [['ahead', COPERNICUS, undefined], ['reversal', HOME, undefined], ['sideways', sideways, undefined], ['hand-over', COPERNICUS, { lon: 2, lat: 0, dist: 0 }]] as const) {
    const plan = planFly(e, { ...lensEnd(here.pose, here.fovDeg) }, lensEnd(target, 30), { aspect: 1.6, feel: true, startRate, endRate })
    const at = (t: number): St => plan.at(t * 1000 / plan.ms)
    const after = rates(at, 1e-6, h)
    const dv = Math.hypot(...after.v.map((x, i) => x - before.v[i]))
    assert.ok(dv < 0.02 * speed, `${name}: velocity vector continuous at the retarget (step ${dv} vs speed ${speed})`)
    near(after.fov, before.fov, 0.02 * Math.abs(before.fov) + 0.05, `${name}: lens rate continuous`)
    near(after.pitch, before.pitch, 0.02 * Math.abs(before.pitch) + 0.05, `${name}: pitch rate continuous`)
    near(after.roll, before.roll, 0.05 * Math.abs(before.roll) + 0.2, `${name}: roll rate continuous`)
    // Through the turn the velocity changes smoothly at 60 fps (no frame-to-frame lurch) and never drops to a standstill: a reversal decelerates,
    // turns and climbs away; it is not a stop followed by a new start.
    let minV = Infinity, maxDv = 0, prevV = after.v
    for (let i = 1; i <= Math.ceil(0.4 * plan.ms / 16.7); i++) {
      const v = rates(at, i * 0.0167, 1e-4).v
      minV = Math.min(minV, Math.hypot(...v)); maxDv = Math.max(maxDv, Math.hypot(...v.map((x, j) => x - prevV[j]))); prevV = v
    }
    assert.ok(minV > 0.02 * speed, `${name}: never stops in the turn (min ${minV} vs ${speed})`)
    assert.ok(maxDv < 1.25 * firstDv, `${name}: smooth turn, largest velocity change per frame ${maxDv} vs the first move's own ${firstDv}`)
    for (const k of ['lon', 'lat', 'dist'] as const) near(plan.at(1).pose[k], target[k], 1e-9, `${name}: same end ${k}`)
    assert.ok(plan.minRadius > 1 + Math.min(0.3 * (here.pose.dist - 1), 0.9 * (target.dist - 1)), `${name}: stays well above the ground (${plan.minRadius})`)
    if (endRate) {
      // The hand-over still ends at the flight's own start rate (journey/join.ts), now through v2's deceleration ramp.
      const T = plan.ms / 1000, x = plan.at((T - 1e-4) * 1000 / plan.ms).pose, y = plan.at(1 - 1e-12).pose
      near((y.lon - x.lon) / 1e-4, endRate.lon, 0.03 * Math.abs(endRate.lon) + 0.02, `${name}: ends at the flight's lon rate`)
      near((y.lat - x.lat) / 1e-4, endRate.lat, 0.05, `${name}: ends at the flight's lat rate`)
    }
  }
  }
  // At rest nothing is carried: the plan is the plain one.
  const still = planFly(e, end(HOME), end(TYCHO), { aspect: 1.6, feel: true, startRate: { lon: 0, lat: 0, dist: 0 } })
  near(still.startSpeed, 0, 1e-12, 'nothing to carry from rest')
}

// 5. Home's aim: the disc stays at the middle when it fits, and moves only as far as the bar needs when it does not.
{
  // Desktop 1280x800, bar 60 px high at the bottom: safe rect to 726 px. Home disc radius 0.63 * 800 / 2 = 252 px fits at the middle.
  const safe = { left: 0, top: 0, right: 1280, bottom: 726 }
  const a = minimalAim(1280, 800, safe, 252)
  near(a.nx, 0, 1e-12, 'centred across'); near(a.ny, 0, 1e-12, 'centred up and down: the bar does not reach the disc')
  // A short window: the disc would reach under the bar, so it rises by exactly the overlap.
  const b = minimalAim(1280, 600, { left: 0, top: 0, right: 1280, bottom: 520 }, 240)
  const cy = (1 - b.ny) / 2 * 600
  near(cy + 240, 520, 1e-9, 'the disc just clears the bar')
  // A disc larger than the free band sits at the band's centre.
  const c = minimalAim(400, 400, { left: 0, top: 0, right: 400, bottom: 300 }, 200)
  near((1 - c.ny) / 2 * 400, 150, 1e-9, 'too large: the safe rect centre')
}

// 6. The switch.
assert.equal(flightFeelOn(''), true)
assert.equal(flightFeelOn('?flightfeel=0'), false)
assert.equal(flightFeelOn('flightfeel=1'), true)
assert.ok(feelDurationMs(0) === FEEL_MIN_MS && feelDurationMs(1000) === FEEL_MAX_MS, 'duration bounds')

console.log('flight-feel: ok')
