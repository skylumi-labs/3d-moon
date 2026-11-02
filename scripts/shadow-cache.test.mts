// The shadow cache's shader contract (src/moon/moonShader.ts): only the Sun sites read the cache, the view-horizon test stays a live march,
// the build pass marches the same function the pixel shader does, and the untiled shader still defines horizonSun.
import assert from 'node:assert/strict'
import { moonFragment, shadowCacheFragment, SH_CACHE_PAGE_W } from '../src/moon/moonShader.ts'

const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length
for (const deepest of [0, -3]) {
  const tiled = moonFragment(180, 4096, '', true, null, false, deepest)
  // The Sun sites (the sub-pixel sample and the single one of the active shadow-AA mode) read the cache; the viewer's horizon (vis) marches live.
  assert.equal(count(tiled, /horizonSun\((?:ps|p), normalize\(/g), 2, `sun sites at ${deepest}`)
  assert.equal(count(tiled, /horizonAt\(p, normalize\(tv\)/g), 1, 'view horizon stays live')
  assert.match(tiled, /uniform highp sampler2DArray uTileS;/)
  assert.match(tiled, new RegExp(`ivec2\\(ly & ${SH_CACHE_PAGE_W - 1}, ly >> 8\\)`))
  assert.match(tiled, new RegExp(`if \\(lm >= ${deepest}\\)`), 'cache covers the set\'s deepest level')
  const build = shadowCacheFragment(180, 4096, deepest)
  assert.match(build, /horizonDegT\(p, normalize\(ts\), h0, uShLevel, lodG\)/)
  assert.doesNotMatch(build, /uTileS|horizonSun/, 'the build pass never samples the array it draws into')
  assert.match(build, /uniform float uMotion;/, 'the build pass declares the motion uniform its tile march reads')
}
const plain = moonFragment(180, 4096, '', false)
assert.match(plain, /float horizonSun\(/)
// Site patch programs reserve their fragment units for site imagery and march Sun horizons live.
const patch = moonFragment(180, 4096, '', true, [{ h: true, r: true, fadeM: 10 }], false, 0)
assert.doesNotMatch(patch, /uniform highp sampler2DArray uTileS;/)
assert.match(patch, /return horizonAt\(p, t, lod, lodT\);/)
console.log('shadow-cache shader contract ok')
