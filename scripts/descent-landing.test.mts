/**
 * The landing journeys' camera path (src/descent/landing.ts): the end pose sits inside the detailed terrain at the site, low
 * and close, and the profile is monotone, jump-free and eased out. Offline. npx tsx scripts/descent-landing.test.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { angularDistance, reliefShare, type Pose } from '../src/camera/pose.ts'
import { stepClock, MAX_STEP_MS, WAIT_SCALE, WAIT_FROM_U, type ClockState } from '../src/descent/clock.ts'
import { LOW_PART_U, landingPose, type LandingInput } from '../src/descent/landing.ts'
import { PATCH_SITES } from '../src/moon/patch/sites.ts'

const R_M = 1737400
const a17 = PATCH_SITES.a17
// The site funnel's floor at one texel per pixel (0.6 m, 1080 px, 30 degrees): 6.96e-4 radii, 1.21 km; terrain model half-width 6 km.
const ALT_R = 0.6 * 1080 / (1000 * 1737.4 * 2 * Math.tan(15 * Math.PI / 180))
const GROUND = a17.groundM / R_M
const MODEL_HALF_M = 6000
const input = (end = a17.end, altFactor = a17.end.altFactor ?? 1): LandingInput => ({
  site: { lon: a17.lon, lat: a17.lat }, end,
  alt1: ALT_R * altFactor,
  from: { lon: a17.lon, lat: a17.lat, dist: 4.5, roll: 0, pitch: 0 } as Pose, alt0: 3.5, slide: 0.35,
  groundAt: () => GROUND,
  // Inside the model the floor is flat; outside it the cone opens (SITE_CONE 2 per radian of arc).
  floorAt: (lon, lat) => {
    const m = angularDistance(lon, lat, a17.lon, a17.lat) * R_M
    return 1 + GROUND + ALT_R + 2 * Math.max(0, m - MODEL_HALF_M) / R_M
  },
  relief: reliefShare, moonRadiusM: R_M,
})
const N = 2000
const poses = (p: LandingInput): Pose[] => Array.from({ length: N + 1 }, (_, i) => landingPose(i / N, p))
const altM = (q: Pose): number => (q.dist - 1 - GROUND) * R_M
const rangeM = (q: Pose): number => angularDistance(q.lon, q.lat, a17.lon, a17.lat) * R_M

// 1. The end pose: inside the terrain model, close to the site, low, looking at it at a shallow angle.
{
  const ps = poses(input()), end = ps[N]
  assert.ok(rangeM(end) <= MODEL_HALF_M - 500, `end ${rangeM(end).toFixed(0)} m from the site, inside the 12 km model`)
  assert.ok(rangeM(end) <= 4000, `within 4 km of the site (${rangeM(end).toFixed(0)} m)`)
  assert.ok(altM(end) <= 1500, `below 1.5 km (${altM(end).toFixed(0)} m)`)
  assert.ok(end.pitch >= 60 && end.pitch <= 75, `a shallow line of sight, tilt ${end.pitch.toFixed(1)} from straight down`)
  assert.ok(Math.abs(end.pitch - Math.atan2(rangeM(end), altM(end)) * 180 / Math.PI) < 0.01, 'the end view is aimed at the site')
  console.log(`end: ${altM(end).toFixed(0)} m up, ${rangeM(end).toFixed(0)} m from the site, tilt ${end.pitch.toFixed(1)}`)
}
// 2. The site table's end is the landing end, not the 4-floors-up end that backed 8.6 km off the site.
assert.ok((a17.end.altFactor ?? 1) <= 1.5 && a17.end.pitchDeg <= 75, 'a17 ends low and shallow')
// 3. The profile: altitude never rises, no jump between frames, camera never under the floor, eased out at the end.
{
  const p = input(), ps = poses(p)
  let maxJumpM = 0, maxStepRatio = 0
  for (let i = 1; i <= N; i++) {
    assert.ok(ps[i].dist <= ps[i - 1].dist + 1e-12, `altitude falls monotonically (frame ${i})`)
    assert.ok(ps[i].dist >= p.floorAt(ps[i].lon, ps[i].lat) - 1e-12, `never under the floor (frame ${i})`)
    const hm = angularDistance(ps[i].lon, ps[i].lat, ps[i - 1].lon, ps[i - 1].lat) * R_M
    const jump = Math.hypot(hm, (ps[i].dist - ps[i - 1].dist) * R_M)
    maxJumpM = Math.max(maxJumpM, jump)
    if (altM(ps[i]) > 3000) maxStepRatio = Math.max(maxStepRatio, Math.abs(Math.log(altM(ps[i]) / altM(ps[i - 1]))))
    assert.ok(Math.abs(ps[i].pitch - ps[i - 1].pitch) < 0.2, `no pitch jump (frame ${i}: ${(ps[i].pitch - ps[i - 1].pitch).toFixed(3)})`)
  }
  assert.ok(maxStepRatio < 0.03, `no altitude jump per frame while high (${maxStepRatio})`)
  // Below the pitch-over point the steps are metres, and they shrink to nothing at the end (smootherstep ease-out).
  const lowSteps = ps.slice(Math.floor(0.7 * N)).map((q, i, a) => (i ? Math.hypot(angularDistance(q.lon, q.lat, a[i - 1].lon, a[i - 1].lat) * R_M, (q.dist - a[i - 1].dist) * R_M) : 0))
  assert.ok(Math.max(...lowSteps) < 8, `low part steps stay small (${Math.max(...lowSteps).toFixed(2)} m per 1/${N})`)
  const last = lowSteps[lowSteps.length - 1], mid = Math.max(...lowSteps)
  assert.ok(last < 0.01 * mid, `eased out: the last step ${last.toExponential(2)} m against ${mid.toFixed(2)} m`)
  const dPitchEnd = Math.abs(ps[N].pitch - ps[N - 1].pitch)
  assert.ok(dPitchEnd < 1e-3, `the turn eases out (${dPitchEnd})`)
}
// 4. A rise of the floor along the path lifts the camera without going under it.
{
  const p = input(); const base = p.floorAt
  p.floorAt = (lon, lat) => base(lon, lat) + 4e-4 * Math.max(0, 1 - angularDistance(lon, lat, a17.lon, a17.lat) * R_M / 4000)
  for (const q of poses(p)) assert.ok(q.dist >= p.floorAt(q.lon, q.lat) - 1e-12)
}
// 5. The low part waits for the detailed terrain: the hold sits high above the site. The legacy path (?descent=legacy) is still looking straight down there;
// the smoothed path has begun its longer turn (src/descent/landing.ts SMOOTH_PITCH_START_U), so at the hold it is tilted but still mostly looking down.
{
  const q = landingPose(LOW_PART_U, { ...input(), legacy: true })
  assert.ok(altM(q) > 2000 && q.pitch < 1e-6, `legacy held ${altM(q).toFixed(0)} m up, still looking down`)
  const n = landingPose(LOW_PART_U, input())
  assert.ok(altM(n) > 2000 && n.pitch < 35, `held ${altM(n).toFixed(0)} m up, tilt ${n.pitch.toFixed(1)}`)
}
// 6. main.ts uses it.
const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
assert.match(main, /return landingPose\(u,/)
assert.match(main, /stepClock\(descent, now,/)
assert.doesNotMatch(main, /LOW_PART_U \* descent\.ms/)
// 7. The clock: monotonic, never frozen, and a stall advances it by at most one capped step.
{
  const c: ClockState = { t0: 0, ms: 26000 }
  let now = 0, prev = 0, minRate = Infinity
  for (let i = 0; i < 4000; i++) {
    now += i === 1500 ? 6500 : 16
    const u = stepClock(c, now, i > 3000 || i < 600)   // detail missing for most of the run
    assert.ok(u >= prev, 'progress never goes back')
    if (i !== 1500 && i > 1000 && i < 3000 && u < 1) minRate = Math.min(minRate, (u - prev) * c.ms / 16)
    if (i === 1500) assert.ok((u - prev) * c.ms <= MAX_STEP_MS + 1e-6, `a ${(u - prev) * c.ms} ms step after a stall`)
    prev = u
  }
  assert.ok(minRate >= WAIT_SCALE - 0.01, `slowed, never frozen (${minRate})`)
}
// 8. The wait is an ease-out, not a stop: the settled run rate at a progress just past WAIT_FROM_U is still near full speed, the floor is reached only well after.
{
  const settled = (target: number): number => {
    const c: ClockState = { t0: 0, ms: 26000 }
    let now = 0
    for (let i = 0; i < 400; i++) { now += 16; c.t0 = now - target * c.ms; stepClock(c, now, false) }   // hold the progress, let the scale settle
    return c.scale ?? 1
  }
  assert.ok(settled(WAIT_FROM_U + 0.02) > 0.9, 'no sudden crawl just past the wait point')
  assert.ok(settled(WAIT_FROM_U + 0.15) < settled(WAIT_FROM_U + 0.05), 'slows monotonically')
  assert.ok(Math.abs(settled(0.95) - WAIT_SCALE) < 0.02 && WAIT_SCALE >= 0.25, 'the floor is a slow run, not a crawl')
}
console.log('descent-landing.test.mts: ok')
