/**
 * The terminator, the line between lunar day and night, for the Labels layer and its flight (owner 2026-10-17: "a feature to
 * show the Terminator because it looks so beautiful"). Pure: Moon-fixed unit vectors (x prime meridian, z north) and
 * selenographic degrees, east positive.
 */
import type { Pose } from '../camera/pose'

const DEG = Math.PI / 180
export type V3 = [number, number, number]

export const unitOf = (lon: number, lat: number): V3 => {
  const c = Math.cos(lat * DEG)
  return [c * Math.cos(lon * DEG), c * Math.sin(lon * DEG), Math.sin(lat * DEG)]
}
export const lonLatOf = (v: V3): { lon: number; lat: number } => ({
  lon: Math.atan2(v[1], v[0]) / DEG,
  lat: Math.asin(Math.max(-1, Math.min(1, v[2]))) / DEG,
})
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const sub = (a: V3, b: V3, k = 1): V3 => [a[0] - k * b[0], a[1] - k * b[1], a[2] - k * b[2]]

/** A unit vector perpendicular to `s` (deterministic). */
function perpendicular(s: V3): V3 {
  const ref: V3 = Math.abs(s[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  return norm(sub(ref, s, dot(ref, s)))
}

/** The point of the terminator nearest to `view` (both Moon-fixed units; `sun` is the sub-solar direction). */
export function terminatorPoint(sun: V3, view: V3): V3 {
  const p = sub(view, sun, dot(view, sun))
  return Math.hypot(p[0], p[1], p[2]) < 1e-6 ? perpendicular(sun) : norm(p)
}

/** The terminator as `n` points around its great circle (the closing point repeats the first). */
export function terminatorCircle(sun: V3, n = 144): V3[] {
  const a = perpendicular(sun), b = cross(sun, a)
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * 2 * Math.PI
    return [a[0] * Math.cos(t) + b[0] * Math.sin(t), a[1] * Math.cos(t) + b[1] * Math.sin(t), a[2] * Math.cos(t) + b[2] * Math.sin(t)] as V3
  })
}

/** Rotates unit `p` by `ang` radians toward unit `q` along their great circle. */
function toward(p: V3, q: V3, ang: number): V3 {
  const t = norm(sub(q, p, dot(q, p)))
  return norm([p[0] * Math.cos(ang) + t[0] * Math.sin(ang), p[1] * Math.cos(ang) + t[1] * Math.sin(ang), p[2] * Math.cos(ang) + t[2] * Math.sin(ang)])
}

/** The tilt of the terminator view toward the horizon, deg. */
export const TERMINATOR_PITCH = 50

/**
 * The pose that shows the terminator at `point` best: the camera stands over the sunlit side at `dist` radii and looks across
 * the line toward the night, the Sun behind it, so every shadow runs away from the viewer and the line sits mid-frame.
 */
export function terminatorView(sun: V3, point: V3, dist: number): Pose {
  // How far back from the line the camera stands so the centre of the tilted view falls on it (flat ground, small angles).
  const back = Math.min(25 * DEG, Math.atan((dist - 1) * Math.tan(TERMINATOR_PITCH * DEG)))
  const cam = toward(point, sun, back)
  // Forward over the ground: from the camera toward the line, away from the Sun.
  const f = norm(sub(point, cam, dot(point, cam)))
  let upN = sub([0, 0, 1], cam, cam[2])
  if (Math.hypot(upN[0], upN[1], upN[2]) < 1e-9) upN = sub([1, 0, 0], cam, cam[0])
  upN = norm(upN)
  const left = cross(cam, upN)
  const roll = Math.atan2(dot(f, left), dot(f, upN)) / DEG
  const { lon, lat } = lonLatOf(cam)
  return { lon, lat, dist, roll, pitch: TERMINATOR_PITCH }
}
