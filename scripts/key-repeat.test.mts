/** Held one-shot keys act once (issue 190): a repeated keydown must not re-run Home, Now, notes or share. */
import assert from 'node:assert/strict'
import { attachControls, isOneShotKey } from '../src/camera/controls.ts'
import type { CameraRig } from '../src/camera/rig.ts'

class FakeInput {}
class FakeCanvas extends EventTarget {
  clientWidth = 800
  clientHeight = 600
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 } }
  setPointerCapture() {}
  hasPointerCapture() { return true }
  contains() { return false }
}
const handlers = new Map<string, Array<(e: unknown) => void>>()
const win = { setTimeout, addEventListener(type: string, fn: (e: unknown) => void) { handlers.set(type, [...(handlers.get(type) ?? []), fn]) }, removeEventListener() {} }
const doc = Object.assign(new EventTarget(), { hidden: false })
Object.assign(globalThis, { document: doc, window: win, HTMLInputElement: FakeInput, HTMLTextAreaElement: FakeInput, HTMLSelectElement: FakeInput, Element: FakeInput })

const counts = { home: 0, now: 0, notes: 0, share: 0, step: 0, moved: 0 }
const rig = { mode: 'fly', takeOver() {}, spin() {}, tilt() {}, zoomCentre() {}, stopInertia() {}, release() {} }
const noop = () => {}
attachControls(new FakeCanvas() as unknown as HTMLCanvasElement, rig as unknown as CameraRig, {
  moved: () => { counts.moved++ }, context: () => ({ e: {} as never, aspect: 4 / 3 }), escape: noop, flyTo: noop,
  home: () => { counts.home++ }, now: () => { counts.now++ },
  notes: () => { counts.notes++ }, share: () => { counts.share++ }, timeStep: () => { counts.step++ },
})
const key = (k: string, repeat: boolean, shiftKey = false): void => {
  const ev = { key: k, repeat, shiftKey, metaKey: false, ctrlKey: false, altKey: false, target: null, preventDefault() {} }
  for (const fn of handlers.get('keydown') ?? []) fn(ev)
}

for (const [k, field] of [['h', 'home'], ['H', 'home'], ['n', 'now'], ['i', 'notes']] as const) {
  const before = counts[field]
  key(k, false)
  for (let i = 0; i < 30; i++) key(k, true)
  assert.equal(counts[field] - before, 1, `holding ${k} runs its action once, got ${counts[field] - before}`)
}
key('S', false, true); for (let i = 0; i < 10; i++) key('S', true, true)
assert.equal(counts.share, 1, 'holding Shift+S shares once')

// Keys that are meant to repeat still do.
const steps = counts.step
key(']', false); key(']', true); key(']', true)
assert.equal(counts.step - steps, 3, 'the time-step bracket keeps repeating')
const moved = counts.moved
key('ArrowLeft', false); key('ArrowLeft', true); key('ArrowLeft', true)
assert.equal(counts.moved - moved, 3, 'arrows keep repeating')

assert.ok(isOneShotKey({ key: 'h' }) && isOneShotKey({ key: '3' }) && !isOneShotKey({ key: 'w' }) && !isOneShotKey({ key: ']' }), 'one-shot classification')
console.log('key-repeat.test: ok')
