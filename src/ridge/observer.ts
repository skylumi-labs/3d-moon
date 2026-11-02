import { Vector3 } from 'three'
import type { Ephemeris } from '../ephemeris'
import { EARTH_R_KM, MOON_R_KM } from '../glsl/common'

/**
 * The ridge view's observer: a place on the Earth's surface and the local frame there, in the world frame
 * (Moon-centred, J2000 axes, Moon radii). The Earth is a sphere of 6371 km here (the same as the rest of the
 * site), so a place's height is measured from that sphere, not from the geoid.
 */

export interface Site {
  name: string
  latDeg: number
  lonDeg: number
  /** Above the sphere, m. */
  heightM: number
}

/**
 * Moon-v1's `ridge` preset: the Alps, a waxing crescent 16% lit about 3.5 deg up in the evening twilight.
 * The place and the time are real; the ridge drawn there
 * is not (RidgePass).
 */
export const RIDGE_SITE: Site = { name: 'Swiss Alps, 46.5 N 8.0 E', latDeg: 46.5, lonDeg: 8.0, heightM: 1500 }
export const RIDGE_TIME = new Date('2026-10-14T17:36:00Z')

const DEG = Math.PI / 180

export interface Observer {
  site: Site
  /** The observer's position in the world frame, Moon radii. */
  pos: Vector3
  /** Local up, north and east as world unit vectors. */
  zenith: Vector3
  north: Vector3
  east: Vector3
}

/** The observer at `site` at the moment of `e` (the Earth's rotation is in `e.earthToWorld`). */
export function observerAt(e: Ephemeris, site: Site = RIDGE_SITE): Observer {
  const lat = site.latDeg * DEG, lon = site.lonDeg * DEG
  const up = new Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat))
  const east = new Vector3(-Math.sin(lon), Math.cos(lon), 0)
  const north = new Vector3(-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat))
  const zenith = up.clone().applyMatrix3(e.earthToWorld).normalize()
  const eastW = east.applyMatrix3(e.earthToWorld).normalize()
  const northW = north.applyMatrix3(e.earthToWorld).normalize()
  const centre = e.earthKm.clone().divideScalar(MOON_R_KM)
  const pos = centre.addScaledVector(zenith, (EARTH_R_KM + site.heightM / 1000) / MOON_R_KM)
  return { site, pos, zenith, north: northW, east: eastW }
}

/** Altitude (above the horizon, geometric) and azimuth (from north through east) of a world direction, deg. */
export function altAz(obs: Observer, dir: Vector3): { alt: number; az: number } {
  const d = dir.clone().normalize()
  const alt = Math.asin(Math.max(-1, Math.min(1, d.dot(obs.zenith)))) / DEG
  const az = Math.atan2(d.dot(obs.east), d.dot(obs.north)) / DEG
  return { alt, az: (az + 360) % 360 }
}

/** Where the Moon and the Sun stand for this observer. */
export function skyState(e: Ephemeris, obs: Observer): { moon: { alt: number; az: number }; sun: { alt: number; az: number } } {
  const moonDir = obs.pos.clone().negate()
  const sunDir = e.sunKm.clone().sub(e.earthKm)
  return { moon: altAz(obs, moonDir), sun: altAz(obs, sunDir) }
}
