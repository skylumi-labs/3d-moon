// Android pointer hygiene: an unrelated finger lifting on UI must not drop a pinch; a cancelled drag must not launch inertia.
import assert from 'node:assert/strict'
import { attachControls } from '../src/camera/controls.ts'
import { PointerState } from '../src/camera/pointerState.ts'
import { CameraRig } from '../src/camera/rig.ts'
import { ephemerisAt } from '../src/ephemeris.ts'

class FakeCanvas extends EventTarget {
  clientWidth = 430; clientHeight = 930
  getBoundingClientRect() { return { left: 0, top: 0, width: 430, height: 930 } }
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return true }
  contains(t: unknown) { return t === this }
}
class FakeWindow extends EventTarget { setTimeout = setTimeout }
const doc = Object.assign(new EventTarget(), { hidden: false })
const win = new FakeWindow()
Object.assign(globalThis, { document: doc, window: win, Element: class {} })
let nowMs = 1000
;(globalThis as { performance: unknown }).performance = { now: () => nowMs }
const e = ephemerisAt(new Date('2026-10-20T22:34:00Z'))
const canvas = new FakeCanvas()
const rig = new CameraRig()
rig.setPose({ lon: 0, lat: 0, dist: 10, roll: 0 })
const noop = (): void => {}
attachControls(canvas as unknown as HTMLCanvasElement, rig, { moved: noop, context: () => ({ e, aspect: 430 / 930 }), home: noop, escape: noop, now: noop, notes: noop, share: noop, timeStep: noop, flyTo: noop })
const fire = (target: EventTarget, type: string, id: number, x: number, y: number): void => {
  nowMs += 16
  target.dispatchEvent(Object.assign(new Event(type), { pointerId: id, clientX: x, clientY: y, buttons: 1, shiftKey: false, pointerType: 'touch' }))
}

// PointerState ignores an id it never saw.
{
  const s = new PointerState()
  s.down(1, 10, 10, 0, () => false); s.down(2, 50, 10, 1, () => false)
  const pair = s.pairPrev
  assert.equal(s.remove(99, 2).had, false)
  assert.equal(s.pointers.size, 2)
  assert.equal(s.pairPrev, pair, 'the pinch pair survives an unknown id')
}

// A finger lifting outside the canvas (on the bar) while a pinch runs: the pinch goes on.
{
  fire(canvas, 'pointerdown', 1, 150, 465); fire(canvas, 'pointerdown', 2, 280, 465)
  const d0 = rig.pose.dist
  for (let i = 1; i <= 6; i++) { fire(canvas, 'pointermove', 1, 150 - i * 6, 465); fire(canvas, 'pointermove', 2, 280 + i * 6, 465) }
  assert.ok(rig.pose.dist < d0, 'pinch zooms in')
  const d1 = rig.pose.dist
  fire(win, 'pointerup', 77, 10, 900)
  for (let i = 7; i <= 12; i++) { fire(canvas, 'pointermove', 1, 150 - i * 6, 465); fire(canvas, 'pointermove', 2, 280 + i * 6, 465) }
  assert.ok(rig.pose.dist < d1 - 1e-3, `pinch continues after an unrelated finger lifted (${d1} -> ${rig.pose.dist})`)
  fire(canvas, 'pointerup', 1, 0, 0); fire(canvas, 'pointerup', 2, 0, 0)
}

// A cancelled fast drag does not coast.
{
  rig.setPose({ lon: 0, lat: 0, dist: 5, roll: 0 })
  fire(canvas, 'pointerdown', 5, 200, 465)
  for (let i = 1; i <= 8; i++) fire(canvas, 'pointermove', 5, 200 + i * 20, 465)
  fire(canvas, 'pointercancel', 5, 360, 465)
  const lon = rig.pose.lon
  for (let i = 0; i < 40; i++) rig.step(nowMs += 16, 0.016)
  assert.equal(rig.pose.lon, lon, 'no inertia after pointercancel')
  assert.equal(rig.levelling(), false, 'no levelling pending after pointercancel')
}
console.log('controls-pointer-hygiene ok')
