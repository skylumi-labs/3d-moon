import * as Astro from 'astronomy-engine'
import { Matrix3, Vector3 } from 'three'
import { EARTH_R_KM } from './glsl/common'

/**
 * Where the Sun and the Earth are, seen from the Moon, and how the two
 * bodies are turned, for one moment (README, "Units and frames").
 *
 * Geocentric throughout: the site is not tied to an observer, so the opening
 * view is from the Earth's centre. Everything is in the world frame
 * (Moon-centred, J2000 mean equator, astronomy-engine's EQJ), lengths in km.
 */

/** Selenographic (or geographic) longitude east-positive and latitude, deg. */
export interface LonLat {
  lon: number
  lat: number
}

export interface Ephemeris {
  date: Date
  /** Moon to Sun, km, world frame. */
  sunKm: Vector3
  /** Moon to the Earth's centre, km, world frame. */
  earthKm: Vector3
  /** Moon body axes (IAU: +Z north pole, +X prime meridian) to world. */
  moonToWorld: Matrix3
  /** Earth body axes (+Z north pole, +X Greenwich) to world; precession ignored. */
  earthToWorld: Matrix3
  /** Unit vectors, Moon to Sun and Moon to Earth. */
  sunDir: Vector3
  earthDir: Vector3
  /** The Moon's body axes as world vectors (columns of moonToWorld). */
  moonX: Vector3
  moonY: Vector3
  moonZ: Vector3
  /** Sun-Moon-Earth angle, deg: the Moon's phase angle seen from the Earth's centre. */
  phaseDeg: number
  /** Share of the Moon's disc that is sunlit, seen from the Earth's centre. */
  illuminatedFraction: number
  /** Sun-Earth-Moon angle, deg: the Earth's phase angle seen from the Moon. */
  earthPhaseDeg: number
  /** The points on the Moon under the Sun and under the Earth (libration). */
  subSolar: LonLat
  subEarth: LonLat
  /**
   * Earthlight on the Moon over sunlight on the Moon, both at normal
   * incidence. Modelled: the Earth as a Lambert sphere of geometric albedo
   * 0.3 (the real value swings with its clouds by about +-20%).
   */
  earthshine: number
}

const DEG = Math.PI / 180
/** The Earth's geometric albedo in the earthshine model (moon-v1's value). */
export const EARTH_GEOMETRIC_ALBEDO = 0.3

function vec(v: Astro.Vector, scale = 1): Vector3 {
  return new Vector3(v.x * scale, v.y * scale, v.z * scale)
}

/** Longitude and latitude of a world direction in a body frame (x, y, z axes as world vectors). */
export function bodyLonLat(dir: Vector3, x: Vector3, y: Vector3, z: Vector3): LonLat {
  const d = dir.clone().normalize()
  return {
    lon: Math.atan2(d.dot(y), d.dot(x)) / DEG,
    lat: Math.asin(Math.max(-1, Math.min(1, d.dot(z)))) / DEG,
  }
}

/**
 * Lunar body axes in EQJ from the IAU (WGCCRE) pole and spin angle, as
 * astronomy-engine's RotationAxis evaluates them: the same construction as
 * moon-v1's moonAxesEqj and scripts/demos/build-moon-geometry.mjs.
 */
function moonAxes(time: Astro.AstroTime): { x: Vector3; y: Vector3; z: Vector3 } {
  const axis = Astro.RotationAxis(Astro.Body.Moon, time)
  const a0 = axis.ra * 15 * DEG
  const d0 = axis.dec * DEG
  const w = axis.spin * DEG
  const z = new Vector3(Math.cos(d0) * Math.cos(a0), Math.cos(d0) * Math.sin(a0), Math.sin(d0))
  // Ascending node of the lunar equator on the J2000 equator; the prime
  // meridian is W from it, measured eastward along the lunar equator.
  const node = new Vector3(-Math.sin(a0), Math.cos(a0), 0)
  const nodeQ = new Vector3().crossVectors(z, node)
  const x = node.clone().multiplyScalar(Math.cos(w)).addScaledVector(nodeQ, Math.sin(w)).normalize()
  const y = new Vector3().crossVectors(z, x)
  return { x, y, z }
}

/** A Lambert sphere's phase law, 1 at zero phase (the Earth in the earthshine model). */
function lambertPhase(alpha: number): number {
  return (Math.sin(alpha) + (Math.PI - alpha) * Math.cos(alpha)) / Math.PI
}

export function ephemerisAt(date: Date): Ephemeris {
  const time = Astro.MakeTime(date)
  // Geometric Moon (its light-time is 1.3 s); the Sun as the Earth sees it,
  // with light-time and aberration, as moon-v1's table took it (the
  // difference from the Moon's own view is under an arcminute).
  const geoMoonKm = vec(Astro.GeoMoon(time), Astro.KM_PER_AU)
  const geoSunKm = vec(Astro.GeoVector(Astro.Body.Sun, time, true), Astro.KM_PER_AU)
  const earthKm = geoMoonKm.clone().negate()
  const sunKm = geoSunKm.clone().sub(geoMoonKm)
  const sunDir = sunKm.clone().normalize()
  const earthDir = earthKm.clone().normalize()

  const { x, y, z } = moonAxes(time)
  const moonToWorld = new Matrix3().set(
    x.x, y.x, z.x,
    x.y, y.y, z.y,
    x.z, y.z, z.z,
  )

  // Earth rotation about the J2000 pole by Greenwich apparent sidereal time
  // (the README's contract: precession, 0.36 deg by 2026, is ignored).
  const theta = Astro.SiderealTime(time) * 15 * DEG
  const c = Math.cos(theta), s = Math.sin(theta)
  const earthToWorld = new Matrix3().set(
    c, -s, 0,
    s, c, 0,
    0, 0, 1,
  )

  const phaseDeg = sunDir.angleTo(earthDir) / DEG
  // The Earth's phase angle seen from the Moon is the angle at the Earth
  // between the Sun and the Moon: small at a crescent Moon (a nearly full
  // Earth), near 180 deg at full Moon.
  const earthPhase = geoSunKm.angleTo(geoMoonKm)
  // Earthlight relative to sunlight at the Moon: albedo x phase law x the
  // Earth's solid angle, times the Earth's sunlight over the Moon's (their
  // distances from the Sun differ by up to 0.3%).
  const dE = earthKm.length()
  const sunAtEarth = (sunKm.length() / geoSunKm.length()) ** 2
  const earthshine = EARTH_GEOMETRIC_ALBEDO * lambertPhase(earthPhase) * (EARTH_R_KM / dE) ** 2 * sunAtEarth

  return {
    date: new Date(date.getTime()),
    sunKm,
    earthKm,
    moonToWorld,
    earthToWorld,
    sunDir,
    earthDir,
    moonX: x,
    moonY: y,
    moonZ: z,
    phaseDeg,
    illuminatedFraction: (1 + Math.cos(phaseDeg * DEG)) / 2,
    earthPhaseDeg: earthPhase / DEG,
    subSolar: bodyLonLat(sunDir, x, y, z),
    subEarth: bodyLonLat(earthDir, x, y, z),
    earthshine,
  }
}

const OBLIQUITY_J2000 = 23.4392911 * DEG
/**
 * Whether the Moon is waxing (its ecliptic longitude is 0 to 180 degrees ahead of the Sun's), read off an ephemeris already computed. It
 * replaces astronomy-engine's `MoonPhase(date)`, which the HUD called every frame and which re-derives both bodies (about 2.6 times the cost of
 * `ephemerisAt` itself). Longitudes are J2000 for both bodies, so the sign of their difference is MoonPhase's.
 */
export function isWaxing(e: Pick<Ephemeris, 'sunKm' | 'earthKm'>): boolean {
  const eclLon = (x: number, y: number, z: number): number => Math.atan2(y * Math.cos(OBLIQUITY_J2000) + z * Math.sin(OBLIQUITY_J2000), x)
  // earthKm is the Moon-to-Earth vector, so the geocentric Moon is its negative; the geocentric Sun is the Moon-to-Sun vector plus the geocentric Moon.
  const lm = eclLon(-e.earthKm.x, -e.earthKm.y, -e.earthKm.z)
  const ls = eclLon(e.sunKm.x - e.earthKm.x, e.sunKm.y - e.earthKm.y, e.sunKm.z - e.earthKm.z)
  const d = ((lm - ls) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
  return d > 0 && d < Math.PI
}
