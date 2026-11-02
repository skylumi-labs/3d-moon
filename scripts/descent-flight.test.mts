/**
 * The descent path and the flight over it (G2b): src/descent/DescentPath.ts and flight.ts against data/apollo17/descent-track.json.
 * Offline. npx tsx scripts/descent-flight.test.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { Quaternion, Vector3 } from 'three'
import { DescentPath, HANDOVER_T, type TrackDoc } from '../src/descent/DescentPath.ts'
import { DescentFlight, GROUND_ENTER_M, HANDOFF_T, HANDOVER_MS, SETTLE_BLEND_S, SETTLE_END_T, SHADOW_DIR, WINDOW, CHASE_COAST, coastK, blendCamera, chaseView, localUp, shadowRoom, lmPoseOf, modelQuaternion, siteRadius, windowView } from '../src/descent/flight.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { attitudeQuat, fitPlacement } from '../src/ground/lmPlacement.ts'
import { LM_REPORTED_PITCH_DEG, LM_REPORTED_ROLL_DEG } from '../src/ground/site17.ts'
import { frameAxes, groundBasis, groundFromView, makeSiteFrame, viewFromGround } from '../src/ground/frame.ts'
import type { ViewCamera } from '../src/camera/pose.ts'

const doc = JSON.parse(fs.readFileSync(new URL('../data/apollo17/descent-track.json', import.meta.url), 'utf8')) as TrackDoc
const path = DescentPath.fromDoc(doc)
const P = doc.powered
const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`)
const DEG = 180 / Math.PI
const angleBetween = (a: Quaternion, b: Quaternion): number => 2 * Math.acos(Math.min(1, Math.abs(a.clone().normalize().dot(b.clone().normalize())))) * DEG
const report: string[] = []

// 1. The sampler returns the file's rows at integer seconds, and clamps outside the track.
{
  for (const i of [0, 1, 100, 446, 562, 640, 700, 725, 731, 732]) {
    const s = path.sample(i)
    near(s.pos[0], P.E_m[i], 1e-6, `E at ${i}`); near(s.pos[1], P.N_m[i], 1e-6, `N at ${i}`); near(s.pos[2], P.U_m[i], 1e-6, `U at ${i}`)
    near(s.altAgl, P.alt_m[i], 1e-6, `alt at ${i}`); near(s.dust, P.dust_index[i], 1e-9, `dust at ${i}`)
    assert.equal(s.engine, P.engine[i]); assert.equal(s.utcMs, Date.parse(P.utc[i]))
  }
  assert.equal(path.sample(-1e9).t, path.tMin); assert.equal(path.sample(1e9).t, path.tMax)
  assert.equal(path.tMin, -8517); assert.equal(path.tMax, 732); assert.equal(path.contactT, 725)
  assert.equal(path.sample(725).utcMs, Date.parse('1972-12-11T19:54:58Z'))
}

// 2. No overshoot: between two rows every interpolated powered value stays inside the two end values (the limiter's promise),
//    and dust and altitude never run backwards after 640 s.
{
  let worst = 0
  for (let i = 0; i < 732; i++) {
    for (const s of [0.13, 0.5, 0.87]) {
      const x = path.sample(i + s)
      const chk = (v: number, a: number, b: number, what: string) => {
        const lo = Math.min(a, b), hi = Math.max(a, b), tol = 1e-9 * (1 + Math.abs(hi))
        if (v < lo - tol || v > hi + tol) worst = Math.max(worst, Math.max(lo - v, v - hi))
        assert.ok(v >= lo - tol && v <= hi + tol, `${what} overshoots at ${i + s}: ${v} not in [${lo}, ${hi}]`)
      }
      chk(x.pos[0], P.E_m[i], P.E_m[i + 1], 'E'); chk(x.pos[1], P.N_m[i], P.N_m[i + 1], 'N'); chk(x.pos[2], P.U_m[i], P.U_m[i + 1], 'U')
      chk(x.altAgl, P.alt_m[i], P.alt_m[i + 1], 'alt'); chk(x.dust, P.dust_index[i], P.dust_index[i + 1], 'dust'); chk(x.massKg, P.mass_kg[i], P.mass_kg[i + 1], 'mass')
    }
  }
  let prev = path.sample(640)
  for (let t = 640.05; t <= 725; t += 0.05) { const x = path.sample(t); assert.ok(x.dust >= prev.dust - 1e-9, `dust falls at ${t}`); assert.ok(x.altAgl <= prev.altAgl + 1e-9, `altitude rises at ${t}`); prev = x }
}

// 3. Continuity: no step in position, velocity, attitude or altitude between neighbouring instants, including the seam at ignition (t = 0) and between the orbit segments.
{
  for (const t of [-8517, -5000, -2832, -2831, -2830.9, -990, -100, -11, -0.05, 0, 0.05, 1, 100, 300, 562, 700, 725, 731]) {
    const a = path.sample(t - 0.01), b = path.sample(t + 0.01)
    const speed = Math.hypot(...b.vel)
    assert.ok(Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]) < 0.02 * speed + 0.05, `position step at ${t}`)
    assert.ok(Math.hypot(b.vel[0] - a.vel[0], b.vel[1] - a.vel[1], b.vel[2] - a.vel[2]) < 0.5, `velocity step at ${t}`)
    assert.ok(angleBetween(new Quaternion(a.quat[1], a.quat[2], a.quat[3], a.quat[0]), new Quaternion(b.quat[1], b.quat[2], b.quat[3], b.quat[0])) < 0.1, `attitude step at ${t}`)
    assert.ok(Math.abs(b.altAgl - a.altAgl) < 0.02 * speed + 0.05, `altitude step at ${t}`)
  }
  // The orbit segment ends at the ignition state: the seam is a few metres at most.
  const a = path.sample(-0.001), b = path.sample(0)
  assert.ok(Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]) < 3, 'orbit to powered seam')
  // Before ignition nothing claims a source: attitude is held and marked, the orbit is modelled.
  const o = path.sample(-990)
  assert.equal(o.attitudeKnown, false); assert.equal(o.prov.pos, 'E'); assert.equal(o.engine, 'coast'); assert.equal(path.sample(-5).engine, 'ullage')
  assert.ok(path.sample(-990).altAgl > 15000 && path.sample(-990).altAgl < 25000, `20 km at the hand-over: ${path.sample(-990).altAgl}`)
}

// 4. Provenance: the bands cover every second exactly once per quantity, and horizontal speed is modelled everywhere (no source has it).
{
  const bands = path.bands()
  for (const g of ['alt', 'vv', 'vh', 'pos', 'att', 'thr', 'dust']) {
    const mine = bands.filter((b) => b.group === g)
    assert.ok(mine.length >= 1); assert.equal(mine[0].t0, 0); assert.equal(mine[mine.length - 1].t1, 732)
    for (let i = 1; i < mine.length; i++) assert.equal(mine[i].t0, mine[i - 1].t1 + 1)
  }
  assert.ok(bands.filter((b) => b.group === 'vh' && b.t1 <= 700).every((b) => b.code === 'E'), 'horizontal speed is modelled')
  assert.ok(bands.some((b) => b.group === 'alt' && b.code === 'V'), 'some altitude is a verified table value')
}

// 5. Dust index mapping: the file's index follows the call table (0 above 110 ft, 0.2 near 65 ft, 1 at contact); it is a rendering scale.
{
  near(DescentPath.dustAtAltM(120 * 0.3048), 0, 0, 'no dust above 110 ft'); near(DescentPath.dustAtAltM(65 * 0.3048), 0.2, 1e-9, '65 ft'); near(DescentPath.dustAtAltM(0), 1, 0, 'contact')
  for (let t = 640; t <= 725; t += 1) { const s = path.sample(t); assert.ok(Math.abs(s.dust - DescentPath.dustAtAltM(s.altAgl)) < 0.32, `dust vs call table at ${t}: ${s.dust} vs ${DescentPath.dustAtAltM(s.altAgl)}`) }
  assert.ok(path.sample(600).dust === 0 && path.sample(690).dust > 0.15 && path.sample(690).dust < 0.3)
}

const frameDef = makeSiteFrame(30.77168, 20.19091, -2626)
const rs = siteRadius(-2626)
const envAt = (t: number, nowMs = 1e9, ground: ((e: number, n: number) => number | null) | null = () => 0) => {
  const e = ephemerisAt(new Date(path.utcMsAt(t)))
  return { axes: frameAxes(e, frameDef), rs, groundZ: ground, nowMs, e }
}

// 6. The module's pose: the model's rotation from the track's body attitude matches G1's own placement at rest, and the model origin sits on the ground.
{
  const s = path.sample(SETTLE_END_T)
  const q = modelQuaternion(new Quaternion(s.quat[1], s.quat[2], s.quat[3], s.quat[0]))
  const g1 = attitudeQuat({ headingDeg: 270, pitchDeg: LM_REPORTED_PITCH_DEG, rollDeg: LM_REPORTED_ROLL_DEG })
  const gap = angleBetween(q, g1)
  report.push(`rest attitude, track vs G1 reported placement: ${gap.toFixed(2)} deg`)
  assert.ok(gap < 0.6, `rest attitude differs from G1 by ${gap} deg`)
  // and a wrong hemisphere would be far more than that: the nose points west, pitched up
  const nose = new Vector3(0, 0, 1).applyQuaternion(q)   // three (east, up, south)
  assert.ok(nose.x < -0.99 && nose.y > 0.06 && nose.y < 0.09, `nose ${nose.toArray()}`)
  const lm = lmPoseOf(s, 0)
  const pads = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, z]) => new Vector3(2.76 * x, 0.1, 2.76 * z))
  const g1p = fitPlacement(pads, 270, () => 0, { attitude: { pitchDeg: LM_REPORTED_PITCH_DEG, rollDeg: LM_REPORTED_ROLL_DEG } })
  report.push(`rest height of the model origin, track vs G1: ${lm.pos.z.toFixed(3)} vs ${g1p.z.toFixed(3)} m`)
  assert.ok(Math.abs(lm.pos.z - g1p.z) < 0.3)
  near(lm.pos.x, 0, 1e-9, 'rest E'); near(lm.pos.y, 0, 1e-9, 'rest N')
  // In flight the body's thrust axis and the windows: at ignition the windows face the sky (nose 16 deg up, window looks up), at pitchover the ground comes in.
  const s0 = path.sample(0), body = (t: DescentSample2, v: number[]) => new Vector3(...v).applyQuaternion(new Quaternion(t.quat[1], t.quat[2], t.quat[3], t.quat[0]))
  type DescentSample2 = ReturnType<typeof path.sample>
  assert.ok(body(s0, [1, 0, 0]).z > 0.2, 'nose above the horizon at ignition')
  assert.ok(body(path.sample(300), [1, 0, 0]).z > 0.9, 'braking: windows look at the sky')
  assert.ok(body(path.sample(600), [1, 0, 0]).z > 0.5)
}

// 7. Cameras: the chase camera looks at the module; the window camera at t = 311 s (112:55:04) has the Earth in its field and at 112:59:15 the surface.
{
  for (const t of [0, 300, 640]) {
    const env = envAt(t)
    const lm = lmPoseOf(path.sample(t), 0)
    const v = chaseView(lm, rs)
    const b = groundBasis(v)
    const to = lm.pos.clone().addScaledVector(new Vector3(lm.pos.x, lm.pos.y, lm.pos.z + rs).normalize(), 2.4).sub(v.pos).normalize()
    assert.ok(to.dot(b.back.clone().negate()) > 1 - 1e-9, `chase camera looks at the module at ${t}`)
    assert.ok(v.pos.distanceTo(lm.pos) > 44 && v.pos.distanceTo(lm.pos) < 47, 'about 45 m off')
    void env
  }
  const earthAt = (t: number) => {
    const s = path.sample(t), e = ephemerisAt(new Date(s.utcMs))
    // The Earth as seen from the module: the site frame's direction (the Earth is at infinity), through the frame's axes.
    const ax = frameAxes(e, frameDef)
    const d = e.earthDir
    return new Vector3(d.dot(ax.east), d.dot(ax.north), d.dot(ax.up))
  }
  // The Earth in the window's frame: across (positive right) and up, degrees; the frame is fov high and fov x 16/9 across.
  const inWindow = (t: number): { across: number; up: number; inside: boolean } => {
    const v = windowView(lmPoseOf(path.sample(t), 0)), b = groundBasis(v), d = earthAt(t)
    const fwd = b.back.clone().negate()
    const across = Math.atan2(d.dot(b.right), d.dot(fwd)) * DEG, up = Math.atan2(d.dot(b.up), d.dot(fwd)) * DEG
    const hh = Math.atan(v.tanHalf * 16 / 9) * DEG, hv = Math.atan(v.tanHalf) * DEG
    return { across, up, inside: Math.abs(across) < hh && Math.abs(up) < hv }
  }
  assert.ok(inWindow(311).inside, 'the Earth is in the window at 112:55:04 (t 311)')
  let tLeave = NaN
  for (let t = 311; t <= 700 && Number.isNaN(tLeave); t++) if (!inWindow(t).inside) tLeave = t
  report.push(`Earth from the commander's window: in the frame at t 311, leaves the top of it at t ${tLeave} (the log has it leaving Schmitt's window by t 400): residual ${tLeave - 400} s`)
  assert.ok(tLeave >= 400 && tLeave <= 460, `Earth leaves the window at ${tLeave}`)
  // The window looks at the ground once pitched over: at 600 s the view centre points below the horizon.
  const b600 = groundBasis(windowView(lmPoseOf(path.sample(640), 0)))
  assert.ok(b600.back.z > 0, 'at 640 s (pitch 8.6 deg) the window looks down')
  const b300 = groundBasis(windowView(lmPoseOf(path.sample(300), 0)))
  assert.ok(b300.back.z < -0.15, 'at 300 s the window looks above the horizon (about 14 deg)')
}

// 8. The hand-over from the orbital rig: no step larger than the blend allows, the end of the blend equals the flight camera, and the clock is held.
{
  const f = new DescentFlight(path)
  const e0 = envAt(HANDOVER_T)
  const rigView = { pos: new Vector3(0, -800000, 400000), headingDeg: 20, pitchDeg: -30, rollDeg: 0, tanHalf: 0.27 }
  const rigCam: ViewCamera = viewFromGround(e0.axes, rigView)
  f.begin(rigCam, 0)
  const first = f.evaluate({ ...e0, nowMs: 0 })
  assert.ok(first.blending)
  assert.ok(first.cam.pos.distanceTo(rigCam.pos) < 1e-12 && first.cam.right.distanceTo(rigCam.right) < 1e-9 && Math.abs(first.cam.tanHalf - rigCam.tanHalf) < 1e-12, 'blend starts at the rig camera')
  let prev = first.cam, maxPos = 0, maxAng = 0, maxFov = 0
  const total = viewFromGround(e0.axes, f.evaluate({ ...e0, nowMs: HANDOVER_MS + 1 }).view).pos.distanceTo(rigCam.pos)
  f.begin(rigCam, 0)
  for (let ms = 16; ms <= HANDOVER_MS; ms += 16) {
    f.advance(0.016)
    assert.equal(f.t, HANDOVER_T, 'clock held during the blend')
    const c = f.evaluate({ ...e0, nowMs: ms }).cam
    maxPos = Math.max(maxPos, c.pos.distanceTo(prev.pos)); maxAng = Math.max(maxAng, Math.acos(Math.min(1, c.back.dot(prev.back))) * DEG); maxFov = Math.max(maxFov, Math.abs(Math.log(c.tanHalf / prev.tanHalf)))
    prev = c
  }
  report.push(`hand-over from the rig: ${(total * 1737.4).toFixed(0)} km blended over ${HANDOVER_MS / 1000} s, largest frame step ${(maxPos * 1737400).toFixed(0)} m, ${maxAng.toFixed(2)} deg, field ${(maxFov * 100).toFixed(2)} %`)
  assert.ok(maxPos < total * 0.0035, `position step ${maxPos} of ${total}`)   // smoothstep peak slope 1.5 per blend, 625 frames
  assert.ok(maxAng < 1, `orientation step ${maxAng}`)
  const after = f.evaluate({ ...e0, nowMs: HANDOVER_MS + 1 })
  assert.ok(!after.blending)
  const flightCam = viewFromGround(e0.axes, after.view)
  assert.ok(flightCam.pos.distanceTo(after.cam.pos) < 1e-12)
  // the last blended frame (k = 0.9985) is within a step of the flight camera
  assert.ok(prev.pos.distanceTo(after.cam.pos) <= maxPos * 1.01 + 1e-9 && Math.acos(Math.min(1, prev.back.dot(after.cam.back))) * DEG <= maxAng * 1.01 + 1e-9)
  // the blend function itself: a camera blended with itself is that camera
  const same = blendCamera(rigCam, rigCam, 0.5)
  assert.ok(same.pos.distanceTo(rigCam.pos) < 1e-15 && same.back.distanceTo(rigCam.back) < 1e-12)
}

// 9. Regimes and the hand-off to ground mode: orbit at the hand-over, ground mode once the camera is within 15 km of the site, and the view the ground
//    camera inherits at contact and at rest is the flight camera's, position, orientation and field, exactly.
{
  const f = new DescentFlight(path)
  let tGround = NaN
  f.t = HANDOVER_T
  for (let t = HANDOVER_T; t <= 732; t += 1) {
    f.t = t
    const fr = f.evaluate(envAt(t))
    if (t === HANDOVER_T) assert.equal(fr.regime, 'orbit')
    if (fr.regime === 'ground' && Number.isNaN(tGround)) tGround = t
    if (t > 725) assert.equal(fr.regime, 'ground')
  }
  report.push(`the camera enters ground mode at t = ${tGround} s (within ${GROUND_ENTER_M / 1000} km of the site)`)
  assert.ok(tGround > 400 && tGround < 560, `ground mode from ${tGround}`)
  // The regime does not flap: scrubbing back across the border takes the leave threshold, not the enter one.
  for (const t of [725, SETTLE_END_T]) {
    f.t = t
    const env = envAt(t)
    const fr = f.evaluate(env)
    assert.equal(fr.regime, 'ground')
    // What ground mode holds is a GroundView; a world camera made from it and turned back is the same view.
    const back = groundFromView(env.axes, viewFromGround(env.axes, fr.view))
    assert.ok(back.pos.distanceTo(fr.view.pos) < 1e-6, `position at ${t}`)
    const b1 = groundBasis(fr.view), b2 = groundBasis(back)
    assert.ok(b1.right.distanceTo(b2.right) < 1e-9 && b1.up.distanceTo(b2.up) < 1e-9 && b1.back.distanceTo(b2.back) < 1e-9, `orientation at ${t}`)
    near(back.tanHalf, fr.view.tanHalf, 1e-12, `field at ${t}`)
  }
  // Frames either side of the hand-off (t = 730.98, 731.02 at the playback step) differ by nothing: the module is at rest.
  f.t = SETTLE_END_T - 0.02
  const a = f.evaluate(envAt(SETTLE_END_T)); f.t = SETTLE_END_T + 0.02; const b = f.evaluate(envAt(SETTLE_END_T))
  assert.ok(a.view.pos.distanceTo(b.view.pos) < 1e-3 && a.lm.pos.distanceTo(b.lm.pos) < 1e-3, 'at rest across the hand-off')
  // Terrain 1.3 m above the nominal ground: the module lands on it (the pad plane meets the terrain at contact), and is unmoved high up.
  const up1 = envAt(725, 1e9, () => 1.3)
  f.t = 725
  const onIt = f.evaluate(up1)
  near(onIt.lm.padZ, 1.3 + ((0 ** 2 + 0 ** 2) / (2 * rs)) + (path.sample(725).padAlt - path.sample(725).altAgl), 0.01, 'pads meet the terrain at contact')
  f.t = 300
  near(f.evaluate(envAt(300, 1e9, () => 1.3)).lm.pos.z, f.evaluate(envAt(300, 1e9, () => 0)).lm.pos.z, 1e-9, 'no terrain offset high up')
}

// 10. The clock: 16x to ignition minus 20 s and then true time; fixed rates; playback stops at the hand-off; scrubbing clamps.
{
  const f = new DescentFlight(path)
  f.begin({ pos: new Vector3(), right: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0), back: new Vector3(0, 0, 1), tanHalf: 0.27 }, 0)
  f.evaluate({ ...envAt(HANDOVER_T), nowMs: HANDOVER_MS + 5 })
  assert.equal(f.speed(), 16)
  let steps = 0
  while (f.t < -20 && steps++ < 1e5) f.advance(1 / 60)
  assert.equal(f.t, -20); assert.equal(f.speed(), 1)
  report.push(`fast-forward from ${HANDOVER_T} s to -20 s takes ${(steps / 60).toFixed(0)} s of playback`)
  f.advance(1); near(f.t, -19, 1e-9, 'true time from -20')
  f.rate = 4; f.advance(1); near(f.t, -15, 1e-9, 'x4')
  f.seek(1e9); assert.equal(f.t, 732); f.advance(1); assert.equal(f.t, 732); assert.equal(f.ended, true)
  f.seek(-1e9); assert.equal(f.t, -8517)
}

// 11. The real 1972 Sun: the clock the flight sets is the track's, and the Sun the ephemeris gives at contact is the one in the file.
{
  const e = ephemerisAt(new Date(path.sample(725).utcMs))
  const ax = frameAxes(e, frameDef), d = e.sunDir
  const sun = new Vector3(d.dot(ax.east), d.dot(ax.north), d.dot(ax.up))
  const el = Math.asin(sun.z) * DEG, az = (Math.atan2(sun.x, sun.y) * DEG + 360) % 360
  report.push(`Sun at contact: ${el.toFixed(2)} deg up, azimuth ${az.toFixed(1)} (file: ${doc.sun.at_contact.sun_el_deg}, ${doc.sun.at_contact.sun_az_deg})`)
  near(el, doc.sun.at_contact.sun_el_deg, 0.1, 'Sun elevation'); near(az, doc.sun.at_contact.sun_az_deg, 0.3, 'Sun azimuth')
  assert.ok(az > 85 && az < 105, 'the Sun is in the east: the shadow points west')
}

console.log(report.join('\n'))
console.log('descent-flight.test: ok')

// 12. G2c: the camera is released at contact (725 s) and the module settles until 731 s; the low chase camera keeps the module's shadow in frame; the window pose.
{
  assert.equal(HANDOFF_T, 725, 'the free camera takes over at contact')
  assert.equal(SETTLE_END_T, 731)
  assert.ok(SETTLE_BLEND_S >= 2)
  // Shadow room: none high up, full close to the ground.
  near(shadowRoom(500), 0, 1e-12, 'no room high up'); near(shadowRoom(2), 1, 1e-12, 'full room low'); assert.ok(shadowRoom(30) > 0 && shadowRoom(30) < 1)
  // At 5 m the module's shadow (13.3 deg Sun; from the pad plane up to the top of a 7 m module) spans 5/tan to (5+7)/tan metres out: both it and the module are in the low chase frame.
  const sun = 13.3 * Math.PI / 180
  for (const alt of [5, 3, 1.5]) {
    const s = path.sample(725 - (alt > 4 ? 10 : alt > 2 ? 4.5 : 0))
    const lm = lmPoseOf(s, 0)
    const v = chaseView(lm, rs)
    const b = groundBasis(v), tan = v.tanHalf
    const inFrame = (p: Vector3): { x: number; y: number } => { const d = p.clone().sub(v.pos); const back = d.dot(b.back); return { x: d.dot(b.right) / -back, y: d.dot(b.up) / -back } }
    const near0 = lm.padZ / Math.tan(sun), far0 = (lm.padZ + 7) / Math.tan(sun)
    const at = (m: number): Vector3 => new Vector3(lm.pos.x + SHADOW_DIR.x * m, lm.pos.y + SHADOW_DIR.y * m, 0)
    const mid = inFrame(at((near0 + far0) / 2)), mod = inFrame(lm.pos)
    report.push(`chase at pad height ${lm.padZ.toFixed(1)} m: module x ${mod.x.toFixed(2)}, shadow middle (${((near0 + far0) / 2).toFixed(0)} m out) x ${mid.x.toFixed(2)}, half-field ${(tan * 1.777).toFixed(2)}`)
    assert.ok(Math.abs(mod.x) < tan * 1.777 && Math.abs(mid.x) < tan * 1.777, `module and shadow in the frame at ${alt} m`)
  }
  // Without the room (the G2b camera: 45 m off, 36 deg high, looking at the module) the middle of a 5 m module's shadow, about 30 m out, is beyond the frame's half-width there.
  {
    const halfWidthAt45 = 45 * Math.tan(18 * Math.PI / 180) * 16 / 9
    assert.ok((5 + 3.5) / Math.tan(sun) > halfWidthAt45, `shadow middle out of the old frame (half-width ${halfWidthAt45.toFixed(1)} m)`)
  }
  // The window: a look direction 40.6 deg outboard and 40.5 deg down, frame reaching 65 deg below the axis and starting at the centreline (TN D-7388).
  const [lx, ly, lz] = WINDOW.look, n = Math.hypot(lx, ly, lz)
  near(n, 1, 0.002, 'window look is a unit vector')
  near(Math.atan2(lx, lz) * DEG, 40.6, 0.2, 'outboard'); near(-Math.asin(ly / n) * DEG, 40.5, 0.2, 'down')
  near(-Math.asin(ly / n) * DEG + WINDOW.fovDeg / 2, 65, 1.1, 'bottom of the frame reaches 65 deg below the axis')
  near(Math.atan2(lx, lz) * DEG - Math.atan(Math.tan(WINDOW.fovDeg / 2 / DEG) * 16 / 9) * DEG, 1.1, 1.2, 'inboard edge near the centreline at 16:9')
}

// 13. Audit 6: the coast camera trails the module (80 m behind along the track, a little south and above) so the module is visible during the fast-forward; it is the 45 m chase from 20 s before ignition.
{
  near(coastK(-990), 1, 1e-12, 'full trailing pose in the coast'); near(coastK(-20), 0, 1e-12, 'in at 20 s before ignition'); near(coastK(0), 0, 1e-12, 'unchanged from ignition')
  const fl = new DescentFlight(path)
  for (const t of [-990, -700]) {
    fl.t = t
    const fr = fl.evaluate(envAt(t))
    const d = fr.view.pos.distanceTo(fr.lm.pos)
    const deg = 2 * Math.atan(4.5 / d) * DEG
    report.push(`coast camera at t ${t}: ${d.toFixed(0)} m from the module, which spans ${deg.toFixed(1)} deg of a ${(2 * Math.atan(fr.view.tanHalf) * DEG).toFixed(0)} deg field`)
    assert.ok(d < 200, `the module is near the camera at ${t} (${d} m)`)
    assert.ok(deg > 2.5, `the module is not a speck at ${t} (${deg} deg)`)
    // It trails: the camera is behind the module along its horizontal velocity.
    const up = localUp(fr.lm.pos, rs)
    const v = new Vector3(fr.sample.vel[0], fr.sample.vel[1], fr.sample.vel[2]); v.addScaledVector(up, -v.dot(up)).normalize()
    const off = fr.view.pos.clone().sub(fr.lm.pos)
    assert.ok(off.dot(v) < -60, `behind the module along the track at ${t}`)
    // Level with the local horizon: the module sits about 18 m under the camera along the local vertical, the horizon in the frame.
    assert.ok(Math.abs(off.dot(up) - CHASE_COAST.upM) < 1, `${off.dot(up)} m above the module along the local vertical at ${t}`)
  }
  // The camera closes in over the last 600 s, not the last 100 s: at -200 it is already nearer the module than at -990.
  { fl.t = -990; const far = fl.evaluate(envAt(-990)); fl.t = -200; const near200 = fl.evaluate(envAt(-200)); assert.ok(near200.view.pos.distanceTo(near200.lm.pos) < far.view.pos.distanceTo(far.lm.pos) * 0.6, 'closer well before ignition') }
  fl.t = 0
  const at0 = fl.evaluate(envAt(0))
  assert.ok(at0.view.pos.distanceTo(at0.lm.pos) < 60, 'the ordinary chase distance from ignition')
  assert.ok(CHASE_COAST.backM > CHASE_COAST.sideM)
}
