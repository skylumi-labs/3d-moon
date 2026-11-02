// Issue #22: the colour/WAC/detail texture gradients must be differences of two SPHERE hits. The base is the sphere hit's uv (uvSph),
// never the terrain-resolved uv: terrain parallax added to a derivative smears fine texture radially near the camera floor.
import assert from 'node:assert/strict'
import { moonFragment } from '../src/moon/moonShader'

for (const [name, src] of [
  ['tiles+detail', moonFragment(360, 1024, '', true, null, false, 0, true, false)],
  ['tiles+detail+tc', moonFragment(360, 1024, '', true, null, false, 0, true, false, true)],
] as const) {
  assert.match(src, /vec2 gx = uvOf\(moonHit\(cameraRay\(px \+ vec2\(1\.0, 0\.0\)\), bx\)\) - uvSph;/, `${name}: gx base`)
  assert.match(src, /vec2 gy = uvOf\(moonHit\(cameraRay\(px \+ vec2\(0\.0, 1\.0\)\), by\)\) - uvSph;/, `${name}: gy base`)
  assert.doesNotMatch(src, /\), b[xy]\)\) - uv;/, `${name}: no gradient may subtract the terrain-resolved uv`)
}
const tiles = moonFragment(360, 1024, '', true, null, false, 0, true, false)
assert.match(tiles, /vec2 uvSph = uvOf\(pSph\);/, 'with tiles the base is the pre-terrainResolve sphere hit')
assert.ok(tiles.indexOf('vec3 pSph = p;') < tiles.indexOf('terrainResolve(rr, b, p, hitPos, cover);'), 'pSph is captured before terrainResolve')
assert.match(moonFragment(360, 1024, '', false), /bx\)\) - uv;/, 'no tiles: the sphere is the ground, text unchanged')
console.log('floor-smear: ok')
