/* eslint-disable @typescript-eslint/no-explicit-any -- JSON doc and quaternion casts are untyped test fixtures */
/**
 * The Apollo 17 descent reference track (G2A): data/apollo17/descent-track.json. Offline, reads the committed JSON and the waypoint file.
 * Regenerate with `python3 cloud/g2a/build_descent.py && npx tsx scripts/emit-descent-sun.mts`.
 *   npx tsx scripts/descent-track.test.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { Vector3 } from 'three'
import { ephemerisAt } from '../src/ephemeris.ts'

const doc = JSON.parse(fs.readFileSync(new URL('../data/apollo17/descent-track.json', import.meta.url), 'utf8'))
const wp = JSON.parse(fs.readFileSync(new URL('../cloud/g2a/waypoints.json', import.meta.url), 'utf8'))
const p = doc.powered
const n: number = p.t_s.length
const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`)
const hms = (s: string) => s.split(':').reduce((a, x) => a * 60 + Number(x), 0)
const IGN = hms(wp.clock.ignition_alsj)
const FT = 0.3048

// 1. Shape: every column has one entry per second; provenance and band arrays exist for every group and use only the four codes.
{
  assert.equal(n, 733)
  for (const k of ['t_s', 'get_mr_s', 'get_alsj_s', 'utc', 'alt_m', 'pad_alt_m', 'E_m', 'N_m', 'U_m', 'vE_ms', 'vN_ms', 'vU_ms', 'v_ground_ms', 'psi_deg', 'yaw_left_deg', 'quat_wxyz', 'heading_deg', 'nose_elev_deg', 'thrust_N', 'throttle_of_ftp', 'mass_kg', 'engine', 'dust_index']) assert.equal(p[k].length, n, k)
  for (const g of ['alt', 'vv', 'vh', 'pos', 'att', 'thr', 'dust']) {
    assert.equal(p.prov[g].length, n, `prov.${g}`)
    for (const c of p.prov[g]) assert.ok('VRIE'.includes(c) && c.length === 1, `prov code ${c}`)
  }
  for (const g of ['alt_m', 'v_horizontal_ms', 'pos_E_m', 'pos_N_m', 'att_deg']) { assert.equal(p.unc[g].length, n, `unc.${g}`); assert.ok(p.unc[g].every((x: number) => x >= 0 && Number.isFinite(x))) }
  assert.ok(doc.estimated_or_unknown.length >= 5)
}

// 2. Clocks: contact at 113:01:58 ALSJ = 110:21:58 MR = 19:54:58 UTC; ignition 725 s earlier; the ALSJ clock is 2:40 ahead.
{
  assert.equal(p.t_s[725], 725)
  assert.equal(p.get_alsj_s[725], hms('113:01:58'))
  assert.equal(p.get_mr_s[725], hms('110:21:58'))
  assert.equal(Date.parse(p.utc[725]), Date.parse('1972-12-11T19:54:58Z'))
  assert.equal(Date.parse(p.utc[0]), Date.parse('1972-12-11T19:42:53Z'))
  for (const i of [0, 300, 725]) assert.equal(p.get_alsj_s[i] - p.get_mr_s[i], 9600)
}

// 3. Touchdown lands on the LM: the frame origin is the Haase LM position (+ patch shift); the track ends there, at rest, probes on the ground.
{
  near(p.E_m[725], 0, 0.5, 'E at contact'); near(p.N_m[725], 0, 0.5, 'N at contact'); near(p.alt_m[725], 0, 0.01, 'alt at contact')
  near(p.v_ground_ms[725], 0, 1.0, 'ground speed at contact')
  assert.ok(Math.abs(p.vU_ms[724]) < 1.2, 'contact descent rate under about 4 ft/s')
  for (let i = 730; i < n; i++) { assert.equal(p.E_m[i], 0); assert.equal(p.N_m[i], 0) }
  near(p.pad_alt_m[731], 0, 0.001, 'pads on the ground after the fall')
  near(p.pad_alt_m[726], doc.dust_and_contact.contact_probes_m, 1e-6, 'pad plane hangs on the probes until engine stop')
  // documented conflict: the Mission Report photomap position sits about 0.8 km SSW of the Haase position, so it cannot serve as the check
  const [la, lo] = [20.165278, 30.765833], [lb, lob] = [20.1909097, 30.7716815]
  const dN = (lb - la) * 30323.0, dE = (lob - lo) * 30323.0 * Math.cos(20.18 * Math.PI / 180)
  assert.ok(Math.hypot(dN, dE) > 700 && Math.hypot(dN, dE) < 900, 'MR photomap vs Haase distance')
  // the aim point: 60 m north of the LM until the first redesignation (the ground-rotation term adds a few tens of metres)
  near(p.N_m[560], 60, 40, 'N before the redesignations')
  assert.equal(doc.touchdown.target_offset_records.used_in_track[0], 230)
}

// 4. Verified altitude waypoints: the track passes through every V point within its own band, and never rises after the first 95 s.
{
  let nV = 0
  for (const w of wp.altitude_ft) {
    if (w.h_ft === null || w.prov !== 'V') continue
    const i = hms(w.clk) - IGN
    near(p.alt_m[i], w.h_ft * FT, 15.0, `alt at ${w.clk} (Gaussian smoothing of the spline moves it a few metres, inside every stated band)`); assert.equal(p.prov.alt[i], 'V'); nV++
  }
  assert.ok(nV >= 15)
  for (let i = 100; i < 725; i++) assert.ok(p.alt_m[i + 1] <= p.alt_m[i] + 1e-6, `altitude rises at ${i}`)
  near(p.alt_m[0], 18738, 5, 'PDI altitude above the site')
}

// 5. Continuity: no velocity jump (accelerations stay under the thrust limit and change smoothly), and positions integrate the velocities.
{
  let maxA = 0, maxJ = 0, maxPos = 0
  let prev: number[] | null = null
  for (let i = 0; i < 731; i++) {
    const a = [p.vE_ms[i + 1] - p.vE_ms[i], p.vN_ms[i + 1] - p.vN_ms[i], p.vU_ms[i + 1] - p.vU_ms[i]]
    maxA = Math.max(maxA, Math.hypot(a[0], a[1], a[2]))
    if (prev) maxJ = Math.max(maxJ, Math.hypot(a[0] - prev[0], a[1] - prev[1], a[2] - prev[2]))
    prev = a
    if (i < 725) maxPos = Math.max(maxPos, Math.hypot(p.E_m[i + 1] - p.E_m[i] - (p.vE_ms[i] + p.vE_ms[i + 1]) / 2, p.U_m[i + 1] - p.U_m[i] - (p.vU_ms[i] + p.vU_ms[i + 1]) / 2))
  }
  assert.ok(maxA < 6.5, `acceleration step ${maxA} m/s^2 (thrust 4.9 plus gravity 1.6 bound it)`)
  assert.ok(maxJ < 2.5, `jerk ${maxJ}`)
  assert.ok(maxPos < 2.0, `position vs velocity mismatch ${maxPos} m`)
  assert.ok(doc.checks.max_accel_ms2 < 6.5)
}

// 6. Physics closure against the Mission Report: the delta-v (6698 ft/s), propellant (18,248.9 lb) and the verified descent rates.
{
  const c = doc.checks
  near(c.delta_v_model_mps, c.delta_v_mr_mps, 25, 'delta-v')
  near(c.propellant_model_kg, c.propellant_mr_kg, 60, 'propellant')
  near(c.isp_derived_s, 304, 8, 'derived Isp against the published DPS value')
  assert.ok(c.vertical_accel_residual_rms_ms2 < 0.7)
  for (const r of c.rates_check) near(r.track_down_fps, r.reported_down_fps, r.h_ft === 400 ? 6 : 3, `descent rate at ${r.h_ft} ft`)
  near(c.distance_to_site_km['112:58:40'], (c.distance_reads_km['112:58:40'][0] + c.distance_reads_km['112:58:40'][1]) / 2, 1.0, 'distance at 5 miles east')
  const d55 = c.distance_to_site_km['112:55:59'], r55 = c.distance_reads_km['112:55:59']
  assert.ok(d55 >= r55[0] - 2 && d55 <= r55[1] + 6, `distance at 40 miles east ${d55}`)
  assert.ok(c.distance_to_site_km.pdi > 480 && c.distance_to_site_km.pdi < 560, 'PDI about 18 deg of longitude east')
  assert.ok(doc.checks.ensemble.length >= 8)
}

// 7. Events and engine states: minimum throttle 28 s, full to 447 s, throttled after, off at 727; thrust never above the full-throttle value.
{
  assert.equal(p.engine[10], 'minimum'); assert.equal(p.engine[100], 'full'); assert.equal(p.engine[500], 'throttled'); assert.equal(p.engine[730], 'off')
  const full = p.thrust_N[100]
  assert.ok(p.thrust_N.every((x: number) => x <= full + 1))
  near(p.throttle_of_ftp[10], 0.108, 0.01, 'minimum throttle fraction')
  const ev = new Map(doc.events.map((e: any) => [e.clk_alsj, e.t_s]))
  assert.equal(ev.get('112:50:21'), 28); assert.equal(ev.get('112:57:19'), 446); assert.equal(ev.get('113:01:58'), 725)
  for (let i = 1; i < n; i++) assert.ok(p.mass_kg[i] <= p.mass_kg[i - 1] + 1e-9)
}

// 8. Attitude: unit quaternions, ALSJ pitch waypoints reproduced, forward axis west at touchdown, resting attitude 4.5 deg nose up.
{
  for (const q of p.quat_wxyz) near(Math.hypot(...(q as number[])), 1, 2e-4, 'unit quaternion')
  for (const w of wp.pitch_deg) near(p.psi_deg[hms(w.clk) - IGN], w.psi, 0.01, `pitch at ${w.clk}`)
  near(p.yaw_left_deg[0], 70, 0.01, 'yaw at ignition'); near(p.yaw_left_deg[300], 20, 0.01, 'yaw after the maneuver'); near(p.yaw_left_deg[420], 0, 0.01, 'yaw at windows up')
  near(p.heading_deg[700], 270, 3, 'approach heading west')
  near(p.nose_elev_deg[731], 4.5, 0.6, 'resting attitude nose up (MR 4 to 5 deg)')
  // the quaternion carries the same forward axis as heading / elevation: forward = q * (1,0,0)
  const [w, x, y, z] = p.quat_wxyz[300]
  const f = new Vector3(1, 0, 0).applyQuaternion({ w, x, y, z } as any)
  near((Math.atan2(f.x, f.y) * 180 / Math.PI + 360) % 360, p.heading_deg[300], 0.05, 'forward bearing from the quaternion')
  near(Math.asin(f.z) * 180 / Math.PI, p.nose_elev_deg[300], 0.05, 'forward elevation from the quaternion')
}

// 9. Sun and Earth: recomputed here with the app ephemeris and compared with sun{}. At contact: Sun about 13 deg up in the east, shadow west.
{
  const cfg = JSON.parse(fs.readFileSync(new URL('./sites.json', import.meta.url), 'utf8')).a17
  const lon = cfg.site.lon * Math.PI / 180, lat = cfg.site.lat * Math.PI / 180
  const e = ephemerisAt(new Date(doc.clock.landing_utc))
  const up = new Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)).applyMatrix3(e.moonToWorld)
  const el = Math.asin(e.sunDir.dot(up)) * 180 / Math.PI
  const c = doc.sun.at_contact
  near(c.sun_el_deg, el, 0.01, 'sun elevation in the JSON vs the ephemeris')
  assert.ok(el > 12.5 && el < 14.5, `Sun ${el} deg (brief: about 14 deg)`)
  assert.ok(c.sun_az_deg > 90 && c.sun_az_deg < 100, 'Sun in the east')
  assert.ok(c.shadow_direction_bearing_deg > 270 && c.shadow_direction_bearing_deg < 282, 'shadow points west')
  const L = doc.sun.shadow_of_H_m.length_m
  assert.ok(L > 28 && L < 31, `shadow of the 7.04 m module ${L} m; ALSJ says about 100 ft`)
  assert.ok(doc.sun.samples.length > 20 && doc.sun.orbit_segments.length === 2)
}

// 10. Orbit segments: coarse, before PDI, two-body; the descent orbit keeps the Mission Report elements (59.6 by 6.2 nmi).
{
  const seg = doc.orbit_segments
  assert.equal(seg[1].name, 'descent-orbit')
  near(seg[1].perilune_km, 6.2 * 1.852, 0.3, 'perilune of the descent orbit'); near(seg[1].apolune_km, 59.6 * 1.852, 0.3, 'apolune')
  assert.equal(seg[1].t_end, 0)
  assert.ok(seg[0].t_end < seg[1].t_start + 2)
  const last = seg[1].rows[seg[1].rows.length - 1]
  assert.ok(Math.abs(last[1] - p.E_m[0]) < 4e4, 'the orbit segment reaches the start of the powered track')
}
console.log('descent-track.test.mts: ok')
