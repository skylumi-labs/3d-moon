// F10: behaviour, not source text. The gesture hand-back (a falling edge of `moving` releases the gesture whoever moved the camera), the two-step
// refine (mid grid, then full size, never stuck) and the exposure reuse (`expFrozen`: only inside a gesture, only for its window, never at rest).
import assert from 'node:assert/strict'
import { EXPOSURE_MOVING_MS, REFINE_MID_SCALE, REST_CATCHUP_MAX_FRAMES, REST_CATCHUP_MAX_MS, REST_BUDGET_MS, EMPTY_REST_COST, BAND_MAX_STEPPED, PRESS_YIELD_MS, SETTLE_DEFER_MAX_MS, SETTLE_QUIET_MS, bandCount, handBackPlan, foldRestCost, predictRestMs, pressYieldActive, restFrameMs, exposureReusable, needsHandBack, refinePlan, restCatchUpPlan, settleDefers, settleFullAffordable, settleQuietFromSearch, settleWaits } from '../src/post/motionGrid.ts'
import { FramePacer, type FenceGl } from '../src/post/framePacer.ts'
import { uploadsThisFrame } from '../src/moon/tiles/wanted.ts'

// ---- the frame loop's hand-back, as the loop drives it: one call per frame, `moving` from the mover, state carried between frames ----
function runGesture(movingFrames: number, motionScale: number, opts: { markMoved?: boolean; forced?: boolean; noRefine?: boolean } = {}): { scales: number[]; gestureOn: boolean; needsRefine: boolean } {
  let gestureOn = false, needsRefine = false, refineStep = 0
  const scales: number[] = []
  for (let f = 0; f < movingFrames + 6; f++) {
    const moving = f < movingFrames
    let scale = 1
    if (moving) { gestureOn = true; refineStep = 0; scale = motionScale; if (opts.markMoved ?? true) needsRefine = false }
    else if (needsHandBack(moving, gestureOn, needsRefine)) {
      gestureOn = false
      const plan = refinePlan(refineStep, motionScale, !!opts.forced, !!opts.noRefine)
      scale = plan.scale; refineStep = plan.refineStep; needsRefine = plan.needsRefine
    } else if (!gestureOn && !needsRefine) continue // idle: nothing is drawn
    scales.push(scale)
  }
  return { scales, gestureOn, needsRefine }
}

{
  // F10c: an orbit/tween/eclipse mover never sets needsRefine; the gesture is still released and the picture ends at full size.
  const r = runGesture(10, 0.35, { markMoved: false })
  assert.equal(r.gestureOn, false, 'gestureOn is released at rest')
  assert.equal(r.scales.at(-1), 1, 'the last frame drawn is full size')
  assert.equal(r.needsRefine, false)
  // The old condition (needsRefine only) leaves it on: this is the regression the test pins.
  let gestureOn = true
  const oldRelease = (moving: boolean, needsRefine: boolean): void => { if (!moving && needsRefine) gestureOn = false }
  oldRelease(false, false)
  assert.equal(gestureOn, true, 'the old needsRefine-only rule would have held the gesture on at rest')
  assert.equal(needsHandBack(false, true, false), true)
}

{
  // F10b: the two-step refine. A coarse gesture draws the mid grid once, then full size; a fine one goes straight to full size.
  const coarse = runGesture(5, 0.35)
  assert.deepEqual(coarse.scales, [0.35, 0.35, 0.35, 0.35, 0.35, REFINE_MID_SCALE, 1], 'coarse grid: mid step then full')
  const fine = runGesture(5, 0.7)
  assert.deepEqual(fine.scales, [0.7, 0.7, 0.7, 0.7, 0.7, 1], 'a grid at the mid step refines in one step')
  assert.deepEqual(runGesture(5, 0.25, { forced: true }).scales.slice(-1), [1], 'a forced grid goes straight to full')
  assert.deepEqual(runGesture(5, 0.25, { noRefine: true }).scales.slice(-1), [1], '?abl=norefine goes straight to full')
  for (const s of [0.25, 0.35, 0.5, 0.7]) { const r = runGesture(3, s); assert.equal(r.scales.at(-1), 1); assert.ok(!r.gestureOn && !r.needsRefine, `ends at rest from ${s}`) }
  assert.deepEqual(refinePlan(1, 0.35, false, false), { scale: 1, refineStep: 0, needsRefine: false }, 'the second step is always the full-size frame')
}

{
  // F10a: expFrozen. Reuse inside the window, never at rest, never when something owns the exposure, never from the future.
  const base = { gestureOn: true, hasSearch: true, cutFrames: 0, ownsExposure: false, now: 1000, searchAt: 960 }
  assert.equal(exposureReusable(base), true, 'inside a gesture, inside the window')
  assert.equal(exposureReusable({ ...base, now: 960 + EXPOSURE_MOVING_MS }), false, 'the window closes')
  assert.equal(exposureReusable({ ...base, now: 960 + EXPOSURE_MOVING_MS - 1 }), true)
  assert.equal(exposureReusable({ ...base, gestureOn: false }), false, 'never at rest: the rest value must not depend on gesture timing')
  assert.equal(exposureReusable({ ...base, hasSearch: false }), false, 'nothing to reuse yet')
  assert.equal(exposureReusable({ ...base, cutFrames: 2 }), false, 'an exposure cut searches')
  assert.equal(exposureReusable({ ...base, ownsExposure: true }), false, 'an eclipse or ridge journey owns its exposure')
  assert.equal(exposureReusable({ ...base, now: 900 }), false, 'a clock that went back does not reuse')
  assert.equal(exposureReusable({ ...base, now: 5000, freeze: true }), true, '?abl=expfreeze holds it')
  assert.equal(exposureReusable({ ...base, noReuse: true }), false, '?abl=noexpreuse reverts')
  // Frame by frame: a 16.7 ms cadence searches about every 4th frame inside a gesture and every frame at rest.
  let searchAt = -1, hasSearch = false, searches = 0
  for (let f = 0; f < 60; f++) {
    const now = f * 16.7, gestureOn = f < 30
    if (!exposureReusable({ gestureOn, hasSearch, cutFrames: 0, ownsExposure: false, now, searchAt })) { searches++; searchAt = now; hasSearch = true }
  }
  assert.ok(searches >= 30 / 4 + 30 - 2 && searches <= 30 / 4 + 30 + 2, `a search every ~4th frame while moving, every frame at rest (${searches})`)
}


// ---- the cache-first hand-back (?restcache): the loop's hand-back with restCatchUpPlan and the cost model, as main.ts drives it ----
// The driver models: the planner at the full step; the cost sample learned from the full frame drawn (priced as max(query, wall gap)); abandon on camera / Sun /
// scrub / date movement; the canvas-size abort; and the mid frame's crossfade, which keeps running (final pass only) during the hold.
// `presented` lists what reaches the screen: 'motion', 'mid', 'fade' (the mid picture fading in during a hold), 'full'. Build-only frames present nothing.
const FADE_MS = 120
type Model = typeof EMPTY_REST_COST
interface Rel { presented: string[]; builds: number; abandoned: number; aborts: number; model: Model }
function runRelease(movingFrames: number, motionScale: number, o: {
  on?: boolean; dtMs?: number; model?: Model; unmet0?: number; perLayerBuilt?: number
  fullMs?: (unmet: number) => number // true wall cost of a full frame drawn with `unmet` uncached layers
  queryMs?: (unmet: number) => number // what the GPU query reads (can under-read)
  legacyResize?: boolean // model the pre-fix loop (no forced normal frame after an abort)
  moveAt?: number; tileAt?: number; sunMovingAt?: number; resizeAt?: number; guardOffAt?: number; budget?: number
} = {}): Rel {
  const on = o.on ?? true, dt = o.dtMs ?? 16, per = o.perLayerBuilt ?? 8
  let model = o.model ?? EMPTY_REST_COST
  let unmet = o.unmet0 ?? 0
  let gestureOn = false, needsRefine = false, refineStep = 0, builds = 0, abandoned = 0
  let cu: { frames: number; since: number } | null = null
  let resizePending = false, forceNormal = false, aborts = 0
  let fadeLeft = 0 // ms of the mid crossfade left
  let pending: { unmet: number } | null = null
  const presented: string[] = []
  let t = 0
  for (let f = 0; f < movingFrames + 120; f++, t += dt) {
    const moving = f < movingFrames || f === o.moveAt
    const sunMoving = f === o.sunMovingAt
    // the next tick prices the full frame drawn last tick: max(GPU query, wall gap), as main.ts does
    if (pending) { model = foldRestCost(model, pending.unmet, restFrameMs(o.queryMs ? o.queryMs(pending.unmet) : -1, o.fullMs ? o.fullMs(pending.unmet) : 0, false)); pending = null }
    let kind = 'full'
    if (moving) {
      gestureOn = true; refineStep = 0; needsRefine = false; kind = 'motion'
      if (cu) { abandoned++; cu = null }
    } else if (needsHandBack(moving, gestureOn, needsRefine)) {
      gestureOn = false
      const plan = cu ? { scale: 1, refineStep: 0, needsRefine: false } : refinePlan(refineStep, motionScale, false, false)
      refineStep = plan.refineStep; needsRefine = plan.needsRefine
      kind = plan.scale === 1 ? 'full' : 'mid'
      if (plan.scale === 1) {
        const guardOff = o.guardOffAt !== undefined && f >= o.guardOffAt
        if (f === o.resizeAt) resizePending = true // the canvas size changed during the hold
        if (guardOff) { if (cu) { abandoned++; cu = null } }
        else if (forceNormal) { if (cu) { abandoned++; cu = null } } // main.ts: restForceNormal skips the hold for this one frame
        else {
          const act = restCatchUpPlan(cu ?? { frames: 0, since: t }, t, unmet, moving || sunMoving, on, predictRestMs(model, unmet), o.budget, model.c0)
          if (act === 'build' && resizePending) { abandoned++; aborts++; cu = null; kind = 'abort'; needsRefine = true; forceNormal = !o.legacyResize } // build-only frame finds the canvas size changed: nothing drawn, hold dropped
          else if (act === 'build') { cu ??= { frames: 0, since: t }; cu.frames++; builds++; unmet = Math.max(0, unmet - per); needsRefine = true; kind = 'hold' }
          else {
            if (cu) { if (act === 'abandon') abandoned++; cu = null }
            if (act === 'draw') pending = { unmet }
          }
        }
      }
    } else if (!gestureOn && !needsRefine) continue
    // A tile arriving at tileAt (tiles.onChange -> markDirty) sets otherDirty and nulls fadeOnly; the fade follows the crossfade's own state (fadeLeft), so it does not stall.
    if (kind === 'mid') fadeLeft = FADE_MS
    else if (kind === 'hold' && fadeLeft > 0) { fadeLeft -= dt; kind = 'fade' } // the final pass redraws over the mid scene: a presented frame
    if (kind === 'full' || kind === 'mid') { resizePending = false; forceNormal = false } // a normal draw resizes the canvas
    if (kind !== 'hold' && kind !== 'abort') presented.push(kind)
  }
  return { presented, builds, abandoned, aborts, model }
}
{
  const unmetFn = { unmet0: 40, fullMs: (u: number) => 10 + 3 * u } // 130 ms holey, 10 ms complete
  // Off, or nothing unmet: today's picture sequence.
  const today = runGesture(5, 0.35).scales.map((x) => (x === 1 ? 'full' : x === REFINE_MID_SCALE ? 'mid' : 'motion'))
  const known = foldRestCost(EMPTY_REST_COST, 40, 130)
  assert.deepEqual(runRelease(5, 0.35, { on: false, ...unmetFn, model: known }).presented, today, '?restcache=0 reproduces today')
  assert.deepEqual(runRelease(5, 0.35, { unmet0: 0, model: known }).presented, today, 'nothing unmet: the full frame at once')
  // (b) unknown prediction: DRAW, exactly today (the first release on a page); that frame is the learning sample.
  const first = runRelease(5, 0.35, unmetFn)
  assert.deepEqual(first.presented, today, 'unknown cost: today')
  assert.equal(first.builds, 0)
  assert.deepEqual(first.model.holey, { ms: 130, unmet: 40 }, 'the first full frame is the sample (wall-priced)')
  // Learned: the next release holds; presented pictures: motion, mid, the mid fading in during the hold, then ONE full.
  const learned = runRelease(5, 0.35, { ...unmetFn, model: first.model })
  assert.ok(learned.builds >= 4 && learned.builds <= 20, 'builds ' + learned.builds)
  assert.equal(learned.presented.filter((x) => x === 'full').length, 1, 'one full frame')
  const seq = learned.presented.join(',')
  assert.match(seq, /^(motion,){5}mid,(fade,)+full$/, 'motion, mid, mid fading in during the hold (never frozen at blend 0), full: ' + seq)
  assert.ok(Number.isFinite(learned.model.c0) || learned.model.holey !== null, 'the draw after a hold is a new sample')
  // (c) fixed cost: ms = c0 + k * unmet. A complete-cache frame gives c0; without it the fixed term is unknown (0) and a nearly complete cache is under-predicted.
  const withC0 = foldRestCost(first.model, 0, 10)
  assert.equal(predictRestMs(withC0, 0), 10, 'a complete cache is predicted at the fixed cost, not at 0')
  assert.equal(predictRestMs(withC0, 10), 10 + 10 * ((130 - 10) / 40))
  assert.equal(predictRestMs(first.model, 0), 0)
  assert.ok(predictRestMs(first.model, 10) < predictRestMs(withC0, 10), 'an unknown c0 under-predicts a nearly complete cache')
  // (a) The GPU query under-reads (Metal 5-7x): the wall gap prices the sample.
  const m5 = runRelease(5, 0.35, { ...unmetFn, queryMs: () => 130 / 6 })
  assert.equal(m5.model.holey?.ms, 130, 'wall time floors an under-reading query')
  assert.equal(restFrameMs(20, 130, false), 130)
  assert.equal(restFrameMs(200, 130, false), 200, 'a dearer query wins')
  assert.equal(restFrameMs(20, 130, true), 20, 'a hidden page has no wall time')
  assert.equal(restFrameMs(-1, 5000, false), 1000, 'capped at 1 s')
  assert.equal(restFrameMs(-1, 130, true), 0, 'hidden and no query: no price')
  assert.equal(foldRestCost(first.model, 40, 0), first.model, 'a zero price is ignored')
  // A tile arriving mid-hold does not stall the mid picture's fade: the same fade frames as without it, then one full frame.
  const fadeCount = (x: Rel): number => x.presented.filter((k) => k === 'fade').length
  const tileHold = runRelease(5, 0.35, { ...unmetFn, model: first.model, perLayerBuilt: 1, tileAt: 10 })
  const plainHold = runRelease(5, 0.35, { ...unmetFn, model: first.model, perLayerBuilt: 1 })
  assert.equal(fadeCount(tileHold), fadeCount(plainHold), 'a tile arriving mid-hold leaves the fade running')
  assert.equal(fadeCount(plainHold), Math.ceil(FADE_MS / 16), 'the whole crossfade runs during the hold')
  assert.equal(tileHold.presented.at(-1), 'full')
  // c0 over the budget: holding cannot help, so the release draws at once (even with holes); c0 under budget with the holes pushing it over holds.
  const slowFrame = foldRestCost(foldRestCost(EMPTY_REST_COST, 40, 400), 0, 120)
  assert.equal(runRelease(5, 0.35, { ...unmetFn, model: slowFrame }).builds, 0, 'c0 over budget: draw at once')
  const fitsComplete = foldRestCost(foldRestCost(EMPTY_REST_COST, 40, 130), 0, 10)
  assert.ok(runRelease(5, 0.35, { ...unmetFn, model: fitsComplete }).builds > 0, 'c0 under budget, holes push it over: hold')
  // Under budget: draw at once whatever is unmet.
  const cheap = runRelease(5, 0.35, { unmet0: 4, fullMs: () => 20, model: foldRestCost(EMPTY_REST_COST, 4, 20) })
  assert.deepEqual(cheap.presented, today, 'predicted under budget: draw at once')
  assert.equal(runRelease(5, 0.35, { ...unmetFn, model: first.model, budget: 200 }).builds, 0, 'a larger budget draws')
  // Bounds: frames, then time; the full frame is drawn once.
  const dear = foldRestCost(EMPTY_REST_COST, 500, 500)
  const stuck = runRelease(3, 0.5, { unmet0: 500, perLayerBuilt: 0, dtMs: 1, fullMs: () => 500, model: dear })
  assert.equal(stuck.builds, REST_CATCHUP_MAX_FRAMES, 'bounded by REST_CATCHUP_MAX_FRAMES')
  assert.equal(stuck.presented.filter((x) => x === 'full').length, 1)
  const slow = runRelease(3, 0.5, { unmet0: 500, perLayerBuilt: 0, dtMs: 100, fullMs: () => 500, model: dear })
  assert.equal(slow.builds, Math.ceil(REST_CATCHUP_MAX_MS / 100), 'bounded by REST_CATCHUP_MAX_MS')
  // Abandon: camera movement, the Sun moving (a scrub or a date crossfade feed the same input), the canvas-size abort, the guard going false.
  const held = { ...unmetFn, model: first.model, perLayerBuilt: 1 }
  for (const [name, o] of [['camera movement', { moveAt: 8 }], ['the Sun moving', { sunMovingAt: 8 }], ['a canvas-size change', { resizeAt: 8 }], ['the guard going false', { guardOffAt: 8 }]] as const) {
    const r = runRelease(3, 0.5, { ...held, ...o })
    assert.equal(r.abandoned, 1, name + ' abandons the hold')
    assert.equal(r.presented.at(-1), 'full', 'and the release still ends at full size after ' + name)
  }
  // A review replay: motionScale 0.7 goes straight to the full step. A resize during the hold must not re-arm it: the frame after the abort is a normal full frame.
  for (const ms of [0.35, 0.5, 0.7]) {
    const r = runRelease(3, ms, { ...held, resizeAt: 8, unmet0: 400 })
    assert.equal(r.aborts, 1, `motionScale ${ms}: exactly one abort`)
    assert.ok(r.presented.includes('full'), `motionScale ${ms}: a normal full frame renders after the abort`)
    assert.equal(r.presented.at(-1), 'full')
  }
  const bad = runRelease(3, 0.7, { ...held, resizeAt: 8, unmet0: 400, legacyResize: true })
  assert.ok(bad.aborts > 20 && !bad.presented.includes('full'), 'the pre-fix loop aborts without end and never draws (the bug this guards)')
}
{
  const fresh = { frames: 0, since: 1000 }
  assert.equal(restCatchUpPlan(fresh, 1000, 5, false, true, 80), 'build')
  assert.equal(restCatchUpPlan(fresh, 1000, 5, false, true), 'draw', 'unknown prediction draws')
  assert.equal(restCatchUpPlan(fresh, 1000, 0, false, true, 80), 'draw', 'nothing unmet')
  assert.equal(restCatchUpPlan(fresh, 1000, 5, false, false, 80), 'draw', 'switched off')
  assert.equal(restCatchUpPlan(fresh, 1000, 5, true, true, 80), 'abandon', 'moving')
  assert.equal(restCatchUpPlan({ frames: REST_CATCHUP_MAX_FRAMES - 1, since: 1000 }, 1001, 5, false, true, 80), 'build')
  assert.equal(restCatchUpPlan({ frames: REST_CATCHUP_MAX_FRAMES, since: 1000 }, 1001, 5, false, true, 80), 'draw', 'frame bound')
  assert.equal(restCatchUpPlan(fresh, 1000 + REST_CATCHUP_MAX_MS - 1, 5, false, true, 80), 'build')
  assert.equal(restCatchUpPlan(fresh, 1000 + REST_CATCHUP_MAX_MS, 5, false, true, 80), 'draw', 'time bound')
  assert.equal(restCatchUpPlan(fresh, 0, 0, false, true, 500), 'draw', 'cache complete: no hold, however dear')
  assert.equal(restCatchUpPlan(fresh, 0, 9, false, true, REST_BUDGET_MS), 'draw', 'at the budget')
  assert.equal(restCatchUpPlan(fresh, 0, 9, false, true, REST_BUDGET_MS + 1), 'build')
  assert.ok(Number.isNaN(predictRestMs(EMPTY_REST_COST, 10)))
  // The fixed cost: holes must be what pushes the frame over.
  assert.equal(restCatchUpPlan(fresh, 0, 9, false, true, 200, REST_BUDGET_MS, REST_BUDGET_MS + 1), 'draw', 'c0 above the budget: draw at once')
  assert.equal(restCatchUpPlan(fresh, 0, 9, false, true, 200, REST_BUDGET_MS, REST_BUDGET_MS), 'build', 'c0 at the budget, holes push it over: hold')
  assert.equal(restCatchUpPlan(fresh, 0, 9, false, true, 200, REST_BUDGET_MS, 10), 'build', 'c0 under budget, holes push it over: hold')
  assert.equal(restCatchUpPlan(fresh, 0, 9, false, true, 200, REST_BUDGET_MS, NaN), 'build', 'c0 unknown: the earlier rule')
}

// ---- Rest to motion (WP-A, 2026-10-23), `?settle=stepped`: the full-size frame of the hand-back is one submit only when it fits two vsyncs; a dearer one waits for the quiet spell and then goes in bands. ----
{
  const v60 = 1000 / 60, v120 = 1000 / 120
  assert.equal(settleFullAffordable(117, v60), false, "the owner's 117 ms full frame is not one submit")
  assert.equal(settleFullAffordable(30, v60), true, 'inside two vsyncs at 60 Hz')
  assert.equal(settleFullAffordable(30, v120), false, 'but not at 120 Hz (two vsyncs are 16.7 ms)')
  assert.equal(settleFullAffordable(0, v60), false, 'unknown is not affordable (the caller falls back to the query rule)')
  // The wait: only stepped, only a dear frame, only inside the quiet spell. The phone's banded hand-back (not stepped) never waits.
  assert.equal(settleWaits(true, true, 300, 100), true, 'a press 100 ms after the release would land on the full frame: hold it')
  assert.equal(settleWaits(true, true, 300, 300), false, 'the spell is over: draw (in bands)')
  assert.equal(settleWaits(true, false, 300, 100), false, 'a cheap full frame never waits')
  assert.equal(settleWaits(true, true, 0, 100), false, '?settlequiet=0: at once, in bands')
  assert.equal(settleWaits(false, true, 300, 100), false, 'not stepped (the phone path): unchanged')
  assert.equal(settleQuietFromSearch(''), SETTLE_QUIET_MS); assert.equal(settleQuietFromSearch('?settlequiet=0'), 0); assert.equal(settleQuietFromSearch('?settlequiet=150'), 150); assert.equal(settleQuietFromSearch('?settlequiet=-5'), SETTLE_QUIET_MS)
  // The loop, as it drives the stepped settle at 60 Hz with a 117 ms full frame and a 0.5 motion grid: mid frame at once, then nothing until the spell is over, then the full frame (banded, 3 bands of <= 50 ms).
  const frames: string[] = []
  let refineStep = 0, needsRefine = false, gestureOn = true
  const releaseAt = 1000
  for (let f = 0; f < 40; f++) {
    const now = releaseAt + f * v60
    if (!needsHandBack(false, gestureOn, needsRefine)) { frames.push('idle'); continue }
    gestureOn = false
    const affordable = settleFullAffordable(117, v60)
    // The production decision (handBackPlan, which main.ts calls): the hold leaves refineStep at 1 (mid done, full pending) so the mid frame is not planned again; the first version reset it to 0 and redrew the mid frame every other frame.
    const plan = handBackPlan({ refineStep, motionScale: 0.5, forced: false, noRefine: false, catchUp: false, skipMid: affordable, stepped: true, quietMs: 300, sinceMoveMs: now - releaseAt, dearFull: bandCount(117, 50) > 1, capture: false })
    refineStep = plan.refineStep; needsRefine = plan.needsRefine
    if (plan.held) { frames.push('wait'); continue }
    frames.push(plan.scale === 1 ? `full x${bandCount(117, 50)}` : `mid ${plan.scale}`)
  }
  assert.equal(frames[0], 'mid 0.7', 'the mid frame is drawn at once')
  assert.ok(frames.slice(1, 18).every((x) => x === 'wait'), `holds through the 300 ms spell: ${frames.slice(0, 20).join(',')}`)
  assert.equal(frames[18], 'full x3', 'then the full frame, in three bands of at most 50 ms: no single 117 ms submit')
  assert.ok(frames.slice(19).every((x) => x === 'idle'), 'and the hand-back is done')
}

// Review item 9: the REAL scheduling transitions of the stepped settle at the owner's 613 ms frame (120 Hz), driven as main.ts drives them: a real FramePacer
// with fake fences and a one-queue GPU model, bands one per signalled fence, the crossfade redraws while the full frame is held, a press that cancels the band
// sequence and waits for at most the one band in flight, and never more than one rest submit outstanding.
{
  const done = new Set<number>(); let fences = 0
  const gl: FenceGl = { SYNC_GPU_COMMANDS_COMPLETE: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3, fenceSync: () => ({ id: ++fences }), deleteSync: () => {}, flush: () => {}, clientWaitSync: (s) => (done.has((s as { id: number }).id) ? 2 : 4) }
  const pacer = new FramePacer()
  const V = 1000 / 120, BAND = 50, FULL = 613, QUIET = 300, FADE = 250
  const pending: Array<{ id: number; at: number }> = []
  let gpuFree = 0, maxOutstanding = 0, maxSubmitMs = 0
  const submit = (t: number, ms: number): void => { pacer.drew(gl, t, false, { id: 1 }); pending.push({ id: fences, at: Math.max(gpuFree, t) + ms }); gpuFree = Math.max(gpuFree, t) + ms; maxOutstanding = Math.max(maxOutstanding, pacer.inFlight); maxSubmitMs = Math.max(maxSubmitMs, ms) }
  const signal = (t: number): void => { for (const p of pending) if (p.at <= t) done.add(p.id) }
  const log: string[] = []
  const release = 1000, press = 1000 + 900, drag = 200
  let gestureOn = true, needsRefine = false, refineStep = 0, band: { k: number; n: number; scale: number } | null = null, fadeEnd = -1, sharpAt = -1, pressFirstDrawAt = -1
  for (let f = 0; f < 400; f++) {
    const now = release + f * V
    signal(now)
    const moving = now >= press && now < press + drag
    if (moving) {
      if (band) { band = null; log.push('cancel') }
      if (!gestureOn) { if (pacer.shouldHoldRest(gl, now, false)) { log.push('presswait'); continue } gestureOn = true; refineStep = 0; pressFirstDrawAt = now }
      pacer.shouldHoldRest(gl, now, true) // the gesture polls, never holds
      log.push('motion'); continue // motion frames are not fenced
    }
    if (pacer.shouldHoldRest(gl, now, false)) { log.push('held'); continue }
    let scale: number
    if (band) scale = band.scale
    else if (needsHandBack(false, gestureOn, needsRefine)) {
      gestureOn = false
      const lastMove = now >= press + drag ? press + drag : release // the last camera move so far
      const plan = handBackPlan({ refineStep, motionScale: 0.5, forced: false, noRefine: false, catchUp: false, skipMid: settleFullAffordable(FULL, V), stepped: true, quietMs: QUIET, sinceMoveMs: now - lastMove, dearFull: bandCount(FULL, BAND, BAND_MAX_STEPPED) > 1, capture: false })
      scale = plan.scale; refineStep = plan.refineStep; needsRefine = plan.needsRefine
      if (plan.held) {
        if (now < fadeEnd) log.push('fade') // the mid frame's crossfade is redrawn as a final-only pass while the full frame waits (review item 1)
        else log.push('wait')
        continue
      }
    } else continue // idle
    if (!band) { const n = bandCount(FULL * scale * scale, BAND, BAND_MAX_STEPPED); band = { k: 0, n, scale } }
    submit(now, FULL * scale * scale / band.n)
    log.push(`band${scale}:${band.k + 1}/${band.n}`)
    if (band.k === band.n - 1) { if (scale < 1) fadeEnd = now + FADE; else sharpAt = now; band = null } else band.k++
  }
  const countIn = (part: string[], s: string): number => part.filter((x) => x === s || x.startsWith(s)).length
  const beforePress = log.slice(0, log.indexOf('motion')), afterPress = log.slice(log.indexOf('motion'))
  assert.equal(countIn(beforePress, 'band0.7:'), 7, `the mid frame goes in 7 bands: ${beforePress.slice(0, 30).join(',')}`)
  assert.ok(countIn(beforePress, 'held') >= 6, 'each band waited for the previous one to signal')
  assert.ok(countIn(beforePress, 'fade') > 0 || countIn(beforePress, 'wait') === 0, 'the crossfade is redrawn while the full frame waits (or the spell was already over when the mid completed)')
  assert.ok(maxSubmitMs <= BAND, `no submit over the band budget (${maxSubmitMs})`)
  assert.equal(maxOutstanding, 1, 'never more than one rest submit outstanding')
  const fullBefore = countIn(beforePress, 'band1:')
  assert.ok(fullBefore >= 1 && fullBefore < 13 && beforePress.includes('cancel'), `the full frame had started in bands (${fullBefore} of 13) and the press cancelled the sequence`)
  assert.ok(countIn(afterPress, 'presswait') <= 1, `the press waited for at most the one band in flight (${countIn(afterPress, 'presswait')})`)
  assert.ok(pressFirstDrawAt - press <= 2 * V + BAND, `first motion draw ${Math.round(pressFirstDrawAt - press)} ms after the press`)
  assert.ok(!afterPress.slice(0, 20).includes('held'), 'motion frames are never held')
  assert.equal(countIn(afterPress, 'band1:'), 13, 'after the second release the full frame goes in 13 bands')
  assert.ok(sharpAt > press + drag, 'the picture reached full size after the second release')
  // What the stepped settle costs in time-to-sharp at this frame cost: the mid bands, then (the rest of the quiet spell), then the full bands.
  const ttsMs = sharpAt - (press + drag)
  assert.ok(ttsMs > 900 && ttsMs < 1700, `time-to-sharp under the stepped settle at 613 ms / 120 Hz: ${Math.round(ttsMs)} ms (the reviewers' 1.3-1.6 s estimate; today's single frame is about 0.7 s)`)
}

// Review item 2: a dear full frame whose band gate is shut is deferred, bounded, never one unbanded submit.
assert.equal(settleDefers(true, true, true, 0), true)
assert.equal(settleDefers(true, true, true, SETTLE_DEFER_MAX_MS - 1), true)
assert.equal(settleDefers(true, true, true, SETTLE_DEFER_MAX_MS), false, 'bounded: after the cap it draws whatever the gate says')
assert.equal(settleDefers(true, true, false, 0), false, 'gate open: bands')
assert.equal(settleDefers(true, false, true, 0), false, 'a cheap frame is never deferred')
assert.equal(settleDefers(false, true, true, 0), false, 'not stepped: today')

// `?pressyield=1`: the first 300 ms after a pointerdown (a stationary press included) upload nothing and build nothing.
{
  assert.equal(pressYieldActive(true, 1000, 900), true)
  assert.equal(pressYieldActive(true, 1000 + PRESS_YIELD_MS - 1, 1000), true)
  assert.equal(pressYieldActive(true, 1000 + PRESS_YIELD_MS, 1000), false, 'the window closes at 300 ms')
  assert.equal(pressYieldActive(false, 1000, 900), false, 'switch off: today')
  assert.equal(pressYieldActive(true, 500, 1000), false, 'a press in the future (clock skew) is no press')
  assert.equal(pressYieldActive(true, 1000, -1e9), false, 'no press yet')
  assert.equal(uploadsThisFrame({ yield: true }), 0, 'no tile upload in the yield window')
  assert.equal(uploadsThisFrame({ yield: true, moving: true }), 0)
  assert.equal(uploadsThisFrame({ moving: true }), 1, 'a gesture frame without the yield: one, as before')
}
console.log('gesture-release ok')

// handBackPlan itself: the cases main.ts relies on.
{
  const base = { refineStep: 0, motionScale: 0.5, forced: false, noRefine: false, catchUp: false, skipMid: false, stepped: true, quietMs: 300, sinceMoveMs: 100, dearFull: true, capture: false }
  assert.deepEqual(handBackPlan(base), { scale: REFINE_MID_SCALE, refineStep: 1, needsRefine: true, held: false }, 'the mid frame first, never held')
  assert.deepEqual(handBackPlan({ ...base, refineStep: 1 }), { scale: 1, refineStep: 1, needsRefine: true, held: true }, 'a dear full frame inside the spell is held, full still pending')
  assert.equal(handBackPlan({ ...base, refineStep: 1, sinceMoveMs: 300 }).held, false, 'spell over: draw')
  assert.equal(handBackPlan({ ...base, refineStep: 1, catchUp: true }).held, false, 'a catch-up in progress is never held')
  assert.equal(handBackPlan({ ...base, refineStep: 1, capture: true }).held, false, 'a capture is never held')
  assert.equal(handBackPlan({ ...base, refineStep: 1, forced: true }).held, false, 'a forced scale is never held')
  assert.equal(handBackPlan({ ...base, refineStep: 1, stepped: false }).held, false, 'not stepped: today')
}
