/**
 * Keeps full-size frames from queueing behind each other on the GPU after a gesture ends.
 *
 * At the terminator a full-size frame costs 54 ms of GPU and the loop wants one every 16.7 ms (the crossfade and the exposure easing both ask for a
 * redraw each frame), so three sat in the queue and every frame reached the screen about 180 ms after it was submitted: the picture that should have
 * been sharp 250 ms after release arrived at 350 ms. While the previous frame has not finished, the next one waits (the redraw stays pending), so a
 * frame is at most one frame late. Never waits for the GPU itself: a fence polled with a zero timeout.
 */
export interface FenceGl {
  SYNC_GPU_COMMANDS_COMPLETE: number; ALREADY_SIGNALED: number; CONDITION_SATISFIED: number
  fenceSync(cond: number, flags: number): unknown; deleteSync(s: unknown): void; flush(): void
  clientWaitSync(s: unknown, flags: number, timeout: number): number
}

/** A fence older than this is treated as lost (a stalled GPU process): the hold is released so the picture cannot freeze. Not a pacing knob. */
export const PACER_STALE_MS = 2000

/** A frame period at or under this (ms) is a frame that fits a vsync or two: such frames are never held (the compositor's own present queue keeps two or three of them in flight by design). */
export const PACER_LIGHT_MS = 25
/** An unsignalled fence older than this (ms) makes the pacer strict at once: three vsyncs of backlog is not the present queue, it is a dear frame. */
export const PACER_OLD_MS = 50

/**
 * Hard backpressure for dear frames: at most one in flight when frames are dear (period over PACER_LIGHT_MS, or the oldest running frame older than
 * PACER_OLD_MS), no limit while they are light. The phone's 350 to 640 ms full frames queued 1 to 2.5 s deep without it. Holding light frames too
 * is a loss, not a gain: a fence is only seen at the next rAF and Chrome's own present queue keeps several light frames in flight, so a count limit
 * skipped vsyncs (measured on the L4 emulation: zoom presented 96 % to 90 to 92 % with one or two in flight).
 * No time-based release: a running dear frame holds the next however long it takes, until its fence signals, the tab is hidden, or the fence is
 * older than PACER_STALE_MS. A lost context never reaches here (the frame loop returns first).
 */
export class FramePacer {
  constructor(private readonly oldMs = PACER_OLD_MS, private readonly lightMs = PACER_LIGHT_MS) {}
  private readonly q: Array<{ fence: unknown; at: number; tag?: unknown }> = []
  /** Frames drawn with a tag that have been seen to finish: the tag and the submit-to-seen-done period (ms). Drained by the caller. */
  readonly finished: Array<{ tag: unknown; ms: number }> = []
  /** Frames held (a redraw that stayed pending because the last frame was still running). */
  held = 0
  /** Smoothed submit-to-seen-done period of the frames the pacer has watched (ms). */
  periodMs = 0
  /** Frames not yet seen to finish. */
  get inFlight(): number { return this.q.length }
  /** How many frames may be in flight now: one when frames are dear, unlimited when light. */
  get depth(): number { return this.periodMs > this.lightMs ? 1 : Infinity }

  /**
   * `?pace=rest` (rest-to-motion, WP-A): the pacer watches REST frames only. A gesture frame is neither fenced nor held (one in flight on motion frames is the #96
   * regression, 49 % presented on a 60 Hz desktop), but the fences already queued are still polled each rAF so a rest period is read when it ends, not a gesture later.
   * At rest, and for the press that starts a gesture, EXACTLY ONE rest submit may be outstanding, whatever the period history says (review item 4: the motion
   * pacer's light/dear rule let several 500 ms rest frames queue before it had 50 ms of history): a press waits for at most the one rest frame in flight.
   * A stale fence and a hidden tab release as in `shouldHold`.
   */
  shouldHoldRest(gl: FenceGl, now: number, gestureOn: boolean, ignore = false): boolean {
    if (this.q.length === 0) return false
    if (ignore || now - this.q[0].at > PACER_STALE_MS) { this.reset(gl); return false }
    this.drain(gl, now)
    if (gestureOn || this.q.length === 0) return false
    this.held++
    return true
  }

  /** Drops the fences that have signalled and folds their periods, holding nothing. */
  poll(gl: FenceGl, now: number): void {
    if (this.q.length === 0) return
    if (now - this.q[0].at > PACER_STALE_MS) { this.reset(gl); return }
    this.drain(gl, now)
  }

  /** True when the next frame should wait. `ignore` (hidden tab) releases. */
  shouldHold(gl: FenceGl, now: number, ignore = false): boolean {
    if (this.q.length === 0) return false
    if (ignore || now - this.q[0].at > PACER_STALE_MS) { this.reset(gl); return false }
    this.drain(gl, now)
    // A banded rest frame in flight is strict by itself: bands go one per signalled fence whatever the motion history says, or they queue on the GPU as one dear frame (and the cost model reads the queue).
    if (this.q.length > 0 && this.q[0].tag !== undefined) { this.held++; return true }
    // A frame still running after three vsyncs is dear whatever the history says (the first frame of a heavy gesture).
    const dear = this.q.length > 0 && now - this.q[0].at > this.oldMs
    if (this.q.length < (dear ? 1 : this.depth)) return false
    this.held++
    return true
  }

  private drain(gl: FenceGl, now: number): void {
    while (this.q.length) {
      const st = gl.clientWaitSync(this.q[0].fence, 0, 0)
      if (st !== gl.ALREADY_SIGNALED && st !== gl.CONDITION_SATISFIED) break
      const f = this.q.shift()!
      gl.deleteSync(f.fence)
      const ms = now - f.at
      // A tagged frame is a budgeted rest band: its period carries vsync waits and must not make the NEXT gesture's motion frames look dear (depth 1 skips vsyncs). The fence-age rule still holds a running dear band.
      if (f.tag !== undefined) this.finished.push({ tag: f.tag, ms })
      else this.periodMs = this.periodMs === 0 ? ms : this.periodMs * 0.7 + ms * 0.3
    }
  }

  /** Drops every pending fence. */
  reset(gl: FenceGl): void { for (const f of this.q) gl.deleteSync(f.fence); this.q.length = 0; this.finished.length = 0 }

  /** Call right after a frame's draw calls: fences it. */
  drew(gl: FenceGl, now: number, flush = true, tag?: unknown): void {
    this.q.push({ fence: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), at: now, tag })
    if (flush) gl.flush()
  }
}
