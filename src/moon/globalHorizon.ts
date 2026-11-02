/**
 * The fixed shadow policy's horizon ENVELOPE of the 4k height map: per texel, the highest horizon elevation in ANY azimuth (so it does not depend on the Sun
 * or on the viewer), built once per height map. Two skips follow where legacy marches the 4k map (`gTileMarch <= 0`: Home, the limb, every view the tiles do not cover):
 *
 *  - Sun: a pixel whose Sun elevation clears the envelope by more than the widest edge its lit value can have is fully lit whatever the exact horizon is
 *    (`smoothstep(-W, W, elevS - hz)` is saturated), so the 32-step march is skipped. Every other pixel runs the original march with the original lod.
 *  - Viewer: `vis = smoothstep(hzV - 0.5, hzV + 0.5, elevV)` is 1 when the viewer's elevation clears the envelope by more than 0.5 deg.
 *
 * The envelope is SAMPLED, not proven: per texel the old march (moonShader.ts horizonDeg, the very text the Moon pass runs) over 8 azimuths, lods 0, 2, 4, 6 and
 * five points of the cell (centre and corners), widened by a margin, rounded outward to 0.25 deg in one byte and dilated by one texel so a nearest-texel read
 * covers the whole cell. The test and scripts/global-horizon-error.mts measure how often a live horizon exceeds it. Pixels with a footprint coarser than lod 6.5
 * march live.
 */

const RAD = Math.PI / 180
/** Azimuths sampled per cell point, the mip lods sampled (the pixel lod between them is covered by the margin), and the coarsest lod served. */
export const ENV_AZ = 8
export const ENV_LODS: readonly number[] = [0, 2, 4, 6]
export const ENV_LOD_MAX = 6.5
/** Widening of the sampled maximum (deg): the azimuths, lods and positions between the samples. */
export const ENV_MARGIN_DEG = 0.5
/** Codes: 0 unbuilt; c in 1..254 decodes to ENV_OFF + (c - 1) * ENV_Q (>= the value it was made from); 255 = no bound. */
export const ENV_Q_DEG = 0.25
export const ENV_OFF_DEG = -2
export const ENV_UNBUILT = 0
export const ENV_BLOCK = 128
/** Envelope texture width by device class (height is half). */
export const ENV_WIDTH = { desktop: 2048, low: 1024 }
/** Cell sample points, in texels from the centre. */
export const ENV_CELL_POINTS: ReadonlyArray<readonly [number, number]> = [[0, 0], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]
/**
 * The viewer's visibility ramp is smoothstep(hzV - 0.5, hzV + 0.5, elevV): saturated 1 from hz + 0.5. The envelope is SAMPLED: against the real 4k map (SwiftShader, 65,536 random
 * position/azimuth/lod rows, phone-class cells) the live horizon exceeded its sector bound in 4 of 60,923 rows by up to 3.5 deg (7 by up to 4.2 deg with 16 azimuths), all at lod < 1, where the horizon is
 * set by ridges a few km away and the cell's 3 x 3 sample points (16 km apart) miss them. So the viewer skip clears the bound by 4 deg (the ramp's 0.5 plus 3.5 slack; the 2026-10-27 SwiftShader re-run saw one row exceed by 3.43 deg, which 3 deg did not cover) and the Sun skip's certificate carries 2.3 deg
 * extra (GH_CERT_EXTRA_DEG); the bound-check view (`__moon.boundSummary()`) measures the exceedances that still fire a skip, per pixel.
 */
export const ENV_VIEW_CLEAR_DEG = 4.0

export const GH_R_KM = 1737.4
const STEPS = 32, D0 = 1.5, DMAX = 300

export function envEncode(v: number): number { return Math.min(255, Math.max(1, Math.ceil((v - ENV_OFF_DEG) / ENV_Q_DEG) + 1)) }
export function envDecode(c: number): number { return c >= 255 ? Infinity : ENV_OFF_DEG + (c - 1) * ENV_Q_DEG }
export function envBytes(width: number): number { return width * (width >> 1) }

/** Where the Sun may skip: the clearance (deg) of the Sun's elevation over the envelope. The lit value is smoothstep(-W, W, m), m = elevS - hz,
 *  W = max(wSun, min(2, 0.75 * uTermAA * fwidth(m))) (margin AA mode, wSun <= 2): |m| > W is exactly 0 or 1 whatever hz is. fwidth also reads the quad partner's m,
 *  and a skipped partner returns the envelope, not the live horizon; for the live pixel's W to stay what legacy computes (the cap, 2) the partner's |m| must
 *  exceed 2 / (0.75 * uTermAA) + 2 whichever of live and envelope it is; plus a little. */
export const GH_AA_MAX_DEG = 2
export const GH_CERT_EXTRA_DEG = 2.3
export function ghCertDeg(termAA = 1): number { return GH_AA_MAX_DEG + GH_AA_MAX_DEG / (0.75 * Math.max(termAA, 0.05)) + GH_CERT_EXTRA_DEG }
/** Sub-pixel tap reuse margin (deg): the horizon's measured spread over a 0.375-pixel offset (p99 about 1.6, max 5 over 600 samples at lods 0..4 on the synthetic map). A tap reuses the first tap's horizon only when its margin to that horizon exceeds the Sun disc's half-width by this much. Not a proven bound. */
export const GH_SUBPX_DELTA_DEG = 0
/** The Sun skip: true when the pixel is fully lit by the envelope alone. */
export function envSunLit(maxHz: number, elevS: number, cert: number): boolean { return elevS - maxHz > cert }
/** The viewer skip: true when vis is exactly 1 by the envelope alone. */
export function envViewVisible(maxHz: number, elevV: number): boolean { return elevV - maxHz >= ENV_VIEW_CLEAR_DEG }

// ---------------------------------------------------------------------------------------------------------------------------------
// CPU twin of the height mip chain and the old march
// ---------------------------------------------------------------------------------------------------------------------------------
export interface GhPyramid { levels: Array<{ w: number; h: number; data: Float32Array }>; wrap: boolean; texelKm: number }

/** A box-filtered mip chain from a base grid (the app's chain: R16F metres, each level the mean of 2x2). */
export function ghBuildPyramid(base: Float32Array, w: number, h: number, wrap = true): GhPyramid {
  const levels = [{ w, h, data: base }]
  while (levels[levels.length - 1].w > 1 && levels[levels.length - 1].h > 1) {
    const p = levels[levels.length - 1]
    const nw = p.w >> 1, nh = p.h >> 1
    const d = new Float32Array(nw * nh)
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) d[y * nw + x] = (p.data[2 * y * p.w + 2 * x] + p.data[2 * y * p.w + 2 * x + 1] + p.data[(2 * y + 1) * p.w + 2 * x] + p.data[(2 * y + 1) * p.w + 2 * x + 1]) / 4
    levels.push({ w: nw, h: nh, data: d })
  }
  return { levels, wrap, texelKm: 2 * Math.PI * GH_R_KM / w }
}

function texel(p: GhPyramid, x: number, y: number, lod: number): number {
  const L = p.levels[lod]
  if (p.wrap) x = x < 0 ? x + L.w : x >= L.w ? x - L.w : x
  x = Math.min(Math.max(x, 0), L.w - 1); y = Math.min(Math.max(y, 0), L.h - 1)
  return L.data[y * L.w + x]
}
/** heightLod in moonShader.ts: bilinear at one mip. */
export function ghHeightLod(p: GhPyramid, u: number, v: number, lod: number): number {
  const L = p.levels[lod]
  const tx = u * L.w - 0.5, ty = v * L.h - 0.5
  const ix = Math.floor(tx), iy = Math.floor(ty), fx = tx - ix, fy = ty - iy
  const a = texel(p, ix, iy, lod), b = texel(p, ix + 1, iy, lod), c = texel(p, ix, iy + 1, lod), d = texel(p, ix + 1, iy + 1, lod)
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
}
/** heightAt in moonShader.ts: trilinear at a fractional mip, clamped to the chain. */
export function ghHeightAt(p: GhPyramid, u: number, v: number, lodF: number): number {
  const l = Math.min(Math.max(lodF, 0), p.levels.length - 1)
  const l0 = Math.floor(l), l1 = Math.min(l0 + 1, p.levels.length - 1), f = l - l0
  return ghHeightLod(p, u, v, l0) * (1 - f) + ghHeightLod(p, u, v, l1) * f
}

/** uvOf for a body-frame unit vector (lonSpan 180: the whole globe). */
export function ghUv(b: readonly [number, number, number]): [number, number] {
  const lon = Math.atan2(b[1], b[0]) / RAD
  const lat = Math.asin(Math.min(1, Math.max(-1, b[2]))) / RAD
  return [(lon + 180) / 360, (90 - lat) / 180]
}
/** The body-frame unit vector of an equirect uv. */
export function ghDir(u: number, v: number): [number, number, number] {
  const lon = (u * 360 - 180) * RAD, lat = (90 - v * 180) * RAD
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
}

/** horizonDeg in moonShader.ts (the old march), body frame. `t` is the unit tangent at p. Degrees above the local horizontal. */
export function ghHorizonDeg(pyr: GhPyramid, p: readonly [number, number, number], t: readonly [number, number, number], lod0: number): number {
  const [pu, pv] = ghUv(p as [number, number, number])
  const h0 = ghHeightAt(pyr, pu, pv, lod0)
  let best = -0.5 * Math.PI
  for (let k = 0; k < STEPS; k++) {
    const d = D0 * Math.pow(DMAX / D0, k / (STEPS - 1))
    const th = d / GH_R_KM
    const s = Math.sin(th), omc = 1 - Math.cos(th)
    const q: [number, number, number] = [p[0] * (1 - omc) + t[0] * s, p[1] * (1 - omc) + t[1] * s, p[2] * (1 - omc) + t[2] * s]
    const ql = Math.hypot(q[0], q[1], q[2])
    q[0] /= ql; q[1] /= ql; q[2] /= ql
    const lod = Math.max(lod0, Math.log2(Math.max(1, 0.19 * d / pyr.texelKm)))
    const [qu, qv] = ghUv(q)
    const hq = ghHeightAt(pyr, qu, qv, lod)
    const rq = GH_R_KM + hq * 0.001
    best = Math.max(best, Math.atan2((hq - h0) * 0.001 - rq * omc, rq * s))
  }
  return best / RAD
}

/** The unit tangent at p along azimuth a (0 = east), as the Moon pass builds its local frame: e = normalize(cross(K, p) + 1e-6), n = cross(p, e). */
export function ghTangent(p: readonly [number, number, number], az: number): [number, number, number] {
  let e: [number, number, number] = [-p[1] + 1e-6, p[0] + 1e-6, 1e-6]
  const el = Math.hypot(e[0], e[1], e[2]); e = [e[0] / el, e[1] / el, e[2] / el]
  const n: [number, number, number] = [p[1] * e[2] - p[2] * e[1], p[2] * e[0] - p[0] * e[2], p[0] * e[1] - p[1] * e[0]]
  const c = Math.cos(az), s = Math.sin(az)
  return [c * e[0] + s * n[0], c * e[1] + s * n[1], c * e[2] + s * n[2]]
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The envelope (CPU reference) and its build plan
// ---------------------------------------------------------------------------------------------------------------------------------
/** One envelope texel before quantisation: the highest old-march horizon over the cell's sample points, azimuths and lods, plus the margin. */
export function envTexelMax(pyr: GhPyramid, w: number, h: number, i: number, j: number): number {
  let best = -90
  for (const [dx, dy] of ENV_CELL_POINTS) {
    const p = ghDir((i + 0.5 + dx) / w, Math.min(1 - 0.25 / h, Math.max(0.25 / h, (j + 0.5 + dy) / h)))
    for (let a = 0; a < ENV_AZ; a++) {
      const t = ghTangent(p, a * 2 * Math.PI / ENV_AZ)
      for (const lod of ENV_LODS) best = Math.max(best, ghHorizonDeg(pyr, p, t, lod))
    }
  }
  return best + ENV_MARGIN_DEG
}

/** The 3x3 maximum of codes (longitude wraps, latitude clamps): a nearest-texel read of the result is >= every raw texel the pixel's cell touches. Unbuilt neighbours leave it unbuilt. */
export function envDilate(raw: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0, unbuilt = false
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const c = raw[Math.min(h - 1, Math.max(0, y + dy)) * w + ((x + dx + w) % w)]
      if (c === ENV_UNBUILT) unbuilt = true
      m = Math.max(m, c)
    }
    out[y * w + x] = unbuilt ? ENV_UNBUILT : m
  }
  return out
}

export class GhEnvelopeCpu {
  readonly w: number
  readonly h: number
  readonly raw: Uint8Array
  env: Uint8Array
  constructor(w: number, h = w >> 1) { this.w = w; this.h = h; this.raw = new Uint8Array(w * h); this.env = new Uint8Array(w * h) }
  buildTexel(pyr: GhPyramid, i: number, j: number): void { this.raw[j * this.w + i] = envEncode(envTexelMax(pyr, this.w, this.h, i, j)) }
  buildBlock(pyr: GhPyramid, bx: number, by: number): void {
    for (let j = by * ENV_BLOCK; j < Math.min(this.h, (by + 1) * ENV_BLOCK); j++) for (let i = bx * ENV_BLOCK; i < Math.min(this.w, (bx + 1) * ENV_BLOCK); i++) this.buildTexel(pyr, i, j)
  }
  finish(): void { this.env = envDilate(this.raw, this.w, this.h) }
  /** The shader's read: the bound (deg) at uv for a pixel of footprint `lod`, or null (unbuilt, no bound, or a footprint coarser than the sampled lods). */
  lookup(u: number, v: number, lod: number): number | null {
    if (!(lod <= ENV_LOD_MAX)) return null
    const i = ((Math.floor(u * this.w) % this.w) + this.w) % this.w, j = Math.min(this.h - 1, Math.max(0, Math.floor(v * this.h)))
    const c = this.env[j * this.w + i]
    if (c === ENV_UNBUILT || c >= 255) return null
    return envDecode(c)
  }
}

/** Build blocks (columns x rows of ENV_BLOCK texels), nearest the camera direction first. */
export function envBlockOrder(w: number, h: number, camDir: readonly [number, number, number], block: number = ENV_BLOCK): Array<{ bx: number; by: number }> {
  const out: Array<{ bx: number; by: number; a: number }> = []
  for (let by = 0; by * block < h; by++) for (let bx = 0; bx * block < w; bx++) {
    const c = ghDir(((bx + 0.5) * block) / w, Math.min(1, ((by + 0.5) * block) / h))
    out.push({ bx, by, a: Math.acos(Math.min(1, Math.max(-1, c[0] * camDir[0] + c[1] * camDir[1] + c[2] * camDir[2]))) })
  }
  out.sort((p, q) => p.a - q.a)
  return out.map(({ bx, by }) => ({ bx, by }))
}

/** `?envblocks=<n>` (dev, functional runs on a software renderer): build n blocks a frame in both envelope caches whatever the GPU budget says. null = the measured budget. */
export function envBlocksFromSearch(search: string): number | null {
  const n = Math.floor(Number(new URLSearchParams(search).get('envblocks')))
  return n >= 1 && n <= 4000 ? n : null
}
/** `?ghcache=0` keeps the live march (A/B). */
export function ghCacheOn(search: string): boolean { return new URLSearchParams(search).get('ghcache') !== '0' }

/** Dev/rig probe: distribution of the decoded envelope (deg) over its built, bounded texels, and the counts of the other codes. */
export function envHistogram(codes: ArrayLike<number>): { texels: number; unbuilt: number; unbounded: number; min: number | null; p50: number | null; p95: number | null; max: number | null } {
  const vals: number[] = []
  let unbuilt = 0, unbounded = 0
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i]
    if (c === ENV_UNBUILT) unbuilt++
    else if (c >= 255) unbounded++
    else vals.push(envDecode(c))
  }
  vals.sort((a, b) => a - b)
  const q = (p: number): number | null => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : null)
  return { texels: codes.length, unbuilt, unbounded, min: q(0), p50: q(0.5), p95: q(0.95), max: vals.length ? vals[vals.length - 1] : null }
}

/**
 * Dev/rig probe for one surface point: the envelope the shader would read, the Sun and viewer clearances actually used, and whether each skip fires.
 * `codes` is the sectored envelope as GlobalHorizonCache.readback() returns it ((j * w + i) * 8 + sector); `azS` / `azV` are the azimuths (radians from the build's e toward n) of the Sun's
 * and the viewer's tangent at the point, which pick the sector.
 */
export function envProbePoint(codes: ArrayLike<number>, w: number, h: number, u: number, v: number, lod: number, elevS: number, elevV: number, termAA: number, azS = 0, azV = 0): {
  env: number | null; envView: number | null; sunMargin: number | null; sunCert: number; sunSkip: boolean; viewMargin: number | null; viewClear: number; viewSkip: boolean
} {
  const cert = ghCertDeg(termAA)
  const read = (az: number): number | null => {
    if (!(lod <= ENV_LOD_MAX)) return null
    const i = ((Math.floor(u * w) % w) + w) % w, j = Math.min(h - 1, Math.max(0, Math.floor(v * h)))
    const c = codes[(j * w + i) * ENV_SECTORS + sectorOfAzimuth(az)]
    return c === ENV_UNBUILT || c >= 255 ? null : envDecode(c)
  }
  const env = read(azS), envView = read(azV)
  return { env, envView, sunMargin: env === null ? null : elevS - env, sunCert: cert, sunSkip: env !== null && envSunLit(env, elevS, cert), viewMargin: envView === null ? null : elevV - envView, viewClear: ENV_VIEW_CLEAR_DEG, viewSkip: envView !== null && envViewVisible(envView, elevV) }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The per-tile envelope (fixed policy): the same principle as the 4k envelope, for the TILE march (tiles/TileEnvelope.ts builds it, moonShader.ts reads it).
// ---------------------------------------------------------------------------------------------------------------------------------
/**
 * Per resident height tile, TENV_N x TENV_N bytes (one layer of an R8 array indexed by the tile's own layer): the highest horizon the tile march (horizonDegT at the
 * tile's own level, lodG and neighbour/4k fallback, exactly as the pixel shader runs it) gives from anywhere in the cell, in TENV_AZ azimuths. Sun-independent, so a Sun
 * change never rebuilds it; built when the tile is fully faded in and its neighbourhood has been quiet; cleared (code 0 = no bound) when a tile within the march's
 * reach arrives or leaves, or the layer is reused. A cell's value covers its sample points (TenvConfig), widened by the margin, rounded outward to ENV_Q_DEG. SAMPLED, not proven (like the 4k envelope): the test and the rig diff
 * measure it. The shader uses it as an upper bound of horizonAt along ANY direction, for the Sun march and for the viewer-visibility march.
 */
export const TENV_N = { desktop: 80, low: 30 }
/** Bytes a tile-envelope cell takes: eight azimuth sectors, one byte each. */
export const TENV_CELL_BYTES = 8
/** Cell sample points (cell-relative offsets from the centre; a cell spans -0.5..0.5): the nine of a 3 x 3 grid reach the cell's edges, or the five of its centre and corners pulled out. */
export const TENV_POINTS_9: ReadonlyArray<readonly [number, number]> = [[0, 0], [-0.75, -0.75], [0, -0.75], [0.75, -0.75], [-0.75, 0], [0.75, 0], [-0.75, 0.75], [0, 0.75], [0.75, 0.75]]
export const TENV_POINTS_5: ReadonlyArray<readonly [number, number]> = [[0, 0], [-0.75, -0.75], [0.75, -0.75], [-0.75, 0.75], [0.75, 0.75]]
/** 5 x 5 grid over the same reach (steps of 0.375 cell): `?tenvpts=25`. */
export const TENV_POINTS_25: ReadonlyArray<readonly [number, number]> = (() => { const o: Array<readonly [number, number]> = []; for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) o.push([i * 0.375, j * 0.375]); return o })()
export interface TenvConfig { az: number; points: ReadonlyArray<readonly [number, number]>; margin: number }
/** A tile-march skyline above this (deg) is stored as "no bound" and its march stops there (a Sun skip needs the Sun more than the certificate above the bound, and the shader marches only below 38 deg of Sun elevation). */
export const TENV_STOP_DEG = 36
/**
 * Azimuths per sample point (16: 22.5 deg apart), the cell's centre and four corners pulled out 0.75 cell, and a 1.5 deg margin. The tile march sees near walls whose horizon changes by
 * degrees within a texel, so this is denser and wider than the 4k envelope's (8 azimuths, 0.5 deg): on the synthetic ground of scripts/tile-envelope.test.mts at N = 80 that scheme
 * exceeds its cell's bound for 33 of 2500 random pixels/azimuths (worst 0.9 deg), this one for 2 (worst 0.11 deg; a 3 x 3 sample grid for none). A bound that is low by less than the Sun skip's
 * certificate less the lit ramp (about 3 deg) changes no pixel. SAMPLED, not proven: the rig diff at threshold 0 is the test. `?tenvaz=`, `?tenvpts=5|9`, `?tenvmargin=` tune it.
 */
export const TENV_DEFAULT: TenvConfig = { az: 24, points: TENV_POINTS_9, margin: 2.5 }
export function tenvConfig(search: string): TenvConfig {
  const q = new URLSearchParams(search)
  const az = Math.floor(Number(q.get('tenvaz')))
  const m = Number(q.get('tenvmargin'))
  return {
    az: Number.isFinite(az) && az >= 4 && az <= 64 ? az : TENV_DEFAULT.az,
    points: q.get('tenvpts') === '5' ? TENV_POINTS_5 : q.get('tenvpts') === '25' ? TENV_POINTS_25 : TENV_POINTS_9,
    margin: q.get('tenvmargin') !== null && q.get('tenvmargin') !== '' && Number.isFinite(m) && m >= 0 && m <= 10 ? m : TENV_DEFAULT.margin,
  }
}
/** Rows of one layer built per draw (a layer is TENV_BLOCKS draws; the scheduler spends the budget in these). */
export const TENV_BLOCKS = 4
export function tenvBytes(layers: number, n: number): number { return layers * n * n * TENV_CELL_BYTES }

/** The CPU twin's height source: metres above the datum at a body-frame unit vector. */
export type TenvHeightFn = (dir: readonly [number, number, number]) => number
/** The tile march's sample distances (km) for k = 0..63 (march.ts marchDistanceKm, the shader's TM_STEP / TM_G0 schedule). */
export const TENV_SAMPLES_KM: readonly number[] = (() => {
  const out: number[] = []
  for (let k = 0; k < 64; k++) out.push(k < 40 ? 0.25 * (k + 1) : 11 * Math.pow(300 / 11, (k - 40) / 23))
  return out
})()
/**
 * horizonDegT without the three halvings (they only raise it): the highest elevation (deg) of `hf` along the great circle from p toward t, over the tile march's samples.
 * The height at a sample is read through `hf` alone (the test supplies a synthetic ground; the shader's marchHQ is the real one).
 */
export function tenvHorizonDeg(hf: TenvHeightFn, p: readonly [number, number, number], t: readonly [number, number, number], h0?: number): number {
  const hOrigin = h0 ?? hf(p)
  let best = -0.5 * Math.PI
  for (const d of TENV_SAMPLES_KM) {
    const th = d / GH_R_KM
    const s = Math.sin(th), omc = 1 - Math.cos(th)
    const q: [number, number, number] = [p[0] * (1 - omc) + t[0] * s, p[1] * (1 - omc) + t[1] * s, p[2] * (1 - omc) + t[2] * s]
    const ql = Math.hypot(q[0], q[1], q[2]); q[0] /= ql; q[1] /= ql; q[2] /= ql
    const hq = hf(q)
    const rq = GH_R_KM + hq * 0.001
    best = Math.max(best, Math.atan2((hq - hOrigin) * 0.001 - rq * omc, rq * s))
  }
  return best / RAD
}
/** One cell of the tile envelope before quantisation, per azimuth sector: the highest tile-march horizon over the sample points and `cfg.az` azimuths, grouped by sector (sectorMaxima), plus the margin. `dirAt(fx, fy)` is the body-frame unit vector at tile position (fx, fy) in tile units (0..1; outside is the neighbours'). */
export function tenvCellSectors(hf: TenvHeightFn, dirAt: (fx: number, fy: number) => [number, number, number], n: number, i: number, j: number, cfg: TenvConfig = TENV_DEFAULT): number[] {
  const per = new Array<number>(cfg.az).fill(-90)
  for (const [dx, dy] of cfg.points) {
    const p = dirAt((i + 0.5 + dx) / n, (j + 0.5 + dy) / n)
    const h0 = hf(p)
    for (let a = 0; a < cfg.az; a++) per[a] = Math.max(per[a], tenvHorizonDeg(hf, p, ghTangent(p, a * 2 * Math.PI / cfg.az), h0))
  }
  return sectorMaxima(per).map((v) => v + cfg.margin)
}
/** A tile layer's codes from the CPU twin: 8 sector bytes per cell, cell (i, j) at ((j * n + i) * 8 + sector). A sector above TENV_STOP_DEG is 255 (no bound). */
export function tenvBuildCpu(hf: TenvHeightFn, dirAt: (fx: number, fy: number) => [number, number, number], n: number, cfg: TenvConfig = TENV_DEFAULT): Uint8Array {
  const out = new Uint8Array(n * n * ENV_SECTORS)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = tenvCellSectors(hf, dirAt, n, i, j, cfg)
    for (let s = 0; s < ENV_SECTORS; s++) out[(j * n + i) * ENV_SECTORS + s] = v[s] - cfg.margin > TENV_STOP_DEG ? 255 : envEncode(v[s])
  }
  return out
}
/** The shader's read: the bound (deg) for tile position (fx, fy), or null (unbuilt, no bound). */
export function tenvLookup(codes: Uint8Array, n: number, fx: number, fy: number, azimuth: number): number | null {
  const i = Math.min(n - 1, Math.max(0, Math.floor(fx * n))), j = Math.min(n - 1, Math.max(0, Math.floor(fy * n)))
  const c = codes[(j * n + i) * ENV_SECTORS + sectorOfAzimuth(azimuth)]
  if (c === ENV_UNBUILT || c >= 255) return null
  return envDecode(c)
}
/** The bound the shader forms for a pixel from its two parts: w = 0 the 4k envelope alone; w = 1 the tile's alone; between, the same mix as horizonAt's (null when either needed part is missing). */
export function tenvBound(w: number, em: number | null, te: number | null): number | null {
  if (w <= 0) return em
  if (te === null) return null
  if (w >= 1) return te
  return em === null ? null : em * (1 - w) + te * w
}
/** `?tenv=0` keeps the live tile march (A/B). */
export function tenvOn(search: string): boolean { return new URLSearchParams(search).get('tenv') !== '0' }
/** Tile-pixel sub-pixel tap reuse margin (deg): a tap reuses the first tap's horizon only when its margin to that horizon exceeds the Sun disc's half-width by this much. An estimate (the horizon's spread over 0.375 of a tile texel on a steep rim is a few degrees), not a bound; `?ghsubt=<deg>` overrides, 0 = off for tile pixels. */
export const GH_SUBPX_TILE_DELTA_DEG = 0
/** Extra clearance (deg) a pixel with tile share must have over the combined bound, for the Sun skip and the viewer skip: the tile bound is sampled, so it is not trusted to the last 0.6 deg the 4k bound is. */
export const TENV_SUN_EXTRA_DEG = 2
export const TENV_VIEW_EXTRA_DEG = 4

// ---------------------------------------------------------------------------------------------------------------------------------
// Azimuth sectors (both envelopes). The max over ALL azimuths is loose where one far wall dominates; a pixel's Sun (or viewer) azimuth is known, so each cell stores the max
// horizon per 45 deg SECTOR of azimuth, packed as eight bytes (two uint32 of an RG32UI texel). The sector for azimuth a holds the horizon of every sampled azimuth within
// ENV_SECTOR_PAD_DEG of the sector's edges, so a lookup reads the one sector the azimuth falls in. Azimuth is the build's own: t = cos a * e + sin a * n, e = normalize(cross(K, p) + 1e-6), n = cross(p, e), a counted from e.
// ---------------------------------------------------------------------------------------------------------------------------------
export const ENV_SECTORS = 8
export const ENV_SECTOR_DEG = 360 / ENV_SECTORS
/** An azimuth sample counts for a sector when it is within this (deg) of the sector's edges: at most half the azimuth spacing (22.5 deg for 16, 15 deg for 24 samples) plus slack. */
export const ENV_SECTOR_PAD_DEG = 11.25
/** 4k-map envelope width by class with sectors (height is half): 8 bytes a texel, so 4.2 MB desktop, 1.05 MB phone class. Cells are coarse, so the cell is sampled on a 3 x 3 grid. */
export const ENV_SECTOR_WIDTH = { desktop: 1024, low: 512 }
export const ENV_SECTOR_BYTES = 8
export const ENV_SECTOR_AZ = 32
/** `?ghaz=<n>` (a multiple of 8, 8..96) overrides the 4k envelope's azimuth samples (a tuning knob; the default is ENV_SECTOR_AZ). */
export function sectorAzFromSearch(search: string): number {
  const n = Math.floor(Number(new URLSearchParams(search).get('ghaz')))
  return n >= 8 && n <= 96 && n % 8 === 0 ? n : ENV_SECTOR_AZ
}
export function envSectorBytes(width: number): number { return width * (width >> 1) * ENV_SECTOR_BYTES }
/** Sector of an azimuth (radians from e). */
export function sectorOfAzimuth(az: number): number {
  const deg = ((az / RAD) % 360 + 360) % 360
  return Math.min(ENV_SECTORS - 1, Math.floor(deg / ENV_SECTOR_DEG))
}
/** Per-sector maxima of horizons sampled at `n` equally spaced azimuths (index i at angle i * 360 / n): sector s takes every sample within ENV_SECTOR_PAD_DEG of [s * 45, (s + 1) * 45]. */
export function sectorMaxima(perAz: ArrayLike<number>): number[] {
  const n = perAz.length
  const out: number[] = new Array(ENV_SECTORS).fill(-90)
  for (let s = 0; s < ENV_SECTORS; s++) {
    const centre = (s + 0.5) * ENV_SECTOR_DEG
    for (let i = 0; i < n; i++) {
      const d = Math.abs((((i * 360 / n - centre) % 360) + 540) % 360 - 180)
      if (d <= ENV_SECTOR_DEG / 2 + ENV_SECTOR_PAD_DEG + 1e-9) out[s] = Math.max(out[s], perAz[i])
    }
  }
  return out
}
/**
 * The 4k envelope's texel before quantisation, per sector (the CPU twin of the sectored build pass): ENV_SECTOR_AZ azimuths, lods 0, 2, 4, 6, plus the margin. The cell is sampled on a
 * g x g grid out to 0.75 cell for the FINE lods (0 and 2: their horizons come from ridges a few km away, so they vary on the scale of a height texel, far below a cell) and on 3 x 3 for the coarse ones.
 */
export function envSectorGrid(g: number): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = []
  const c = (i: number): number => (g === 1 ? 0 : -0.75 + (1.5 * i) / (g - 1))
  for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) out.push([c(i), c(j)])
  return out
}
export const ENV_SECTOR_POINTS: ReadonlyArray<readonly [number, number]> = envSectorGrid(3)
/** Grid side for the fine lods (default ENV_FINE_GRID); `?ghpts=<n>` (3..9) overrides. */
export const ENV_FINE_GRID = 3
export function sectorGridFromSearch(search: string): number {
  const n = Math.floor(Number(new URLSearchParams(search).get('ghpts')))
  return n >= 3 && n <= 9 ? n : ENV_FINE_GRID
}
/** Lods read with the fine grid: the first ENV_FINE_LODS of ENV_LODS. */
export const ENV_FINE_LODS = 2
export function envTexelSectors(pyr: GhPyramid, w: number, h: number, i: number, j: number, az: number = ENV_SECTOR_AZ, grid: number = ENV_FINE_GRID): number[] {
  const per = new Array<number>(az).fill(-90)
  const pass = (pts: ReadonlyArray<readonly [number, number]>, lods: readonly number[]): void => {
    for (const [dx, dy] of pts) {
      const p = ghDir((i + 0.5 + dx) / w, Math.min(1 - 0.25 / h, Math.max(0.25 / h, (j + 0.5 + dy) / h)))
      for (let a = 0; a < az; a++) {
        const t = ghTangent(p, a * 2 * Math.PI / az)
        for (const lod of lods) per[a] = Math.max(per[a], ghHorizonDeg(pyr, p, t, lod))
      }
    }
  }
  pass(envSectorGrid(grid), ENV_LODS.slice(0, ENV_FINE_LODS))
  pass(ENV_SECTOR_POINTS, ENV_LODS.slice(ENV_FINE_LODS))
  return sectorMaxima(per).map((v) => v + ENV_MARGIN_DEG)
}
