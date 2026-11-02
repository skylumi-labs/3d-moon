/**
 * Zoom is a dolly along the centre ray: the ground point under the middle of the screen stays there (owner, 14 Oct 2026: "+ = move
 * closer to the center of the screen"). Nadir views zoom exactly as before; the floor stops the camera, never passes it.
 */
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { CameraRig } from '../src/camera/rig.ts'
import { angularDistance, lonLatOfDir, pickSphere, zoomDist } from '../src/camera/pose.ts'
import { clampAlong, coneFloor, dollyPosition } from '../src/camera/dolly.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { deeperFloorAt, pointFloorAt } from '../src/coverage/coverage.ts'
import { SITE_CONE, floorDist } from '../src/camera/pose.ts'

const e = ephemerisAt(new Date('2026-10-20T22:34:00Z'))
const ASPECT = 16 / 9
const T0 = 1000
const centre = (rig: CameraRig, aspect = ASPECT): { lon: number; lat: number } | null => {
  const hit = pickSphere(rig.camera(e, aspect, T0), 0, 0, aspect)
  return hit ? lonLatOfDir(e, hit) : null
}
const arcRad = (a: { lon: number; lat: number }, b: { lon: number; lat: number }): number => angularDistance(a.lon, a.lat, b.lon, b.lat)
const held = (rig: CameraRig, before: { lon: number; lat: number }, what: string, tol = 1e-6): void => {
  const now = centre(rig)
  assert.ok(now, `${what}: the centre still meets the Moon`)
  assert.ok(arcRad(before, now!) < tol, `${what}: centre target held (${arcRad(before, now!)} rad)`)
}

// 1. The owner's Copernicus fly pose: zooming in and out keeps the centre target put, and the camera really travels.
{
  const rig = new CameraRig()
  rig.setFloor(1.01)
  rig.setPose({ lon: -20.08, lat: 9.62, dist: 1.046285, roll: 0, pitch: 56.47 })
  const before = centre(rig)!
  const start = { ...rig.pose }
  for (let i = 0; i < 12; i++) rig.zoomCentre(0.9, e, ASPECT, T0 + i)
  held(rig, before, 'in')
  assert.ok(rig.pose.dist < start.dist, 'closer to the Moon')
  assert.ok(arcRad({ lon: start.lon, lat: start.lat }, rig.pose) > 1e-5, 'the camera travelled along the ray, not straight down')
  assert.ok((rig.pose.pitch ?? 0) > 40, 'still an oblique view')
  for (let i = 0; i < 20; i++) rig.zoomCentre(1 / 0.9, e, ASPECT, T0 + 100 + i)
  held(rig, before, 'out')
  assert.ok(rig.pose.dist > start.dist, 'farther from the Moon')
}

// 2. Looking straight down is the old zoom: only the distance changes, by zoomDist.
{
  const rig = new CameraRig()
  rig.setFloor(1.01)
  rig.setPose({ lon: 10, lat: -5, dist: 1.5, roll: 0, pitch: 0 })
  rig.zoomCentre(0.8, e, ASPECT, T0)
  assert.equal(rig.pose.lon, 10)
  assert.equal(rig.pose.lat, -5)
  assert.equal(rig.pose.dist, zoomDist(1.5, 0.8, 0))
}

// 3. The floor: the camera approaches it and stops on it, never below, and the target stays centred.
{
  const rig = new CameraRig()
  rig.setFloor(1.01)
  rig.setPose({ lon: -20.08, lat: 9.62, dist: 1.046285, roll: 0, pitch: 56.47 })
  const before = centre(rig)!
  for (let i = 0; i < 200; i++) {
    rig.zoomCentre(0.9, e, ASPECT, T0 + i)
    assert.ok(rig.pose.dist >= 1.01 - 1e-6, `never below the floor (${rig.pose.dist})`)
  }
  assert.ok(rig.pose.dist < 1.0101, `settles on the floor (${rig.pose.dist})`)
  held(rig, before, 'on the floor', 1e-5)
}

// 4. Target invariance over repeated in/out at several altitudes and pitches, with and without a layout aim shift, above 2.35 too.
for (const dist of [1.03, 1.1, 1.4, 1.9, 2.3, 2.6, 4]) {
  for (const pitch of [12, 30, 56.47]) {
    for (const aim of [0, 0.1, 0.15]) {
      const rig = new CameraRig()
      rig.setFloor(1.01)
      rig.setPose({ lon: -20.08, lat: 9.62, dist, roll: 0, pitch })
      rig.restoreTilt(pitch)
      rig.aimShift = aim
      const before = centre(rig)
      if (!before) continue // the centre ray misses the Moon at this distance and tilt: nothing to hold
      const seq = [0.9, 0.9, 1.1, 1.1, 1.1, 0.85, 1 / 0.85, 0.9, 1.25, 0.95]
      seq.forEach((f, i) => {
        rig.zoomCentre(f, e, ASPECT, T0 + i)
        const now = centre(rig)
        assert.ok(now, `dist ${dist} pitch ${pitch} aim ${aim} step ${i}: still on the Moon`)
        assert.ok(arcRad(before, now!) < 1e-6, `dist ${dist} pitch ${pitch} aim ${aim} step ${i} (${f}): target moved ${arcRad(before, now!)} rad`)
      })
    }
  }
}

// 5. The zoom-out from 2.30 at a tilt (the old fade of the pitch above 2.35 moved the centre) and a free camera at 1.4 / 12 degrees.
{
  const a = new CameraRig()
  a.setFloor(1.01)
  a.setPose({ lon: 30, lat: -10, dist: 2.3, roll: 0, pitch: 60 })
  a.restoreTilt(60)
  const before = centre(a)!
  for (let i = 0; i < 15; i++) a.zoomCentre(1.1, e, ASPECT, T0 + i)
  held(a, before, 'zoom out from 2.30')
  const b = new CameraRig()
  b.setFloor(1.01)
  b.setPose({ lon: 5, lat: 5, dist: 1.4, roll: 0, pitch: 0 })
  b.setFreeOrientation([Math.sin(6 * Math.PI / 180), 0, 0, Math.cos(6 * Math.PI / 180)])
  const beforeB = centre(b)!
  b.zoomCentre(1.1, e, ASPECT, T0)
  held(b, beforeB, 'free camera zoom out (no recentre drift)')
}

// 6. The owner's link: a free orientation (`off`) and the layout aim shift: the dolly works from the rendered orientation.
for (const aim of [0, 0.1, 0.15]) {
  for (const aimX of [0, 0.08]) {
    const rig = new CameraRig()
    rig.setFloor(1.01)
    rig.setPose({ lon: -20.08, lat: 9.62, dist: 1.046285, roll: 0, pitch: 0 })
    const a = 56.47 * Math.PI / 180
    rig.setFreeOrientation([Math.sin(a / 2), 0, 0, Math.cos(a / 2)])
    rig.aimShift = aim
    rig.aimShiftX = aimX
    const before = centre(rig)!
    const dist0 = rig.camera(e, ASPECT, T0).pos.length()
    for (let i = 0; i < 10; i++) rig.zoomCentre(0.9, e, ASPECT, T0 + i)
    held(rig, before, `owner link, aim ${aim}/${aimX}, in`)
    assert.ok(rig.camera(e, ASPECT, T0).pos.length() < dist0, 'it did dolly in (not a no-op)')
    for (let i = 0; i < 14; i++) rig.zoomCentre(1 / 0.9, e, ASPECT, T0 + 50 + i)
    held(rig, before, `owner link, aim ${aim}/${aimX}, out`)
  }
}

// 7. Keys and the flight pad leave no inertia drifting behind: any zoom stops it.
{
  const rig = new CameraRig()
  rig.setFloor(1.01)
  rig.setPose({ lon: -20.08, lat: 9.62, dist: 1.2, roll: 0, pitch: 40 })
  rig.restoreTilt(40)
  rig.spin(40, 10, 400, e, ASPECT, T0)
  rig.release(T0 + 16)
  rig.zoomCentre(0.9, e, ASPECT, T0 + 20)
  const before = centre(rig)!
  rig.step(T0 + 100, 0.1)
  rig.step(T0 + 200, 0.1)
  held(rig, before, 'no inertia drift after a zoom')
}

// 8. The pure step: the camera stays on the centre ray; clampAlong stops at the first crossing, also for a floor that varies.
{
  const pos = new Vector3(0, 0, 1.2)
  const fwd = new Vector3(0, Math.sin(0.5), -Math.cos(0.5)).normalize()
  const next = dollyPosition(pos, fwd, 1.1, () => 0)
  assert.ok(next, 'a step toward the ground')
  const off = next!.clone().sub(pos)
  assert.ok(Math.abs(off.clone().normalize().dot(fwd) - 1) < 1e-9, 'the move is along the view ray')
  assert.equal(dollyPosition(new Vector3(0, 0, 3), new Vector3(0, 1, 0), 2, () => 0), null, 'sky: no step')
  const from = pos, to = pos.clone().addScaledVector(fwd, 0.5)
  const stop = clampAlong(from, to, (p) => p.length() - 1.05)
  assert.ok(Math.abs(stop.length() - 1.05) < 1e-3, `stops on a constant floor (${stop.length()})`)
  // A floor that rises and falls: a ridge between two clear ends. The camera stops at the ridge, not behind it.
  const along = (p: Vector3): number => p.clone().sub(from).dot(fwd) / 0.5
  const ridge = (p: Vector3): number => { const t = along(p); return t > 0.4 && t < 0.6 ? -Math.min(t - 0.4, 0.6 - t) : Math.min(Math.abs(t - 0.4), Math.abs(t - 0.6)) }
  const stopRidge = clampAlong(from, to, ridge)
  assert.ok(along(stopRidge) <= 0.4 + 1e-3 && along(stopRidge) > 0.38, `stops at the first crossing of a ridge (${along(stopRidge)})`)
  assert.equal(clampAlong(from, to, () => 1), to, 'clear all the way: the whole step')
  assert.ok(clampAlong(from, to, () => -1).distanceTo(from) < 1e-12, 'blocked at once: no step')
  // A narrow forbidden interval at 0.505-0.53 of the segment falls between 24 fixed samples; the strided walk still finds it.
  const a = new Vector3(0, 0, 3), b = new Vector3(0, 0, 1)
  const frac = (q: Vector3): number => (3 - q.z) / 2
  const narrow = (q: Vector3): number => { const t = frac(q); return (t > 0.505 && t < 0.53 ? -Math.min(t - 0.505, 0.53 - t) : Math.min(Math.abs(t - 0.505), Math.abs(t - 0.53))) * 2 }
  const stopNarrow = clampAlong(a, b, narrow)
  assert.ok(frac(stopNarrow) <= 0.505 + 1e-3 && frac(stopNarrow) > 0.49, `stops before a narrow forbidden interval (${frac(stopNarrow)})`)
  let calls = 0
  clampAlong(a, b, (q) => { calls++; return narrow(q) + 10 })
  assert.ok(calls <= 300, `the clearance is read a bounded number of times (${calls})`)
}

// 9. A free camera at 2.3 with a 5 degree offset and the user's tilt at its valid limit: the destination limit is smaller, so the whole
// orientation is carried and the centre target holds.
{
  const rig = new CameraRig()
  rig.setFloor(1.01)
  rig.setPose({ lon: 12, lat: 20, dist: 2.3, roll: 0, pitch: 0 })
  rig.setFreeOrientation([Math.sin(2.5 * Math.PI / 180), 0, 0, Math.cos(2.5 * Math.PI / 180)])
  rig.restoreTilt(80)
  const before = centre(rig)
  assert.ok(before, 'the centre meets the Moon')
  for (const f of [1.1, 1.1, 1 / 1.1, 0.8]) {
    rig.zoomCentre(f, e, ASPECT, T0)
    held(rig, before!, `free camera at the tilt limit, factor ${f}`)
  }
}

// 10. A step blocked by a ridge stays put: no radial fall-through that loses the target (floor 1.39 between latitudes 2 and 4, 1.01 elsewhere).
{
  const rig = new CameraRig()
  rig.setFloor(1.5)
  rig.deepFloor = (_lon, lat) => (lat >= 2 && lat <= 4 ? 1.39 : 1.01)
  rig.setPose({ lon: 0, lat: -0.5, dist: 1.4, roll: 0, pitch: 30 })
  rig.restoreTilt(30)
  const before = centre(rig)!
  let blocked = 0
  for (let i = 0; i < 14; i++) {
    const p0 = { ...rig.pose }
    rig.zoomCentre(0.5, e, ASPECT, T0 + i * 200)
    held(rig, before, `repeated zooms into the ridge, step ${i}`)
    const floor = Math.min(1.5, rig.pose.lat >= 2 && rig.pose.lat <= 4 ? 1.39 : 1.01)
    assert.ok(rig.pose.dist >= floor - 1e-6, `never below the floor under the camera (${rig.pose.dist} < ${floor})`)
    if (p0.lat === rig.pose.lat && p0.dist === rig.pose.dist) blocked++
  }
  assert.ok(blocked > 0, 'it did meet the ridge and stop')
}

console.log('dolly: ok')

// Review: a stride budget that runs out never returns the endpoint; discontinuous floors stop the walk above them.
{
  const a = new Vector3(0, 0, 3), b = new Vector3(0, 0, 1)
  const frac = (q: Vector3): number => (3 - q.z) / 2
  // A 1-Lipschitz clearance capped at 0.0001 with a forbidden interval at 0.5005-0.5025: safe strides are tiny, the budget runs out.
  const capped = (q: Vector3): number => { const t = frac(q); return Math.min(0.0001, Math.max(0.5005 - t, t - 0.5025)) }
  const r = clampAlong(a, b, capped)
  assert.ok(frac(r) < 0.5005, `never crosses (stopped at ${frac(r)})`)
  assert.notEqual(r, b, 'and does not return the endpoint')
  // A floor that jumps up (as a coverage step does) ahead: lots of clearance before it so the walk really reaches it, then it is inside the forbidden region.
  const jump = (q: Vector3): number => (frac(q) < 0.6 ? 0.05 : -0.001)
  const rj = clampAlong(a, b, jump)
  assert.ok(frac(rj) <= 0.6 + 1e-6 && frac(rj) > 0.59, `reaches the jump and stops at or before it (${frac(rj)})`)
  // Standing on a limit and leaving it (zoom out from the floor) still works.
  const leave = (q: Vector3): number => (q.z - 1.0)
  const out = clampAlong(new Vector3(0, 0, 1), new Vector3(0, 0, 2), leave)
  assert.ok(out.z > 1.99, `leaves the floor (${out.z})`)
}

// Review: floor feedback fires whenever a step is cut short, not only when it is blocked outright.
{
  const rig = new CameraRig()
  rig.setFloor(1.01)
  rig.setPose({ lon: -20.08, lat: 9.62, dist: 1.046285, roll: 0, pitch: 56.47 })
  const hits0 = rig.limitHits
  for (let i = 0; i < 40; i++) rig.zoomCentre(0.5, e, ASPECT, T0 + i * 200)
  assert.ok(rig.limitHits - hits0 >= 1, `the floor pulses the limit feedback (${rig.limitHits - hits0} hits in 40 zooms)`)
  assert.ok(rig.limitHits - hits0 <= 40)
}

// Review: a continuous barrier right at the start (0.0005-0.0025 of the step) is never crossed by a forced first stride.
{
  const a = new Vector3(0, 0, 3), b = new Vector3(0, 0, 1)
  const frac = (q: Vector3): number => (3 - q.z) / 2
  const barrier = (q: Vector3): number => { const t = frac(q); return Math.min(0.0001, Math.max(0.0005 - t, t - 0.0025)) }
  const r = clampAlong(a, b, barrier)
  assert.ok(frac(r) < 0.0005, `stops before the barrier (${frac(r)})`)
}

// Review: a gap between two fine-coverage regions. The dolly uses a continuous cone floor built from the data under its own path, and never
// ends below the continuous coverage floor (the lowest of texel altitude + cone over every point of both regions) along the way.
{
  const GLOBAL = 0.4738, DEEP = 0.0593
  const inA = (lon: number, lat: number): boolean => lon >= 20 && lon <= 25 && lat >= 0 && lat <= 5
  const inB = (lon: number, lat: number): boolean => lon >= 28 && lon <= 33 && lat >= 0 && lat <= 5
  const texelKmAt = (lon: number, lat: number): number => (inA(lon, lat) || inB(lon, lat) ? DEEP : GLOBAL)
  const view = { shortPx: 900, fovDeg: 30, texelKmAt, globalTexelKm: GLOBAL }
  const globalFloor = floorDist(GLOBAL, 900, 30)
  const dataFloor = pointFloorAt(22, 2, view)
  assert.ok(dataFloor < globalFloor, 'the data floor is lower than the global one')
  const clampTo = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x))
  const boxArc = (lon: number, lat: number, l0: number, l1: number, b0: number, b1: number): number => angularDistance(lon, lat, clampTo(lon, l0, l1), clampTo(lat, b0, b1))
  // The exact continuous coverage floor: the texel altitude plus the cone from the nearest point of either box.
  const trueFloor = (lon: number, lat: number): number => Math.min(globalFloor, dataFloor + SITE_CONE * Math.min(boxArc(lon, lat, 20, 25, 0, 5), boxArc(lon, lat, 28, 33, 0, 5)))
  // The walk itself, along a horizontal path from inside region A out across the gap, at several altitudes: the real sampled search
  // (`deeperFloorAt`, a ladder that steps) lets the walker end below the continuous coverage floor; the continuous cone built from the
  // data under the path never does.
  const R = Math.PI / 180
  const dirOf = (lon: number, lat: number): Vector3 => new Vector3(Math.cos(lat * R) * Math.cos(lon * R), Math.cos(lat * R) * Math.sin(lon * R), Math.sin(lat * R))
  const llOf = (p: Vector3): [number, number] => { const q = p.clone().normalize(); return [Math.atan2(q.y, q.x) / R, Math.asin(q.z) / R] }
  let ladderWorst = Infinity
  for (const r of [dataFloor + 0.0005, dataFloor + 0.003, dataFloor + 0.01, dataFloor + 0.02]) {
    const from = dirOf(24.9, 2.5).multiplyScalar(r), to = dirOf(28.5, 2.5).multiplyScalar(r)
    const ladder = (p: Vector3): number => { const [lo, la] = llOf(p); return p.length() - Math.min(globalFloor, deeperFloorAt(lo, la, view)) }
    const dirs: Vector3[] = [], floors: number[] = []
    for (let j = 0; j <= 48; j++) { const q = from.clone().lerp(to, j / 48).normalize(); const [lo, la] = llOf(q); dirs.push(q); floors.push(pointFloorAt(lo, la, view)) }
    const cone = coneFloor(dirs, floors, SITE_CONE)
    const viaCone = (p: Vector3): number => p.length() - Math.min(globalFloor, cone(p))
    for (const [name, clearance] of [['ladder', ladder], ['cone', viaCone]] as const) {
      const end = clampAlong(from, to, clearance)
      let worst = Infinity
      for (let t = 0; t <= 1; t += 0.0005) {
        const q = from.clone().lerp(to, t)
        if (from.distanceTo(q) > from.distanceTo(end)) break
        const [lo, la] = llOf(q)
        worst = Math.min(worst, q.length() - trueFloor(lo, la))
      }
      if (name === 'cone') assert.ok(worst >= -1e-9, `altitude ${r}: the cone walk never goes below the coverage floor (${worst})`)
      else ladderWorst = Math.min(ladderWorst, worst)
    }
  }
  assert.ok(ladderWorst >= -1e-9, `the real sampled search, walked with the Lipschitz stride, never goes below the exact coverage floor either (${ladderWorst})`)
  for (const roll of [0, 90, -90, 180]) {
    for (const lonStart of [24, 26.5, 29]) {
      const rig = new CameraRig()
      rig.setFloor(globalFloor)
      rig.deepFloor = (lon, lat) => deeperFloorAt(lon, lat, view)
      rig.deepTexelFloor = (lon, lat) => pointFloorAt(lon, lat, view)
      rig.setPose({ lon: lonStart, lat: 2.5, dist: globalFloor + 0.01, roll, pitch: 0 })
      rig.restoreTilt(45)
      const before = centre(rig)
      if (!before) continue
      for (let i = 0; i < 60; i++) {
        rig.zoomCentre(i % 7 === 6 ? 1.3 : 0.8, e, ASPECT, T0 + i * 200)
        const cam = rig.camera(e, ASPECT, T0 + i * 200)
        const ll = lonLatOfDir(e, cam.pos.clone().normalize())
        const floor = trueFloor(ll.lon, ll.lat)
        assert.ok(cam.pos.length() >= floor - 1e-6, `roll ${roll} from ${lonStart}, step ${i}: camera at ${cam.pos.length()} is below the coverage floor ${floor}`)
        held(rig, before, `roll ${roll} from ${lonStart}, step ${i}`)
      }
    }
  }
}

// Review: standing on a limit, only a move away from the surface is allowed; a move toward it is blocked outright.
{
  const a = new Vector3(0, 0, 3), b = new Vector3(0, 0, 1)
  const frac = (q: Vector3): number => (3 - q.z) / 2
  // The original barrier at 0.0005-0.0025 with the cap at 1e-7 (standing at the start): nothing crosses it.
  const barrier = (q: Vector3): number => { const t = frac(q); return Math.min(1e-7, Math.max(0.0005 - t, t - 0.0025)) }
  const r = clampAlong(a, b, barrier)
  assert.ok(frac(r) < 0.0005, `standing, a move inward stays put (${frac(r)})`)
  const away = clampAlong(b, new Vector3(0, 0, 2), (q) => q.z - 1)
  assert.ok(away.z > 1.999, 'standing on the floor, a move away is accepted')
  const farLimit = clampAlong(b, new Vector3(0, 0, 4), (q) => Math.min(q.z - 1, 2 - q.z))
  assert.ok(Math.abs(farLimit.z - 2) < 5e-5, `and is cut at the far limit (${farLimit.z})`)

  // Through the rig: standing on the floor (a settled stop), a zoom in does not move and pulses; a zoom out moves.
  for (const free of [false, true]) {
    const rig = new CameraRig()
    rig.setFloor(1.01)
    rig.setPose({ lon: -20.08, lat: 9.62, dist: 1.2, roll: 0, pitch: 56.47 })
    if (free) { rig.setPose({ pitch: 0 }); rig.setFreeOrientation([Math.sin(25 * Math.PI / 180), 0, 0, Math.cos(25 * Math.PI / 180)]) }
    else rig.restoreTilt(56.47)
    for (let i = 0; i < 80; i++) rig.zoomCentre(0.5, e, ASPECT, T0 + i * 200) // settle on the floor
    const before = centre(rig)!
    const stood = rig.camera(e, ASPECT, T0).pos.clone()
    const hits = rig.limitHits
    rig.zoomCentre(0.1, e, ASPECT, T0 + 100000)
    assert.ok(rig.camera(e, ASPECT, T0).pos.distanceTo(stood) < 1e-6, `${free ? 'free' : 'posed'}: a zoom in from the floor does not move`)
    assert.ok(rig.limitHits > hits, `${free ? 'free' : 'posed'}: and pulses the limit feedback`)
    rig.zoomCentre(1.5, e, ASPECT, T0 + 100500)
    assert.ok(rig.camera(e, ASPECT, T0).pos.distanceTo(stood) > 1e-4, `${free ? 'free' : 'posed'}: a zoom out from the floor moves`)
    held(rig, before, `${free ? 'free' : 'posed'}: zoom out from the floor`)
  }
}

// Review: an outward zoom from the floor of a tiny fine-coverage region (0.016693 degrees square, 0.5 m texels, 900 px,
// 30 degrees) must not end below the rising coverage floor, and a truncated step pulses the limit feedback.
{
  const GLOBAL = 0.4738, HALF = 0.016693 / 2
  const lon0 = 10, lat0 = 5
  const inR = (lon: number, lat: number): boolean => Math.abs(lon - lon0) <= HALF && Math.abs(lat - lat0) <= HALF
  const view = { shortPx: 900, fovDeg: 30, texelKmAt: (lon: number, lat: number) => (inR(lon, lat) ? 0.0005 : GLOBAL), globalTexelKm: GLOBAL }
  const globalFloor = floorDist(GLOBAL, 900, 30)
  const regionFloor = pointFloorAt(lon0, lat0, view)
  const trueFloor = (lon: number, lat: number): number => {
    const arc = angularDistance(lon, lat, Math.max(lon0 - HALF, Math.min(lon0 + HALF, lon)), Math.max(lat0 - HALF, Math.min(lat0 + HALF, lat)))
    return Math.min(globalFloor, regionFloor + SITE_CONE * arc)
  }
  for (const factor of [2, 1.5, 3]) {
    const rig = new CameraRig()
    rig.setFloor(globalFloor)
    rig.deepFloor = (lon, lat) => deeperFloorAt(lon, lat, view)
    rig.deepTexelFloor = (lon, lat) => pointFloorAt(lon, lat, view)
    rig.setPose({ lon: lon0, lat: lat0, dist: regionFloor, roll: 0, pitch: 45 })
    rig.restoreTilt(45)
    const hits = rig.limitHits
    const start = rig.camera(e, ASPECT, T0).pos.length()
    rig.zoomCentre(factor, e, ASPECT, T0)
    const cam = rig.camera(e, ASPECT, T0)
    const ll = lonLatOfDir(e, cam.pos.clone().normalize())
    assert.ok(cam.pos.length() >= trueFloor(ll.lon, ll.lat) - 1e-9, `factor ${factor}: ends at ${cam.pos.length()}, below the coverage floor ${trueFloor(ll.lon, ll.lat)}`)
    assert.ok(cam.pos.length() > start + 1e-6, `factor ${factor}: a zoom out from the floor always rises (${start} -> ${cam.pos.length()})`)
    assert.equal(rig.limitHits, hits, `factor ${factor}: a zoom out that moved radially gives no limit pulse`)
    // Later zoom outs dolly again: the centre target holds from some step on, and the camera never goes below the floor on the way.
    let settledFrom = -1
    let ref: { lon: number; lat: number } | null = null
    for (let i = 1; i <= 40; i++) {
      rig.zoomCentre(1.3, e, ASPECT, T0 + i * 200)
      const c2 = rig.camera(e, ASPECT, T0 + i * 200)
      const l2 = lonLatOfDir(e, c2.pos.clone().normalize())
      assert.ok(c2.pos.length() >= trueFloor(l2.lon, l2.lat) - 1e-9, `factor ${factor}, step ${i}: below the coverage floor by ${trueFloor(l2.lon, l2.lat) - c2.pos.length()} (dist ${c2.pos.length()}, hits ${rig.limitHits})`)
      const hit = pickSphere(c2, 0, 0, ASPECT)
      if (!hit) continue
      const here = lonLatOfDir(e, hit)
      if (ref && arcRad(ref, here) < 1e-9) { if (settledFrom < 0) settledFrom = i } else { ref = here; settledFrom = -1 }
    }
    assert.ok(settledFrom > 0, `factor ${factor}: once there is clearance the zoom outs dolly again (target held)`)
  }
}

// Review: over constant-resolution coverage the dolly's floor is exactly the camera's floor, with no bumps, so a zoom 69.5 m
// above the floor at lat 89 (pitch 45) dollies with its target held instead of falling back to a radial move.
{
  const FLOOR = 1.012052
  for (const [lon, lat, aboveM, factor] of [[0, 89, 69.5, 1.1], [30, 45, 69.5, 1.1], [-120, -70, 69.5, 1.1], [0, 89, 30, 1.1], [0, 89, 15, 1.1], [0, 89, 69.5, 1.9], [30, 45, 30, 1.9]] as const) {
    const rig = new CameraRig()
    rig.setFloor(1.458) // the global floor is higher; the constant-resolution coverage lowers it to FLOOR
    rig.deepFloor = () => FLOOR
    rig.deepTexelFloor = () => FLOOR
    rig.setPose({ lon, lat, dist: FLOOR + aboveM / 1737400, roll: 0, pitch: 45 })
    rig.restoreTilt(45)
    const camBefore = rig.camera(e, ASPECT, T0)
    const before = centre(rig)!
    const span = camBefore.pos.length() - 1
    const hits = rig.limitHits
    rig.zoomCentre(factor, e, ASPECT, T0)
    const now = centre(rig)!
    assert.ok(arcRad(before, now) < 0.01 * span, `lat ${lat}: the target shifted ${arcRad(before, now)} rad (span ${span})`)
    assert.ok(arcRad(before, now) < 1e-9, `lat ${lat}: it was a true dolly (${arcRad(before, now)} rad)`)
    assert.ok(rig.camera(e, ASPECT, T0).pos.length() > camBefore.pos.length(), 'and it moved out')
    assert.equal(rig.limitHits, hits, 'without a limit pulse')
  }
}

// Review: floor anchors belong to one set of floor inputs. After a resize (900 -> 1200 px) or a lens change the floor is
// higher, and cached anchors must not lower it: the dolly never ends below the true floor.
{
  const GLOBAL = 0.4738
  const world = { px: 900, fov: 30 }
  const view = (): { shortPx: number; fovDeg: number; texelKmAt: (lon: number, lat: number) => number; globalTexelKm: number } => ({ shortPx: world.px, fovDeg: world.fov, texelKmAt: () => 0.0005, globalTexelKm: GLOBAL })
  const trueFloor = (): number => pointFloorAt(0, 0, view())
  const build = (rig: CameraRig): void => {
    // New floor functions, as the app makes them at a resize; they read the inputs live, as the app's do for the lens.
    rig.deepFloor = (lon, lat) => deeperFloorAt(lon, lat, view())
    rig.deepTexelFloor = (lon, lat) => pointFloorAt(lon, lat, view())
  }
  for (const change of ['resize', 'fov'] as const) {
    const rig = new CameraRig()
    world.px = 900; world.fov = 30
    rig.setFloor(1.458)
    build(rig)
    rig.setPose({ lon: 0, lat: 89, dist: trueFloor() + 69.5 / 1737400, roll: 0, pitch: 45 })
    rig.restoreTilt(45)
    for (let i = 0; i < 6; i++) rig.zoomCentre(i % 2 ? 1.2 : 0.9, e, ASPECT, T0 + i * 200) // fills the anchors at the first floor
    if (change === 'resize') { world.px = 1200; build(rig) } else { world.fov = 45; rig.fovDeg = 45 }
    const floor = trueFloor()
    rig.setPose({ dist: floor + 1e-9 })
    for (let i = 0; i < 40; i++) {
      rig.zoomCentre(i % 3 === 2 ? 1.1 : 0.9, e, ASPECT, T0 + 5000 + i * 200)
      const d = rig.camera(e, ASPECT, T0).pos.length()
      assert.ok(d >= floor - 1e-9, `${change}: step ${i} ends at ${d}, below the true floor ${floor} by ${floor - d}`)
    }
  }
}
