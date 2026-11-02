/**
 * What a cancelled journey does. A planner journey (a pin's fly-to) that stops before it ends can leave the camera
 * anywhere along the path: WP2's phone pass once found the Copernicus move stopped at latitude 83 deg, 1.78 radii up, a dark
 * frame. The rule now is that a pin's journey always ends somewhere sane: it reaches its target, or the visitor takes the
 * camera on purpose.
 *
 *   - A date change (the bar's slider, N, the clock) is not the visitor asking for the camera: the journey keeps going.
 *   - A touch on the canvas takes the camera as it stands. A TAP (no drag, no wheel, over in a moment) was not a gesture
 *     that wanted a camera, so the journey resumes toward its target from where it stopped; a drag or the wheel keeps the
 *     camera where the visitor put it.
 */
export type CancelCause = 'clock' | 'grab' | 'other'

/** A tap: the pointer went up within `TAP_MS` of going down and moved less than `TAP_PX`. */
export const TAP_MS = 350
export const TAP_PX = 8

export function isTap(down: { x: number; y: number; at: number }, up: { x: number; y: number; at: number }, wheeled = false): boolean {
  return !wheeled && up.at - down.at <= TAP_MS && Math.hypot(up.x - down.x, up.y - down.y) <= TAP_PX
}

/** What to do with a journey in flight when `cause` asks to stop it: keep it going, stop and remember it for a tap, or stop. */
export function onCancel(cause: CancelCause, pinJourneyRunning: boolean): 'continue' | 'stop-resumable' | 'stop' {
  if (!pinJourneyRunning) return 'stop'
  if (cause === 'clock') return 'continue'
  if (cause === 'grab') return 'stop-resumable'
  return 'stop'
}

/**
 * Whether a stop leaves an in-flight patch download (or its refinement) alone. A grab (pointer down, wheel) on a camera no script owns
 * has nothing to cancel: the download goes on, so a few seconds of zoom gesture no longer throw away every partial file (#185).
 * Anything else, or a grab that interrupts a running script, still cancels what that script asked for.
 */
export function keepPatchLoad(cause: CancelCause, scriptRunning: boolean): boolean {
  return cause === 'grab' && !scriptRunning
}

/** After a grab ends: resume the stopped journey for a tap, drop it for anything else. */
export function afterGrab(tap: boolean, resumable: boolean): 'resume' | 'release' {
  return tap && resumable ? 'resume' : 'release'
}

/** Cancels a running journey and any deferred action that was waiting for its arrival. */
export function cancelJourneyAndContinuation(journey: { cancel(): void }, clearContinuation: () => void): void {
  clearContinuation()
  journey.cancel()
}

/**
 * Whether Escape should stop a viewpoint journey instead of going Home: a scripted camera is running, or the journey is loading or travelling.
 * An arrived, cancelled or absent journey is not busy, so Escape twice from a flight stops it and then goes Home.
 */
export function viewpointJourneyBusy(status: string | undefined, scriptedCamera: boolean): boolean {
  return scriptedCamera || status === 'loading' || status === 'travelling'
}
