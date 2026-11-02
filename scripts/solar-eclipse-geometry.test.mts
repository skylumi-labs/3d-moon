/**
 * The solar-eclipse flight's honesty check: where the Moon's shadow falls on the Earth is computed from the app's own ephemeris, and at the greatest
 * eclipse of 2 Aug 2027 it lands where the real eclipse's path is (astronomy-engine's global eclipse search, and NASA's published point).
 *   npm test
 */
import assert from 'node:assert/strict'
import * as Astronomy from 'astronomy-engine'
import { Matrix3, Vector3 } from 'three'
import { ephemerisAt, type Ephemeris } from '../src/ephemeris.ts'
import { EARTH_R_KM, MOON_R_KM } from '../src/glsl/common.ts'
import { MOMENTS, SOLAR_ECLIPSE_2027_UTC } from '../src/moments.ts'
import { moonShadowOnEarth, type V3 } from '../src/lighting/shadowMath.ts'
import { getCinematicFlight, sampleCinematicFlight } from '../src/cinematics/flights.ts'
import { poseBasis } from '../src/camera/pose.ts'

const DEG = Math.PI / 180

/** Where the Sun-Moon line meets the Earth's (spherical) surface on the Moon's side: the shadow axis' foot, and its outward normal. */
function shadowFoot(e: Ephemeris): { normal: Vector3; pointKm: Vector3 } | null {
  const d = e.sunDir.clone().negate()
  const E = e.earthKm
  const b = d.dot(E)
  const disc = b * b - E.lengthSq() + EARTH_R_KM * EARTH_R_KM
  if (disc < 0) return null
  const t = b - Math.sqrt(disc)
  const pointKm = d.clone().multiplyScalar(t)
  return { normal: pointKm.clone().sub(E).divideScalar(EARTH_R_KM), pointKm }
}

/** Geodetic latitude and east longitude (deg) of a world-frame outward normal of the Earth. */
function geographic(e: Ephemeris, normal: Vector3): { lat: number; lon: number } {
  const body = normal.clone().applyMatrix3(new Matrix3().copy(e.earthToWorld).transpose())
  const geocentric = Math.asin(Math.max(-1, Math.min(1, body.z)))
  const flattening = 1 / 298.257223563
  return { lat: Math.atan(Math.tan(geocentric) / (1 - flattening) ** 2) / DEG, lon: Math.atan2(body.y, body.x) / DEG }
}

/** Great-circle separation of two geographic points, deg. */
function separationDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const la = a.lat * DEG, lb = b.lat * DEG, dl = (a.lon - b.lon) * DEG
  return 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin((lb - la) / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dl / 2) ** 2))) / DEG
}

// The real eclipse, from astronomy-engine's independent global search: a total eclipse in August 2027.
const info = Astronomy.SearchGlobalSolarEclipse(new Date('2027-07-01T00:00:00Z'))
assert.equal(info.kind, Astronomy.EclipseKind.Total, 'the next solar eclipse after July 2027 is the total one of 2 August')
assert.equal(info.peak.date.toISOString().slice(0, 10), '2027-08-02')
assert.ok(info.latitude !== undefined && info.longitude !== undefined, 'a total eclipse has a point of greatest eclipse')
const real = { lat: info.latitude as number, lon: info.longitude as number }
// NASA's published greatest eclipse (Espenak): 10:07:50 UT, 25 deg 31.5' N, 33 deg 09.6' E, near Luxor.
const nasa = { lat: 25 + 31.5 / 60, lon: 33 + 9.6 / 60 }
assert.ok(separationDeg(real, nasa) < 0.3, `astronomy-engine agrees with NASA's point (${separationDeg(real, nasa).toFixed(2)} deg)`)

// The moment's date is the greatest eclipse: within two minutes of the engine's peak.
const moment = MOMENTS.find((m) => m.id === 'solar-eclipse')!
assert.equal(moment.time().toISOString(), new Date(SOLAR_ECLIPSE_2027_UTC).toISOString())
assert.ok(Math.abs(moment.time().getTime() - info.peak.date.getTime()) < 120_000, `the moment is at the greatest eclipse (${(moment.time().getTime() - info.peak.date.getTime()) / 1000} s from the engine's peak)`)

// The app's own geometry. The ephemeris takes a spherical Earth and ignores precession (about 0.4 deg of longitude by 2027), so the
// tolerance is a degree (about 110 km; the path is 258 km wide, and the shadow centre moves about 0.5 km/s, so a minute of clock is 0.3 deg).
const TOL_DEG = 1
{
  const atPeak = ephemerisAt(info.peak.date)
  const foot = shadowFoot(atPeak)!
  assert.ok(foot, 'the shadow axis meets the Earth')
  const g = geographic(atPeak, foot.normal)
  assert.ok(separationDeg(g, real) < TOL_DEG, `the umbra centre at the engine's peak is at ${g.lat.toFixed(2)}N ${g.lon.toFixed(2)}E, ${separationDeg(g, real).toFixed(2)} deg from the engine's ${real.lat.toFixed(2)}N ${real.lon.toFixed(2)}E`)
  assert.ok(separationDeg(g, nasa) < TOL_DEG + 0.3, `and ${separationDeg(g, nasa).toFixed(2)} deg from NASA's point`)
}
const e = ephemerisAt(moment.time())
const foot = shadowFoot(e)!
{
  const g = geographic(e, foot.normal)
  assert.ok(separationDeg(g, nasa) < TOL_DEG + 0.5, `at the moment's own time the umbra centre is ${separationDeg(g, nasa).toFixed(2)} deg from NASA's point (${g.lat.toFixed(2)}N ${g.lon.toFixed(2)}E)`)
}

// The shader's model (its CPU mirror): dark at that point, the penumbra round it, full sunlight far away.
{
  const sun: V3 = [e.sunKm.x / MOON_R_KM, e.sunKm.y / MOON_R_KM, e.sunKm.z / MOON_R_KM]
  const moon: V3 = [0, 0, 0]
  const light = (normal: Vector3): number => {
    const p = e.earthKm.clone().addScaledVector(normal, EARTH_R_KM).divideScalar(MOON_R_KM)
    return moonShadowOnEarth([p.x, p.y, p.z], sun, moon)[1]
  }
  const along = (deg: number): Vector3 => {
    const axis = new Vector3().crossVectors(foot.normal, new Vector3(0, 0, 1)).normalize()
    return foot.normal.clone().applyAxisAngle(axis, deg * DEG)
  }
  assert.ok(light(foot.normal) < 0.01, `total shadow at the umbra centre (${light(foot.normal)})`)
  const l1 = light(along(3)), l10 = light(along(10)), l60 = light(along(60))
  assert.ok(l1 > 0 && l1 < l10 && l10 < 1, `the penumbra brightens outward (${l1.toFixed(3)}, ${l10.toFixed(3)})`)
  assert.ok(l60 > 0.999, 'full sunlight far from the shadow')
}

// The flight ends where that shadow can be seen: the umbra's foot faces the camera, well inside the disc, and inside the frame.
{
  const flight = getCinematicFlight('solar-eclipse')!
  const shot = sampleCinematicFlight(flight, 1, e, () => 1.0001, () => 0)
  const basis = poseBasis(e, shot.pose)
  const camKm = basis.back.clone().multiplyScalar(shot.pose.dist * MOON_R_KM)
  const toCam = camKm.clone().sub(e.earthKm).normalize()
  assert.ok(foot.normal.dot(toCam) > 0.5, `the umbra faces the final camera (cos ${foot.normal.dot(toCam).toFixed(2)})`)
  const toFoot = foot.pointKm.clone().sub(camKm).normalize()
  const toEarth = e.earthKm.clone().sub(camKm).normalize()
  const off = toFoot.angleTo(toEarth) / DEG
  const earthRadius = Math.asin(EARTH_R_KM / e.earthKm.clone().sub(camKm).length()) / DEG
  assert.ok(off < earthRadius, `the umbra is on the Earth's disc (${off.toFixed(2)} deg from its centre, disc radius ${earthRadius.toFixed(2)})`)
  assert.ok(off < shot.fovDeg / 2, 'and inside the frame of the last shot')
  // S1/T2: the umbra is big enough to see: the path is 258 km wide (NASA), and across the short side of a 1080 px frame at the final lens it is about 15 px.
  const camToFootKm = foot.pointKm.clone().sub(camKm).length()
  const umbraPx = (258 / camToFootKm) * 1080 / (2 * Math.tan(shot.fovDeg * DEG / 2))
  assert.ok(umbraPx >= 14, `the umbra is ${umbraPx.toFixed(1)} px wide at 1080 px (final lens ${shot.fovDeg} deg)`)
  assert.ok(earthRadius > 0.3 * shot.fovDeg / 2, 'and the Earth fills more than a third of the short side')
}
console.log('solar-eclipse-geometry: the shadow falls on the real eclipse path')
