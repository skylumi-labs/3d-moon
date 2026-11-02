import type { Ephemeris } from '../ephemeris'
import type { ViewCamera } from '../camera/pose'
import { type CoverageRegion, REGIONS, bestTexelM, detailShare, heatColor } from './coverage'

const DEG = Math.PI / 180

/** The selenographic point under a screen position (nx, ny in -1..1, y up), or null off the Moon. The Moon is the unit sphere here. */
export function lonLatAt(cam: ViewCamera, aspect: number, e: Ephemeris, nx: number, ny: number): { lon: number; lat: number } | null {
  const dx = cam.right.x * nx * cam.tanHalf * aspect + cam.up.x * ny * cam.tanHalf - cam.back.x
  const dy = cam.right.y * nx * cam.tanHalf * aspect + cam.up.y * ny * cam.tanHalf - cam.back.y
  const dz = cam.right.z * nx * cam.tanHalf * aspect + cam.up.z * ny * cam.tanHalf - cam.back.z
  const len = Math.hypot(dx, dy, dz)
  const ux = dx / len, uy = dy / len, uz = dz / len
  const b = cam.pos.x * ux + cam.pos.y * uy + cam.pos.z * uz
  const c = cam.pos.lengthSq() - 1
  const disc = b * b - c
  if (disc < 0) return null
  const t = -b - Math.sqrt(disc)
  if (t < 0) return null
  const px = cam.pos.x + ux * t, py = cam.pos.y + uy * t, pz = cam.pos.z + uz * t
  const X = px * e.moonX.x + py * e.moonX.y + pz * e.moonX.z
  const Y = px * e.moonY.x + py * e.moonY.y + pz * e.moonY.z
  const Z = px * e.moonZ.x + py * e.moonZ.y + pz * e.moonZ.z
  return { lon: Math.atan2(Y, X) / DEG, lat: Math.asin(Math.max(-1, Math.min(1, Z))) / DEG }
}

/**
 * The resolution map as RGBA pixels (alpha 0 off the Moon): green where the finest photograph is fine, red where it is the global
 * texel, from the coverage data only. Photographs only, as the zoom limit is: a height-only bridge does not tint.
 */
export function heatmapPixels(cam: ViewCamera, aspect: number, e: Ephemeris, w: number, h: number, alpha = 105, regions: CoverageRegion[] = REGIONS): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(w * h * 4))
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const p = lonLatAt(cam, aspect, e, ((i + 0.5) / w) * 2 - 1, 1 - ((j + 0.5) / h) * 2)
    if (!p) continue
    const t = bestTexelM(p.lon, p.lat, { imagery: true, regions })
    if (!Number.isFinite(t)) continue
    const [r, g, bl] = heatColor(detailShare(t))
    const k = (j * w + i) * 4
    out[k] = r; out[k + 1] = g; out[k + 2] = bl; out[k + 3] = alpha
  }
  return out
}
