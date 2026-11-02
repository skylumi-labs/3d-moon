import assert from 'node:assert/strict'
import { thinIsolation, thinClampAmount, thinSwitches } from '../src/post/thinClamp.ts'

// A lone lit peak: nothing bright 2-3 texels away. A dash of a crest line: its neighbour along the line is nearly as bright.
const peak = thinIsolation(1, 0.05)
const dash = thinIsolation(1, 0.8)
assert.ok(peak > 0.99, `lone peak is isolated: ${peak}`)
assert.ok(dash < 0.01, `dash with company is not isolated: ${dash}`)
assert.equal(thinClampAmount(1, peak, true) < 0.01, true, 'lit peak kept (clamp ~0)')
assert.equal(thinClampAmount(1, dash, true) > 0.99, true, 'stray dash still clamped')
assert.equal(thinClampAmount(1, peak, false), 1, 'a10peak=0 restores the old clamp')
assert.equal(thinIsolation(0, 1), 0)
assert.equal(thinIsolation(1, NaN), 0)
assert.equal(thinSwitches('').peaks, true)
assert.equal(thinSwitches('?a10peak=0').peaks, false)
console.log('thin-clamp ok')
