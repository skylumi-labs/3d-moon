/**
 * Frame statistics shared by the ?sampler=1 recorder (flightSampler.ts) and the production telemetry (src/telemetry/).
 * Pure functions plus FrameWindow, a recorder whose per-frame call (tick) only does arithmetic on preallocated storage: no allocation.
 */

export const HZ_STEPS = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240] as const

export function quantile(values: readonly number[], p: number): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!
}

/** Display refresh from the median rAF interval (ms). Intervals over 40 ms are stalls, not vsync, and are ignored. N/A (null) when too few. */
export function estimateDisplayHz(intervalsMs: readonly number[]): number | null {
  const ok = intervalsMs.filter((x) => x > 2 && x <= 40)
  if (ok.length < 20) return null
  const hz = 1000 / (quantile(ok, 0.5) as number)
  for (const step of HZ_STEPS) if (Math.abs(hz - step) / step < 0.04) return step
  return Math.round(hz)
}

/** Share of rAF ticks near each display rate (key = Hz, 'other' for the rest, 'stall' for intervals over 40 ms). A mixed-rate recording (ProMotion adapting) shows here. */
export function rateMix(intervalsMs: readonly number[]): Record<string, number> {
  const out: Record<string, number> = {}
  if (!intervalsMs.length) return out
  for (const dt of intervalsMs) {
    let k = dt > 40 ? 'stall' : 'other'
    if (dt > 2 && dt <= 40) for (const step of HZ_STEPS) if (Math.abs(1000 / dt - step) / step < 0.04) { k = String(step); break }
    out[k] = (out[k] ?? 0) + 1
  }
  for (const k of Object.keys(out)) out[k] = +(out[k]! / intervalsMs.length).toFixed(3)
  return out
}

/** A gap longer than this is a pause (hidden tab, debugger), not a stutter: it is counted apart and kept out of the statistics. */
export const PAUSE_MS = 2000

export interface WindowSummary {
  /** Drawn frames (changes of the app's frame counter). */
  drawn: number
  /** rAF ticks seen while recording. */
  ticks: number
  wallMs: number
  /** Gaps between drawn frames (ms). null when fewer than 2 frames were drawn. */
  p50: number | null; p95: number | null; p99: number | null
  maxGapMs: number
  /** Count of drawn-frame gaps of at least 25 / 50 / 100 ms. */
  g25: number; g50: number; g100: number
  /** Slot-based: gaps measured in pace slots (cadence). `slotMiss` = slots skipped in total, `slot2`/`slot4` = gaps of 2+ / 4+ slots. null when the cadence is unknown. */
  slotMiss: number | null; slot2: number | null; slot4: number | null
  /** Drawn frames over the slots the wall time held, capped at 100. null when the cadence is unknown. */
  presentedPct: number | null
  pauses: number
  /** Samples beyond the buffer are counted in the totals but not in the quantiles. */
  truncated: boolean
}

/**
 * Records drawn-frame gaps while a flight or drag is active. All storage is allocated once (constructor); tick() allocates nothing.
 * Feed it each rAF timestamp and the app's frame counter. `active` false (a drag with the pointer still) restarts the gap clock instead of counting a gap.
 */
export class FrameWindow {
  private readonly buf: Float32Array
  private n = 0
  private t0 = -1
  private lastDraw = -1
  private lastFrames = -1
  drawn = 0
  ticks = 0
  maxGap = 0
  g25 = 0
  g50 = 0
  g100 = 0
  pauses = 0
  private cadence = 0
  private slotMiss = 0
  private slot2 = 0
  private slot4 = 0
  private lastT = 0

  constructor(capacity = 8192) { this.buf = new Float32Array(capacity) }

  /** Reset for a new window. cadenceMs: the pace period (ms) or 0 when unknown. */
  start(t: number, frames: number, cadenceMs: number): void {
    this.n = 0; this.t0 = t; this.lastDraw = t; this.lastFrames = frames; this.lastT = t
    this.drawn = 0; this.ticks = 0; this.maxGap = 0; this.g25 = 0; this.g50 = 0; this.g100 = 0; this.pauses = 0
    this.cadence = cadenceMs > 0 ? cadenceMs : 0; this.slotMiss = 0; this.slot2 = 0; this.slot4 = 0
  }

  get started(): boolean { return this.t0 >= 0 }

  tick(t: number, frames: number, active = true): void {
    this.ticks++
    this.lastT = t
    if (!active) { this.lastDraw = t; this.lastFrames = frames; return }
    const since = t - this.lastDraw
    if (since > PAUSE_MS) { this.pauses++; this.lastDraw = t; this.lastFrames = frames; return }
    if (since > this.maxGap) this.maxGap = since
    if (frames === this.lastFrames) return
    this.lastFrames = frames
    this.drawn++
    this.lastDraw = t
    if (this.n < this.buf.length) this.buf[this.n++] = since
    if (since >= 25) this.g25++
    if (since >= 50) this.g50++
    if (since >= 100) this.g100++
    if (this.cadence > 0) {
      const slots = Math.max(1, Math.round(since / this.cadence))
      if (slots > 1) this.slotMiss += slots - 1
      if (slots >= 2) this.slot2++
      if (slots >= 4) this.slot4++
    }
  }

  summary(): WindowSummary {
    const wallMs = Math.max(0, this.lastT - this.t0)
    const sorted = this.n >= 2 ? this.buf.slice(0, this.n).sort() : null
    const q = (p: number): number | null => (sorted ? +sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!.toFixed(1) : null)
    const cad = this.cadence
    return {
      drawn: this.drawn, ticks: this.ticks, wallMs: Math.round(wallMs),
      p50: q(0.5), p95: q(0.95), p99: q(0.99), maxGapMs: Math.round(this.maxGap),
      g25: this.g25, g50: this.g50, g100: this.g100,
      slotMiss: cad ? this.slotMiss : null, slot2: cad ? this.slot2 : null, slot4: cad ? this.slot4 : null,
      presentedPct: cad && wallMs > 0 ? Math.min(100, +((this.drawn / (wallMs / cad)) * 100).toFixed(1)) : null,
      pauses: this.pauses, truncated: this.n >= this.buf.length,
    }
  }
}

// ---- Motion render fraction f (render width / canvas width) per flight or drag window (flight_perf / drag_perf, WP9)

/**
 * motion_f_under_035_share counts motion frames whose f, in the 0.01 bins the quantiles use, is under this (bin 34 or lower, so the share and the
 * quantiles agree). The old phone grid drew 0.35 x 1.5 / 2 = 0.26 of the canvas far out (quality/phoneSharp.ts).
 */
export const MOTION_F_LOW = 0.35
const LOW_BIN = Math.round(MOTION_F_LOW * 100)

/** The viewer's running f record (quality/phoneSharp.ts FracStats, `__moon.perf.motionF`): drawn motion frames so far and the f of the newest one. */
export interface FracSource { frames: number; last: number }

export interface FracSummary {
  /** Motion frames seen in the window. */
  frames: number
  /** Nearest-rank quantiles of f to 0.01 (the FracStats bins and rule); null with no motion frame. */
  p10: number | null; p50: number | null
  /** Share of motion frames whose binned f is under MOTION_F_LOW (f < 0.345), to 0.001; null with no motion frame. */
  underShare: number | null
}

/**
 * f over the motion frames of one window. Same 0.01 bins and the same nearest-rank quantile (ceil(q * n)-th value) as FracStats, so a window
 * that covers the whole page agrees with `__moon.perf.motionF.p10/p50`. Storage is allocated once; add() and follow() allocate nothing.
 */
export class FracWindow {
  frames = 0
  under = 0
  private readonly bins = new Uint32Array(101)
  /** The source's frame count at the last follow() (-1 before start()). */
  private seen = -1

  /** One motion frame's f. Ignored (as FracStats does) when not finite or not above 0; clamped to 1. */
  add(f: number): void {
    if (!Number.isFinite(f) || f <= 0) return
    const v = Math.min(1, f)
    this.frames++
    const bin = Math.round(v * 100)
    if (bin < LOW_BIN) this.under++
    this.bins[bin]!++
  }

  /** A fresh window that follows `src` from its current count (null src: frames are only added by hand). */
  start(src?: FracSource | null): void {
    this.frames = 0; this.under = 0; this.bins.fill(0)
    this.seen = src && Number.isFinite(src.frames) ? src.frames : -1
  }

  /**
   * Takes the motion frames `src` recorded since the last call: each counts at `src.last` (called once per rAF tick, so that is one frame almost
   * always; two draws between ticks both count at the newer f). At most 10,000 frames are taken per call. A count that went down
   * (`__moon.resetMotionF()`) restarts the follow.
   */
  follow(src?: FracSource | null): void {
    if (!src || !Number.isFinite(src.frames)) return
    if (this.seen < 0 || src.frames < this.seen) { this.seen = src.frames; return }
    const d = Math.min(src.frames - this.seen, 10_000)
    this.seen = src.frames
    for (let i = 0; i < d; i++) this.add(src.last)
  }

  /** The q-quantile (0..1) of f to 0.01, nearest rank; null with no frames. */
  quantile(q: number): number | null {
    if (this.frames === 0) return null
    const want = Math.max(1, Math.ceil(q * this.frames))
    let acc = 0
    for (let i = 0; i < this.bins.length; i++) { acc += this.bins[i]!; if (acc >= want) return i / 100 }
    return 1
  }

  summary(): FracSummary {
    const n = this.frames
    return { frames: n, p10: this.quantile(0.1), p50: this.quantile(0.5), underShare: n ? +(this.under / n).toFixed(3) : null }
  }
}
