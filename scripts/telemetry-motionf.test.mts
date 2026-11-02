/**
 * WP9 (O6): the motion render fraction f on flight_perf and drag_perf. Pure builders (events.ts motionFProps / buildFlightPerf / buildDragPerf)
 * and the per-window recorder (perf/frameStats.ts FracWindow): empty window, one frame, the 0.35 share threshold, the source field, the phone tier,
 * agreement with the viewer's own FracStats (`__moon.perf.motionF`), following the running record, and heap growth per tick.
 * Pure: no file reads, so it runs in the public cut. The wiring and docs checks are private: scripts/telemetry-motionf-wiring.test.mts.
 */
import assert from 'node:assert/strict'
import { buildDragPerf, buildFlightPerf, motionFProps, payloadIsClean } from '../src/telemetry/events.ts'
import { FracWindow, FrameWindow, MOTION_F_LOW } from '../src/perf/frameStats.ts'
import { FracStats } from '../src/quality/phoneSharp.ts'

const FIELDS = ['motion_f_p10', 'motion_f_p50', 'motion_f_under_035_share', 'motion_f_source', 'phone_tier'] as const

const fw = new FrameWindow(8)
fw.start(0, 0, 1000 / 60)
fw.tick(16, 1); fw.tick(33, 2); fw.tick(50, 3)
const s = fw.summary()
const flightMeta = { momentId: 'tycho', kind: 'flight', durationMs: 1000, completed: true, start: null, end: null, endDist: null, scaleChanges: 0, peakInflight: 0, exposureMode: 'full', scaleMode: 'off', wantMult: 4 }
const dragMeta = { kind: 'drag' as const, durationMs: 900, startLatencyMs: 12, nearTerminator: null, scaleChanges: 0, peakInflight: 0 }
const win = (...f: number[]): FracWindow => { const w = new FracWindow(); w.start(); for (const v of f) w.add(v); return w }

// ---- empty: no motion frame (or no motion meta at all) is N/A on every field, never 0
{
  assert.equal(MOTION_F_LOW, 0.35)
  const e = win().summary()
  assert.deepEqual(e, { frames: 0, p10: null, p50: null, underShare: null })
  for (const p of [motionFProps(undefined), motionFProps({}), motionFProps({ f: e }), motionFProps({ f: null, gpuSource: undefined, phoneLevel: undefined })]) {
    for (const k of FIELDS) assert.equal(p[k], null, `${k} is null when unmeasured`)
  }
  // The fields are on both events even before anything is measured (a null property is "not measured").
  for (const p of [buildFlightPerf(flightMeta, s), buildDragPerf(dragMeta, s)]) {
    for (const k of FIELDS) { assert.ok(k in p, k); assert.equal(p[k], null) }
    assert.ok(payloadIsClean(p))
  }
  // Invalid values are dropped as FracStats drops them.
  assert.equal(win(0, -1, NaN, Infinity).frames, 0)
}

// ---- a single frame: both quantiles are that frame's f (to 0.01), the share is 0 or 1
{
  assert.deepEqual(win(0.625).summary(), { frames: 1, p10: 0.63, p50: 0.63, underShare: 0 })
  assert.deepEqual(win(0.26).summary(), { frames: 1, p10: 0.26, p50: 0.26, underShare: 1 })
  assert.deepEqual(win(1.4).summary(), { frames: 1, p10: 1, p50: 1, underShare: 0 }, 'f is clamped to 1')
  const p = buildFlightPerf({ ...flightMeta, motion: { f: win(0.5).summary(), gpuSource: 'query', phoneLevel: 2 } }, s)
  assert.equal(p.motion_f_p10, 0.5); assert.equal(p.motion_f_p50, 0.5); assert.equal(p.motion_f_under_035_share, 0)
  assert.equal(p.motion_f_source, 'query'); assert.equal(p.phone_tier, 2)
  assert.ok(payloadIsClean(p))
}

// ---- the share threshold: f under 0.35 in the 0.01 bins the quantiles use (bin 34 or lower), so the share and the quantiles agree
{
  assert.equal(win(0.35).summary().underShare, 0, '0.35 is not under 0.35')
  assert.equal(win(0.3496).summary().underShare, 0, '0.3496 bins to 0.35: not under, as its quantile says')
  assert.equal(win(0.3496).summary().p10, 0.35)
  assert.equal(win(0.3499).summary().underShare, 0)
  assert.equal(win(0.3449).summary().underShare, 1, '0.3449 bins to 0.34')
  assert.equal(win(0.3449).summary().p10, 0.34)
  assert.equal(win(0.34).summary().underShare, 1)
  assert.equal(win(0.16, 0.26, 0.35, 0.5).summary().underShare, 0.5)
  assert.equal(win(0.2, 0.5, 0.5).summary().underShare, 0.333, 'three decimals')
  // Agreement: a share of k/n under means the quantile at k/n lies under 0.35 and the next rank does not.
  { const w = win(0.3449, 0.3449, 0.3496, 0.36, 0.5, 0.6, 0.6, 0.62, 0.63, 0.63).summary(); assert.equal(w.underShare, 0.2); assert.equal(w.p10, 0.34) }
  // The old phone grid (0.35 x 1.5 / 2 = 0.2625 of the canvas far out) is counted; the new floor 0.5 and target 0.625 are not.
  const old = win(...Array<number>(30).fill(0.2625), ...Array<number>(70).fill(0.625)).summary()
  assert.equal(old.underShare, 0.3); assert.equal(old.p10, 0.26); assert.equal(old.p50, 0.63)
  const d = buildDragPerf({ ...dragMeta, motion: { f: old, gpuSource: 'fence', phoneLevel: 0 } }, s)
  assert.equal(d.motion_f_under_035_share, 0.3); assert.equal(d.motion_f_p10, 0.26); assert.equal(d.motion_f_p50, 0.63)
}

// ---- the source field: `query` (disjoint timer) or `wall` (__moon.perf.source 'fence': no timer query or ?gpusource=fence; 'none': ?gputimer=0 or ?passes=1); else null
{
  const src = (v: unknown): unknown => motionFProps({ f: win(0.6).summary(), gpuSource: v }).motion_f_source
  assert.equal(src('query'), 'query')
  assert.equal(src('fence'), 'wall')
  assert.equal(src('none'), 'wall')
  assert.equal(src('wall'), 'wall')
  for (const v of [undefined, null, '', 'Query', 'https://x', 1, {}]) assert.equal(src(v), null, String(v))
  // The source and the tier are reported even when the window drew no motion frame (they are states, not frame statistics).
  const p = motionFProps({ f: win().summary(), gpuSource: 'query', phoneLevel: 1 })
  assert.equal(p.motion_f_source, 'query'); assert.equal(p.phone_tier, 1); assert.equal(p.motion_f_p50, null)
}

// ---- the phone tier: the pacer's level 0, 1 or 2; null without the pacer (`__moon.perf.phone` is null off the touch classes)
{
  const tier = (v: unknown): unknown => motionFProps({ phoneLevel: v }).phone_tier
  assert.equal(tier(0), 0); assert.equal(tier(1), 1); assert.equal(tier(2), 2)
  for (const v of [undefined, null, 3, -1, 1.5, '1', NaN]) assert.equal(tier(v), null, String(v))
}

// ---- the same statistics as `__moon.perf.motionF`: FracWindow over a whole run equals FracStats p10 / p50 (same bins, nearest rank)
{
  let seed = 12345
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31 }
  for (let run = 0; run < 50; run++) {
    const a = new FracStats(), w = new FracWindow()
    w.start()
    const n = 1 + Math.floor(rnd() * 400)
    for (let i = 0; i < n; i++) { const f = rnd() < 0.1 ? 0 : rnd() * 1.2; a.add(f); w.add(f) }
    const snap = a.snapshot(), sum = w.summary()
    assert.equal(sum.frames, snap.frames)
    assert.equal(sum.p10, snap.p10, `p10 run ${run}`)
    assert.equal(sum.p50, snap.p50, `p50 run ${run}`)
  }
}

// ---- following the viewer's running record (main.ts `api.motionFStats`, the FracStats behind `__moon.perf.motionF`)
{
  const viewer = new FracStats()
  for (let i = 0; i < 20; i++) viewer.add(0.25) // frames before the window starts are not the window's
  const w = new FracWindow()
  w.start(viewer)
  w.follow(viewer)
  assert.equal(w.frames, 0)
  for (let i = 0; i < 9; i++) { viewer.add(0.625); w.follow(viewer) }
  viewer.add(0.5); w.follow(viewer)
  w.follow(viewer) // a tick with no new motion frame adds nothing
  assert.deepEqual(w.summary(), { frames: 10, p10: 0.5, p50: 0.63, underShare: 0 })
  viewer.add(0.3); viewer.add(0.3); w.follow(viewer) // two draws between ticks both count, at the newer f
  assert.equal(w.frames, 12); assert.equal(w.under, 2)
  viewer.reset(); w.follow(viewer) // the rig's resetMotionF: the follow restarts from the new count
  viewer.add(0.7); w.follow(viewer)
  assert.equal(w.frames, 13)
  w.follow(null); w.follow(undefined) // a viewer without the accessor: nothing happens
  assert.equal(w.frames, 13)
  const unfollowed = new FracWindow()
  unfollowed.start(null)
  unfollowed.follow(viewer); viewer.add(0.6); unfollowed.follow(viewer)
  assert.equal(unfollowed.frames, 1, 'a window started without a source takes its baseline at the first follow')
}

// ---- recording f does not allocate per tick (heap growth under 3 MB over 1M ticks, best of 3)
{
  const viewer = { frames: 0, last: 0.625 }
  const w = new FracWindow()
  w.start(viewer)
  for (let i = 0; i < 20000; i++) { viewer.frames++; w.follow(viewer) }
  let grew = Infinity
  for (let run = 0; run < 3 && grew >= 3_000_000; run++) {
    w.start(viewer)
    const before = process.memoryUsage().heapUsed
    for (let i = 0; i < 1_000_000; i++) { viewer.frames++; viewer.last = 0.5 + (i % 7) * 0.02; w.follow(viewer) }
    grew = Math.min(grew, process.memoryUsage().heapUsed - before)
  }
  assert.ok(grew < 3_000_000, `follow() must not allocate per tick (heap grew ${grew} bytes over 1M ticks, best of 3)`)
}

console.log('telemetry-motionf: ok')
