import { type Ephemeris, ephemerisAt } from './ephemeris'

/**
 * Where and when the Sun is low: a lunar morning over a point or over a whole flight route. Pure (the ephemeris is the only input), so
 * the dates of the viewpoints that need long shadows are computed, not typed in, and a test can check them.
 */
const DEG = Math.PI / 180

export interface LonLat { lon: number; lat: number }

/** The Sun's elevation over a selenographic point at an ephemeris, degrees. */
export function sunElevationDeg(e: Ephemeris, lon: number, lat: number): number {
  const s = e.subSolar
  const sin = Math.sin(lat * DEG) * Math.sin(s.lat * DEG) + Math.cos(lat * DEG) * Math.cos(s.lat * DEG) * Math.cos((lon - s.lon) * DEG)
  return Math.asin(Math.max(-1, Math.min(1, sin))) / DEG
}

/** The lowest and the highest Sun elevation over a set of points at an ephemeris, degrees. */
export function routeSunRange(e: Ephemeris, points: ReadonlyArray<LonLat>): { min: number; max: number } {
  let min = Infinity, max = -Infinity
  for (const p of points) {
    const el = sunElevationDeg(e, p.lon, p.lat)
    if (el < min) min = el
    if (el > max) max = el
  }
  return { min, max }
}

/**
 * The next time after `from` that the Sun over EVERY point of a route is at least `minElDeg` above the horizon and still rising: the
 * lunar morning for the whole route (its darkest point is the one the terminator has just left). Found by stepping 3 h through the next
 * two lunations and bisecting the crossing. Returns `from` when there is none (a route that never gets that much Sun).
 */
export function nextRouteMorning(points: ReadonlyArray<LonLat>, minElDeg: number, from = new Date()): Date {
  const STEP = 3 * 3600_000
  const el = (t: number): number => routeSunRange(ephemerisAt(new Date(t)), points).min
  let t0 = from.getTime(), e0 = el(t0)
  for (let i = 0; i < 2 * 30 * 8; i++) {
    const t1 = t0 + STEP, e1 = el(t1)
    if (e0 < minElDeg && e1 >= minElDeg) {
      let lo = t0, hi = t1
      for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2; if (el(mid) < minElDeg) lo = mid; else hi = mid }
      return new Date(hi)
    }
    t0 = t1; e0 = e1
  }
  return from
}

/** The next time the Sun stands `elDeg` above the horizon over a point and is still rising (a lunar morning at a crater). */
export function nextMorning(lon: number, lat: number, elDeg: number, from = new Date()): Date {
  return nextRouteMorning([{ lon, lat }], elDeg, from)
}

/** A morning date is found once and kept for an hour: the search steps through a month. */
const kept = new Map<string, { at: number; t: Date }>()
export function keptMorning(key: string, find: () => Date, now = Date.now()): Date {
  const k = kept.get(key)
  if (k && now - k.at < 3600_000) return k.t
  const t = find()
  kept.set(key, { at: now, t })
  return t
}
