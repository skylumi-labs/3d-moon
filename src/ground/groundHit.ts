/**
 * The ground pass's terrain hit on the CPU: the twin of `groundHit` in groundShader.ts, in both of its forms.
 *
 *  - `groundHitFixed`: the clearance-stepped sphere trace (384 steps, a 1.2 % floor), then seven halvings. `?hit=old`.
 *  - `groundHitDescent`: the max-mip descent over the patch's max grid (siteMax.ts): skip a cell wherever the ray stays above its bound to the
 *    cell's exit, go down a level where it does not, take the same clearance steps at level 0 and anywhere off the grid.
 *
 * Metres, in the ground frame: east, north, up of the origin; `off` is the origin's metres east/north of the patch's site point (the grid's frame).
 */
import { GM_EPS, GM_HOLD_M, GM_ITER, GM_MARGIN_M, GM_START, SM_LEVELS, SM_CELL_M, type SiteMax } from './siteMax'

export const G_MAXT = 60000
type V3 = [number, number, number]

export interface GroundInputs {
  o: V3
  d: V3
  tanPerPx: number
  /** terrainZ(e, n, footprint): the ground's height over the frame's tangent plane, metres. */
  z(e: number, n: number, fpM: number): number
  /** The frame origin's ground height over the sphere and radius from the Moon's centre (the curvature term of a cell's bound), metres. */
  h0: number
  R: number
  off: [number, number]
  sm?: SiteMax
  /** Texel (m) of the coarsest height level: the descent is used out to 4 of its texels per pixel of footprint. */
  coarseTexelM?: number
}
/** `budget`: the descent ran out of iterations and finished with the fixed march (the shader does the same; a ray that is not a miss only because of it). */
export interface GroundHit { hit: boolean; t: number; cover: number; samples: number; cells: number; budget?: boolean }

function bisect(i: GroundInputs, ta: number, tb: number): number {
  for (let k = 0; k < 7; k++) {
    const tm = 0.5 * (ta + tb)
    const x = [i.o[0] + i.d[0] * tm, i.o[1] + i.d[1] * tm, i.o[2] + i.d[2] * tm]
    if (x[2] < i.z(x[0], x[1], tm * i.tanPerPx)) tb = tm; else ta = tm
  }
  return 0.5 * (ta + tb)
}

export function groundHitFixed(i: GroundInputs, steps = 384, start?: { ta: number; minAng: number }): GroundHit {
  const { o, d } = i
  let ta = start?.ta ?? 0.05, tb = ta, minAng = start?.minAng ?? 1e9, hit = false, samples = 0
  for (let k = 0; k < steps; k++) {
    const x = [o[0] + d[0] * tb, o[1] + d[1] * tb, o[2] + d[2] * tb]
    const c = x[2] - i.z(x[0], x[1], tb * i.tanPerPx)
    samples++
    if (c < 0) { hit = true; break }
    minAng = Math.min(minAng, c / tb)
    ta = tb
    if (tb >= G_MAXT) break
    tb = Math.min(G_MAXT, tb + Math.max(c / (0.75 + Math.abs(d[2])), 0.012 * tb + 0.02))
  }
  if (!hit) return { hit: false, t: 0, cover: Math.min(1, Math.max(0, 0.5 - minAng / i.tanPerPx)), samples, cells: 0 }
  return { hit: true, t: bisect(i, ta, tb), cover: 1, samples, cells: 0 }
}

/**
 * `iter`: the step budget (the shader's is GM_ITER; a smaller one lets a test reach the budget fallback).
 * `onSkip(t0, t1)`: test-only trace of each skipped stretch of the ray inside its cell (from `t0` to the cell's exit or the skip's end), where the
 * cell's bound says the ray is above the ground.
 */
export function groundHitDescent(i: GroundInputs, iter = GM_ITER, onSkip?: (t0: number, t1: number) => void): GroundHit {
  const { o, d } = i
  const sm = i.sm as SiteMax
  const o2 = [o[0] + i.off[0], o[1] + i.off[1]]
  const tLocal = 4 * (i.coarseTexelM ?? 8) / i.tanPerPx
  let hold = -1
  let lv = GM_START, t = 0.05, ta = 0.05, tb = 0.05, minAng = 1e9, hit = false, samples = 0, cells = 0
  for (let k = 0; k < iter; k++) {
    const x = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t]
    const gx = (x[0] + i.off[0] - sm.e0) / SM_CELL_M, gy = (sm.n0 - x[1] - i.off[1]) / SM_CELL_M
    if (t >= hold && t < tLocal && gx >= 1 && gy >= 1 && gx < sm.w - 1 && gy < sm.h - 1) {
      const sc = 1 << lv
      const [lw, lh] = sm.size(lv)
      const cx = Math.min(Math.floor(gx / sc), lw - 1), cy = Math.min(Math.floor(gy / sc), lh - 1)
      const mx = sm.levels[lv][cy * lw + cx]
      cells++
      const size = SM_CELL_M * sc
      const xl = sm.e0 + cx * size, yt = sm.n0 - cy * size
      const tx = d[0] > 1e-9 ? (xl + size - o2[0]) / d[0] : d[0] < -1e-9 ? (xl - o2[0]) / d[0] : 1e30
      const ty = d[1] > 1e-9 ? (yt - o2[1]) / d[1] : d[1] < -1e-9 ? (yt - size - o2[1]) / d[1] : 1e30
      const tEnd = Math.max(Math.min(Math.min(tx, ty) + GM_EPS * SM_CELL_M, Math.min(G_MAXT, tLocal)), t + 1e-3)
      const loE = xl - i.off[0], loN = yt - size - i.off[1]
      const dmE = Math.max(loE, -(loE + size), 0), dmN = Math.max(loN, -(loN + size), 0)
      const zb = mx - i.h0 - (dmE * dmE + dmN * dmN) / (2 * i.R)
      const z0 = o[2] + d[2] * t, z1 = o[2] + d[2] * tEnd
      if (Math.min(z0, z1) > zb + GM_MARGIN_M + tEnd * i.tanPerPx) {
        onSkip?.(t, Math.min(tEnd, tx, ty))
        t = tEnd; ta = tEnd
        if (t >= G_MAXT) break
        lv = Math.min(lv + 1, SM_LEVELS - 1)
        continue
      }
      if (lv > 0) { lv--; continue }
      hold = t + GM_HOLD_M
    }
    const c = x[2] - i.z(x[0], x[1], t * i.tanPerPx)
    samples++
    if (c < 0) { hit = true; tb = t; break }
    minAng = Math.min(minAng, c / t)
    ta = t
    if (t >= G_MAXT) break
    t = Math.min(G_MAXT, t + Math.max(c / (0.75 + Math.abs(d[2])), 0.012 * t + 0.02))
  }
  if (!hit && t < G_MAXT) {
    // The budget ran out before the ray ended: a grazing ray that costs a cell read per clearance step. Finish it as the fixed march would, from the last point known to be above ground.
    const f = groundHitFixed(i, 384, { ta, minAng })
    return { ...f, samples: samples + f.samples, cells, budget: true }
  }
  if (!hit) return { hit: false, t: 0, cover: Math.min(1, Math.max(0, 0.5 - minAng / i.tanPerPx)), samples, cells }
  return { hit: true, t: bisect(i, ta, tb), cover: 1, samples, cells }
}
