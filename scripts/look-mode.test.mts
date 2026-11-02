import assert from 'node:assert/strict'
import { lookMode, moonFragment } from '../src/moon/moonShader.ts'

// Radiance exposure is the default at every altitude; the old looks remain explicit comparisons.
assert.equal(lookMode(''), 'a')
assert.equal(lookMode('?look=alt'), 'alt')
assert.equal(lookMode('?look=old'), 'old')
assert.equal(lookMode('?look=a'), 'a')
assert.equal(lookMode('?look=local'), 'a')
assert.equal(lookMode('?x=1&look=old'), 'old')
console.log('look-mode ok')

assert.ok(moonFragment(360, 4096).includes('float lookW = 1.0;'), 'radiance key remains active below 300 km and at the surface')
assert.ok(!moonFragment(360, 4096).includes('smoothstep(0.0, 0.0'), 'fixed look never emits an undefined smoothstep')
