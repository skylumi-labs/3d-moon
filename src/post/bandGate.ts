/**
 * When a banded refine may start or go on. The bands of one frame share the first band's exposure, so a frame spread over several draws
 * while the exposure is still moving (an eclipse flight handing over, a declared cut) shows a luminance seam at a band boundary (V4).
 */
/** After a scripted move ends the exposure controller is still settling: no banded frame starts for this long. */
export const BAND_HANDOVER_MS = 500

export interface BandStartInput {
  /** exposureCutFrames: a declared exposure cut is still pending. */
  cutFrames: number
  /** ms since a tween, flight or descent last ran. */
  sinceScriptedMs: number
  /** The exposure controller's last step was still moving. */
  exposureMoving: boolean
}
export function bandStartAllowed(i: BandStartInput): boolean {
  return i.cutFrames <= 0 && i.sinceScriptedMs >= BAND_HANDOVER_MS && !i.exposureMoving
}

/** A banded frame in progress is abandoned (and redrawn whole) when a cut is declared or the exposure starts moving. */
export function bandMustAbandon(cutFrames: number, exposureMoving: boolean): boolean {
  return cutFrames > 0 || exposureMoving
}
