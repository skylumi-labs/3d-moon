// A pinch that follows a two-finger tilt in the same gesture is recognised (the tilt used to hold the gesture for good).
import assert from 'node:assert/strict'
import { newTwoFingerState, twoFingerStep } from '../src/camera/gesture.ts'

const st = newTwoFingerState()
let a = { x: 150, y: 400 }, b = { x: 280, y: 400 }
let tilt = 0, zoom = 1
const move = (na: { x: number; y: number }, nb: { x: number; y: number }): void => {
  const s = twoFingerStep(a, b, na, nb, st)
  tilt += s.tilt; zoom *= s.zoom
  a = na; b = nb
}
for (let i = 1; i <= 12; i++) move({ x: 150, y: 400 + i * 4 }, { x: 280, y: 400 + i * 4 })
assert.equal(st.mode, 'tilt', 'parallel vertical travel is a tilt')
assert.ok(tilt > 20, `tilted (${tilt})`)
// now spread the fingers
for (let i = 1; i <= 15; i++) move({ x: 150 - i * 3, y: 448 }, { x: 280 + i * 3, y: 448 })
assert.equal(st.mode, 'zoom', 'a spread after the tilt is a pinch')
assert.ok(Math.abs(Math.log(zoom)) > 0.3, `zoom applied (${zoom})`)
console.log('gesture-tilt-then-pinch ok')
