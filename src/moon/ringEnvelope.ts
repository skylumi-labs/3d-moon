/**
 * Per-texel footprint envelope of the blend-ring tile-horizon cache (fixed shadow policy), and its CPU twin.
 *
 * The ring (0 < tile share < 1) reads the tile term of its horizon from the Sun-keyed cache, whose texels hold the live march from the texel's
 * CENTRE. A ring pixel sits anywhere in the texel's cell (+-0.5 texel), and its live march differs from the centre's by up to tens of degrees where a
 * sample lands on a narrow rim (rig 2026-10-28: one pixel of 1.5M, 14.9 deg above all 25 marches on a half-texel lattice). Instead of an allowance
 * the build stores, per texel, a bound of the live march over the WHOLE cell:
 *
 *   lo <= horizon(p + delta) <= hi  for every delta in the cell [-0.5, 0.5]^2 (texel units).
 *
 * Construction (exact for bilinear heights, the heights the march reads). Sample k at distance d_k has elevation angle F(hq, h0), with hq the
 * height at q = p + d_k t (+ delta) and h0 the height at p + delta. F rises with hq and falls with h0. hq(delta) is bilinear on every rectangle
 * of delta whose edges are the lines where q + delta crosses a texel-centre line; h0(delta) likewise with p's lines (delta = 0). On each such
 * rectangle both are bilinear, F depends on them through hq - h0 (to 0.3 per cent, the radius term), so F is extreme at a rectangle's vertices. The
 * vertices are the products of the per-axis candidates {-0.5, 0.5, 0, the crossings of q}: at most 5 per axis. The horizon is the max over
 * samples, so  hi = max_k max_vertices F  and  lo = max_k min_vertices F  (lo <= the horizon at every delta because the horizon >= every F_k).
 * A sample whose tile is not fully present (its height is a blend with another source) has no bound here: the texel is "unbounded" and the pixel
 * marches live. ENV_SLACK_DEG covers what the vertex model neglects (the great-circle direction and the longitude scale change slightly with delta).
 *
 * Storage: the cache layer is RG16F; r = the horizon at the texel centre (as before), g = u + 64 l, the integers u, l in 0..30 (codes of ENV_STEP_FINE/ENV_STEP_COARSE steps)
 * up to hi and down to lo from r (rounded outward); 31 = unbounded. u + 32 l is below 1024, which a half float holds exactly.
 */
import { MARCH_DEEP_NEAR_N, MARCH_LINEAR_STEP_KM, MARCH_N, marchDeepNearDistanceKm, marchDistanceKm, omcSmall, sinSmall } from './march'

/** Stored bound steps: code c (0..30) is c x ENV_STEP_FINE deg up to ENV_FINE_N, then ENV_FINE_N x ENV_STEP_FINE + (c - ENV_FINE_N) x ENV_STEP_COARSE deg (30 = 16.5 deg). Rounded outward, so a bound is never narrower than the exact one. */
export const ENV_STEP_FINE = 0.25
export const ENV_FINE_N = 12
export const ENV_STEP_COARSE = 0.75
/**
 * Added to hi and subtracted from lo before quantising (deg): what neither the vertex model nor the filter margin covers (great-circle direction and longitude scale across the cell, float32 uv rounding, the
 * GPU's own sample-position snapping). Rig 2026-10-28 (dist22): 0.1 -> 146 pixels differ from the live march (shring=0: 50), 1.0 -> 102, 1.5 and 2.0 -> 51 (one pixel, (413,1682), a cell-edge pixel whose near sample is
 * off by more than 15 deg: not explained).
 */
export const ENV_SLACK_DEG = 1.5
/** The code of "no bound" in either half of the stored integer. */
export const ENV_UNBOUNDED = 31
/** The only tile level with bounds: ring pixels are tile level 2 (footprint 0.5 to 0.9 of a 4k texel is 1.5 to 2.5 level-0 log2 steps). */
export const ENV_LEVEL = 2
/**
 * The GPU's bilinear filter has 8-bit fractional weights: a tile height read is off by up to (|dh/dx| + |dh/dy|) / 512 (m per texel of height change), and the elevation of a NEAR
 * sample (run d) is rise / run, so the noise reaches atan(2 x error / run): at d = 60 m over 300 m of relief per cell that is 2 deg, and it differs from texel to texel and from pixel
 * to pixel (rig 2026-10-28: the worst sample of the cells the vertex model missed was one of the six near ones, 169k pixels over 0.5 deg at the sample level). The envelope
 * widens each sample by this margin: 2 x range / FILTER_STEPS m of height (range = the larger spread of the origin's or the sample's height over the cell's vertices).
 */
export const FILTER_STEPS = 256
/** Elevation margin (rad) of one sample at distance dKm whose heights spread `rangeM` over the cell's vertices. */
export function filterSlackRad(rangeM: number, dKm: number): number {
  return (2 * rangeM) / FILTER_STEPS / (dKm * 1000)
}
/** Half the cell, in texels. */
export const ENV_HALF = 0.5

/** Ground height (m) at a position in texel units, texel centres at integers (bilinear, like the tile texture read). */
export type Field = (x: number, y: number) => number

/** A bilinear field over a w x h grid (clamped at the edges). */
export function bilinearField(grid: ArrayLike<number>, w: number, h: number): Field {
  return (x, y) => {
    const cx = Math.min(Math.max(x, 0), w - 1), cy = Math.min(Math.max(y, 0), h - 1)
    const i = Math.min(Math.floor(cx), w - 2), j = Math.min(Math.floor(cy), h - 2)
    const fx = cx - i, fy = cy - j
    const a = grid[j * w + i], b = grid[j * w + i + 1], c = grid[(j + 1) * w + i], d = grid[(j + 1) * w + i + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
  }
}

/** The same bilinear field with the weights rounded to 1/FILTER_STEPS, as the GPU's filter does (the test runs the live march on it). */
export function quantizedField(grid: ArrayLike<number>, w: number, h: number, steps = FILTER_STEPS): Field {
  return (x, y) => {
    const cx = Math.min(Math.max(x, 0), w - 1), cy = Math.min(Math.max(y, 0), h - 1)
    const i = Math.min(Math.floor(cx), w - 2), j = Math.min(Math.floor(cy), h - 2)
    const fx = Math.round((cx - i) * steps) / steps, fy = Math.round((cy - j) * steps) / steps
    const a = grid[j * w + i], b = grid[j * w + i + 1], c = grid[(j + 1) * w + i], d = grid[(j + 1) * w + i + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
  }
}

/** The march's samples: ground direction (ux, uy) unit in texel axes, distances in km, texel size in km, body radius. */
export interface RingMarch { texelKm: number; ux: number; uy: number; dKm: number[]; rKm: number }

/** The march's schedule on the Moon: the 64 distances of march.ts. */
export function marchDistances(): number[] {
  const out: number[] = []
  for (let k = 0; k < MARCH_N; k++) out.push(marchDistanceKm(k))
  return out
}

/** The deeper-set variants' extra near samples (MARCH_DEEP_NEAR_N, 60 m to the first step), which the shader runs before the main ones. */
export function deepNearDistances(): number[] {
  const out: number[] = []
  for (let k = 0; k < MARCH_DEEP_NEAR_N; k++) out.push(marchDeepNearDistanceKm(k))
  return out
}
/** The crest refinement's smallest winning distance (km): moonShader.ts MARCH_REFINE_MIN_KM (pinned by the test). */
export const REFINE_MIN_KM = 0.1
/** Half-width of the refinement's first bracket around a winner at `bestD` km (the shader's hw). */
export function refineHalfWidthKm(bestD: number): number {
  return bestD <= MARCH_LINEAR_STEP_KM ? 0.1 * bestD : (bestD <= 10 ? 0.5 * MARCH_LINEAR_STEP_KM : 0.077 * bestD)
}

/** Elevation (deg) of one sample: the shader's atan((hq - h0) e-3 - rq omc, rq s) with the series sin and 1 - cos. */
export function sampleDeg(hq: number, h0: number, dKm: number, rKm: number): number {
  const th = dKm / rKm
  const s = sinSmall(th), omc = omcSmall(th)
  const rq = rKm + hq * 0.001
  return (Math.atan2((hq - h0) * 0.001 - rq * omc, rq * s) * 180) / Math.PI
}

/** The live march from p + (dx, dy): the maximum sample elevation (deg). */
export function liveHorizonDeg(f: Field, px: number, py: number, m: RingMarch, dx = 0, dy = 0): number {
  const h0 = f(px + dx, py + dy)
  let best = -90
  for (const d of m.dKm) {
    const r = d / m.texelKm
    best = Math.max(best, sampleDeg(f(px + dx + r * m.ux, py + dy + r * m.uy), h0, d, m.rKm))
  }
  return best
}

/**
 * The deeper-set variants' live march: near samples, the 64 main samples (the winner's distance remembered, near samples never are), then three
 * halvings of the crest around the winner (moonShader.ts horizonDegT with the deep patches). `near` = deepNearDistances() or [] for the plain set.
 */
export function liveHorizonRefinedDeg(f: Field, px: number, py: number, m: RingMarch, near: number[], dx = 0, dy = 0): number {
  const h0 = f(px + dx, py + dy)
  const at = (d: number): number => {
    const r = d / m.texelKm
    return sampleDeg(f(px + dx + r * m.ux, py + dy + r * m.uy), h0, d, m.rKm)
  }
  let best = -90, bestD = 0
  for (const d of near) best = Math.max(best, at(d))
  for (const d of m.dKm) { const a = at(d); if (a > best) { best = a; bestD = d } }
  let hw = refineHalfWidthKm(bestD)
  for (let r = 0; r < 3; r++) {
    if (bestD < REFINE_MIN_KM) break
    const a1 = at(bestD - hw), a2 = at(bestD + hw)
    let c = bestD
    if (a1 > best) { best = a1; c = bestD - hw }
    if (a2 > best) { best = a2; c = bestD + hw }
    bestD = c
    hw *= 0.5
  }
  return best
}

/**
 * Per-axis vertex candidates of delta (texel units of p's lattice): the cell ends, p's own centre line (0), and every crossing of a texel-centre
 * line by q + delta, q at `sq` along this axis (texel units of q's lattice); `sx` is q's texel per p's texel on this axis (the longitude scale
 * cos(lat p) / cos(lat q); 1 on the latitude axis and in the flat twin).
 */
export function axisCandidates(sq: number, sx: number, half = ENV_HALF): number[] {
  const out = [-half, 0, half]
  for (let n = Math.ceil(sq - half * sx); n <= Math.floor(sq + half * sx); n++) {
    const a = (n - sq) / sx
    if (a > -half && a < half && a !== 0) out.push(a)
  }
  return out.sort((a, b) => a - b).filter((v, i, arr) => i === 0 || v !== arr[i - 1])
}

/**
 * The deeper-set variants refine the crest around the winning sample (three halvings): an extra sample at a distance the vertex model does not visit. Its gain over the
 * main samples is small and was measured, not proved: over 120,000 probes of real level-2 ground (lon -20..0, lat 0..10) the largest was 0.91 deg, and at every origin
 * (its largest gain over the cell) - 1 x (the gain at its centre) stayed under 0.31 deg. hi therefore carries REFINE_PAD_BASE_DEG + REFINE_PAD_K x the centre's own gain.
 */
export const REFINE_PAD_BASE_DEG = 0.4
export const REFINE_PAD_K = 1.5
export interface RingBounds { point: number; hi: number; lo: number; hiMain: number; mainCentre: number }

/** hi and lo (deg) of the horizon over the whole cell around the texel centre (px, py), and the centre's own horizon. `latticeOnly` drops the crossings of q (the 3 x 3 lattice of marches: the test shows it is not enough). */
export function footprintEnvelope(f: Field, px: number, py: number, m: RingMarch, latticeOnly = false, near: number[] = [], filterSlack = true): RingBounds {
  let hi = -90, lo = -90, mainCentre = -90
  const point = near.length ? liveHorizonRefinedDeg(f, px, py, m, near) : liveHorizonDeg(f, px, py, m)
  for (const d of [...near, ...m.dKm]) {
    const r = d / m.texelKm
    const xs = latticeOnly ? [-ENV_HALF, 0, ENV_HALF] : axisCandidates(px + r * m.ux, 1), ys = latticeOnly ? [-ENV_HALF, 0, ENV_HALF] : axisCandidates(py + r * m.uy, 1)
    let mx = -90, mn = 90
    let qLo = 1e9, qHi = -1e9, oLo = 1e9, oHi = -1e9
    for (const dy of ys) for (const dx of xs) {
      const hq = f(px + dx + r * m.ux, py + dy + r * m.uy), h0 = f(px + dx, py + dy)
      qLo = Math.min(qLo, hq); qHi = Math.max(qHi, hq); oLo = Math.min(oLo, h0); oHi = Math.max(oHi, h0)
      const a = sampleDeg(hq, h0, d, m.rKm)
      if (a > mx) mx = a
      if (a < mn) mn = a
      if (dx === 0 && dy === 0 && a > mainCentre) mainCentre = a
    }
    const eps = filterSlack ? (filterSlackRad(Math.max(qHi - qLo, oHi - oLo), d) * 180) / Math.PI : 0
    mx += eps; mn -= eps
    hi = Math.max(hi, mx)
    lo = Math.max(lo, mn)
  }
  const pad = near.length ? REFINE_PAD_BASE_DEG + REFINE_PAD_K * Math.max(0, point - mainCentre) : 0
  return { point, hi: hi + pad, lo, hiMain: hi, mainCentre }
}

/** Half-float rounding of a value (what the R channel keeps): the bounds count from the stored number, not from the exact one. */
export function toHalf(x: number): number {
  if (x === 0 || !Number.isFinite(x)) return x
  const e = Math.max(Math.floor(Math.log2(Math.abs(x))), -14)
  const q = 2 ** (e - 10)
  return Math.round(x / q) * q
}

/** Deg a code stands for. */
export function degOfCode(c: number): number {
  return c <= ENV_FINE_N ? c * ENV_STEP_FINE : ENV_FINE_N * ENV_STEP_FINE + (c - ENV_FINE_N) * ENV_STEP_COARSE
}
/** The smallest code whose deg is at least `deg` (0 for deg <= 0); ENV_UNBOUNDED when none of 0..30 reaches it. */
export function codeOfDeg(deg: number): number {
  if (deg <= 0) return 0
  const c = deg <= ENV_FINE_N * ENV_STEP_FINE ? Math.ceil(deg / ENV_STEP_FINE - 1e-9) : ENV_FINE_N + Math.ceil((deg - ENV_FINE_N * ENV_STEP_FINE) / ENV_STEP_COARSE - 1e-9)
  return c >= ENV_UNBOUNDED ? ENV_UNBOUNDED : c
}

/** The stored g channel for a texel: codes u (up) and l (down) from the stored point, rounded outward, as u + 32 l; 31 + 32 x 31 when a bound is not available or too wide. */
export function packBounds(pointStored: number, hi: number | null, lo: number | null): number {
  const unbounded = ENV_UNBOUNDED + 32 * ENV_UNBOUNDED
  if (hi === null || lo === null) return unbounded
  const u = codeOfDeg(hi + ENV_SLACK_DEG - pointStored), l = codeOfDeg(pointStored - (lo - ENV_SLACK_DEG))
  if (u >= ENV_UNBOUNDED || l >= ENV_UNBOUNDED) return unbounded
  return u + 32 * l
}

/** The bounds (deg) a stored texel gives: null when unbounded. */
export function unpackBounds(pointStored: number, packed: number): { hi: number; lo: number } | null {
  const u = packed % 32, l = Math.floor(packed / 32)
  if (u >= ENV_UNBOUNDED || l >= ENV_UNBOUNDED) return null
  return { hi: pointStored + degOfCode(u), lo: pointStored - degOfCode(l) }
}
