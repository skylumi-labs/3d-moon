import assert from 'node:assert/strict'
import { edgeK, steepen } from '../src/post/edgeSharpen.ts'
import { FINAL_FRAGMENT } from '../src/post/final.ts'

// 0.55 CSS px at the reference desktop DPR of 2 gives a 1.1 canvas-pixel target.
const restPx = 1.1
const identityGridOne = edgeK(1, restPx, 1)
assert.equal(identityGridOne, 0.5)
for (let i = 0; i <= 100; i++) {
  const t = i / 100
  assert.ok(Math.abs(steepen(t, identityGridOne) - t) < 1e-12)
}

for (const k of [0, 0.12, 0.25, 0.4, 0.5]) {
  assert.equal(steepen(0, k), 0)
  assert.equal(steepen(1, k), 1)
  let previous = -1
  for (let i = 0; i <= 1000; i++) {
    const value = steepen(i / 1000, k)
    assert.ok(value >= previous, `profile must be monotonic for k=${k}`)
    previous = value
  }
}

for (const grid of [0.2, 0.25, 0.35, 0.5, 0.7, 0.98, 1]) {
  const texelPx = 1 / grid
  const k = edgeK(grid, restPx, texelPx)
  const outputWidthPx = 2 * k * texelPx
  assert.ok(outputWidthPx <= restPx + 1e-12, `grid ${grid}: ${outputWidthPx}px exceeds ${restPx}px`)
}

for (const grid of [0.7, 0.5]) {
  assert.ok(edgeK(grid, restPx, 1 / grid) < 0.5, `grid ${grid} must sharpen below the bilinear identity profile`)
}

const orderedGrids = [0.2, 0.25, 0.35, 0.5, 0.7, 0.98, 1]
const widths = orderedGrids.map((grid) => 2 * edgeK(grid, restPx, 1 / grid) / grid)
for (let i = 1; i < widths.length; i++) {
  assert.ok(widths[i] <= widths[i - 1] + 1e-12, 'finer grids must not produce wider transitions')
}

assert.match(FINAL_FRAGMENT, /float aLo = min\(min\(aa, ab\), min\(ad, ae\)\)/)
assert.match(FINAL_FRAGMENT, /if \(aHi > 0\.9 && aHi - aLo > 0\.5\)/)
assert.match(FINAL_FRAGMENT, /float alphaBilinear = texture\(uScene, uv\)\.a/)
assert.match(FINAL_FRAGMENT, /coverageClassColour\(a, b, d, e, alpha, weights, f, midpoint, false\)/)
assert.match(FINAL_FRAGMENT, /coverageClassColour\(a, b, d, e, alpha, weights, f, midpoint, true\)/)
assert.match(FINAL_FRAGMENT, /float sumWeights = dot\(classWeights, vec4\(1\.0\)\)/)
assert.match(FINAL_FRAGMENT, /mix\(lowColour, highColour, tSharp\)/)
assert.ok(FINAL_FRAGMENT.indexOf('if (uSharpen <= 0.001) return c;') > FINAL_FRAGMENT.indexOf('mix(lowColour, highColour, tSharp)'), 'interior anti-sparkle path remains after silhouette reconstruction')

console.log('edge-sharpen: profile, width, and coverage reconstruction checks passed')
