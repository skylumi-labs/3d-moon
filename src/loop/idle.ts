/**
 * The loop's rest state (R52). The frame loop used to ask for a frame at every vsync for as long as the page was open, even
 * with nothing to draw: each tick still ran the caption, layout, scrub and bookkeeping code (about the cost of a small idle
 * app on the main thread, and a battery drain on a phone). Once the scene has been still and quiet for `IDLE_AFTER_MS` the loop
 * now stops asking for frames and sleeps. It wakes on:
 *   - any redraw request (`markDirty`), which every change to the picture already goes through;
 *   - any input (pointer, wheel, key, touch, resize, focus, visibility), so a tap never waits for a timer;
 *   - a heartbeat tick every `HEARTBEAT_MS`, so state that has no wake call of its own (the live clock, a pending
 *     prefetch, a nav chip) is seen at most one second late instead of being missed.
 * `?idle=0` turns the sleep off (the loop asks for a frame at every vsync, as before).
 */
export const IDLE_AFTER_MS = 2500
export const HEARTBEAT_MS = 1000

/** `?idle=0` (or `off`) disables the rest state; anything else, or no value, leaves it on. */
export function idleOn(search: string): boolean {
  const v = new URLSearchParams(search).get('idle')
  return !(v === '0' || v === 'off')
}

/** Counts how long the loop has been continuously quiet and says when it may sleep. Pure: the loop passes `now`. */
export class IdleGate {
  private since = -1
  constructor(private readonly afterMs = IDLE_AFTER_MS) {}
  /** Call once per ticked frame with whether anything is going on. True: stop asking for frames. */
  update(quiet: boolean, now: number): boolean {
    if (!quiet) { this.since = -1; return false }
    if (this.since < 0) this.since = now
    return now - this.since >= this.afterMs
  }
  /** Input woke the loop: start the quiet spell over. (A heartbeat wake keeps it, so the tick goes straight back to sleep.) */
  reset(): void { this.since = -1 }
  get quietSince(): number { return this.since }
}

/** The inputs that wake a sleeping loop at once. */
export const WAKE_EVENTS: readonly string[] = ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'touchstart', 'touchmove', 'resize', 'focus', 'visibilitychange', 'orientationchange']

/** What the loop is doing about a wake request: `run` (schedule a frame), or `ignore` (already running, or it must stay stopped). */
export function wakeAction(loopRunning: boolean, contextLost: boolean, paused: boolean): 'run' | 'ignore' {
  return loopRunning || contextLost || paused ? 'ignore' : 'run'
}

/**
 * How long a sleeping loop waits before it ticks again. Normally a heartbeat; with the live clock running, the due time of its next tick when that is
 * sooner, so the Sun and the terminator move on the same schedule as with an awake loop (the tick is then drawn like any other).
 */
export function beatDelay(live: boolean, sinceLiveTickMs: number, liveTickMs: number): number {
  if (!live) return HEARTBEAT_MS
  return Math.max(1, Math.min(HEARTBEAT_MS, liveTickMs - sinceLiveTickMs + 1))
}
