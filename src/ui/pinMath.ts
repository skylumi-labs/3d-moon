import type { Ephemeris } from '../ephemeris'
import type { ViewCamera } from '../camera/pose'

const DEG = Math.PI / 180

/**
 * Where a selenographic point is on screen, in CSS pixels over a frame of `w` by `h`, or null when it is on the far side of the
 * limb or outside the frame. `dir` is the point's unit direction in the world frame (the Moon is a sphere here: relief is
 * under a pin's resolution).
 */
export function projectPin(cam: ViewCamera, aspect: number, dir: { x: number; y: number; z: number }, w: number, h: number): { x: number; y: number } | null {
  const cx = cam.pos.x, cy = cam.pos.y, cz = cam.pos.z
  const facing = dir.x * cx + dir.y * cy + dir.z * cz
  // On the near side of the limb: the surface point is seen from outside when its normal faces the camera (n . c > 1 for a unit sphere).
  if (facing <= 1.0005) return null
  const vx = dir.x - cx, vy = dir.y - cy, vz = dir.z - cz
  const depth = -(vx * cam.back.x + vy * cam.back.y + vz * cam.back.z)
  if (depth <= 0) return null
  const nx = (vx * cam.right.x + vy * cam.right.y + vz * cam.right.z) / (depth * cam.tanHalf * aspect)
  const ny = (vx * cam.up.x + vy * cam.up.y + vz * cam.up.z) / (depth * cam.tanHalf)
  if (!(Math.abs(nx) <= 1.02) || !(Math.abs(ny) <= 1.02)) return null
  const x = (nx + 1) / 2 * w, y = (1 - ny) / 2 * h
  // A zero-size canvas or a non-finite camera must hide the point, never leak NaN into the DOM.
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

/** A selenographic point's unit direction in the world frame at an ephemeris. */
export function selenoUnit(lon: number, lat: number, e: Ephemeris): { x: number; y: number; z: number } {
  const cl = Math.cos(lat * DEG), cn = cl * Math.cos(lon * DEG), ce = cl * Math.sin(lon * DEG), up = Math.sin(lat * DEG)
  return {
    x: e.moonX.x * cn + e.moonY.x * ce + e.moonZ.x * up,
    y: e.moonX.y * cn + e.moonY.y * ce + e.moonZ.y * up,
    z: e.moonX.z * cn + e.moonY.z * ce + e.moonZ.z * up,
  }
}

/** True when drawing the routes is pointless or unsafe: a zero-size canvas or a hidden page makes every projection non-finite. */
export function routesCannotDraw(w: number, h: number, hidden: boolean): boolean {
  return hidden || !(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)
}

/** projectPin without allocating: writes the screen point into `out` and returns true, or returns false (far side, behind, outside the frame). `dx..dz` is the point's unit direction. */
export function projectPinTo(out: { x: number; y: number }, cam: ViewCamera, aspect: number, dx: number, dy: number, dz: number, w: number, h: number): boolean {
  const cx = cam.pos.x, cy = cam.pos.y, cz = cam.pos.z
  if (dx * cx + dy * cy + dz * cz <= 1.0005) return false
  const vx = dx - cx, vy = dy - cy, vz = dz - cz
  const depth = -(vx * cam.back.x + vy * cam.back.y + vz * cam.back.z)
  if (depth <= 0) return false
  const nx = (vx * cam.right.x + vy * cam.right.y + vz * cam.right.z) / (depth * cam.tanHalf * aspect)
  const ny = (vx * cam.up.x + vy * cam.up.y + vz * cam.up.z) / (depth * cam.tanHalf)
  if (!(Math.abs(nx) <= 1.02) || !(Math.abs(ny) <= 1.02)) return false
  const x = (nx + 1) / 2 * w, y = (1 - ny) / 2 * h
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false
  out.x = x; out.y = y
  return true
}
