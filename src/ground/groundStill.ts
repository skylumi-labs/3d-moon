/**
 * Whether the ground view is standing still, for the two consumers that mean "the visitor is not moving the camera" (the brand line's fade-in, the low-end hint's
 * motion clock). The frame loop itself keeps ground mode awake (a per-frame pass), so loopQuiet stays false there; this is the separate signal: no camera input
 * and no camera step that moved the pose within GROUND_STILL_MS.
 */
export const GROUND_STILL_MS = 400
export function groundStill(now: number, inputAt: number, motionAt: number, windowMs = GROUND_STILL_MS): boolean {
  return now - inputAt > windowMs && now - motionAt > windowMs
}

/** The two clocks groundStill reads, kept together: the last camera input (GroundCamera.onInput) and the last camera step that moved the pose (GroundCamera.step's result, which already ignores height follow under 1e-4 m). */
export class GroundStillness {
  private inputAt = -Infinity
  private motionAt = -Infinity
  noteInput(now: number): void { this.inputAt = now }
  noteStep(now: number, moved: boolean): boolean { if (moved) this.motionAt = now; return moved }
  /** `userInputAt`: the page's last pointer/key/wheel time (main.ts lastUserInputAt). */
  still(now: number, userInputAt = -Infinity, windowMs = GROUND_STILL_MS): boolean { return groundStill(now, Math.max(userInputAt, this.inputAt), this.motionAt, windowMs) }
}
