/**
 * The credits follow what is drawn: a patch whose newer level is still compiling stays credited.
 *   tsx scripts/patch-drawn.test.mts
 */
import assert from 'node:assert/strict'
import { patchIsDrawn } from '../src/patchDrawn.ts'

assert.equal(patchIsDrawn({ hasPatch: true, patchState: 'ready', boundLevels: 3 }), true)
// The A17 flake: onResident bound the old layout and the revision lagged while the next layout compiled. Still drawn, still credited.
assert.equal(patchIsDrawn({ hasPatch: true, patchState: 'ready', boundLevels: 2 }), true)
assert.equal(patchIsDrawn({ hasPatch: true, patchState: 'ready', boundLevels: 0 }), false)
assert.equal(patchIsDrawn({ hasPatch: true, patchState: 'loading', boundLevels: 2 }), false)
assert.equal(patchIsDrawn({ hasPatch: false, patchState: 'ready', boundLevels: 2 }), false)
console.log('patch-drawn: ok')
