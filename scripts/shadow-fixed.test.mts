import assert from 'node:assert/strict'
import { moonFragment } from '../src/moon/moonShader.ts'
import { coarseHorizonNeedsRebuild } from '../src/moon/coarseHorizon.ts'
import { shadowCoverageStats } from '../src/moon/shadowPolicy.ts'

const legacy = moonFragment(180, 4096, '', true, null, false, 0, false)
const explicitLegacy = moonFragment(180, 4096, '', true, null, false, 0, false, undefined, false, false, false)
assert.equal(explicitLegacy, legacy, 'the default legacy shader source stays byte-for-byte identical')
assert.ok(!legacy.includes('Parent cache entries are compatible terrain-space horizons'))

const fixed = moonFragment(180, 4096, '', true, null, false, 0, false, undefined, false, false, true)
assert.ok(!fixed.includes('Parent cache entries are compatible terrain-space horizons'), 'a coarser parent tile is never read: that is a worse picture than legacy')
assert.ok(!fixed.includes('cachedHorizon(level, uv, valid)'))
assert.ok(!fixed.includes('uShCoarse'), 'fixed cache misses never read the coarse map: they take the live march legacy uses')
assert.ok(fixed.includes('if (hb < 1.0e3 && gTileMarch >= 0.999) {'), 'the tile envelope skip is taken only by fully tiled pixels (the blend ring marches: its sampled bound failed on the rig); ?tenvwmin overrides')
assert.ok(fixed.includes('return horizonAtSun(p, t, lod, lodT);') && fixed.includes('float hzOld = w < 1.0 ? horizonDeg(p, t, heightAt(uvp, lod), lod) : 0.0;'), 'fixed cache misses march live, as legacy (horizonAtSun is horizonAt with the envelope skip in its old-march term)')

// Exact sub-pixel tap shortcuts: only in the fixed shader, never in legacy.
assert.ok(!legacy.includes('gCertSub') && !legacy.includes('tapExact'), 'legacy GLSL carries no tap shortcut')
assert.ok(fixed.includes('bool tapExact = tapV == 1.0 && tapF2 == 0.0;'), 'the tap shortcuts need a quad that is wholly sub-pixel, on ground without the deep wide ramp (two fwidth rounds)')
assert.ok(fixed.includes('gCertSub = wSun + 2.3;') && fixed.includes('if (gTileMarch >= 1.0) gHzStopDeg = es + wSun;'), 'the early stop is for fully tiled pixels only (a blended ring pixel mixes the 4k horizon, so a clamped tile term would not be exact)')
assert.ok(fixed.includes('gCertSub = -1.0;') && fixed.includes('gHzStopDeg = 200.0;'), 'both are reset after each tap')
const fixedNoTiles = moonFragment(180, 4096, '', false, null, false, 0, false, undefined, false, false, true)
assert.ok(fixedNoTiles.includes('gCertSub = wSun + 2.3;') && !fixedNoTiles.includes('if (gTileMarch >= 1.0) gHzStopDeg'), 'the no-tile variant has no gTileMarch/gHzStopDeg to reference (GLSL: undeclared identifier blacks the Moon)')
assert.ok(fixed.includes('float ghCert() { return gCertSub >= 0.0 ? gCertSub :'))

const a: [number, number, number] = [1, 0, 0]
const sameEpoch: [number, number, number] = [1, 0.000001, 0]
const nextEpoch: [number, number, number] = [1, 0.001, 0]
assert.equal(coarseHorizonNeedsRebuild('10000:0:0', a), false)
assert.equal(coarseHorizonNeedsRebuild('10000:0:0', sameEpoch), false, 'fallback map is reused within its quantized Sun epoch')
assert.equal(coarseHorizonNeedsRebuild('10000:0:0', nextEpoch), true, 'fallback map rebuilds when the quantized Sun epoch changes')
assert.deepEqual(shadowCoverageStats(4, 3), { cacheCoverage: 0.75, fallbackShare: 0.25 })
assert.deepEqual(shadowCoverageStats(0, 0), { cacheCoverage: 1, fallbackShare: 0 })

// Blend ring from the Sun-keyed tile cache (fixed policy only; ?shring=0 and legacy leave the text as it was).
// Default: the per-texel footprint envelope (src/moon/ringEnvelope.ts, level-2 layers). ?shenv=0 keeps the allowance read (bilinear, 4 deg + 3 x spread).
assert.ok(fixed.includes('if (uShOn > 0.5 && gTileMarch < 0.999 && lm == 2) hzC = ringEnvRead(lm, uvp, rcv, rHi, rLo);'), 'the ring reads the tile term and its cell bounds from the cache where the tile is fully faded in (level 2)')
assert.ok(fixed.includes('float rE = 0.0;') && !fixed.includes('cachedHorizonSpread(lm'), 'with the envelope there is no allowance and no spread read')
assert.ok(fixed.includes('if (es0 - mix(hzOld, rHi, w) > ghCert() - 2.3 || mix(hzOld, rLo, w) - es0 > ghCert() - 2.3) return hf;'), 'the ring marches the tile live unless the Sun clears the upper bound, or the lower bound clears the Sun, by the saturation distance')
assert.ok(fixed.includes('float hHi = mix(sHi, (rcv ? rHi : hzNew), w);') && fixed.includes('float hLo = mix(sLo, (rcv ? rLo : hzNew), w);') && fixed.includes('float hm = mix(em, (rcv ? rHi : hzNew), w);'), 'the Sun-bake and envelope certificates use the upper bound on the lit side and the lower on the shadow side')
assert.ok(fixed.includes('float ringEnvRead(int level, vec2 uv, out bool valid, out float hzHi, out float hzLo)') && fixed.includes('if (u >= 31.0 || l >= 31.0 || en.r < -12.0) { valid = false; return 0.0; }'), 'an unbounded cell or a texel outside the Sun band takes the live march')
assert.ok(fixed.includes('if (!rcv) hzNew = horizonDegT('), 'a ring pixel without a valid cache layer takes the live tile march, as legacy')
assert.ok(fixed.indexOf('float cachedHorizon(') < fixed.indexOf('float horizonAtSun('), 'cachedHorizon is declared before the Sun copy of horizonAt')
assert.ok(fixed.indexOf('float ringEnvRead(') < fixed.indexOf('float horizonAtSun('), 'ringEnvRead is declared before the Sun copy of horizonAt')
assert.equal(fixed.split('float cachedHorizon(').length, 2, 'cachedHorizon is declared once')
assert.equal(fixed.split('uniform float uShOn;').length, 2, 'uShOn is declared once')
assert.ok(!legacy.includes('cachedHorizon') && !legacy.includes('rcv') && !legacy.includes('ringEnv'), 'the legacy shader carries none of the ring cache')

// The previous read, behind ?shenv=0.
;(globalThis as { location?: unknown }).location = { search: '?shenv=0' }
const fixedOld = moonFragment(180, 4096, '', true, null, false, 0, false, undefined, false, false, true)
delete (globalThis as { location?: unknown }).location
assert.ok(fixedOld.includes('if (uShOn > 0.5 && gTileMarch < 0.999 && lm >= 0) hzC = cachedHorizonSpread(lm, uvp, rcv, rsp);'), 'the ring reads the tile term from the cache (with the spread of its four texels) where the tile is fully faded in')
assert.ok(fixedOld.includes('if (rcv && hzC < -12.0) rcv = false;'), 'a cached value contaminated by a texel outside the Sun band (-90) is not trusted')
assert.ok(fixedOld.includes('float rE = rcv ? gTileMarch * (4.00 + 3.00 * rsp) : 0.0;'), 'the ring carries an error allowance of 4 deg + 3 x the four-texel spread, times the tile share')
assert.ok(fixedOld.includes('if (abs(ghSunElev(p) - hf) > ghCert() - 2.3 + rE) return hf;'), 'the ring marches the tile live where the Sun margin is within saturation + allowance')
assert.ok(fixedOld.includes('sbCert() + rE') && fixedOld.includes('ghCert() + rE'), 'every skip of the Sun march that reads the cached ring value carries the allowance')
assert.ok(!fixedOld.includes('ringEnvRead'), 'the old read has no envelope code')
// The deeper tile sets carry the envelope too (near samples and a refinement pad in the build pass).
const fixedDeep = moonFragment(180, 4096, '', true, null, false, -3, false, undefined, false, false, true)
assert.ok(fixedDeep.includes('hzC = ringEnvRead(lm, uvp, rcv, rHi, rLo);') && !fixedDeep.includes('cachedHorizonSpread(lm, uvp'), 'a deeper tile set reads the envelope as well')

console.log('fixed shadow shader variants passed')
