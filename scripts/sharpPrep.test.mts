// ?sharp=1 "Preparing the flight" (quality/sharpPrep.ts): the residency-gated beat, the warm-up grid measurement, the flight-only texel rule, and the
// main.ts wiring pins. No browser, no GPU: the clocks and the timings are fed by hand.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import {
  FlightPrep, PREP_DWELL_MS, PREP_FRACTION, PREP_MAX_MS, PREP_MAX_MS_COLD, PREP_POSES, PREP_RESIDENCY, PREP_TEXT, PREP_WARM_RESERVE_MS, SharpWarm, WARM_POST_FACTOR,
  prepPoseUs, prepWanted, warmPoseUs,
} from '../src/quality/sharpPrep.ts'
import { SHARP_FLIGHT_BUDGET_MS, SHARP_FIT, SHARP_OFF, measuredGridFor, resolveSharp, setMeasuredGrid, sharpFlightGrid, sharpFlightStart, sharpGridSource } from '../src/quality/sharp.ts'
import { WANT_TEXELS, WANT_TEXELS_FLIGHT, computeWanted, wantedMemoKey, type StreamView } from '../src/moon/tiles/wanted.ts'
import { MOON_R_KM, pageWidth } from '../src/moon/tiles/grid.ts'
import { levelRow } from '../src/moon/tiles/levels.ts'
import { flightPrefetchTargets } from '../src/net/flightPrefetch.ts'

const on = resolveSharp('phone-android', '?sharp=1')

test('the beat is for sharp visitors with tiles only', () => {
  const ok = { instant: false, hasTiles: true, still: false, capture: false }
  assert.equal(prepWanted(on, ok), true)
  assert.equal(prepWanted(SHARP_OFF, ok), false, 'default path: no beat')
  assert.equal(prepWanted(on, { ...ok, instant: true }), false)
  assert.equal(prepWanted(on, { ...ok, hasTiles: false }), false)
  assert.equal(prepWanted(on, { ...ok, still: true }), false)
  assert.equal(prepWanted(on, { ...ok, capture: true }), false)
  assert.equal(PREP_TEXT, 'Preparing the flight')
  assert.ok(!/\d|byte|MB|tile/i.test(PREP_TEXT), 'plain words, no numbers or technical text')
})

test('poses: the first 30 % of the remaining path; warm poses span all of it', () => {
  const us = prepPoseUs(0)
  assert.equal(us.length, PREP_POSES)
  assert.equal(us[0], 0)
  assert.ok(Math.abs(us[us.length - 1] - PREP_FRACTION) < 1e-12)
  const resumed = prepPoseUs(0.5)
  assert.equal(resumed[0], 0.5)
  assert.ok(Math.abs(resumed[resumed.length - 1] - (0.5 + 0.5 * PREP_FRACTION)) < 1e-12, 'a resumed flight prepares the part still to fly')
  const w = warmPoseUs(0)
  assert.deepEqual(w.map((x) => +x.toFixed(2)), [0, 0.33, 0.67, 1])
  assert.equal(warmPoseUs(0.4)[3], 1)
})

test('streaming phase ends at 95 % exact residency over every pose, not before', () => {
  const p = new FlightPrep(PREP_MAX_MS, false, null)
  p.begin(1000)
  assert.equal(p.advance(1000), true)
  // three poses at 100 %, the fourth not yet probed: still holding
  for (let i = 0; i < 3; i++) p.observe(i, 100, 100)
  assert.equal(p.advance(1500), true, 'a pose never probed is not resident')
  p.observe(3, 100, 90)
  assert.ok(Math.abs((p.residency() ?? 0) - 390 / 400) < 1e-12)
  assert.equal(p.advance(2000), false, '97.5 % >= 95 %')
  assert.equal(p.endedBy, 'resident')
  assert.ok(p.endedAt >= 0 && p.endedAt <= 1500)
  p.observe(3, 100, 0)
  assert.equal(p.phase, 'done', 'done stays done')
  assert.ok(PREP_RESIDENCY === 0.95)
})

test('the cap: 5 s, 6 s on a cold first play; a pose that wants nothing is resident', () => {
  for (const [cold, max] of [[false, PREP_MAX_MS], [true, PREP_MAX_MS_COLD]] as const) {
    const p = new FlightPrep(max, cold, null)
    p.begin(0)
    for (let i = 0; i < PREP_POSES; i++) p.observe(i, 100, 50)
    assert.equal(p.advance(max - 1), true)
    assert.equal(p.advance(max), false)
    assert.equal(p.endedBy, 'cap')
  }
  assert.equal(PREP_MAX_MS, 5000); assert.equal(PREP_MAX_MS_COLD, 6000)
  const q = new FlightPrep(PREP_MAX_MS, false, null)
  q.begin(0)
  for (let i = 0; i < PREP_POSES; i++) q.observe(i, 0, 0)
  assert.equal(q.residency(), 1)
  assert.equal(q.advance(10), true, 'an empty want on the first sweep is not ready (not enqueued yet)')
  for (let i = 0; i < PREP_POSES; i++) q.observe(i, 0, 0)
  assert.equal(q.advance(20), false, 'still empty after every pose was probed twice: nothing to wait for')
  assert.equal(q.endedBy, 'resident')
})

test('an empty want that fills in later keeps the camera held until it is resident', () => {
  const p = new FlightPrep(PREP_MAX_MS, false, null)
  p.begin(0)
  for (let i = 0; i < PREP_POSES; i++) p.observe(i, 0, 0)
  assert.equal(p.advance(10), true)
  for (let i = 0; i < PREP_POSES; i++) p.observe(i, 71, 0)
  assert.equal(p.advance(20), true, '71 wanted, none resident')
  assert.equal(p.residentReady(), false)
})

test('streaming rotates through the poses far to near; probes are rate limited and round robin', () => {
  const p = new FlightPrep(PREP_MAX_MS, false, null)
  p.begin(0)
  const seq = [0, 1, 2, 3, 4].map((k) => p.poseIndex(k * PREP_DWELL_MS + 1))
  assert.deepEqual(seq, [3, 2, 1, 0, 3])
  assert.equal(p.probeDue(0), 0)
  assert.equal(p.probeDue(PREP_DWELL_MS - 1), null)
  assert.equal(p.probeDue(PREP_DWELL_MS), 1)
  assert.equal(p.probeDue(2 * PREP_DWELL_MS), 2)
})

test('progress is monotone and reaches 1 only when done', () => {
  const p = new FlightPrep(PREP_MAX_MS, false, null)
  p.begin(0)
  let last = 0
  for (const [t, res] of [[100, 0.2], [600, 0.6], [900, 0.4], [1500, 0.9]] as const) {
    for (let i = 0; i < PREP_POSES; i++) p.observe(i, 100, res * 100)
    const f = p.progress(t)
    assert.ok(f >= last && f < 1, `${t}: ${f}`)
    last = f
  }
  p.cancel(2000)
  assert.equal(p.progress(2000), 1)
  assert.equal(p.endedBy, 'cancelled')
  assert.equal(p.advance(2100), false)
})

function runWarm(w: SharpWarm, msAt: (grid: number, pose: number) => number | null): Array<[number, number, boolean]> {
  const steps: Array<[number, number, boolean]> = []
  for (let guard = 0; guard < 100; guard++) {
    const s = w.next()
    if (!s) break
    steps.push([s.grid, s.pose, s.timed])
    w.record(s.timed ? msAt(s.grid, s.pose) : 0)
  }
  return steps
}

test('warm-up: a settle draw then four timed draws per grid, ascending; the finest that fits wins', () => {
  const w = new SharpWarm()
  const steps = runWarm(w, (g) => 5 + 40 * g * g) // 0.5: 15 ms, 0.7: 24.6 ms, 1: 45 ms (moon pass only)
  assert.equal(steps.length, 3 * 5)
  assert.deepEqual(steps.slice(0, 5), [[0.5, 0, false], [0.5, 0, true], [0.5, 1, true], [0.5, 2, true], [0.5, 3, true]])
  assert.equal(w.complete, true)
  const r = w.result()
  assert.equal(r.source, 'measured')
  const limit = SHARP_FIT * SHARP_FLIGHT_BUDGET_MS
  const fits = (g: number): boolean => (5 + 40 * g * g) * WARM_POST_FACTOR <= limit
  assert.equal(r.grid, [1, 0.7, 0.5].find(fits) ?? 0.5)
  assert.equal(r.grid, 0.5, 'with these numbers 0.7 costs 24.6 x 1.2 = 29.5 ms > 28.3')
})

test('warm-up: the worst pose counts; a fast device gets 1; nothing fitting gives the coarsest', () => {
  const fast = new SharpWarm(); runWarm(fast, () => 5)
  assert.equal(fast.result().grid, 1)
  const spike = new SharpWarm(); runWarm(spike, (g, pose) => (pose === 2 ? 40 : 5))
  assert.equal(spike.result().grid, 0.5, 'one dear pose in every grid forces the coarsest: the worst of the poses decides')
  const slow = new SharpWarm(); const steps = runWarm(slow, () => 60)
  assert.equal(slow.result().grid, 0.5)
  assert.equal(slow.result().source, 'measured')
  assert.equal(steps.length, 5, 'a grid already 2 budgets over ends the search: finer grids are not drawn')
})

test('warm-up: the per-flight ceiling; unavailable or implausible timing falls back to the table', () => {
  const capped = new SharpWarm(undefined, 0.5)
  const steps = runWarm(capped, () => 2)
  assert.ok(steps.every(([g]) => g <= 0.5), 'grids above the flight ceiling are never drawn')
  assert.equal(capped.result().grid, 0.5)
  const none = new SharpWarm(); runWarm(none, () => null)
  assert.deepEqual([none.result().grid, none.result().source], [null, 'table'])
  assert.equal(none.complete, true)
  const zero = new SharpWarm(); runWarm(zero, () => 0.01)
  assert.equal(zero.result().source, 'table', 'a draw timed under 0.5 ms is a finish() that did not wait')
  const cut = new SharpWarm(); cut.next(); cut.record(0); cut.next(); cut.record(5)
  assert.equal(cut.result().source, 'table', 'cut short inside the first grid: nothing complete')
})

test('the beat hands warm-up time to the end of its budget', () => {
  const w = new SharpWarm()
  const p = new FlightPrep(PREP_MAX_MS, false, w)
  p.begin(0)
  // streaming runs to its early cap when the tiles never get resident
  assert.equal(p.advance(PREP_MAX_MS - PREP_WARM_RESERVE_MS - 1), true); assert.equal(p.phase, 'stream')
  assert.equal(p.advance(PREP_MAX_MS - PREP_WARM_RESERVE_MS), true); assert.equal(p.phase, 'warm')
  assert.equal(p.endedBy, 'cap')
  assert.equal(p.advance(PREP_MAX_MS - 1), true)
  assert.equal(p.advance(PREP_MAX_MS), false, 'the warm-up never runs past the cap')
  assert.equal(p.phase, 'done')
  // resident early: warm-up starts at once, ends when the plan completes
  const w2 = new SharpWarm(), q = new FlightPrep(PREP_MAX_MS, false, w2)
  q.begin(0)
  for (let i = 0; i < PREP_POSES; i++) q.observe(i, 10, 10)
  assert.equal(q.advance(400), true); assert.equal(q.phase, 'warm')
  runWarm(w2, () => 5)
  assert.equal(q.advance(900), false)
  // a second play of a flight that already has a measurement carries no warm-up
  const r = new FlightPrep(PREP_MAX_MS, false, null)
  r.begin(0)
  for (let i = 0; i < PREP_POSES; i++) r.observe(i, 10, 10)
  assert.equal(r.advance(10), false)
})

test('the measured grid wins over the class table, capped by the flight ceiling', () => {
  assert.equal(sharpGridSource('x-flight'), 'table')
  assert.equal(sharpFlightGrid('phone-android', 'tycho-rim'), 0.7)
  setMeasuredGrid('tycho-rim', 1)
  assert.equal(measuredGridFor('tycho-rim'), 1)
  assert.equal(sharpFlightGrid('phone-android', 'tycho-rim'), 1)
  assert.equal(sharpGridSource('tycho-rim'), 'measured')
  assert.equal(sharpFlightStart(on, 'phone-android', 0.35, 'tycho-rim'), 1)
  assert.equal(sharpFlightStart(SHARP_OFF, 'phone-android', 0.35, 'tycho-rim'), 0.35, 'sharp off: the measurement is not read')
  setMeasuredGrid('terminator-run', 0.7)
  assert.equal(sharpFlightGrid('phone-android', 'terminator-run'), 0.5, 'the terminator run keeps its ceiling')
  assert.equal(sharpFlightGrid('phone-android', 'copernicus-flyover'), 0.7, 'another flight keeps the table')
  setMeasuredGrid('tycho-rim', null); setMeasuredGrid('terminator-run', null)
  assert.equal(sharpFlightGrid('phone-android', 'tycho-rim'), 0.7)
})

function viewOver(dist: number, texels?: number): StreamView {
  const d = Math.PI / 180, w = 2400, h = 1360
  const dir = new THREE.Vector3(1, 0, 0)
  const nadir = dir.clone().negate()
  const right = new THREE.Vector3(0, 1, 0), up = new THREE.Vector3(0, 0, 1)
  const tanH = Math.tan(15 * d)
  return { pos: dir.clone().multiplyScalar(dist), right, up, back: nadir.clone().negate(), tanHalf: tanH, aspect: w / h, tanPerPx: 2 * tanH / h, moonX: new THREE.Vector3(1, 0, 0), moonY: new THREE.Vector3(0, 1, 0), moonZ: new THREE.Vector3(0, 0, 1), flight: true, texels }
}

test('flight texels: one texel per pixel wants coarser, fewer tiles; absent means WANT_TEXELS', () => {
  assert.equal(WANT_TEXELS, 2); assert.equal(WANT_TEXELS_FLIGHT, 1)
  const pw = pageWidth(0)
  const ctx = { deepest: 0, isPresent: () => true, keyOf: (l: number, tx: number, ty: number) => (levelRow(l) + ty) * pw + tx }
  const dist = 1 + 120 / MOON_R_KM
  const base = computeWanted(viewOver(dist), ctx), same = computeWanted(viewOver(dist, WANT_TEXELS), ctx), flight = computeWanted(viewOver(dist, WANT_TEXELS_FLIGHT), ctx)
  assert.equal(base.size, same.size, 'undefined texels is exactly the old rule')
  const finest = (m: Map<number, { level: number }>): number => Math.min(...[...m.values()].map((t) => t.level))
  assert.ok(finest(flight) >= finest(base), `finest level ${finest(flight)} >= ${finest(base)}`)
  assert.ok(flight.size <= base.size, `${flight.size} <= ${base.size}`)
  assert.ok(wantedMemoKey(viewOver(dist, 1)) !== wantedMemoKey(viewOver(dist)), 'the memo does not answer a rest view with a flight set')
  assert.equal(wantedMemoKey(viewOver(dist)), wantedMemoKey({ ...viewOver(dist), texels: undefined }))
})

test('the prefetch plan follows the same texel rule', () => {
  const at = (u: number) => ({ pose: { lon: 10 + 30 * u, lat: 5, dist: 1 + 60 / MOON_R_KM }, fovDeg: 36 })
  const run = (texels?: number) => flightPrefetchTargets(at, 20000, { aspect: 1.8, features: false, texels }).reduce((n, t) => n + t.levels.length, 0)
  assert.equal(run(), run(2), 'default is 2')
  assert.ok(run(1) <= run(), 'one texel per pixel asks for the same or coarser levels')
})

test('main.ts wiring pins', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  for (const needle of [
    'texels: sharpFlightTexels(),',
    'flightStreamView(flightCamAt(cin, us[pi]))',
    'const preparing = prepWanted(quality.sharp,',
    'const joined = !instant && flightStartU === 0 && !preparing',
    'if (flight.t0 < 0 && flight.prep && stepFlightPrep(flight, now)) return true',
    'return { text: PREP_TEXT, fraction: prep.progress(performance.now()) }',
    'setMeasuredGrid(cin.definition.id, r.grid)',
    'sharpWarmMs:', 'sharpGridSource:',
    'texels: sharpFlightTexels(true)',
  ]) assert.ok(main.includes(needle), needle)
  // The beat is reachable only from a sharp flight: the object is created behind prepWanted, and the texel rule is behind quality.sharp.on.
  assert.ok(main.includes('return quality.sharp.on && cin && (prefetch || !tween) && cin.pausedU == null ? WANT_TEXELS_FLIGHT : undefined'))
  // No per-frame upload slicing (ledger #45, #136): the beat adds no upload budget knob.
  assert.ok(!/UPLOADS_IN_FLIGHT\s*=/.test(main))
})

test('warm-up draws never build or evict cached target sets, and void scene reuse', async () => {
  const { TargetCache } = await import('../src/post/targets.ts')
  const cache = new TargetCache()
  cache.get(1920, 1080); cache.get(960, 540); cache.get(640, 360)
  const before = cache.stats()
  const full = cache.get(1920, 1080).scene // touch: 1920 is now most recent
  assert.equal(cache.warmScene(1920, 1080), full, 'a cached size is reused')
  for (const g of [0.5, 0.65, 0.8]) cache.warmScene(Math.round(1920 * g), Math.round(1080 * g))
  const after = cache.stats()
  assert.equal(after.targetBuilt, before.targetBuilt, 'no cached set built by the warm-up')
  assert.equal(after.targetEvicted, before.targetEvicted, 'no cached set evicted by the warm-up')
  assert.equal(after.targetSets, 3)
  const a = cache.warmScene(777, 437)
  assert.equal(cache.warmScene(777, 437), a, 'scratch reused at the same size')
  cache.releaseScratch()
  assert.notEqual(cache.warmScene(777, 437), a, 'released scratch is rebuilt')
  cache.releaseScratch()
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.ok(main.includes('targets.warmScene(w, h)'))
  assert.ok(!/function warmDraw[\s\S]*?targets\.get\(/.test(main.slice(main.indexOf('function warmDraw'), main.indexOf('function warmDraw') + 1500).split('/** What __moon.perf')[0]), 'warmDraw never uses targets.get')
  assert.match(main, /function voidSceneReuse\(\): void \{\s*fadeOnly = null\s*bandState = null\s*markDirty\(\)/)
  assert.match(main, /prep\.warm\.record\(warmDraw\([^\n]*\)\)\s*voidSceneReuse\(\)/)
})
