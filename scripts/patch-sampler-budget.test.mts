// Patch shader variants keep within WebGL2's 16 fragment-sampler minimum and
// retain the selected site's image/height levels. Also compile the exact
// 16-sampler GLSL in Chrome when its bundled browser is available.
import assert from 'node:assert/strict'
import { MAX_PATCH_SAMPLERS, patchSamplerBudget } from '../src/moon/patch/config.ts'
import { levelsWithinSamplerBudget, samplerCount } from '../src/moon/patch/manifest.ts'
import { moonFragment } from '../src/moon/moonShader.ts'

const levels = Array.from({ length: 7 }, (_, i) => ({
  name: `L${i}`, w: 16, h: 16, texelM: 8 / (i + 1), eastM: 0, northM: 0,
  texelEastM: 1, texelNorthM: 1, heights: `h${i}`, detail: `d${i}`,
}))
assert.equal(patchSamplerBudget(16), 10)
assert.equal(patchSamplerBudget(12), 6)
assert.equal(patchSamplerBudget(4), 0)
const selected = levelsWithinSamplerBudget(levels, MAX_PATCH_SAMPLERS)
assert.equal(selected[0], levels[0], 'keep coarse coverage fallback')
assert.equal(selected.at(-1), levels.at(-1), 'keep finest declared image/height resolution')
assert.ok(samplerCount(selected) <= MAX_PATCH_SAMPLERS)
assert.deepEqual(levelsWithinSamplerBudget(levels.slice(0, 2), 0), [], 'reject a layout that cannot fit its minimum fallback')

const layout = selected.map((l) => ({ h: !!l.heights, r: !!l.detail, fadeM: 20 }))
const variants = [
  moonFragment(180, 4096, '', true, layout, false, -3, true, 'margin', true),
  moonFragment(180, 4096, '', true, layout, true, -3, true, 'margin', true),
]
for (const [index, patch] of variants.entries()) {
  const samplers = [...patch.matchAll(/uniform\s+(?:(?:lowp|mediump|highp)\s+)?sampler(?:2DArray|2D)\s+(\w+)\s*;/g)].map((m) => m[1])
  assert.equal(samplers.length, 16, `patch variant ${index} sampler declarations: ${samplers.join(', ')}`)
  assert.equal(new Set(samplers).size, 16, `patch variant ${index} has no duplicate declarations`)
  for (let i = 0; i < selected.length; i++) {
    assert.ok(patch.includes(`uPH${i}`), `selected height level ${i} retained in variant ${index}`)
    assert.ok(patch.includes(`uPR${i}`), `selected site photo level ${i} retained in variant ${index}`)
  }
  for (const sampler of ['uTileS', 'uShFade', 'uTileD', 'uDetailPage', 'uTcD', 'uTcPage', 'uHitTex'])
    assert.ok(!samplers.includes(sampler), `${sampler} omitted from variant ${index}`)
  assert.ok(patch.includes('return horizonAt(p, t, lod, lodT);'), `variant ${index} keeps the live horizon fallback`)
  assert.ok(patch.includes(`patchDetail(uPR${selected.length - 1}`), `variant ${index} retains finest selected site photo detail`)
}

console.log('patch sampler budget ok')
