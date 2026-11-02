import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { heightGlsl } from '../src/moon/moonShader'
import mapsMeta from '../shared-assets/moon-maps.json'

// The flat stand-in drawn before the 4k heights arrive carries the real map's span and size (the shaders are built from them): the header says what they are.
const raw = gunzipSync(readFileSync(new URL('../shared-assets/moon-height-4k.bin.gz', import.meta.url)))
const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
assert.equal(String.fromCharCode(...raw.subarray(0, 4)), 'MHT1')
assert.equal(view.getUint32(4, true), mapsMeta.size[0])
assert.equal(view.getUint32(8, true), mapsMeta.size[1])
assert.equal(view.getFloat32(16, true), mapsMeta.lonRangeDeg[1])

// Every height read is scaled by uHeightMix, which is 0 for the stand-in and 1 once the map is in: a missing factor would pop the relief in.
const glsl = heightGlsl(180, 1)
assert.match(glsl, /uniform float uHeightMix;/)
assert.match(glsl, /heightLod\(uv, l1\), l - float\(l0\)\) \* uHeightMix;/)

// The first frame no longer waits for the heights or the Earth's maps.
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
assert.match(main, /FAST_FIRST \? await loadMoonMapsColorFirst/)
assert.match(main, /startDeferredLoads\(\)\n/)
console.log('fast-first-frame: ok')
