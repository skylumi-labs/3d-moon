/** Pure pointer bookkeeping for camera gestures. DOM capture checks are supplied by the caller. */
export const POINTER_STALE_MS = 1000
export const POINTER_DRAG_START_PX = 3
/** Camera gestures use at most two fingers: a third pointer means an earlier one lost its up (a backgrounded Android page keeps its capture). */
export const MAX_POINTERS = 2

export interface PointerPoint { x: number; y: number }
export interface PointerSample extends PointerPoint { at: number }

export class PointerState {
  readonly pointers = new Map<number, PointerSample>()
  downAt: { x: number; y: number; t: number } | null = null
  travelled = 0
  dragStarted = false
  tapEligible = false
  pairPrev: Map<number, PointerPoint> | null = null

  private resetPair(): void {
    this.pairPrev = this.pointers.size >= 2
      ? new Map([...this.pointers.entries()].slice(0, 2).map(([id, p]) => [id, { x: p.x, y: p.y }]))
      : null
  }

  /** Purges uncaptured stale fingers before admitting a fresh pointer. */
  down(id: number, x: number, y: number, now: number, hasCapture: (id: number) => boolean): number[] {
    const purged: number[] = []
    for (const [other, p] of this.pointers) {
      if (other !== id && now - p.at > POINTER_STALE_MS && !hasCapture(other)) {
        this.pointers.delete(other)
        purged.push(other)
      }
    }
    // Never more than a pinch pair: the pair is read as the first two entries, so a stale finger that still holds capture (no up, no cancel,
    // no lostpointercapture after the page was backgrounded) would otherwise stay first for good and every later pinch would measure against it.
    while (this.pointers.size >= MAX_POINTERS && !this.pointers.has(id)) {
      let oldest = -1, oldestAt = Infinity
      for (const [other, p] of this.pointers) if (p.at < oldestAt) { oldest = other; oldestAt = p.at }
      this.pointers.delete(oldest)
      purged.push(oldest)
    }
    this.pointers.set(id, { x, y, at: now })
    this.downAt = this.pointers.size === 1 ? { x, y, t: now } : null
    this.travelled = 0
    this.dragStarted = false
    this.tapEligible = this.pointers.size === 1
    this.resetPair()
    return purged
  }

  move(id: number, x: number, y: number, now: number): { prev: PointerSample; started: boolean } | null {
    const prev = this.pointers.get(id)
    if (!prev) return null
    if (this.downAt) this.travelled = Math.max(this.travelled, Math.hypot(x - this.downAt.x, y - this.downAt.y))
    let started = false
    if (this.pointers.size === 1 && !this.dragStarted && this.downAt
      && Math.hypot(x - this.downAt.x, y - this.downAt.y) >= POINTER_DRAG_START_PX) {
      this.dragStarted = true
      started = true
    }
    // Before drag start, retain the original position so the first deliberate move applies its full delta.
    if (this.pointers.size > 1 || this.dragStarted) this.pointers.set(id, { x, y, at: now })
    else this.pointers.set(id, { ...prev, at: now })
    return { prev, started }
  }

  /** End/cancel/lost-capture starts a remaining finger as a new single gesture. */
  remove(id: number, now: number): { had: boolean; remaining: PointerSample | null } {
    // An id this state never saw (a finger that began on UI, or one already removed) changes nothing: it must not reset a running pinch.
    if (!this.pointers.has(id)) return { had: false, remaining: this.pointers.size === 1 ? [...this.pointers.values()][0]! : null }
    const had = this.pointers.delete(id)
    this.resetPair()
    const remaining = this.pointers.size === 1 ? [...this.pointers.values()][0] : null
    if (remaining) {
      this.downAt = { x: remaining.x, y: remaining.y, t: now }
      this.travelled = 0
      this.dragStarted = false
      this.tapEligible = false
    } else if (this.pointers.size === 0) {
      this.downAt = null
      this.travelled = 0
      this.dragStarted = false
      this.tapEligible = false
    } else this.downAt = null
    return { had, remaining }
  }

  clear(): void {
    this.pointers.clear()
    this.downAt = null
    this.travelled = 0
    this.dragStarted = false
    this.tapEligible = false
    this.resetPair()
  }
}
