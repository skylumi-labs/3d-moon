import { MOTION_STEPS, frameBudgetMs } from '../post/motionGrid'

/**
 * Ground mode's own motion budget (`?groundbudget=1`, owner complaint 8: the eye-level view is "very jaggy").
 *
 * The motion grid a gesture starts on is learned by post/motionGrid.ts from the orbital Moon pass's frames, whose cost scales with the pixel count. A ground
 * frame is a different animal: one hit ray is 44-62 % of it (ledger #76) and its height probes stall the CPU (#65), so the grid the Moon pass learned is the
 * wrong start for a walk or a look on the ground. This keeps a separate record, fed only with ground frames, of the grid that last fit the frame budget, so
 * the next look or walk input starts there (main.ts asks `GroundMode.budget` for it when the switch is on) instead of on the Moon pass's grid.
 *
 * Learning: a grid that runs over the budget on `OVER_FRAMES` consecutive frames is given up for the step below; a grid that stays calm for `CALM_FRAMES`
 * is kept, and the step above is tried on the next gesture only when the frame's own cost, scaled by the pixel count, is predicted to fit. Evidence older
 * than `MEMORY_MS` is forgotten (the Sun, the patch levels and the device state all move on).
 */
export const OVER = 1.15
export const OVER_FRAMES = 2
export const CALM = 0.8
export const CALM_FRAMES = 14
export const MEMORY_MS = 60_000
const KEEP = 12

const median = (v: number[]): number => { const s = [...v].sort((a, b) => a - b); return s.length ? s[(s.length - 1) >> 1] : 0 }

export class GroundBudget {
  private readonly obs = new Map<number, number[]>()
  /** The grid the next ground gesture starts on, once learned. */
  private affordable: number | null = null
  private at = -Infinity
  private over = 0
  private calm = 0
  private calmOn = 0

  /** Folds one ground frame (period `ms`, drawn on grid `s`) into the record. */
  observe(s: number, ms: number, budgetMs = frameBudgetMs(60), now = performance.now()): void {
    if (!(ms > 0) || !MOTION_STEPS.includes(s)) return
    // Evidence older than the memory is gone before a new frame is counted, not merely hidden by `start`: a stale median or streak must not come back.
    if (now - this.at > MEMORY_MS) { this.obs.clear(); this.affordable = null; this.over = 0; this.calm = 0; this.calmOn = 0 }
    const v = this.obs.get(s) ?? []
    v.push(Math.min(ms, 3 * budgetMs)); if (v.length > KEEP) v.shift()
    this.obs.set(s, v)
    this.at = now
    // Both streaks are per grid: a slow rest frame on one grid and a slow gesture frame on another are not two slow frames on either.
    if (this.calmOn !== s) { this.calmOn = s; this.calm = 0; this.over = 0 }
    this.over = ms > OVER * budgetMs ? this.over + 1 : 0
    this.calm = ms < CALM * budgetMs ? this.calm + 1 : 0
    if (this.over >= OVER_FRAMES) {
      // Too slow here: start the next gesture one step down (never below the coarsest grid).
      this.affordable = MOTION_STEPS[Math.max(0, MOTION_STEPS.indexOf(s) - 1)]
      this.over = 0
      this.calm = 0
    } else if (this.calm >= CALM_FRAMES) {
      // Proven here; the step above only when this grid's own median, scaled by the pixel count, still fits.
      const up = MOTION_STEPS[Math.min(MOTION_STEPS.length - 1, MOTION_STEPS.indexOf(s) + 1)]
      this.affordable = up > s && median(v) * (up / s) ** 2 <= CALM * budgetMs ? up : s
      this.calm = 0
    }
  }

  /** The grid a ground gesture starts on: the learned one, capped at `max`; `fallback` (the Moon pass's choice) until something is learned or after it expired. */
  start(fallback: number, max = 1, now = performance.now()): number {
    if (this.affordable === null || now - this.at > MEMORY_MS) return fallback
    return Math.min(this.affordable, max)
  }

  /** For __moon.perf: the learned grid and the per-grid median periods. */
  snapshot(): { affordable: number | null; obs: Record<string, number> } {
    const obs: Record<string, number> = {}
    for (const [s, v] of this.obs) obs[String(s)] = +median(v).toFixed(1)
    return { affordable: this.affordable, obs }
  }
}

/**
 * The ground switches, read from the page's query (GroundMode reads them once in its constructor, the way GroundPass reads `?hit=`):
 *   `?gprobe=async`     heights for walking and gliding read back through a fence, served one frame late (GroundMode.groundZ, ProbeQueue)
 *   `?groundbudget=1`   the ground's own motion budget (above); inert until main.ts calls `budget.start` / `budget.observe`
 *   `?grefit=1`         a refit reads its five points in one readback and waits briefly for the input to pause (GroundMode.refitLm)
 * All default off until the rig has numbers (ledger); each is one thing, so a rig arm measures one thing.
 */
export interface GroundSwitches { asyncProbe: boolean; budget: boolean; refit: boolean }
export function groundSwitches(search: string): GroundSwitches {
  const q = new URLSearchParams(search)
  return { asyncProbe: q.get('gprobe') === 'async', budget: q.get('groundbudget') === '1', refit: q.get('grefit') === '1' }
}

/**
 * Folds completed measurements into the ground budget: only samples SUBMITTED in ground mode (ctx 1) count, on the grid they were submitted at; an orbit sample
 * that lands after the switch to ground is dropped. Null budget (switch off) is a no-op. Each sample is handed out once by GpuTimer.drainSamples/drainPeriods.
 */
export function foldGroundSamples(budget: GroundBudget | null | undefined, samples: ReadonlyArray<{ scale: number; ms: number; ctx: number }>, budgetMs: number, now?: number): number {
  if (!budget) return 0
  let n = 0
  for (const s of samples) if (s.ctx === 1) { budget.observe(s.scale, s.ms, budgetMs, now); n++ }
  return n
}
