/**
 * The frame loop must not die of one exception. It asks for its next frame at the END of a tick (and at the early returns), so a throw anywhere
 * in a tick used to end the requestAnimationFrame chain for good: a frozen or black canvas on a page that otherwise looked alive. A throw means
 * the tick scheduled nothing (every schedule is the tick's last act), so the guard schedules the retry itself, after a delay that grows with the
 * run of failures so a tick that always throws does not spin.
 */

/** Errors rethrown to the global handler (Sentry) per page load; the rest only count. */
export const LOOP_ERROR_REPORTS = 3
export const LOOP_RETRY_BASE_MS = 250
export const LOOP_RETRY_MAX_MS = 2000

export function loopErrorPlan(count: number): { rethrow: boolean; retryMs: number } {
  const n = Math.max(1, Math.floor(count))
  return { rethrow: n <= LOOP_ERROR_REPORTS, retryMs: Math.min(LOOP_RETRY_MAX_MS, LOOP_RETRY_BASE_MS * n) }
}

/** A tick that completes ends the run of failures; the retry delay starts over. */
export function loopErrorCountAfter(count: number, threw: boolean): number { return threw ? count + 1 : 0 }

/**
 * What the guard's retry timer does when it fires. While the context is lost the frame loop is meant to be stopped (its tick parks itself with
 * `loopRunning = false`), so the retry must not draw, and it must also park the loop: leaving `loopRunning` true would make the restore believe a
 * loop is alive and never schedule a frame (a frozen canvas after a successful restore).
 */
export function loopRetryAction(contextLost: boolean): 'frame' | 'park' { return contextLost ? 'park' : 'frame' }

/**
 * A `webglcontextlost` that is not a new loss: the page already knows about it (a synthetic one dispatched for a loss the event never announced,
 * followed by the real event arriving late) and no soft recovery is running. Counting it again would double the loss and lower the ceiling twice.
 * During a soft recovery a fresh event is a new loss and is handled.
 */
export function lossEventIsDuplicate(contextLost: boolean, softRecovering: boolean): boolean { return contextLost && !softRecovering }
