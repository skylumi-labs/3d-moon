/** FenceGrid (S3): the fence-source period model with an intercept, sticky across gestures, down only mid-gesture. Plus a harness proving today's emergencyStep fails the same properties. */
import assert from 'node:assert/strict'
import { BAND_MAX_STEPPED, DEFAULT_MOTION_SCALE, FENCE_BUDGET_MS, FenceGrid, bandCount, foldFullCost, predictBandMs, refinePlan, releaseHoldActive, MOTION_STEPS, emergencyStep } from '../src/post/motionGrid'

/** A phone whose frame period is a + b*s^2 (a: vsync wait and fixed passes). */
const truth = (a: number, b: number) => (s: number) => a + b * s * s

interface Stepper { start(): number; frame(s: number, ms: number, rafMs: number): number | null; end(): void }
interface Run { starts: number[]; ends: number[]; ups: number; changes: number[] }

/** Drives N gestures of F frames each against a cost function; the stepper sees period ms (fence) and the smoothed rAF interval (old path). */
function drive(st: Stepper, cost: (s: number) => number, gestures: number, frames: number): Run {
  const run: Run = { starts: [], ends: [], ups: 0, changes: [] }
  for (let g = 0; g < gestures; g++) {
    let s = st.start()
    run.starts.push(s)
    let ch = 0, raf = 0
    for (let f = 0; f < frames; f++) {
      const ms = cost(s)
      raf = raf === 0 ? ms : raf * 0.85 + ms * 0.15
      const n = st.frame(s, ms, raf)
      if (n !== null) { if (n > s) run.ups++; s = n; ch++; raf = 0 }
    }
    run.ends.push(s); run.changes.push(ch)
    st.end()
  }
  return run
}

const fenceStepper = (): Stepper => { const g = new FenceGrid(); return { start: () => g.start(0.35), frame: (s, ms) => { g.observe(s, ms); return g.step(s) }, end: () => {} } }
/** Today's fence-source behaviour: every gesture starts at DEFAULT_MOTION_SCALE, the only move is emergencyStep on the smoothed rAF interval. */
const todayStepper = (): Stepper => { let n = 0; return { start: () => { n = 0; return DEFAULT_MOTION_SCALE }, frame: (s, _ms, raf) => emergencyStep(raf, s, n++ > 0 ? n : 0) , end: () => {} } }

/** The properties the owner needs: a gesture starts where the last one settled, never up mid-gesture, at most 2 changes a gesture, same answer every time. */
function holds(r: Run, cost: (s: number) => number, calmUp = false): void {
  assert.ok(cost(r.ends.at(-1)!) <= 1.05 * FENCE_BUDGET_MS, `the settled grid ${r.ends.at(-1)} fits the budget (${cost(r.ends.at(-1)!).toFixed(0)} ms)`)
  const next = (x: number): number => MOTION_STEPS[Math.min(MOTION_STEPS.length - 1, MOTION_STEPS.indexOf(x) + 1)]
  for (let g = 1; g < r.starts.length; g++) assert.ok(r.starts[g] === r.ends[g - 1] || (calmUp && r.starts[g] >= r.ends[g - 1] && r.starts[g] <= next(next(r.ends[g - 1]))), `gesture ${g} starts where gesture ${g - 1} settled (${r.starts[g]} vs ${r.ends[g - 1]})`)
  if (!calmUp) assert.equal(r.ups, 0, 'never up when frames are dear')
  for (const c of r.changes) assert.ok(c <= 2, `at most two grid changes in a gesture (saw ${c})`)
  if (!calmUp) assert.ok(r.starts.slice(1).every((s) => s !== DEFAULT_MOTION_SCALE) || r.ends[0] === DEFAULT_MOTION_SCALE, 'the second pinch does not restart at the constant 0.5')
}

// A close-in phone: 12 ms of intercept, 190 ms at full grid: 0.35 costs 35, 0.25 costs 24, 0.5 costs 59.
const close = truth(12, 190)
const fence = drive(fenceStepper(), close, 6, 60)
holds(fence, close)
assert.ok(fence.ends.at(-1)! <= 0.35, `settles at 0.25-0.35 close in (got ${fence.ends.at(-1)})`)
assert.ok(close(fence.ends.at(-1)!) <= FENCE_BUDGET_MS * 1.05, 'and the settled grid is inside the budget')
// same answer every time
for (let i = 0; i < 3; i++) assert.deepEqual(drive(fenceStepper(), close, 6, 60).ends, fence.ends, 'deterministic')
// far out: cheap frames: starts 0.35, never moves mid-gesture, a calm gesture lets the NEXT start finer (up to two steps), settling where the model says it fits
const far = truth(10, 30)
const calm = drive(fenceStepper(), far, 4, 60)
holds(calm, far, true)
assert.equal(calm.starts[0], 0.35)
assert.equal(calm.ups, 0, 'never up mid-gesture')
assert.ok(calm.starts[1] > calm.starts[0], 'a calm gesture starts the next one finer')
assert.ok(calm.starts.at(-1)! >= 0.5 && far(calm.starts.at(-1)!) <= FENCE_BUDGET_MS, 'and settles at 0.5 or finer, inside the budget')
assert.ok(calm.starts.every((s, i) => i === 0 || s >= calm.starts[i - 1]), 'only ever finer while calm')

// the model: intercept recovered from two grids, a single grid uses the carried intercept
{
  const g = new FenceGrid()
  for (let i = 0; i < 6; i++) g.observe(0.35, close(0.35))
  for (let i = 0; i < 4; i++) g.observe(0.5, close(0.5))
  const m = g.model()!
  assert.ok(Math.abs(m.a - 12) < 1.5 && Math.abs(m.b - 190) < 15, `fit a=${m.a} b=${m.b}`)
  assert.ok(Math.abs(g.predict(0.25) - close(0.25)) < 2, 'predicts an unseen grid')
  assert.equal(new FenceGrid().model(), null)
  assert.equal(new FenceGrid().start(0.35), 0.35, 'class start before any evidence')
}
// the first frames of a gesture and an isolated hitch are not evidence; three over-budget frames in a row are
{
  const g = new FenceGrid(); g.start(0.5)
  g.observe(0.5, 400); g.observe(0.5, 400); assert.equal(g.step(0.5), null, 'warm-up frames are ignored')
  g.observe(0.5, 90); g.observe(0.5, 20); g.observe(0.5, 90); g.observe(0.5, 90); assert.equal(g.step(0.5), null, 'a good frame between resets the run')
  g.observe(0.5, 90); assert.ok(g.step(0.5)! < 0.5)
  const h = new FenceGrid(); h.start(0.35)
  for (let i = 0; i < 2; i++) h.observe(0.35, 20)
  h.observe(0.35, 100); h.observe(0.35, 100); assert.equal(h.step(0.35), null)
  for (let i = 0; i < 30; i++) h.observe(0.35, 17)
  assert.ok(h.predict(0.35) < 25, 'a two-frame hitch does not poison the model (median)')
}
// a wrong single-point fit (noise: bigger grid not slower) must not blow up
{
  const g = new FenceGrid(); for (let i = 0; i < 5; i++) { g.observe(0.35, 30); g.observe(0.5, 25) }
  const m = g.model()!; assert.ok(Number.isFinite(m.a) && Number.isFinite(m.b) && m.a >= 0 && m.b > 0)
}
assert.ok(MOTION_STEPS.includes(0.35))

// the owner's Pixel: 8 ms at 0.25 must not stay at 0.25 across gestures
{
  const fast = truth(6, 40)
  const run = drive(fenceStepper(), fast, 5, 60)
  assert.ok(run.starts.at(-1)! >= 0.5, `a cheap GPU leaves the floor within a few gestures (started ${run.starts.at(-1)})`)
  assert.equal(run.ups, 0)
}
// a hitch every 12th frame (tile upload) does not keep a calm gesture from counting
{
  const g = new FenceGrid(); g.start(0.35)
  for (let i = 0; i < 80; i++) g.observe(0.35, i % 12 === 5 ? 28 : 17)
  assert.ok(g.start(0.35) > 0.35, 'one dear frame in twelve does not reset the calm count')
}
// when frames are dear the ladder still drops; a start-up that fails is banned
{
  const dear = drive(fenceStepper(), truth(12, 190), 3, 120)
  assert.ok(truth(12, 190)(dear.ends.at(-1)!) <= 1.05 * FENCE_BUDGET_MS, 'dear frames still settle inside the budget')
  const lying = (s: number): number => (s <= 0.25 ? 14 : s <= 0.35 ? 60 : 90)
  const g = new FenceGrid(); let s = g.start(0.25), startsAt035 = 0
  for (let gest = 0; gest < 12; gest++) {
    if (s === 0.35) startsAt035++
    for (let f = 0; f < 60; f++) { g.observe(s, lying(s)); const n = g.step(s); if (n !== null) s = n }
    s = g.start(0.25)
  }
  assert.ok(startsAt035 <= 2, `a failed up-start is banned (tried 0.35 in ${startsAt035} of 12 gestures)`)
}

// END TO END through the real GpuTimer and FramePacer (fence path): the cheap frames of a healthy phone are queued two or three deep by design, so
// they are never "alone"; the grid must still be able to leave the floor.
{
  const { GpuTimer, PERIOD_LIGHT_MS } = await import('../src/post/gpuTimer')
  const { FramePacer } = await import('../src/post/framePacer')
  assert.ok(PERIOD_LIGHT_MS > 0)
  const vs = 1000 / 120 // a 120 Hz phone: a 10 ms pipeline puts two frames in flight
  const sim = (ctor: (g: FenceGrid) => FenceGrid | null, cost: (s: number) => number, gestures: number) => {
    let now = 0, gpuFree = 0
    const gl = {
      SYNC_GPU_COMMANDS_COMPLETE: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3, TIMEOUT_EXPIRED: 4,
      getExtension: () => null, flush: () => {}, deleteSync: () => {},
      fenceSync: () => ({ doneAt: gpuFree + 10 }), clientWaitSync: (f: { doneAt: number }) => (f.doneAt <= now ? 2 : 4),
    }
    const timer = new GpuTimer(gl as never, true, true)
    const pacer = new FramePacer()
    const grid = ctor(new FenceGrid())!
    const starts: number[] = []
    for (let g = 0; g < gestures; g++) {
      let s = grid.start(0.25); starts.push(s); timer.reset()
      for (let f = 0; f < 180; f++) {
        now += vs
        timer.poll(now)
        for (const p of timer.drainPeriods()) grid.observe(p.scale, p.ms)
        const n = grid.step(s); if (n !== null) { s = n; timer.reset() }
        if (pacer.shouldHold(gl as never, now)) continue
        timer.begin(now, false, s)
        gpuFree = Math.max(gpuFree, now) + cost(s) // 10 ms of pipeline latency: the fence signals after the present queue, so cheap frames overlap
        timer.end(); pacer.drew(gl as never, now, false)
      }
      now += 400 // release hold
    }
    if (process.env.DBG) console.log(JSON.stringify(grid.snapshot()).slice(0, 400))
    return { starts, snap: grid.snapshot() }
  }
  const cheap = (s: number): number => 2 + 24 * s * s // 3.5 ms at 0.25, 14 ms at full grid: a healthy phone
  const { starts, snap } = sim((g) => g, cheap, 6)
  assert.ok(starts.at(-1)! >= 0.5, `end to end, a cheap phone whose true cost allows 0.5 starts there (starts ${starts.join(', ')})`)
  // A fence reads a PERIOD, not GPU time: never under the true cost, and no more than the pipeline (10 ms) plus two vsyncs over it when the GPU is idle between frames.
  for (const [g, ms] of Object.entries(snap.obs)) assert.ok(ms >= 0.9 * cheap(+g) && ms <= cheap(+g) + 10 + 2 * vs, `learned period at grid ${g} is ${ms} ms, true cost ${cheap(+g).toFixed(1)} ms`)
  const dearCost = (s: number): number => 12 + 190 * s * s
  const { starts: dearStarts, snap: dearSnap } = sim((g) => g, dearCost, 4)
  // The one-in-flight regime reads done - submitted, which carries the pipeline latency: bounded the same way.
  assert.ok(Object.keys(dearSnap.obs).length > 0)
  for (const [g, ms] of Object.entries(dearSnap.obs)) assert.ok(ms >= 0.9 * dearCost(+g) && ms <= dearCost(+g) + 10 + 2 * vs, `dear phone: learned ${ms} ms at grid ${g}, true ${dearCost(+g).toFixed(1)} ms`)
  assert.ok(dearStarts.at(-1)! <= 0.35, `and a dear one stays low (starts ${dearStarts.join(', ')})`)
}

// P1-2: a probe that fails on a tile-upload hitch (the model fitted on its own frames says it fits) is not banned; one the model calls over budget is.
{
  const run = (probeFrames: (g: FenceGrid, p: number) => void): { probe: number; again: number } => {
    const g = new FenceGrid(); g.start(0.25)
    for (let i = 0; i < 30; i++) g.observe(0.25, 6)
    const probe = g.start(0.25); assert.ok(probe > 0.25, 'the calm gesture probes a finer grid')
    probeFrames(g, probe)
    let s = probe; for (let k = 0; k < 4 && s === probe; k++) { const n = g.step(s); if (n !== null) s = n; else g.observe(s, 90) }
    s = g.start(0.25)
    for (let i = 0; i < 2; i++) g.observe(s, 6)
    for (let i = 0; i < 30; i++) g.observe(s, 6)
    return { probe, again: g.start(0.25) }
  }
  const hitch = run((g, p) => { for (let i = 0; i < 2 + 7; i++) g.observe(p, 8); for (let i = 0; i < 3; i++) g.observe(p, 80) })
  const bad = run((g, p) => { for (let i = 0; i < 2 + 10; i++) g.observe(p, 90) })
  assert.ok(hitch.again >= hitch.probe, `a hitch does not ban the grid (probed ${hitch.probe}, next start ${hitch.again})`)
  assert.ok(bad.again < bad.probe, `a grid the model calls over budget is banned (probed ${bad.probe}, next start ${bad.again})`)
}
{
  const { termAaFactor } = await import('../src/moon/moonShader')
  assert.equal(termAaFactor(NaN, 0.25, true), 1); assert.equal(termAaFactor(0.6, 0.25, false), 1); assert.equal(termAaFactor(0.6, 0.7, true), 1, 'never on the 0.7 refine frame')
  assert.ok(Math.abs(termAaFactor(0.6, 0.25, true) - 0.6) < 1e-9); assert.ok(termAaFactor(0.6, 0.5, true) > 0.6 && termAaFactor(0.6, 0.5, true) < 1)
}
// GpuTimer: a queued frame reports the completion GAP (not done - submitted), and a dear gap above PERIOD_LIGHT_MS is kept, not dropped.
{
  const { GpuTimer } = await import('../src/post/gpuTimer')
  let now = 0
  const done = new Map<object, number>()
  const gl = { SYNC_GPU_COMMANDS_COMPLETE: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3, TIMEOUT_EXPIRED: 4, getExtension: () => null, flush: () => {}, deleteSync: () => {}, fenceSync: () => { const f = {}; done.set(f, 0); return f }, clientWaitSync: (f: object) => (done.get(f)! <= now ? 2 : 4) }
  const t = new GpuTimer(gl as never, true, true)
  const submit = (at: number, doneAt: number): void => { now = at; t.begin(at, false, 0.5); t.end(); const f = [...done.keys()].at(-1)!; done.set(f, doneAt) }
  submit(0, 10); submit(1, 20); submit(2, 60)
  now = 10; t.poll(10); t.drainPeriods() // first frame alone: its latency
  now = 20; t.poll(20)
  const p1 = t.drainPeriods(); assert.equal(p1.length, 1); assert.equal(p1[0].ms, 10, 'queued frame: gap since the previous completion (10), not latency (19)')
  now = 60; t.poll(60)
  const p2 = t.drainPeriods(); assert.equal(p2.length, 1); assert.equal(p2[0].ms, 40, 'a gap over PERIOD_LIGHT_MS is kept so the grid can count it as over')
}

// the same properties FAIL against today's emergencyStep path (restart at 0.5, step on the rAF interval, no memory)
assert.throws(() => holds(drive(todayStepper(), close, 6, 60), close), 'today path violates the sticky-grid properties')
{ const t = drive(todayStepper(), far, 4, 60); assert.ok(!(t.starts[1] > t.starts[0]), 'today path never starts finer after a calm gesture') }
// budgeted refine: bands so that none is predicted over budget
assert.equal(bandCount(0, 150), 1); assert.equal(bandCount(150, 150), 1); assert.equal(bandCount(151, 150), 2)
assert.equal(bandCount(500, 150), 4); assert.equal(bandCount(5000, 150), 8); assert.equal(bandCount(500, 0), 1)
// P1-2: the band count never goes below this gesture's own model, even when the last rest frame was cheap; a dear reading is taken at once, a cheap one slowly
assert.equal(bandCount(predictBandMs(80, 1, 500, 1), 150), 4, 'far-pose rest reading (80) with a close-pose model (500): 4 bands, not 1')
assert.equal(bandCount(predictBandMs(600, 1, 40, 3), 150), 4, 'a dear measured frame keeps its bands')
assert.equal(foldFullCost(0, 300), 300); assert.equal(foldFullCost(80, 500), 500, 'up at once'); assert.equal(foldFullCost(500, 80), 80 * 0.3 + 500 * 0.7, 'down slowly')
// P1-3: a banded full frame skips the 0.7 step (it was drawn, never seen, and cost half a frame of time-to-sharp)
assert.deepEqual(refinePlan(0, 0.35, false, false, true), { scale: 1, refineStep: 0, needsRefine: false })
assert.equal(refinePlan(0, 0.35, false, false, false).scale, 0.7, 'unbanded classes keep the mid step')
// fast phone: one band suffices, so no release hold and no bands (behaves like bands=off)
assert.equal(bandCount(predictBandMs(40, 1, 10, 3), 150), 1)
assert.equal(releaseHoldActive(false, 50, 50, 150), false, 'one band: no hold')
assert.equal(releaseHoldActive(true, 50, 1e9, 150), true); assert.equal(releaseHoldActive(true, 1e9, 50, 150), true); assert.equal(releaseHoldActive(true, 200, 200, 150), false)
// Rest to motion (WP-A, 2026-10-23), `?settle=stepped` on desktop: the band budget is 50 ms and the desktop has no fence model (predict 0), so the bands come from the LEARNED rest cost alone.
assert.equal(bandCount(predictBandMs(117, 1, 0, 3), 50), 3, "the owner's 117 ms full frame: three bands, none over 50 ms")
assert.equal(bandCount(predictBandMs(117, 0.7, 0, 3), 50), 2, 'the 0.7 mid frame (57 ms): two bands')
assert.equal(bandCount(predictBandMs(0, 1, 0, 3), 50), 1, 'nothing learned yet: the first rest frame is one submit (and the one that teaches the cost)')
assert.equal(bandCount(predictBandMs(30, 1, 0, 3), 50), 1, 'a frame inside the budget is one submit')
// The owner's real-mouse recording (2026-10-23) priced the full frame at 500-613 ms (restCatchUp.c0Ms 613, taggedMs 485-562), not 117: eight bands (the cap) of about 77 ms, no submit near 500 ms.
assert.equal(bandCount(predictBandMs(613, 1, 0, 3), 50), 8)
assert.ok(613 / bandCount(predictBandMs(613, 1, 0, 3), 50) <= 100, 'each submit about 77 ms')
assert.equal(bandCount(predictBandMs(613, 0.7, 0, 3), 50), 7, 'the 0.7 mid frame (300 ms): seven bands of about 43 ms')
assert.equal(bandCount(predictBandMs(2000, 1, 0, 3), 50), 8, 'the phone cap: a 2 s frame goes in 8 bands of 250 ms')
// Review item 3: under `?settle=stepped` the count follows measured cost / budget (613 ms -> 13 bands of about 47 ms), the mid frame the same way; the cap is BAND_MAX_STEPPED.
assert.equal(bandCount(predictBandMs(613, 1, 0, 3), 50, BAND_MAX_STEPPED), 13)
assert.ok(613 / 13 <= 50, 'no band over the budget')
assert.equal(bandCount(predictBandMs(613, 0.7, 0, 3), 50, BAND_MAX_STEPPED), 7, 'the 0.7 mid frame (300 ms): seven bands')
assert.equal(bandCount(predictBandMs(2000, 1, 0, 3), 50, BAND_MAX_STEPPED), BAND_MAX_STEPPED, 'a 2 s frame hits the stepped cap (32 bands of 62 ms)')
console.log('fence-grid: ok')
