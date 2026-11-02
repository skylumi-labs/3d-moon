/**
 * Drag-to-scroll on the viewpoints filmstrip (src/ui/stripDrag.ts; owner review 2026-10-23, #6). A plain click reaches the card; a drag past the
 * threshold scrolls the strip, captures the pointer only then, and swallows the one click that ends it; a cancelled drag swallows nothing; a keyboard
 * activation is never touched; a finger keeps its native pan.
 */
import assert from 'node:assert/strict'
import { attachStripDrag } from '../src/ui/stripDrag.ts'
import { STRIP_DRAG_PX } from '../src/ui/viewpointCards.ts'

class FakeStrip extends EventTarget {
  scrollLeft = 100
  classes = new Set<string>()
  classList = { add: (c: string) => { this.classes.add(c) }, remove: (c: string) => { this.classes.delete(c) } }
  captured = new Set<number>()
  setPointerCapture(id: number): void { this.captured.add(id) }
  hasPointerCapture(id: number): boolean { return this.captured.has(id) }
  releaseAll(): void { this.captured.clear() }
}
const win = new EventTarget()
Object.assign(globalThis, { window: win })
const strip = new FakeStrip()
attachStripDrag(strip)
let cardClicks = 0
// The card's handler runs at the target phase after the strip's capture listener: a bubbling listener on the strip stands in for it.
strip.addEventListener('click', () => { cardClicks++ })
const fire = (type: string, init: Record<string, unknown>): Event => {
  const e = Object.assign(new Event(type, { cancelable: true }), init)
  strip.dispatchEvent(e)
  return e
}
const ptr = (type: string, id: number, x: number, more: Record<string, unknown> = {}): Event => fire(type, { pointerId: id, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1, clientX: x, ...more })
const winPtr = (type: string, id: number): void => win.dispatchEvent(Object.assign(new Event(type), { pointerId: id, pointerType: 'mouse', button: 0 }))
const click = (detail = 1): Event => fire('click', { detail })

// 1. A plain click: nothing captured, nothing scrolled, the card's click handler runs.
ptr('pointerdown', 1, 300)
ptr('pointerup', 1, 300)
const c1 = click()
assert.equal(strip.captured.size, 0, 'a press captures nothing')
assert.equal(strip.scrollLeft, 100)
assert.equal(c1.defaultPrevented, false)
assert.equal(cardClicks, 1, 'the card opens')

// 2. A tremor under the threshold is still a click.
ptr('pointerdown', 2, 300)
ptr('pointermove', 2, 300 + STRIP_DRAG_PX - 1)
assert.equal(strip.captured.size, 0, 'no capture under the threshold')
assert.equal(strip.scrollLeft, 100)
ptr('pointerup', 2, 300 + STRIP_DRAG_PX - 1)
click()
assert.equal(cardClicks, 2)

// 3. A drag: the pointer is captured at the first move past the threshold, the strip follows, snapping is off, and the click that ends it is swallowed once.
ptr('pointerdown', 3, 300)
ptr('pointermove', 3, 320)
assert.ok(strip.captured.has(3), 'captured once the press is a drag')
assert.equal(strip.scrollLeft, 80, 'the content follows the pointer')
assert.ok(strip.classes.has('dragging'))
ptr('pointermove', 3, 250)
assert.equal(strip.scrollLeft, 150)
ptr('pointerup', 3, 250)
assert.ok(!strip.classes.has('dragging'))
const c3 = click()
assert.equal(c3.defaultPrevented, true, 'the click after a drag is swallowed')
assert.equal(cardClicks, 2, 'the card under the pointer does not open')
const c3b = click()
assert.equal(c3b.defaultPrevented, false, 'only that one click')
assert.equal(cardClicks, 3)
strip.releaseAll()

// 3b. Each outside termination must release the pending press so a new press can drag immediately, before any fallback move.
ptr('pointerdown', 30, 300)
winPtr('pointerup', 30)
ptr('pointerdown', 31, 300)
ptr('pointermove', 31, 320)
assert.equal(strip.scrollLeft, 130, 'a new press works after outside pointerup')
ptr('pointerup', 31, 320)
assert.equal(click().defaultPrevented, true, 'the completed fresh drag is swallowed')
strip.releaseAll()
ptr('pointerdown', 32, 300)
win.dispatchEvent(new Event('blur'))
ptr('pointerdown', 33, 300)
ptr('pointermove', 33, 320)
assert.equal(strip.scrollLeft, 110, 'a new press works immediately after blur')
ptr('pointerup', 33, 320)
assert.equal(click().defaultPrevented, true, 'the fresh drag after blur completes')
strip.releaseAll()
ptr('pointerdown', 34, 300)
winPtr('pointercancel', 34)
ptr('pointerdown', 35, 300)
ptr('pointermove', 35, 320)
assert.equal(strip.scrollLeft, 90, 'a new press works immediately after outside pointercancel')
ptr('pointerup', 35, 320)
assert.equal(click().defaultPrevented, true, 'the fresh drag after pointercancel completes')
strip.releaseAll()

// Zero-button pointermove is a separate fallback for a lost release; it also clears stale state.
ptr('pointerdown', 36, 300)
ptr('pointermove', 36, 250, { buttons: 0 })
ptr('pointerdown', 37, 300)
ptr('pointermove', 37, 320)
assert.equal(strip.scrollLeft, 70, 'the zero-button fallback clears the pending press')
winPtr('pointerup', 37)
assert.equal(click().defaultPrevented, true, 'the fresh drag after the fallback completes')
strip.releaseAll()

// 4. A cancelled drag swallows nothing; neither does one that lost its capture.
for (const type of ['pointercancel', 'lostpointercapture']) {
  ptr('pointerdown', 4, 300)
  ptr('pointermove', 4, 330)
  ptr(type, 4, 330)
  const c = click()
  assert.equal(c.defaultPrevented, false, `${type}: the next click goes through`)
  strip.releaseAll()
}

// 5. A keyboard activation (click with detail 0) right after a drag is never swallowed.
ptr('pointerdown', 5, 300)
ptr('pointermove', 5, 330)
ptr('pointerup', 5, 330)
const k = click(0)
assert.equal(k.defaultPrevented, false, 'Enter on a card is not a mouse click')
strip.releaseAll()
await new Promise((r) => setTimeout(r, 120))
assert.equal(click().defaultPrevented, false, 'the swallow has cleared by itself')

// 6. A finger and the other mouse buttons are not taken: the native scroller (touch-action: pan-x) and the browser keep them.
const before = strip.scrollLeft
ptr('pointerdown', 6, 300, { pointerType: 'touch' })
ptr('pointermove', 6, 360, { pointerType: 'touch' })
ptr('pointerdown', 7, 300, { button: 2 })
ptr('pointermove', 7, 360, { button: 2 })
assert.equal(strip.scrollLeft, before)
assert.equal(strip.captured.size, 0)
console.log('strip-drag: ok')
