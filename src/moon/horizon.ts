/**
 * The horizon line of a low view: how crisp and how smooth the skyline of the terrain is drawn against the sky (`?horizon=`).
 *
 * The shaders (moonShader.ts terrainResolve, ground/groundShader.ts groundHit) used to give a ray that HITS the ground a coverage of exactly 1
 * and a ray that MISSES one that ramps from 0.5 to 0 over half a pixel, so the skyline was one dim pixel above a hard staircase. These options
 * change that; `off` is the old picture. Everything here is the pure part: the option names, the sub-pixel sample offsets and the TS twins of the
 * GLSL maths, so scripts/horizon.test.mts can check them without a GPU.
 *
 *   aa4 / aa  the pixels the skyline can pass through (the Moon: rays whose closest approach lies inside the relief shell; the ground: far hits
 *             with sky one pixel above them, and near misses) are traced as 4 / 8 sub-pixel rays stacked across the pixel on the screen's vertical,
 *             and the coverage is their mean. A pixel off that band costs the same as before. Gesture frames keep the single ray.
 *   lp        the terrain march reads each sample at the level of detail of ITS OWN distance (times LP_FACTOR) instead of the nearest sample's,
 *             so the far skyline is a smooth filtered curve and not the texel grid of data finer than a pixel there. Near ground is unchanged.
 *   full      aa + lp (the default).
 *
 * With any aa mode the shaders also write the exposure key whole instead of premultiplied by coverage (`sunKey` in moonShader.ts and groundShader.ts):
 * the final pass fuses a short and a long exposure by that alpha, and a partly covered edge pixel with a key of its coverage was read on the long exposure,
 * which saturates, so even a smooth coverage came out as a hard step.
 */

export type HorizonMode = 'off' | 'aa4' | 'aa' | 'lp' | 'full'
export const HORIZON_MODES: readonly HorizonMode[] = ['off', 'aa4', 'aa', 'lp', 'full']
export const HORIZON_DEFAULT: HorizonMode = 'full'

/** Most sub-pixel rays the shader loops over (its loop bound). */
export const HORIZON_MAX_RAYS = 8
/** The far low-pass reads a sample at the level a pixel LP_FACTOR times as wide would pick. */
export const LP_FACTOR = 2

export interface HorizonSettings {
  /** Sub-pixel rays per band pixel (0: the single ray of before). */
  k: number
  /** The low-pass factor (0: off). */
  lp: number
}

export function horizonSettings(mode: HorizonMode): HorizonSettings {
  switch (mode) {
    case 'off': return { k: 0, lp: 0 }
    case 'aa4': return { k: 4, lp: 0 }
    case 'aa': return { k: 8, lp: 0 }
    case 'lp': return { k: 0, lp: LP_FACTOR }
    case 'full': return { k: 8, lp: LP_FACTOR }
  }
}

/** `?horizon=off|aa4|aa|lp|full`; anything else is the default. */
export function horizonFromSearch(search: string): HorizonMode {
  const v = new URLSearchParams(search).get('horizon')
  return v !== null && (HORIZON_MODES as readonly string[]).includes(v) ? (v as HorizonMode) : HORIZON_DEFAULT
}

/** The k stratified offsets, in pixels, of the sub-pixel rays across one pixel (up positive): (i + 0.5) / k - 0.5. */
export function subRayOffsets(k: number): number[] {
  const n = Math.max(0, Math.min(HORIZON_MAX_RAYS, Math.floor(k)))
  return Array.from({ length: n }, (_, i) => (i + 0.5) / n - 0.5)
}

/** Coverage of one ray that clears the ground by `clear` (same unit as `px`, the extent the ray stands for): 1 under it, a ramp over one `px` above. */
export function rayCover(hit: boolean, clear: number, px: number): number {
  if (hit) return 1
  return Math.min(1, Math.max(0, 0.5 - clear / px))
}

/**
 * The twin of terrainResolve's band loop for a sphere with no relief: the pixel whose closest-approach distance is b0 (Moon radii) with
 * `pxR` of b per pixel, traced as k sub-rays. For a sphere a ray's clearance is b - 1 and it hits when b < 1.
 */
export function limbCoverSS(b0: number, pxR: number, k: number): number {
  const offs = subRayOffsets(k)
  if (!offs.length) return rayCover(b0 < 1, b0 - 1, pxR)
  let sum = 0
  for (const o of offs) {
    const b = b0 + o * pxR
    sum += rayCover(b < 1, b - 1, pxR / offs.length)
  }
  return sum / offs.length
}

/** The exact share of a pixel inside a straight edge (what an ideal antialiaser gives): b0 is the pixel centre's distance past the edge, in pixels. */
export function exactEdgeCover(centreInsidePx: number): number {
  return Math.min(1, Math.max(0, centreInsidePx + 0.5))
}

/**
 * The twin of the march's per-sample level: the tile level (0 = finest built, 2 = coarsest) a height sample at footprint `fpKm` is read at under
 * the low-pass, never finer than the level the nearest sample picked (`floorLevel`). `thKm` is the finest level's texel size.
 */
export function lowpassLevel(fpKm: number, thKm: number, floorLevel: number, lp: number): number {
  if (lp <= 0) return floorLevel
  const lf = Math.log2(Math.max(1, (lp * fpKm) / thKm))
  return Math.min(2, Math.max(floorLevel, Math.floor(lf + 0.5)))
}

/**
 * `?flighthz=1`: a scripted-flight frame keeps the rest terrain march and the skyline's sub-pixel rays (a flight frame is otherwise a motion frame: 12 samples
 * per grazing ray, no horizon AA). Also on under `?sharp=1` unless `?flighthz=0`. Default off: a motion default changes only with a rig measurement (ledger).
 */
export function flightHzOn(param: string | null, sharpOn: boolean): boolean {
  if (param === '1') return true
  if (param === '0') return false
  return sharpOn
}
