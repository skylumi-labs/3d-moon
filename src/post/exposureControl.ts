import type { Exposure } from './exposure'

/**
 * The exposure's memory.
 *
 * computeExposure (exposure.ts) reads one frame and answers for that frame
 * alone, so every change in what the frame holds (the Moon's limb leaving, a
 * crescent thickening past a quarter, a site coming into pixels) re-exposes the
 * picture at once. A camera does not: its exposure is chosen by something
 * that watches the scene over time. This file is that something.
 *
 * - The white point and the long exposure's key move in LOG space (stops) at
 *   a bounded rate, with an exponential approach, so a change is a ramp, never
 *   a step, and the approach cannot overshoot its target.
 * - The other blend controls (fuse, long exposure cap, star lift) move
 *   linearly under the same kind of limit.
 * - With nothing to expose for (the Moon out of frame, no Earth or Sun in
 *   it either) the controller HOLDS the last exposure instead of falling to
 *   the star key, so what comes back into frame arrives at the exposure it
 *   left at.
 * - A captured still (?still=1) jumps straight to the target, so frames stay
 *   deterministic.
 *
 * `planEnvelope` is the anticipatory half, for a scripted journey whose frames
 * can be searched ahead of time: it turns a raw white-point track into one
 * that starts rising before the bright thing arrives and lets go of it
 * slowly, never clipping and never steeper than a set slope.
 */

/** Rates and time constants. Stops are factors of two in the white point. */
export const EXPOSURE_RATES = {
  /** The white point rising (the scene got brighter, the picture darkens): base rate, stops per second, and its time constant, s. */
  upStopsPerS: 1.5,
  upTau: 0.2,
  /** The white point falling (the scene got darker, the picture brightens): slower, as an eye adapts to the dark. */
  downStopsPerS: 0.6,
  downTau: 0.5,
  /**
   * A rising white point over a gap of more than this many stops is a change of subject (the Earth or the Sun entering the frame, a
   * time jump), not drift: the rate grows by `burstPerStop` stops per second for each further stop of gap, up to `maxStopsPerS`.
   */
  burstFromStops: 1,
  burstPerStop: 1,
  maxStopsPerS: 3,
  downBurstFromStops: 2,
  downBurstPerStop: 0.4,
  maxDownStopsPerS: 2.5,
  /**
   * The white point falling during a scripted move (a pin's fly-to) and for `journeySettleS` after it: the frame fills with ground in the last
   * second of the approach and the raw white drops 1 to 2 stops in half a second, so at the eye's pace (0.6 stops/s) the picture sat a stop
   * too dark for three seconds after arrival, and read as a dip and a slow brightening (Copernicus, WP10). A scripted move knows where it
   * is going, so it may follow the frame down at about the rate it rose at.
   */
  journeyDownStopsPerS: 2,
  journeyDownTau: 0.25,
  journeySettleS: 2.5,
  /** Linear controls (fuse 0..1, star lift 0..1, long exposure cap): full range per second. */
  linearPerS: 1.2,
  linearTau: 0.5,
}

/**
 * The exposure after a user gesture (a drag, a wheel zoom, a time-slider release) has ended: the picture is at rest and its brightness must
 * follow the new frame within about half a second, not the 2 to 3 s of the eye-pace ease (owner decision 2026-10-07). Both directions use the
 * same exponential approach (it cannot overshoot: the step is capped by the gap), only quicker. 3 stops are inside 0.05 stop well before 0.5 s.
 * The converged exposure is the raw target either way. Scripted journeys and the eclipse Moon rise keep their own rates.
 */
export const SETTLE_RATES = { stopsPerS: 10, tau: 0.08, linearPerS: 5, linearTau: 0.1 }
/** How long after a gesture ends the settle rates apply, ms. */
export const SETTLE_WINDOW_MS = 1500

/** `?expsnap=0` restores the old settle and subject-anchor behaviour. On by default. */
export const EXP_SNAP_ON = typeof location === 'undefined' || new URLSearchParams(location.search).get('expsnap') !== '0'
/** With EXP_SNAP_ON: a critically-damped settle after a gesture, converging within ~150-300 ms with no overshoot. */
export const SNAP_SETTLE_RATES = { stopsPerS: 16, tau: 0.055, linearPerS: 8, linearTau: 0.06 }
/** How long after a gesture ends the snap settle rates apply, ms. */
export const SNAP_SETTLE_WINDOW_MS = 300
/** With EXP_SNAP_ON, while a gesture is live: the target is followed smoothly so terminator crossings do not flicker or pump. */
/** While a gesture is live no frame moves the applied white by more than this (stops), whatever the frame interval: a 30 Hz frame at 5 stops/s would step 0.17. */
export const MOTION_MAX_STEP_STOPS = 0.1
export const MOTION_TRACK_RATES = { upStopsPerS: 5, upTau: 0.18, downStopsPerS: 4, downTau: 0.22 }

/** A moving eclipse Moon rise is a known, short scripted transition. Follow its brightening promptly without changing the ordinary meter. */
export const SCRIPTED_MOON_EXPOSURE = {
  upStopsPerS: 12,
  upTau: 0.08,
  maxStopsPerS: 14,
  hdrPerS: 5,
  hdrTau: 0.2,
}

/** The largest gap dt may be treated as one step of: a hidden tab's first frame back must not teleport the state. */
const MAX_DT = 0.25

const LOG2 = Math.LOG2E
/**
 * An exponential approach never arrives: its gap shrinks by a fixed share each frame until it is a rounding step, and then the value stops
 * a hair short of the target for good. `moving` (which keeps the render loop drawing every frame) compared the value with the target, so the
 * loop never idled. Inside this gap the value lands on the target: 0.001 stop, far below anything the eye or an 8-bit frame can tell.
 */
export const REST_STOPS = 1e-3
/**
 * Hysteresis for a picture that has come to rest: a target that wanders by less than this (stops) from where the exposure sits is not chased. The raw
 * target is a search over streamed tiles and jitters by a few thousandths as they arrive; chasing it kept the loop drawing a full frame every frame
 * at rest. 0.02 stop is 1.4 percent, under what an 8-bit frame can show. A larger change moves it as before, and it settles on the target it is given.
 */
export const REST_DEADBAND_STOPS = 0.02
export const REST_DEADBAND_LINEAR = 0.002
/** The same for a linear control (long-exposure fuse, star lift, long max: all of order 0.01 to 1). */
export const REST_LINEAR = 1e-4
/** A change of the frame's own white point over this many stops in one frame, unseen by the look-ahead, is a cut. */
export const CUT_STOPS = 1
/** Anticipation plans at this share of the rising rate, so the approach's lag is margin, not an overshoot. */
const ANTICIPATION_SLOPE = 0.5
/** The steepest anticipation slope, stops/s, for a very large jump coming (the Sun's disc after a night frame): 0.7 stops/s would need 17 s of lead for 12 stops. */
const ANTICIPATION_SLOPE_BIG = 2.2
/** Anticipation aims to be at the coming exposure this long BEFORE its frame arrives, so the approach's lag costs margin, not a late cut. */
const ANTICIPATION_LEAD_S = 1
/**
 * The long-exposure fuse (hdr) lets go of a bright frame's arrival this far ahead, s: it is a linear control (about 1 s to cross), and left to follow the
 * raw it only started falling when the Sun's disc was already in view, so the arrival flashed the whole frame grey through the long exposure for a second.
 */
const HDR_AHEAD_S = 1.5
/** The anticipation slope (natural-log units per second) for a jump of `gap` stops: gentle for a small one, steeper as the lead it would need outgrows the journey. */
export function anticipationSlope(gapStops: number): number {
  const small = ANTICIPATION_SLOPE * EXPOSURE_RATES.upStopsPerS
  const k = Math.min(1, Math.max(0, (gapStops - 2) / 6))
  return (small + (ANTICIPATION_SLOPE_BIG - small) * k) / LOG2
}

/**
 * One step of a log-space controller: moves `cur` toward `target` (both natural logs) by an exponential approach, at most
 * `rate` stops per second, and never past the target.
 */
export function stepLog(cur: number, target: number, dt: number, up: boolean, journey = false, scriptedMoon = false, settle = false, inMotion = false, expsnap = EXP_SNAP_ON): number {
  const R = EXPOSURE_RATES
  const d = (target - cur) * LOG2 // stops
  const gap = Math.abs(d)
  if (expsnap && gap >= REST_STOPS && !journey && !scriptedMoon) {
    if (settle) {
      // Gesture just ended: converge fast, capped by the gap so it cannot overshoot.
      const step = Math.min(gap, gap * (1 - Math.exp(-dt / SNAP_SETTLE_RATES.tau)), SNAP_SETTLE_RATES.stopsPerS * dt)
      return cur + Math.sign(d) * step / LOG2
    }
    if (inMotion) {
      // Gesture live: follow the target smoothly so the terminator crossing does not flicker or pump.
      const mTau = up ? MOTION_TRACK_RATES.upTau : MOTION_TRACK_RATES.downTau
      const mRate = up ? MOTION_TRACK_RATES.upStopsPerS : MOTION_TRACK_RATES.downStopsPerS
      const step = Math.min(gap, gap * (1 - Math.exp(-dt / mTau)), mRate * dt, MOTION_MAX_STEP_STOPS)
      return cur + Math.sign(d) * step / LOG2
    }
  }
  const base = up ? (scriptedMoon ? SCRIPTED_MOON_EXPOSURE.upStopsPerS : R.upStopsPerS) : journey ? R.journeyDownStopsPerS : R.downStopsPerS
  const tau = up ? (scriptedMoon ? SCRIPTED_MOON_EXPOSURE.upTau : R.upTau) : journey ? R.journeyDownTau : R.downTau
  // A rising white point (a picture about to blow out) speeds up with the gap from 1 stop; a falling one (the picture brightening after a
  // glare) only from 2 stops, and less: a 7-stop gap after the Sun would otherwise take 12 s.
  const rate = up ? Math.min(scriptedMoon ? SCRIPTED_MOON_EXPOSURE.maxStopsPerS : R.maxStopsPerS, base + R.burstPerStop * Math.max(0, gap - R.burstFromStops)) : Math.min(R.maxDownStopsPerS, base + R.downBurstPerStop * Math.max(0, gap - R.downBurstFromStops))
  if (gap < REST_STOPS) return target
  if (settle && !journey && !scriptedMoon) {
    const quick = Math.min(gap, gap * (1 - Math.exp(-dt / SETTLE_RATES.tau)), SETTLE_RATES.stopsPerS * dt)
    const slow = Math.min(gap, gap * (1 - Math.exp(-dt / tau)), rate * dt)
    return cur + Math.sign(d) * Math.max(quick, slow) / LOG2
  }
  const approach = gap * (1 - Math.exp(-dt / tau))
  const step = Math.min(gap, approach, rate * dt)
  return cur + Math.sign(d) * step / LOG2
}

export interface AdaptOptions {
  settle?: boolean
  inMotion?: boolean
  expsnap?: boolean
  journey?: boolean
  scriptedMoon?: boolean
}

/** Pure form of stepLog for tests and callers that pass options: `cur` and `target` are natural logs. */
export function adaptExposure(cur: number, target: number, dt: number, o: AdaptOptions = {}): number {
  return stepLog(cur, target, dt, target > cur, o.journey, o.scriptedMoon, o.settle, o.inMotion, o.expsnap ?? EXP_SNAP_ON)
}

/** adaptExposure on linear white point values (I/F). */
export function adaptExposureWhite(curWhite: number, targetWhite: number, dt: number, o?: AdaptOptions): number {
  if (curWhite <= 0 || targetWhite <= 0) return targetWhite
  return Math.exp(adaptExposure(Math.log(curWhite), Math.log(targetWhite), dt, o))
}

/** One step of the same kind for a linear control. */
export function stepLinear(cur: number, target: number, dt: number, maxPerS = EXPOSURE_RATES.linearPerS, tau = EXPOSURE_RATES.linearTau): number {
  const d = target - cur
  const gap = Math.abs(d)
  if (gap < REST_LINEAR) return target
  const step = Math.min(gap, gap * (1 - Math.exp(-dt / tau)), maxPerS * dt)
  return cur + Math.sign(d) * step
}

/** The exposure a scripted journey's camera will ask for `t` seconds from now. */
export interface Ahead { t: number; raw: Exposure }

export interface ControlState {
  logWhite: number
  logEs: number
  longMax: number
  hdr: number
  starLift: number
}

export class ExposureController {
  private s: ControlState | null = null
  private lastAt = 0
  /** The brightest white point it saw coming (log, -Infinity: none): a jump nobody saw coming is a cut. */
  private prevAheadLog = -Infinity
  /** The last raw white point accepted as the picture's own (log), and how many frames in a row the raw has been a stranger to it. */
  private refLog = NaN
  private jumpFrames = 0
  /** Large alternating raw targets are a grazing edge, not repeated subject cuts. */
  private previousRawLog = NaN
  private previousLargeDirection = 0
  private rawFlipTimes: number[] = []
  /** Until when (ms) the white may fall at the scripted-move rate: the move's own frames and the settle after them. */
  private journeyUntil = 0
  /** True while the last step was still moving (the caller then keeps drawing). */
  moving = false

  reset(): void { this.s = null; this.refLog = NaN; this.jumpFrames = 0; this.previousRawLog = NaN; this.previousLargeDirection = 0; this.rawFlipTimes = []; this.journeyUntil = 0 }

  /** The current smoothed state (tests, the api readout). */
  get state(): ControlState | null { return this.s }

  /**
   * The exposure to draw with: `raw` (computeExposure's answer for this frame) eased. `now` is the frame's time in ms; `still` jumps.
   * `hold` is decided here from the search itself: a frame in which the search met no Moon and nothing else (Earth, Sun) asked
   * for the white point exposes as the last frame did.
   */
  /** Snap behaviour (in-motion tracking, fast settle) for this frame: the page sets it from a USER gesture only (a drag, wheel or touch), never a scripted camera move. Off = main's controller exactly. */
  snap = EXP_SNAP_ON
  step(raw: Exposure, now: number, still = false, ahead: readonly Ahead[] = [], declaredCut = false, scriptedMoon = false, settle = false, inMotion = false): Exposure {
    const dt = Math.min(MAX_DT, Math.max(0, (now - this.lastAt) / 1000))
    this.lastAt = now
    if (ahead.length > 0) this.journeyUntil = now + EXPOSURE_RATES.journeySettleS * 1000
    const journey = now < this.journeyUntil
    let tW = Math.log(raw.white)
    let tE = Math.log(raw.esLevel)
    const rawLog = tW
    let aheadLog = -Infinity
    // Anticipation: a brighter frame `t` seconds from now must not arrive on an exposure still set for this one. The white point
    // starts rising early enough that, at the rising rate, it is there when the bright thing is (never clipping, never faster).
    const curLog = this.s ? this.s.logWhite : rawLog
    for (const a of ahead) {
      if (a.raw.search.hits === 0 && a.raw.whiteFloored) continue
      const slope = anticipationSlope((Math.log(a.raw.white) - curLog) * LOG2)
      tW = Math.max(tW, Math.log(a.raw.white) - slope * Math.max(0, a.t - ANTICIPATION_LEAD_S))
      aheadLog = Math.max(aheadLog, Math.log(a.raw.white))
    }
    // The fuse follows the same look-ahead: a much brighter frame coming within HDR_AHEAD_S asks for its own (lower) hdr now.
    let tH = raw.hdr
    for (const a of ahead) {
      if (a.t > HDR_AHEAD_S || (a.raw.search.hits === 0 && a.raw.whiteFloored)) continue
      if (a.raw.white > raw.white * 2) tH = Math.min(tH, a.raw.hdr)
    }
    // The Moon is not in the frame and nothing else set the white point: its floor value is an absence, not a measurement.
    const nothingSeen = raw.search.hits === 0 && raw.whiteFloored
    let oscillatingRaw = false
    if (!nothingSeen) {
      if (!Number.isNaN(this.previousRawLog)) {
        const deltaStops = (rawLog - this.previousRawLog) * LOG2
        if (Math.abs(deltaStops) > 4) {
          const direction = Math.sign(deltaStops)
          if (this.previousLargeDirection !== 0 && direction !== this.previousLargeDirection) this.rawFlipTimes.push(now)
          this.previousLargeDirection = direction
        }
      }
      this.previousRawLog = rawLog
      this.rawFlipTimes = this.rawFlipTimes.filter((at) => now - at <= 400)
      oscillatingRaw = this.rawFlipTimes.length >= 2
    }
    // A cut: the picture changed at once, so the exposure changes with it. Only two things say so: the page DECLARES one (`declaredCut`:
    // a click, a date set, a teleport) and the raw white point really did jump, or the jump PERSISTS for a second frame. One frame's
    // glitch in the raw (a search that clipped a limb, a sampling step) is held off: the target stays where it was and the exposure
    // does not move with it, so neither the glitch nor its recovery reaches the screen.
    let cut = false
    if (!nothingSeen) {
      const seen = this.prevAheadLog > rawLog - 0.7 / LOG2
      const stranger = (!oscillatingRaw || declaredCut) && this.s !== null && !Number.isNaN(this.refLog) && Math.abs(rawLog - this.refLog) * LOG2 > CUT_STOPS && !seen
      this.jumpFrames = stranger ? this.jumpFrames + 1 : 0
      if (stranger) {
        if (declaredCut || (!(inMotion && this.snap) && this.jumpFrames >= 2)) cut = true
        else if (inMotion && this.snap) {
          // A live gesture can legitimately move the metered subject abruptly.
          // Track the raw reference and let stepLog's motion cap follow it.
          this.refLog = rawLog
          this.jumpFrames = 0
        }
        else {
          tW -= rawLog - this.refLog // undecided: aim at the last accepted picture
          // The scripted Moon rate also applies to HDR. Keep that faster path
          // from exposing a one-frame rejected meter glitch; a persistent
          // second frame still becomes the existing cut below.
          if (scriptedMoon && this.s) tH = this.s.hdr
        }
      }
      if (oscillatingRaw) this.refLog = rawLog
      if (!stranger || cut) { this.refLog = rawLog; this.jumpFrames = 0 }
      this.prevAheadLog = aheadLog
    }
    // A jump nobody announced that lands within 0.6 stop of where the exposure already is, is no cut: it is an ordinary step.
    if (cut && !still && this.s && Math.abs(tW - this.s.logWhite) * LOG2 < 0.6) cut = false
    if (still || !this.s || cut) {
      const w = still || !this.s ? rawLog : tW
      this.s = { logWhite: w, logEs: tE, longMax: raw.longMax, hdr: raw.hdr, starLift: raw.starLift }
      this.moving = false
      return { ...raw, white: Math.exp(w) }
    }
    const s = this.s
    let moving = false
    if (!nothingSeen) {
      if (!this.moving) {
        // At rest: small wander of the targets is held off (REST_DEADBAND_*), so it neither moves the picture nor asks for a frame.
        if (Math.abs(tW - s.logWhite) * LOG2 < REST_DEADBAND_STOPS) tW = s.logWhite
        if (Math.abs(tE - s.logEs) * LOG2 < REST_DEADBAND_STOPS) tE = s.logEs
        if (Math.abs(raw.longMax - s.longMax) < REST_DEADBAND_LINEAR) raw = { ...raw, longMax: s.longMax }
        if (Math.abs(raw.starLift - s.starLift) < REST_DEADBAND_LINEAR) raw = { ...raw, starLift: s.starLift }
        if (Math.abs(tH - s.hdr) < REST_DEADBAND_LINEAR) tH = s.hdr
      }
      const w = stepLog(s.logWhite, tW, dt, tW > s.logWhite, journey, scriptedMoon, settle, inMotion, this.snap)
      const e = stepLog(s.logEs, tE, dt, tE > s.logEs, false, false, settle, inMotion, this.snap)
      const lin = settle && !scriptedMoon
      // Linear controls: the snap rates when on, else the legacy settle rates (both are the eye-pace rates when not settling).
      const linRates = lin ? (this.snap ? SNAP_SETTLE_RATES : SETTLE_RATES) : EXPOSURE_RATES
      const l = stepLinear(s.longMax, raw.longMax, dt, linRates.linearPerS, linRates.linearTau)
      const h = stepLinear(s.hdr, tH, dt, scriptedMoon && tH < s.hdr ? SCRIPTED_MOON_EXPOSURE.hdrPerS : linRates.linearPerS, scriptedMoon && tH < s.hdr ? SCRIPTED_MOON_EXPOSURE.hdrTau : linRates.linearTau)
      const k = stepLinear(s.starLift, raw.starLift, dt, linRates.linearPerS, linRates.linearTau)
      moving = w !== tW || e !== tE || l !== raw.longMax || h !== tH || k !== raw.starLift
      s.logWhite = w; s.logEs = e; s.longMax = l; s.hdr = h; s.starLift = k
    }
    // Nothing to expose for in this frame (the camera is between two views), but a later frame of the journey has a subject: use the empty
    // time to settle on the exposure it will need. A black frame hides the move; arriving at the old exposure shows a Moon too dark to see.
    if (nothingSeen && tH < s.hdr) {
      // The held frame (nothing to expose for) still lets the fuse go ahead of a bright arrival; it never raises it.
      const h = stepLinear(s.hdr, tH, dt)
      moving = moving || h !== s.hdr
      s.hdr = h
    }
    if (nothingSeen) {
      const first = ahead.find((a) => !(a.raw.search.hits === 0 && a.raw.whiteFloored))
      if (first) {
        const tgt = Math.log(first.raw.white)
        const w = tgt < s.logWhite ? stepLog(s.logWhite, tgt, dt, false) : tW > s.logWhite ? stepLog(s.logWhite, tW, dt, true) : s.logWhite
        // Moving only while the value changes: a target the white point cannot rise toward (nothing asks for it) leaves it where it is.
        moving = w !== s.logWhite
        s.logWhite = w
      }
    }
    this.moving = moving
    return {
      ...raw,
      white: Math.exp(s.logWhite),
      esLevel: Math.exp(s.logEs),
      longMax: s.longMax,
      hdr: s.hdr,
      starLift: s.starLift,
    }
  }
}

/**
 * Anticipatory envelope of a raw white-point track (natural logs, one per sample, `dtS` seconds apart):
 * out[i] = max over j of (raw[j] - slope * |i - j| * dtS), slope in stops per second. The result is never below the raw track
 * (nothing clips), never steeper than `slope`, starts rising `Δ/slope` seconds before the bright part arrives, and lets go of it
 * at the same slope. A local maximum keeps its value: nothing overshoots.
 */
export function planEnvelope(rawLog: number[], dtS: number, slopeStopsPerS: number): number[] {
  const n = rawLog.length
  const k = slopeStopsPerS / LOG2 * dtS // natural-log units per sample
  const out = rawLog.slice()
  for (let i = 1; i < n; i++) out[i] = Math.max(out[i], out[i - 1] - k)
  for (let i = n - 2; i >= 0; i--) out[i] = Math.max(out[i], out[i + 1] - k)
  return out
}

/** A planned track sampled by journey progress u in 0..1 (linear interpolation in the log). */
export class ExposureTrack {
  constructor(private readonly logWhite: number[]) {}
  at(u: number): number {
    const n = this.logWhite.length
    if (n === 0) return NaN
    const x = Math.max(0, Math.min(1, u)) * (n - 1)
    const i = Math.min(n - 2, Math.floor(x))
    if (n === 1) return Math.exp(this.logWhite[0])
    const f = x - i
    return Math.exp(this.logWhite[i] * (1 - f) + this.logWhite[i + 1] * f)
  }
}
