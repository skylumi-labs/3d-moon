/** Resume diagnostics (src/loop/resume.ts) and the frame-loop guard (src/loop/guard.ts): pure decisions. */
import assert from 'node:assert/strict'
import { FRAME_STALE_MS, classifyResume, exposureUsable, moonDiscOnScreen, type ResumeInfo } from '../src/loop/resume.ts'
import { LOOP_ERROR_REPORTS, LOOP_RETRY_MAX_MS, loopErrorCountAfter, loopErrorPlan, loopRetryAction, lossEventIsDuplicate } from '../src/loop/guard.ts'
import { buildResumeBlank, payloadIsClean } from '../src/telemetry/events.ts'

const D = Math.PI / 180
const ok: ResumeInfo = {
  contextLosses: 0, contextRestores: 0, contextLost: false, glLost: false, hiddenMs: 30_000, camDist: 3, moonOnScreen: true,
  exposureWhite: 0.5, exposureHdr: 0.2, loopRunning: true, idleSleeping: false, lastFrameAgeMs: 16, visible: true,
}

// ---- the Moon's disc on screen: 30 deg field (tanHalf of 15 deg), phone aspect
const tanHalf = Math.tan(15 * D), aspect = 9 / 19.5
assert.equal(moonDiscOnScreen(0, 12, tanHalf, aspect), true, 'centred at the far limit')
assert.equal(moonDiscOnScreen(90 * D, 12, tanHalf, aspect), false, 'looking at the horizon from the far limit: the black canvas')
assert.equal(moonDiscOnScreen(22 * D, 12, tanHalf, aspect), false, '22 deg off-axis, disc radius 4.8 deg, half diagonal 16.4 deg')
assert.equal(moonDiscOnScreen(21 * D, 12, tanHalf, aspect), true, 'the disc edge reaches the corner')
assert.equal(moonDiscOnScreen(90 * D, 1, tanHalf, aspect), true, 'looking at the horizon from the ground: the Moon fills the lower frame')
assert.equal(moonDiscOnScreen(NaN, 3, tanHalf, aspect), false)
assert.equal(moonDiscOnScreen(0, 0, tanHalf, aspect), false)

// ---- exposure
assert.equal(exposureUsable(0.5, 0.2), true)
assert.equal(exposureUsable(null, null), true)
for (const w of [NaN, Infinity, 0, -1, 1e-9, 1e6]) assert.equal(exposureUsable(w, 0), false, String(w))
assert.equal(exposureUsable(0.5, NaN), false)

// ---- classification
assert.deepEqual(classifyResume(ok), { blank: false, reasons: [] })
const reasons = (o: Partial<ResumeInfo>): string[] => classifyResume({ ...ok, ...o }).reasons
assert.deepEqual(reasons({ moonOnScreen: false }), ['moon-off-screen'])
assert.deepEqual(reasons({ glLost: true }), ['context-lost-unnoticed'], 'the page never heard of the loss')
assert.deepEqual(reasons({ glLost: true, contextLost: true, loopRunning: false, moonOnScreen: null }), ['context-lost'])
assert.deepEqual(reasons({ loopRunning: false }), ['loop-stopped'])
assert.deepEqual(reasons({ loopRunning: false, idleSleeping: true }), [], 'a deliberate sleep is not a stall')
assert.deepEqual(reasons({ lastFrameAgeMs: FRAME_STALE_MS + 1 }), ['frame-stale'])
assert.deepEqual(reasons({ lastFrameAgeMs: FRAME_STALE_MS + 1, idleSleeping: true }), [])
assert.deepEqual(reasons({ exposureWhite: NaN }), ['exposure-invalid'])
assert.deepEqual(reasons({ moonOnScreen: false, loopRunning: false }), ['loop-stopped', 'moon-off-screen'])
// the owner's case: the loop and the context are fine, the camera is at the far limit and the Moon is out of frame
assert.deepEqual(reasons({ camDist: 12, moonOnScreen: false }), ['moon-off-screen'])
// not a resume: still hidden, or hidden for a moment
assert.equal(classifyResume({ ...ok, visible: false, glLost: true }).blank, false)
assert.equal(classifyResume({ ...ok, hiddenMs: 200, moonOnScreen: false }).blank, false)

// ---- telemetry payload: no free text, no pose, clean
const p = buildResumeBlank({ ...ok, camDist: 12.04, exposureWhite: 0.123456, hiddenMs: 400_000, lastFrameAgeMs: 7000, moonOnScreen: false }, ['moon-off-screen', 'loop-stopped'], 2)
assert.ok(payloadIsClean(p))
assert.equal(p.reasons, 'moon-off-screen+loop-stopped')
assert.equal(p.hidden_bucket, 'm5_15')
assert.equal(p.cam_dist_radii, 12)
assert.equal(p.exposure_white, 0.12)
assert.equal(p.last_frame_age_bucket, 's5_30')
assert.equal(p.moon_on_screen, false)
assert.equal(buildResumeBlank({ ...ok, camDist: null, lastFrameAgeMs: null, exposureWhite: null }, [], 0).last_frame_age_bucket, null)

// ---- the loop guard: a throw is reported a few times, retried with a growing delay, and a good tick resets the run
assert.deepEqual(loopErrorPlan(1), { rethrow: true, retryMs: 250 })
assert.equal(loopErrorPlan(LOOP_ERROR_REPORTS).rethrow, true)
assert.equal(loopErrorPlan(LOOP_ERROR_REPORTS + 1).rethrow, false)
assert.equal(loopErrorPlan(1000).retryMs, LOOP_RETRY_MAX_MS)
assert.equal(loopErrorCountAfter(loopErrorCountAfter(0, true), true), 2)
assert.equal(loopErrorCountAfter(5, false), 0)
// ---- a throw while the context is lost parks the loop (so the restore restarts it); a repeated loss event is not counted twice
assert.equal(loopRetryAction(false), 'frame')
assert.equal(loopRetryAction(true), 'park')
assert.equal(lossEventIsDuplicate(false, false), false, 'first announcement')
assert.equal(lossEventIsDuplicate(true, false), true, 'late real event after the synthetic one')
assert.equal(lossEventIsDuplicate(true, true), false, 'a new loss during a soft recovery')
console.log('resume.test: ok')
