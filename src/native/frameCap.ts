/**
 * The native frame cap. An Android WebView (and a ProMotion iPhone or iPad) runs requestAnimationFrame at 120 Hz
 * or faster, and a frame drawn at that rate costs more GPU time and heat than one at 60. A native build draws at most 60 frames a second.
 * The web build is not capped: main.ts never calls this there.
 *
 * The cap is a due-time scheduler, not a fixed interval, so it gives 60 draws a second at any display rate (60, 90, 120, 144, 165 Hz):
 * each frame is due one period after the previous due time, and a frame that is late by more than a period starts the schedule again
 * rather than drawing a burst.
 */
export const NATIVE_FRAME_MS = 1000 / 60
/** Float slack: a vsync that lands on the due time (within a microsecond) counts as on time. */
const EPS_MS = 1e-3

/**
 * Whether this vsync draws. `lastDue` is the due time of the last frame drawn (null before the first). Returns the frame's due time
 * when it draws; the caller keeps it for the next call. A skipped vsync leaves the dirty flag set, so a later vsync draws it.
 */
export function capStep(now: number, lastDue: number | null): { render: boolean; lastDue: number | null } {
  if (lastDue === null) return { render: true, lastDue: now }
  const due = Math.max(lastDue + NATIVE_FRAME_MS, now - NATIVE_FRAME_MS)
  if (now + EPS_MS < due) return { render: false, lastDue }
  return { render: true, lastDue: due }
}
