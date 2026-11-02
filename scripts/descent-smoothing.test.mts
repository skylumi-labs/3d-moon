/**
 * The pin descents' end (Apollo 11, Apollo 17): the view turns at no more than about 20 deg/s in the last 30 % of the journey, the ground track has
 * no reversal, the clock never holds a pose, and the arrival pose is the legacy path's. Rig, 2026-10-18 (labels-218-extra, 266d6582): Apollo 17 up to
 * 66 deg/s with repeated poses, Apollo 11's track changing turn direction 2 to 4 times. `legacy` is `?descent=legacy`.
 * Offline. npx tsx scripts/descent-smoothing.test.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { reliefShare, type Pose } from '../src/camera/pose.ts'
import { stepClock, type ClockState } from '../src/descent/clock.ts'
import { landingPose, type LandingInput } from '../src/descent/landing.ts'
import { descentRenderPose } from '../src/descent/renderPose.ts'
import { FUNNEL_CREEP_MIN, floorGuard, funnelAim, gatedU, guardedAim, stepGate } from '../src/descent/siteDrop.ts'
import { PATCH_SITES } from '../src/moon/patch/sites.ts'

const R_M = 1737400, DEG = Math.PI / 180
type V = [number, number, number]
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V): V => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l] }
/** The camera's line of sight in the Moon-fixed frame (poseBasis: looks at the centre, roll about the line, pitch scaled by reliefShare toward the frame's top). */
function look(q: Pose): V {
  const cy = Math.cos(q.lon * DEG), sy = Math.sin(q.lon * DEG), cp = Math.cos(q.lat * DEG), sp = Math.sin(q.lat * DEG)
  const back: V = [cp * cy, cp * sy, sp]
  const upN = norm([-back[2] * back[0], -back[2] * back[1], 1 - back[2] * back[2]])
  const r = q.roll * DEG, c = cross(back, upN)
  const up = norm([0, 1, 2].map((i) => upN[i] * Math.cos(r) + c[i] * Math.sin(r)) as V)
  const p = (q.pitch ?? 0) * reliefShare(q.dist) * DEG
  return norm([0, 1, 2].map((i) => -back[i] * Math.cos(p) + up[i] * Math.sin(p)) as V)
}
const turnDeg = (a: Pose, b: Pose): number => Math.acos(Math.min(1, dot(look(a), look(b)))) / DEG

function input(id: 'a11' | 'a17', from: Pose, slide: number, legacy: boolean): LandingInput {
  const s = PATCH_SITES[id], G = s.groundM / R_M
  const alt1 = s.imageTexelM * 1080 / (1000 * 1737.4 * 2 * Math.tan(15 * DEG)) * (s.end.altFactor ?? 1)
  return {
    site: { lon: s.lon, lat: s.lat }, end: s.end, alt1, from, alt0: from.dist - 1 - G, slide, groundAt: () => G, floorAt: () => 1 + G + alt1,
    relief: reliefShare, moonRadiusM: R_M, apex: Math.min(2.5, Math.max(from.dist, 1.4)) - 1 - G, climbU: 0, legacy,
  }
}
const DROP_MS = 11300   // main.ts: 1000 ms per doubling of the apex height down to the end (about 6e-4 R) from the 2.5 R apex
const FRAME = 1000 / 60
const starts = (id: 'a11' | 'a17'): Array<[string, Pose, number]> => [
  ['from Home', { lon: 0, lat: 0, dist: 3.6, roll: 0, pitch: 0 }, 0.5],
  ['from the other side', { lon: PATCH_SITES[id].lon + 3, lat: PATCH_SITES[id].lat + 2, dist: 2.0, roll: 0, pitch: 0 }, 0.4],
  ['from a low flight', { lon: 23.47, lat: 0.67, dist: 1.05, roll: 0, pitch: 0 }, 0.5],
]

/** Peak view turn (deg/s) over u >= from, and the ground track's turn-direction changes (steps under 2 m and turns under 3 deg/s ignored: at rest or straight). */
function measure(p: LandingInput, from: number): { peak: number; reversals: number } {
  const N = Math.round(DROP_MS / FRAME)
  let prev = landingPose(0, p), peak = 0, prevH: number | null = null, lastSign = 0, reversals = 0
  for (let i = 1; i <= N; i++) {
    const q = landingPose(i / N, p)
    if (i / N >= from) peak = Math.max(peak, turnDeg(prev, q) / (FRAME / 1000))
    const dl = (q.lon - prev.lon) * Math.cos(q.lat * DEG), db = q.lat - prev.lat
    if (Math.hypot(dl, db) * DEG * R_M > 2) {
      const h = Math.atan2(dl, db)
      if (prevH !== null) {
        let d = h - prevH
        while (d > Math.PI) d -= 2 * Math.PI
        while (d < -Math.PI) d += 2 * Math.PI
        if (Math.abs(d) > 0.05 * DEG) { const sg = Math.sign(d); if (lastSign !== 0 && sg !== lastSign) reversals++; lastSign = sg }
      }
      prevH = h
    }
    prev = q
  }
  return { peak, reversals }
}

for (const id of ['a11', 'a17'] as const) for (const [name, from, slide] of starts(id)) {
  const now = measure(input(id, from, slide, false), 0.7)
  const old = measure(input(id, from, slide, true), 0.7)
  console.log(`${id} ${name}: last 30 % peak ${now.peak.toFixed(1)} deg/s (legacy ${old.peak.toFixed(1)}), track reversals ${now.reversals} (legacy ${old.reversals})`)
  assert.ok(now.peak <= 20.5, `${id} ${name}: peak view turn in the last 30 % is ${now.peak.toFixed(1)} deg/s (<= 20)`)
  assert.equal(now.reversals, 0, `${id} ${name}: the ground track turns one way with zero direction reversals`)
  // The arrival pose is the legacy path's.
  const a = landingPose(1, input(id, from, slide, false)), b = landingPose(1, input(id, from, slide, true))
  for (const k of ['lon', 'lat', 'dist', 'roll', 'pitch'] as const) assert.ok(Math.abs((a[k] as number) - (b[k] as number)) < 1e-12, `${id} ${name}: arrival ${k} unchanged`)
  // ...and the camera never ends up under the floor or rising.
  const ps = Array.from({ length: 601 }, (_, i) => landingPose(i / 600, input(id, from, slide, false)))
  for (let i = 1; i < ps.length; i++) assert.ok(ps[i].dist <= ps[i - 1].dist + 1e-12, `${id} ${name}: altitude never rises (${i})`)
}
// The legacy switch really is the old path: Apollo 17 from Home turns at 25 deg/s or more in the last 30 % and reverses on the ground.
{
  const old = measure(input('a17', starts('a17')[0][1], 0.5, true), 0.7)
  assert.ok(old.peak > 25 && old.reversals >= 1, `legacy a17: ${old.peak.toFixed(1)} deg/s, ${old.reversals} reversals`)
}

// The clock with the gate and the actual rendered pose: target -> 400 ms altitude lag -> current rig floor clamp.
// Variable frame cadence includes 8-50 ms jitter and 100/300 ms hitches; terrain floor data arrives late in two steps.
function run(id: 'a11' | 'a17', readyAtMs: number, legacy: boolean): { held: number; slowProgress: number; peak: number; endedMs: number } {
  let terrainFloor = 1.02
  const p = input(id, starts(id)[0][1], 0.5, legacy)
  p.floorAt = () => terrainFloor
  const c: ClockState = { t0: 0, ms: DROP_MS }
  let t = 0, prevU = 0, gate = 1, lagDist: number | undefined, held = 0, slowProgress = 0, peak = 0
  let prevPose = descentRenderPose(landingPose(0, p), lagDist, 0, GROUND_OF(id), terrainFloor).pose
  const uFunnel = 0.35
  const cadence = [8, 17, 31, 50, 12, 24, 100, 19, 43, 300, 16, 27, 9, 38, 50, 14, 22, 100]
  let frame = 0
  for (; t < 60000; frame++) {
    const frameMs = frame === 0 ? 0 : cadence[(frame - 1) % cadence.length]
    t += frameMs
    if (t >= readyAtMs + 1200) terrainFloor = 1.0005
    else if (t >= readyAtMs) terrainFloor = 1.008
    const ready = t >= readyAtMs
    let u = stepClock(c, t, ready)
    // Legacy's old floor guard is exercised at the worst case (camera held against the available floor).
    const guard = ready ? 1 : floorGuard(legacy ? 1 : prevPose.dist, terrainFloor)
    gate = stepGate(gate, guardedAim(funnelAim(prevU, uFunnel, ready), guard, ready, legacy), frameMs)
    if (gate < 0.999 || !ready) { u = gatedU(prevU, u, gate); c.t0 = t - u * c.ms }
    const q = landingPose(u, p)
    const rendered = descentRenderPose(q, lagDist, frameMs, GROUND_OF(id), terrainFloor)
    const actual = rendered.pose
    lagDist = rendered.lagDist
    if (u < 0.99 && t > 100 && samePose(prevPose, actual)) held++
    if (u < 0.99 && t > 100 && u - prevU < 1e-5) slowProgress++
    if (u >= 0.7 && u < 1 && frameMs > 0) peak = Math.max(peak, turnDeg(prevPose, actual) / (frameMs / 1000))
    prevPose = actual; prevU = u
    if (u >= 1) break
  }
  return { held, slowProgress, peak, endedMs: t }
}
assert.equal(new URLSearchParams('?descent=legacy').get('descent'), 'legacy', 'the legacy query still selects the legacy landing path')
const mainSource = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
assert.ok(/new URLSearchParams\(location\.search\)\.get\('descent'\) === 'legacy'/.test(mainSource) && /legacy: DESCENT_LEGACY/.test(mainSource), '?descent=legacy still wires the original landing and gate paths')
const GROUND_OF = (id: 'a11' | 'a17'): number => PATCH_SITES[id].groundM / R_M
const samePose = (a: Pose, b: Pose): boolean => a.lon === b.lon && a.lat === b.lat && a.dist === b.dist && a.roll === b.roll && a.pitch === b.pitch
for (const id of ['a11', 'a17'] as const) for (const readyAt of [0, 3000, 6000, 9000, 14000]) {
  const r = run(id, readyAt, false)
  console.log(`${id} patch ready at ${readyAt} ms: held frames ${r.held}, peak ${r.peak.toFixed(1)} deg/s, arrives at ${(r.endedMs / 1000).toFixed(1)} s`)
  assert.equal(r.held, 0, `${id} ready ${readyAt}: no held pose`)
  assert.ok(r.peak <= 20.5, `${id} ready ${readyAt}: view turn ${r.peak.toFixed(1)} deg/s`)
}
{
  // The old guard left progress effectively frozen on the floor; the new assertion above measures actual rendered poses.
  const r = run('a11', 14000, true)
  assert.ok(r.slowProgress > 20, `legacy: progress crawls below 1e-5/frame on the floor (${r.slowProgress} frames)`)
  // The aim itself: never under the creep floor while the patch is missing.
  assert.equal(guardedAim(0.5, 0, false), FUNNEL_CREEP_MIN)
  assert.equal(guardedAim(0.5, 0, false, true), 0)
  assert.equal(guardedAim(0.5, 0.4, true), 0.5)
}
console.log('descent smoothing ok')
