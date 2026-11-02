// SunHorizonBake.update (src/moon/tiles/SunHorizonBake.ts) keeps the frame loop alive while it waits for the Sun to be still: the app draws no frame of its own in a still
// scene, so a "not busy" answer during the wait left the bake unbuilt for good (found by the swiftshader check of the quad vote, an untiled view with nothing else building).
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { SunHorizonBake } from '../src/moon/tiles/SunHorizonBake.ts'

const renderer = { capabilities: { maxTextureSize: 8192 }, getRenderTarget: () => null, setRenderTarget: () => undefined } as unknown as THREE.WebGLRenderer
const uniforms: Record<string, THREE.IUniform> = {
  uS: { value: new THREE.Vector3(1, 0, 0) }, uCamPos: { value: new THREE.Vector3(3, 0, 0) },
  uX: { value: new THREE.Vector3(1, 0, 0) }, uY: { value: new THREE.Vector3(0, 1, 0) }, uK: { value: new THREE.Vector3(0, 0, 1) },
  uHeight: { value: null }, uHeightLevels: { value: 1 },
}
const bake = new SunHorizonBake(renderer, uniforms, 180, 4096, true)
assert.equal(bake.failed, false)
const opts = { now: 0, frameMs: 16, allowed: true }
// the first call records the Sun; the following ones count still frames
for (let i = 0; i < 12; i++) assert.equal(bake.update({ ...opts, now: i * 16 }), true, `waiting frame ${i}: busy, so the next frame is drawn`)
assert.equal(bake.stats.state, 'idle', 'still waiting, nothing built yet')
// not allowed (ground view, baked or off shadows): idle and not busy
const off = new SunHorizonBake(renderer, uniforms, 180, 4096, true)
assert.equal(off.update({ ...opts, allowed: false }), false)
console.log('sun-horizon bake wait test passed')
