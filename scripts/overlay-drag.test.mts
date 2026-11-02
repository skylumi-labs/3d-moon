import assert from 'node:assert/strict'
import { attachControls, DRAG_START_PX } from '../src/camera/controls.ts'
import type { CameraRig } from '../src/camera/rig.ts'

class FakeDocument {
  private listeners = new Map<string, Array<{ fn: EventListener; capture: boolean }>>()
  hidden = false
  addEventListener(type: string, fn: EventListener, capture = false): void {
    const list = this.listeners.get(type) ?? []
    list.push({ fn, capture: typeof capture === 'boolean' ? capture : false })
    this.listeners.set(type, list)
  }
  removeEventListener(type: string, fn: EventListener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry.fn !== fn))
  }
  fire(type: string, init: Record<string, unknown>): Event {
    const event = Object.assign({ defaultPrevented: false, preventDefault() { this.defaultPrevented = true }, stopImmediatePropagation() {} }, init)
    for (const { fn } of [...(this.listeners.get(type) ?? [])]) fn(event)
    return event
  }
}

class FakeElement extends EventTarget {
  /** `within`: ancestors' selectors this element sits under (a pin in the Viewpoints sheet: '.dock', '[data-no-drag]'). */
  constructor(readonly className: string, readonly within: readonly string[] = []) { super() }
  closest(selector: string): FakeElement | null {
    const parts = selector.split(', ')
    if (parts.some((part) => part === `.${this.className}`)) return this
    return parts.some((part) => this.within.includes(part)) ? new FakeElement('ancestor') : null
  }
}

class FakeCanvas extends EventTarget {
  clientWidth = 800
  clientHeight = 600
  captures: number[] = []
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 } }
  setPointerCapture(id: number) { this.captures.push(id) }
  hasPointerCapture() { return true }
  contains(target: Node) { return target === this }
}

class FakeRig {
  mode = 'fly'
  dragging = false
  pose = { lon: 0, lat: 0, dist: 2, pitch: 0, roll: 0 }
  spinCalls = 0
  zoomCalls = 0
  pickMoon() { return null }
  groundAt() { return 0 }
  takeOver() {}
  stopInertia() {}
  spin(dx: number) { this.spinCalls++; this.pose.lon += dx / 1000 }
  zoomCentre() { this.zoomCalls++; this.pose.dist *= 0.9 }
  release() {}
}

const doc = new FakeDocument()
const win = Object.assign(new EventTarget(), { setTimeout })
Object.assign(globalThis, { document: doc, window: win, Element: FakeElement })
const canvas = new FakeCanvas()
const pin = new FakeElement('pin')
const rig = new FakeRig()
let pinClicks = 0
pin.addEventListener('click', () => pinClicks++)
const noop = () => {}
const cleanup = attachControls(canvas as unknown as HTMLCanvasElement, rig as unknown as CameraRig, {
  moved: noop, context: () => ({ e: {} as never, aspect: 4 / 3 }), home: noop, escape: noop,
  now: noop, notes: noop, share: noop, timeStep: noop, flyTo: noop,
})
const dispatchOverlay = (type: string, pointerId: number, x: number, y: number, target = pin) => {
  const event = doc.fire(type, { target, pointerId, pointerType: 'touch', clientX: x, clientY: y,
    buttons: type === 'pointerup' ? 0 : 1, shiftKey: false })
  if (type === 'pointermove' && canvas.captures.includes(pointerId)) {
    canvas.dispatchEvent(Object.assign(new Event(type), { pointerId, clientX: x, clientY: y, buttons: 1, shiftKey: false }))
  }
  return event
}

// A pin press remains a click and never starts camera motion.
dispatchOverlay('pointerdown', 1, 400, 300)
dispatchOverlay('pointerup', 1, 400, 300)
pin.dispatchEvent(new Event('click'))
assert.equal(rig.spinCalls, 0, 'a tap on a pin must not move the rig')
assert.equal(rig.dragging, false)
assert.equal(pinClicks, 1, 'the pin click still fires after a tap')

// A press inside the Viewpoints sheet (the filmstrip; `.dock` and `data-no-drag`, navigator.ts) is never handed to the camera, however far it travels:
// the strip scrolls under a mouse drag and the Moon stays (owner review 2026-10-23, #6).
{
  const inSheet = new FakeElement('pin', ['.dock', '[data-no-drag]'])
  const before = rig.spinCalls
  dispatchOverlay('pointerdown', 8, 400, 300, inSheet)
  for (const x of [410, 430, 460, 500]) dispatchOverlay('pointermove', 8, x, 300, inSheet)
  assert.equal(rig.spinCalls, before, 'a drag that starts in the sheet does not move the rig')
  assert.ok(!canvas.captures.includes(8), 'the canvas never captures a sheet pointer')
  dispatchOverlay('pointerup', 8, 500, 300, inSheet)
  const onlyNoDrag = new FakeElement('pin', ['[data-no-drag]'])
  dispatchOverlay('pointerdown', 9, 400, 300, onlyNoDrag)
  dispatchOverlay('pointermove', 9, 440, 300, onlyNoDrag)
  assert.equal(rig.spinCalls, before, 'data-no-drag alone is enough')
  dispatchOverlay('pointerup', 9, 440, 300, onlyNoDrag)
}

// Moving 12 px promotes the original down into the canvas state machine and suppresses its click.
dispatchOverlay('pointerdown', 2, 400, 300)
dispatchOverlay('pointermove', 2, 400 + Math.max(12, DRAG_START_PX + 1), 300)
assert.ok(rig.spinCalls > 0, 'a drag that starts on a pin moves the rig')
assert.ok(canvas.captures.includes(2), 'the canvas captures the promoted pointer')
const click = dispatchOverlay('click', 2, 412, 300)
assert.equal(click.defaultPrevented, true, 'the click following a promoted drag is suppressed')
dispatchOverlay('pointerup', 2, 412, 300)
canvas.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 2, clientX: 412, clientY: 300, buttons: 0 }))

// A second touch on a pin joins an active canvas gesture and changes pinch zoom; a second touch in the sheet (protected UI) does not, even then.
canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerId: 3, clientX: 300, clientY: 300, buttons: 1 }))
{
  const inSheet = new FakeElement('pin', ['.dock', '[data-no-drag]'])
  const zooms = rig.zoomCalls
  dispatchOverlay('pointerdown', 10, 400, 300, inSheet)
  for (const x of [410, 420, 430]) dispatchOverlay('pointermove', 10, x, 300, inSheet)
  assert.equal(rig.zoomCalls, zooms, 'a press in the sheet never joins a pinch')
  assert.ok(!canvas.captures.includes(10), 'and is never captured by the canvas')
  dispatchOverlay('pointerup', 10, 430, 300, inSheet)
}
dispatchOverlay('pointerdown', 4, 400, 300)
for (const x of [410, 420, 430]) dispatchOverlay('pointermove', 4, x, 300) // a pinch with one finger judged after a few events
assert.ok(rig.zoomCalls > 0, 'a second finger landing on a pin joins the pinch')
dispatchOverlay('pointerup', 4, 430, 300)
canvas.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 3, clientX: 300, clientY: 300, buttons: 0 }))
canvas.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 4, clientX: 430, clientY: 300, buttons: 0 }))
// main.ts calls this return value (cancelPendingWheelZoom) on every scripted move and moment: it must not detach the pin handoff.
cleanup()
const spinsBefore = rig.spinCalls
dispatchOverlay('pointerdown', 5, 400, 300)
dispatchOverlay('pointermove', 5, 420, 300)
assert.ok(rig.spinCalls > spinsBefore, 'a drag that starts on a pin still works after the returned cancel function ran')
dispatchOverlay('pointerup', 5, 420, 300)

// Blur while a label has a pending press clears that overlay pointer too. The
// next canvas drag must start as one finger instead of promoting the stale
// label press into a phantom pinch.
dispatchOverlay('pointerdown', 6, 400, 300)
win.dispatchEvent(new Event('blur'))
const beforeFreshDrag = rig.spinCalls
canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerId: 7, clientX: 300, clientY: 300, buttons: 1 }))
canvas.dispatchEvent(Object.assign(new Event('pointermove'), { pointerId: 7, clientX: 320, clientY: 300, buttons: 1, shiftKey: false }))
assert.ok(rig.spinCalls > beforeFreshDrag, 'the first fresh canvas drag after blur is a single-finger spin')
canvas.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 7, clientX: 320, clientY: 300, buttons: 0 }))
console.log('overlay-drag: pin taps, promoted drags, click suppression and pin pinches pass')
