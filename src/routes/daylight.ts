import { ephemerisAt, type Ephemeris } from '../ephemeris'

/**
 * Daylight for a fly-along. A route's approach runs the clock forward, continuously, to a time at which the site is lit by the same
 * Sun the photograph was taken under, so the Sun moves in the frame and nothing is cross-faded (owner rule: one continuous flight).
 * Pure apart from the ephemeris; scripts/daylight.test.mts drives it.
 */
const DEG = Math.PI / 180
export interface SunAt { elDeg: number; azDeg: number }

/** The Sun's elevation and azimuth (degrees east of north) at a selenographic point, from an ephemeris. */
export function sunAtSite(lon: number, lat: number, e: Ephemeris): SunAt {
  const cl = Math.cos(lat * DEG), sl = Math.sin(lat * DEG), cn = Math.cos(lon * DEG), sn = Math.sin(lon * DEG)
  const comp = (k: 'x' | 'y' | 'z'): { up: number; east: number; north: number } => ({
    up: e.moonX[k] * cl * cn + e.moonY[k] * cl * sn + e.moonZ[k] * sl,
    east: -e.moonX[k] * sn + e.moonY[k] * cn,
    north: -sl * (e.moonX[k] * cn + e.moonY[k] * sn) + e.moonZ[k] * cl,
  })
  const x = comp('x'), y = comp('y'), z = comp('z')
  const s = e.sunDir
  const up = s.x * x.up + s.y * y.up + s.z * z.up
  const east = s.x * x.east + s.y * y.east + s.z * z.east
  const north = s.x * x.north + s.y * y.north + s.z * z.north
  return { elDeg: Math.asin(Math.max(-1, Math.min(1, up))) / DEG, azDeg: ((Math.atan2(east, north) / DEG) + 360) % 360 }
}

/** Angle on the sky between two Sun positions, degrees. */
export function sunSeparation(a: SunAt, b: SunAt): number {
  const ae = a.elDeg * DEG, be = b.elDeg * DEG, da = (a.azDeg - b.azDeg) * DEG
  return Math.acos(Math.max(-1, Math.min(1, Math.sin(ae) * Math.sin(be) + Math.cos(ae) * Math.cos(be) * Math.cos(da)))) / DEG
}

/** The Sun a patch was photographed under, at its site. */
export function photoSun(lon: number, lat: number, photoTime: string): SunAt {
  return sunAtSite(lon, lat, ephemerisAt(new Date(photoTime)))
}

const DAY_MS = 86_400_000
/** A synodic month: the Sun returns to the same place in the site's sky once in this long. */
export const SYNODIC_MS = 29.530588 * DAY_MS
/** A lit site is left alone when its Sun is this close to the photograph's, degrees. */
export const SUN_MATCH_DEG = 12
/** Elevation below which the site counts as dark (the picture shows little), degrees. */
export const DARK_EL_DEG = 3

/**
 * The clock for a route over a site: null when the site is lit now by about the photograph's Sun, else the EARLIEST time within the next
 * month at which the Sun is within 2 degrees of the best match, refined to a minute. The clock only ever runs forward.
 */
export function daylightTarget(lon: number, lat: number, from: Date, photo: SunAt): { to: Date; sun: SunAt; errDeg: number } | null {
  const now = sunAtSite(lon, lat, ephemerisAt(from))
  if (now.elDeg >= DARK_EL_DEG && sunSeparation(now, photo) <= SUN_MATCH_DEG) return null
  const STEP = 3_600_000
  const t0 = from.getTime()
  const scored: Array<{ t: number; err: number }> = []
  for (let t = t0; t <= t0 + SYNODIC_MS; t += STEP) scored.push({ t, err: sunSeparation(sunAtSite(lon, lat, ephemerisAt(new Date(t))), photo) })
  const best = Math.min(...scored.map((s) => s.err))
  const first = scored.find((s) => s.err <= best + 2) as { t: number; err: number }
  // Refine to the minute around the hour found (the Sun moves 0.5 degree an hour at most).
  let bt = first.t, be = first.err
  for (let t = first.t - STEP; t <= first.t + STEP; t += 60_000) {
    if (t < t0) continue
    const err = sunSeparation(sunAtSite(lon, lat, ephemerisAt(new Date(t))), photo)
    if (err < be) { be = err; bt = t }
  }
  const to = new Date(bt)
  return { to, sun: sunAtSite(lon, lat, ephemerisAt(to)), errDeg: be }
}

/** The clock at progress u (0 to 1) of the approach: a smooth ease from `from` to `to`, so the Sun starts and stops gently. */
export function lapseClockMs(fromMs: number, toMs: number, u: number): number {
  const t = Math.max(0, Math.min(1, u))
  return fromMs + (toMs - fromMs) * (t * t * (3 - 2 * t))
}

/** How long the approach takes when the clock must cover `days`: at most about 4 days a second, never under 5 s, never over 12 s. */
export function lapseApproachMs(days: number): number {
  return Math.round(Math.max(5000, Math.min(12000, (Math.abs(days) / 4) * 1000)))
}
