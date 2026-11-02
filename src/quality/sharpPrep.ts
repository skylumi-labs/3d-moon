/**
 * "Preparing the flight" (?sharp=1, touch classes): the beat before a cinematic flight in which the camera holds the start pose while (A) the tile
 * streamer is driven through the first third of the path until it is resident, and (B) the held flight grid is measured instead of read from the class table.
 *
 * Why: the prefetcher only downloads. On a phone the decode and the GPU upload are the slow part (12 jobs, 4 uploads a frame), so a flight that starts on
 * downloaded-but-not-resident tiles draws the base map for its first seconds. The intro already waits for its prefetch (main.ts INTRO_PREFETCH_MAX_MS);
 * this waits for RESIDENCY of the segment about to be flown. No upload slicing (ledger #45, #136): the streamer uploads at its normal flight rate.
 *
 * Pure logic only; main.ts owns the camera, the streamer and the draw. Everything here takes `now` and numbers, so the unit tests need no browser.
 */
import { SHARP_FLIGHT_BUDGET_MS, SHARP_GRIDS, pickFlightGrid, type SharpConfig } from './sharp'

/** Share of the remaining path the streamer is driven through. */
export const PREP_FRACTION = 0.3
/** Path poses streamed and probed (start, then evenly to PREP_FRACTION of the way). */
export const PREP_POSES = 4
/** Exact residency (resident / wanted, tiles + detail + TC) that ends the streaming phase. */
export const PREP_RESIDENCY = 0.95
/** The beat's cap, ms; a cold first play (nothing prepared yet this page load) gets the longer one. */
export const PREP_MAX_MS = 5000
export const PREP_MAX_MS_COLD = 6000
/** Time kept for the warm-up when the streaming phase runs to its cap. */
export const PREP_WARM_RESERVE_MS = 1200
/** A pose is streamed for this long, and one pose's residency is probed this often (an exact want costs about one extra wanted pass per streamer). */
export const PREP_DWELL_MS = 350
/** The card says exactly this: no technical text, no byte counts. */
export const PREP_TEXT = 'Preparing the flight'

/** Whether a flight gets the beat: sharp on, a real visitor move (not an instant cut, a still or a capture), and tiles to prepare. */
export function prepWanted(c: SharpConfig, o: { instant: boolean; hasTiles: boolean; still: boolean; capture: boolean }): boolean {
  return c.on && !o.instant && o.hasTiles && !o.still && !o.capture
}

/** The flight progresses (u) streamed and probed: `startU` to PREP_FRACTION of the way from there to the end. */
export function prepPoseUs(startU: number, n = PREP_POSES): number[] {
  const end = startU + (1 - startU) * PREP_FRACTION
  return Array.from({ length: n }, (_, i) => startU + (end - startU) * (n === 1 ? 0 : i / (n - 1)))
}

/** The warm-up poses along the WHOLE remaining path (u 0, .33, .66, 1 of the flight, from `startU`). */
export function warmPoseUs(startU: number): number[] {
  return [0, 1 / 3, 2 / 3, 1].map((v) => startU + (1 - startU) * v)
}

/** Predicted full-frame cost from a moon-pass-only draw time: the glare and final passes at the same grid are not in the timed draw. Calibrate on the rig. */
export const WARM_POST_FACTOR = 1.2
/** A timed draw shorter than this is not a GPU time (a finish() that did not wait): the measurement is abandoned and the table stands. */
export const WARM_MIN_VALID_MS = 0.5
/** A grid whose worst draw is already this many budgets over ends the search: a finer one cannot fit. */
export const WARM_GIVE_UP = 2

export interface WarmStep { pose: number; grid: number; /** false: the first draw at a grid (target allocation, program warm-up), not timed. */ timed: boolean }

/**
 * The timed draws. Candidate grids ascending (those above the flight's ceiling are never drawn); per grid one untimed settle draw, then one timed draw per
 * pose. `record(ms)` takes the time of the step `next()` last returned (null: no timing source, the whole measurement is abandoned and the table stands).
 */
export class SharpWarm {
  private readonly grids: number[]
  private readonly budgetMs: number
  private readonly max: number
  private readonly poses: number
  private gi = 0
  private pi = -1 // -1: the settle draw
  private pending: WarmStep | null = null
  private readonly worstMs = new Map<number, number>()
  private failed = false
  private stop = false
  constructor(budgetMs = SHARP_FLIGHT_BUDGET_MS, max = 1, poses = 4) {
    this.budgetMs = budgetMs; this.max = max; this.poses = poses
    const grids = SHARP_GRIDS.filter((g) => g <= max)
    this.grids = grids.length ? grids : [SHARP_GRIDS[0]]
  }
  get complete(): boolean { return this.failed || this.stop || this.gi >= this.grids.length }
  /** The next draw, or null when finished. A step stays pending until `record`. */
  next(): WarmStep | null {
    if (this.complete) return null
    if (this.pending) return this.pending
    this.pending = { pose: Math.max(0, this.pi), grid: this.grids[this.gi], timed: this.pi >= 0 }
    return this.pending
  }
  record(ms: number | null): void {
    const step = this.pending
    if (!step) return
    this.pending = null
    if (step.timed) {
      if (ms === null || !Number.isFinite(ms) || ms < WARM_MIN_VALID_MS) { this.failed = true; return }
      this.worstMs.set(step.grid, Math.max(this.worstMs.get(step.grid) ?? 0, ms))
    }
    this.pi++
    if (this.pi >= this.poses) {
      if ((this.worstMs.get(step.grid) ?? 0) * WARM_POST_FACTOR > WARM_GIVE_UP * this.budgetMs) this.stop = true
      this.gi++
      this.pi = -1
    }
  }
  /** [grid, predicted full-frame ms] for every grid fully measured. */
  measured(): Array<[number, number]> {
    const out: Array<[number, number]> = []
    for (const [g, ms] of this.worstMs) if (this.gridDone(g)) out.push([g, ms * WARM_POST_FACTOR])
    return out
  }
  private gridDone(g: number): boolean { const i = this.grids.indexOf(g); return i >= 0 && i < this.gi }
  /** The held grid and where it came from. A measurement with no finished grid (timing failed, or cut short at the first) is the table's job: `grid` is null. */
  result(): { grid: number | null; source: 'measured' | 'table'; ms: Array<[number, number]> } {
    const ms = this.measured()
    if (this.failed || !ms.length) return { grid: null, source: 'table', ms }
    return { grid: pickFlightGrid(ms, this.budgetMs, this.max), source: 'measured', ms }
  }
}

export type PrepPhase = 'stream' | 'warm' | 'done'

/**
 * The beat's clock and decisions. `begin` once the camera is at rest at the start pose; every frame: `poseIndex(now)` is the pose to stream, `probeDue(now)`
 * says which pose's exact residency to read now, `observe` stores it, `advance` moves the phases and returns whether the camera is still held.
 */
export class FlightPrep {
  phase: PrepPhase = 'stream'
  readonly warm: SharpWarm | null
  private t0 = -1
  private lastProbeAt = -Infinity
  private probes = 0
  private readonly seen: Array<{ wanted: number; resident: number } | null>
  private bestProgress = 0
  /** Why the beat ended: 'resident', 'cap', or 'cancelled'. */
  endedBy: 'resident' | 'cap' | 'cancelled' | null = null
  endedAt = 0
  readonly maxMs: number
  readonly cold: boolean
  readonly poses: number
  constructor(maxMs: number, cold: boolean, warm: SharpWarm | null, poses = PREP_POSES) {
    this.maxMs = maxMs; this.cold = cold; this.poses = poses
    this.warm = warm
    this.seen = Array.from({ length: poses }, () => null)
  }
  get started(): boolean { return this.t0 >= 0 }
  begin(now: number): void { if (this.t0 < 0) this.t0 = now }
  elapsed(now: number): number { return this.t0 < 0 ? 0 : now - this.t0 }
  /** The pose to stream now: far to near, each for PREP_DWELL_MS, so the last one before a stop is usually the start pose's neighbourhood. */
  poseIndex(now: number): number {
    const slot = Math.floor(this.elapsed(now) / PREP_DWELL_MS)
    return this.poses - 1 - (slot % this.poses)
  }
  /** Pose whose residency to read now (one per PREP_DWELL_MS, round robin), or null. */
  probeDue(now: number): number | null {
    if (this.phase !== 'stream' || now - this.lastProbeAt < PREP_DWELL_MS) return null
    this.lastProbeAt = now
    return this.probes++ % this.poses
  }
  private observations = 0
  observe(pose: number, wanted: number, resident: number): void { if (pose >= 0 && pose < this.poses) { this.seen[pose] = { wanted, resident }; this.observations++ } }
  /** Wanted tiles over the probed poses (0: nothing wanted yet, which can be a streamer that has not built its want, not a path that needs nothing). */
  wantedTotal(): number { let w = 0; for (const s of this.seen) if (s) w += s.wanted; return w }
  /** Ready by residency: every pose probed and 95 % resident. An empty want counts only after every pose was probed twice (not-yet-enqueued is not ready). */
  residentReady(): boolean {
    const res = this.residency()
    if (!this.allProbed || res === null || res < PREP_RESIDENCY) return false
    return this.wantedTotal() > 0 || this.observations >= 2 * this.poses
  }
  /** Resident share over all poses probed so far, or null before the first probe. A pose that wants nothing counts as resident. */
  residency(): number | null {
    let w = 0, r = 0, n = 0
    for (const s of this.seen) if (s) { w += s.wanted; r += s.resident; n++ }
    return n === 0 ? null : w <= 0 ? 1 : r / w
  }
  get allProbed(): boolean { return this.seen.every((s) => s !== null) }
  /** Card fraction 0..1, never going back. */
  progress(now: number): number {
    const res = this.residency()
    const byRes = res === null ? 0 : Math.min(1, res / PREP_RESIDENCY) * (this.allProbed ? 1 : 0.9)
    const byTime = Math.min(1, this.elapsed(now) / this.maxMs) * 0.6
    this.bestProgress = Math.max(this.bestProgress, this.phase === 'done' ? 1 : Math.min(0.99, Math.max(byRes, byTime)))
    return this.bestProgress
  }
  /** Moves the phases; true while the camera must still be held. */
  advance(now: number): boolean {
    if (this.phase === 'done') return false
    const e = this.elapsed(now)
    if (this.phase === 'stream') {
      const resident = this.residentReady()
      const warmNeeded = !!this.warm && !this.warm.complete
      if (resident || e >= (warmNeeded ? this.maxMs - PREP_WARM_RESERVE_MS : this.maxMs)) {
        this.endedBy = resident ? 'resident' : 'cap'
        this.phase = warmNeeded ? 'warm' : 'done'
        if (this.phase === 'done') this.endedAt = e
      }
    }
    if (this.phase === 'warm' && (!this.warm || this.warm.complete || e >= this.maxMs)) { this.phase = 'done'; this.endedAt = e }
    return this.phase !== 'done'
  }
  /** User input, a new journey or any cancel: the beat is over, nothing is applied. */
  cancel(now: number): void { this.phase = 'done'; this.endedBy ??= 'cancelled'; this.endedAt = this.elapsed(now) }
}
