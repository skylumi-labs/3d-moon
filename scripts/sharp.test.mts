// ?sharp=1 (WP-G, quality/sharp.ts): switch and class gating, the held flight grid, the ladder's hold mode, the 30 fps cap, the knobs, the upscale choice,
// and the soft prefetch re-plan.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { CLASS_TABLE } from '../src/quality/startupClass.ts'
import { motionKnobs, sharpKnobs } from '../src/quality/apply.ts'
import { FlightScaleLadder, freshFlightHystState, flightHystStep } from '../src/quality/flightScale.ts'
import { FrameGate } from '../src/quality/frameCap.ts'
import {
  SHARP_DEFAULT, SHARP_EMERGENCY_FLOOR, SHARP_FLIGHT_BUDGET_MS, SHARP_OFF, SHARP_PREFETCH_HELD_MAX, SHARP_PREFETCH_PARALLEL, currentSharp, flightGridIsOnlyScale, flightScaleModeFor,
  pickFlightGrid, resolveSharp, setSharp, sharpFlightGrid, sharpFlightStart, sharpFpsFromSearch, sharpFromSearch, sharpGestureStart,
} from '../src/quality/sharp.ts'
import { catmullOn, upscaleMode } from '../src/post/upscale.ts'
import { PREFETCH_HELD_MAX, PREFETCH_PARALLEL, TilePrefetcher, heldMax } from '../src/net/prefetch.ts'
import { SWITCHES } from '../src/debug/switches.ts'

test('off by default; the switch parses', () => {
  assert.equal(SHARP_DEFAULT, false, 'the default stays off until the owner phone A/B')
  assert.equal(resolveSharp('phone-android', '').on, false)
  assert.equal(sharpFromSearch('?sharp=1'), true)
  assert.equal(sharpFromSearch('?sharp=0'), false)
  assert.equal(sharpFromSearch('?sharp=yes'), null)
  assert.equal(resolveSharp('phone-android', '?sharp=0', false, true).on, false, '?sharp=0 beats a flipped default')
  assert.equal(resolveSharp('phone-android', '', false, true).on, true, 'flipping the default is one constant')
})

test('classes: touch only, never the native shell', () => {
  for (const c of ['phone-android', 'ios', 'ipad', 'tablet'] as const) assert.equal(resolveSharp(c, '?sharp=1').on, true, c)
  for (const c of ['desktop', 'software'] as const) assert.equal(resolveSharp(c, '?sharp=1').on, false, c)
  assert.equal(resolveSharp('phone-android', '?sharp=1', true).on, false, 'native shell')
})

test('config and knobs: no Best preset, no ratio change, gesture start from 0.5', () => {
  const s = resolveSharp('phone-android', '?sharp=1')
  assert.deepEqual({ ...s }, { on: true, flightFps: 30, gestureStartMin: 0.5, heldMax: SHARP_PREFETCH_HELD_MAX, parallel: SHARP_PREFETCH_PARALLEL })
  const phone = CLASS_TABLE['phone-android']
  const base = motionKnobs(phone, 'auto', SHARP_OFF)
  const k = motionKnobs(phone, 'auto', s)
  assert.equal(base.motionStart, 0.35); assert.equal(k.motionStart, 0.5)
  for (const f of ['dprCap', 'closeDprCap', 'restDprCap', 'motionCaps', 'motionFixedShare'] as const) assert.equal(k[f], base[f], `${f} unchanged: gestures keep their caps`)
  assert.equal(k.dprCap, 1.5); assert.equal(k.closeDprCap, 1.25)
  assert.deepEqual(motionKnobs(phone, 'battery', s), motionKnobs(phone, 'battery', SHARP_OFF), 'Battery is the visitor choice')
  assert.equal(motionKnobs(phone, 'high', s).motionStart, 0.5)
  for (const c of ['phone-android', 'ios', 'tablet', 'desktop'] as const) for (const p of ['auto', 'high', 'battery'] as const) {
    const o = motionKnobs(CLASS_TABLE[c], p, SHARP_OFF)
    assert.deepEqual(sharpKnobs(o, SHARP_OFF), o, `${c}/${p}`)
  }
  setSharp(s)
  assert.equal(motionKnobs(phone, 'auto').motionStart, 0.5, 'the holder is what motionKnobs reads')
  assert.equal(currentSharp(), s)
  setSharp(SHARP_OFF)
  assert.equal(motionKnobs(phone, 'auto').motionStart, 0.35)
})

test('held flight grid: class and flight id', () => {
  assert.equal(sharpFlightGrid('phone-android'), 0.7); assert.equal(sharpFlightGrid('ios', 'copernicus-flyover'), 0.7)
  assert.equal(sharpFlightGrid('phone-android', 'terminator-run'), 0.5, 'the terminator run is capped at 0.5')
  assert.equal(sharpFlightGrid('tablet', 'terminator-run'), 0.5); assert.equal(sharpFlightGrid('tablet', 'tycho-rim'), 1)
  const on = resolveSharp('phone-android', '?sharp=1')
  assert.equal(sharpFlightStart(on, 'phone-android', 0.35), 0.7); assert.equal(sharpFlightStart(on, 'phone-android', 0.35, 'terminator-run'), 0.5)
  assert.equal(sharpFlightStart(SHARP_OFF, 'phone-android', 0.35), 0.35)
  assert.equal(sharpGestureStart(on, 0.35), 0.5); assert.equal(sharpGestureStart(on, 0.7), 0.7)
  assert.equal(flightScaleModeFor(on, null), 'hyst'); assert.equal(flightScaleModeFor(SHARP_OFF, null), 'old'); assert.equal(flightScaleModeFor(SHARP_OFF, 'hyst'), 'hyst')
  assert.equal(flightGridIsOnlyScale(on, true), true); assert.equal(flightGridIsOnlyScale(on, false), false); assert.equal(flightGridIsOnlyScale(SHARP_OFF, true), false)
})

test('pickFlightGrid (the warm-up decision): finest grid within 0.85 of the 33 ms budget, capped', () => {
  const b = SHARP_FLIGHT_BUDGET_MS, lim = 0.85 * b
  assert.ok(Math.abs(b - 33.33) < 0.01)
  assert.equal(pickFlightGrid([[0.5, 8], [0.7, 14], [1, 27]]), 1)
  assert.equal(pickFlightGrid([[0.5, 8], [0.7, 14], [1, lim + 0.1]]), 0.7)
  assert.equal(pickFlightGrid([[0.5, 8], [0.7, lim], [1, 60]]), 0.7, 'exactly at the limit fits')
  assert.equal(pickFlightGrid([[0.5, 20], [0.7, 40], [1, 80]]), 0.5, 'nothing fits: the coarsest candidate')
  assert.equal(pickFlightGrid([[0.5, 5], [0.7, 6], [1, 7]], b, 0.5), 0.5, 'a per-flight maximum')
  assert.equal(pickFlightGrid([[0.5, NaN], [0.7, NaN], [1, NaN]]), 0.5)
})

test('ladder hold: one grid per flight, only the emergency steps down', () => {
  const hold = { emergencyFloor: SHARP_EMERGENCY_FLOOR }
  const ladder = new FlightScaleLadder(0.7, 'hyst')
  let now = 0
  // Over budget on every frame (but under the emergency line): the grid does not move. Calm frames do not raise it either.
  for (let i = 0; i < 600; i++) { now += 33; ladder.update({ wallMs: 33, gpuMs: 40, hasGpuSource: true }, 0.25, now, hold) }
  assert.equal(ladder.current, 0.7, 'over-budget frames do not step a held grid down')
  for (let i = 0; i < 600; i++) { now += 33; ladder.update({ wallMs: 33, gpuMs: 8, hasGpuSource: true, capMs: 33 }, 0.25, now, hold) }
  assert.equal(ladder.current, 0.7, 'calm frames do not raise it')
  // Emergency: 6 frames over twice the budget, one rung each time, never under the emergency floor.
  for (let i = 0; i < 6; i++) { now += 33; ladder.update({ wallMs: 80, gpuMs: 80, hasGpuSource: true }, 0.25, now, hold) }
  assert.equal(ladder.current, 0.5, 'emergency steps down one rung')
  for (let i = 0; i < 100; i++) { now += 33; ladder.update({ wallMs: 80, gpuMs: 80, hasGpuSource: true }, 0.25, now, hold) }
  assert.equal(ladder.current, SHARP_EMERGENCY_FLOOR, 'to the emergency floor and no lower')
  // Without hold the same ladder is the old hysteresis behaviour (control).
  const open = new FlightScaleLadder(0.7, 'hyst')
  now = 0
  for (let i = 0; i < 600; i++) { now += 33; open.update({ wallMs: 33, gpuMs: 40, hasGpuSource: true }, 0.25, now) }
  assert.ok(open.current < 0.7, 'control: no hold, the budget steps it down')
})

test('capMs: a wall interval at the cap is not a miss', () => {
  const st = freshFlightHystState()
  let scale = 0.7
  for (let i = 0, t = 0; i < 400; i++) { t += 33; scale = flightHystStep(st, scale, 0.7, { wallMs: 33, gpuMs: 12, hasGpuSource: true, capMs: 1000 / 30 }, t) }
  assert.equal(scale, 1, 'cheap GPU frames at the 30 fps cap climb (non-hold ladder)')
  const st2 = freshFlightHystState()
  let scale2 = 0.7
  for (let i = 0, t = 0; i < 400; i++) { t += 33; scale2 = flightHystStep(st2, scale2, 0.7, { wallMs: 33, gpuMs: 12, hasGpuSource: true }, t) }
  assert.equal(scale2, 0.7, 'without the cap known the 33 ms walls block the climb')
})

test('flight cap: 30 fps on a 60 Hz and a 120 Hz panel; 0 and N parse', () => {
  const s = resolveSharp('phone-android', '?sharp=1')
  assert.equal(s.flightFps, 30)
  assert.equal(sharpFpsFromSearch('?sharpfps=0'), 0); assert.equal(sharpFpsFromSearch('?sharpfps=45'), 45)
  assert.equal(sharpFpsFromSearch('?sharpfps=5'), 30); assert.equal(sharpFpsFromSearch('?sharpfps=abc'), 30); assert.equal(sharpFpsFromSearch(''), 30)
  assert.equal(resolveSharp('phone-android', '?sharp=1&sharpfps=0').flightFps, 0)
  for (const hz of [60, 120]) {
    const g = new FrameGate(s.flightFps)
    let ran = 0
    for (let i = 0; i * (1000 / hz) < 10000; i++) if (g.shouldRun(i * (1000 / hz))) ran++
    assert.ok(Math.abs(ran - 300) <= 2, `${hz} Hz: ${ran} frames in 10 s`)
  }
  assert.equal(new FrameGate(0).shouldRun(5), true, 'cap 0: every tick')
})

test('upscale: catmull by default only under sharp, and only at 1.02 to 2.5x', () => {
  assert.equal(upscaleMode('', false), 'bilinear'); assert.equal(upscaleMode('', true), 'catmull')
  assert.equal(upscaleMode('?upscale=bilinear', true), 'bilinear'); assert.equal(upscaleMode('?upscale=catmull', false), 'catmull')
  assert.equal(upscaleMode('?upscale=x', true), 'catmull')
  assert.equal(catmullOn('catmull', 1.43), 1); assert.equal(catmullOn('catmull', 2.0), 1); assert.equal(catmullOn('catmull', 2.5), 1)
  assert.equal(catmullOn('catmull', 2.51), 0, 'above 2.5 the anti-sparkle kernel stays'); assert.equal(catmullOn('catmull', 1.0), 0, 'not magnified')
  assert.equal(catmullOn('bilinear', 2), 0)
  const fin = readFileSync(new URL('../src/post/final.ts', import.meta.url), 'utf8')
  assert.ok(fin.includes('uniform float uCatmull') && fin.includes('u.uCatmull.value = this.upsample ? catmullOn('), 'wired in final.ts')
})

test('prefetch: held cap, parallel and soft re-plan', async () => {
  setSharp(SHARP_OFF)
  assert.equal(heldMax(), PREFETCH_HELD_MAX); assert.equal(PREFETCH_HELD_MAX, 160)
  setSharp(resolveSharp('phone-android', '?sharp=1'))
  assert.equal(heldMax(), 320); assert.equal(SHARP_PREFETCH_PARALLEL, 6); assert.equal(PREFETCH_PARALLEL, 3)
  const manifest = {
    version: 1, tileDeg: 5, levels: 3,
    height: { px: 320, border: 1, stepM: 8, ppd: 64, texelKm: 1 }, color: { px: 380, border: 1, ppd: 76, texelKm: 1 },
    present: ['1'.repeat(72 * 36), '1'.repeat(36 * 18), '1'.repeat(18 * 9)], minQ: [], maxQ: [], source: 'test',
  }
  let live = 0, peak = 0
  const run = async (sharp: boolean): Promise<{ aborted: number; requests: number }> => {
    setSharp(sharp ? resolveSharp('phone-android', '?sharp=1') : SHARP_OFF)
    let aborted = 0, requests = 0
    const fetchImpl: typeof fetch = async (input, init) => {
      if (String(input).endsWith('manifest.json')) return { ok: true, json: async () => manifest } as Response
      requests++; live++; peak = Math.max(peak, live)
      try {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 15)
          init?.signal?.addEventListener('abort', () => { clearTimeout(t); aborted++; reject(new DOMException('aborted', 'AbortError')) }, { once: true })
        })
      } finally { live-- }
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) } as Response
    }
    const p = new TilePrefetcher(`https://sharp-${sharp}-${Math.random()}/`, fetchImpl)
    const path = Array.from({ length: 12 }, (_, i) => ({ lon: i * 5 + 2.5, lat: 2.5, levels: [2, 1] }))
    // The flight's 500 ms re-plan, here every 20 ms: the same path again while the first tiles are still downloading, through a signal as main.ts does.
    let ctl: AbortController | null = null
    const all: Promise<void>[] = []
    for (let i = 0; i < 4; i++) {
      ctl?.abort(); ctl = new AbortController()
      all.push(p.prefetch(path, ctl.signal, undefined, 'flight'))
      await new Promise((r) => setTimeout(r, 20))
    }
    await Promise.all(all)
    await p.prefetch(path, undefined, undefined, 'flight')
    return { aborted, requests }
  }
  const hard = await run(false)
  assert.ok(hard.aborted > 0, 'default: a re-plan aborts the fetches in flight')
  assert.ok(peak <= 2 * PREFETCH_PARALLEL, `default concurrency stays 3 tiles (${peak} files)`)
  peak = 0
  const soft = await run(true)
  assert.equal(soft.aborted, 0, 'sharp: a re-plan never aborts a fetch in flight')
  assert.ok(soft.requests <= 12 * 2 * 2, `sharp: no tile is asked for twice (${soft.requests} requests for at most 48 files)`)
  assert.ok(soft.requests < hard.requests, 'and fewer requests than the aborting re-plan')
  assert.ok(peak > 2 * PREFETCH_PARALLEL, `the flight owner runs more tiles at once (${peak} files)`)
  setSharp(SHARP_OFF)
})

test('registered switches and main.ts wiring (source pins)', () => {
  assert.ok(SWITCHES.some((x) => x.name === 'sharp') && SWITCHES.some((x) => x.name === 'sharpfps') && SWITCHES.some((x) => x.name === 'upscale'))
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  for (const needle of [
    'flightScaleModeFor(quality.sharp, params.get(\'flightscale\'))',
    'sharpFlightStart(quality.sharp, quality.detected.cls, motionScale, cinematicFlight?.definition.id)',
    'gridIsOnlyScale: flightGridIsOnlyScale(quality.sharp, flightScaleWasActive)',
    'FLIGHT_GATE.shouldRun(now, gateUrgent)',
    'capMs: FLIGHT_GATE.periodMs',
    '{ emergencyFloor: SHARP_EMERGENCY_FLOOR }',
    'const flightPaused = quality.sharp.on && !tween && cinematicFlight?.pausedU != null',
    'quality.sharp.on ? approach.concat(cinematicAheadTargets()) : approach',
  ]) assert.ok(main.includes(needle), needle)
  const runtime = readFileSync(new URL('../src/quality/runtime.ts', import.meta.url), 'utf8')
  assert.ok(runtime.includes('setSharp(sharp)'), 'initQuality sets the holder before motionKnobs runs')
})
