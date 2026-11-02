/**
 * The shadow march's schedule and geometry (DESIGN-M2.md section 6, candidate
 * B), in one place so the shader (moonShader.ts pastes these constants) and
 * its CPU mirror (scripts/march.test.mts, over real tiles) cannot drift apart.
 *
 * 64 samples along the great circle toward the Sun: 40 of 0.25 km (out to
 * 10 km, where a 1 km rim casts its whole 12 texel shadow at Sun 10 deg), then
 * 24 geometric from 11 km to 300 km. Each sample reads the tile level whose
 * texel is about 1/0.06 of the step's distance, so far samples are filtered
 * (tiles carry no mips; levels 1 and 2 are the box-filtered copies).
 */
import { heightTexelKm } from './tiles/grid'

export const MARCH_LINEAR_N = 40
export const MARCH_LINEAR_STEP_KM = 0.25
export const MARCH_GEO_N = 24
export const MARCH_GEO_START_KM = 11
export const MARCH_MAX_KM = 300
export const MARCH_N = MARCH_LINEAR_N + MARCH_GEO_N
/**
 * Near samples (site patches only): where a patch's 2 m heights are under the origin, MARCH_NEAR_N
 * more samples, geometric from 5 m to just under the first linear step (250 m), catch the shadows of features
 * far smaller than the 250 m step (a 20 m rim casts a 60 m shadow at Sun 14 deg). They read the same
 * fused ground (patch over tiles) as the rest of the march, so the origin and every sample agree.
 */
export const MARCH_NEAR_N = 12
export const MARCH_NEAR_START_KM = 0.005
export function marchNearDistanceKm(k: number): number {
  return MARCH_NEAR_START_KM * Math.pow(MARCH_LINEAR_STEP_KM / MARCH_NEAR_START_KM, k / MARCH_NEAR_N)
}
/**
 * Deep near samples (a tile set deeper than level 0): MARCH_DEEP_NEAR_N more, geometric from one level -3 texel (59 m) to the first linear
 * step (250 m). Without them the 250 m steps read 59 m data at 4-texel strides and a rim 100 m from the origin casts no shadow. Where a site
 * patch is under the origin its own near loop (above) runs instead of these.
 */
export const MARCH_DEEP_NEAR_N = 6
export const MARCH_DEEP_NEAR_START_KM = 0.06
export function marchDeepNearDistanceKm(k: number): number {
  return MARCH_DEEP_NEAR_START_KM * Math.pow(MARCH_LINEAR_STEP_KM / MARCH_DEEP_NEAR_START_KM, k / MARCH_DEEP_NEAR_N)
}

/** Sample distance d reads a texel of about MARCH_MIP * d. */
export const MARCH_MIP = 0.06

/** The coarsest tile level (TILE_LEVELS - 1): the march falls back to it at any distance, so its reach is the whole march. */
const COARSEST_LEVEL = 2
/** Margin on the texel the shader was handed (the manifest rounds it to four digits): the reach is only ever rounded up. */
const REACH_MARGIN = 1.01

/**
 * How far (km, ground distance from the march origin) a tile of `level` can be read by a march sample. marchLevel picks level L for
 * lod = log2(MARCH_MIP * d / texel0) < L + 0.5, and marchH reads a tile only at or coarser than that level, so a level-L tile is read only
 * for d < texel0 * 2^L * sqrt2 / MARCH_MIP (level 0: about 11 km, level 1: 22 km, level -3: 1.4 km). The coarsest level is the fallback
 * everywhere, so it keeps MARCH_MAX_KM. Never above MARCH_MAX_KM. The tiles' own sizes are added by the caller, not here.
 */
export function marchReachKm(level: number): number {
  if (level >= COARSEST_LEVEL) return MARCH_MAX_KM
  return Math.min(MARCH_MAX_KM, heightTexelKm(level) * Math.SQRT2 / MARCH_MIP * REACH_MARGIN)
}

/** `?shreach=300` restores the flat 300 km invalidation reach for every level (today's behaviour); anything else uses the per-level reach. */
export function shReachOn(search: string): boolean { return new URLSearchParams(search).get('shreach') !== '300' }

export function marchDistanceKm(k: number): number {
  if (k < MARCH_LINEAR_N) return MARCH_LINEAR_STEP_KM * (k + 1)
  return MARCH_GEO_START_KM * Math.pow(MARCH_MAX_KM / MARCH_GEO_START_KM, (k - MARCH_LINEAR_N) / (MARCH_GEO_N - 1))
}

/**
 * Tile level a sample at `dKm` reads: the shader's `marchLevel`. `levels` is the count of built levels (3); `deepest` is the finest level
 * the set has (0, or -1 to -4 with a manifest `deeper` block): the lower clamp, and the floor of the texel ratio, are 2^deepest.
 */
export function marchLevel(dKm: number, texelKm: number, levels = 3, deepest = 0): number {
  const lod = Math.log2(Math.max(2 ** deepest, MARCH_MIP * dKm / texelKm))
  return Math.max(deepest, Math.min(levels - 1, Math.floor(lod + 0.5)))
}

/**
 * Elevation (rad) of a sample `dh` metres above the origin, `dKm` along the
 * ground, on a sphere of `rKm` with the samples' own heights `hq`, `h0`
 * (metres). Rise over run in the local frame: the difference of two
 * 1,737 km vectors would lose the metre-scale rise in float32 (the app's own
 * doc records a 17.8 deg error from that), so the curvature drop is written as
 * 2 R sin^2(theta/2).
 */
export function sampleElevation(hq: number, h0: number, dKm: number, rKm: number): number {
  const th = dKm / rKm
  const s = Math.sin(0.5 * th)
  const rq = rKm + hq * 0.001
  const rise = (hq - h0) * 0.001 - rq * 2 * s * s
  const run = rq * Math.sin(th)
  return Math.atan2(rise, run)
}

/**
 * sin(x) and 1 - cos(x) by series, valid to 0.18 rad (the march's largest angle, 300 km on the
 * Moon): the CPU twin of the shaders' sinSmall and omcSmall. GLSL does not require trig to be
 * accurate near zero, and one GPU (SwiftShader) was off by ~2e-4 there, which at the first step
 * (1.5 km out on a 1,737 km sphere) turned flat mare into a 17 deg skyline. Errors at 0.18 rad:
 * 1.2e-9 and 3e-11.
 */
export function sinSmall(x: number): number {
  const x2 = x * x
  return x * (1 - x2 / 6 * (1 - x2 / 20))
}
export function omcSmall(x: number): number {
  const x2 = x * x
  return 0.5 * x2 * (1 - x2 / 12 * (1 - x2 / 30))
}
