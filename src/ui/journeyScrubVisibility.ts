/**
 * When the journey slider is on screen. Pure: no DOM, no clock of its own (`now` comes from the caller).
 *
 * The slider stays up for the whole animation, so a viewer can go back in time while it runs: live while a journey
 * handle is attached; locked at 0 (shown, disabled) in the lead-in before the handle exists (the approach tween of a
 * moment, the blend into a flight, the wait for its clock), so nothing snaps when the live handle takes over; and,
 * after an animation ran to its natural end, held at the end for ENDING_MS and then gone (a finished flight cannot be
 * re-entered from the slider). Any cancel or mode change (`cancelled`) removes it at once. Plain fly-to tweens
 * (Home, a pin, Next/Back) are not journeys the slider shows.
 */

export const ENDING_MS = 3000

/** The ridge has its own controls. */
export const scrubHandleShown = (id: string): boolean => id !== 'ridge'

export type ScrubMode = 'live' | 'locked' | 'ending' | 'hidden'

export interface ScrubVisibilityInput {
  /** Id of the live handle attached now (null: none, or a plain tween). */
  handleId: string | null
  /** A scripted moment is running or about to (a flight blending in or waiting for its clock, a moment's approach tween, a descent). */
  animating: boolean
  /** Until when (ms, caller's clock) the slider lingers after a natural end; 0 for not at all. */
  endingUntil: number
  now: number
}

export interface ScrubVisibility { mode: ScrubMode; /** Slider position when not live: 0 in the lead-in, 1 in the ending. */ lockedAt: 0 | 1 }

export function scrubVisibility(i: ScrubVisibilityInput): ScrubVisibility {
  if (i.handleId !== null) return { mode: scrubHandleShown(i.handleId) ? 'live' : 'hidden', lockedAt: 0 }
  if (i.animating) return { mode: 'locked', lockedAt: 0 }
  if (i.now < i.endingUntil) return { mode: 'ending', lockedAt: 1 }
  return { mode: 'hidden', lockedAt: 0 }
}

/**
 * The next `endingUntil`, once a frame. While a live handle is attached the deadline trails `now`, so the countdown
 * starts the moment the handle goes (the natural end). `cancelled`: the user stopped it, or the mode changed.
 */
export function nextEndingUntil(prev: number, i: { handleId: string | null; cancelled: boolean; now: number }): number {
  if (i.cancelled) return 0
  if (i.handleId !== null) return scrubHandleShown(i.handleId) ? i.now + ENDING_MS : 0
  return prev
}
