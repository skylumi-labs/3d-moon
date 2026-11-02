/**
 * The coarse exposure search of a user gesture (`computeExposure` with `coarse`: 20 rows, albedo mip +2, no relief lift) finds a LOWER brightest ground
 * than the full search at rest, because it misses the small bright spots. Measured at the Copernicus pin (software GL, 2026-10-11): 0.38 to 0.46 of the
 * rest value, i.e. the white point 1.1 to 1.4 stops low (the picture that much too bright) all through a drag, and a step of that size at release.
 *
 * The bias is a property of the view and moves as the view does (within half a second when a zoom leaves the surface), so it is measured rather than assumed: one full search next to the coarse one
 * on the gesture's first frame, refreshed every quarter second, and every coarse answer in between is multiplied by the ratio. The release then lands where the
 * gesture was already exposed, and the search cost of a gesture stays the coarse one except for that one frame in a few.
 */

/** A gesture re-measures the coarse/full ratio this often (ms): the bias moves within half a second when a zoom leaves the surface (measured), so a slower refresh would hold a stale ratio. One full search per refresh. */
export const COARSE_GAIN_REFRESH_MS = 250
/** The ratio is held inside this many stops of 1: a degenerate frame (a search that found almost nothing) must not swing the exposure. */
export const COARSE_GAIN_MAX_STOPS = 3
/** A refresh moves the held ratio this share of the way to the new measurement (in stops), so a camera crossing a bright patch does not step the picture. */
export const COARSE_GAIN_BLEND = 0.7

/** The ratio to apply to a coarse `bestA`, from a full and a coarse search of the same camera; 1 when either found no lit ground. */
export function coarseGainOf(fullBestA: number, coarseBestA: number): number {
  if (!(fullBestA > 0) || !(coarseBestA > 0) || !Number.isFinite(fullBestA) || !Number.isFinite(coarseBestA)) return 1
  const limit = Math.pow(2, COARSE_GAIN_MAX_STOPS)
  return Math.min(limit, Math.max(1 / limit, fullBestA / coarseBestA))
}

/** The held ratio of one gesture. `reset()` at rest so the next gesture measures afresh on its first frame. */
export class CoarseGain {
  private g = 1
  private at = -Infinity
  private have = false
  /** The ratio to multiply a coarse answer by (1 until measured). */
  get gain(): number { return this.g }
  /** True on a gesture's first frame and then every COARSE_GAIN_REFRESH_MS. */
  due(now: number): boolean { return !this.have || now - this.at >= COARSE_GAIN_REFRESH_MS || now < this.at }
  /** Folds in a measurement (see `coarseGainOf`). The first one is taken whole, later ones blend in the log domain. */
  update(now: number, measured: number): void {
    this.g = this.have ? Math.exp(Math.log(this.g) + (Math.log(measured) - Math.log(this.g)) * COARSE_GAIN_BLEND) : measured
    this.have = true
    this.at = now
  }
  reset(): void { this.g = 1; this.at = -Infinity; this.have = false }
}
