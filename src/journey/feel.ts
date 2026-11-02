/**
 * Flight feel v2 (owner, 2026-10-29: "this feels slow ... this up-and-down thing ... they should move faster ... a more organic movement").
 * `?flightfeel=0` restores the earlier law (journey/path.ts zoomPanPath + flyEase + flyDurationMs) exactly.
 *
 * - Altitude: the log of the altitude runs straight from one end to the other, plus at most one smooth bump that only rises as high as
 *   the travel needs (FEEL_NEED_PER_RAD radii of altitude per radian of travel, never above the zoom-and-pan apex). A move that is
 *   mostly a zoom (Home to a crater) does not climb at all.
 * - Travel: the ground moves at a speed proportional to the altitude (constant speed on screen), with FEEL_TURN_IN of it on a steady
 *   share so the arrival still curves in rather than hovering and dropping.
 * - Clock: the path is walked by its perceptual length (zoom in e-folds and pan in frame heights count alike), so the picture changes at
 *   one steady rate; the velocity rises over FEEL_ACCEL of the time and falls over FEEL_DECEL (half-cosine ramps: velocity and
 *   acceleration continuous, no lunge, no stall). It may start at the speed of a move it takes over (`v0`), so a new target picked
 *   mid-flight (Home pressed during a fly-in) does not stop dead first.
 * - Duration: FEEL_BASE_MS plus FEEL_MS_PER_UNIT per unit of perceptual length, within FEEL_MIN_MS to FEEL_MAX_MS.
 */

/** Share of the time spent gathering speed, and slowing down (velocity half-cosine ramps). */
export const FEEL_ACCEL = 0.16
export const FEEL_DECEL = 0.34
/** The highest a move climbs, radii of altitude per radian of travel (only when that is above both ends). */
export const FEEL_NEED_PER_RAD = 0.55
/** Share of the travel that runs at a steady rate instead of in proportion to the altitude. */
export const FEEL_TURN_IN = 0.25
export const FEEL_BASE_MS = 800
export const FEEL_MS_PER_UNIT = 520
export const FEEL_MIN_MS = 1100
export const FEEL_MAX_MS = 3600
/** Knots of the arc-length table. */
const N = 160

/**
 * The time law: progress (0 to 1) at time share x, for a velocity that starts at `v0` and ends at `v1` (in progress per unit time; 1 is
 * the mean speed of the move), rising over `a` and falling over `d` of the time on half-cosine ramps and cruising in between.
 * Monotone for v0, v1 >= 0; exact at both ends.
 */
export function feelEase(x: number, v0 = 0, v1 = 0, a = FEEL_ACCEL, d = FEEL_DECEL): number {
  const t = Math.max(0, Math.min(1, x))
  const V = feelCruise(v0, v1, a, d)
  // Integral of v0 + (V - v0) (1 - cos(pi q / a)) / 2 from 0 to q.
  const up = (q: number): number => v0 * q + (V - v0) * (q / 2 - a / (2 * Math.PI) * Math.sin(Math.PI * q / a))
  if (t <= a) return up(t)
  const cruiseEnd = 1 - d
  if (t <= cruiseEnd) return up(a) + V * (t - a)
  // The fall, integrated backward from the end: 1 minus the integral of v1 + (V - v1) (1 - cos(pi r / d)) / 2 over the rest r.
  const r = 1 - t
  return 1 - (v1 * r + (V - v1) * (r / 2 - d / (2 * Math.PI) * Math.sin(Math.PI * r / d)))
}
/** The cruise speed that makes the ramps and the cruise cover exactly the whole move. */
export function feelCruise(v0 = 0, v1 = 0, a = FEEL_ACCEL, d = FEEL_DECEL): number {
  return (1 - (v0 * a + v1 * d) / 2) / (1 - a / 2 - d / 2)
}
/** The largest start speed the law accepts (beyond it the cruise would fall below the start): the start is clamped here. */
export const FEEL_V0_MAX = 1.6
/** A carried start never runs the clock slower than this (the correction then supplies the rest of the incoming velocity's direction). */
export const FEEL_V0_MIN = 0.35
/** Share of the path over which a carried velocity turns onto the new path. */
export const FEEL_CARRY_K = 0.3
/** A reversal spreads its turn over up to this share of the path. */
export const FEEL_CARRY_K_MAX = 0.75

/** One flat path: altitude, travel share and the walk by perceptual length. */
export interface FeelPath {
  /** Perceptual length of the move (zoom e-folds and pan frame-heights, combined). */
  S: number
  /** The highest altitude on the path (radii). */
  apexAlt: number
  /** Altitude (radii) and travel share (0 to 1) at perceptual progress k (0 to 1). */
  at(k: number): { alt: number; p: number }
}

/**
 * The flat path of a move over `theta` radians of travel from altitude `a0` to `a1` (radii above the ground). `apexCap` caps the bump
 * (the zoom-and-pan apex: never climb higher than the old law did).
 */
export function feelPath(theta: number, a0: number, a1: number, apexCap = Infinity): FeelPath {
  const L0 = Math.log(a0), L1 = Math.log(a1)
  const top = Math.max(a0, a1)
  const want = Math.min(Math.max(apexCap, top), Math.max(top, FEEL_NEED_PER_RAD * theta))
  // log-altitude L(s) = L0 + D s + c s (1 - s), with its maximum exactly at log(want) when that is above both ends (closed form).
  const D = L1 - L0, M = Math.log(want) - L0
  const c = M > 1e-12 && M >= D - 1e-12 && Math.log(want) > Math.max(L0, L1) + 1e-9 ? 2 * M - D + 2 * Math.sqrt(Math.max(0, M * (M - D))) : 0
  const L = (s: number): number => L0 + D * s + c * s * (1 - s)
  // Tabulate: altitude, travel share (ground speed proportional to altitude, plus a steady share) and perceptual length, by s.
  const ss: number[] = [], ws: number[] = [], wInt: number[] = [0]
  for (let i = 0; i <= N; i++) { const s = i / N; ss.push(s); ws.push(Math.exp(L(s))) }
  for (let i = 1; i <= N; i++) wInt.push(wInt[i - 1] + (ws[i] + ws[i - 1]) / 2 / N)
  const W = wInt[N] || 1
  const ps = ss.map((s, i) => (1 - FEEL_TURN_IN) * wInt[i] / W + FEEL_TURN_IN * s)
  const len: number[] = [0]
  for (let i = 1; i <= N; i++) {
    const dL = L(ss[i]) - L(ss[i - 1])
    const wMid = Math.sqrt(ws[i] * ws[i - 1])
    const dPan = theta * (ps[i] - ps[i - 1]) / Math.max(1e-9, wMid)
    len.push(len[i - 1] + Math.hypot(dL, dPan))
  }
  const S = len[N]
  const sSlope = monotoneSlopes(len, ss), pSlope = monotoneSlopes(len, ps)
  let apexAlt = top
  for (const w of ws) apexAlt = Math.max(apexAlt, w)
  return {
    S, apexAlt,
    at(k: number): { alt: number; p: number } {
      const kk = Math.max(0, Math.min(1, k))
      if (S < 1e-12) return { alt: Math.exp(L(kk)), p: kk }
      const target = kk * S
      let lo = 0, hi = N
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (len[mid] <= target) lo = mid; else hi = mid }
      // C1 (monotone cubic Hermite) in the arc length, so the speed has no step at a knot (linear pieces gave up to 10 % steps).
      const s = hermite(len, ss, sSlope, lo, target)
      const p = hermite(len, ps, pSlope, lo, target)
      return { alt: Math.exp(L(s)), p: kk >= 1 ? 1 : p }
    },
  }
}

/** Fritsch-Carlson slopes for a monotone (non-decreasing) table: a cubic Hermite through them is C1 and never overshoots. */
export function monotoneSlopes(xs: number[], ys: number[]): number[] {
  const n = xs.length, d: number[] = [], m: number[] = new Array(n).fill(0)
  for (let i = 0; i < n - 1; i++) { const h = xs[i + 1] - xs[i]; d.push(h > 1e-15 ? (ys[i + 1] - ys[i]) / h : 0) }
  m[0] = d[0]; m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i] }
  }
  return m
}
/** The cubic Hermite through knots lo and lo + 1 of (xs, ys) with slopes ms, at x. */
export function hermite(xs: number[], ys: number[], ms: number[], lo: number, x: number): number {
  const h = xs[lo + 1] - xs[lo]
  if (!(h > 1e-15)) return ys[lo]
  const t = (x - xs[lo]) / h, t2 = t * t, t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * ms[lo] + (-2 * t3 + 3 * t2) * ys[lo + 1] + (t3 - t2) * h * ms[lo + 1]
}

/** How long a move takes under v2, ms: from its perceptual length, plus `lookTurnDeg` (a change of subject) at 400 ms per 90 deg. */
export function feelDurationMs(S: number, lookTurnDeg = 0): number {
  return Math.max(FEEL_MIN_MS, Math.min(FEEL_MAX_MS, FEEL_BASE_MS + FEEL_MS_PER_UNIT * S)) + 400 * lookTurnDeg / 90
}

/**
 * The feel-clock backstop: the most one drawn frame advances a running fly-to (ms). A longer frame (a stall, a pick's own planning, a burst of tile
 * work) moves the camera by this much, not by its whole length, and the move ends that much later: the picture never leaps after a hitch, and a
 * carried speed stays the speed on screen (the descent's MAX_STEP_MS rule, descent/clock.ts). A 10 fps frame (100 ms) is not slowed.
 */
export const FEEL_MAX_STEP_MS = 100
/**
 * Ms the clock start of a running move moves later for the frame at `now`: the move's time this frame (from where its clock last advanced,
 * `stepAt`, or from its start `t0` when that is later, a held start) beyond FEEL_MAX_STEP_MS. 0 for every ordinary frame.
 */
export function feelClockSlip(stepAt: number, t0: number, now: number): number {
  return Math.max(0, now - Math.max(stepAt, t0) - FEEL_MAX_STEP_MS)
}
/** `?flightfeel=0` restores the earlier fly-to law, Home look and Home framing; anything else (or nothing) is v2. */
export function flightFeelOn(search: string | URLSearchParams): boolean {
  const p = typeof search === 'string' ? new URLSearchParams(search) : search
  return p.get('flightfeel') !== '0'
}
