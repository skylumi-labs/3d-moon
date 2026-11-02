/**
 * R4 review S2: the descent's iterations (GM_ITER, 800 since the real-DTM run of 2026-10-13 showed 98 of 576000 rays out of 400) are shared by cell reads and clearance steps. A ray that hugs the ground pays both, so it can run
 * out where the fixed march (384 steps, no reads) would not; it must then finish as the fixed march, never report a miss.
 * An all-open grid (nothing can be skipped) and a slope the ray grazes make every iteration a read + a step.
 */
import assert from 'node:assert/strict'
import { GM_ITER, SiteMax } from '../src/ground/siteMax.ts'
import { groundHitDescent, groundHitFixed, type GroundInputs } from '../src/ground/groundHit.ts'

const R = 1737400
const frame = { eastM: -500, northM: 500, w: 100, h: 100, texelEastM: 10, texelNorthM: 10 }
const sm = new SiteMax(frame, 5000)   // a ring far wider than the frame: every cell stays open
// The shipped budget copes with these rays by itself; a budget of half of it (what the descent was first given) is what reaches the fallback.
const SMALL = GM_ITER / 2
let fullBudget = 0, budget = 0, hitsAfterFallback = 0, fixedMissed = 0, n = 0
for (let k = 0; k < 200; k++) {
  // Flat ground, an eye 0.3 m up, a ray falling at 0.00003 to 0.00023: it meets the ground 1.3 to 10 km out, beyond what 384 floor-limited steps reach.
  const z = (): number => 0
  const dz = -(0.00003 + k * 0.000001)
  const l = Math.hypot(1, dz)
  const inp: GroundInputs = { o: [0, 0, 0.3], d: [1 / l, 0, dz / l], tanPerPx: 0.001, z, h0: 0, R, off: [0, 0], sm, coarseTexelM: 1e6 }
  const a = groundHitDescent(inp, SMALL), f = groundHitFixed(inp), full = groundHitDescent(inp)
  if (full.budget) fullBudget++
  n++
  if (!f.hit) fixedMissed++
  if (a.budget) { budget++; if (a.hit) hitsAfterFallback++ }
}
console.log(`ground-budget (budget ${SMALL} of GM_ITER ${GM_ITER}; ${fullBudget} rays out of iterations at GM_ITER): ${n} rays, the fixed march missed ${fixedMissed}; ${budget} descents ran out of iterations, ${hitsAfterFallback} of those still found the ground`)
assert.ok(budget > 0, 'the scenario must exhaust the budget somewhere (otherwise the fallback is untested)')
assert.equal(hitsAfterFallback, budget, 'a ray that runs out of iterations must be finished by the fixed march, not reported as a miss')
console.log('ground-budget.test: ok')
