import assert from 'node:assert/strict'
import { SHADOW_AA_MAX_DEG, geometryShadowEdgeAa, moonFragment, shadowMarginEdgeAa } from '../src/moon/moonShader.ts'

// CPU mirror of the investigative policy: widths are finite, nonnegative and capped.
assert.equal(geometryShadowEdgeAa(0, 0), 0)
assert.equal(geometryShadowEdgeAa(0.02, -0.01), 0.0225)
assert.equal(geometryShadowEdgeAa(4, -3), SHADOW_AA_MAX_DEG)
assert.equal(geometryShadowEdgeAa(Number.NaN, 1), 0)
assert.ok(geometryShadowEdgeAa(1e6, 0) <= SHADOW_AA_MAX_DEG)
assert.equal(shadowMarginEdgeAa(0, 0), 0)
assert.equal(shadowMarginEdgeAa(0.02, -0.01), 0.0225)
assert.equal(shadowMarginEdgeAa(4, -3), SHADOW_AA_MAX_DEG)
assert.equal(shadowMarginEdgeAa(Number.NaN, 1), 0)
assert.ok(shadowMarginEdgeAa(-1e6, 1e6) <= SHADOW_AA_MAX_DEG)

// The production default is the margin candidate: it places fwidth in
// uniform flow and removes
// derivatives of the conditionally evaluated skyline margin. Its width omits
// skyline variation; this source check does not establish visual correctness.
const base = moonFragment(180, 4096, '', true, null, false, -3)
const geometry = moonFragment(180, 4096, '', true, null, false, -3, false, true)
assert.ok(base.includes('fwidth(shadowMargin)'), 'production default uses the margin edge width')
assert.ok(!base.includes('fwidth(dmS)') && !base.includes('fwidth(m)'), 'production default avoids branch-local derivatives')
assert.ok(geometry.includes('min(2.0, 0.75 * fwidth(elevS))'), 'geometry mode uses a bounded elevation footprint')
assert.ok(!geometry.includes('fwidth(dmS)') && !geometry.includes('fwidth(m)'), 'geometry mode avoids branch-local derivatives')
assert.ok(geometry.indexOf('float edgeAA =') < geometry.indexOf('if (abs(elevS) < bandDeg && uMotion < 0.5)'), 'edge width is evaluated before varying branches')

// The old branch remains available only as an explicit diagnostic mode.
const legacy = moonFragment(180, 4096, '', true, null, false, -3, false, 'legacy')
assert.ok(legacy.includes('fwidth(dmS)') && legacy.includes('fwidth(m)'), 'legacy mode retains the reference edge widths')
assert.ok(!legacy.includes('shadowMargin = vec4(90.0)'), 'legacy mode does not compile the margin candidate')

// The margin candidate captures the actual Sun-minus-skyline values inside
// varying branches, then evaluates derivatives and smoothsteps after them.
// Near the terminator it keeps four offset horizon samples; elsewhere it
// performs one horizon march and replicates that signed margin.
const margin = moonFragment(180, 4096, '', true, null, false, -3, false, 'margin')
const marginDepth0 = moonFragment(180, 4096, '', true, null, false, 0, false, 'margin')
const marginNoTiles = moonFragment(180, 4096, '', false, null, false, 0, false, 'margin')
const marginStart = margin.indexOf('vec4 shadowMargin = vec4(90.0);')
const marginDerivatives = margin.indexOf('vec4 shadowWidth =')
const marginLighting = margin.indexOf('vec4 wideLit =')
const marginNight = margin.indexOf('} else if (elevS <= -10.0)', marginLighting)
assert.ok(marginStart >= 0 && marginStart < marginDerivatives, 'signed margin storage starts before its varying sample branches')
assert.ok(marginDerivatives > marginStart && marginLighting > marginDerivatives, 'derivative width and smoothstep follow the varying branches')
assert.ok(marginNight > marginLighting, 'night handling selects final direct-light state after derivatives')
assert.match(margin.slice(marginStart, marginDerivatives), /shadowMargin\[k\] = es - hzs;/, 'four-sample branch stores signed skyline margins')
assert.match(margin.slice(marginStart, marginDerivatives), /shadowMargin = vec4\(elevS - hz\);/, 'single-march branch replicates its margin across all four lanes')
assert.match(margin.slice(marginDerivatives, marginNight), /min\(vec4\(2\.0\), 0\.75 \* uTermAA \* fwidth\(shadowMargin\)\)/, 'candidate bounds the actual margin derivative at two degrees')
assert.equal((margin.slice(marginStart, marginDerivatives).match(/horizonSun\(/g) ?? []).length, 2, 'high-Sun fragments do not incur extra horizon marches')
assert.ok(!margin.slice(marginStart, marginDerivatives).includes('fwidth('), 'no derivative is evaluated inside a varying branch')
assert.ok(marginDepth0.includes('mix(sunDiscLit, wideLit, 0.0)'), 'depth 0 does not reference the tile-only deep share')
assert.ok(marginNoTiles.includes('mix(sunDiscLit, wideLit, 0.0)'), 'non-tiled margin shader does not reference the tile-only deep share')
assert.ok(!marginNoTiles.includes('gDeepK'), 'non-tiled shader has no undeclared deep-share reference')

// A set containing only level -1 still declares the deeper-ground share used
// by the generic penumbra path; it correctly evaluates to zero without -2.
const depth1 = moonFragment(180, 4096, '', true, null, false, -1)
assert.ok(depth1.includes('float gDeepK = 0.0;'), 'depth -1 declares the deep share')
assert.ok(depth1.includes('gDeepK = 0.0 * uTileMarch;'), 'depth -1 has no finer-level share')

// Deep levels are applied coarse-to-fine with sequential mix(), so their
// effective share is 1 - product(1 - weight), not a potentially >1 sum.
const depth3 = moonFragment(180, 4096, '', true, null, false, -3)
assert.ok(depth3.includes('gDeepK = (1.0 - (1.0 - wn2) * (1.0 - wn3)) * uTileMarch;'), 'deep share composes sequential blend weights')
let share = 0
for (const weight of [0.5, 0.5]) share = share * (1 - weight) + weight
assert.equal(share, 0.75, 'overlapping half weights contribute three quarters, not their sum of one')
assert.equal([1, 1].reduce((sum, weight) => sum + weight, 0), 2, 'the previous sum could exceed one')
console.log('shadow-aa ok')
