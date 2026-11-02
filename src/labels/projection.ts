import type { ViewCamera } from '../camera/pose'

/** Project a radial lunar surface point in CSS pixels, testing visibility against its actual radius. */
export function projectLabelSurface(cam: ViewCamera, aspect: number, dir: { x: number; y: number; z: number }, radius: number, w: number, h: number): { x: number; y: number } | null {
  const cx = cam.pos.x, cy = cam.pos.y, cz = cam.pos.z
  if (dir.x * cx + dir.y * cy + dir.z * cz <= radius + 0.0005) return null
  const vx = dir.x * radius - cx, vy = dir.y * radius - cy, vz = dir.z * radius - cz
  const depth = -(vx * cam.back.x + vy * cam.back.y + vz * cam.back.z)
  if (depth <= 0) return null
  const nx = (vx * cam.right.x + vy * cam.right.y + vz * cam.right.z) / (depth * cam.tanHalf * aspect)
  const ny = (vx * cam.up.x + vy * cam.up.y + vz * cam.up.z) / (depth * cam.tanHalf)
  if (Math.abs(nx) > 1.02 || Math.abs(ny) > 1.02) return null
  return { x: (nx + 1) / 2 * w, y: (1 - ny) / 2 * h }
}
