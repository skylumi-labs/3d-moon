/**
 * The exposure's look-ahead on a scripted journey.
 *
 * The regular look-ahead samples the camera a few seconds ahead (AHEAD_S). A jump of many stops (the Sun's disc arriving beside the
 * Earth, 50 I/F against a night-side frame) needs longer than that to ramp at the rising rate without clipping, so the Sun's
 * ARRIVAL is searched for over the whole rest of the journey and announced as one more look-ahead entry at its own time offset.
 * Geometry only: no frame search is run for the scan.
 */

/** How far ahead the exposure looks on a scripted journey, s: the camera it will have at each offset asks for its own exposure. */
export const AHEAD_S = [0.6, 1.2, 1.8, 2.4, 3.0]
/** Scripted journeys refresh a bounded number of regular look-ahead exposures per frame. */
export const AHEAD_PER_FRAME_SCRIPTED = 2

/** Choose a contiguous round-robin batch of indices and the cursor for the next batch. */
export function aheadRefreshSet(count: number, cursor: number, perFrame: number): { indices: number[]; next: number } {
  if (count <= 0) return { indices: [], next: 0 }
  const start = ((Math.trunc(cursor) % count) + count) % count
  const n = Math.min(count, Math.max(0, Math.trunc(perFrame)))
  return { indices: Array.from({ length: n }, (_, i) => (start + i) % count), next: (start + n) % count }
}

/** Look-ahead samples belong to one scripted camera and one ephemeris minute. */
export function aheadMemoMustReset(previousOwner: unknown, owner: unknown, previousEphemerisBucket: number, ephemerisBucket: number, previousNow: number, now: number, cutFrames: number): boolean {
  return previousOwner !== owner || previousEphemerisBucket !== ephemerisBucket || cutFrames > 0 || now < previousNow || now - previousNow > 1000
}

/** A frozen exposure can only be accepted while the look-ahead cache still belongs to this frame's camera owner. */
export function aheadExposureReusable(frozen: boolean, ownershipChanged: boolean): boolean {
  return frozen && !ownershipChanged
}
/** Scan step for an arrival, s, and the bisection tolerance that places it. */
const SCAN_STEP_S = 0.1
const REFINE_S = 0.05

/**
 * The first offset in (fromS, toS] at which `bright(t)` becomes true (it is false at fromS), refined by bisection; null when it
 * never does. `bright` is pure geometry (is the Sun's disc in view, uncovered).
 */
export function firstArrivalS(bright: (tS: number) => boolean, fromS: number, toS: number): number | null {
  if (toS <= fromS || bright(fromS)) return null
  let lo = fromS
  for (let t = fromS + SCAN_STEP_S; ; t += SCAN_STEP_S) {
    const hi = Math.min(t, toS)
    if (bright(hi)) {
      let a = lo, b = hi
      while (b - a > REFINE_S) { const m = (a + b) / 2; if (bright(m)) b = m; else a = m }
      return b
    }
    lo = hi
    if (hi >= toS) return null
  }
}

/**
 * The extra look-ahead offset a journey needs: the Sun's NEXT arrival anywhere in the rest of the journey. The regular entries sample
 * 0.6 s apart and stop at 3 s, so a disc that peeks out past the Earth's limb for a fraction of a second, or arrives later than 3 s
 * out, is invisible to them and the exposure then jumps when it appears. Null when the Sun is in view already or never comes.
 */
export function sunArrivalAheadS(bright: (tS: number) => boolean, remainingS: number): number | null {
  return firstArrivalS(bright, 0, remainingS)
}
