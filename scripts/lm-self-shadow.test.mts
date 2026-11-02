// Lunar module self-shadowing gate (issue #206): off in the app on a PowerVR GPU, where sampling three's Sun shadow map in the module's
// materials reset the GPU in the Apollo 17 ground view; on everywhere else (the website and desktop untouched).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { lmSelfShadow } from '../src/ground/lmShadow.ts'

const PIXEL10 = 'PowerVR D-Series DXT-48-1536'
assert.equal(lmSelfShadow(true, PIXEL10), false, 'the app on the Pixel 10 Pro XL: no self-shadow map')
assert.equal(lmSelfShadow(true, 'ANGLE (Imagination Technologies, PowerVR Rogue GE8320, OpenGL ES 3.2)'), false, 'an ANGLE-wrapped PowerVR string too')
assert.equal(lmSelfShadow(false, PIXEL10), true, 'the website on the same phone is unchanged (no evidence there)')
assert.equal(lmSelfShadow(true, 'Adreno (TM) 750'), true, 'other Android GPUs keep it')
assert.equal(lmSelfShadow(true, 'Mali-G715'), true)
assert.equal(lmSelfShadow(true, 'Apple GPU'), true, 'iOS app keeps it')
assert.equal(lmSelfShadow(false, 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0)'), true, 'desktop untouched')
assert.equal(lmSelfShadow(true, undefined), true, 'no renderer string: unchanged')
assert.equal(lmSelfShadow(false, 'Apple M2', '?lmself=0'), false, '?lmself=0 forces it off')
assert.equal(lmSelfShadow(true, PIXEL10, '?lmself=1'), true, '?lmself=1 forces it on')
assert.equal(lmSelfShadow(true, PIXEL10, '?lmself=x'), false, 'another value: the default')

// Wiring: the module honours it (the Sun never casts, no map allocated or ledgered) and both load paths pass it.
{
  const lm = readFileSync(new URL('../src/ground/LunarModule.ts', import.meta.url), 'utf8')
  assert.ok(lm.includes('this.sun.castShadow = this.selfShadow && sunShare > 0.01'), 'updateLight never turns the cast back on')
  assert.ok(lm.includes('this.sun.castShadow = selfShadow\n'), 'constructor')
  assert.ok(lm.includes("if (selfShadow) ledger.set('lm', `sun-shadow-map-est#"), 'no ledger line for a map three never allocates')
  assert.ok(lm.includes('opts.selfShadow !== false'), 'default on')
  const gm = readFileSync(new URL('../src/ground/GroundMode.ts', import.meta.url), 'utf8')
  assert.ok(gm.includes('selfShadow: this.lmSelfShadow })'))
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.ok(main.includes('groundMode.lmSelfShadow = lmSelfShadow(!!nativeHost, quality.hints.renderer, location.search)'))
  assert.ok(main.includes('selfShadow: lmSelfShadow(!!nativeHost, quality.hints.renderer, location.search) })'), 'the arrival prefetch builds the same module')
}
console.log('lm-self-shadow: ok')
