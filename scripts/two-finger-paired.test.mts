import assert from 'node:assert/strict'
import { newTwoFingerState, twoFingerStep } from '../src/camera/gesture.ts'

// Pointer events alternate IDs. Tilt still sees both fingers' motion as paired motion (after the start threshold).
{
  const state = newTwoFingerState()
  let a = { x: 0, y: 0 }, b = { x: 100, y: 0 }, tilt = 0, zoom = 1
  for (let i = 0; i < 4; i++) {
    const na = { x: 0, y: a.y + 25 }
    const r1 = twoFingerStep(a, b, na, b, state); a = na
    const nb = { x: 100, y: b.y + 25 }
    const r2 = twoFingerStep(a, b, a, nb, state); b = nb
    tilt += r1.tilt + r2.tilt; zoom *= r1.zoom * r2.zoom
  }
  assert.ok(tilt >= 50 && tilt <= 100, `alternating vertical events follow the fingers once tilting: ${tilt}`)
  assert.equal(zoom, 1)
}

// One finger alone pinches: it zooms as soon as it has travelled a few pixels.
{
  const state = newTwoFingerState()
  let a = { x: 0, y: 0 }
  const b = { x: 100, y: 0 }
  let factor = 1
  const nextA = { x: -10, y: 0 }
  factor *= twoFingerStep(a, b, nextA, b, state).zoom
  a = nextA
  const nextB = { x: 110, y: 0 }
  factor *= twoFingerStep(a, b, a, nextB, state).zoom
  assert.ok(factor < 1, `alternating pinch events still zoom out: ${factor}`)
}

console.log('two-finger-paired: ok')
