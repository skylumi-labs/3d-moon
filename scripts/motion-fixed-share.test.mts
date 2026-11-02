// A class with a fixed part in its motion frame cost (desktop) is predicted by an affine model; the default stays the pure pixel-count model.
import assert from 'node:assert/strict'
import { frameBudgetMs, ladderStep, predictMs, setFixedShare } from '../src/post/motionGrid.ts'

setFixedShare(0)
assert.equal(predictMs(10, 0.5, 1), 40, 'default: cost follows the pixel count')
// Measured on an Apple M5 (2026-10-07): 10.6 ms (9-10 in the A/B) at grid 0.35, 9.7 at 0.5, 9.3 at 0.7. The pure model never climbs from 0.35 at 60 Hz.
assert.equal(ladderStep(9.5, 0.35, 99, frameBudgetMs(60)), null, 'pure model predicts 20 ms at 0.5 and holds 0.35')
setFixedShare(0.85)
assert.equal(ladderStep(9.5, 0.35, 99, frameBudgetMs(60)), 0.5, 'fixed share: 0.5 is predicted at 11.0 ms and tried')
assert.equal(ladderStep(9.7, 0.5, 99, frameBudgetMs(60)), 0.7, 'and 0.7 after it')
assert.ok(Math.abs(predictMs(10, 0.5, 0.5) - 10) < 1e-9, 'same grid, same cost')
assert.equal(ladderStep(30, 0.7, 99, frameBudgetMs(60)) !== null, true, 'a slow frame still steps down')
setFixedShare(2); assert.ok(predictMs(10, 0.5, 1) < 40, 'clamped, not above the pure model')
setFixedShare(NaN); assert.equal(predictMs(10, 0.5, 1), 40, 'a bad value is the pure model')
console.log('motion fixed share: ok')
