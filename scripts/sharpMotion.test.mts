// ?motion=sharp (quality/sharpMotion.ts): motion dims equal rest dims under the switch, the default path is the expression main.ts used before, and the pacer
// cuts cost before it falls back to 30 fps and never touches resolution.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  MOTION_POLICY_DEFAULT, SHARP_CUT_FRAMES, SHARP_PROBE_FRAMES, SHARP_RELAX_FRAMES, SHARP_TIER30_FRAMES, SharpPacer,
  effectiveGrid, effectiveMotionDpr, isDownscaled, motionPolicyFromSearch, renderDims, resolveMotionPolicy, setMotionPolicy, sharpMotionOn,
  type MotionPolicy, type RenderDimsInput,
} from '../src/quality/sharpMotion.ts'

/** The expression main.ts held before this module (kept here verbatim as the reference for the default path). */
function legacyDims(i: RenderDimsInput): { w: number; h: number } {
  const rscale = i.gestureOn && i.scale < 1 ? i.scale * (i.gridIsOnlyScale ? 1 : i.motionDpr / i.restDpr) : i.scale
  return { w: Math.max(64, Math.round(i.cw * rscale)), h: Math.max(64, Math.round(i.ch * rscale)) }
}

const SIZES: Array<[number, number, number]> = [[411, 800, 2], [411, 800, 3], [1440, 900, 2], [1920, 1080, 1], [2560, 1440, 1.5], [390, 844, 3]]
const GRIDS = [0.25, 0.35, 0.5, 0.7, 1]

test('off by default; the switch and the stored knob parse, URL first', () => {
  assert.equal(MOTION_POLICY_DEFAULT, 'default', 'the default stays off until the rig and phone A/B')
  assert.equal(resolveMotionPolicy('', null), 'default')
  assert.equal(resolveMotionPolicy('?motion=sharp', null), 'sharp')
  assert.equal(resolveMotionPolicy('?motion=default', 'sharp'), 'default')
  assert.equal(resolveMotionPolicy('', 'sharp'), 'sharp')
  assert.equal(resolveMotionPolicy('?motion=bogus', 'nope'), 'default')
  assert.equal(motionPolicyFromSearch('?motion=1'), null)
  assert.equal(resolveMotionPolicy('', null, 'sharp'), 'sharp', 'flipping the constant flips the default')
})

test('under sharp the motion dims equal the rest dims for every grid, DPR cap, gesture state and flight flag', () => {
  for (const [cssW, cssH, restDpr] of SIZES) {
    for (const motionDpr of [1, 1.25, 1.5, restDpr]) {
      for (const scale of GRIDS) {
        for (const gestureOn of [false, true]) {
          for (const gridIsOnlyScale of [false, true]) {
            const cw = Math.round(cssW * restDpr), ch = Math.round(cssH * restDpr)
            const d = renderDims('sharp', { cw, ch, scale, gestureOn, motionDpr, restDpr, gridIsOnlyScale })
            assert.deepEqual([d.w, d.h], [Math.max(64, cw), Math.max(64, ch)], `${cssW}x${cssH}@${restDpr} grid ${scale} mdpr ${motionDpr}`)
            assert.equal(d.scale, 1)
            assert.equal(isDownscaled(d, cw, ch), false)
          }
        }
      }
    }
  }
})

test('gesture start and end, a flight, and the emergency and wall steps never change the dims under sharp', () => {
  const cw = 822, ch = 1600, restDpr = 2, motionDpr = 1.25
  const at = (scale: number, gestureOn: boolean): [number, number] => { const d = renderDims('sharp', { cw, ch, scale, gestureOn, motionDpr, restDpr, gridIsOnlyScale: false }); return [d.w, d.h] }
  // rest, gesture start on the class grid, a timed step down, an emergency step, a wall step, the flight controller's floor, the hand-back (mid grid then 1)
  const seq: Array<[number, boolean]> = [[1, false], [0.35, true], [0.25, true], [0.25, true], [0.25, true], [0.5, true], [1, false], [1, false]]
  for (const [s, g] of seq) assert.deepEqual(at(s, g), [cw, ch])
  // a flight: the sharp=1 flight grid that is the only scale
  for (const g of [0.5, 0.7, 1]) assert.deepEqual([renderDims('sharp', { cw, ch, scale: g, gestureOn: true, motionDpr, restDpr, gridIsOnlyScale: true }).w], [cw])
  assert.equal(effectiveGrid('sharp', 0.25), 1)
  assert.equal(effectiveMotionDpr('sharp', 1, 3), 3)
})

test('the default policy computes exactly what main.ts did', () => {
  for (const [cssW, cssH, restDpr] of SIZES) {
    for (const motionDpr of [1, 1.25, restDpr]) {
      for (const scale of GRIDS) {
        for (const gestureOn of [false, true]) {
          for (const gridIsOnlyScale of [false, true]) {
            const i: RenderDimsInput = { cw: Math.round(cssW * restDpr), ch: Math.round(cssH * restDpr), scale, gestureOn, motionDpr, restDpr, gridIsOnlyScale }
            const d = renderDims('default', i)
            const l = legacyDims(i)
            assert.deepEqual([d.w, d.h], [l.w, l.h])
            assert.equal(d.scale, scale)
          }
        }
      }
    }
  }
  assert.equal(effectiveGrid('default', 0.35), 0.35)
  assert.equal(effectiveMotionDpr('default', 1.25, 2), 1.25)
  // and it still downscales (the thing the switch removes)
  assert.equal(isDownscaled(renderDims('default', { cw: 800, ch: 600, scale: 0.5, gestureOn: true, motionDpr: 1, restDpr: 1, gridIsOnlyScale: false }), 800, 600), true)
})

test('holder: default policy until set', () => {
  assert.equal(sharpMotionOn(), false)
  setMotionPolicy('sharp'); assert.equal(sharpMotionOn(), true)
  setMotionPolicy('default'); assert.equal(sharpMotionOn(), false)
})

const feed = (p: SharpPacer, gap: number, n: number): void => { for (let i = 0; i < n; i++) p.observe(gap) }

test('pacer: healthy 60 fps changes nothing', () => {
  const p = new SharpPacer()
  feed(p, 16.7, 600)
  assert.deepEqual([p.tier, p.cutCost, p.cutEntries, p.tier30Entries], [60, false, 0, 0])
})

test('pacer: over budget cuts cost first, then falls back to 30 fps, in that order', () => {
  const p = new SharpPacer()
  feed(p, 25, SHARP_CUT_FRAMES - 1)
  assert.equal(p.cutCost, false)
  feed(p, 25, 1)
  assert.deepEqual([p.cutCost, p.tier], [true, 60], 'stage 1: cut cost, still 60')
  feed(p, 25, SHARP_TIER30_FRAMES - 1)
  assert.equal(p.tier, 60)
  feed(p, 25, 1)
  assert.deepEqual([p.cutCost, p.tier], [true, 30], 'stage 2: the explicit 30 fps tier')
})

test('pacer: a single hitch or a pause does not start a stage; slow frames must be consecutive', () => {
  const p = new SharpPacer()
  for (let i = 0; i < 50; i++) { p.observe(30); p.observe(16) }
  assert.equal(p.cutCost, false)
  feed(p, 5000, 20) // pauses in the gesture are ignored
  feed(p, 0, 20)
  assert.equal(p.cutCost, false)
})

test('pacer: stage 1 ends after a healthy run, reset starts a new gesture at 60 with nothing cut', () => {
  const p = new SharpPacer()
  feed(p, 25, SHARP_CUT_FRAMES)
  assert.equal(p.cutCost, true)
  feed(p, 12, SHARP_RELAX_FRAMES - 1)
  assert.equal(p.cutCost, true)
  feed(p, 12, 1)
  assert.equal(p.cutCost, false)
  feed(p, 25, SHARP_CUT_FRAMES + SHARP_TIER30_FRAMES)
  assert.equal(p.tier, 30)
  p.reset()
  assert.deepEqual([p.tier, p.cutCost], [60, false])
})

test('pacer: the 30 fps tier probes 60 again, returns to 30 on two slow frames, relaxes when the probe is healthy', () => {
  const p = new SharpPacer()
  feed(p, 25, SHARP_CUT_FRAMES + SHARP_TIER30_FRAMES)
  assert.equal(p.tier, 30)
  feed(p, 33, SHARP_PROBE_FRAMES - 1)
  assert.equal(p.tier, 30)
  feed(p, 33, 1)
  assert.deepEqual([p.tier, p.probes], [60, 1], 'probe')
  feed(p, 25, 2)
  assert.equal(p.tier, 30, 'two slow frames in the probe send it back')
  feed(p, 33, SHARP_PROBE_FRAMES)
  assert.equal(p.tier, 60)
  feed(p, 12, SHARP_RELAX_FRAMES)
  assert.deepEqual([p.tier, p.cutCost], [60, false], 'a healthy probe settles at 60 with nothing cut')
})

test('pacer: recovery works at a real 60 Hz cadence (16.7 ms gaps), judged against the measured display interval', () => {
  const p = new SharpPacer()
  feed(p, 25, SHARP_CUT_FRAMES)
  assert.equal(p.cutCost, true)
  for (let i = 0; i < SHARP_RELAX_FRAMES; i++) p.observe(16.7, 1000 / 60)
  assert.equal(p.cutCost, false, '16.7 ms is healthy on a 60 Hz panel')
  // 120 Hz and 144 Hz panels still target 60 fps: an 8.3 ms or 6.9 ms display interval does not make 16.7 slow.
  for (const hz of [120, 144, 50]) {
    const q = new SharpPacer()
    for (let i = 0; i < 300; i++) q.observe(1000 / Math.min(hz, 60), 1000 / hz)
    assert.equal(q.cutCost, false, `${hz} Hz`)
  }
  // A 50 Hz display presents every 20 ms: that is its normal cadence, not a slow frame.
  const r = new SharpPacer()
  for (let i = 0; i < 300; i++) r.observe(20, 20)
  assert.equal(r.cutCost, false)
})

test('pacer: the slow-in-cut streak is consecutive; normal frames in between reset it', () => {
  const p = new SharpPacer()
  feed(p, 25, SHARP_CUT_FRAMES)
  assert.equal(p.cutCost, true)
  for (let i = 0; i < SHARP_TIER30_FRAMES * 5; i++) { feed(p, 25, SHARP_TIER30_FRAMES - 1); p.observe(16.7, 1000 / 60) }
  assert.equal(p.tier, 60, 'slow frames broken up by normal ones never reach the 30 fps tier')
  feed(p, 25, SHARP_TIER30_FRAMES)
  assert.equal(p.tier, 30)
})

test('pacer: a gap between healthy and slow breaks both streaks', () => {
  const p = new SharpPacer()
  feed(p, 25, SHARP_CUT_FRAMES)
  for (let i = 0; i < 200; i++) { feed(p, 16.7, SHARP_RELAX_FRAMES - 1); p.observe(19, 1000 / 60) }
  assert.equal(p.cutCost, true, 'a middling frame resets the healthy run')
})

test('main.ts defers both shadow cache builds under the pacer cut stage and feeds the display interval', () => {
  const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(src, /cacheBuildMotion\(SHADOW_POLICY, legacyMotion, sharpDefer\)/)
  assert.match(src, /cacheBuildMotion\(SHADOW_POLICY, patchLegacyMotion, sharpDefer\)/)
  assert.match(src, /sharpPacer\.observe\(wallGap, 1000 \/ \(displayRate\.hz \|\| 60\)\)/)
})

test('main.ts wires the policy: ladders guarded, dims through renderDims, perf exposes the policy, default path untouched', () => {
  const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(src, /renderDims\(policy, \{ cw, ch, scale, gestureOn, motionDpr, restDpr: dpr/)
  assert.match(src, /if \(sharpMotionOn\(\)\) motionDpr = restDpr/)
  // constResMotionOn(): 'sharp' or 'phone' (quality/phoneSharp.ts) own the motion resolution; both void the ladders.
  assert.match(src, /FORCED_MOTION_SCALE \|\| flightScaleActive \|\| constResMotionOn\(\) \? null/, 'timed/emergency ladder off')
  assert.match(src, /!flightScaleActive && !constResMotionOn\(\) && wallDrawSeq !== wallSeenSeq/, 'wall ladder off')
  assert.match(src, /!FORCED_MOTION_SCALE && !constResMotionOn\(\)\) motionMemory\.remember/, 'remembered grids not stored')
  assert.match(src, /if \(sharpMotionOn\(\) && \(gestureOn \|\| flightScaleActive\)\) \{[^}]*scale = 1; motionScale = 1 \}/, 'final override')
  assert.match(src, /motionPolicy: \{ policy: motionPolicy\(\)/, '__moon.perf.motionPolicy')
  assert.match(src, /downscaledFrames/)
  // the policy is not on by default: nothing but the constant decides
  const mod = readFileSync(new URL('../src/quality/sharpMotion.ts', import.meta.url), 'utf8')
  assert.match(mod, /MOTION_POLICY_DEFAULT: MotionPolicy = 'default'/)
  const p: MotionPolicy = 'default'
  assert.equal(p, 'default')
})
