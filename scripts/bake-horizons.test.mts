import assert from 'node:assert/strict'
import { horizonAngle, packAngle, unpackAngle, bilinear } from './bake-horizons.mjs'
assert.equal(horizonAngle(() => 0), 0, 'flat ground has zero horizon')
const cliff = horizonAngle(d => d >= 10 ? 10 : 0, { minD: 1, maxD: 20, step: 1, grow: 0, curvature: false })
assert.ok(Math.abs(cliff - Math.atan2(9.5, 10) * 180 / Math.PI) < 1e-10, 'cliff includes the 0.5 m origin offset')
assert.ok(Math.abs(unpackAngle(packAngle(cliff)) - cliff) <= 64 / 510)
assert.equal(horizonAngle(d => d < 128 && d > 0 ? 100 : 0), 0, 'far bake excludes near field')
assert.throws(() => horizonAngle(d => d ? NaN : 0), /margin/)
assert.equal(bilinear([0, 10, 20, 30], 2, 2, 1, 1), 15)
assert.equal(bilinear([0, 10], 2, 1, 0, .5, true), 5, 'longitude seam wraps')
console.log('bake-horizons: flat, cliff, bias, quantization, margin, and seam passed')
// Baker's load-time resampling follows PatchLayer, including the 1.5 m DTM's bicubic 2x store.
import { fitPatchRaster, upsample2x, gridKey as bakeKey } from './bake-horizons.mjs'
import { upsample2x as appUpsample } from '../src/moon/patch/PatchLayer.ts'
import { gridKey as runtimeKey } from '../src/moon/baked/format.ts'
const raster = new Float32Array([0, 2, 9, 5])
assert.deepEqual(upsample2x(raster, 2, 2), appUpsample(raster, 2, 2))
const lv = { name: 'fine', heights: 'fine.gz', heightFormat: 'f32', w: 2, h: 2, texelM: 1.5, texelEastM: 1.5, texelNorthM: 1.5, eastM: 0, northM: 0, h0M: -2037 }
const fitted = fitPatchRaster(lv, raster, 4096)
assert.equal(fitted.level.w, 4)
assert.equal(fitted.level.texelM, .75)
assert.equal(bakeKey(fitted.level), runtimeKey(fitted.level, -2037))
assert.equal(fitPatchRaster(lv, raster, 2).level.w, 2)
// End-to-end file contract: local MHT1 + patch manifest -> gzip RGBA planes + validated manifest.
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { bake } from './bake-horizons.mjs'
import { BAKED_GLOBAL_HASH, validateHorizonManifest } from '../src/moon/baked/format.ts'
const temp = mkdtempSync(join(tmpdir(), 'baked-smoke-'))
try {
  const global = Buffer.alloc(20 + 4 * 2 * 2)
  global.write('MHT1'); global.writeUInt32LE(4, 4); global.writeUInt32LE(2, 8); global.writeFloatLE(4, 12); global.writeFloatLE(180, 16)
  writeFileSync(join(temp, 'global.bin'), global)
  writeFileSync(join(temp, 'fine.gz'), Buffer.from(raster.buffer))
  writeFileSync(join(temp, 'patch.json'), JSON.stringify({ site: { lat: 20.1911, lon: 30.7723 }, h0M: -2037, levels: [lv] }))
  const manifest = await bake({ global: join(temp, 'global.bin'), patch: join(temp, 'patch.json'), out: join(temp, 'out'), globalStride: 4, globalN: 4, patchN: 4, maxD: 128 })
  validateHorizonManifest(manifest)
  assert.equal(manifest.tiles.length, 2)
  assert.equal(manifest.sources[1].key, runtimeKey(fitted.level, -2037))
  for (const tile of manifest.tiles) {
    const raw = gunzipSync(readFileSync(join(temp, 'out', tile.file)))
    assert.equal(raw.length, tile.bytes)
    assert.equal(createHash('sha256').update(raw).digest('hex'), tile.sha256)
  }
  assert.ok(gunzipSync(readFileSync(join(temp, 'out', manifest.tiles[0].file))).every(v => v === 0), 'flat global bake includes zero gutters')
} finally { rmSync(temp, { recursive: true, force: true }) }
console.log('bake-horizons: source resampling and complete file contract passed')

assert.equal(createHash('sha256').update(gunzipSync(readFileSync(new URL('../shared-assets/moon-height-4k.bin.gz', import.meta.url)))).digest('hex'), BAKED_GLOBAL_HASH, 'rebake and update identity when the global map changes')
