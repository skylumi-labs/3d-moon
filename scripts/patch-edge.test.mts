// The patch shadow march remembers its winning sample and refines it from 8 m out (the stair along a patch crater's shadow edge, Apollo 17).
import assert from 'node:assert/strict'
import { moonFragment } from '../src/moon/moonShader.ts'

const layout = [{ h: true, r: true, fadeM: 40, shade: true }, { h: true, r: false, fadeM: 10 }]
const patch = moonFragment(180, 4096, '', true, layout, false, -3)
assert.ok(patch.includes('float angN = atan('), 'patch march keeps the winning near sample')
assert.ok(patch.includes('bestD = d;'), 'winner remembered')
assert.ok(patch.includes('if (bestD < 0.008) break;'), 'refinement from 8 m')
assert.ok(patch.includes('? 0.19 * bestD'), 'wider first half-width over a patch')
const plain = moonFragment(180, 4096, '', true, null, false, -3)
assert.ok(!plain.includes('float angN = atan('), 'no patch: unchanged')
console.log('patch edge ok')
