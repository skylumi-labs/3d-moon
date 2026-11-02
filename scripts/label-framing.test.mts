import assert from 'node:assert/strict'
import { featureViewDistance } from '../src/labels/framing.ts'
import { MOON_R_KM } from '../src/glsl/common.ts'
for (const aspect of [0.5, 1, 1.8]) {
  const dist = featureViewDistance(154, 45, aspect)!
  const width = 2 * (dist - 1) * MOON_R_KM * Math.tan(45 * Math.PI / 360) * Math.min(1, aspect)
  assert.ok(Math.abs(154 / width - 0.75) < 1e-10)
}
assert.equal(featureViewDistance(undefined, 45, 1), undefined)
assert.ok(featureViewDistance(1000, 45, 1)! > featureViewDistance(154, 45, 1)!)
console.log('label-framing: ok')
