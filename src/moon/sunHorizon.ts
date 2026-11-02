import { GH_AA_MAX_DEG, ghHorizonDeg, ghDir, type GhPyramid } from './globalHorizon'

/**
 * The fixed shadow policy's SUN-KEYED 4k horizon bake: for the fixed Sun, per 4k-map cell and pixel-lod bin, the lowest and highest horizon elevation the old march
 * (moonShader.ts horizonDeg) gives toward THAT Sun, from anywhere in the cell and at any lod of the bin. The Moon pass skips the 32-step 4k march when the Sun's elevation
 * is outside [lo, hi] by the certificate: above hi the pixel is fully lit, below lo it is fully shadowed, and the value the march would have returned only has to keep the lit ramp
 * saturated (hi / lo are returned, hi >= the true horizon >= lo). Everything between marches live as legacy.
 *
 * Why the older, Sun-independent envelope (globalHorizon.ts) needs about 9 deg of clearance and this needs about 5:
 *   cert = 2 (lit ramp half-width cap) + 2 / (0.75 * uTermAA) (the ramp's width is min(2, 0.75 * uTermAA * fwidth(m)), and fwidth reads the quad partner's margin: a live pixel next
 *          to a skipped one keeps its legacy width only when the skipped one's margin is >= 2 + 2 / (0.75 * uTermAA)) = 4.67 at uTermAA 1. This floor is structural and stays.
 *        + 2.3 (GH_CERT_EXTRA_DEG: slack for the SAMPLED envelope missing ridges, measured up to 3.5 deg) + 0.5 (envelope margin) + 0.25 (rounding) = about 7.7,
 *   and the envelope is a bound over a 45 deg sector of azimuths and a 4-texel cell, which is worse than the horizon toward the one Sun azimuth by several degrees more (the rig's 9 deg).
 * This bake is the horizon toward the one Sun azimuth over a 1- or 2-texel cell, so the slack is a measured margin of tenths of a degree, and it adds the DARK side (the envelope has none).
 *
 * SAMPLED, not proven: the cell's range comes from a g x g grid of positions and a few lods; the bake's margin covers what lies between (scripts/fixed-4k-bound-study.mts measures
 * the exceedance on the real 4k map). It is checked per pixel by the rig's bound-check view and the picture diff against legacy.
 */

/** Pixel-lod bin edges: bin b holds lods in (EDGES[b], EDGES[b + 1]] (bin 0 includes 0). A pixel coarser than the last edge marches live. */
export const SB_BIN_EDGES: readonly number[] = [0, 1, 2, 3.5, 6.5]
export const SB_BINS = SB_BIN_EDGES.length - 1
/** Cell width in texels by device class (height is half); the bake texture stacks the bins vertically: width x (height * SB_BINS), RG8 (lo, hi codes). */
export const SB_WIDTH = { desktop: 2048, low: 1024 }
/** Positions sampled per cell: a g x g grid reaching the cell's edges. */
export const SB_GRID = 3
/** Codes: 0 unbuilt; 1 (lo only) no lower bound; 2..254 decode to SB_OFF_DEG + (c - 2) * SB_Q_DEG; 255 (hi only) no upper bound. */
export const SB_Q_DEG = 0.25
export const SB_OFF_DEG = -10
export const SB_UNBUILT = 0
/** The bake's margin (deg) added to the sampled range on both sides before rounding outward: positions and lods between the samples, the Sun's drift (SB_SUN_TOL_RAD). */
export const SB_MARGIN_DEG = 1
/** A bake made for a Sun within this (rad, 0.05 deg) of the current one still stands: the horizon toward it moves by far less than SB_MARGIN_DEG (a 0.05 deg turn of the ray moves a 300 km sample by 0.26 km). */
export const SB_SUN_TOL_RAD = 0.05 * Math.PI / 180
/** Extra clearance (deg) over the ramp-and-quad term: float rounding of the elevation. */
export const SB_CERT_EXTRA_DEG = 0.1
export function sbCertDeg(termAA = 1): number { return GH_AA_MAX_DEG + GH_AA_MAX_DEG / (0.75 * Math.max(termAA, 0.05)) + SB_CERT_EXTRA_DEG }

export function sbBinOf(lod: number): number {
  if (!(lod >= 0) || lod > SB_BIN_EDGES[SB_BINS]) return -1
  for (let b = 0; b < SB_BINS; b++) if (lod <= SB_BIN_EDGES[b + 1]) return b
  return -1
}
/** The lods a bin is sampled at: both edges and the middle. */
export function sbBinLods(bin: number): number[] {
  const a = SB_BIN_EDGES[bin], b = SB_BIN_EDGES[bin + 1]
  return [a, 0.5 * (a + b), b]
}
export function sbBytes(width: number): number { return width * (width >> 1) * SB_BINS * 2 }

export function sbEncodeLo(v: number): number { return v < SB_OFF_DEG ? 1 : Math.min(254, Math.floor((v - SB_OFF_DEG) / SB_Q_DEG) + 2) }
export function sbEncodeHi(v: number): number { const c = Math.ceil((v - SB_OFF_DEG) / SB_Q_DEG) + 2; return c > 254 ? 255 : Math.max(2, c) }
export function sbDecodeLo(c: number): number { return c <= 1 ? -Infinity : SB_OFF_DEG + (c - 2) * SB_Q_DEG }
export function sbDecodeHi(c: number): number { return c >= 255 ? Infinity : SB_OFF_DEG + (c - 2) * SB_Q_DEG }

/** The unit tangent at p toward the Sun (the shader's normalize(uS - p * dot(p, uS))); null where the Sun is at the zenith or nadir. */
export function sbSunTangent(p: readonly [number, number, number], sun: readonly [number, number, number]): [number, number, number] | null {
  const d = p[0] * sun[0] + p[1] * sun[1] + p[2] * sun[2]
  const t: [number, number, number] = [sun[0] - p[0] * d, sun[1] - p[1] * d, sun[2] - p[2] * d]
  const l = Math.hypot(t[0], t[1], t[2])
  return l > 1e-4 ? [t[0] / l, t[1] / l, t[2] / l] : null
}
/** The positions of a g x g grid over a cell, in texels from its centre (reaching the edges). */
export function sbGridPoints(g: number): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = []
  const c = (i: number): number => (g === 1 ? 0 : -0.5 + i / (g - 1))
  for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) out.push([c(i), c(j)])
  return out
}
/** One cell's raw range (deg, before the margin): min and max of the old march toward `sun` over the grid positions and the bin's lods. null when the Sun is at the zenith of a sample. */
export function sbCellRange(pyr: GhPyramid, sun: readonly [number, number, number], w: number, h: number, i: number, j: number, bin: number, grid: number = SB_GRID): { lo: number; hi: number } | null {
  let lo = Infinity, hi = -Infinity
  for (const [dx, dy] of sbGridPoints(grid)) {
    const p = ghDir((i + 0.5 + dx) / w, Math.min(1 - 0.25 / h, Math.max(0.25 / h, (j + 0.5 + dy) / h)))
    const t = sbSunTangent(p, sun)
    if (!t) return null
    for (const lod of sbBinLods(bin)) {
      const v = ghHorizonDeg(pyr, p, t, lod)
      lo = Math.min(lo, v); hi = Math.max(hi, v)
    }
  }
  return { lo, hi }
}
/** The cell's two codes (lo, hi). */
export function sbCellCodes(pyr: GhPyramid, sun: readonly [number, number, number], w: number, h: number, i: number, j: number, bin: number, grid: number = SB_GRID, margin: number = SB_MARGIN_DEG): [number, number] {
  const r = sbCellRange(pyr, sun, w, h, i, j, bin, grid)
  if (!r) return [1, 255]
  return [sbEncodeLo(r.lo - margin), sbEncodeHi(r.hi + margin)]
}

/** The shader's decision for a margin e = elevS - horizon bound: 1 lit (return hi), -1 dark (return lo), 0 march. `cert` from sbCertDeg. Codes as the texture holds them. */
export function sbDecide(loCode: number, hiCode: number, elevS: number, cert: number): { skip: 1 | -1 | 0; value: number } {
  if (loCode === SB_UNBUILT || hiCode === SB_UNBUILT) return { skip: 0, value: NaN }
  const hi = sbDecodeHi(hiCode), lo = sbDecodeLo(loCode)
  if (hi < Infinity && elevS - hi > cert) return { skip: 1, value: hi }
  if (lo > -Infinity && lo - elevS > cert) return { skip: -1, value: lo }
  return { skip: 0, value: NaN }
}

/** Blocks (columns x rows of `block` texels) of every bin, nearest the camera direction first, bins in order within a block. */
export function sbBuildOrder(w: number, h: number, camDir: readonly [number, number, number], block: number): Array<{ bx: number; by: number; bin: number }> {
  const out: Array<{ bx: number; by: number; bin: number; a: number }> = []
  for (let by = 0; by * block < h; by++) for (let bx = 0; bx * block < w; bx++) {
    const c = ghDir(((bx + 0.5) * block) / w, Math.min(1, ((by + 0.5) * block) / h))
    const a = Math.acos(Math.min(1, Math.max(-1, c[0] * camDir[0] + c[1] * camDir[1] + c[2] * camDir[2])))
    for (let bin = 0; bin < SB_BINS; bin++) out.push({ bx, by, bin, a })
  }
  out.sort((p, q) => p.a - q.a || p.bin - q.bin)
  return out.map(({ bx, by, bin }) => ({ bx, by, bin }))
}

/** `?sunbake=0` keeps the envelope alone (A/B). `?sunbake=1` is the default under ?shadowpolicy=fixed. */
export function sunBakeOn(search: string): boolean { return new URLSearchParams(search).get('sunbake') !== '0' }
/** `?sbmargin=<deg>` overrides SB_MARGIN_DEG (rig experiments with the bound's reliability). */
export function sbMarginFromSearch(search: string): number {
  const q = new URLSearchParams(search).get('sbmargin')
  const m = q === null || q === '' ? NaN : Number(q)
  return Number.isFinite(m) && m >= 0 && m <= 10 ? m : SB_MARGIN_DEG
}
/** `?sbgrid=<n>` (2..7) overrides the sample grid side. */
export function sbGridFromSearch(search: string): number {
  const n = Math.floor(Number(new URLSearchParams(search).get('sbgrid')))
  return n >= 2 && n <= 7 ? n : SB_GRID
}
