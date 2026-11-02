/**
 * The offline line's decision: shown only when the browser is offline AND the data host failed.
 *   node --import tsx scripts/offline-state.test.mts
 */
import assert from 'node:assert/strict'
import { OFFLINE_TEXT, offlineNoteVisible, type OfflineInputs } from '../src/net/offlineState.ts'

const base: OfflineInputs = { hasTileBase: true, online: false, tilesFailed: false, manifestFailed: false }
assert.equal(offlineNoteVisible(base), false, 'offline but nothing has failed: nothing is broken, nothing is said')
assert.equal(offlineNoteVisible({ ...base, tilesFailed: true }), true)
assert.equal(offlineNoteVisible({ ...base, manifestFailed: true }), true)
assert.equal(offlineNoteVisible({ ...base, tilesFailed: true, online: true }), false, 'online: the existing retry captions cover a bad host')
assert.equal(offlineNoteVisible({ ...base, manifestFailed: true, online: true }), false)
assert.equal(offlineNoteVisible({ hasTileBase: false, online: false, tilesFailed: true, manifestFailed: true }), false, 'no tile base: nothing to lose')
// Back online clears it.
assert.equal(offlineNoteVisible({ ...base, tilesFailed: true, online: true, manifestFailed: true }), false)
// Honest wording: says what is shown and when detail returns, no resolution or coverage claim.
assert.match(OFFLINE_TEXT, /^Offline: showing the built-in Moon\./)
assert.doesNotMatch(OFFLINE_TEXT, /\d/)
console.log('offline-state ok')
