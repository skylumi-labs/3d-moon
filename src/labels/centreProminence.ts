/**
 * Prominence in screen space. In a tilted view the exact centre pixel can sit on a mare just outside the rim of a crater that fills half the
 * screen; the visitor looks at the crater. A crater (or other disc feature that is not a mare) is PROMINENT when its projected disc is large
 * (its on-screen diameter is a share of the short side) and its rim comes close to the screen centre (the centre lies inside the projected disc or
 * within a margin of its edge). Pure: it projects the feature's centre and rim with the presented camera, in units of the short side.
 */
import type { V3 } from './centrePick'

/** On-screen diameter that makes a feature prominent, in short sides (est). */
export const PROM_DIAM = 0.2
/** How close its projected edge must come to the screen centre, in short sides (est). */
export const PROM_EDGE = 0.1
/** A big disc may stand farther from the centre: its edge may be this share of its own on-screen diameter away (a crater that fills the screen is prominent from a bit further out), est. */
export const PROM_EDGE_SHARE = 0.2
/** Retention relaxes both thresholds by this factor, so a feature that was prominent does not drop out (and back in) at the border. */
export const PROM_RELAX = 1.25
const RIM_POINTS = 16

export interface ProjCam { pos: V3; back: V3; up: V3; tanHalf: number; aspect: number }
export interface ProjectedDisc { diam: number; edge: number }
export interface PromRow { id: string; unit: V3; rho: number }
export interface Prominent { id: string; diam: number; edge: number }

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

/** Distance from the origin to a closed polygon (0 inside), in the polygon's units. */
function distanceToPolygon(poly: ReadonlyArray<readonly [number, number]>): number {
  let inside = false
  let best = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if ((yi > 0) !== (yj > 0) && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) inside = !inside
    const dx = xj - xi, dy = yj - yi, l2 = dx * dx + dy * dy
    const t = l2 > 0 ? Math.max(0, Math.min(1, -(xi * dx + yi * dy) / l2)) : 0
    best = Math.min(best, Math.hypot(xi + t * dx, yi + t * dy))
  }
  return inside ? 0 : best
}

/**
 * The feature's disc as the camera sees it: its diameter (the larger side of its screen bounding box) and the distance from the screen centre to its
 * edge (0 when the centre is inside), in short sides. Null when the disc is not fully on the near side of the limb in front of the camera.
 */
export function projectDisc(cam: ProjCam, unit: V3, rho: number): ProjectedDisc | null {
  const right = cross(cam.up, cam.back)
  const tanShort = cam.tanHalf * Math.min(1, cam.aspect)
  const proj = (p: V3): [number, number] | null => {
    // On the near side of the limb, and in front of the camera.
    if (dot(p, [cam.pos[0] - p[0], cam.pos[1] - p[1], cam.pos[2] - p[2]]) <= 0) return null
    const v: V3 = [p[0] - cam.pos[0], p[1] - cam.pos[1], p[2] - cam.pos[2]]
    const depth = -dot(v, cam.back)
    if (depth <= 1e-6) return null
    return [dot(v, right) / depth / (2 * tanShort), dot(v, cam.up) / depth / (2 * tanShort)]
  }
  if (!proj(unit)) return null
  const ref: V3 = Math.abs(unit[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const e1 = norm(cross(unit, ref)), e2 = cross(unit, e1)
  const poly: Array<[number, number]> = []
  for (let k = 0; k < RIM_POINTS; k++) {
    const th = (2 * Math.PI * k) / RIM_POINTS, s = Math.sin(rho), c = Math.cos(rho)
    const p = norm([unit[0] * c + (e1[0] * Math.cos(th) + e2[0] * Math.sin(th)) * s, unit[1] * c + (e1[1] * Math.cos(th) + e2[1] * Math.sin(th)) * s, unit[2] * c + (e1[2] * Math.cos(th) + e2[2] * Math.sin(th)) * s])
    const q = proj(p)
    if (!q) return null
    poly.push(q)
  }
  const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1])
  return { diam: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)), edge: distanceToPolygon(poly) }
}

/** The prominent rows, best first: nearest edge (quantised, so two similar craters do not trade places on noise), then the larger, then by id. `relax` > 1 loosens both thresholds. */
export function prominentAmong(cam: ProjCam, rows: readonly PromRow[], relax = 1): Prominent[] {
  const out: Prominent[] = []
  for (const r of rows) {
    const d = projectDisc(cam, r.unit, r.rho)
    if (d && d.diam >= PROM_DIAM / relax && d.edge <= Math.max(PROM_EDGE, PROM_EDGE_SHARE * d.diam) * relax) out.push({ id: r.id, ...d })
  }
  return out.sort((a, b) => Math.round(a.edge / 0.02) - Math.round(b.edge / 0.02) || b.diam - a.diam || (a.id < b.id ? -1 : 1))
}
