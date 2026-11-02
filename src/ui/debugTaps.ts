/** The hidden debug sheet opens on five presses of the Credits link within three seconds. Pure, so a test can run the clock. */
export const DEBUG_TAPS = 5
export const DEBUG_TAP_WINDOW_MS = 3000

/** Adds a press at `now` (ms) and says whether it was the fifth within the window; the list restarts after a hit. */
export function pushTap(taps: readonly number[], now: number, need = DEBUG_TAPS, windowMs = DEBUG_TAP_WINDOW_MS): { taps: number[]; fired: boolean } {
  const kept = [...taps.filter((t) => now - t <= windowMs), now]
  if (kept.length >= need) return { taps: [], fired: true }
  return { taps: kept, fired: false }
}

/** The time of a press on the page's clock: the event's own timestamp (when the input happened), so a frame that runs long cannot stretch five quick presses past the window. Falls back to `fallback` when the event carries none. */
export function tapTime(ev: { timeStamp?: number }, fallback: number = typeof performance !== 'undefined' ? performance.now() : 0): number {
  return typeof ev.timeStamp === 'number' && Number.isFinite(ev.timeStamp) && ev.timeStamp > 0 ? ev.timeStamp : fallback
}
