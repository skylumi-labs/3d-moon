/**
 * What leaving the ridge view puts back. startRidge changes the clock (the ridge evening), the live flag and the idle
 * orbit; every way out restores the orbit setting and keeps the ridge's date (the Moon the visitor just saw), and the
 * "Back to now" chip shows whenever the clock is not live. Pure so the rules can be tested without the renderer.
 */
export interface RidgeExitInput {
  /** Whether the idle orbit is allowed at all (the ?auto=0 switch and still captures turn it off). */
  autoAllowed: boolean
  /** The clock's live flag as the ridge left it. */
  live: boolean
}
export interface RidgeExit {
  /** The idle orbit setting to restore. */
  auto: boolean
  /** The clock is untouched: the ridge date stays. */
  keepTime: true
  /** Whether the Back to now chip must show. */
  showBackToNow: boolean
}
export function ridgeExit(i: RidgeExitInput): RidgeExit {
  return { auto: i.autoAllowed, keepTime: true, showBackToNow: !i.live }
}
