/**
 * The descent's clock. Progress is (now - t0) / ms; this moves t0 forward so that progress is monotonic and never frozen:
 * while the detailed terrain is not resident the low part eases down to WAIT_SCALE of real time (never below it), and a long frame
 * (a main-thread stall) advances the journey by at most MAX_STEP_MS, so the picture never leaps after one.
 */
export const WAIT_FROM_U = 0.4
/** The wait scale is reached gradually, over this much progress, so a missing level reads as a long ease-out and not as a stop (audit 6: ~8 s at 0.15x). */
export const WAIT_RAMP_U = 0.3
/** The slowest the clock runs while detail is missing. The camera's funnel floor (not the clock) is what keeps it above the resident level, so the clock need not crawl. */
export const WAIT_SCALE = 0.3
export const SCALE_TAU_MS = 700
export const MAX_STEP_MS = 100
/** A frame longer than this is a main-thread stall, not a slow device. */
export const STALL_MS = 250

/** How far the clock advances for a frame of `frameMs`: the whole frame, except a stall, which counts at most MAX_STEP_MS. */
export function clockStepMs(frameMs: number): number {
  return frameMs <= STALL_MS ? frameMs : Math.min(frameMs, MAX_STEP_MS)
}

export interface ClockState { t0: number; ms: number; last?: number; scale?: number }

/** Advances the clock to `now`; returns the progress (0 to 1). `detailResident`: nothing is left to wait for. */
export function stepClock(c: ClockState, now: number, detailResident: boolean): number {
  const frameMs = c.last === undefined ? 0 : Math.max(0, now - c.last)
  c.last = now
  const uNow = Math.max(0, Math.min(1, (now - c.t0) / c.ms))
  const ramp = Math.max(0, Math.min(1, (uNow - WAIT_FROM_U) / WAIT_RAMP_U))
  const want = detailResident ? 1 : 1 - (1 - WAIT_SCALE) * ramp * ramp * (3 - 2 * ramp)
  // Time-based: a slow device (4 to 15 fps) still runs the journey in its wall-clock time. Only a stall (a frame over STALL_MS) is capped.
  const step = clockStepMs(frameMs)
  const sc0 = c.scale ?? 1
  c.scale = want + (sc0 - want) * Math.exp(-step / SCALE_TAU_MS)
  c.t0 += frameMs - step * c.scale
  return Math.max(0, Math.min(1, (now - c.t0) / c.ms))
}
