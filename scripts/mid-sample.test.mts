/** Requires the explicitly materialized local sample; absence is a blocked check, never a skip-pass. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { PatchLayer, type PatchManifest } from '../src/moon/patch/PatchLayer.ts'
import { moonFragment } from '../src/moon/moonShader.ts'
import { overlapWeight } from '../src/moon/patch/demand.ts'
const base = process.env.MOON_MID_SAMPLE_DIR
if (!base) throw new Error('Blocked: MOON_MID_SAMPLE_DIR must name verified local SLDEM sample packages')
for (const site of ['a11', 'a17']) {
  const dir = path.join(base, site + '-package'), m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as PatchManifest
  const arrays = m.levels.map(l => { const bytes = zlib.gunzipSync(fs.readFileSync(path.join(dir, l.heights!))); return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) })
  const [coarse, fine] = arrays
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const mean = (fine[y * 2 * 64 + x * 2] + fine[y * 2 * 64 + x * 2 + 1] + fine[(y * 2 + 1) * 64 + x * 2] + fine[(y * 2 + 1) * 64 + x * 2 + 1]) / 4
    assert.ok(Math.abs(coarse[y * 32 + x] - mean) < .0003, 'native/coarse registration and averaging')
  }
  assert.equal(m.levels[0].eastM, m.levels[1].eastM)
  assert.equal(m.levels[0].northM, m.levels[1].northM)
  assert.equal(m.levels[0].w * m.levels[0].texelEastM, m.levels[1].w * m.levels[1].texelEastM)
  assert.equal(m.levels[0].h * m.levels[0].texelNorthM, m.levels[1].h * m.levels[1].texelNorthM)
  const fetchImpl: typeof fetch = async (input, init) => { init?.signal?.throwIfAborted(); const file = path.join(dir, String(input).split('/').at(-1)!); return new Response(fs.readFileSync(file)) }
  const layer = await PatchLayer.create('https://fixture/', { tier: false, maxTexture: 48, net: { fetchImpl, delaysMs: [] } })
  assert.equal(layer.continuousMidAvailable, false, 'a small crop is never a full-band capability')
  assert.equal(layer.levels.length, 1)
  assert.ok(Math.max(layer.levels[0].w, layer.levels[0].h) <= 48)
  await layer.updateDemand({ altitudeKm: 10, metresPerPixel: 10, zoomedIn: true })
  assert.equal(layer.levels.length, 2)
  assert.ok(layer.residentBytes < 1024 * 1024)
  const shader = moonFragment(180, 4096, '', true, layer.levels.map(l => ({ h: !!l.heights, r: !!l.detail, fadeM: 400 })), true)
  assert.doesNotMatch(shader, /undefined|if \( >|NaN/)
  assert.equal(overlapWeight(0, 400), 0)
  assert.ok(overlapWeight(.01, 400) < 1e-12, 'C2 overlap has no boundary step')
  layer.dispose()
}
console.log('mid-sample.test.mts: real SLDEM crops, registration/coarse means, checksums, 48px hardware fit, height-only shader and sampler/resident budgets: ok')
