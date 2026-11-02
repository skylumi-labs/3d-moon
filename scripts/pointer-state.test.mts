import assert from 'node:assert/strict'
import { PointerState } from '../src/camera/pointerState.ts'
import { newTwoFingerState, twoFingerStep } from '../src/camera/gesture.ts'

const s = new PointerState()
const noCapture = () => false

// An up lost for finger A cannot make a later finger B look like a second active finger.
s.down(1, 10, 10, 0, noCapture)
s.down(2, 20, 10, 10, noCapture)
s.pointers.set(1, { x: 10, y: 10, at: 0 })
s.pointers.set(2, { x: 20, y: 10, at: 1100 })
const purged = s.down(3, 30, 10, 1200, noCapture)
assert.deepEqual(purged, [1])
assert.equal(s.pointers.size, 2, 'the recent pointer B and new pointer C form the active pair')
assert.equal(s.pointers.has(1), false)

// Pinch end rebases the remaining finger and its first deliberate move starts a single drag.
s.clear()
s.down(10, 100, 100, 2000, noCapture)
s.down(11, 200, 100, 2010, noCapture)
const ended = s.remove(11, 2020)
assert.equal(ended.had, true)
assert.deepEqual(s.downAt, { x: 100, y: 100, t: 2020 })
assert.equal(s.dragStarted, false)
assert.equal(s.move(10, 108, 100, 2030)?.started, true)

// Cancel and lost capture both remove their pointer; the final release clears drag state.
s.remove(10, 2040) // pointercancel
assert.equal(s.pointers.size, 0)
s.down(20, 1, 1, 3000, noCapture)
s.down(21, 2, 2, 3010, noCapture)
s.remove(21, 3020) // lostpointercapture
assert.equal(s.pointers.size, 1)
s.remove(20, 3030)
assert.equal(s.downAt, null)
assert.equal(s.pairPrev, null)

// A second finger joins an already-started one-finger drag and immediately establishes a pinch pair.
s.clear()
s.down(30, 100, 100, 4000, noCapture)
s.move(30, 110, 100, 4010)
assert.equal(s.dragStarted, true)
s.down(31, 210, 100, 4020, noCapture)
assert.equal(s.pointers.size, 2)
assert.equal(s.downAt, null)
assert.equal(s.pairPrev?.size, 2)
const beforePair = s.pairPrev!
s.move(31, 230, 100, 4030)
const pair = [...s.pointers.entries()].slice(0, 2)
const tfs = newTwoFingerState()
let pinch = { zoom: 1, tilt: 0 }
{
  // One finger moving alone for a few events (26 px in all) is a pinch.
  let from = beforePair.get(31)!
  const fixed = beforePair.get(30)!
  for (const x of [220, 230, 236]) {
    const to = { x, y: pair[1]![1].y }
    const r = twoFingerStep(fixed, from, pair[0]![1], to, tfs)
    if (r.zoom !== 1) pinch = r
    from = to
  }
}
assert.notEqual(pinch.zoom, 1, 'moving one finger alone changes the pinch spread and zooms')

// A finger whose up was lost while the page was backgrounded still holds capture and never goes stale by the capture rule: it must not stay
// the first of the pinch pair. A third pointer evicts the least recently updated one, and the pair is then the two live fingers.
s.clear()
const held = (): boolean => true
s.down(40, 50, 50, 5000, held) // stale: no move, no up (backgrounded)
s.down(41, 300, 300, 60000, held) // first live finger after the return
const evicted = s.down(42, 400, 300, 60010, held)
assert.deepEqual(evicted, [40])
assert.deepEqual([...s.pointers.keys()], [41, 42])
assert.equal(s.pairPrev?.size, 2)
assert.equal(s.pairPrev?.has(40), false)
{
  const [[ia, a], [ib]] = [...s.pointers.entries()].slice(0, 2)
  let from = s.pairPrev!.get(ib)!
  const fixed = s.pairPrev!.get(ia)!
  const st = newTwoFingerState()
  let zoom = 1
  for (const x of [420, 430, 440]) {
    const to = { x, y: 300 }
    const r = twoFingerStep(fixed, from, a, to, st)
    if (r.zoom !== 1) zoom = r.zoom
    from = to
  }
  assert.ok(zoom < 1, 'a pinch apart after the return zooms in, measured between the two live fingers')
}
console.log('pointer-state.test: ok')
