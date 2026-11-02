// Idle prefetch of the neighbouring viewpoints: the list wraps, the set is bounded, and it only starts at rest.
import assert from 'node:assert/strict'
import { NEXT_VIEW_IDLE_MS, NEXT_VIEW_MAX_TARGETS, capTargets, neighbourPositions, nextViewReady } from '../src/net/nextViewPrefetch.ts'
import { VIEWPOINT_ENTRIES } from '../src/viewpointList.ts'

const entries = VIEWPOINT_ENTRIES
const last = { entry: entries.length - 1, step: entries[entries.length - 1].steps.length - 1 }
assert.deepEqual(neighbourPositions(entries, { entry: 0, step: 0 })[0], { entry: 1, step: 0 }, 'next of the first entry is the second')
assert.deepEqual(neighbourPositions(entries, { entry: 0, step: 0 })[1], last, 'back from the first wraps to the last')
assert.deepEqual(neighbourPositions(entries, last)[0], { entry: 0, step: 0 }, 'next from the last wraps to the first')
assert.deepEqual(neighbourPositions(entries, { entry: 7, step: 0 })[0], { entry: 7, step: 1 }, 'next inside an entry is its next step')
assert.deepEqual(neighbourPositions(entries, null), [])
assert.equal(neighbourPositions([entries[0]], { entry: 0, step: 0 }).length, 0, 'one step has no neighbour')
assert.equal(neighbourPositions([{ ...entries[0], steps: entries[0].steps.concat(entries[0].steps) }], { entry: 0, step: 0 }).length, 1, 'two steps share one neighbour')

const many = Array.from({ length: 80 }, (_, i) => ({ lon: i, lat: 0 }))
assert.equal(capTargets(many).length, NEXT_VIEW_MAX_TARGETS, 'bounded')
assert.equal(capTargets(many)[0].lon, 0, 'the centre set stays first')

const rest = { msSinceInput: NEXT_VIEW_IDLE_MS, moving: false, inflight: 0, armedForMs: NEXT_VIEW_IDLE_MS }
assert.equal(nextViewReady(rest), true)
assert.equal(nextViewReady({ ...rest, msSinceInput: 100 }), false, 'input just now')
assert.equal(nextViewReady({ ...rest, moving: true }), false, 'a flight is running')
assert.equal(nextViewReady({ ...rest, inflight: 3 }), false, 'the view itself is still loading')
assert.equal(nextViewReady({ ...rest, armedForMs: 200 }), false, 'just arrived')
console.log('next-view-prefetch: ok')
