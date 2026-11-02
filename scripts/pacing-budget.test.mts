// F7: a 120 Hz display is paced at 60 Hz-equivalent when its native budget is unreachable, instead of collapsing the grid to 0.25.
// F8a/F8c: one GPU_DISJOINT read (it clears the flag) drops every query submitted before it, and frames skipped for a full queue are counted.
import assert from 'node:assert/strict'
import { EMPTY_REST_COST, MOTION_COST_MEMORY_MS, MOTION_STEPS, PacingBudget, parsePaceMode, frameBudgetMs, ladderStep, predictMs, restCostFloor, setFixedShare, slowBudgetMs, startFromCost, startFromCostPlan, startScale } from '../src/post/motionGrid.ts'
import { GpuTimer } from '../src/post/gpuTimer.ts'

/** The ladder run to rest on a steady cost (ms at grid 1), with a budget policy; returns the grid it settles on and the number of moves. */
function settle(cost1: number, hz: number, policy: 'native' | 'pacing'): { grid: number; moves: number } {
  const pb = new PacingBudget()
  const budgetAt = (cur: number): number => (policy === 'native' ? frameBudgetMs(hz) : pb.get(hz, predictMs(cost1, 1, cur), cur))
  let cur = startScale(cost1, policy === 'native' ? frameBudgetMs(hz) : pb.get(hz, cost1, 1), 0.5), moves = 0
  for (let f = 0; f < 600; f++) {
    const nxt = ladderStep(predictMs(cost1, 1, cur), cur, 99, budgetAt(cur))
    if (nxt !== null) { cur = nxt; moves++ }
  }
  return { grid: cur, moves }
}

{
  // Regression (#96): a 60 Hz display must keep native cadence by lowering the grid, not drop to the 30 Hz tier.
  // cost at grid 0.5 of 16 ms: 0.35 predicts 7.8 ms, inside FIT * 16.7.
  assert.equal(new PacingBudget().get(60, 16, 0.5), frameBudgetMs(60), '60 Hz: 16 ms at 0.5 stays native (grid 0.35 fits)')
  assert.equal(new PacingBudget().get(60, 40, 0.5), frameBudgetMs(60), '60 Hz: 40 ms at 0.5 stays native (0.25 predicts 10 ms)')
  { const pb = new PacingBudget(); pb.get(60, 40, 0.5); assert.equal(pb.currentTier, 0); assert.equal(pb.holdFrame(1), false) }
  // 30 Hz only as a last resort: even the 0.25 grid is predicted over FIT * 16.7 (14.2 ms): ms at 0.5 above 56.8.
  assert.equal(new PacingBudget().get(60, 70, 0.5), slowBudgetMs(60, 30), '60 Hz: 0.25 cannot fit, 30 Hz as last resort')
  assert.equal(new PacingBudget().get(60, 55, 0.5), frameBudgetMs(60))
  // 120 Hz: grid first (0.35 fits 8.3 ms until 1 ms * ... ), then 60 Hz, then 30 Hz.
  assert.equal(new PacingBudget().get(120, 8, 0.5), frameBudgetMs(120), '120 Hz: 8 ms at 0.5 -> 0.35 predicts 3.9 ms, native')
  assert.equal(new PacingBudget().get(120, 16, 0.5), slowBudgetMs(120, 60), '120 Hz: 0.35 predicts 7.84 > 7.08, steady 60 Hz')
  assert.equal(new PacingBudget().get(120, 50, 0.5), slowBudgetMs(120, 60), '120 Hz: 60 Hz tier still fits with the lowest grid (12.5 ms)')
  assert.equal(new PacingBudget().get(120, 160, 0.5), slowBudgetMs(120, 30), '120 Hz: 30 Hz last resort')
  // Hysteresis out of 30 Hz on a 60 Hz display.
  { const pb = new PacingBudget(); pb.get(60, 70, 0.5); assert.equal(pb.currentTier, 2)
    pb.get(60, 50, 0.5); assert.equal(pb.currentTier, 2, 'no flap just inside the entry threshold')
    pb.get(60, 30, 0.5); assert.equal(pb.currentTier, 0, 'recovers when 0.25 is well inside native') }
  // No measurement leaves the previous/native choice unchanged.
  assert.equal(new PacingBudget().get(30, 500, 0.5), frameBudgetMs(30))
  assert.equal(new PacingBudget().get(120, 0, 0.5), frameBudgetMs(120), 'no measurement: native')
  // URL switch.
  assert.equal(parsePaceMode('off'), 'off'); assert.equal(parsePaceMode('bogus'), 'auto'); assert.equal(parsePaceMode(null), 'auto')
  assert.equal(new PacingBudget('off').get(120, 500, 0.5), frameBudgetMs(120))
  { const pb = new PacingBudget('30'); assert.equal(pb.get(60, 1, 0.5), slowBudgetMs(60, 30)); assert.equal(pb.cadenceHz, 30) }
  // The settled grid on a 60 Hz display keeps native cadence for the same GPU that used to be paced at 30 Hz.
  const r = settle(40 / (0.5 * 0.5), 60, 'pacing')
  assert.ok(r.grid >= 0.25 && r.grid <= 0.5 && r.moves <= 4, 'settles on a lowered grid')
  assert.equal(new PacingBudget().get(60, predictMs(160, 1, r.grid), r.grid), frameBudgetMs(60), 'and stays native')
  for (const cost of [8, 20, 48, 90, 200]) for (const hz of [30, 60, 90, 120, 144]) {
    const q = settle(cost, hz, 'pacing')
    assert.ok(MOTION_STEPS.includes(q.grid) && q.moves <= 4, `settles (cost ${cost}, ${hz} Hz)`)
  }
}

// S2: both fallback budgets are whole vsync multiples and land at or below the target cadence.
for (const target of [60, 30]) for (const hz of [30, 60, 90, 100, 120, 144, 165, 240]) {
  const native = 1000 / hz, slow = slowBudgetMs(hz, target)
  const n = slow / native
  assert.ok(Math.abs(n - Math.round(n)) < 1e-9 && n >= 1, `${hz} Hz: ${target} tier is ${n} vsyncs`)
  assert.ok(slow >= 1000 / target - 0.5 * native && slow <= 1000 / target + native, `${hz} Hz: near ${target} fps (${slow.toFixed(2)} ms)`)
}
assert.equal(Math.round(slowBudgetMs(120, 60) / (1000 / 120)), 2)
assert.equal(Math.round(slowBudgetMs(144, 60) / (1000 / 144)), 3)
assert.equal(Math.round(slowBudgetMs(120, 30) / (1000 / 120)), 4)

// S1: selected cadence skips whole vsyncs and never alternates irregular gaps.
function cadence(hz: number, target: number): number[] {
  const pb = new PacingBudget()
  pb.get(hz, 1000, 1) // a cost not even the lowest grid fits at native or 60 Hz: 30Hz tier
  assert.equal(pb.isSlow, true)
  assert.equal(pb.cadenceHz, target)
  const draws: number[] = []
  const v = 1000 / hz
  for (let i = 0; i < 120; i++) {
    const now = i * v + (i % 3) * 0.2 // a little rAF timestamp jitter
    if (!pb.holdFrame(now)) { pb.drew(now); draws.push(now) }
  }
  return draws.slice(1).map((t, i) => Math.round((t - draws[i]) / v))
}
for (const [hz, vs] of [[120, 4], [90, 3], [144, 5], [165, 6]] as const) {
  const gaps = cadence(hz, 30)
  assert.ok(gaps.length > 10 && gaps.every((g) => g === vs), `${hz} Hz draws every ${vs} vsyncs (got ${[...new Set(gaps)].join(',')})`)
}
{
  const pb = new PacingBudget()
  assert.equal(pb.holdFrame(0), false, 'native pacing never holds a frame')
  pb.drew(0)
  assert.equal(pb.holdFrame(1), false)
  // S3: a change of display rate starts the choice afresh.
  pb.get(120, 1000, 1)
  assert.equal(pb.isSlow, true)
  pb.get(60, 1000, 1)
  assert.equal(pb.isSlow, true, 'a 60 Hz display can still fall back to 30Hz cadence')
}

// A fake GL whose timer queries finish in order and whose GPU_DISJOINT flag clears when read.
function fakeGl(results: number[], disjointAt: number) {
  let reads = 0, nextQ = 0, disjoint = false, created = 0
  const gl = {
    TIMEOUT_EXPIRED: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3, WAIT_FAILED: 4,
    SYNC_GPU_COMMANDS_COMPLETE: 0, QUERY_RESULT_AVAILABLE: 10, QUERY_RESULT: 11,
    getExtension: () => ({ TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 }),
    createQuery: () => ({ i: created++ }), beginQuery: () => {}, endQuery: () => {}, deleteQuery: () => {},
    fenceSync: () => ({}), flush: () => {}, clientWaitSync: () => 2, deleteSync: () => {},
    getParameter: () => { const d = disjoint; disjoint = false; reads++; return d },
    getQueryParameter: (q: { i: number }, what: number) => (what === 10 ? true : results[q.i]! * 1e6),
  }
  return { gl: gl as unknown as WebGL2RenderingContext, trip: () => { disjoint = true }, reads: () => reads, nextQ: () => nextQ++, disjointAt }
}
{
  // F8a: three frames in flight when a disjoint event happens; the flag is read once, at the first poll. All three are dropped.
  const f = fakeGl([5, 5, 5, 5], 0)
  const t = new GpuTimer(f.gl, true)
  for (let i = 0; i < 3; i++) { t.begin(i); t.end() }
  f.trip()
  t.poll(50)
  assert.equal(t.fresh, 0, 'every query submitted before the disjoint read is dropped, not just the first')
  t.begin(60); t.end(); t.poll(70)
  assert.equal(t.fresh, 1, 'a frame after the event is kept')
  assert.equal(t.stats().gpuMsP50, 5)
  // F8c: a full queue skips frames and says so.
  const g = fakeGl(Array(20).fill(5), 0)
  const u = new GpuTimer({ ...(g.gl as object), clientWaitSync: () => 2 } as unknown as WebGL2RenderingContext, true)
  for (let i = 0; i < 12; i++) { u.begin(i); u.end() }
  assert.ok(u.stats().dropped > 0, 'skipped frames are counted')
  assert.equal(new GpuTimer(f.gl, true).stats().dropped, 0)
  // A dropped (bad) tagged frame does not write -1 into taggedMs.
  const h = fakeGl([7, 5], 0)
  const w = new GpuTimer(h.gl, true)
  w.begin(0, true); w.end(); w.poll(10)
  assert.equal(w.taggedMs, 7)
  w.begin(20, true); w.end(); h.trip(); w.poll(30)
  assert.equal(w.taggedMs, 7, 'a dropped tagged frame keeps the last good taggedMs')
  assert.ok(w.taggedDoneAt === 30)
}
console.log('pacing-budget ok')

// Quality selection retains a measured grid across gesture resets, but never
// admits a disjoint/old-epoch query as evidence for full-resolution motion.
{
  const f = fakeGl([10, 4, 3, 2], 0)
  const t = new GpuTimer(f.gl, true)
  t.begin(0, false, 1); t.end(); t.poll(16)
  assert.deepEqual(t.fullFrame, {ms: 10, scale: 1, at: 16})
  t.reset()
  assert.deepEqual(t.latestSample, {ms: 10, scale: 1, at: 16}, 'reset keeps the measured grid and cost')
  t.begin(20, false, 0.35); t.end(); t.poll(30)
  assert.deepEqual(t.latestSample, {ms: 4, scale: 0.35, at: 30})
  t.begin(40, false, 1); t.end(); f.trip(); t.poll(50)
  assert.equal(t.fullFrame?.ms, 10, 'disjoint full frame cannot authorize full quality')
  t.begin(60, false, 1); t.end(); t.reset(); t.poll(70)
  assert.equal(t.fullFrame?.ms, 10, 'old epoch cannot authorize full quality')
}
{
  const f = fakeGl([], 0)
  const t = new GpuTimer(f.gl, true, true)
  t.begin(100, false, 1); t.end(); t.poll(116)
  assert.deepEqual(t.fullFrame, {ms: 16, scale: 1, at: 116}, 'unqueued fence can estimate full-frame recovery cost')
  assert.deepEqual(t.drainPeriods(), [], 'rest frames do not accumulate in the motion-only period queue')
  t.begin(120, false, 0.35); t.end(); t.poll(136)
  assert.deepEqual(t.drainPeriods(), [{scale: 0.35, ms: 16, ctx: 0}])
}

// Rest to motion (WP-A, 2026-10-23), `?motionstart=cost`: the gesture starts from measured cost. The last gesture's live-march motion cost wins; the cached rest
// frame's cost (times an estimate factor) is the fallback; cached-rest and live-motion numbers are never mixed into one.
{
  setFixedShare(0)
  const budget60 = 16.67
  // The owner's drag: 34 ms (a floor: the Metal query under-reads) on the 0.7 grid; at 60 Hz 0.5 is predicted 17.3 (over 0.85 x 16.7), 0.35 fits.
  assert.equal(startFromCost({ ms: 34, scale: 0.7, at: 1000 }, 117, 1, 2000, budget60, 0.7), 0.35)
  // On the rig: 9 ms at 0.7 fits the next grid; the cap stays at the default max (0.7).
  assert.equal(startFromCost({ ms: 9, scale: 0.7, at: 1000 }, 117, 1, 2000, budget60, 0.5), 0.7)
  assert.equal(startFromCost({ ms: 9, scale: 0.7, at: 1000 }, 117, 1, 2000, budget60, 0.5, 0.5), 0.5, 'never above maxScale')
  // No motion cost yet (the first gesture, or one older than the memory): the rest frame's cost scaled by the factor; 117 ms at full size says 0.25 at 60 Hz, 0.35 with the factor 0.5.
  assert.equal(startFromCost(null, 117, 1, 2000, budget60, 0.7), 0.25)
  assert.equal(startFromCost(null, 117, 0.5, 2000, budget60, 0.7), 0.35)
  assert.equal(startFromCost({ ms: 9, scale: 0.7, at: 1000 }, 117, 1, 1000 + 60001, budget60, 0.7, 0.7, 60000), 0.25, 'a motion cost older than the memory is not evidence; the rest cost is')
  assert.equal(startFromCost(null, 0, 1, 2000, budget60, 0.5), 0.5, 'nothing measured: the class start')
  assert.equal(startFromCost({ ms: 0, scale: 0.7, at: 1000 }, 0, 1, 2000, budget60, 0.5), 0.5, 'a zero reading is no reading')
  // The pacing tier at that cost: 117 ms at full size on a 120 Hz display is over even the 30 Hz floor's budget at 0.25... the tier logic is pacing's; here the budget is given.
  assert.equal(startFromCost({ ms: 34, scale: 0.7, at: 1000 }, 117, 1, 2000, 33.3, 0.7), 0.5, 'with the 30 Hz tier budget the same drag fits 0.5 (0.7 is 34 over 28.3)')
  // Rest cost floor: the dearer of the fenced rest period and the hand-back's wall-priced model, 0 with neither (so a phone, which learns neither, reads fullCostMs as before).
  assert.equal(restCostFloor(0, EMPTY_REST_COST), 0)
  assert.equal(restCostFloor(80, EMPTY_REST_COST), 80)
  assert.equal(restCostFloor(0, { c0: 117, holey: null }), 117)
  assert.equal(restCostFloor(0, { c0: NaN, holey: { ms: 79, unmet: 3 } }), 79)
  assert.equal(restCostFloor(60, { c0: 117, holey: { ms: 130, unmet: 3 } }), 130, 'the dearest reading')
  // Review item 6: the whole decision with a real PacingBudget on a 120 Hz display. The cached rest fallback never re-tiers (a 613 ms rest frame would put the
  // display on the 30 Hz cadence for a gesture whose frames cost 5 ms); an accepted motion sample sets the tier and the grid from the same measurement, validated once.
  const hz = 120, base = frameBudgetMs(hz)
  {
    const pacing = new PacingBudget()
    const r = startFromCostPlan(null, 613, 1 / 3, 2000, pacing, hz, base, 0.7, 0.7)
    assert.equal(r.used, 'rest'); assert.equal(r.budget, base, 'the base budget'); assert.equal(pacing.currentTier, 0, 'the rest fallback did not touch the tier')
    assert.equal(r.scale, 0.25, '613 / 3 = 204 ms at full size against 8.3 ms: the coarsest grid')
    assert.equal(startFromCostPlan(null, 613, 1 / 3, 2000, pacing, 60, frameBudgetMs(60), 0.7, 0.7).scale, 0.25, 'and at 60 Hz (204 x 0.35^2 = 25 > 14)')
    assert.equal(startFromCostPlan(null, 117, 1 / 3, 2000, pacing, 60, frameBudgetMs(60), 0.7, 0.7).scale, 0.5, 'a 117 ms rest frame with the shader factor: 0.5 at 60 Hz')
  }
  {
    const pacing = new PacingBudget()
    const r = startFromCostPlan({ ms: 34, scale: 0.7, at: 1000 }, 613, 1 / 3, 2000, pacing, hz, base, 0.7, 0.7)
    assert.equal(r.used, 'motion'); assert.ok(pacing.currentTier > 0, 'a 34 ms motion frame at 0.7 on 120 Hz: the tier dropped'); assert.ok(r.budget > base)
    assert.equal(r.scale, fitScale34(r.budget), 'the grid fits the same budget the tier gave')
    const stale = startFromCostPlan({ ms: 34, scale: 0.7, at: 1000 }, 613, 1 / 3, 1000 + MOTION_COST_MEMORY_MS + 1, new PacingBudget(), hz, base, 0.7, 0.7)
    assert.equal(stale.used, 'rest', 'a motion cost older than the memory is validated away once, for both decisions')
    const none = startFromCostPlan(null, 0, 1 / 3, 2000, new PacingBudget(), hz, base, 0.5, 0.7)
    assert.deepEqual(none, { scale: 0.5, budget: base, used: 'none' })
  }
  function fitScale34(budget: number): number { for (const s of [0.7, 0.5, 0.35, 0.25]) if (predictMs(34, 0.7, s) <= 0.85 * budget) return s; return 0.25 }
  console.log('start from cost: ok')
}
