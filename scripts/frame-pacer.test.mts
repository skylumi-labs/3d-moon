/** FramePacer: hard backpressure. One frame in flight when frames are dear, light frames are not held; never waits; no time release; hidden tab and a stale fence release. */
import assert from 'node:assert/strict'
import { FramePacer, PACER_LIGHT_MS, PACER_STALE_MS, type FenceGl } from '../src/post/framePacer'

const timeouts: number[] = []
const done = new Set<number>()
let deleted = 0, fences = 0
const gl: FenceGl = {
  SYNC_GPU_COMMANDS_COMPLETE: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3,
  fenceSync: () => ({ id: ++fences }), deleteSync: () => { deleted++ }, flush: () => {},
  clientWaitSync: (s, _f, t) => { timeouts.push(t); return done.has((s as { id: number }).id) ? 2 : 4 },
}
const finish = (id: number): void => { done.add(id) }

// dear frames: strictly one in flight
{
  const p = new FramePacer(); p.periodMs = 300
  assert.equal(p.shouldHold(gl, 0), false, 'nothing drawn yet')
  p.drew(gl, 100); assert.equal(p.inFlight, 1)
  assert.equal(p.depth, 1)
  assert.equal(p.shouldHold(gl, 116), true, 'the last frame is still running')
  assert.equal(p.shouldHold(gl, 600), true, 'no time release at 500 ms (the old pacer let go at 80)')
  assert.equal(p.shouldHold(gl, 100 + PACER_STALE_MS - 1), true)
  assert.ok(p.held >= 3, 'held frames counted')
  assert.ok(timeouts.every((t) => t === 0), 'never waits')
  finish(fences); assert.equal(p.shouldHold(gl, 700), false, 'finished: draw the next one'); assert.equal(p.inFlight, 0); assert.ok(deleted >= 1)
}
// light frames are never held while young (the compositor's present queue keeps several in flight)
{
  const p = new FramePacer(); p.periodMs = 10
  for (let i = 0; i < 4; i++) { p.drew(gl, i * 16); if (i >= 1) finish(fences - 1); assert.equal(p.shouldHold(gl, i * 16 + 16), false, `frame ${i + 1} of a light run is not held`) }
  assert.equal(p.held, 0)
  assert.equal(p.shouldHold(gl, 3 * 16 + 120), true, 'but once the oldest is over PACER_OLD_MS the backlog is real')
}
// an old unsignalled fence is dear at once, whatever the history
{
  const p = new FramePacer(); p.periodMs = 17
  p.drew(gl, 0); assert.equal(p.shouldHold(gl, 10), false); assert.equal(p.shouldHold(gl, 120), true, 'one frame 120 ms old and unfinished: strictly one')
}
// the period tracks the frames the pacer watched, and dear frames drop the depth to one
{
  const p = new FramePacer()
  for (let i = 0; i < 6; i++) { p.drew(gl, i * 400); finish(fences); p.shouldHold(gl, i * 400 + 380) }
  assert.ok(p.periodMs > PACER_LIGHT_MS && p.depth === 1, `a 380 ms period is dear (${p.periodMs})`)
}
// a stale fence and a hidden tab release
{
  const p = new FramePacer(); p.periodMs = 300
  p.drew(gl, 1000); assert.equal(p.shouldHold(gl, 1000 + PACER_STALE_MS + 1), false, 'a fence that never signals cannot freeze the picture'); assert.equal(p.inFlight, 0)
  p.drew(gl, 5000); assert.equal(p.shouldHold(gl, 5010, true), false, 'a hidden tab releases at once'); assert.equal(p.inFlight, 0)
}
// a banded rest frame in flight is strict whatever the history: bands go one per signalled fence (review P1-1)
{
  const p = new FramePacer(); p.periodMs = 10
  p.drew(gl, 7000, false, { id: 1 }); assert.equal(p.shouldHold(gl, 7010), true, 'tagged band in flight, light history: held')
  assert.equal(p.shouldHold(gl, 7033), true, 'still held at 33 ms (the age rule alone would let a second and third band through)')
  finish(fences); assert.equal(p.shouldHold(gl, 7040), false, 'signalled: next band goes'); assert.equal(p.finished.length, 1); assert.equal(p.periodMs, 10, 'tagged period does not feed periodMs')
  p.drew(gl, 7100); assert.equal(p.shouldHold(gl, 7110), false, 'an untagged light frame is still not held')
}
// Rest to motion (WP-A, 2026-10-23), `?pace=rest`: rest frames are held like any dear frame, the press that starts a gesture waits for at most the one in flight,
// and gesture frames are never held but keep polling so a rest period is read when it ends, not a gesture later.
{
  const p = new FramePacer()
  // Rest frames: EXACTLY ONE outstanding, from the first one, whatever the history (review item 4: the owner's 500-613 ms frames queued three deep before the motion pacer had 50 ms of history).
  p.drew(gl, 10000); const f1 = fences
  assert.equal(p.shouldHoldRest(gl, 10016, false), true, 'the first rest frame is still running: the next one waits, no history needed')
  assert.equal(p.shouldHoldRest(gl, 10070, false), true)
  finish(f1); assert.equal(p.shouldHoldRest(gl, 10120, false), false, 'signalled: the next one goes'); assert.ok(p.periodMs > PACER_LIGHT_MS, `the rest period is learned (${p.periodMs})`)
  p.drew(gl, 10120); const f2 = fences
  assert.equal(p.shouldHoldRest(gl, 10136, false), true, 'strictly one in flight at once, 16 ms in')
  { const cheap = new FramePacer(); cheap.periodMs = 5; cheap.drew(gl, 1); assert.equal(cheap.shouldHoldRest(gl, 2, false), true, 'a cheap or unknown history does not let a second rest submit through') }
  // The press: still a rest frame in flight, so the press frame waits (gestureOn is false until the loop starts the gesture).
  assert.equal(p.shouldHoldRest(gl, 10200, false), true, 'the press waits for the one frame in flight')
  finish(f2); assert.equal(p.shouldHoldRest(gl, 10240, false), false, 'and goes the moment it signals: at most one rest frame of wait')
  // The gesture: nothing is fenced (the loop does not call drew for gesture frames); a leftover fence is polled, not a hold.
  p.drew(gl, 10240); const f3 = fences // the last rest frame before the gesture, say
  assert.equal(p.shouldHoldRest(gl, 10300, true), false, 'a gesture frame is never held')
  const heldBefore = p.held
  assert.equal(p.shouldHoldRest(gl, 10400, true), false); assert.equal(p.held, heldBefore, 'polling counts no hold')
  finish(f3); p.shouldHoldRest(gl, 10420, true)
  assert.equal(p.inFlight, 0, 'the fence was drained during the gesture')
  assert.ok(p.periodMs < 200, `a fence seen during the gesture reads its own period (180), not the whole gesture (${p.periodMs})`)
  // A stale fence is dropped by the poll too.
  p.drew(gl, 20000); p.shouldHoldRest(gl, 20000 + PACER_STALE_MS + 1, true); assert.equal(p.inFlight, 0)
}
console.log('frame-pacer: ok')
