import { BORDER, DEEPEST_LEVEL, H_PX, H_SIZE, MOON_R_KM, levelDeg, pageWidth, tileOf } from './grid'
import { COARSEST_LEVEL, levelRow } from './levels'

/** A key unique over every level, deeper ones included (grid.ts tileKey stacks only levels 0 to 2). */
const reliefKey = (level: number, tx: number, ty: number): number => (levelRow(level) + ty) * pageWidth(DEEPEST_LEVEL) + tx

/**
 * A coarse relief summary of each resident height tile, for the exposure
 * search (post/exposure.ts, DESIGN-M2.md section 7): the search probes a
 * smooth sphere, so ground that faces a low Sun (a crater wall, a rim) is
 * brighter than anything it can see, and the white point set on flat ground
 * clips it. A slope tilted `t` toward a Sun `e` above the horizon is
 * sin(e + t) / sin(e) times brighter than flat ground: 2.9x for a 20 deg
 * slope under a 10 deg Sun.
 *
 * Per tile: RELIEF_CELLS x RELIEF_CELLS cells, each holding, for RELIEF_BINS
 * azimuths, the largest tan(tilt) toward that azimuth of any texel in the
 * cell (slope by central differences over two texels, as the shader's
 * tileSlope takes it). The value for an in-between azimuth is interpolated.
 */
export const RELIEF_CELLS = 16
export const RELIEF_BINS = 8
const CELL_PX = H_PX / RELIEF_CELLS

/** heights: H_SIZE x H_SIZE metres with the 1 px border; row 0 is the tile's north edge. */
export function buildRelief(heights: ArrayLike<number>, level: number, ty: number): Float32Array {
  const out = new Float32Array(RELIEF_CELLS * RELIEF_CELLS * RELIEF_BINS).fill(-1e9)
  const deg = levelDeg(level)
  const dy = (Math.PI * MOON_R_KM / 180) * (deg / H_PX) * 1000
  const lat = 90 - (ty + 0.5) * deg
  const dx = dy * Math.max(0.05, Math.cos(lat * Math.PI / 180))
  const cs: number[] = [], sn: number[] = []
  for (let b = 0; b < RELIEF_BINS; b++) { cs.push(Math.cos(2 * Math.PI * b / RELIEF_BINS)); sn.push(Math.sin(2 * Math.PI * b / RELIEF_BINS)) }
  for (let j = 0; j < H_PX; j++) {
    const row = (j + BORDER) * H_SIZE
    const cj = Math.floor(j / CELL_PX)
    for (let i = 0; i < H_PX; i++) {
      const k = row + i + BORDER
      const gx = (heights[k + 1] - heights[k - 1]) / (2 * dx)
      const gy = (heights[k - H_SIZE] - heights[k + H_SIZE]) / (2 * dy)
      const o = (cj * RELIEF_CELLS + Math.floor(i / CELL_PX)) * RELIEF_BINS
      for (let b = 0; b < RELIEF_BINS; b++) {
        const f = -(gx * cs[b] + gy * sn[b])
        if (f > out[o + b]) out[o + b] = f
      }
    }
  }
  return out
}

/** What the exposure search asks: the steepest slope facing an azimuth near a point. */
export interface ReliefField {
  /** Changes whenever the field's contents do (absent: the field never changes). */
  readonly version?: number
  /** Largest tan(tilt) toward `az` (rad, 0 = east, pi/2 = north) in the cell under (lon, lat) deg, or null with no tile there. */
  facingTan(lon: number, lat: number, az: number): number | null
}

/** Resident tiles' summaries, looked up finest level first. The streamer feeds it; nothing here touches GL. */
export class ReliefStore implements ReliefField {
  private readonly tiles = new Map<number, Float32Array>()
  /** Counts every change: a memo of anything computed from the field (the exposure search) is valid while this is unchanged. */
  version = 0
  add(level: number, tx: number, ty: number, data: Float32Array): void { this.tiles.set(reliefKey(level, tx, ty), data); this.version++ }
  remove(level: number, tx: number, ty: number): void { this.tiles.delete(reliefKey(level, tx, ty)); this.version++ }
  get size(): number { return this.tiles.size }

  facingTan(lon: number, lat: number, az: number): number | null {
    for (let l = DEEPEST_LEVEL; l <= COARSEST_LEVEL; l++) {
      const { tx, ty } = tileOf(l, lon, lat)
      const data = this.tiles.get(reliefKey(l, tx, ty))
      if (!data) continue
      const d = levelDeg(l)
      const fx = (((lon + 180) % 360 + 360) % 360) / d - tx
      const fy = (90 - lat) / d - ty
      const ci = Math.max(0, Math.min(RELIEF_CELLS - 1, Math.floor(fx * RELIEF_CELLS)))
      const cj = Math.max(0, Math.min(RELIEF_CELLS - 1, Math.floor(fy * RELIEF_CELLS)))
      const o = (cj * RELIEF_CELLS + ci) * RELIEF_BINS
      const u = (((az / (2 * Math.PI)) % 1) + 1) % 1 * RELIEF_BINS
      const b0 = Math.floor(u) % RELIEF_BINS, b1 = (b0 + 1) % RELIEF_BINS, f = u - Math.floor(u)
      return data[o + b0] * (1 - f) + data[o + b1] * f
    }
    return null
  }
}

/**
 * The exposure's choice, not a measurement: the largest tilt the search
 * credits, so one steep wall (or a streak in the data) cannot set the white
 * point for a frame of mostly gentle ground. 20 deg is the design's example.
 */
export const RELIEF_TILT_CAP_DEG = 20

/**
 * The most the relief may brighten flat ground, as a ratio. Capping the tilt alone leaves
 * sin(e + 20 deg) / sin(e), which is 7.5x at a 3 deg Sun; the white point then chases a
 * rim that covers a few pixels and darkens the rest of the frame. 3x keeps the 10 deg
 * case (2.9x) whole. An exposure choice, like the tilt cap.
 */
export const RELIEF_RATIO_CAP = 3

/** Cosine of the Sun's zenith angle on ground tilted `tanTilt` toward it, from flat ground's `mu0` (= sin elevation). */
export function reliefMu0(mu0: number, tanTilt: number): number {
  if (!(tanTilt > 0) || mu0 <= 0) return mu0
  const tilt = Math.min(Math.atan(tanTilt), RELIEF_TILT_CAP_DEG * Math.PI / 180)
  const elev = Math.asin(Math.min(1, mu0))
  return Math.max(mu0, Math.min(RELIEF_RATIO_CAP * mu0, Math.sin(Math.min(Math.PI / 2, elev + tilt))))
}
