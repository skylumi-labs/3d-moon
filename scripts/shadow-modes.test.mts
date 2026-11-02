// The visitor sheet offers Full / Fast / Off; Baked stays an internal runtime mode. Every program that reads uShMode declares it, Full (0) leaves the shipped
// conditions true, Fast enables the lite march at rest, Off skips the horizon march. No mode needs a recompile.
import assert from 'node:assert/strict'
import { moonFragment, patchShadowBuildFragment, shadowCacheFragment } from '../src/moon/moonShader.ts'
import { SHADOW_MODE_UNIFORM, getShadowMode, setShadowMode, onShadowModeChange, shadowModeFromSearch } from '../src/moon/shadowMode.ts'

for (const [name, frag] of [['plain', moonFragment(180, 4096, '', true, null, false, 0)], ['deep', moonFragment(180, 4096, '', true, null, false, -3)]] as const) {
  assert.equal((frag.match(/uniform float uShMode;/g) ?? []).length, 1, `${name}: uShMode declared once`)
  assert.ok(frag.includes('bool shadowSubpixel = abs(elevS) < bandDeg && uMotion < 0.5 && uShMode < 0.5'), `${name}: the 4-sample terminator average is Full only`)
  assert.ok(frag.includes('} else if (uShMode < 1.5 && elevS > -10.0'), `${name}: Off skips the horizon march`)
  assert.ok(frag.includes('} else if (uShMode > 1.5) {\n    // Shadows Off: a flat horizon') && frag.includes('shadowMargin = vec4(elevS);'), `${name}: Off keeps the Sun-elevation day/night margin (no lit night side near the terminator)`)
  assert.ok(frag.includes('|| uShMode > 0.5) ? 24.0 : 38.0'), `${name}: Fast takes the lite 24 degree cut`)
}
const cache = shadowCacheFragment(180, 4096, -3)
assert.equal((cache.match(/uniform float uShMode;/g) ?? []).length, 1, 'the cache build declares uShMode (never set: the build is always the full march)')
assert.equal((patchShadowBuildFragment([{ h: true, r: true, fadeM: 40, shade: true }], 180, 4096, 0).match(/uniform float uShMode;/g) ?? []).length, 1, 'the patch cache build declares uShMode')
assert.deepEqual(SHADOW_MODE_UNIFORM, { full: 0, fast: 1, off: 2, baked: 3 })
assert.equal(shadowModeFromSearch('?shadows=baked'), 'baked', 'the effective mode parser accepts the internal forced-Baked URL')
assert.equal(shadowModeFromSearch('?shadows=unknown'), null)

const seen: string[] = []
const off = onShadowModeChange((m) => seen.push(m))
assert.equal(getShadowMode(), 'full')
setShadowMode('fast'); setShadowMode('fast'); setShadowMode('off'); setShadowMode('full')
assert.deepEqual(seen, ['fast', 'off', 'full'], 'one notice per change')
off()
setShadowMode('off')
assert.deepEqual(seen, ['fast', 'off', 'full'], 'unsubscribed')
setShadowMode('full')
console.log('shadow-modes: ok')
