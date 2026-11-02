import assert from 'node:assert/strict'
import { ephemerisAt } from '../src/ephemeris.ts'
import { MOMENTS } from '../src/moments.ts'
import { ECLIPSE_SUN_BEAT_U, eclipseEase, eclipseResumeU, flightAim, getCinematicFlight, sampleCinematicFlight, sunGaze, sunriseLongitude } from '../src/cinematics/flights.ts'
import { sunInFrame } from '../src/post/sunInFrame.ts'
import { earthNearSun } from '../src/sun/sunRouting.ts'
import { momentPose } from '../src/momentPose.ts'
import { EARTH_R_KM, MOON_R_KM, SUN_R_KM } from '../src/glsl/common.ts'
import { angularDistance, pickSphere, poseBasis, siteAltR, wrapLon, type Pose } from '../src/camera/pose.ts'
import { CameraRig } from '../src/camera/rig.ts'
import { planFly } from '../src/journey/path.ts'
import { MAX_FLIGHT_SECONDS, ORBIT_SECONDS } from '../src/journey/lifecycle.ts'

const floorAt = (lon: number, lat: number) => 1.02 + Math.abs(Math.sin((lon + lat) * Math.PI / 180)) * 0.003
const groundAt = (lon: number, lat: number) => Math.abs(Math.sin((lon - lat) * Math.PI / 180)) * 0.001
const date = new Date('1968-12-24T16:39:39Z')
const e = ephemerisAt(date)

function hitCount(pose: Pose, fovDeg: number, floor: number, aspect: number): number {
  const rig = new CameraRig()
  rig.setFloor(floor)
  rig.setPose(pose)
  rig.fovDeg = fovDeg
  const cam = rig.camera(e, aspect, 0)
  let hits = 0
  for (const y of [-0.75, -0.35, 0, 0.35, 0.75]) for (const x of [-0.7, 0, 0.7])
    if (pickSphere(cam, x, y, aspect)) hits++
  return hits
}

function sunDiskInFrame(pose: Pose, fovDeg: number, floor: number, aspect: number, e: ReturnType<typeof ephemerisAt>): boolean {
  const rig = new CameraRig()
  rig.setFloor(floor)
  rig.setPose(pose)
  rig.fovDeg = fovDeg
  const cam = rig.camera(e, aspect, 0)
  const rel = e.sunKm.clone().divideScalar(MOON_R_KM).sub(cam.pos)
  const dir = rel.clone().normalize(), back = dir.dot(cam.back)
  if (back >= 0) return false
  const radius = Math.asin(SUN_R_KM / (rel.length() * MOON_R_KM))
  const x = dir.dot(cam.right) / -back, y = dir.dot(cam.up) / -back
  return Math.abs(x) <= cam.tanHalf * aspect + Math.tan(radius) && Math.abs(y) <= cam.tanHalf + Math.tan(radius)
}

function sunFrameMarginDeg(pose: Pose, fovDeg: number, floor: number, aspect: number, e: ReturnType<typeof ephemerisAt>): number {
  const rig = new CameraRig(); rig.setFloor(floor); rig.setPose(pose); rig.fovDeg = fovDeg
  const cam = rig.camera(e, aspect, 0)
  const rel = e.sunKm.clone().divideScalar(MOON_R_KM).sub(cam.pos)
  const dir = rel.clone().normalize(), back = dir.dot(cam.back)
  if (back >= 0) return 180
  const x = Math.atan(Math.abs(dir.dot(cam.right) / -back))
  const y = Math.atan(Math.abs(dir.dot(cam.up) / -back))
  const xMargin = x - Math.atan(cam.tanHalf * aspect)
  const yMargin = y - Math.atan(cam.tanHalf)
  const outside = xMargin > 0 && yMargin > 0 ? Math.min(xMargin, yMargin) : Math.max(xMargin, yMargin)
  const radius = Math.asin(SUN_R_KM / (rel.length() * MOON_R_KM))
  return (outside - radius) * 180 / Math.PI
}

function sunElevationDeg(lon: number, lat: number, e: ReturnType<typeof ephemerisAt>): number {
  const dLon = (lon - e.subSolar.lon) * Math.PI / 180
  const p = lat * Math.PI / 180, s = e.subSolar.lat * Math.PI / 180
  return Math.asin(Math.sin(p) * Math.sin(s) + Math.cos(p) * Math.cos(s) * Math.cos(dLon)) * 180 / Math.PI
}

// Owner 2026-10-22 (final): no flight or moment lasts over 30 s. Every moment that names a cinematic flight resolves to one, and the orbit is held to the same bound.
{
  const named = MOMENTS.filter((m) => m.cinematicFlight)
  assert.ok(named.length >= 16, `the tour names its flights (${named.length})`)
  for (const m of named) {
    const f = getCinematicFlight(m.cinematicFlight)
    assert.ok(f, `${m.id} names a real flight`)
    assert.ok(f.seconds > 0 && f.seconds <= MAX_FLIGHT_SECONDS, `${m.id} (${f.id}) lasts at most ${MAX_FLIGHT_SECONDS} s (${f.seconds})`)
  }
  assert.ok(ORBIT_SECONDS <= MAX_FLIGHT_SECONDS, 'the fly-around orbit lasts at most 30 s')
}

// Fly around the Moon (owner 2026-10-22, option a): the start pose is on the lit hemisphere, under 90 deg from the subsolar point, on every date of a lunar month
// (it used to start 138 deg out on a crescent and a starfield), and the straight run from the Home view to it stays on the lit side when Home is lit too.
{
  const fly = MOMENTS.find((m) => m.id === 'fly-around')!
  assert.equal(fly.camera.at, 'sunArc')
  for (let d = 0; d < 30; d++) {
    const ep = ephemerisAt(new Date(Date.UTC(2026, 9, 1 + d, 7, 0)))
    const start = momentPose(fly.camera as Parameters<typeof momentPose>[0], ep)
    const toSun = angularDistance(start.lon, start.lat, ep.subSolar.lon, ep.subSolar.lat) * 180 / Math.PI
    assert.ok(toSun < 90, `fly-around starts under 90 deg from the subsolar point (${toSun.toFixed(1)} deg, day ${d})`)
    const home = momentPose({ at: 'subEarth', dist: 3.6 }, ep)
    if (angularDistance(home.lon, home.lat, ep.subSolar.lon, ep.subSolar.lat) * 180 / Math.PI < 90) {
      // A hemisphere is convex: the shorter arc between two points of it stays in it. Walk the arc and check the Sun stays above the horizon.
      for (let k = 1; k < 20; k++) {
        const p = wrapLon(home.lon + wrapLon(start.lon - home.lon) * k / 20), la = home.lat + (start.lat - home.lat) * k / 20
        assert.ok(sunElevationDeg(p, la, ep) > -12, `the approach to fly-around does not cross the night side (day ${d}, step ${k})`)
      }
    }
  }
}

const ROUND3_FLIGHTS = ['terminator-run', 'earthrise-low', 'plato-rim', 'tycho-rim', 'rille-run', 'pole-limb-sweep']
const ROUND4_FLIGHTS = ['bank-turn-a', 'bank-turn-b', 'sunrise-arc-a', 'sunrise-arc-b', 'limb-glide-a', 'limb-glide-b']
for (const id of ['copernicus-flyover', 'taurus-littrow-pass', 'apollo8-earthrise', ...ROUND3_FLIGHTS, ...ROUND4_FLIGHTS]) {
  const flight = getCinematicFlight(id)!
  assert.ok(flight)
  // Owner 2026-10-22 (final, 25-30 s max after 20 s cost smoothness on the rig): every flight lasts at most MAX_FLIGHT_SECONDS end to end, key beats kept by retiming the pace.
  // History: the crater orbits 48 -> 30 s (2026-10-14), Earthrise 45 -> 19 s and the terminator run 48 -> 36 s (2026-10-20), now all <= 30 s.
  assert.ok(flight.seconds <= MAX_FLIGHT_SECONDS, `${id} lasts at most ${MAX_FLIGHT_SECONDS} s (${flight.seconds})`)
  assert.ok(flight.seconds >= 15, `${id} is slow enough to follow`)
  const start = sampleCinematicFlight(flight, 0, e, floorAt, groundAt)
  const middle = sampleCinematicFlight(flight, 0.5, e, floorAt, groundAt)
  const end = sampleCinematicFlight(flight, 1, e, floorAt, groundAt)
  for (const sample of [start, middle, end]) {
    assert.ok(Number.isFinite(sample.pose.lon) && Number.isFinite(sample.pose.lat))
    assert.ok(sample.pose.dist >= floorAt(sample.pose.lon, sample.pose.lat))
    assert.ok(sample.pose.dist >= 1 + groundAt(sample.pose.lon, sample.pose.lat) + 0.000039)
    assert.ok(sample.fovDeg > 0)
    assert.ok(sample.pose.roll >= -180 && sample.pose.roll <= 180)
  }
  assert.equal(start.look, flight.kind === 'earthrise' ? 1 : 0)
}

// Plato's lap climbs and dips (owner, 2026-10-15): one clearly higher section, one close pass, and no floor clamp or sudden vertical-speed change.
{
  const flight = getCinematicFlight('plato-rim')!
  // The worst real floor: TC layer off, finest texel SLDEM -3 (59.225 m), short side capped at 1200 px.
  const floor = 1 + siteAltR(59.225, 1200, 42)
  const N = 4000
  const dists: number[] = []
  for (let i = 0; i <= N; i++) {
    const sample = sampleCinematicFlight(flight, i / N, e, () => floor, () => 0)
    dists.push(sample.pose.dist)
  }
  const lo = Math.min(...dists), hi = Math.max(...dists)
  assert.ok(lo <= 1.056, `plato-rim has a low pass (min ${lo.toFixed(4)})`)
  assert.ok(hi - lo >= 0.03, `plato-rim varies in height (${(hi - lo).toFixed(4)})`)
  assert.ok(hi > dists[0] + 0.01, 'plato-rim rises above its start height')
  // The floor must never clamp the dip: the authored curve (sampled with a floor far below) equals the floored one.
  for (let i = 0; i <= N; i++) {
    const free = sampleCinematicFlight(flight, i / N, e, () => 1.0005, () => 0).pose.dist
    assert.ok(Math.abs(free - dists[i]) < 1e-9, `plato-rim is not clamped by the TC-off floor ${floor.toFixed(4)} at u=${i / N}`)
  }
  // Vertical speed (km/s) and acceleration (km/s^2) stay bounded so the swell cannot be steepened silently.
  const R_KM = 1737.4, dt = flight.seconds / N
  let maxV = 0, maxA = 0
  for (let i = 1; i < N; i++) {
    maxV = Math.max(maxV, Math.abs(dists[i + 1] - dists[i - 1]) * R_KM / (2 * dt))
    maxA = Math.max(maxA, Math.abs(dists[i + 1] - 2 * dists[i] + dists[i - 1]) * R_KM / (dt * dt))
  }
  assert.ok(maxV < 30, `plato-rim vertical speed ${maxV.toFixed(1)} km/s`)
  assert.ok(maxA < 25, `plato-rim vertical acceleration ${maxA.toFixed(1)} km/s^2`)
}

// Where a surface point lies in the flight camera's image, as a fraction of the half-frame (|x| and |y| <= 1 is inside); null when behind the camera.
function surfaceInFrame(lon: number, lat: number, pose: Pose, fovDeg: number, floor: number, aspect: number, ep: ReturnType<typeof ephemerisAt>): { x: number; y: number } | null {
  const rig = new CameraRig(); rig.setFloor(floor); rig.setPose(pose); rig.fovDeg = fovDeg
  const cam = rig.camera(ep, aspect, 0)
  const b = lat * Math.PI / 180, l = lon * Math.PI / 180
  const point = ep.moonX.clone().multiplyScalar(Math.cos(b) * Math.cos(l)).addScaledVector(ep.moonY, Math.cos(b) * Math.sin(l)).addScaledVector(ep.moonZ, Math.sin(b))
  const dir = point.sub(cam.pos).normalize(), back = dir.dot(cam.back)
  if (back >= 0) return null
  return { x: dir.dot(cam.right) / -back / (cam.tanHalf * aspect), y: dir.dot(cam.up) / -back / cam.tanHalf }
}

// Tycho (owner, R1 8:32-8:55 "move closer"): fov 36 at main's distances (the 1.0675 dip was removed after the rig showed more 50 ms gaps), no clamp even with the TC layer off, the crater centred in portrait and landscape.
{
  const flight = getCinematicFlight('tycho-rim')!
  const moment = MOMENTS.find((m) => m.cinematicFlight === 'tycho-rim')!
  const routeEphem = ephemerisAt(moment.time())
  assert.ok(flight.waypoints!.every((p) => p.fovDeg === 36), 'tycho-rim runs at fov 36')
  assert.equal(moment.fovDeg, 36, 'the Tycho moment starts at the flight fov')
  assert.equal(flight.seconds, 30)
  const floor = 1 + siteAltR(59.225, 1200, 36)
  const N = 4000
  const dists: number[] = []
  for (let i = 0; i <= N; i++) {
    const free = sampleCinematicFlight(flight, i / N, routeEphem, () => 1.0005, () => 0).pose.dist
    const floored = sampleCinematicFlight(flight, i / N, routeEphem, () => floor, () => 0).pose.dist
    assert.ok(Math.abs(free - floored) < 1e-9, `tycho-rim is not clamped by the TC-off floor ${floor.toFixed(4)} at u=${i / N}`)
    dists.push(free)
  }
  const lo = Math.min(...dists), hi = Math.max(...dists)
  assert.ok(lo >= floor && Math.abs(lo - 1.075) < 1e-4, `tycho-rim keeps main's low point 1.075, above the floor (min ${lo.toFixed(4)}, floor ${floor.toFixed(4)})`)
  assert.ok(hi - lo >= 0.02, 'tycho-rim keeps its gentle up and down')
  // Gentle: vertical speed bounded (main's distances).
  const R_KM = 1737.4, dt = flight.seconds / N
  let maxV = 0
  for (let i = 1; i < N; i++) maxV = Math.max(maxV, Math.abs(dists[i + 1] - dists[i - 1]) * R_KM / (2 * dt))
  assert.ok(maxV < 10, `tycho-rim vertical speed ${maxV.toFixed(1)} km/s`)
  for (const aspect of [390 / 844, 16 / 9]) for (let i = 0; i <= 100; i++) {
    const u = i / 100
    const sample = sampleCinematicFlight(flight, u, routeEphem, () => floor, () => 0)
    const p = surfaceInFrame(flight.focus!.lon, flight.focus!.lat, sample.pose, sample.fovDeg, floor, aspect, routeEphem)
    assert.ok(p && Math.abs(p.x) < 0.5 && Math.abs(p.y) < 0.8, `tycho-rim keeps the crater centre in the ${aspect < 1 ? 'portrait' : 'landscape'} frame at u=${u}`)
  }
}

// Approach into a flight moment: the lens eases from the one the visitor has to the flight's (main.ts restores the previous fov before flyTo; no cut on frame 1).
{
  const flight = getCinematicFlight('tycho-rim')!
  const target = sampleCinematicFlight(flight, 0, e, () => 1.0005, () => 0)
  const from: Pose = { lon: wrapLon(target.pose.lon - 20), lat: target.pose.lat + 10, dist: 1.5, roll: 0, pitch: 0 }
  const plan = planFly(e, { pose: from, fovDeg: 42, aimShift: 0, aimShiftX: 0, look: 0 }, { pose: target.pose, fovDeg: target.fovDeg, aimShift: 0, aimShiftX: 0, look: 0 }, { aspect: 16 / 9 })
  assert.ok(Math.abs(plan.at(0).fovDeg - 42) < 1e-6, 'the approach starts at the previous lens (42), not the flight lens')
  assert.ok(Math.abs(plan.at(1).fovDeg - 36) < 1e-6, 'the approach ends at the flight lens (36)')
}

// Long shadows (owner, R2 1:18-1:47 "nothing happens"; 2026-10-20 "fly along the terminator way longer, straight on it, lower, faster"): a long, low,
// quick run along the morning terminator, no fixed focus, one continuous flight, Sun behind the camera.
{
  const flight = getCinematicFlight('terminator-run')!
  const moment = MOMENTS.find((m) => m.cinematicFlight === 'terminator-run')!
  const routeEphem = ephemerisAt(moment.time())
  assert.equal(flight.focus, undefined, 'the heading follows travel along the terminator')
  assert.equal(flight.seconds, 30, 'terminator-run is 30 s (owner 2026-10-22; was 36)')
  const pts = flight.waypoints!
  assert.ok(pts[pts.length - 1].lat - pts[0].lat >= 48, 'the track is about 50 deg of latitude')
  assert.ok(pts.every((p) => p.dist <= 1.03 + 1e-9), 'authored low: 1.03 radii (the floor lifts it where the imagery needs it)')
  const start = sampleCinematicFlight(flight, 0, routeEphem, () => 1.0005, () => 0).pose
  assert.ok(Math.abs(start.lon - (moment.camera as { lon: number }).lon) < 1e-6 && Math.abs(start.lat - (moment.camera as { lat: number }).lat) < 1e-6, 'the moment starts at the first waypoint')
  // The camera stays east of the line, in daylight with the Sun low enough for long shadows (under 6 deg) over the whole route.
  for (let i = 0; i <= 100; i++) {
    const sample = sampleCinematicFlight(flight, i / 100, routeEphem, () => 1.0005, () => 0)
    const sunEl = sunElevationDeg(sample.pose.lon, sample.pose.lat, routeEphem)
    assert.ok(sunEl >= 2.5 && sunEl <= 6, `terminator-run stays in low morning Sun (${sunEl.toFixed(1)} deg) at u=${i / 100}`)
  }
  // Floors up to 1.12 (the TC layer off lifts this ground to about 1.05); a camera 1.2 radii up sees the line below a frame turned 35 deg off the track.
for (const floor of [1.0005, 1.06, 1.12]) for (const aspect of [390 / 844, 16 / 9]) for (let i = 0; i <= 100; i++) {
    const u = i / 100
    const sample = sampleCinematicFlight(flight, u, routeEphem, () => floor, () => 0)
    // The terminator stays in frame: some point of the sunrise line within 8 deg of latitude of the camera is on screen.
    let seen = false
    for (let d = -8; d <= 8 && !seen; d++) {
      const lat = sample.pose.lat + d
      const p = surfaceInFrame(sunriseLongitude(routeEphem, lat), lat, sample.pose, sample.fovDeg, floor, aspect, routeEphem)
      seen = !!p && Math.abs(p.x) < 0.5 && Math.abs(p.y) <= 0.5
    }
    assert.ok(seen, `terminator-run keeps the terminator in the ${aspect < 1 ? 'portrait' : 'landscape'} frame at u=${u}, floor=${floor}`)
    assert.equal(sunDiskInFrame(sample.pose, sample.fovDeg, floor, aspect, routeEphem), false, `terminator-run keeps the Sun out of frame at u=${u}`)
  }
}

for (const id of ['taurus-littrow-pass']) {
  const flight = getCinematicFlight(id)!
  const a = sampleCinematicFlight(flight, 0, e, floorAt, groundAt)
  const nearA = sampleCinematicFlight(flight, 0.001, e, floorAt, groundAt)
  const b = sampleCinematicFlight(flight, 0.999, e, floorAt, groundAt)
  const nearB = sampleCinematicFlight(flight, 1, e, floorAt, groundAt)
  assert.ok(Math.abs(nearA.pose.lon - a.pose.lon) < 0.01)
  assert.ok(Math.abs(nearB.pose.lon - b.pose.lon) < 0.01)
  assert.ok(a.pose.pitch >= 65 && a.pose.pitch! <= 72)
  const lowFloor = () => 1.0005
  assert.ok(sampleCinematicFlight(flight, 0.5, e, lowFloor, () => 0).pose.dist < 1.02, `${id} authors a genuinely low path`)
  for (const floor of [1.2, 1.4]) {
    const sample = sampleCinematicFlight(flight, 0.5, e, () => floor, () => 0)
    assert.ok(hitCount(sample.pose, sample.fovDeg, floor, 390 / 844) >= 4, `${id} shows terrain at raised floor ${floor}`)
  }
  // Check the real fly-to approach into the first route frame, including each
  // planner knot where the camera has come close enough for its pitch to matter.
  const floor = 1.4, aspect = 390 / 844
  const target = sampleCinematicFlight(flight, 0, e, () => floor, () => 0)
  const from: Pose = { lon: wrapLon(target.pose.lon - 8), lat: target.pose.lat + 5, dist: 6, roll: 0, pitch: 0 }
  const plan = planFly(e, { pose: from, fovDeg: 30, aimShift: 0, aimShiftX: 0, look: 0 }, { pose: target.pose, fovDeg: target.fovDeg, aimShift: 0, aimShiftX: 0, look: 0 }, { aspect })
  for (let i = 0; i <= 24; i++) {
    const state = plan.at(i / 24)
    if (state.pose.dist < 2.2) assert.ok(hitCount(state.pose, state.fovDeg, floor, aspect) > 0, `${id} approach intersects terrain at knot ${i}`)
  }
  const inverseEase = (v: number): number => {
    let lo = 0, hi = 1
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (mid * mid * mid * (mid * (mid * 6 - 15) + 10) < v) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }
  const count = flight.waypoints!.length - 1
  for (let boundary = 1; boundary < count; boundary++) {
    const at = inverseEase(boundary / count)
    const left = sampleCinematicFlight(flight, at - 1e-7, e, lowFloor, () => 0)
    const right = sampleCinematicFlight(flight, at + 1e-7, e, lowFloor, () => 0)
    assert.ok(Math.abs(wrapLon(left.pose.roll - right.pose.roll)) < 0.1, `${id} heading is continuous at waypoint ${boundary}`)
    assert.ok(Math.abs(left.pose.pitch! - right.pose.pitch!) < 0.001, `${id} pitch is continuous at waypoint ${boundary}`)
    assert.ok(Math.abs(left.pose.dist - right.pose.dist) < 1e-5, `${id} distance is continuous at waypoint ${boundary}`)
  }
}

// A Sun in the close camera's frame becomes its exposure target and hides the
// lunar ground. Keep the complete disc outside both portrait and landscape views.
for (const id of ['copernicus-flyover', 'taurus-littrow-pass', ...ROUND3_FLIGHTS, ...ROUND4_FLIGHTS]) {
  const moment = MOMENTS.find((m) => m.cinematicFlight === id)!
  const flight = getCinematicFlight(id)!
  const nominalFloor = flight.waypoints?.length ? Math.min(...flight.waypoints.map((p) => p.dist)) : 1.065
  const routeEphem = ephemerisAt(moment.time())
  for (const floor of [nominalFloor, 1.2, 1.4]) for (const aspect of [390 / 844, 16 / 9]) for (let i = 0; i <= 200; i++) {
    const sample = sampleCinematicFlight(flight, i / 200, routeEphem, () => floor, () => 0)
    assert.ok(sample.pose.dist >= floor, `${id} respects floor=${floor} at u=${i / 200}`)
    assert.equal(sunDiskInFrame(sample.pose, sample.fovDeg, floor, aspect, routeEphem), false,
      `${id} keeps the Sun outside the full ${aspect < 1 ? 'portrait' : 'landscape'} frame at u=${i / 200}, floor=${floor}`)
  }
}

for (const id of [...ROUND3_FLIGHTS, ...ROUND4_FLIGHTS]) {
  const moment = MOMENTS.find((m) => m.cinematicFlight === id)!
  const flight = getCinematicFlight(id)!
  const routeEphem = ephemerisAt(moment.time())
  const lowFloor = () => 1.0005
  const first = sampleCinematicFlight(flight, 0, routeEphem, lowFloor, () => 0)
  const last = sampleCinematicFlight(flight, 1, routeEphem, lowFloor, () => 0)
  assert.ok(first.pose.dist >= lowFloor(first.pose.lon, first.pose.lat))
  assert.ok(last.pose.dist >= lowFloor(last.pose.lon, last.pose.lat))
  const startCamera = moment.camera as { lon: number; lat: number; dist: number }
  assert.ok(angularDistance(first.pose.lon, first.pose.lat, startCamera.lon, startCamera.lat) < 0.001, `${id} starts at its moment pose`)
  const nearStart = sampleCinematicFlight(flight, 1e-4, routeEphem, lowFloor, () => 0)
  const nearEnd = sampleCinematicFlight(flight, 1 - 1e-4, routeEphem, lowFloor, () => 0)
  assert.ok(angularDistance(first.pose.lon, first.pose.lat, nearStart.pose.lon, nearStart.pose.lat) < 0.002, `${id} eases in position`)
  assert.ok(angularDistance(last.pose.lon, last.pose.lat, nearEnd.pose.lon, nearEnd.pose.lat) < 0.002, `${id} eases out position`)
  assert.ok(Math.abs(nearStart.pose.dist - first.pose.dist) < 0.002, `${id} eases in`)
  assert.ok(Math.abs(nearEnd.pose.dist - last.pose.dist) < 0.002, `${id} eases out`)
}

// Bank is an authored roll channel, continuous at every route knot. The dawn
// alternatives keep the complete Sun disc outside the image through arrival;
// this lets the coordinator compare horizon framing without exposure blowout.
for (const id of ROUND4_FLIGHTS.filter((name) => name.startsWith('bank-turn') || name.startsWith('limb-glide'))) {
  const flight = getCinematicFlight(id)!
  for (let i = 0; i <= 500; i++) {
    const a = sampleCinematicFlight(flight, i / 500, e, floorAt, groundAt)
    const b = sampleCinematicFlight(flight, Math.min(1, i / 500 + 1e-7), e, floorAt, groundAt)
    assert.ok(Math.abs(wrapLon(a.pose.roll - b.pose.roll)) < 0.1, `${id} bank changes smoothly`)
  }
}

for (const id of ['sunrise-arc-a', 'sunrise-arc-b']) {
  const moment = MOMENTS.find((m) => m.cinematicFlight === id)!
  const flight = getCinematicFlight(id)!
  const routeEphem = ephemerisAt(moment.time())
  // Re-dated 2026-10-11 (viewDates.ts flightMorning): the whole route is in daylight just EAST of the morning terminator, the Sun 3 deg up over
  // its darkest waypoint, instead of starting in the night. The middle waypoint is a few degrees of longitude past the terminator.
  const toTerminator = wrapLon(flight.waypoints![2].lon - sunriseLongitude(routeEphem, flight.waypoints![2].lat))
  assert.ok(toTerminator >= 0 && toTerminator <= 15, `${id} runs just east of the ephemeris-derived sunrise longitude (${toTerminator.toFixed(1)} deg)`)
  const start = flight.waypoints![0]
  assert.ok(Math.abs(sunElevationDeg(start.lon, start.lat, routeEphem) - 3) < 0.2, `${id} starts where the Sun is 3 deg up`)
  const end = flight.waypoints!.at(-1)!
  assert.ok(sunElevationDeg(end.lon, end.lat, routeEphem) >= 3 && sunElevationDeg(end.lon, end.lat, routeEphem) <= 17,
    `${id} ends in low morning light`)
  for (let i = 0; i <= 200; i++) {
    const u = i / 200
    const sample = sampleCinematicFlight(flight, u, routeEphem, floorAt, groundAt)
    assert.equal(sunDiskInFrame(sample.pose, sample.fovDeg, sample.pose.dist, 390 / 844, routeEphem), false,
      `${id} keeps the Sun disc outside the portrait frame at u=${u}`)
    if (u < 0.85) assert.ok(sunFrameMarginDeg(sample.pose, sample.fovDeg, sample.pose.dist, 390 / 844, routeEphem) >= 6,
      `${id} keeps the Sun at least six degrees outside the portrait frame before the final 15%`)
  }
}

for (const id of ['limb-glide-a', 'limb-glide-b']) {
  const moment = MOMENTS.find((m) => m.cinematicFlight === id)!
  const routeEphem = ephemerisAt(moment.time())
  const sample = sampleCinematicFlight(getCinematicFlight(id)!, 1, routeEphem, floorAt, groundAt)
  const rig = new CameraRig(); rig.setPose(sample.pose); rig.fovDeg = sample.fovDeg
  rig.setLookBlend(sample.look, (cam) => routeEphem.earthKm.clone().divideScalar(MOON_R_KM).sub(cam.pos))
  const cam = rig.camera(routeEphem, 16 / 9, 0)
  const toEarth = routeEphem.earthKm.clone().divideScalar(MOON_R_KM).sub(cam.pos)
  const direction = toEarth.clone().normalize(), back = direction.dot(cam.back)
  assert.ok(back < 0, `${id} faces Earth at the limb`)
  assert.ok(Math.abs(direction.dot(cam.right) / -back) < cam.tanHalf * 16 / 9 && Math.abs(direction.dot(cam.up) / -back) < cam.tanHalf,
    `${id} keeps Earth in the landscape frame`)
}

{
  const moment = MOMENTS.find((m) => m.id === 'terminator-run')!
  const routeEphem = ephemerisAt(moment.time())
  const middle = sampleCinematicFlight(getCinematicFlight('terminator-run')!, 0.5, routeEphem, () => 1.0005, () => 0)
  const fromSun = angularDistance(routeEphem.subSolar.lon, routeEphem.subSolar.lat, middle.pose.lon, middle.pose.lat) * 180 / Math.PI
  // Re-dated to the morning after the terminator passes the route (viewDates.ts): the route runs along the terminator on the lit side (Sun about 3 deg up, 1 to 10° past it).
  assert.ok(fromSun < 89 && fromSun > 80, `terminator route runs in daylight just past the moment's calculated terminator (${fromSun.toFixed(1)}° from subsolar)`)
}

{
  const flight = getCinematicFlight('earthrise-low')!
  const moment = MOMENTS.find((m) => m.cinematicFlight === 'earthrise-low')!
  const routeEphem = ephemerisAt(moment.time())
  const sample = sampleCinematicFlight(flight, 1, routeEphem, () => 1.0005, () => 0)
  assert.equal(sample.look, flight.earthriseLook, 'Earthrise ends looking most of the way toward Earth, the horizon kept below it (#302)')
  const rig = new CameraRig(); rig.setFloor(1.0005); rig.setPose(sample.pose); rig.fovDeg = sample.fovDeg
  rig.setLookBlend(sample.look, (cam) => routeEphem.earthKm.clone().divideScalar(MOON_R_KM).sub(cam.pos))
  const cam = rig.camera(routeEphem, 390 / 844, 0)
  const toEarth = routeEphem.earthKm.clone().divideScalar(MOON_R_KM).sub(cam.pos)
  const direction = toEarth.clone().normalize(), back = direction.dot(cam.back)
  assert.ok(back < 0, 'Earth lies in front of the final camera')
  assert.ok(Math.abs(direction.dot(cam.right) / -back) < cam.tanHalf * 390 / 844)
  assert.ok(Math.abs(direction.dot(cam.up) / -back) < cam.tanHalf, 'Earth stays in the portrait frame')
}

// #302: with tiles loaded the floor is low and the authored tilt is applied in full (the bare rig above clamps to the default floor, where the
// tilt has no effect). Every flight that turns toward the Earth must end with the Earth in a landscape frame and some Moon in it too.
for (const id of ['earthrise-low', 'limb-glide-a', 'limb-glide-b']) {
  const moment = MOMENTS.find((m) => m.cinematicFlight === id)!
  const routeEphem = ephemerisAt(moment.time())
  const sample = sampleCinematicFlight(getCinematicFlight(id)!, 1, routeEphem, () => 1.0005, () => 0)
  const rig = new CameraRig(); rig.setFloor(1.0005); rig.setPose(sample.pose); rig.fovDeg = sample.fovDeg
  rig.setLookBlend(sample.look, (cam) => routeEphem.earthKm.clone().divideScalar(MOON_R_KM).sub(cam.pos))
  const aspect = 16 / 9, cam = rig.camera(routeEphem, aspect, 0)
  const direction = routeEphem.earthKm.clone().divideScalar(MOON_R_KM).sub(cam.pos).normalize(), ahead = -direction.dot(cam.back)
  assert.ok(ahead > 0 && Math.abs(direction.dot(cam.right) / ahead) < cam.tanHalf * aspect && Math.abs(direction.dot(cam.up) / ahead) < cam.tanHalf,
    `${id} ends with the Earth in the landscape frame at the real (low) floor`)
  let moonRows = 0
  for (let k = -10; k <= 10; k++) {
    const ray = cam.back.clone().negate().addScaledVector(cam.up, k / 10 * cam.tanHalf).normalize()
    const b = cam.pos.dot(ray), disc = b * b - (cam.pos.lengthSq() - 1)
    if (disc > 0 && -b - Math.sqrt(disc) > 0) moonRows++
  }
  assert.ok(moonRows >= 2 || id !== 'earthrise-low', `${id} keeps the horizon in the final frame (${moonRows}/21 rows of the centre line)`)
}

const earthriseMoment = MOMENTS.find((m) => m.id === 'earthrise')!
assert.equal(earthriseMoment.time().toISOString(), date.toISOString())
assert.equal(earthriseMoment.cinematicFlight, 'apollo8-earthrise')
assert.ok(e.earthPhaseDeg > 10 && e.earthPhaseDeg < 170, 'Apollo 8 date shows a partly illuminated Earth')
const initial = momentPose(earthriseMoment.camera as Extract<typeof earthriseMoment.camera, { at: 'earthrise' }>, e)
const orbitDistance = e.earthKm.length() / 1737.4
const toEarth = e.earthKm.clone().divideScalar(1737.4).addScaledVector(
  e.moonX.clone().multiplyScalar(Math.cos(initial.lat * Math.PI / 180) * Math.cos(initial.lon * Math.PI / 180))
    .addScaledVector(e.moonY, Math.cos(initial.lat * Math.PI / 180) * Math.sin(initial.lon * Math.PI / 180))
    .addScaledVector(e.moonZ, Math.sin(initial.lat * Math.PI / 180)),
  -initial.dist,
)
const radial = e.moonX.clone().multiplyScalar(Math.cos(initial.lat * Math.PI / 180) * Math.cos(initial.lon * Math.PI / 180))
  .addScaledVector(e.moonY, Math.cos(initial.lat * Math.PI / 180) * Math.sin(initial.lon * Math.PI / 180))
  .addScaledVector(e.moonZ, Math.sin(initial.lat * Math.PI / 180))
const apparentCenter = Math.acos(Math.max(-1, Math.min(1, radial.clone().negate().dot(toEarth.clone().normalize()))))
const limb = Math.asin(1 / initial.dist)
const earthRadius = Math.asin(EARTH_R_KM / e.earthKm.length())
assert.ok(Math.abs(apparentCenter - (limb - 1.2 * earthRadius)) < earthRadius * 0.03, 'Earthrise starts with the Earth centre 1.2 Earth radii below the limb')
assert.ok(apparentCenter + earthRadius < limb, 'Earthrise starts with the whole Earth below the horizon (owner 2026-10-20)')
assert.ok(orbitDistance > 200 && orbitDistance < 240)
const raised = sampleCinematicFlight(getCinematicFlight('apollo8-earthrise')!, 0, e, () => 1.12, () => 0)
const raisedBasis = poseBasis(e, raised.pose)
const raisedToEarth = e.earthKm.clone().divideScalar(1737.4).sub(raisedBasis.back.clone().multiplyScalar(raised.pose.dist))
const raisedCenter = Math.acos(Math.max(-1, Math.min(1, raisedBasis.back.clone().negate().dot(raisedToEarth.normalize()))))
assert.ok(Math.abs(raisedCenter - (Math.asin(1 / raised.pose.dist) - 1.2 * earthRadius)) < earthRadius * 0.03, 'raising the floor re-solves Earthrise against the new apparent limb')
console.log('cinematic-flights.test ok')

// The Copernicus flyover faces the crater, descends, and starts where its moment starts.
{
  const flight = getCinematicFlight('copernicus-flyover')!
  const focus = flight.focus!
  const moment = MOMENTS.find((m) => m.id === 'surface')!
  assert.equal(moment.cinematicFlight, 'copernicus-flyover')
  const start = sampleCinematicFlight(flight, 0, e, () => 1.0005, () => 0)
  const cam = moment.camera as { lon: number; lat: number; dist: number; pitch?: number }
  assert.ok(Math.abs(start.pose.lon - cam.lon) < 0.05 && Math.abs(start.pose.lat - cam.lat) < 0.05 && Math.abs(start.pose.dist - cam.dist) < 0.01, 'moment camera is the flight start')
  assert.ok(Math.abs(start.pose.pitch! - (cam.pitch ?? 0)) < 2, 'moment pitch matches the flight start')
  let lastDist = Infinity
  for (let i = 0; i <= 40; i++) {
    const s = sampleCinematicFlight(flight, i / 40, e, () => 1.0005, () => 0)
    assert.ok([s.pose.lon, s.pose.lat, s.pose.dist, s.pose.roll, s.pose.pitch!].every(Number.isFinite))
    assert.ok(s.pose.dist <= lastDist + 1e-9, 'the flight only descends')
    lastDist = s.pose.dist
    // Roll is minus the bearing from the camera to the crater.
    const b = Math.atan2(Math.sin((focus.lon - s.pose.lon) * Math.PI / 180) * Math.cos(focus.lat * Math.PI / 180), Math.cos(s.pose.lat * Math.PI / 180) * Math.sin(focus.lat * Math.PI / 180) - Math.sin(s.pose.lat * Math.PI / 180) * Math.cos(focus.lat * Math.PI / 180) * Math.cos((focus.lon - s.pose.lon) * Math.PI / 180)) * 180 / Math.PI
    assert.ok(Math.abs(wrapLon(s.pose.roll + b)) < 0.01, `faces the crater at u=${i / 40}`)
  }
  assert.ok(lastDist < 1.05, 'ends low over the crater')
}

// --- The solar eclipse flight (2 Aug 2027): one continuous camera that shows the Sun at the limb, the Moon, then the Earth with the Moon's shadow.
{
  const moment = MOMENTS.find((m) => m.id === 'solar-eclipse')!
  const flight = getCinematicFlight('solar-eclipse')!
  assert.equal(moment.cinematicFlight, 'solar-eclipse')
  assert.equal(flight.kind, 'eclipse')
  assert.equal(moment.label, 'Solar eclipse, 2 August 2027', 'the label names the date')
  assert.equal(moment.time().toISOString().slice(0, 10), '2027-08-02')
  assert.ok(moment.needsTiles && flight.needsTiles, 'it flies low over the lit far side, so it needs the tiles')
  assert.equal(flight.seconds, 25, '25 s (owner 2026-10-20: 40 was too long; kept at 25 by the 2026-10-22 cap)')
  const ee = ephemerisAt(moment.time())
  const DEGS = 180 / Math.PI
  // The geometry the flight is built on: the Sun and the Earth are on opposite sides of the Moon (within a few degrees at the greatest eclipse).
  assert.ok(ee.sunDir.angleTo(ee.earthDir) * DEGS > 175, 'Sun and Earth are opposite each other as seen from the Moon')
  const uAtT = (target: number): number => {
    let lo = 0, hi = 1
    for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (eclipseEase(mid) < target) lo = mid; else hi = mid }
    return (lo + hi) / 2
  }
  const frame = (u: number, aspect: number, floor = 1.0001) => {
    const shot = sampleCinematicFlight(flight, u, ee, () => floor, () => 0)
    const rig = new CameraRig(); rig.setFloor(floor); rig.setPose(shot.pose); rig.fovDeg = shot.fovDeg
    rig.setLookBlend(shot.look, flightAim(shot, ee))
    const cam = rig.camera(ee, aspect, 0)
    const fwd = cam.back.clone().negate()
    const sunRel = ee.sunKm.clone().divideScalar(MOON_R_KM).sub(cam.pos)
    const earthRel = ee.earthKm.clone().divideScalar(MOON_R_KM).sub(cam.pos)
    const moonRel = cam.pos.clone().negate()
    return { shot, cam, fwd, sunRel, earthRel, moonRel, deg: (v: typeof sunRel) => fwd.angleTo(v) * DEGS }
  }
  const start = sampleCinematicFlight(flight, 0, ee, floorAt, groundAt)
  assert.equal(start.look, 0, 'it starts on the Moon, so a fly-to joins it like any other flight')

  // Floors and ranges.
  for (const fl of [floorAt, () => 1.4]) for (let i = 0; i <= 400; i++) {
    const sample = sampleCinematicFlight(flight, i / 400, ee, fl, groundAt)
    assert.ok(Number.isFinite(sample.pose.lon) && Number.isFinite(sample.pose.lat) && sample.fovDeg > 0)
    assert.ok(sample.pose.dist >= fl(sample.pose.lon, sample.pose.lat), `eclipse flight respects its floor at u=${i / 400}`)
    assert.ok(sample.pose.dist >= 1 + groundAt(sample.pose.lon, sample.pose.lat) + 0.000039)
    assert.ok(sample.pose.dist <= 12 + 1e-9, 'within the pose distance range')
    assert.ok(sample.pose.roll >= -180 && sample.pose.roll <= 180)
    assert.ok(sample.look >= 0 && sample.look <= 1 && (sample.lookSun ?? 0) >= 0 && (sample.lookSun ?? 0) <= 1)
  }

  // Continuity: the view axis, the position, the roll and the lens move a little each 20 ms step, with no cut anywhere.
  for (const aspect of [16 / 9, 390 / 844]) {
    const N = 2000
    let prev = frame(0, aspect)
    let maxTurn = 0
    for (let i = 1; i <= N; i++) {
      const cur = frame(i / N, aspect)
      const turn = prev.fwd.angleTo(cur.fwd) * DEGS
      maxTurn = Math.max(maxTurn, turn)
      assert.ok(turn < 1, `the view turns smoothly at u=${i / N} (${turn.toFixed(3)} deg per 20 ms)`)
      assert.ok(prev.cam.pos.distanceTo(cur.cam.pos) / cur.cam.pos.length() < 0.02, `the camera moves smoothly at u=${i / N}`)
      assert.ok(prev.cam.up.angleTo(cur.cam.up) * DEGS < 1, `the screen's up turns smoothly at u=${i / N} (${(prev.cam.up.angleTo(cur.cam.up) * DEGS).toFixed(3)} deg per 20 ms)`)
      assert.ok(Math.abs(wrapLon(prev.shot.pose.roll - cur.shot.pose.roll)) < 1, `the roll is continuous at u=${i / N}`)
      assert.ok(Math.abs(prev.shot.fovDeg - cur.shot.fovDeg) / cur.shot.fovDeg < 0.05, `the lens is continuous at u=${i / N}`)
      prev = cur
    }
    assert.ok(maxTurn > 0.05, 'and it does turn')
  }

  // The Sun: centred, a few degrees above the Moon's limb, with the limb and ground in the frame below it.
  {
    const f = frame(uAtT(0.26), 16 / 9)
    assert.equal(f.shot.look, 1); assert.equal(f.shot.lookSun, 1)
    assert.ok(f.deg(f.sunRel) < 0.3, `the gaze is on the Sun (${f.deg(f.sunRel).toFixed(2)} deg off)`)
    const above = (f.moonRel.angleTo(f.sunRel) - Math.asin(1 / f.cam.pos.length())) * DEGS
    assert.ok(above > 2 && above < 20, `the Sun is a few degrees above the limb (${above.toFixed(1)} deg)`)
    assert.ok(pickSphere(f.cam, 0, -0.75, 16 / 9), 'the Moon fills the lower part of the Sun frame')
    assert.equal(pickSphere(f.cam, 0, 0.75, 16 / 9), null, 'and the sky above the limb is empty')
  }
  // The Moon: the whole disc in the frame, centred, in both orientations.
  for (const aspect of [16 / 9, 390 / 844]) {
    const f = frame(uAtT(0.6), aspect)
    const radius = Math.asin(1 / f.cam.pos.length()) * DEGS
    assert.ok(f.deg(f.moonRel) < 1.5, 'the gaze is on the Moon')
    assert.ok(radius + f.deg(f.moonRel) < f.shot.fovDeg / 2, `the whole Moon is in the frame (radius ${radius.toFixed(1)}, half field ${(f.shot.fovDeg / 2).toFixed(1)})`)
  }
  // The Earth: centred and filling about half the short side, the Sun behind the camera, the Earth full: the Moon's shadow is on a lit disc.
  for (const aspect of [16 / 9, 390 / 844]) {
    const f = frame(1, aspect)
    assert.equal(f.shot.look, 1); assert.equal(f.shot.lookSun, 0)
    assert.ok(f.deg(f.earthRel) < 0.01, 'the last frame is centred on the Earth')
    const radius = Math.asin(EARTH_R_KM / (f.earthRel.length() * MOON_R_KM)) * DEGS
    assert.ok(radius > 0.3 * f.shot.fovDeg / 2 && radius < 0.8 * f.shot.fovDeg / 2, `the Earth fills about two thirds of the short side (radius ${radius.toFixed(2)} of half field ${(f.shot.fovDeg / 2).toFixed(2)})`)
    assert.ok(f.deg(f.sunRel) > 170, 'the Sun is behind the camera')
    const toSun = ee.sunKm.clone().sub(ee.earthKm).normalize()
    const toCam = f.cam.pos.clone().multiplyScalar(MOON_R_KM).sub(ee.earthKm).normalize()
    assert.ok(toSun.dot(toCam) > 0.99, 'the Earth is seen full')
    assert.equal(f.shot.pose.dist, 12)
  }
  // The order of the three beats, and the Sun routing: the Earth never covers the Sun here, so the eclipse (HDR) path is never taken.
  {
    let uSun = -1, uMoon = -1, uEarth = -1
    for (let i = 0; i <= 800; i++) {
      const u = i / 800
      const f = frame(u, 16 / 9)
      if (uSun < 0 && f.shot.look === 1 && f.deg(f.sunRel) < 0.5) uSun = u
      if (uSun >= 0 && uMoon < 0 && f.deg(f.moonRel) < 0.5 && f.shot.look < 0.02) uMoon = u
      if (uMoon >= 0 && uEarth < 0 && f.deg(f.earthRel) < 0.5) uEarth = u
      assert.equal(earthNearSun(f.sunRel, f.earthRel, f.earthRel.length() * MOON_R_KM, f.sunRel.length() * MOON_R_KM), false, `the Earth does not cover the Sun at u=${u}`)
    }
    assert.ok(uSun >= 0 && uMoon > uSun && uEarth > uMoon, `Sun (${uSun}), then Moon (${uMoon}), then Earth (${uEarth})`)
    assert.ok(uSun < 0.5 && uEarth > 0.55 && uEarth <= 0.80, `the Sun is brief and early; the Earth arrives last without a long Moon-only lead-in (${uEarth.toFixed(2)})`)
  }

  // Review fixes. M1: the camera starts over the lunar night just before the morning terminator, so the Sun really rises ahead of it (not the evening side).
  {
    const sub = ee.subSolar
    const lonFromSub = wrapLon(start.pose.lon - sub.lon)
    assert.ok(Math.abs(lonFromSub + 114) < 3, `the camera starts 114 deg west of the subsolar point (${lonFromSub.toFixed(1)})`)
    const pastTerminator = wrapLon(start.pose.lon - sunriseLongitude(ee))
    assert.ok(pastTerminator < -15 && pastTerminator > -35, `it is in the night just before the morning terminator, where the Sun rises next (${pastTerminator.toFixed(1)} deg)`)
    // S3: the moment's own camera is the flight's first sample, so the neighbour prefetch warms the right tiles.
    const first = sampleCinematicFlight(flight, 0, ee, () => 1.0001, () => 0)
    const mp = momentPose(moment.camera as Exclude<typeof moment.camera, { at: 'site' } | { at: 'siteView' } | { at: 'descent' }>, ee)
    assert.ok(angularDistance(mp.lon, mp.lat, first.pose.lon, first.pose.lat) / (Math.PI / 180) < 1e-6 && Math.abs(mp.dist - first.pose.dist) < 1e-9, 'the moment camera equals the flight start')
  }
  const sphereInFrame = (cam: ReturnType<typeof frame>['cam'], aspect: number, rel: ReturnType<typeof frame>['moonRel'], radius: number): boolean => {
    const dist = rel.length(), dir = rel.clone().divideScalar(dist)
    const back = dir.dot(cam.back)
    if (back >= 0) return false
    const theta = Math.asin(Math.min(1, radius / dist))
    const x = Math.atan(Math.abs(dir.dot(cam.right) / -back)), y = Math.atan(Math.abs(dir.dot(cam.up) / -back))
    return x - theta <= Math.atan(cam.tanHalf * aspect) && y - theta <= Math.atan(cam.tanHalf)
  }
  const bodiesInFrame = (f: ReturnType<typeof frame>, aspect: number) => ({
    moon: sphereInFrame(f.cam, aspect, f.moonRel, 1),
    earth: sphereInFrame(f.cam, aspect, f.earthRel, EARTH_R_KM / MOON_R_KM),
    sun: sphereInFrame(f.cam, aspect, f.sunRel, SUN_R_KM / MOON_R_KM),
  })
  // S4/T1: something is always in the frame (the owner's rule: no empty-sky stretch), in both orientations.
  for (const aspect of [16 / 9, 390 / 844]) for (let i = 0; i <= 2000; i++) {
    const b = bodiesInFrame(frame(i / 2000, aspect), aspect)
    assert.ok(b.moon || b.earth || b.sun, `the Moon, the Earth or the Sun is in the frame at u=${i / 2000} (aspect ${aspect.toFixed(2)})`)
  }
  // The end: the Earth centred, the Moon's lit limb at the frame's edge beside it (landscape), clear of the Earth's disc; the Sun behind the camera.
  {
    const f = frame(1, 16 / 9)
    assert.ok(bodiesInFrame(f, 16 / 9).moon, 'the last landscape frame holds the Moon beside the Earth')
    const moonRadius = Math.asin(1 / f.moonRel.length()), earthRadius = Math.asin(EARTH_R_KM / (f.earthRel.length() * MOON_R_KM))
    const gap = (f.moonRel.angleTo(f.earthRel) - moonRadius - earthRadius) * DEGS
    assert.ok(gap > 0.2 && gap < 3, `the Moon's limb clears the Earth's disc (${gap.toFixed(2)} deg)`)
    const dir = f.moonRel.clone().normalize()
    const bx = dir.dot(f.cam.right), by = dir.dot(f.cam.up)
    // The Moon is lifted off the horizontal (the end roll) so its limb is in a portrait frame as well; it still lies on one side of the Earth.
    const lift = Math.atan2(Math.abs(by), Math.abs(bx)) * DEGS
    assert.ok(lift > 40 && lift < 75, `the Moon is up and to the side of the Earth (${bx.toFixed(3)}, ${by.toFixed(3)}, ${lift.toFixed(0)} deg above the horizontal)`)
    assert.ok(f.cam.pos.clone().normalize().dot(ee.sunDir) > 0.98, 'the camera is on the Sun side: the Moon is seen lit')
    assert.ok(f.shot.fovDeg >= 2.6 && f.shot.fovDeg <= 3, `the final lens is ${f.shot.fovDeg} deg`)
  }
  // The opening: the Sun (its centre, with margin) is inside the view frustum by 3 s of the 40 s flight, and the Sun stays in view for a stretch afterwards, in both
  // orientations. One continuous flight: the gaze turns toward it from the first second, with no cut and no stop.
  const ndc = (f: ReturnType<typeof frame>, aspect: number, rel: ReturnType<typeof frame>['moonRel']) => {
    const dir = rel.clone().normalize(), back = -dir.dot(f.cam.back)
    return back > 0 ? { x: dir.dot(f.cam.right) / back / (f.cam.tanHalf * aspect), y: dir.dot(f.cam.up) / back / f.cam.tanHalf } : { x: Infinity, y: Infinity }
  }
  for (const aspect of [16 / 9, 390 / 844, 1080 / 2400]) {
    const f3 = frame(3 / flight.seconds, aspect)
    const p = ndc(f3, aspect, f3.sunRel)
    assert.ok(Math.abs(p.x) < 0.9 && Math.abs(p.y) < 0.9, `the Sun is in the frame at 3 s (aspect ${aspect.toFixed(2)}, ndc ${p.x.toFixed(2)}, ${p.y.toFixed(2)})`)
    assert.ok(bodiesInFrame(f3, aspect).sun, 'and its disc touches the frame at 3 s')
    let inView = 0, first = -1
    for (let i = 0; i <= 400; i++) {
      const fr = frame(i / 400, aspect), q = ndc(fr, aspect, fr.sunRel)
      if (Math.abs(q.x) < 1 && Math.abs(q.y) < 1) { inView++; if (first < 0) first = i / 400 * flight.seconds }
    }
    assert.ok(inView / 400 * flight.seconds >= 4, `the Sun stays in view for at least 4 s (${(inView / 400 * flight.seconds).toFixed(1)} s)`)
    assert.ok(first >= 0 && first <= 3, `the Sun first comes into view at ${first.toFixed(2)} s`)
  }
  // The end: Earth and its shadow are the subject (the whole disc is in the frame and fills about half the short side) and a sliver of the Moon's limb is in the frame
  // as well, on a phone portrait screen and in landscape. Computed geometrically: the limb point toward the Earth, and the share of the frame the Moon covers.
  for (const aspect of [16 / 9, 390 / 844, 1080 / 2400, 9 / 19.5]) {
    const f = frame(1, aspect)
    const moonR = Math.asin(1 / f.moonRel.length()), earthR = Math.asin(EARTH_R_KM / (f.earthRel.length() * MOON_R_KM))
    const toE = f.earthRel.clone().normalize(), toM = f.moonRel.clone().normalize()
    const ang = toM.angleTo(toE)
    // the point of the Moon's limb nearest the Earth: from the Moon's centre, moonR toward the Earth
    const limb = toM.clone().multiplyScalar(Math.cos(moonR)).addScaledVector(toE.clone().sub(toM.clone().multiplyScalar(toE.dot(toM))).normalize(), Math.sin(moonR)).normalize()
    const pl = ndc(f, aspect, limb), pe = ndc(f, aspect, toE)
    assert.ok(Math.abs(pl.x) < 0.97 && Math.abs(pl.y) < 0.97, `the Moon's limb is inside the frame (aspect ${aspect.toFixed(2)}, ndc ${pl.x.toFixed(2)}, ${pl.y.toFixed(2)})`)
    assert.ok(Math.abs(pe.x) < 0.01 && Math.abs(pe.y) < 0.01, 'the Earth stays centred')
    const eEdge = earthR / Math.atan(f.cam.tanHalf * Math.min(1, aspect)) // Earth radius against the short half-field
    assert.ok(eEdge > 0.4 && eEdge < 0.75, `the whole Earth disc is in the frame, about half the short side (${eEdge.toFixed(2)})`)
    assert.ok(ang - moonR - earthR > 0.2 / DEGS, 'the limb clears the Earth disc')
    let moonPx = 0, total = 0
    for (let ix = -49; ix <= 49; ix += 2) for (let iy = -49; iy <= 49; iy += 2) { total++; if (pickSphere(f.cam, ix / 50, iy / 50, aspect)) moonPx++ }
    const share = moonPx / total
    assert.ok(share > 0.01 && share < 0.4, `the Moon is a sliver, not the subject (${(share * 100).toFixed(1)}% of the frame, aspect ${aspect.toFixed(2)})`)
  }
  // S4/T4 and M2: the gaze flag never changes the Sun's exposure on either aspect: wherever the Sun is in the frame it is on, so the flag does not switch while it shows.
  for (const aspect of [16 / 9, 390 / 844]) {
    let sawSun = 0
    for (let i = 0; i <= 2000; i++) {
      const u = i / 2000
      const f = frame(u, aspect)
      const run = (sunLook: boolean) => sunInFrame({ camera: f.cam, aspect, sunPosition: ee.sunKm.clone().divideScalar(MOON_R_KM), earthPosition: ee.earthKm.clone().divideScalar(MOON_R_KM), sunWhite: 1, wasOn: false, moonSubject: false, sunLook })
      assert.equal(run(sunGaze(f.shot)).on, run(true).on, `the sunLook rule agrees with a Sun-aimed gaze at u=${u} (aspect ${aspect.toFixed(2)})`)
      if (run(true).on) sawSun++
      if (u >= ECLIPSE_SUN_BEAT_U) assert.equal(bodiesInFrame(f, aspect).sun, false, `the Sun is out of the frame after the Sun beat (u=${u}), so the exposure's look-ahead can stop`)
    }
    assert.ok(sawSun > 100, `the Sun is on screen for a stretch (${sawSun} samples, aspect ${aspect.toFixed(2)})`)
  }
  for (const t of [0.05, 0.2, 0.3, 0.45]) assert.equal(sunGaze(sampleCinematicFlight(flight, uAtT(t), ee, floorAt, groundAt)), true, `the gaze counts as on the Sun at t=${t}`)
  for (const t of [0, 0.55, 0.9, 1]) assert.equal(sunGaze(sampleCinematicFlight(flight, uAtT(t), ee, floorAt, groundAt)), false, `and not at t=${t}`)
  // M3: a mid-flight resume restarts where the gaze is on the Moon's centre (a fly-to can only look at the Earth), never earlier-than-needed past it.
  for (let i = 0; i <= 100; i++) {
    const u = i / 100
    const r = eclipseResumeU(u)
    assert.ok(r <= u + 1e-9, `a resume only rewinds (u=${u} -> ${r})`)
    assert.equal(sampleCinematicFlight(flight, r, ee, floorAt, groundAt).look, 0, `the resume of u=${u} (${r.toFixed(3)}) looks at the Moon's centre`)
    if (sampleCinematicFlight(flight, u, ee, floorAt, groundAt).look === 0) assert.equal(r, u, 'a resume already on the Moon is kept')
  }
}
console.log('cinematic-flights eclipse ok')

// headingOffsetDeg turns a focus-less track off its direction of travel (roll = -heading, wrapped); absent means no turn; a focus ignores it.
{
  const ee = ephemerisAt(MOMENTS.find((m) => m.cinematicFlight === 'terminator-run')!.time())
  const rollOf = (f: NonNullable<ReturnType<typeof getCinematicFlight>>, u: number): number => sampleCinematicFlight(f, u, ee, () => 1.0005, () => 0).pose.roll
  const wrapDiff = (a: number, b: number): number => ((a - b + 540) % 360) - 180
  const dflt = (id: string) => getCinematicFlight(id)!
  // Other flights (no offset authored): behaviour is the plain direction of travel, and an explicit 0 is the same as absent. (earthrise-low is not
  // here: its up turns toward the Earth with its look, #302, which the horizon check above covers.)
  for (const id of ['rille-run', 'sunrise-arc-a', 'pole-limb-sweep']) {
    const f = dflt(id)
    assert.equal(f.headingOffsetDeg, undefined, `${id} authors no heading offset`)
    assert.equal(f.focus, undefined)
    for (const u of [0, 0.3, 0.7, 1]) assert.equal(rollOf({ ...f, headingOffsetDeg: 0 }, u), rollOf(f, u), `${id}: an explicit 0 equals absent at u=${u}`)
    for (const off of [-35, 20, 90]) for (const u of [0.1, 0.5, 0.9]) {
      const d = wrapDiff(rollOf({ ...f, headingOffsetDeg: off }, u), rollOf(f, u))
      assert.ok(Math.abs(d + off) < 1e-6, `${id}: offset ${off} turns the heading by ${off} deg (roll moves ${d.toFixed(4)}) at u=${u}`)
    }
  }
  // terminator-run keeps its authored -35 turn relative to the plain travel direction.
  const tr = dflt('terminator-run')
  assert.equal(tr.headingOffsetDeg, -35)
  for (const u of [0.1, 0.5, 0.9]) assert.ok(Math.abs(wrapDiff(rollOf(tr, u), rollOf({ ...tr, headingOffsetDeg: undefined }, u)) - 35) < 1e-6, 'terminator-run is turned 35 deg toward the line')
  // With a focus the heading faces the focus and the offset is ignored.
  const fo = dflt('plato-rim')
  assert.ok(fo.focus)
  for (const u of [0.2, 0.8]) assert.equal(rollOf({ ...fo, headingOffsetDeg: 50 }, u), rollOf(fo, u), 'a focus ignores headingOffsetDeg')
}
console.log('cinematic-flights headingOffsetDeg ok')
