/**
 * GroundBudget (`?groundbudget=1`, src/ground/groundBudget.ts): the ground's own record of the motion grid that last fit the frame budget. Fed only with
 * ground frames; a grid over budget twice running is given up for the step below, a grid calm for 14 frames is kept and the step above tried only when
 * this grid's own cost, scaled by the pixel count, still fits; nothing learned (or learned too long ago) leaves the Moon pass's choice alone.
 * Also the switch parser the GroundMode constructor reads.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CALM_FRAMES, GroundBudget, MEMORY_MS, OVER_FRAMES, groundSwitches } from '../src/ground/groundBudget.ts'
import { MOTION_STEPS } from '../src/post/motionGrid.ts'

const B = 1000 / 60
{
  const g = new GroundBudget()
  assert.equal(g.start(0.5, 1, 0), 0.5, 'nothing learned: the fallback')
  // Over budget on 0.7, twice running: the next gesture starts on 0.5.
  g.observe(0.7, 25, B, 100)
  assert.equal(g.start(0.5, 1, 100), 0.5, 'one slow frame is not evidence')
  g.observe(0.7, 24, B, 116)
  assert.equal(g.start(0.7, 1, 120), 0.5, 'two slow frames: one step down, below the fallback')
  // Calm on 0.5 for 14 frames at 6 ms: 0.7 is predicted at 6 x 1.96 = 11.8 ms, inside 80 % of the budget, so the next gesture starts on 0.7.
  for (let i = 0; i < CALM_FRAMES; i++) g.observe(0.5, 6, B, 200 + i)
  assert.equal(g.start(0.35, 1, 300), 0.7, 'a calm grid promotes the step above when its scaled cost fits')
  assert.equal(g.start(0.35, 0.5, 300), 0.5, 'capped at max')
  // Calm on 0.7 at 10 ms: 1.0 is predicted at 20.4 ms, over the budget, so 0.7 is kept.
  for (let i = 0; i < CALM_FRAMES; i++) g.observe(0.7, 10, B, 400 + i)
  assert.equal(g.start(0.35, 1, 500), 0.7, 'the step above is not tried when its scaled cost does not fit')
  // A slow spell interrupts a calm count; the count restarts on a new grid.
  for (let i = 0; i < CALM_FRAMES - 1; i++) g.observe(0.7, 10, B, 600 + i)
  g.observe(0.7, 30, B, 620)
  for (let i = 0; i < CALM_FRAMES - 1; i++) g.observe(0.7, 10, B, 630 + i)
  assert.equal(g.start(0.35, 1, 700), 0.7)
  // Never below the coarsest grid.
  for (let i = 0; i < OVER_FRAMES; i++) g.observe(MOTION_STEPS[0], 40, B, 800 + i)
  assert.equal(g.start(0.5, 1, 900), MOTION_STEPS[0])
  // Evidence expires.
  assert.equal(g.start(0.5, 1, 900 + MEMORY_MS + 1), 0.5, 'a minute later the Moon pass chooses again')
  // Unknown grids and bad periods are ignored.
  g.observe(0.6, 1, B, 1000); g.observe(0.5, NaN, B, 1000); g.observe(0.5, 0, B, 1000)
  const s = g.snapshot()
  assert.deepEqual(Object.keys(s.obs).sort(), ['0.25', '0.5', '0.7'])
  assert.equal(s.obs['0.5'], 6)
  // Expire, then resume: the first observation after the memory starts from nothing, so a stale median, the learned grid and the streaks do not come back.
  g.observe(0.5, 6, B, 1000 + MEMORY_MS + 1)
  assert.equal(g.start(0.7, 1, 1000 + MEMORY_MS + 2), 0.7, 'the old 0.25 did not resurrect')
  assert.deepEqual(g.snapshot(), { affordable: null, obs: { '0.5': 6 } }, 'only the new frame is on record')
  for (let i = 0; i < CALM_FRAMES - 2; i++) g.observe(0.5, 6, B, 1100 + MEMORY_MS + i)
  assert.equal(g.start(0.35, 1, 1200 + MEMORY_MS), 0.35, 'the calm streak restarted at the resume: 13 frames are not yet 14')
  g.observe(0.5, 6, B, 1200 + MEMORY_MS)
  assert.equal(g.start(0.35, 1, 1201 + MEMORY_MS), 0.7, 'the 14th promotes')
}
{
  // One slow rest frame on 1.0 and one slow gesture frame on 0.5 are not two slow frames: the over streak is per grid, as the calm streak is.
  const g = new GroundBudget()
  g.observe(1, 30, B, 0); g.observe(0.5, 30, B, 16)
  assert.equal(g.start(0.5, 1, 20), 0.5, 'no step down after one slow frame on each grid')
  g.observe(0.5, 30, B, 32)
  assert.equal(g.start(0.5, 1, 40), 0.35, 'two on the same grid step down')
}
// The switches: each is one thing.
assert.deepEqual(groundSwitches(''), { asyncProbe: false, budget: false, refit: false })
assert.deepEqual(groundSwitches('?gprobe=async&groundbudget=1&grefit=1'), { asyncProbe: true, budget: true, refit: true })
assert.deepEqual(groundSwitches('?gprobe=sync&groundbudget=0&grefit=0'), { asyncProbe: false, budget: false, refit: false })
// Behaviour (review): samples are consumed once, tagged with the grid and context they were SUBMITTED in; orbit samples are dropped; a forced scale
// and a null budget (switch off) leave the budget untouched.
{
  const { GpuTimer } = await import('../src/post/gpuTimer.ts')
  const { foldGroundSamples } = await import('../src/ground/groundBudget.ts')
  let nextMs = 0, fences = 0
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3, TIMEOUT_EXPIRED: 4, WAIT_FAILED: 5, TIME_ELAPSED_EXT: 6, GPU_DISJOINT_EXT: 7, QUERY_RESULT_AVAILABLE: 8, QUERY_RESULT: 9,
    getExtension: () => ({ TIME_ELAPSED_EXT: 6, GPU_DISJOINT_EXT: 7 }), createQuery: () => ({ ms: nextMs }), beginQuery: () => {}, endQuery: () => {}, deleteQuery: () => {},
    fenceSync: () => ({ id: ++fences }), flush: () => {}, deleteSync: () => {}, clientWaitSync: () => 2, getParameter: () => false,
    getQueryParameter: (q: { ms: number }, what: number) => (what === 8 ? true : q.ms * 1e6),
  }
  let now = 0
  const frame = (t: GpuTimerLike, scale: number, ctx: number, ms: number): void => { nextMs = ms; t.begin(now, false, scale, ctx); t.end(); now += ms + 3; t.poll(now) }
  type GpuTimerLike = InstanceType<typeof GpuTimer>
  const budgetMs = 16.67
  const newTimer = (): GpuTimerLike => new GpuTimer(gl as never, true, false)
  {
    // Repeated reads of the same measurement do not exist: each is drained once, and a drain with nothing new is empty (the smoothed time stays, the count does not).
    const t = newTimer(), b = new GroundBudget()
    frame(t, 0.5, 1, 30)
    assert.equal(t.fresh, 1)
    assert.equal(foldGroundSamples(b, t.drainSamples(), budgetMs, 1000), 1)
    for (let i = 0; i < 5; i++) assert.equal(foldGroundSamples(b, t.drainSamples(), budgetMs, 1000), 0, 'nothing new: nothing counted')
    assert.equal(b.snapshot().affordable, null, 'one slow frame is not OVER_FRAMES')
    frame(t, 0.5, 1, 30)
    foldGroundSamples(b, t.drainSamples(), budgetMs, 1000)
    assert.notEqual(b.snapshot().affordable, null, 'two real slow frames step down')
  }
  {
    // An orbit sample landing after the switch to ground (submitted with ctx 0) is dropped, and the ground sample submitted after it is counted on its own grid.
    const t = newTimer(), b = new GroundBudget()
    frame(t, 0.7, 0, 40); frame(t, 0.7, 0, 40); frame(t, 0.7, 0, 40)
    const orbit = t.drainSamples()
    assert.equal(orbit.length, 3); assert.ok(orbit.every((x) => x.ctx === 0 && x.scale === 0.7))
    assert.equal(foldGroundSamples(b, orbit, budgetMs, 1000), 0, 'orbit samples are not ground evidence')
    assert.equal(b.snapshot().affordable, null); assert.deepEqual(b.snapshot().obs, {})
    frame(t, 0.35, 1, 5)
    const g = t.drainSamples()
    assert.deepEqual(g.map((x) => [x.scale, x.ctx]), [[0.35, 1]])
    foldGroundSamples(b, g, budgetMs, 1000)
    assert.deepEqual(Object.keys(b.snapshot().obs), ['0.35'])
  }
  {
    // A forced motion scale begins frames with scale 0 (main.ts): no sample at all. A reset (new gesture, new grid) discards what was not drained.
    const t = newTimer()
    frame(t, 0, 1, 30)
    assert.equal(t.drainSamples().length, 0, 'forced scale: nothing recorded')
    frame(t, 0.5, 1, 30); t.reset()
    assert.equal(t.drainSamples().length, 0, 'a reset forgets old-grid samples')
  }
  {
    // Switch off: no budget, no effect and no throw.
    assert.equal(foldGroundSamples(null, [{ scale: 0.5, ms: 99, ctx: 1 }], budgetMs), 0)
    assert.equal(foldGroundSamples(undefined, [{ scale: 0.5, ms: 99, ctx: 1 }], budgetMs), 0)
  }
}
// Wiring order in main.ts (the only part pinned as source): the start follows the START_CAP line, never over a forced scale; the fold feeds the one function.
{
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(main, /if \(!FORCED_MOTION_SCALE && groundMode\?\.active && groundMode\.budget\) motionScale = groundMode\.budget\.start\(motionScale, maxMotionScale\)/, 'gesture start')
  assert.ok(main.indexOf('groundMode.budget.start(') > main.indexOf('START_CAP_ON) motionScale = Math.min'), 'after the START_CAP line')
  assert.match(main, /foldGroundSamples\(groundMode\?\.budget, periods, budget\)/); assert.match(main, /foldGroundSamples\(groundMode\?\.budget, gpuTimer\.drainSamples\(\), budget\)/)
  assert.match(main, /gpuTimer\.begin\(now, [^\n]*groundMode\?\.active \? 1 : 0\)/, 'the context is taken at submit')
  assert.match(main, /groundBudget: groundMode\?\.budget\?\.snapshot\(\) \?\? null/, 'perf snapshot')
}
console.log('ground-motion-budget: ok')
