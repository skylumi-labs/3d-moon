/**
 * The star limiting-magnitude cull (R59). A star whose brightest pixel lands below what the display can show is drawn for nothing: every Gaussian sprite
 * costs its vertex and a 5 x 5 point's fragments. The catalogue is sorted faintest-last once, so a limit is a draw range, not a per-frame pass.
 *
 * The limit follows the exposure: peak (stored units) = flux * uIf0 * preExpose * PEAK_W * COLOUR_MAX * lift, against the display white
 * (`white * preExpose`, the same quantity main.ts scales the boost cap by). preExpose cancels, so the limit is flux * uIf0 * K < white * FLOOR.
 * FLOOR is far below the first sRGB step (1.5e-4 of white after the tone curve), so a culled star is one that could not have changed an 8-bit pixel.
 * That is a statement about this exposure model, not a measurement: no screenshot or GPU timing backs it yet (see the experiments ledger).
 *
 * `?starmag=off` draws the whole catalogue (the previous behaviour); `?starmag=N` pins a fixed limit in V magnitude, 0..8.
 */
export const PEAK_W = 1 / (2 * Math.PI * 0.49)   // the Gaussian's peak weight in the fragment shader (sigma^2 = 0.49)
export const COLOUR_MAX = 3                       // the largest channel of an aColor (luminance 1)
export const VISIBLE_FLOOR = 5e-5                 // of display white, linear, before the tone curve
export const MAG_STEP = 0.25                      // the limit moves in steps, so the draw range is steady

export type StarMagConfig = { mode: 'auto' } | { mode: 'off' } | { mode: 'fixed'; mag: number }

export function starMagOf(search: string): StarMagConfig {
  const raw = new URLSearchParams(search).get('starmag')
  if (raw === 'off' || raw === '0') return { mode: 'off' }
  if (raw !== null && raw !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0 && n <= 8) return { mode: 'fixed', mag: n }
  }
  return { mode: 'auto' }
}

/**
 * The faintest V magnitude still worth drawing, or Infinity when nothing may be culled. `if0` is the I/F of one pixel holding all of a 0 mag star
 * (StarPass.uniforms.uIf0), `white` the exposure's display white in I/F, `gain` the boost lift that applies (1 when the boost is off).
 */
export function limitingMag(if0: number, white: number, gain = 1): number {
  if (!(if0 > 0) || !(white > 0) || !Number.isFinite(if0) || !Number.isFinite(white)) return Infinity
  const peak0 = if0 * PEAK_W * COLOUR_MAX * Math.max(1, gain)   // a 0 mag star's brightest channel
  const m = 2.5 * Math.log10(peak0 / (white * VISIBLE_FLOOR))
  if (!Number.isFinite(m)) return Infinity
  return Math.ceil(m / MAG_STEP) * MAG_STEP   // round toward drawing more
}

/** How many of the first stars (sorted brightest first, `mags` ascending) are at or brighter than `limit`. */
export function countWithin(mags: ArrayLike<number>, limit: number): number {
  if (limit === Infinity) return mags.length
  let lo = 0, hi = mags.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (mags[mid] <= limit) lo = mid + 1; else hi = mid }
  return lo
}

export function drawCount(cfg: StarMagConfig, mags: ArrayLike<number>, if0: number, white: number, gain = 1): number {
  if (cfg.mode === 'off') return mags.length
  return countWithin(mags, cfg.mode === 'fixed' ? cfg.mag : limitingMag(if0, white, gain))
}
