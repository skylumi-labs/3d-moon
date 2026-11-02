import { Vector3 } from 'three'
import type { Ephemeris } from '../ephemeris'
import type { ViewCamera } from '../camera/pose'

/**
 * The site-local metre frame of ground mode (G1).
 *
 * Origin: a point on the Moon (the lunar module, see lm/site17.ts), on the sphere of radius
 * R_M + h0M, where h0M is the ground there. Axes: east, north, up of that point. Everything the
 * ground camera and the ground shader do is in metres in this frame and in float64 on the CPU:
 * a camera 1.7 m over the ground is (e, n, u) = (few m, few m, 1.7 + few m) instead of
 * 1.0000009 Moon radii, where float32 steps 0.2 m. The shader only ever sees numbers of at most
 * a few kilometres (2 mm steps at 20 km).
 *
 * The surface is a sphere: a point at horizontal distance rho from the origin lies rho^2 / 2R
 * below the tangent plane. That drop (curvature) is added where the ground is defined, in
 * `groundZ`, so the frame is exact to third order (a 3 km horizon is 2.6 m of drop, 20 km is 115 m).
 */

export const R_M = 1737400
const DEG = Math.PI / 180

export interface SiteFrame {
  lonDeg: number
  latDeg: number
  /** Ground height of the origin above the 1737.4 km sphere, metres (the patch's heights are on that sphere). */
  h0M: number
  /** Unit vectors east, north, up of the origin in the Moon body frame. */
  east: Vector3
  north: Vector3
  up: Vector3
}

export function makeSiteFrame(lonDeg: number, latDeg: number, h0M: number): SiteFrame {
  const lon = lonDeg * DEG, lat = latDeg * DEG
  return {
    lonDeg, latDeg, h0M,
    east: new Vector3(-Math.sin(lon), Math.cos(lon), 0),
    north: new Vector3(-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)),
    up: new Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)),
  }
}

/** The frame's axes in the world frame for one moment, and the origin's radius in Moon radii. */
export interface FrameAxes {
  east: Vector3
  north: Vector3
  up: Vector3
  /** Origin radius from the Moon's centre, Moon radii. */
  r0: number
}

function toWorld(e: Ephemeris, b: Vector3): Vector3 {
  return new Vector3().addScaledVector(e.moonX, b.x).addScaledVector(e.moonY, b.y).addScaledVector(e.moonZ, b.z)
}

export function frameAxes(e: Ephemeris, f: SiteFrame): FrameAxes {
  return { east: toWorld(e, f.east), north: toWorld(e, f.north), up: toWorld(e, f.up), r0: 1 + f.h0M / R_M }
}

/** World point (Moon radii from the centre) to frame metres (east, north, up). Float64 throughout. */
export function enuOfWorld(a: FrameAxes, p: Vector3): Vector3 {
  return new Vector3(R_M * p.dot(a.east), R_M * p.dot(a.north), R_M * (p.dot(a.up) - a.r0))
}

/** Frame metres to the world point in Moon radii (the exact inverse of enuOfWorld). */
export function worldOfEnu(a: FrameAxes, v: Vector3): Vector3 {
  return new Vector3()
    .addScaledVector(a.east, v.x / R_M)
    .addScaledVector(a.north, v.y / R_M)
    .addScaledVector(a.up, a.r0 + v.z / R_M)
}

/** A direction: world to frame (rotation only). */
export function enuDir(a: FrameAxes, d: Vector3): Vector3 {
  return new Vector3(d.dot(a.east), d.dot(a.north), d.dot(a.up))
}
export function worldDir(a: FrameAxes, d: Vector3): Vector3 {
  return new Vector3().addScaledVector(a.east, d.x).addScaledVector(a.north, d.y).addScaledVector(a.up, d.z)
}

/** The tangent plane's height (metres) of the ground at horizontal offset (e, n) whose height over the 1737.4 km sphere is `hM`. */
export function groundZ(f: SiteFrame, e: number, n: number, hM: number): number {
  return hM - f.h0M - (e * e + n * n) / (2 * (R_M + f.h0M))
}

/** East and north offsets in metres of (lon, lat) from another point, on the tangent plane (small distances). */
export function offsetEN(lon0: number, lat0: number, lon: number, lat: number): [number, number] {
  const wrap = ((lon - lon0 + 540) % 360) - 180
  return [wrap * DEG * Math.cos(lat0 * DEG) * R_M, (lat - lat0) * DEG * R_M]
}

/** The point east/north metres from (lon, lat), on the tangent plane (small distances). */
export function lonLatAtOffset(lon0: number, lat0: number, e: number, n: number): { lon: number; lat: number } {
  return { lon: lon0 + e / (R_M * Math.cos(lat0 * DEG)) / DEG, lat: lat0 + n / R_M / DEG }
}

/**
 * A camera in the frame: position (metres), heading (deg from north, clockwise), pitch (deg above
 * the horizon), roll (deg, clockwise seen from behind), and the tangent of the vertical half-field.
 */
export interface GroundView {
  pos: Vector3
  headingDeg: number
  pitchDeg: number
  rollDeg: number
  tanHalf: number
}

/** The camera's basis in frame metres: right, up, back (the view looks along -back). */
export function groundBasis(g: Pick<GroundView, 'headingDeg' | 'pitchDeg' | 'rollDeg'>): { right: Vector3; up: Vector3; back: Vector3 } {
  const h = g.headingDeg * DEG, p = g.pitchDeg * DEG, r = g.rollDeg * DEG
  const fwd = new Vector3(Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p))
  const right0 = new Vector3(Math.cos(h), -Math.sin(h), 0)
  // right x up = back, so up = back x right, with back = -fwd.
  const up0 = new Vector3().crossVectors(fwd.clone().negate(), right0)
  // Roll about the view axis: clockwise seen from behind lowers the right side.
  const right = right0.clone().multiplyScalar(Math.cos(r)).addScaledVector(up0, -Math.sin(r))
  const up = up0.clone().multiplyScalar(Math.cos(r)).addScaledVector(right0, Math.sin(r))
  return { right, up, back: fwd.negate() }
}

/** Heading, pitch and roll of a basis given in frame metres (the inverse of groundBasis). */
export function anglesOfBasis(right: Vector3, up: Vector3, back: Vector3): { headingDeg: number; pitchDeg: number; rollDeg: number } {
  const fwd = back.clone().negate()
  const pitch = Math.asin(Math.max(-1, Math.min(1, fwd.z)))
  // Looking (nearly) straight up or down the heading is the direction the top of the frame points.
  const h = Math.abs(fwd.z) > 0.999999 ? Math.atan2(-up.x * Math.sign(fwd.z), -up.y * Math.sign(fwd.z)) : Math.atan2(fwd.x, fwd.y)
  const b = groundBasis({ headingDeg: h / DEG, pitchDeg: pitch / DEG, rollDeg: 0 })
  // Roll: the angle from the level basis' right/up to the actual ones, about the view axis.
  const roll = Math.atan2(-right.dot(b.up), right.dot(b.right))
  return { headingDeg: h / DEG, pitchDeg: pitch / DEG, rollDeg: roll / DEG }
}

/** A world-frame camera (what every other pass takes) to the ground view. */
export function groundFromView(a: FrameAxes, cam: ViewCamera): GroundView {
  const right = enuDir(a, cam.right), up = enuDir(a, cam.up), back = enuDir(a, cam.back)
  return { pos: enuOfWorld(a, cam.pos), ...anglesOfBasis(right, up, back), tanHalf: cam.tanHalf }
}

/** The ground view as a world-frame camera. */
export function viewFromGround(a: FrameAxes, g: GroundView): ViewCamera {
  const b = groundBasis(g)
  return { pos: worldOfEnu(a, g.pos), right: worldDir(a, b.right), up: worldDir(a, b.up), back: worldDir(a, b.back), tanHalf: g.tanHalf }
}
