/**
 * Re-pick speed-step simulation (#367 known limit): a fly-to between two named sites is re-picked mid-flight, and the new move's first-frame
 * velocity is compared with the velocity the old move had at that instant (the carried start rate, as main.ts tweenRate measures it).
 * 12 sites x 4 first targets x 3 distinct re-pick targets (one of them back to the start) x 16 re-pick times = 2,304 re-picks.
 *
 * node --import tsx scripts/repick-sim.mts [--json]
 * Prints the count over a 5 % speed step, the worst step and its case, and the largest frame-to-frame speed change inside a new move. `repickSim()` is exported for scripts/repick-carry.test.mts.
 */
import type { Vector3 } from 'three'
import { ephemerisAt } from '../src/ephemeris.ts'
import { wrapLon, type Pose } from '../src/camera/pose.ts'
import { cameraPosition, planFly, type FlyEnd, type FlyPlan } from '../src/journey/path.ts'

export const SIM_SITES: Array<[string, number, number]> = [
  ['Langrenus', 61.0, -8.9], ['Grimaldi', -68.6, -5.2], ['Tycho', -11.2, -43.3], ['Copernicus', -20.1, 9.6], ['Plato', -9.3, 51.6],
  ['Aristarchus', -47.5, 23.7], ['Petavius', 60.4, -25.1], ['Clavius', -14.1, -58.6], ['Kepler', -38.0, 8.1], ['Theophilus', 26.3, -11.4],
  ['Apollo 11', 23.47, 0.67], ['Apollo 17', 30.77, 20.19],
]
const e = ephemerisAt(new Date('2026-10-20T19:00:00Z')), aspect = 1.6
const end = (lon: number, lat: number): FlyEnd => ({ pose: { lon, lat, dist: 1.06, roll: 0, pitch: 0 }, fovDeg: 30, aimShift: 0, aimShiftX: 0, look: 0 })
const stateEnd = (p: FlyPlan, u: number): FlyEnd => { const s = p.at(u); return { pose: { ...s.pose }, fovDeg: s.fovDeg, aimShift: s.aimShift, aimShiftX: s.aimShiftX, look: 0 } }
/** The camera velocity (Moon radii per second) of a plan at time share u, over one 16 ms frame. */
const velocity = (p: FlyPlan, u: number) => {
  const du = 16 / p.ms, a = cameraPosition(e, p.at(u).pose as Pose), b = cameraPosition(e, p.at(Math.min(1, u + du)).pose as Pose)
  return b.sub(a).divideScalar(0.016)
}

/** The largest change of speed between two consecutive 16 ms frames of a plan, as a share of the larger of `vIn` (the carried speed) and the plan's top speed. */
const frameStep = (p: FlyPlan, vIn: number): number => {
  const vs: number[] = []
  for (let t = 0; t < p.ms - 16; t += 16) vs.push(velocity(p, t / p.ms).length())
  const ref = Math.max(vIn, ...vs, 1e-9)
  let worst = 0
  for (let i = 1; i < vs.length; i++) worst = Math.max(worst, Math.abs(vs[i] - vs[i - 1]) / ref)
  return worst
}

/**
 * The largest vector acceleration of the camera across the re-pick (Moon radii/s^2, second difference over 16 ms frames, from the carried velocity
 * `vIn` into the new move's first frame and on): a hard brake-and-turn shows here, and so does a speed step at the hand-off.
 */
const peakAccel = (p: FlyPlan, vIn: Vector3): number => {
  let worst = velocity(p, 0).sub(vIn).length() / 0.016, prev = velocity(p, 0)
  for (let t = 16; t < p.ms - 16; t += 16) { const v = velocity(p, t / p.ms); worst = Math.max(worst, v.clone().sub(prev).length() / 0.016); prev = v }
  return worst
}

/** One re-pick: the first-frame speed step and the largest frame-to-frame speed change inside the new move (shares of the carried speed; of the larger of it and the move's top speed). */
export interface RepickCase { from: string; first: string; second: string; u: number; step: number; inMove: number; accel: number; surfaceDegS: number; ms: number }
export function repickSim(feel = true): { cases: RepickCase[]; over5: number; worst: RepickCase; worstInMove: RepickCase } {
  const cases: RepickCase[] = []
  for (let i = 0; i < SIM_SITES.length; i++) {
    for (let j = 1; j <= 4; j++) {
      const a = SIM_SITES[i], b = SIM_SITES[(i + 2 * j - 1) % SIM_SITES.length]
      const thirds = [a, SIM_SITES[(i + 2 * j) % SIM_SITES.length], SIM_SITES[(i + 2 * j + 5) % SIM_SITES.length]]
      const first = planFly(e, end(a[1], a[2]), end(b[1], b[2]), { aspect, feel })
      for (const c of thirds) {
        for (let n = 0; n < 16; n++) {
          const u = 0.04 + n * 0.05
          // The carried rate, exactly as main.ts tweenRate (pose rates over 16 ms).
          const A = first.at(u), B = first.at(u + 16 / first.ms)
          const rate = { lon: wrapLon(B.pose.lon - A.pose.lon) / 0.016, lat: (B.pose.lat - A.pose.lat) / 0.016, dist: (B.pose.dist - A.pose.dist) / 0.016, roll: (B.pose.roll - A.pose.roll) / 0.016, pitch: ((B.pose.pitch ?? 0) - (A.pose.pitch ?? 0)) / 0.016, fov: (B.fovDeg - A.fovDeg) / 0.016 }
          const second = planFly(e, stateEnd(first, u), end(c[1], c[2]), { aspect, feel, startRate: rate })
          const vIn = velocity(first, u), vOut = velocity(second, 0)
          const step = Math.abs(vOut.length() - vIn.length()) / Math.max(1e-9, vIn.length())
          const surfaceDegS = Math.hypot(rate.lon * Math.cos(A.pose.lat * Math.PI / 180), rate.lat)
          cases.push({ from: a[0], first: b[0], second: c[0], u: Math.round(u * 100) / 100, step, inMove: frameStep(second, vIn.length()), accel: peakAccel(second, vIn), surfaceDegS, ms: Math.round(second.ms) })
        }
      }
    }
  }
  const over5 = cases.filter((c) => c.step > 0.05).length
  const worst = cases.reduce((w, c) => (c.step > w.step ? c : w), cases[0])
  const worstInMove = cases.reduce((w, c) => (c.inMove > w.inMove ? c : w), cases[0])
  return { cases, over5, worst, worstInMove }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = repickSim()
  const fmt = (c: RepickCase) => `${c.from} -> ${c.first}, re-picked to ${c.second} at u ${c.u}: step ${(c.step * 100).toFixed(1)} % at ${c.surfaceDegS.toFixed(0)} deg/s surface, new move ${c.ms} ms`
  console.log(`re-picks: ${r.cases.length}; speed step over 5 %: ${r.over5}; worst: ${fmt(r.worst)}`)
  console.log(`largest camera acceleration across a re-pick: ${Math.max(...r.cases.map((c) => c.accel)).toFixed(1)} radii/s^2`)
  console.log(`largest frame-to-frame speed change inside a new move: ${(r.worstInMove.inMove * 100).toFixed(1)} % of the top speed (${fmt(r.worstInMove)})`)
  const top = [...r.cases].sort((x, y) => y.step - x.step).slice(0, 5)
  for (const c of top) console.log(`  ${fmt(c)}`)
  if (process.argv.includes('--json')) console.log(JSON.stringify(r.cases))
}
