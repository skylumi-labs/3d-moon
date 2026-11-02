// The horizon march's tile level follows the pixel footprint (lodST). Over deeper ground that footprint must be allowed below level 0:
// with a floor of 1.0 the march and its origin read level 0 (474 m) whatever the data, while the slope and the ground hit read the 59 m
// field, and the two disagree on a steep wall (crater walls drew as vertical grey slabs).
import assert from 'node:assert/strict'
import { MARCH_REFINE_MIN_KM, moonCoverFragment, moonFragment } from '../src/moon/moonShader.ts'

const lodST = (f: string): string => {
  const m = f.match(/float lodST = max\(lodT0, log2\(max\(([0-9.]+), kmPerPx/)
  assert.ok(m, 'lodST line present')
  return m[1]
}
assert.equal(lodST(moonFragment(180, 4096, '', true)), '1.0', 'depth 0 keeps the floor of 1')
for (const deepest of [-1, -2, -3]) {
  const f = moonFragment(180, 4096, '', true, null, false, deepest)
  assert.equal(Number(lodST(f)), 2 ** deepest, `the footprint floor at ${deepest}`)
  assert.ok(f.includes('int lm = clamp(int(floor(lodT + 0.5)), TL_MIN, 2);'), 'the march origin may take a deeper level')
}
assert.ok(moonCoverFragment(180, 4096, null, -3).includes('TL_MIN'), 'cover pass has the deeper floor')

// The crest refinement does not run on the nearest samples (a scatter of one-pixel shadow dots otherwise), and only in the deep variant.
const f3 = moonFragment(180, 4096, '', true, null, false, -3)
assert.ok(f3.includes(`if (bestD < ${MARCH_REFINE_MIN_KM.toFixed(3)}) break;`), 'refinement floor present')
assert.ok(MARCH_REFINE_MIN_KM > 0.06 && MARCH_REFINE_MIN_KM <= 0.25, 'floor sits between the first near sample and the first linear one')
assert.ok(!moonFragment(180, 4096, '', true).includes('bestD'), 'depth 0 carries no refinement')
console.log('deep-lod ok')
