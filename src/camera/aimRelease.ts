/**
 * The subject aim (the layout's shift of the Moon off the frame's middle, camera/rig.ts aimShift) eased to zero instead of dropped. A pick
 * that ends with the subject centred (a site descent or site view, a flight) used to set the aim to 0 before its move began: the whole picture
 * jumped by the aim on the first frame (37 px on a 1280 x 800 desktop, 70 device px on a 412 x 915 phone, rig job tap-jump.mjs), and the move
 * started from there (owner report 2026-10-29). A fly-to blends the aim itself (journey/path.ts); this is for the moves that do not.
 */
export const AIM_RELEASE_MS = 900

export class AimRelease {
  private last: { x: number; y: number } | null = null
  constructor(readonly x0: number, readonly y0: number, readonly t0: number, readonly ms = AIM_RELEASE_MS) {}
  /** The aim at `now` (smoothstep from the start to 0) and whether it has arrived. */
  at(now: number): { x: number; y: number; done: boolean } {
    const u = this.ms > 0 ? Math.max(0, Math.min(1, (now - this.t0) / this.ms)) : 1
    const k = 1 - u * u * (3 - 2 * u)
    return { x: this.x0 * k, y: this.y0 * k, done: u >= 1 }
  }
  /**
   * The aim to apply at `now`, or null when the camera was taken over: the rig's aim (`x`, `y`) is no longer what this release applied last (a grab,
   * a wheel or a stop settles the rig to the drawn view and zeroes the aim; re-applying the release would jump the picture by what is left of it).
   */
  step(now: number, x: number, y: number): { x: number; y: number; done: boolean } | null {
    if (this.last && (Math.abs(x - this.last.x) > 1e-12 || Math.abs(y - this.last.y) > 1e-12)) return null
    const a = this.at(now)
    this.last = { x: a.x, y: a.y }
    return a
  }
}
