/**
 * Journey scrubbing, shared by every mode that has a journey (the ridge lift-off, the descent to a landing site, the
 * powered descent flight, the dolly zooms and tweens between views). A journey is anything whose state is a function
 * of one progress number: the handle reads and sets it. Dragging the slider holds the journey at the dragged progress
 * (forward or backward, at any speed); releasing lets it run on from there.
 *
 * Pure: no DOM, no clock of its own (`now` comes from the caller, in the same clock the journey uses).
 */

export interface JourneyHandle {
  id: string
  label: string
  /** Progress now, 0 to 1. */
  get(): number
  /** Puts the journey at progress u (exact), from anywhere. */
  set(u: number, now?: number): void
  /** Called with true when a drag starts and false when it ends: a journey with a clock of its own stops it meanwhile. */
  freeze?(on: boolean): void
  /** A short note for the readout ("time-compressed", "1972 clock"). */
  note?(): string
  /** Total length in seconds, when it is a fixed length: the readout then reads "0:12 of 0:48". */
  durationS?: number
  /** A journey that can be held where it is: whether it is held now, and the setter (the slider's pause button). */
  paused?(): boolean
  pause?(on: boolean): void
  /**
   * The lead-in of a journey that has not started its own clock yet (a moment's approach before its flight or orbit): a drag
   * starts the journey at the dragged progress, and the hold passes to the journey's own handle when it attaches.
   */
  leadIn?: boolean
}

export const clamp01 = (u: number): number => (Number.isFinite(u) ? Math.max(0, Math.min(1, u)) : 0)

/** The start time that puts a timed journey (progress = (now - t0) / ms) at progress u at `now`. */
export const t0AtProgress = (now: number, u: number, ms: number): number => now - clamp01(u) * ms
/** Progress of a timed journey. */
export const progressOfTimed = (now: number, t0: number, ms: number): number => clamp01((now - t0) / ms)

/** A slider's value in [min, max] as progress. */
export const valueToProgress = (v: number, min: number, max: number): number => (max > min ? clamp01((v - min) / (max - min)) : 0)
export const progressToValue = (u: number, min: number, max: number): number => min + clamp01(u) * (max - min)

/**
 * A held drag stops just short of the end: a journey completes (a mode change, a tween's end, a landing) only when the
 * finger lets go, never under it. Releasing lets it run the last thousandth on its own.
 */
export const HELD_MAX = 1 - 1e-3

/** One arrow press on the slider, in seconds of a journey of known length; a journey without one steps SCRUB_KEY_SHARE. */
export const SCRUB_KEY_S = 2
export const SCRUB_KEY_SHARE = 0.05
/** Page Up and Page Down step this share. */
export const SCRUB_PAGE_SHARE = 0.2

/**
 * Where a key press on the slider puts the journey, from its progress now, or null for a key the slider does not take. The range input's own
 * step is a thousandth of the journey (a 30 s flight moved 0.03 s per press, which read as a key that did nothing); this steps whole seconds.
 */
export function scrubKeyTarget(key: string, u: number, durationS?: number): number | null {
  const step = durationS && durationS > 0 ? Math.min(SCRUB_PAGE_SHARE, SCRUB_KEY_S / durationS) : SCRUB_KEY_SHARE
  switch (key) {
    case 'ArrowRight': case 'ArrowUp': return clamp01(u + step)
    case 'ArrowLeft': case 'ArrowDown': return clamp01(u - step)
    case 'PageUp': return clamp01(u + SCRUB_PAGE_SHARE)
    case 'PageDown': return clamp01(u - SCRUB_PAGE_SHARE)
    case 'Home': return 0
    case 'End': return 1
    default: return null
  }
}

export class JourneyScrub {
  private handle: JourneyHandle | null = null
  private heldU = 0
  held = false

  /**
   * The journey the slider drives now (null: none, the slider hides). Changing it releases a drag, except from a lead-in
   * to the journey it led into: the finger keeps holding that journey at the same progress.
   */
  attach(h: JourneyHandle | null): void {
    if (h === this.handle) return
    const from = this.handle
    this.handle = h
    if (!this.held) return
    from?.freeze?.(false)
    if (from?.leadIn && h) { h.freeze?.(true); h.set(this.heldU); return }
    this.held = false
  }
  get current(): JourneyHandle | null { return this.handle }

  begin(u: number): void {
    if (!this.handle) return
    if (!this.held) this.handle.freeze?.(true)
    this.held = true
    this.move(u)
  }
  move(u: number, now?: number): void {
    if (!this.handle) return
    this.heldU = Math.min(HELD_MAX, clamp01(u))
    this.handle.set(this.heldU, now)
  }
  end(): void {
    if (!this.held) return
    this.held = false
    this.handle?.freeze?.(false)
  }
  /** Once a frame, before the journeys step: a held journey stays exactly where the slider put it. */
  hold(now?: number): void {
    if (this.held && this.handle) this.handle.set(this.heldU, now)
  }
  /** What the slider shows. */
  progress(): number {
    return this.held ? this.heldU : this.handle ? clamp01(this.handle.get()) : 0
  }
}
