/**
 * The canvas pixel ratio as a pure function of the device, the class and the camera's distance (REVIEW-phone-perf S4).
 * Close to the surface the terminator march is the cost and the picture is magnified terrain, so a phone class ramps its ratio down to
 * `closeCap`; the owner of the call (main.ts render) applies the result only between gestures, so the canvas is never resized mid-drag.
 */

/** Camera radii at and under which the close cap applies in full. */
export const CLOSE_DPR_FROM = 1.8
/** Camera radii at and over which the ordinary cap applies; between the two the ratio blends linearly. */
export const CLOSE_DPR_TO = 2.4
/** Ratios are rounded to this step so a slow dolly does not resize on every frame at rest. */
export const DPR_STEP = 0.05

export interface DprInput {
  /** `window.devicePixelRatio`. */
  native: number
  /** The class's cap. */
  cap: number
  /** The class's close-in cap, when it has one. */
  closeCap?: number
  /** Camera distance, Moon radii. */
  dist: number
  /** `?dpr=`: taken verbatim. */
  override?: number
}

export function dprFor(i: DprInput): number {
  if (i.override !== undefined) return i.override
  const native = Number.isFinite(i.native) && i.native > 0 ? i.native : 1
  const far = Math.min(native, i.cap)
  if (i.closeCap === undefined || !Number.isFinite(i.dist)) return far
  const close = Math.min(far, i.closeCap)
  const t = Math.min(1, Math.max(0, (i.dist - CLOSE_DPR_FROM) / (CLOSE_DPR_TO - CLOSE_DPR_FROM)))
  const v = close + (far - close) * t
  // The quantised value never leaves [close, far].
  return Math.min(far, Math.max(close, Math.round(v / DPR_STEP) * DPR_STEP))
}

/** Canvases (at the full ratio) over this many device pixels get the motion ratio cap, when the class or `?mdpr=` has one. The owner's 1580x935 CSS window at DPR 2 is 4.58 Mpx. */
export const MOTION_DPR_FROM_PX = 3e6
/**
 * The ratio MOTION frames are drawn at (rest-to-motion, WP-A, `?mdpr=1.5`): `full` (the ratio `dprFor` chose, which the rest frames keep) unless the canvas at that ratio
 * is over `fromPx` device pixels and a `cap` is set, then the lower of the two. Rest frames are untouched: the canvas keeps the full ratio and a motion frame keeps
 * `cap` worth of pixels through the motion grid (the phone classes' `restDprCap` path). Quantised to DPR_STEP, never under it.
 */
export function motionDprFor(full: number, cap: number | undefined, cssPx: number, fromPx = MOTION_DPR_FROM_PX): number {
  if (cap === undefined || !(cap > 0) || !(cssPx * full * full > fromPx)) return full
  return Math.max(DPR_STEP, Math.min(full, Math.round(cap / DPR_STEP) * DPR_STEP))
}
/** `?mdpr=1.5`: a finite value in (0, 4], else undefined (the class row stands). */
export function motionDprCapFromSearch(search: string): number | undefined {
  const raw = new URLSearchParams(search).get('mdpr')
  if (raw === null || raw.trim() === '') return undefined
  const v = Number(raw)
  return Number.isFinite(v) && v > 0 && v <= 4 ? v : undefined
}

/** `?dpr=1.25`: a finite value in (0, 4], else undefined. */
export function dprOverrideFromSearch(search: string): number | undefined {
  const raw = new URLSearchParams(search).get('dpr')
  if (raw === null || raw.trim() === '') return undefined
  const v = Number(raw)
  return Number.isFinite(v) && v > 0 && v <= 4 ? v : undefined
}

/** `?restdpr=2` caps the rest-frame ratio, `?restdpr=off` turns the class default off; else the class default. */
export function restDprFromSearch(search: string, dflt: number | undefined): number | undefined {
  const raw = new URLSearchParams(search).get('restdpr')
  if (raw === null || raw.trim() === '') return dflt
  if (raw === 'off') return undefined
  const v = Number(raw)
  return Number.isFinite(v) && v > 0 && v <= 4 ? v : dflt
}

/** A rest frame slower than this (ms) counts toward lowering the rest ratio. */
export const REST_SLOW_MS = 100
/** Consecutive slow rest frames before one step down. */
export const REST_SLOW_FRAMES = 2
/** Each step multiplies the rest ratio by this; the factor never goes under REST_FACTOR_MIN. */
export const REST_STEP = 0.85
export const REST_FACTOR_MIN = 0.5

/** Recovery (phone policy): consecutive rest frames whose cost one step finer is predicted under this share of REST_SLOW_MS. */
export const REST_RECOVER_SHARE = 0.7
export const REST_RECOVER_FRAMES = 3
/** The phone policy's rest floor: the factor never goes under this (rest ratio 2 -> 1.5 at worst, against 1.25 before). */
export const PHONE_REST_FACTOR_MIN = 0.75
export interface RestGovernorOpts { recover?: boolean; factorMin?: number }

/** Classes whose web build runs the governor (phones). The native shell keeps it for every non-desktop class (it did before the web build had it). */
const GOVERNED_WEB_CLASSES: readonly string[] = ['ios', 'phone-android']

/**
 * Whether the rest-frame governor runs (R56, W3-M3). Native shell: every non-desktop class, as before. Web: the phone classes (`ios`, `phone-android`);
 * the website on a desktop, tablet or software class draws rest frames as always. `?restgov=0` turns it off anywhere, `?restgov=1` turns it on for any
 * non-desktop class (an A/B on the rig). It only ever lowers the rest ratio and never under the motion ratio, so a class with no `restDprCap` is untouched.
 */
export function restGovernorOn(cls: string, nativeShell: boolean, search: string): boolean {
  const raw = new URLSearchParams(search).get('restgov')
  if (raw === '0') return false
  if (cls === 'desktop') return false
  if (raw === '1') return true
  return nativeShell || GOVERNED_WEB_CLASSES.includes(cls)
}

/** The pixel ratio is chosen again only between gestures (a canvas resize mid-drag reallocates every target), or when none is chosen yet (0). */
export function mayChooseRestRatio(gestureOn: boolean, restDpr: number): boolean {
  return !gestureOn || restDpr === 0
}

/**
 * After a governor step, the rest ratio to carry on with: 0 (choose again at the next render) unless a gesture is running, in which case the
 * ratio stays fixed and the lowered factor is picked up when the gesture has ended.
 */
export function restRatioAfterFold(changed: boolean, gestureOn: boolean, restDpr: number): number {
  return changed && !gestureOn ? 0 : restDpr
}

/**
 * Lowers the rest-frame pixel ratio when full-size frames at rest cost over REST_SLOW_MS, one step per REST_SLOW_FRAMES slow frames in a row.
 * It only lowers (like the memory ceiling), this session only, and never takes the rest ratio under the motion ratio: when the two are equal
 * the motion ladder is the lever. Off (disabled) it changes nothing, so the website, which does not enable it, draws as before.
 */
export class RestDprGovernor {
  factor = 1
  private slow = 0
  private healthy = 0
  /** Steps taken down and back up since the page loaded (perf). */
  downs = 0
  ups = 0
  private readonly factorMin: number
  private readonly recover: boolean
  /** `opts` (the phone policy, quality/phoneSharp.ts): `recover` steps back up after sustained healthy rest frames; `factorMin` is the explicit floor. Absent: the original only-lowers governor. */
  constructor(private readonly enabled: boolean, opts?: RestGovernorOpts) {
    this.factorMin = opts?.factorMin ?? REST_FACTOR_MIN
    this.recover = opts?.recover ?? false
  }
  /** Folds one rest frame's cost; true when the factor changed (the ratio must be recomputed). Non-finite or non-positive costs are ignored. */
  fold(ms: number): boolean {
    if (!this.enabled || !(ms > 0) || !Number.isFinite(ms)) return false
    if (ms <= REST_SLOW_MS) {
      this.slow = 0
      // Recovery: the frame's cost one step finer (pixel count, (1 / REST_STEP)^2) still well inside REST_SLOW_MS, REST_RECOVER_FRAMES times in a row.
      if (!this.recover || this.factor >= 1) return false
      if (ms / (REST_STEP * REST_STEP) > REST_RECOVER_SHARE * REST_SLOW_MS) { this.healthy = 0; return false }
      if (++this.healthy < REST_RECOVER_FRAMES) return false
      this.healthy = 0
      this.factor = Math.min(1, this.factor / REST_STEP)
      if (this.factor > 0.995) this.factor = 1
      this.ups++
      return true
    }
    this.healthy = 0
    if (++this.slow < REST_SLOW_FRAMES || this.factor <= this.factorMin) return false
    this.slow = 0
    this.factor = Math.max(this.factorMin, this.factor * REST_STEP)
    this.downs++
    return true
  }
  /** The rest ratio after scaling: quantised to DPR_STEP, between the motion ratio and the unscaled rest ratio. */
  apply(restDpr: number, motionDpr: number): number {
    if (this.factor >= 1 || restDpr <= motionDpr) return restDpr
    const scaled = Math.round((restDpr * this.factor) / DPR_STEP) * DPR_STEP
    return Math.min(restDpr, Math.max(motionDpr, scaled))
  }
}
