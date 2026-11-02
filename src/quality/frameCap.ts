/**
 * The web frame cap (roadmap R56, MOON-11): phone and tablet classes draw at most 60 frames a second, ProMotion and 90/120 Hz panels included.
 * A 120 Hz panel otherwise gives the main thread 8.3 ms a frame it cannot meet; two frames' worth of work per 16.7 ms is steadier than every frame late.
 * Pure functions only: main.ts owns the gate and calls `shouldRun` once per rAF tick.
 */
import type { QualityClass } from './startupClass'

/** Classes that get the cap by default. Desktop and software keep drawing at the display rate. */
export const CAPPED_CLASSES: readonly QualityClass[] = ['ios', 'ipad', 'phone-android', 'tablet']
export const DEFAULT_CAP_FPS = 60
/** `?fps=N` accepts this range; anything else falls back to the class default. */
export const MIN_CAP_FPS = 15
export const MAX_CAP_FPS = 240

/** The cap in frames a second for this class and query string; 0 means no cap. `?fps=0` turns the cap off, `?fps=N` sets it for any class. */
export function frameCapFps(cls: QualityClass, search: string): number {
  const raw = new URLSearchParams(search).get('fps')
  if (raw !== null && raw.trim() !== '') {
    const v = Number(raw)
    if (v === 0) return 0
    if (Number.isFinite(v) && v >= MIN_CAP_FPS && v <= MAX_CAP_FPS) return v
  }
  return CAPPED_CLASSES.includes(cls) ? DEFAULT_CAP_FPS : 0
}

/** Early-tick tolerance as a share of the period: a 60 Hz panel's rAF jitter never skips, a 120 Hz panel's half-period tick always does. */
export const EARLY_SHARE = 0.25

/**
 * Admits rAF ticks at no more than `fps`. The schedule is a grid (`due += period`), so skipped ticks do not drift the average rate;
 * a stall longer than one period re-anchors the grid instead of bursting to catch up.
 */
export class FrameGate {
  private due = Number.NEGATIVE_INFINITY
  readonly periodMs: number
  constructor(fps: number) { this.periodMs = fps > 0 ? 1000 / fps : 0 }

  /**
   * `urgent`: the first frame after a press, touch or key. It runs at once whatever the grid says (a gesture's first frame is never held up to the
   * next grid point) and the grid restarts from it, so the following frames are a full period apart.
   */
  shouldRun(now: number, urgent = false): boolean {
    if (this.periodMs === 0) return true
    if (urgent) { this.due = now + this.periodMs; return true }
    if (now + this.periodMs * EARLY_SHARE < this.due) return false
    this.due = this.due === Number.NEGATIVE_INFINITY || now - this.due > this.periodMs ? now + this.periodMs : this.due + this.periodMs
    return true
  }
}
