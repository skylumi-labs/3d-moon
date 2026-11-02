/**
 * The Apollo 11 pin's descent (WP8, A22): ONE continuous path that starts high (apex >= 1.4 radii), never rises after the apex, never
 * hovers, slides sideways only in the top half and ends on the unchanged end pose. Offline. npx tsx scripts/descent-apollo11.test.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { angularDistance, reliefShare, type Pose } from '../src/camera/pose.ts'
import { stepClock, type ClockState } from '../src/descent/clock.ts'
import { landingPose, type LandingInput } from '../src/descent/landing.ts'
import { SITE_APEX_DIST, SITE_FUNNEL_DIST, descentDetailResident, floorGuard, funnelAim, gatedU, siteApexDist, stepGate } from '../src/descent/siteDrop.ts'
import { PITCH_OVER_U } from '../src/descent/landing.ts'
import { PATCH_LOADING_INFLIGHT, inflightCap } from '../src/moon/tiles/wanted.ts'
import { PATCH_SITES } from '../src/moon/patch/sites.ts'

const R_M = 1737400
const a11 = PATCH_SITES.a11
const GROUND = a11.groundM / R_M
const ALT_R = 0.5 * 1080 / (1000 * 1737.4 * 2 * Math.tan(15 * Math.PI / 180))
const APEX_DIST = 2.5
const APEX_ALT = APEX_DIST - 1 - GROUND
const base = (from: Pose, alt0: number, slide: number, apex = true, climbU = 0): LandingInput => ({
  site: { lon: a11.lon, lat: a11.lat }, end: a11.end, alt1: ALT_R, from, alt0, slide,
  groundAt: () => GROUND,
  floorAt: () => 1 + GROUND + ALT_R,
  relief: reliefShare, moonRadiusM: R_M,
  ...(apex ? { apex: APEX_ALT, climbU } : {}),
})
const N = 3000
const path = (p: LandingInput): Pose[] => Array.from({ length: N + 1 }, (_, i) => landingPose(i / N, p))
const rangeM = (q: Pose): number => angularDistance(q.lon, q.lat, a11.lon, a11.lat) * R_M
const alt = (q: Pose): number => q.dist - 1 - GROUND

// Three starts: Home (far above the apex, off to the side), over the site at the apex, and a low flight 120 km up two degrees away (climbs out first).
const starts: Array<{ name: string; p: LandingInput }> = [
  { name: 'from Home', p: base({ lon: 5, lat: 10, dist: 6, roll: 0, pitch: 0 }, 5 - GROUND, 0.4) },
  { name: 'at the apex', p: base({ lon: a11.lon, lat: a11.lat, dist: APEX_DIST, roll: 0, pitch: 0 }, APEX_ALT, 0.3) },
  { name: 'from a low flight', p: base({ lon: a11.lon + 2, lat: a11.lat - 1, dist: 1.07, roll: 0, pitch: 0 }, 0.07 - GROUND, 0.4, true, 0.3) },
  // Just under the apex (the old hover case: a few hundred metres low): the climb is skipped, the altitude falls from frame 1.
  { name: 'just under the apex', p: base({ lon: a11.lon + 0.5, lat: a11.lat, dist: APEX_DIST - 0.0002, roll: 0, pitch: 0 }, APEX_ALT - 0.0002, 0.3) },
  // A tilted, rolled camera (WP4 tilt) high above, and one on a different site's floor (a rise to 1.36 R has run).
  { name: 'tilted and rolled from Home', p: base({ lon: 0, lat: 0, dist: 3.6, roll: 10, pitch: 20 }, 2.6 - GROUND, 0.4) },
  { name: 'from another site', p: base({ lon: 30.77, lat: 20.19, dist: 1.36, roll: 0, pitch: 0 }, 0.36 - GROUND, 0.4, true, 0.25) },
]
const DROP_S = 12   // an illustrative duration for the rate checks

for (const { name, p } of starts) {
  const ps = path(p)
  // 1. It starts high: the highest point of the path is the apex, >= 1.4 radii; for a start at or above it the first frame is there.
  const top = ps.reduce((m, q, i) => (q.dist > ps[m].dist ? i : m), 0)
  assert.ok(ps[top].dist >= 2.4 || ps[top].dist >= p.from.dist - 1e-9, `${name}: apex ${ps[top].dist.toFixed(3)} (2.5 R, or the start when it is higher)`)
  if (name === 'from Home' || name === 'at the apex') assert.ok(ps[0].dist >= 1.4, `${name}: first frame at ${ps[0].dist.toFixed(3)} >= 1.4`)
  // 2. Altitude is monotone after the apex (no rise while the patch swaps), and strictly falling (no hover) until the last stretch.
  for (let i = top + 1; i <= N; i++) assert.ok(ps[i].dist <= ps[i - 1].dist + 1e-12, `${name}: altitude never rises after the apex (frame ${i})`)
  // A minimum rate, not just "decreasing": at least 0.1 octave/s of altitude outside the apex crest and the last 7 % (no hover, no near-flat stretch).
  for (let i = top + Math.ceil(N * 0.04); i <= Math.floor(N * 0.93); i++) {
    const oct = Math.log2(alt(ps[i - 1]) / alt(ps[i])) / (DROP_S / N)
    assert.ok(oct >= 0.1, `${name}: no hover or slow crawl (frame ${i}: ${oct.toFixed(3)} octaves/s)`)
  }
  // Frame 1 is continuous with the start: same place, the attitude moves by a bounded angle.
  assert.ok(Math.abs(ps[0].dist - p.from.dist) < 1e-9 && angularDistance(ps[0].lon, ps[0].lat, p.from.lon, p.from.lat) < 1e-9, `${name}: starts at the camera's position`)
  assert.ok(Math.abs(ps[1].pitch - (p.from.pitch ?? 0)) < 0.05 && Math.abs(ps[1].roll - p.from.roll) < 0.05, `${name}: no attitude snap on frame 1`)
  assert.ok(Math.abs(ps[0].pitch - (p.from.pitch ?? 0)) < 1e-9 && Math.abs(ps[0].roll - p.from.roll) < 1e-9, `${name}: frame 0 is the current attitude`)
  // 3. Before the apex, only a climb: never a dip first.
  for (let i = 1; i <= top; i++) assert.ok(ps[i].dist >= ps[i - 1].dist - 1e-12, `${name}: climbs straight to the apex (frame ${i})`)
  // 4. The slide over the site is done by the middle of the path: from then the camera is within the pitch-over range (a few km) of the site.
  for (let i = N / 2; i <= N; i++) assert.ok(rangeM(ps[i]) <= 6000, `${name}: no lateral travel in the lower half (frame ${i}: ${rangeM(ps[i]).toFixed(0)} m)`)
  // 5. No jump between frames.
  for (let i = 1; i <= N; i++) {
    const hm = angularDistance(ps[i].lon, ps[i].lat, ps[i - 1].lon, ps[i - 1].lat) * R_M
    assert.ok(Math.abs(Math.log(Math.max(1e-9, alt(ps[i])) / Math.max(1e-9, alt(ps[i - 1])))) < 0.02, `${name}: no altitude jump (frame ${i})`)
    assert.ok(hm < 20000, `${name}: no lateral jump (frame ${i}: ${hm.toFixed(0)} m)`)
    assert.ok(Math.abs(ps[i].pitch - ps[i - 1].pitch) < 0.2, `${name}: no pitch jump (frame ${i})`)
  }
  // 6. The end pose is unchanged by the apex: the same as the plain landing path from the same start.
  const plain = landingPose(1, base(p.from, p.alt0, p.slide, false))
  const end = ps[N]
  for (const k of ['lon', 'lat', 'dist', 'roll', 'pitch'] as const) assert.ok(Math.abs(end[k] - plain[k]) < 1e-12, `${name}: end ${k} unchanged`)
  console.log(`${name}: apex ${ps[top].dist.toFixed(3)} R at u ${(top / N).toFixed(3)}, end ${(alt(end) * R_M).toFixed(0)} m up`)
}
// 6b. The travel over to the site flies the fly-to's curve: from Home it bows to one side of the great circle (never both: no S), and the
// camera banks into the curve and is level again once over the site.
{
  const p = starts[0].p, ps = path(p)
  const dir = (q: { lon: number; lat: number }): [number, number, number] => {
    const D = Math.PI / 180, c = Math.cos(q.lat * D)
    return [c * Math.cos(q.lon * D), c * Math.sin(q.lon * D), Math.sin(q.lat * D)]
  }
  const d0 = dir(p.from), d1 = dir(a11)
  const n = [d0[1] * d1[2] - d0[2] * d1[1], d0[2] * d1[0] - d0[0] * d1[2], d0[0] * d1[1] - d0[1] * d1[0]]
  // The cross-track of the camera's ground track over the slide (the camera also backs off the track along the end heading, a few km).
  const off = ps.slice(0, Math.floor(N * p.slide)).map((q) => { const v = dir(q); return v[0] * n[0] + v[1] * n[1] + v[2] * n[2] })
  const peak = off.reduce((m, x) => (Math.abs(x) > Math.abs(m) ? x : m), 0)
  assert.ok(Math.abs(peak) * R_M > 20000, `bows off the great circle (${(peak * R_M / 1000).toFixed(0)} km)`)
  for (const x of off) assert.ok(x * Math.sign(peak) * R_M > -5000, `one side only, no S (${(x * R_M).toFixed(0)} m)`)
  const banks = ps.slice(0, Math.floor(N * p.slide)).map((q) => q.roll)
  assert.ok(Math.max(...banks.map(Math.abs)) > 1, `banks into the curve (${Math.max(...banks.map(Math.abs)).toFixed(1)} deg)`)
}
// 7. The end view itself is the site table's.
assert.deepEqual(a11.end, { headingDeg: 0, pitchDeg: 38 })

// 8. The patch wait does not read as a stall: the clock's speed never changes by more than 2% of full speed per 60 Hz frame, and never stops.
{
  const c: ClockState = { t0: 0, ms: 12000 }
  let now = 0, prevU = 0, prevRate = 1, minRate = 1
  while (now < 90000) {
    now += 16.7
    const u = stepClock(c, now, now > 60000)   // detail missing for the whole descent
    const rate = (u - prevU) / (16.7 / c.ms)
    if (now > 100 && u < 1) assert.ok(Math.abs(rate - prevRate) < 0.02, `speed changes smoothly (t ${now.toFixed(0)}: ${prevRate.toFixed(3)} -> ${rate.toFixed(3)})`)
    if (u < 1) minRate = Math.min(minRate, rate)
    prevU = u; prevRate = rate
    if (u >= 1) break
  }
  assert.ok(minRate > 0.25, `never frozen (${minRate.toFixed(2)})`)
}

// 8b. The apex is no higher than the camera needs: min(2.5 R, max(the camera's distance, the funnel)).
assert.equal(siteApexDist(12), SITE_APEX_DIST)
assert.equal(siteApexDist(1.03), SITE_FUNNEL_DIST, 'a low camera climbs only to the funnel')
assert.equal(siteApexDist(1.9), 1.9, 'a camera in the band starts where it is')
assert.equal(siteApexDist(3.6), SITE_APEX_DIST, 'a camera above the apex descends from where it is')

// 8c. Patch not ready: the journey moves from the first frames, creeps at the funnel (never zero, never a step), and resumes smoothly when ready.
for (const readyAt of [Infinity, 8000, 25000]) {
  const ms = 14000, uFunnel = 0.3
  let u = 0, gate = 1, now = 0, prevRate = -1, firstMove = -1
  const rates: number[] = []
  while (now < 60000 && u < 1) {
    const frame = 16.7
    now += frame
    const ready = now >= readyAt
    gate = stepGate(gate, funnelAim(u, uFunnel, ready), frame)
    const du = frame / ms
    const next = gatedU(u, u + du, gate)
    const rate = (next - u) / du
    if (firstMove < 0 && next > u) firstMove = now
    if (prevRate >= 0 && next < 1) assert.ok(Math.abs(rate - prevRate) < 0.04, `readyAt ${readyAt}: speed changes smoothly (t ${now.toFixed(0)}: ${prevRate.toFixed(3)} -> ${rate.toFixed(3)})`)
    if (next < 1) assert.ok(rate > 0.04, `readyAt ${readyAt}: never zero (t ${now.toFixed(0)}: ${rate.toFixed(3)})`)
    rates.push(rate)
    prevRate = rate
    u = next
  }
  assert.ok(firstMove <= 2 * 16.7 + 1e-9, `readyAt ${readyAt}: moves within 2 frames of the tap (${firstMove} ms)`)
  if (readyAt === Infinity) assert.ok(u < 1 && u > uFunnel, `not ready: creeping past the funnel at ${u.toFixed(3)} after 60 s, not stopped`)
  else assert.ok(u >= 1 || now >= 60000, `readyAt ${readyAt}: the journey completes`)
}
// The journey from Home to the end is within 20 s with the patch ready on the first frame (warm cache): the drop's time law.
{
  const endDoublings = Math.log2((12 - 1 - GROUND) / 6e-4)   // Home at ~12 R on a wide viewport
  assert.ok(endDoublings * 1.0 <= 20, `Home to the end ${endDoublings.toFixed(1)} s <= 20 s`)
}

// 8d. The CAMERA (not the clock) keeps descending through a patch wait, and the release is no lurch: no 1.4 R clamp, dist falls every frame
// through the wait, and the biggest frame-to-frame distance change at the 'ready' frame is no larger than the path's own peak.
for (const start of [starts[0], starts[2]]) {
  for (const readyAt of [8000, 25000]) {
    const p = start.p
    const ms = 14000
    const CAM_FLOOR = 1.0484   // the tiles' floor, about 84 km
    let u = 0, gate = 1, now = 0, prev: number | null = null, prevV = 0, uFunnel = 1
    for (let i = Math.floor((p.climbU ?? 0) * 200); i <= 200; i++) if (landingPose(i / 200, p).dist <= 1.4 + 1e-9) { uFunnel = i / 200; break }
    let peakV = 0, readyV = 0, readyFrame = -1
    const dists: number[] = []
    const frame = 16.7
    while (now < 70000 && u < 1) {
      now += frame
      const ready = now >= readyAt
      gate = stepGate(gate, funnelAim(u, uFunnel, ready), frame)
      u = gatedU(u, u + frame / ms, gate)
      const dist = Math.max(landingPose(u, p).dist, CAM_FLOOR)
      if (prev !== null) {
        const v = Math.abs(dist - prev) / frame
        peakV = Math.max(peakV, v)
        if (ready && readyFrame < 0) { readyFrame = dists.length; readyV = Math.abs(v - prevV) }
        prevV = v
        if (!ready && dist > CAM_FLOOR + 1e-6 && u > (p.climbU ?? 0) + 0.01) assert.ok(dist < prev, `${start.name}, ready at ${readyAt}: the camera descends through the wait (t ${now.toFixed(0)}, dist ${dist.toFixed(5)} vs ${prev.toFixed(5)})`)
      }
      prev = dist
      dists.push(dist)
    }
    assert.ok(readyFrame >= 0, `${start.name}: the wait ended`)
    assert.ok(readyV <= peakV + 1e-12, `${start.name}, ready at ${readyAt}: the change of speed at the release (${readyV.toExponential(2)}) is within the path's own peak (${peakV.toExponential(2)})`)
  }
}

// 9. Wiring: the pin starts the drop from the apex (>= 1.4 R), over the site, with no 1.5 s approach / 2.6 s plunge pair.
const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
assert.ok(SITE_APEX_DIST >= 2.4, `SITE_APEX_DIST ${SITE_APEX_DIST}`)
assert.match(main, /const dropNow = \(isSiteDrop\(m\)/, 'the drop starts at once, without waiting for tiles or the patch')
assert.match(main, /void ensurePatch\(m\.needsPatch as string\)/, 'the patch load starts on the tap')
assert.match(main, /fast: true, msFixed: SITE_DROP_MS, apex: SITE_APEX_DIST/, 'startSiteView starts the apex descent')
assert.doesNotMatch(main, /FIXED_SITE_DROP_MS/, 'the 2.6 s plunge is gone')
assert.match(main, /else if \(siteDrop\) \{[^}]*rig\.stopInertia\(\)/, 'the drop has no separate fly-to')
assert.match(main, /!approachIsDrop && \(patchState/, 'no hover for the drop')
assert.match(main, /if \(apexPath && ready && !descent\.prefetched\)/, 'the descent prefetches its tiles, but only once the patch is ready (F1)')
// The timeline (#159) is live for the whole descent.
assert.match(main, /const scrubAnimating = !!\(flight \|\| cinematicFlight \|\| orbitJourney \|\| descent\)/, 'descent keeps the scrub timeline live')

// 10. F2: the end altitude comes from the finest AVAILABLE picture (floorTexelOf), not the finest resident level (the 59 m bridge at 'ready').
{
  const fn = main.slice(main.indexOf('function descentPose('), main.indexOf('function startDescent('))
  assert.match(fn, /floorTexelOf\(patch as PatchLayer\)/, 'descentPose: keep from floorTexelOf')
  assert.doesNotMatch(fn, /\.finest\.floorTexelM/, 'descentPose: no keep from the finest resident level')
  // Why it matters: the path at a mid-descent u moves by a large factor when alt1 collapses by 0.5/59.3 (the 35 km up-step at 'ready').
  const q = base({ lon: 5, lat: 10, dist: 6, roll: 0, pitch: 0 }, 5 - GROUND, 0.4)
  const lowAlt1 = landingPose(0.43, { ...q, alt1: ALT_R * 0.5 / 59.3, floorAt: () => 0 })
  const goodAlt1 = landingPose(0.43, { ...q, floorAt: () => 0 })
  assert.ok(Math.abs(lowAlt1.dist - goodAlt1.dist) / (goodAlt1.dist - 1 - GROUND) > 0.5, 'a collapsed alt1 moves the path by more than 50% of its altitude (the hazard)')
}

// 11. F1: the patch owns the link while the drop waits for it.
assert.equal(inflightCap({ patchLoading: true }, 6, 12), PATCH_LOADING_INFLIGHT)
assert.equal(inflightCap({ patchLoading: true, flight: true }, 6, 12), PATCH_LOADING_INFLIGHT)
assert.equal(inflightCap({}, 6, 12), 6)
assert.equal(inflightCap({ flight: true }, 6, 12), 12)
assert.match(main, /patchLoading: patchState === 'loading' && \(!!descent \|\| approachFor !== null\)/, 'the tile update is told the patch is loading under a descent, and while the hover over a site waits for it (2026-10-31: the A17 band)')
assert.match(main, /priority: 'high' \} as RequestInit/, 'the patch fetches go out at high priority')

// 12. F3: the pitch-over station respects the coverage floor, and a table for the clock.
{
  // A floor like Apollo 11's: 1.12 km inside the 0.5 m box (1 km), 4.48 km outside it.
  const floorAt = (lon: number, lat: number): number => 1 + GROUND + (angularDistance(lon, lat, a11.lon, a11.lat) * R_M < 1020 ? 1120 : 4480) / R_M
  const q = { ...base({ lon: 5, lat: 10, dist: 6, roll: 0, pitch: 0 }, 5 - GROUND, 0.4), floorAt }
  const ps = path(q)
  const iPo = Math.round(PITCH_OVER_U * N)
  const hStation = floorAt(ps[iPo].lon, ps[iPo].lat)
  assert.ok(ps[iPo].dist >= hStation - 1e-12, 'the path is above the floor at the station')
  // Before the station the clamp may touch, not carry: no run of clamped frames (dist == floor) before it.
  let run = 0, longest = 0
  for (let i = 0; i < iPo - 10; i++) {
    const clamped = ps[i].dist - floorAt(ps[i].lon, ps[i].lat) < 1e-12
    run = clamped ? run + 1 : 0
    longest = Math.max(longest, run)
  }
  assert.ok(longest <= 5, `no flat plateau before the pitch-over (longest clamped run ${longest} frames)`)
  for (let i = 1; i <= N; i++) assert.ok(ps[i].dist <= ps[i - 1].dist + 1e-12, `still never rising (frame ${i})`)
}
const res = (o: Partial<Parameters<typeof descentDetailResident>[0]>): boolean => descentDetailResident({ ready: true, apexPath: true, readyCoarse: true, refinementPending: true, boundLevels: 1, levels: 4, failedAndIdle: false, ...o })
assert.equal(res({}), true, 'an apex drop runs at full clock with the coarse patch and one level bound')
assert.equal(res({ boundLevels: 0 }), false)
assert.equal(res({ ready: false }), false)
assert.equal(res({ apexPath: false }), false, 'another descent waits for every level')
assert.equal(res({ apexPath: false, refinementPending: false, boundLevels: 4 }), true)

// 13. F4: the creep never reaches a floor it cannot see while the patch is not ready.
{
  const p = starts[0].p
  const FLOOR = 1.016   // the tiles' deep floor, 28 km
  const ms = 14000, frame = 16.7
  let uFunnel = 1
  for (let i = 0; i <= 200; i++) if (landingPose(i / 200, p).dist <= 1.4 + 1e-9) { uFunnel = i / 200; break }
  let u = 0, gate = 1, now = 0, dist = landingPose(0, p).dist, prev = dist
  while (now < 40000) {
    now += frame
    const g = floorGuard(dist, FLOOR)
    gate = stepGate(gate, funnelAim(u, uFunnel, false) * g, frame)
    u = gatedU(u, u + frame / ms, gate)
    dist = Math.max(landingPose(u, p).dist, FLOOR)
    assert.ok(dist <= prev + 1e-12, 'the creep never rises')
    assert.ok(dist - FLOOR > 1e-9, `the creep never touches the floor (t ${now.toFixed(0)}, ${(dist - FLOOR).toExponential(2)})`)
    prev = dist
  }
  assert.equal(floorGuard(3, FLOOR), 1)
  assert.equal(floorGuard(FLOOR, FLOOR), 0)
}
console.log('descent-apollo11 OK')
