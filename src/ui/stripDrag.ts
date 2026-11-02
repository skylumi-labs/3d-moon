import { type StripDrag, stripDragMove, stripDragStart, stripDragTakes } from './viewpointCards'

/** What the strip needs to be: the DOM element in the app, a fake in scripts/strip-drag.test.mts. */
export interface StripElement extends EventTarget {
  scrollLeft: number
  classList: { add(name: string): void; remove(name: string): void }
  setPointerCapture(pointerId: number): void
  hasPointerCapture(pointerId: number): boolean
}

/**
 * A mouse (or pen) drag scrolls the filmstrip: a native scroller follows only the wheel, a finger and the keys (owner review 2026-10-23, #6).
 * Nothing is taken on the press itself: a plain click keeps its own target, and the card under it opens. Once the press has travelled
 * STRIP_DRAG_PX (viewpointCards.ts) the strip captures the pointer (so the drag may leave it), follows it, and swallows the one click that
 * ends that drag (it would open the card under the pointer). A cancelled drag, or one that lost its capture, swallows nothing, and a
 * keyboard activation (a click with detail 0) is never touched. Snapping is off while the pointer holds the strip (.dragging, pins.css),
 * since a snap container re-snaps every scrollLeft write.
 */
export function attachStripDrag(el: StripElement): void {
  let drag: { id: number; d: StripDrag } | null = null
  let swallowClick = false
  let swallowTimer = 0
  const win = typeof window === 'undefined' ? null : window
  el.addEventListener('pointerdown', (ev) => {
    const e = ev as PointerEvent
    if (drag || !stripDragTakes(e.pointerType, e.button)) return
    drag = { id: e.pointerId, d: stripDragStart(e.clientX, el.scrollLeft) }
  })
  el.addEventListener('pointermove', (ev) => {
    const e = ev as PointerEvent
    if (!drag || drag.id !== e.pointerId) return
    if (e.buttons === 0) { drag = null; el.classList.remove('dragging'); return }
    const r = stripDragMove(drag.d, e.clientX)
    drag.d = r.drag
    if (r.scrollLeft === null) return
    // Past the threshold: the strip takes the pointer now, not on the press (capture retargets pointerup and the click to the strip).
    if (!el.hasPointerCapture(e.pointerId)) { try { el.setPointerCapture(e.pointerId) } catch { /* synthetic pointer */ } }
    el.classList.add('dragging')
    el.scrollLeft = r.scrollLeft
  })
  const end = (ev: Event, completed: boolean): void => {
    const e = ev as PointerEvent
    if (!drag || drag.id !== e.pointerId) return
    const dragged = drag.d.dragging
    drag = null
    el.classList.remove('dragging')
    if (!completed || !dragged) return
    // The click follows the pointerup in the same input task; the timer only clears a swallow no click came for.
    swallowClick = true
    clearTimeout(swallowTimer)
    swallowTimer = setTimeout(() => { swallowClick = false }, 100) as unknown as number
  }
  el.addEventListener('pointerup', (ev) => end(ev, true))
  el.addEventListener('pointercancel', (ev) => end(ev, false))
  el.addEventListener('lostpointercapture', (ev) => end(ev, false))
  // A press can leave the strip before it crosses the drag threshold, so no pointer capture retargets its end here.
  win?.addEventListener('pointerup', (ev) => end(ev, true))
  win?.addEventListener('pointercancel', (ev) => end(ev, false))
  win?.addEventListener('blur', () => { drag = null; el.classList.remove('dragging') })
  el.addEventListener('click', (ev) => {
    const e = ev as MouseEvent
    if (!swallowClick || e.detail === 0) return
    swallowClick = false
    e.preventDefault()
    e.stopImmediatePropagation()
  }, true)
}
