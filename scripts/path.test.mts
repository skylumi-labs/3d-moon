/** The fly-to planner (journey/path.ts): duration law, ease, arc, subject coverage. tsx scripts/path.test.mts */
import assert from 'node:assert/strict'
import { ARC_CLEARANCE, BANK_MAX_DEG, FLY_MAX_MS, FLY_MIN_MS, MIN_COVER, SAMPLES, chordMinRadius, chordPositions, ease, flyDurationMs, flyEase, minCoverAlong, planFly, zoomPanPath, type FlyEnd } from '../src/journey/path.ts'
import { angularDistance, subEarthPose, homePose, type Pose } from '../src/camera/pose.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { getCinematicFlight, sampleCinematicFlight } from '../src/cinematics/flights.ts'

const e = ephemerisAt(new Date('2026-10-20T19:00:00Z'))
const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`)
const end = (pose: Pose, fovDeg = 30, look: 0 | 1 = 0): FlyEnd => ({ pose, fovDeg, aimShift: 0, aimShiftX: 0, look })
const P = (lon: number, lat: number, dist: number): Pose => ({ lon, lat, dist, roll: 0, pitch: 0 })

// 1. Duration: from the zoom-and-pan path length, with a shorter floor for tiny hops.
const tinyMs = flyDurationMs(P(0, 0, 1.5), P(0.5, 0, 1.5))
assert.ok(tinyMs > 1500 && tinyMs < FLY_MIN_MS, `a tiny hop takes under the cinematic floor (${tinyMs})`)
assert.ok(flyDurationMs(P(0, 0, 1.5), P(5, 0, 1.5)) >= FLY_MIN_MS, 'a 5 deg hop uses the cinematic floor')
assert.equal(flyDurationMs(P(0, 0, 1.5), P(0, 0, 1.5)), 1500, 'no move still takes the floor')
{ const d = flyDurationMs(P(0, 0, 12), P(180, 0, 1.05)); assert.ok(d > 5000 && d <= FLY_MAX_MS, `far to low across the Moon is long but mostly a zoom (${d})`) }
assert.ok(flyDurationMs(P(0, 0, 1.01), P(180, 0, 1.01)) >= FLY_MAX_MS - 1, 'antipodal low-to-low takes the longest a fly-to may (6 s since 2026-10-20)')
assert.ok(flyDurationMs(P(0, 0, 1.5), P(60, 0, 1.5)) >= FLY_MIN_MS, 'moves over five degrees take at least 2.6 s')
assert.ok(flyDurationMs(P(0, 0, 1.2), P(50, 0, 1.2)) > flyDurationMs(P(0, 0, 4.3), P(50, 0, 4.3)), 'the same travel takes longer low down, where the ground streams past')

// 1b. The zoom-and-pan path: starts and ends on its two altitudes and travels all the way; a pure zoom is exponential.
{
  const z = zoomPanPath(0.9, 0.2, 0.2)
  near(z.w(0), 0.2, 1e-12, 'start altitude'); near(z.w(z.S), 0.2, 1e-9, 'end altitude')
  near(z.u(0), 0, 1e-12, 'no travel at the start'); near(z.u(z.S), 0.9, 1e-9, 'the whole travel at the end')
  near(z.sPeak, z.S / 2, 1e-9, 'a symmetric move peaks in the middle')
  assert.ok(z.w(z.sPeak) > 0.5, `and climbs to see both ends (${z.w(z.sPeak)})`)
  const tiny = zoomPanPath(0.9, 1e-4, 0.2)
  assert.ok(Number.isFinite(tiny.S) && Math.abs(tiny.u(tiny.S) - 0.9) < 1e-6, 'stable from a camera on the ground')
  const zoom = zoomPanPath(0, 3, 0.3)
  near(zoom.w(zoom.S), 0.3, 1e-9, 'a pure zoom ends at its altitude')
  near(zoom.w(zoom.S / 2), Math.sqrt(3 * 0.3), 1e-9, 'halfway in the log of the altitude')
}

// 1c. The time law glides: zero speed at both ends, a steady cruise, and a peak no higher than 1 / (1 - 0.3) of the mean.
{
  near(flyEase(0), 0, 1e-12, 'start'); near(flyEase(1), 1, 1e-12, 'end'); near(flyEase(0.5), 0.5, 1e-12, 'midpoint')
  near(flyEase(0.3) + flyEase(0.7), 1, 1e-12, 'symmetry')
  const v = (x: number): number => (flyEase(x + 1e-5) - flyEase(x - 1e-5)) / 2e-5
  assert.ok(v(1e-4) < 0.01 && v(1 - 1e-4) < 0.01, 'at rest at both ends')
  near(v(0.4), v(0.6), 1e-6, 'a steady cruise')
  assert.ok(v(0.5) <= 1 / 0.7 + 1e-6, 'the peak speed')
}

// 1d. The bow and the bank: a move off to one side curves toward the top of the starting frame, banks into the turn, and both
// vanish at the ends. The altitude never dips and climbs back (the old law's 4.3, 3.4, 4.3, 1.2 from Home to Copernicus).
{
  const a = end(P(0, 0, 1.2)), b = end(P(-50, 0, 1.2)) // due west: to the left of a north-up frame
  const plan = planFly(e, a, b, { aspect: 1.6 })
  const mid = plan.at(0.5).pose
  assert.ok(mid.lat > 1, `bows north, toward the top of the frame (${mid.lat})`)
  assert.ok((mid.roll ?? 0) > 1 && (mid.roll ?? 0) <= BANK_MAX_DEG + 1e-9, `banks left into the left-hand curve (${mid.roll})`)
  near(plan.at(1).pose.roll ?? 0, 0, 1e-9, 'level on arrival')
  near(plan.at(1).pose.lat, 0, 1e-9, 'and exactly on the destination')
  const east = planFly(e, a, end(P(50, 0, 1.2)), { aspect: 1.6 }).at(0.5).pose
  assert.ok(east.lat > 1 && (east.roll ?? 0) < -1, `to the right: bows north too and banks right (${east.lat}, ${east.roll})`)
  const home = planFly(e, end(P(-5, 5, 4.3)), end(P(-20.08, 9.62, 1.2)), { aspect: 1.6 })
  for (let i = 0; i < 100; i++) assert.ok(home.at((i + 1) / 100).pose.dist <= home.at(i / 100).pose.dist + 1e-9, `a descent never climbs back (${i})`)
}

// 1e. A hand-over to a flight (endRate) bows to the side the flight's heading comes back from (a flight leaving south-west is met by a
// curve swung north that comes down into it), so the arrival turns into the flight: one curve, never a bow one way bent back the other.
{
  const a = end(P(0, 0, 1.2)), b = end(P(-50, 0, 1.2)) // due west; with no hand-over it bows north (1d)
  for (const sgn of [-1, 1]) {
    const plan = planFly(e, a, b, { aspect: 1.6, endRate: { lon: -0.2, lat: 0.6 * sgn, dist: 0 } })
    const mid = plan.at(0.5).pose
    assert.ok(mid.lat * sgn < -1, `bows away from the flight's heading (${sgn > 0 ? 'north' : 'south'}: ${mid.lat})`)
    for (let i = 1; i < 100; i++) assert.ok(plan.at(i / 100).pose.lat * sgn < 1e-6, `stays on one side, no S at the join (${sgn}, ${i}: ${plan.at(i / 100).pose.lat})`)
  }
}

// 2. The ease is quintic, symmetric, 0 to 1.
assert.equal(ease(0), 0); assert.equal(ease(1), 1); near(ease(0.5), 0.5, 1e-12, 'midpoint')
near(ease(0.3) + ease(0.7), 1, 1e-12, 'symmetry')

// 3. A plan starts and ends exactly on its two ends, and the lens, aim and roll move with the same ease.
{
  const a = end(homePose(e)), b = { ...end(P(-20.08, 9.62, 1.5), 30), aimShift: 0.3, aimShiftX: -0.1 }
  const plan = planFly(e, a, b, { aspect: 1.6 })
  const s0 = plan.at(0), s1 = plan.at(1)
  near(s0.pose.dist, 6, 1e-9, 'start distance'); near(s1.pose.dist, 1.5, 1e-9, 'end distance')
  near(s1.pose.lon, -20.08, 1e-6, 'end lon'); near(s1.pose.lat, 9.62, 1e-6, 'end lat')
  near(s1.aimShift, 0.3, 1e-12, 'end aim'); near(s1.aimShiftX, -0.1, 1e-12, 'end aim x')
  assert.ok(plan.ms >= FLY_MIN_MS && plan.ms <= FLY_MAX_MS)
  // A travelling path rises and then descends; its endpoints stay exact and it never passes its planned apex.
  near(plan.at(0).pose.dist, a.pose.dist, 1e-12, 'exact start distance')
  near(plan.at(1).pose.dist, b.pose.dist, 1e-12, 'exact end distance')
  for (let i = 1; i < 50; i++) assert.ok(plan.at(i / 50).pose.dist <= plan.apexDist + 1e-9, `under planned apex at ${i}`)
  assert.ok(plan.minRadius >= 1.49, 'never nearer than the end')
}

// Site poses can be slightly inside the unit sphere; the log-altitude profile must meet the endpoints continuously.
{
  const a = end(P(10, 0, 1.4)), b = end(P(12, 1, 0.99985))
  const plan = planFly(e, a, b)
  near(plan.at(0).pose.dist, a.pose.dist, 1e-12, 'below-radius case starts exactly')
  near(plan.at(1).pose.dist, b.pose.dist, 1e-12, 'below-radius case ends exactly')
  assert.ok(Math.abs(plan.at(0.999999).pose.dist - b.pose.dist) < 1e-6, 'below-radius case approaches the end without a step')
}

// A pure zoom has no travel arc and stays monotone.
{
  const plan = planFly(e, end(P(10, 0, 6)), end(P(10, 0, 1.5)))
  let previous = Infinity
  for (let i = 0; i <= 50; i++) {
    const dist = plan.at(i / 50).pose.dist
    assert.ok(dist <= previous + 1e-9, `pure zoom decreases monotonically at ${i}`)
    previous = dist
  }
}

// 4. Great circle: the path between two poses at the same distance takes the shortest way and only lifts a little to frame both ends.
{
  const plan = planFly(e, end(P(-170, 0, 2)), end(P(170, 0, 2)), { aspect: 1.6 })
  const mid = plan.at(0.5).pose
  near(Math.abs(mid.lon), 180, 1e-6, 'the short way round, through 180 deg')
  assert.ok(mid.dist >= 2 && mid.dist < 2.1, `a gentle lift (${mid.dist})`)
}

// 5. The arc: a straight line between low, opposite poses runs through the Moon; the plan climbs instead.
{
  const a = P(0, 0, 1.3), b = P(180, 0, 1.3)
  assert.ok(chordMinRadius(e, a, b) < ARC_CLEARANCE, 'the chord passes through the Moon')
  // The subject-coverage assertion FAILS on the straight chord: the camera is inside the Moon, nothing is in frame.
  const chordCover = minCoverAlong(e, chordPositions(e, a, b), 30, 1.6)
  assert.ok(chordCover < MIN_COVER, `coverage ${chordCover} fails on the chord`)
  const plan = planFly(e, end(a), end(b), { aspect: 1.6 })
  assert.ok(plan.arc > 0, 'the arc is inserted')
  assert.ok(plan.apexDist > 1.3, 'the antipodal path rises')
  assert.ok(plan.minRadius >= 1.29, `never inside the start distance (${plan.minRadius})`)
  assert.ok(plan.minCover >= MIN_COVER, `the plan passes the same assertion (${plan.minCover})`)
  for (let i = 0; i <= SAMPLES; i++) assert.ok(plan.at(i / SAMPLES).pose.dist >= 1.29, `above the surface at ${i}`)
  // A near hop lifts only a little: enough to frame both ends, not a trip to orbit.
  const hop = planFly(e, end(P(0, 0, 1.5)), end(P(30, 10, 1.5)))
  assert.ok(hop.apexDist > 1.5 && hop.apexDist < 1.8, `a gentle lift on a near hop (${hop.apexDist})`)
}

// A long descent turns the globe from high up first, then settles onto the destination in one sweep that never climbs back.
{
  const plan = planFly(e, end(P(0, 0, 6)), end(P(180, 0, 1.5)), { aspect: 1.6 })
  const at = (u: number) => plan.at(u).pose
  assert.ok(at(0.3).dist > 4.5 && angularDistance(0, 0, at(0.3).lon, at(0.3).lat) > 80 * Math.PI / 180, `most of the turn happens high up (${at(0.3).dist})`)
  for (let i = 10; i < 100; i++) assert.ok(at((i + 1) / 100).dist <= at(i / 100).dist + 1e-9, `then descends without climbing back (${i})`)
  assert.ok(plan.ms >= 5500, `half a turn of the Moon is not rushed (${plan.ms})`)
  assert.ok(plan.minRadius >= 1.49, 'the direct descent still clears the Moon')
}

// 6. Subject coverage on a move that changes subject: the Earth look blends over the middle 40 %, and both ends and every sample have a body in frame.
{
  const a = end(homePose(e)), b = end({ lon: e.subEarth.lon + 180, lat: -e.subEarth.lat + 20, dist: 4, roll: 0, pitch: 0 }, 20, 1)
  const plan = planFly(e, a, b, { aspect: 1.6 })
  assert.equal(plan.at(0).look, 0); assert.equal(plan.at(1).look, 1)
  assert.equal(plan.at(0.1).look, 0, 'the look has not started to turn in the first part')
  assert.ok(plan.at(0.9).look > 0.99, 'and has all but finished before the last part')
  near(plan.at(1).fovDeg, 20, 1e-9, 'the destination lens is exact')
  near(plan.at(0).fovDeg, 30, 1e-9, 'and so is the start lens')
  assert.ok(plan.minCover >= MIN_COVER, `a body covers at least ${MIN_COVER} of the frame at every sample (${plan.minCover})`)
  assert.ok(plan.widen.some((w) => w > 1) || plan.minCover >= MIN_COVER)
  // The widened lens is a lens, never narrower than the plain one.
  for (let i = 0; i <= 100; i++) {
    const u = i / 100, s = plan.at(u)
    const k = flyEase(u), plain = Math.exp(Math.log(30) + (Math.log(20) - Math.log(30)) * k)
    assert.ok(s.fovDeg >= plain - 1e-9, `lens at ${u}`)
  }
}

// 7. The Earth view as a pose: far out with a narrow lens, the Moon still fills the frame.
{
  const p = subEarthPose(e, 12)
  const plan = planFly(e, end(homePose(e)), end(p, 11), { aspect: 1.6 })
  assert.ok(plan.minCover >= MIN_COVER)
  near(plan.at(1).fovDeg, 11, 1e-9, 'end lens')
}

// Apex distance increases with great-circle travel, with exact endpoints and zero endpoint velocity.
{
  const apex = (degrees: number): number => planFly(e, end(P(0, 0, 1.2)), end(P(degrees, 0, 1.2))).apexDist
  assert.ok(apex(10) < apex(60) && apex(60) < apex(160), 'apex scales with travel')
  const plan = planFly(e, end(P(0, 0, 1.2)), end(P(160, 0, 1.2)))
  near(plan.at(0).pose.dist, 1.2, 1e-12, 'start is exact')
  near(plan.at(1).pose.dist, 1.2, 1e-12, 'end is exact')
  for (let i = 0; i < 50; i++) assert.ok(plan.at((i + 1) / 100).pose.dist >= plan.at(i / 100).pose.dist - 1e-9, 'rise is monotone')
  for (let i = 50; i < 100; i++) assert.ok(plan.at((i + 1) / 100).pose.dist <= plan.at(i / 100).pose.dist + 1e-9, 'descent is monotone')
  assert.ok(Math.abs(plan.at(0.001).pose.dist - 1.2) < 1e-5, 'start velocity is near zero')
  assert.ok(Math.abs(plan.at(0.999).pose.dist - 1.2) < 1e-5, 'end velocity is near zero')
}

// Round 5 regression: pole-to-low-view transitions must not make a one-frame
// pitch or altitude step at 60 Hz, including narrow and wide viewports.
{
  const aspects = [390 / 844, 1, 16 / 9]
  const targetPitches = [40, 52, 65]
  for (const aspect of aspects) for (const targetPitch of targetPitches) {
    const plan = planFly(e, end({ ...P(0, 82, 1.5), pitch: 0 }), end({ ...P(0, 0, 1.5), pitch: targetPitch }), { aspect })
    const frames = Math.ceil(plan.ms / 1000 * 60)
    const samples = Array.from({ length: frames + 1 }, (_, i) => plan.at(i / frames))
    const pitchSteps = samples.slice(1).map((s, i) => Math.abs((s.pose.pitch ?? 0) - (samples[i].pose.pitch ?? 0)))
    const logAltitudeSteps = samples.slice(1).map((s, i) => Math.abs(Math.log(s.pose.dist - 1) - Math.log(samples[i].pose.dist - 1)))
    const avgPitchStep = pitchSteps.reduce((sum, step) => sum + step, 0) / pitchSteps.length
    const avgLogAltitudeStep = logAltitudeSteps.reduce((sum, step) => sum + step, 0) / logAltitudeSteps.length
    assert.ok(Math.max(...pitchSteps) <= Math.max(0.35, 2.5 * avgPitchStep), `pitch step ${Math.max(...pitchSteps)} exceeds smoothness bound at aspect=${aspect}, pitch=${targetPitch}`)
    assert.ok(Math.max(...logAltitudeSteps) <= 3 * avgLogAltitudeStep, `log-altitude step ${Math.max(...logAltitudeSteps)} exceeds smoothness bound at aspect=${aspect}, pitch=${targetPitch}`)
  }
}

// The approach plan must land on the exact first cinematic sample so the
// planner-to-track handoff cannot introduce a pose, lens, or orientation snap.
{
  const flight = getCinematicFlight('terminator-run')!
  const target = sampleCinematicFlight(flight, 0, e, () => 1.0005, () => 0)
  const destination = end(target.pose, target.fovDeg, target.look)
  const plan = planFly(e, end(P(target.pose.lon - 12, 82, 1.5)), destination, { aspect: 390 / 844 })
  const arrival = plan.at(1)
  near(arrival.pose.lon, target.pose.lon, 1e-3, 'handoff longitude')
  near(arrival.pose.lat, target.pose.lat, 1e-3, 'handoff latitude')
  near(arrival.pose.dist, target.pose.dist, 1e-3, 'handoff distance')
  near(arrival.pose.roll ?? 0, target.pose.roll ?? 0, 1e-3, 'handoff roll')
  near(arrival.pose.pitch ?? 0, target.pose.pitch ?? 0, 1e-3, 'handoff pitch')
  near(arrival.fovDeg, target.fovDeg, 1e-3, 'handoff fov')
}
// A5 (owner: "it took a pause"): travel starts at the first frames, no dead zone, and never spikes in speed.
{
  for (const [from, to] of [[P(0, 0, 6), P(60, 20, 1.3)], [P(0, 0, 1.5), P(8, 0, 1.5)], [P(10, 40, 3), P(-120, -30, 1.2)]] as Array<[Pose, Pose]>) {
    const plan = planFly(e, end(from), end(to))
    const theta = angularDistance(from.lon, from.lat, plan.to.pose.lon, plan.to.pose.lat)
    const ang = (u: number): number => angularDistance(from.lon, from.lat, plan.at(u).pose.lon, plan.at(u).pose.lat)
    assert.ok(ang(0.05) > 2e-4 * theta, `moves sideways by u=0.05 (${ang(0.05)} of ${theta})`)
    assert.ok(ang(0.02) > 0 && ang(0.02) < ang(0.05) && ang(0.05) < ang(0.1), 'strictly advancing from the first frames')
    // Speed as the eye sees it: ground travel over the altitude (the frame's span) combined with the zoom rate, per unit time.
    const N = 400
    let peak = 0, prev = 0, sum = 0
    for (let i = 1; i <= N; i++) {
      const a = ang(i / N)
      assert.ok(a >= prev - 1e-9, `angular progress is monotone at ${i}`)
      const alt0 = plan.at((i - 1) / N).pose.dist - 1, alt1 = plan.at(i / N).pose.dist - 1
      const seen = Math.hypot((a - prev) / ((alt0 + alt1) / 2), Math.log(alt1 / alt0)) * N
      peak = Math.max(peak, seen); sum += seen / N
      prev = a
    }
    assert.ok(peak <= 1.8 * sum, `the seen speed peaks at ${peak}, within 1.8x its mean ${sum}: a glide, never a lunge`)
  }
}

// A5 provisional start: a plan re-made from the live pose of a running plan (the tiles arrived mid-move) starts exactly there and moves on its first frame.
{
  const first = planFly(e, end(P(0, 0, 6)), end(P(60, 20, 3.578)))
  for (const u of [0.05, 0.3, 0.6]) {
    const live = first.at(u)
    const second = planFly(e, end(live.pose, live.fovDeg), end(P(60, 20, 1.5)))
    const s0 = second.at(0)
    near(s0.pose.lon, live.pose.lon, 1e-9, 'takeover keeps lon'); near(s0.pose.lat, live.pose.lat, 1e-9, 'and lat'); near(s0.pose.dist, live.pose.dist, 1e-9, 'and distance')
    assert.ok(Math.abs(second.at(0.05).pose.dist - live.pose.dist) > 0 || angularDistance(live.pose.lon, live.pose.lat, second.at(0.05).pose.lon, second.at(0.05).pose.lat) > 0, 'and moves at once')
    assert.ok(second.at(1).pose.dist <= 1.5 + 1e-9, 'the takeover ends at the real (lower) target, not the D_MIN floor')
  }
}
console.log('path.test ok')

// Departure from a site below the datum (issue 188): Apollo 17's ground is -2626 m, its eye pose ~0.9994 R. Altitude counts from the
// local ground, so the move climbs from the start and is not pinned at the 9 s cap by a 1e-6 altitude floor.
{
  const ground = -2626 / 1737.4 / 1000
  const a17 = { ...end(P(30.77, 20.19, 0.99937)), ground }
  const home = end(P(30.77 + 34.4, 20.19, 6))
  const withGround = planFly(e, a17, home, { aspect: 1.6 })
  const without = planFly(e, end(P(30.77, 20.19, 0.99937)), home, { aspect: 1.6 })
  const alt = (plan: typeof withGround, u: number): number => plan.at(u).pose.dist - 1 - ground
  const start = alt(withGround, 0)
  // Duration counts octaves of altitude above the ground: to a 1.02 R pose a degree away it is well under the cap (the 6 s cap would hide it on the old 34 deg move), not 22 octaves from 1e-6.
  const near105 = end(P(30.77 + 1, 20.19, 1.02))
  const dur = planFly(e, a17, near105, { aspect: 1.6 }).ms
  assert.ok(dur < FLY_MAX_MS - 500, `a below-datum departure is not at the cap: ${dur}`)
  assert.ok(planFly(e, end(P(30.77, 20.19, 0.99937)), near105, { aspect: 1.6 }).ms > dur + 300, 'counting from the sphere instead of the ground would make it longer')
  assert.ok(without.ms >= withGround.ms, 'ground never lengthens the move')
  // The glide's first 30 % is its gentle lift-off: already five times the starting height, not pinned near the ground.
  assert.ok(alt(withGround, 0.3) > 5 * start, `climbs in the first 30%: ${alt(withGround, 0.3)} vs ${start}`)
  for (let i = 1; i <= 20; i++) assert.ok(withGround.at(i / 20).pose.dist >= 1 + ground + 1e-6, `above the local ground at ${i}`)
  near(withGround.at(0).pose.dist, 0.99937, 1e-12, 'exact start'); near(withGround.at(1).pose.dist, 6, 1e-12, 'exact end')
  // The same altitude over a 0 ground departs just as fast: ground is the only difference.
  const flat = planFly(e, end(P(30.77, 20.19, 1 + (0.99937 - 1 - ground))), home, { aspect: 1.6 })
  near(alt(withGround, 0.3), flat.at(0.3).pose.dist - 1, 0.02 * alt(withGround, 0.3), 'matches the flat-ground climb')
}
