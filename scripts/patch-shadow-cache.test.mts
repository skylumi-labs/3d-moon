// The patch shadow cache's pure parts: which levels get a layer, the atlas layout under the 16 MiB phone cap, the shader variants it adds, and the
// fragment-unit budget (the atlas is one of the patch shader's 16 units).
import assert from 'node:assert/strict'
import { cacheLevelFlags, packAtlas, chooseLayout, PSH_CAP_BYTES } from '../src/moon/patch/PatchShadowCache.ts'
import { patchSamplerBudget } from '../src/moon/patch/config.ts'
import { levelsWithinSamplerBudget, samplerCount } from '../src/moon/patch/manifest.ts'
import { moonFragment, patchShadowBuildFragment } from '../src/moon/moonShader.ts'

// Apollo 17's declared levels (manifest.json of the site, plus the optional tier and the wide bridge).
const a17 = [
  { name: 'L2', w: 3012, h: 4940, texelM: 8, heights: 'L2.h', texelEastM: 8, texelNorthM: 8, eastM: -13709, northM: 17690 },
  { name: 'L1', w: 4096, h: 4096, texelM: 2, heights: 'L1.h', texelEastM: 2, texelNorthM: 2, eastM: -4091, northM: 4096 },
  { name: 'L0', w: 4096, h: 4096, texelM: 0.6, texelEastM: 0.6, texelNorthM: 0.6, eastM: -1227, northNorthM: 1228 },
]
const bridge = { name: 'mid', w: 1200, h: 1200, texelM: 118, heights: 'mid.h' }
const tier = { name: 'L-1h', w: 3000, h: 3000, texelM: 0.75, heights: 'tier.h', heightFormat: 'f32' as const, axisEastPerTexelM: [0.7, 0.1] as [number, number] }
assert.deepEqual(cacheLevelFlags([bridge, ...a17, tier] as never[]), [false, true, true, false, false], 'the 8 m and 2 m height levels only: not the 118 m bridge, an image-only level or the rotated 25 cm tier')

// Layout under the cap: the broad 8 m level gives way before the 2 m level.
const dims = [{ w: 3012, h: 4940, texelM: 8 }, { w: 4096, h: 4096, texelM: 2 }]
const fit = chooseLayout(dims, PSH_CAP_BYTES.low, 8192, 2)
assert.ok(fit, 'Apollo 17 fits the phone cap')
assert.ok(fit.bytes <= 16 << 20, `phone atlas ${fit.bytes} bytes is within 16 MiB`)
assert.equal(fit.ks[1], 2, 'the 2 m level keeps k = 2')
assert.ok(fit.ks[0] >= 2 && fit.ks[0] <= 4, `the 8 m level is the coarser one (k ${fit.ks[0]})`)
assert.deepEqual(chooseLayout(dims, Infinity, 8192, 1)!.ks, [1, 1], 'k = 1 when asked for and not capped')
assert.equal(chooseLayout(dims, 1 << 20, 8192, 1), null, 'nothing fits 1 MiB at k <= 8')
assert.equal(packAtlas([{ cw: 5000, ch: 10 }], 4096), null, 'a layer wider than the texture limit does not fit')
const pk = packAtlas([{ cw: 3000, ch: 100 }, { cw: 2000, ch: 50 }, { cw: 1000, ch: 10 }], 4096)!
assert.deepEqual(pk.rects.map((r) => [r.x, r.y]), [[0, 0], [0, 100], [2000, 100]], 'shelf packing wraps to a new row')
assert.equal(pk.H, 150)

// The shader: with a cached level the patch variant reads the atlas and keeps its live fallback; the build pass does not read the atlas.
const budget = patchSamplerBudget(16, 1)
assert.equal(budget, 9)
assert.equal(patchSamplerBudget(16), 10, 'without the cache the budget is unchanged')
const many = Array.from({ length: 7 }, (_, i) => ({ name: `L${i}`, w: 16, h: 16, texelM: 8 / (i + 1), eastM: 0, northM: 0, texelEastM: 1, texelNorthM: 1, heights: `h${i}`, detail: `d${i}` }))
const picked = levelsWithinSamplerBudget(many, budget)
assert.ok(samplerCount(picked) <= 9)
const layout = picked.map((l, i) => ({ h: !!l.heights, r: !!l.detail, fadeM: 20, ...(i === 0 || i === 1 ? { cache: true } : {}) }))
const frag = moonFragment(180, 4096, '', true, layout, false, -3, true, 'margin', true)
const samplers = [...frag.matchAll(/uniform\s+(?:(?:lowp|mediump|highp)\s+)?sampler(?:2DArray|2D)\s+(\w+)\s*;/g)].map((m) => m[1])
assert.ok(samplers.includes('uPSC'), 'the patch variant declares the atlas')
assert.ok(samplers.length <= 16, `patch variant with the cache read declares ${samplers.length} samplers`)
assert.ok(frag.includes('return horizonAt(p, t, lod, lodT);'), 'the live march stays the fallback')
assert.ok(frag.includes('pshAt(uPCo0, uPCk0, pq0)') && frag.includes('pshAt(uPCo1, uPCk1, pq1)'), 'both cached levels are read')
assert.ok(!/uPCo2/.test(frag), 'an uncached level has no atlas uniforms')
const plain = moonFragment(180, 4096, '', true, picked.map((l) => ({ h: !!l.heights, r: !!l.detail, fadeM: 20 })), false, -3, true, 'margin', true)
assert.ok(!plain.includes('uPSC'), 'no cache flag, no atlas unit')
const build = patchShadowBuildFragment(layout, 180, 4096, -3)
assert.ok(!/uniform\s+\w+\s+sampler2D\s+uPSC/.test(build), 'the build pass never samples the atlas it draws into')
assert.ok(build.includes('horizonDegT(p, normalize(ts), h0, -3, lodG)'), 'the build pass runs the pixel shader\'s own march')
console.log('patch shadow cache ok')
