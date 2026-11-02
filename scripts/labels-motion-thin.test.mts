import assert from 'node:assert/strict'
import { LABELS_MOTION_CAP_DESKTOP, LABELS_MOTION_CAP_PHONE, LABELS_MOTION_REST_MS, motionThinActive, selectMotionCandidates, type MotionThinState } from '../src/labels/motionThin.ts'
import { APPEAR_DELAY_MS, eligible, placePosts, stepLives, type Life, type PostCandidate } from '../src/labels/postLayout.ts'

const candidate = (id: string, tier: 1 | 2 | 3, order: number, extra: Partial<PostCandidate> = {}): PostCandidate => ({
  id, tier, order, base: { x: 100, y: 100 }, dir: { x: 0, y: -1 }, postPx: 20, w: 40, h: 20, nameH: 20, ...extra,
})

// Major and pinned labels stay, with remaining slots filled using placement's shown/tier/order rank.
{
  const shown = new Map([['shown-tier2', 'r1']])
  const candidates = [
    candidate('minor-first', 3, 0), candidate('major-late', 1, 9), candidate('tier2-new', 2, 0),
    candidate('shown-tier2', 2, 100), candidate('tier2-late', 2, 50), candidate('major-first', 1, 0),
    candidate('tapped-minor', 3, 150, { pinned: true }),
  ]
  const chosen = selectMotionCandidates(candidates, 5, shown).map((c) => c.id)
  assert.deepEqual(chosen, ['tapped-minor', 'shown-tier2', 'major-first', 'major-late', 'tier2-new'], 'placement rank favors pinned and shown labels, then major tier and order')
  const mandatory = selectMotionCandidates(candidates, 2, shown).map((c) => c.id)
  assert.deepEqual(mandatory, ['tapped-minor', 'major-first', 'major-late'], 'major and pinned labels remain even if they exceed the cap')
}

// Selection and placement share the motion budget: all mandatory majors above the cap still get a slot.
{
  const candidates = Array.from({ length: 20 }, (_, i) => candidate(`major-${i}`, 1, i, { base: { x: 60 + i * 110, y: 250 } }))
  const selected = selectMotionCandidates(candidates, LABELS_MOTION_CAP_PHONE, new Map())
  assert.equal(selected.length, 20, 'all majors are mandatory even above the phone cap')
  const placed = placePosts(selected, new Map(), [], [], [0, 0, 2400, 600], selected.length)
  assert.equal(placed.size, 20, 'placement does not reapply the motion cap to selected majors')
}

// A label in the tier-2 hysteresis band stays eligible through thinning and returns after motion rests.
{
  const row = candidate('band-label', 2, 0)
  const state: MotionThinState = { lastMovingAt: null }
  const lives = new Map<string, Life>()
  const bounds = [0, 0, 400, 300] as [number, number, number, number]
  const full = placePosts([row], new Map(), [], [], bounds)
  stepLives(lives, full, 0, 16, false, new Set([row.id]))
  stepLives(lives, full, 120, 16, true, new Set([row.id]))
  assert.equal(lives.get(row.id)?.target, 1)
  assert.equal(eligible(2, 2500, 0.5, lives.get(row.id)!.eligible), true, '2500 km is between tier-2 appearance and leave thresholds')

  assert.equal(motionThinActive(state, true, 200), true)
  const thinned = selectMotionCandidates([row], 0, new Map())
  const absent = placePosts(thinned, new Map(), [], [], bounds, thinned.length)
  stepLives(lives, absent, 216, 16, false, new Set([row.id]))
  assert.equal(lives.get(row.id)?.target, 0, 'motion may fade an omitted label')
  assert.equal(lives.get(row.id)?.eligible, true, 'thinning preserves its hysteresis eligibility')

  // Finish the 220 ms fade and continue stepping after the label is fully invisible.
  for (let now = 232; now <= 472; now += 16) stepLives(lives, absent, now, 16, false, new Set([row.id]))
  assert.equal(lives.get(row.id)?.alpha, 0, 'the thinned label completes its fade-out')
  assert.equal(lives.get(row.id)?.eligible, true, 'eligibility remains after the fade record reaches zero opacity')

  assert.equal(motionThinActive(state, false, 200 + LABELS_MOTION_REST_MS + 1), false)
  assert.equal(eligible(2, 2500, 0.5, lives.get(row.id)!.eligible), true)
  const restored = selectMotionCandidates([row], LABELS_MOTION_CAP_PHONE, new Map())
  const placedAgain = placePosts(restored, new Map(), [], [], bounds, restored.length)
  assert.deepEqual(stepLives(lives, placedAgain, 501, 16, false, new Set([row.id])), [row.id], 'the label returns after rest in the hysteresis band')
}

// Issue #256: a collision-blocked newcomer that stays eligible still owes its full appear delay when it is placed again.
{
  const row = candidate('newcomer', 2, 0)
  const ids = new Set([row.id])
  const lives = new Map<string, Life>()
  const bounds = [0, 0, 400, 300] as [number, number, number, number]
  const placed = placePosts([row], new Map(), [], [], bounds)
  assert.equal(placed.size, 1)
  const blocked = placePosts([row], new Map(), [], [[0, 0, 400, 300]], bounds)
  assert.equal(blocked.size, 0, 'the chrome box blocks the newcomer')
  stepLives(lives, placed, 0, 16, false, ids)
  for (let now = 16; now <= 240; now += 16) stepLives(lives, blocked, now, 16, false, ids)
  assert.equal(lives.get(row.id)?.eligible, true, 'blocking keeps hysteresis eligibility')
  assert.deepEqual(stepLives(lives, placed, 256, 16, false, ids), [], 'restored at 256 ms: not visible at once')
  assert.equal(lives.get(row.id)?.alpha, 0)
  for (let now = 272; now < 256 + APPEAR_DELAY_MS; now += 16) stepLives(lives, placed, now, 16, false, ids)
  assert.equal(lives.get(row.id)?.alpha, 0, 'still hidden before 110 ms of continuous placeability')
  assert.deepEqual(stepLives(lives, placed, 256 + APPEAR_DELAY_MS, 16, false, ids), [row.id], 'appears once the delay is served again')
  assert.ok(lives.get(row.id)!.alpha > 0)
}

// The named viewport caps are used by the caller; ordinary candidates never exceed them.
{
  const candidates = Array.from({ length: 80 }, (_, i) => candidate(`label-${i}`, i < 5 ? 1 : (i < 35 ? 2 : 3), i))
  assert.equal(selectMotionCandidates(candidates, LABELS_MOTION_CAP_DESKTOP, new Map()).length, LABELS_MOTION_CAP_DESKTOP)
  assert.equal(selectMotionCandidates(candidates, LABELS_MOTION_CAP_PHONE, new Map()).length, LABELS_MOTION_CAP_PHONE)
  assert.equal(LABELS_MOTION_CAP_DESKTOP, 24)
  assert.equal(LABELS_MOTION_CAP_PHONE, 16)
}

// Motion applies thinning immediately; the full set returns only after the rest delay.
{
  const state: MotionThinState = { lastMovingAt: null }
  assert.equal(motionThinActive(state, false, 0), false, 'rest starts with the full set')
  assert.equal(motionThinActive(state, true, 100), true, 'a gesture thins at once')
  assert.equal(motionThinActive(state, false, 200), true, 'a brief stop stays thin')
  assert.equal(motionThinActive(state, false, 100 + LABELS_MOTION_REST_MS - 1), true)
  assert.equal(motionThinActive(state, false, 100 + LABELS_MOTION_REST_MS), false, '250 ms of rest restores the full set')
  assert.equal(motionThinActive(state, true, 400), true, 'a resumed gesture restarts the delay')
  assert.equal(motionThinActive(state, false, 400 + LABELS_MOTION_REST_MS), false)
}

console.log('labels-motion-thin.test ok')
