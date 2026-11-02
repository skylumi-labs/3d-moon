/**
 * Time-scrub helpers, pure so they can be tested without a page.
 *
 * Dragging the time slider (or any control that sets the clock continuously) used to run, for EVERY input event: a crossfade pass (a full
 * extra final composite), a new ephemeris, and then, per rendered frame, a fresh exposure search. These keep a continuous gesture to one clock
 * update and one picture per frame, with shadows still drawn from the live Sun every frame.
 */

/** Calls `apply` at most once per animation frame with the latest pushed value; `flush` applies a pending value now (a gesture's last event). */
export interface FrameCoalescer<T> { push(v: T): void; flush(): void; readonly pending: boolean }
export function coalescePerFrame<T>(apply: (v: T) => void, raf: (cb: () => void) => unknown = (cb) => requestAnimationFrame(cb)): FrameCoalescer<T> {
  let has = false
  let latest: T | undefined
  let queued = false
  const run = (): void => {
    queued = false
    if (!has) return
    has = false
    apply(latest as T)
  }
  return {
    push(v) { latest = v; has = true; if (!queued) { queued = true; raf(run) } },
    flush() { run() },
    get pending() { return has },
  }
}

/** A date change that follows another within this many ms is part of one continuous scrub. */
export const SCRUB_GAP_MS = 250

/** Tells a continuous scrub from an isolated jump. `note(now)` is called at each date change and answers whether it continues a scrub. */
export class ScrubGate {
  private last = -Infinity
  note(now: number): boolean {
    const continuous = now - this.last < SCRUB_GAP_MS
    this.last = now
    return continuous
  }
  /** Whether a scrub is still running at `now` (the last change was less than the gap ago). */
  active(now: number): boolean { return now - this.last < SCRUB_GAP_MS }
}

/** How stale an exposure search may be while a scrub runs, ms: a few frames, well under the exposure controller's own slew. */
export const SCRUB_SEARCH_REUSE_MS = 100
