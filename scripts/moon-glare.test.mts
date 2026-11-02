import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { moonGlareScale } from '../src/post/moonGlare.ts'
import { FINAL_FRAGMENT } from '../src/post/final.ts'

const sun = new Vector3(1, 0, 0)
assert.equal(moonGlareScale(new Vector3(-1, 0, 0), sun), 0, 'an almost entirely unlit eclipse Moon suppresses the grey haze')
assert.ok(Math.abs(moonGlareScale(new Vector3(-0.99, Math.sqrt(1 - 0.99 ** 2), 0), sun) - 0.5) < 1e-12, 'the haze fades only across the last 1% of visible illumination')
assert.equal(moonGlareScale(new Vector3(-0.9, Math.sqrt(0.19), 0), sun), 1, 'a crescent Moon keeps the shared scene bloom unchanged')
assert.equal(moonGlareScale(new Vector3(0, 1, 0), sun), 1, 'a quarter Moon keeps the shared scene bloom unchanged')
assert.equal(moonGlareScale(new Vector3(1, 0, 0), sun), 1, 'a full Moon keeps the shared scene bloom unchanged')
assert.match(FINAL_FRAGMENT, /uGlareGain \* uMoonGlare \* texture\(uGlare, vUv\)/, 'only lunar scene-pyramid bloom is gated')
assert.match(FINAL_FRAGMENT, /uGlareGain \* k \* uSunMissing/, 'the Sun lens glow remains independent')
console.log('moon-glare: shared bloom is unchanged outside near-total new Moon; solar lens glow stays independent')
