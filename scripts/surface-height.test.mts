import assert from 'node:assert/strict'
import { DataUtils } from 'three'
import { createSurfaceHeightSampler, radiusAtHeightM, sampleGlobalHeightM, type HeightMapSource } from '../src/labels/surfaceHeight.ts'

const half = (values: number[]) => new Uint16Array(values.map((v) => DataUtils.toHalfFloat(v)))
const source: HeightMapSource = {
  lonSpan: 180,
  size: [4, 2],
  texture: { mipmaps: [{ width: 4, height: 2, data: half([0, 100, 200, 300, 400, 500, 600, 700]) }] },
}
const sampler = createSurfaceHeightSampler(source, 2)
assert.equal(sampler.sample(0, 0), 350, 'UV center bilinearly blends the four adjacent texels')
assert.equal(sampler.sample(180, 0), 350, 'positive dateline wraps to the same seam sample')
assert.equal(sampler.sample(-180, 0), 350, 'negative dateline wraps to the same seam sample')
assert.equal(sampler.sample(0, 90), 150, 'north pole clamps to the first row')
assert.equal(sampler.sample(0, -90), 550, 'south pole clamps to the last row')
assert.equal(sampler.sample(0, 120), 150, 'latitudes beyond the pole clamp to the pole')
assert.equal(sampler.sample(Number.NaN, 0), null, 'invalid coordinates do not produce a terrain sample')
sampler.sample(90, 20); sampler.sample(-90, 20)
assert.equal(sampler.cacheSize, 2, 'sample cache has a fixed caller-selected bound')
sampler.clear()
assert.equal(sampler.cacheSize, 0)

const retained: HeightMapSource = { ...source, sample: { width: 4, height: 2, data: half([0, 100, 200, 300, 400, 500, 600, 700]) }, texture: { mipmaps: [] } }
assert.equal(sampleGlobalHeightM(retained, 0, 0), 350, 'retained level remains readable after GPU upload clears mipmaps')
const pending: HeightMapSource = { ...source, pending: true }
assert.equal(sampleGlobalHeightM(pending, 0, 0), 0, 'flat pending map has zero datum height')
assert.ok(Math.abs(radiusAtHeightM(1000) - (1737.4 + 1) / 1737.4) < 1e-12)

console.log('surface-height.test ok')
