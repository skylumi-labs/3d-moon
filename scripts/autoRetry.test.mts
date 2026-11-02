/** The automatic retry of a failed site photograph: schedule and guards (review of PR 88, P1-1). npm test */
import assert from 'node:assert/strict'
import { PATCH_AUTO_RETRY_MS, autoRetryDelay, autoRetryVerdict, type AutoRetryState } from '../src/net/autoRetry.ts'
import { HOTSPOTS } from '../src/hotspots.ts'

assert.deepEqual(PATCH_AUTO_RETRY_MS, [4000, 12000, 30000])
assert.equal(autoRetryDelay(0), 4000); assert.equal(autoRetryDelay(2), 30000); assert.equal(autoRetryDelay(3), null); assert.equal(autoRetryDelay(-1), null)
const ok: AutoRetryState = { shownNeeds: 'a11', siteId: 'a11', patchSiteId: 'a11', patchState: 'failed', online: true, busy: false }
assert.equal(autoRetryVerdict(ok), 'go')
assert.equal(autoRetryVerdict({ ...ok, online: false }), 'wait', 'offline: wait for the online event, no request storm')
assert.equal(autoRetryVerdict({ ...ok, busy: true }), 'wait', 'a drag, a glide or a move is running: never fight it')
assert.equal(autoRetryVerdict({ ...ok, shownNeeds: null }), 'stop', 'the pin is gone')
assert.equal(autoRetryVerdict({ ...ok, shownNeeds: 'a17' }), 'stop', 'another pin is shown')
assert.equal(autoRetryVerdict({ ...ok, patchSiteId: 'a17' }), 'stop', 'another site is loading')
for (const st of ['loading', 'ready', 'idle']) assert.equal(autoRetryVerdict({ ...ok, patchState: st }), 'stop', st)

// Owner rule 2026-10-07: no date or time on the main view. A pin's title, label and caption never carry one.
const dated = /\bUTC\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\b|\b\d{1,2}:\d{2}\b/
for (const h of HOTSPOTS) for (const text of [h.title, h.label, h.caption]) assert.ok(!dated.test(text), `${h.id}: "${text}" carries a date`)
console.log('autoRetry.test ok')
