import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import { PatchLayer, type PatchManifest } from '../src/moon/patch/PatchLayer.ts'
import { MoonPass } from '../src/moon/MoonPass.ts'
import { commonUniforms } from '../src/glsl/common.ts'
import type { MoonMaps } from '../src/moon/maps.ts'
import { moonFragment } from '../src/moon/moonShader.ts'
import { decodeHeightPlanes } from '../src/moon/tiles/codec.ts'
const root = process.env.MOON_WIDE_HEIGHT_DIR
if (!root) throw new Error('Blocked: MOON_WIDE_HEIGHT_DIR must name verified wide packages')
const oldLocation = globalThis.location
Object.defineProperty(globalThis, 'location', { value: { search: '' }, configurable: true })
try {
 for (const site of ['a11', 'a17']) {
  const dir = path.join(root, site), manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as PatchManifest
  const src = manifest.levels[0], raw = zlib.gunzipSync(fs.readFileSync(path.join(dir, src.heights!)))
  assert.equal(createHash('sha256').update(raw).digest('hex'), manifest.assets![src.heights!].sha256)
  assert.ok(src.w * src.texelEastM >= 147999 && src.h * src.texelNorthM >= 147999)
  assert.equal(src.heightFormat, 'q16'); assert.equal(src.heightStepM, 0.25)
  assert.equal(raw.length, src.w * src.h * 2, 'q16 asset is exactly two bytes per sample')
  const values = Float32Array.from(decodeHeightPlanes(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength), src.w, src.h), q => q * src.heightStepM!)
  assert.ok([...values.subarray(0, 100)].every(Number.isFinite))
  if (/effective120m/.test(src.provenance!.source)) assert.ok(src.texelM > 118, 'effective vertical decimation stays explicit')
  else assert.ok(src.texelM > 59 && src.texelM < 60 && src.w === 2496, 'native 59 m build')
  const coarseFetch: typeof fetch = async (input, init) => { init?.signal?.throwIfAborted(); return new Response(fs.readFileSync(path.join(dir, String(input).split('/').at(-1)!))) }
  const coarse = await PatchLayer.create('https://wide/', { net: { fetchImpl: coarseFetch, delaysMs: [] }, tier: false, maxTexture: 256, floatLinear: true })
  assert.equal(coarse.continuousHeightMidAvailable, true); assert.equal(coarse.continuousMidAvailable, false)
  const fineManifest: PatchManifest = { version: 1, site: { ...manifest.site }, h0M: manifest.h0M + 1000, light: manifest.light, credit: 'synthetic fine datum fixture',
    levels: [{ name: 'FINE', w: 32, h: 32, texelM: 8, texelEastM: 8, texelNorthM: 8, eastM: -128, northM: 128, heights: 'fine.h.f32', heightFormat: 'f32', detail: 'fine.r' }] }
  const fineFetch: typeof fetch = async (input, init) => { init?.signal?.throwIfAborted(); return String(input).endsWith('manifest.json') ? Response.json(fineManifest) : new Response(String(input).endsWith('fine.r') ? new Uint8Array(1024).fill(128) : new Float32Array(1024).fill(10)) }
  const fine = await PatchLayer.create('https://fine/', { net: { fetchImpl: fineFetch, delaysMs: [] }, tier: false, maxTexture: 256, floatLinear: true })
  assert.equal(fine.levels.length, 0)
  const texture = coarse.heights[src.name], stored = texture.image.data as Float32Array
  const firstPhysical = stored[0] + manifest.h0M
  const beforeUpload = coarse.residentBytes
  ;(texture.onUpdate as () => void)()
  assert.equal(texture.image.data, null)
  assert.ok(coarse.residentBytes > 0 && coarse.residentBytes < beforeUpload, 'GPU bytes remain counted after CPU release')
  const combined = PatchLayer.compose(coarse, fine)
  assert.equal(combined.levels[0].h0M, manifest.h0M, 'transferred CPU-released texture retains source datum')
  const maps = { color: new THREE.DataTexture(new Uint8Array(4), 1, 1), height: { texture: new THREE.DataTexture(new Float32Array(1), 1, 1), levels: 1, lonSpan: 180, size: [4096, 2048] } } as unknown as MoonMaps
  const moon = new MoonPass(commonUniforms(), maps)
  moon.setPatch(combined)
  assert.equal(moon.uniforms.uPHOffset0.value, manifest.h0M, 'production shader uniform reconstructs original coarse heights')
  assert.ok(Number.isFinite(firstPhysical))
  assert.ok(combined.residentBytes > 0)
  await combined.updateDemand({ altitudeKm: 5, metresPerPixel: 8, zoomedIn: true })
  assert.equal(combined.levels.length, 2)
  moon.setPatch(combined)
  assert.equal(moon.uniforms.uPHOffset1.value, fineManifest.h0M)
  assert.match(moonFragment(180, 4096, '', true, moon.patchLayout, true), /patchHeightOne\(uPH0, q, uPS0\) \+ uPHOffset0/)
  assert.ok(combined.residentBytes <= 192 * 1024 * 1024)
  const samplers = moon.patchLayout!.reduce((n, l) => n + Number(l.h) + Number(l.r), 0)
  assert.ok(samplers + 6 <= 16)
  combined.dispose()
 }
} finally { Object.defineProperty(globalThis, 'location', { value: oldLocation, configurable: true }) }
console.log('wide-height.test.mts: both real148km bridges, source checksums, explicit120m effective sampling, hardware fit, CPU-released per-level datum reconstruction and sampler/resident accounting: ok (GPU unrun)')
