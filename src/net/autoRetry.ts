/**
 * The automatic retry of a site photograph that failed (review of PR 88). It retries the DATA only: it never moves the camera, never
 * starts while the visitor is touching the Moon or a move is running, and waits for the browser to say it is online.
 */

/** The waits (ms) before the 1st, 2nd and 3rd automatic try. Each try is a whole load with the loader's own retries (about 8.5 s), so the third starts about 4 + 8.5 + 12 + 8.5 + 30 = 63 s after the first failure. */
export const PATCH_AUTO_RETRY_MS = [4000, 12000, 30000]
/** When the visitor is busy at the moment a try is due, look again after this. */
export const AUTO_RETRY_BUSY_MS = 3000

/** The wait before try number `tried + 1`, or null when the tries are used up. */
export function autoRetryDelay(tried: number): number | null {
  return tried >= 0 && tried < PATCH_AUTO_RETRY_MS.length ? PATCH_AUTO_RETRY_MS[tried] : null
}

export interface AutoRetryState {
  /** The pin on screen needs this site's photograph (null: no pin is shown). */
  shownNeeds: string | null
  siteId: string
  patchSiteId: string | null
  patchState: string
  online: boolean
  /** A finger or a glide is turning the Moon, or a move or descent is running. */
  busy: boolean
}
/** 'go' retry now; 'wait' try again shortly (busy or offline); 'stop' there is nothing to retry any more. */
export function autoRetryVerdict(s: AutoRetryState): 'go' | 'wait' | 'stop' {
  if (s.shownNeeds !== s.siteId || s.patchSiteId !== s.siteId || s.patchState !== 'failed') return 'stop'
  if (!s.online || s.busy) return 'wait'
  return 'go'
}
