/** Captured displayed frame to current scene, 0.6 s. Dates do not interpolate celestial physics. */
export const DATE_CROSSFADE_MS = 600
export function dateBlend(now: number, began: number): number {
  const u = Math.max(0, Math.min(1, (now - began) / DATE_CROSSFADE_MS))
  return u * u * (3 - 2 * u)
}

/** A refinement advances on presented frames, so one expensive first frame cannot consume the entire fade. */
export class RefinementClock {
  private previous = 0
  private elapsed = 0
  private duration = 0
  start(now: number, duration: number): void { this.previous = now; this.elapsed = 0; this.duration = duration }
  step(now: number): number {
    this.elapsed += Math.min(1000 / 30, Math.max(0, now - this.previous))
    this.previous = now
    return this.duration > 0 ? Math.min(1, this.elapsed / this.duration) : 1
  }
}

/** A fade may reuse the last scene only when that scene still matches the camera and neither pacing gate deferred a newer frame. */
export function canDrawFinalOnly(dirty: boolean, finalOnlyPending: boolean, heldByFramePacer: boolean, heldByCadence: boolean, hasScene: boolean): boolean {
  return finalOnlyPending && hasScene && !dirty && !heldByFramePacer && !heldByCadence
}

/**
 * Whether a date change crossfades the last drawn picture into the new one. A journey start that does not hold the camera (a moment's fly-to or flight
 * moves on its first frame) would blend a FROZEN picture of the old view under the moving camera for DATE_CROSSFADE_MS: the old disc's edge stays on
 * screen as a fixed horizontal line fading over 0.6 s (R4: eclipse start, seam at one row for ~0.5 s, V4). Such a start is cut instead; the declared
 * exposure cut already hides the jump. Scrubs, pins and Time-sheet changes (held or on a still camera) keep their blend.
 * Every moment start counts, a link opened with ?moment= (an instant start that cuts the camera on frame 1) as well: #268 passed `!instant`, so the
 * link path still blended the frozen Home picture under the eclipse flight, and R4 (which opens the moment from a link) kept its seam at the Home
 * disc's bottom row (1021b: row 0.60 in every failing frame, fading from ~15 levels to nothing over ~0.55 s).
 */
export function dateChangeCrossfades(holdMs: number, journeyStart: boolean, ghostKept = false): boolean {
  return ghostKept || holdMs > 0 || !journeyStart
}
