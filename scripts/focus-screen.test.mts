// Focus pull, parts B and C: the optics of the traced split prism and the visibility state machine (src/quality/focusScreen.ts), and the shader's constants.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ERR_FLOOR, ERR_TAU, FADE_IN_TAU, FADE_OUT_TAU, FULL_LACK_PER_640, HOLD_S, LOADING_SHARE, NIKON, SCREEN, SPLIT_ANGLE, VISIBLE_MIN,
  DETAIL_LOADING_SHARE, blackoutShare, copyRegionPx, indicatorErr, loadingOf, deltaMm, errOf, focusDistanceM, focusMatteTraced, matteBlurMm, newVisibility, opticsErr, pxPerMm, ringRadiusPx, sampleReachMm,
  splitOffsetMm, splitRadiusPx, stepVisibility, visible, zoneCentres, zoneRadius, zoneShare, type FocusVisibility,
} from '../src/quality/focusScreen.ts'

const near = (a: number, b: number, eps = 1e-9, msg = ''): void => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`)

// ---- the screen and the lens, as specified
assert.equal(NIKON.f, 55); assert.equal(NIKON.N, 1.2); assert.equal(NIKON.screenH, 24); assert.equal(NIKON.dFar, 1)
assert.deepEqual({ ...SCREEN }, { splitD: 3, ringW: 1, Np: 5.6, Nm: 5.6, pitch: 0.15, eyePupil: 3, fEye: 60 })
near(SPLIT_ANGLE, -Math.PI / 4, 0, 'split turned 45 deg')
near(zoneRadius(), 2 * 1.2 * 1.5 / 60, 1e-12, 'zone radius = 2N x 1.5 / 60'); near(zoneRadius(), 0.06, 1e-12)
{
  const z = zoneCentres()
  near(Math.hypot(...z.split[0]), 1.2 / 5.6, 1e-12); near(z.split[0][0], -z.split[1][0], 1e-12); near(z.split[0][1], -z.split[1][1], 1e-12)
  near(z.split[0][1] / z.split[0][0], -1, 1e-12, 'the split line runs at 45 deg')
  assert.equal(z.prism.length, 4)
  for (const c of z.prism) near(Math.hypot(...c), 1.2 / 5.6, 1e-12)
}

// ---- the focus mapping: 1/d = err / 1 m, delta = f^2 (1/d) / (1 - f/d) in mm
assert.equal(deltaMm(0), 0); assert.equal(deltaMm(-1), 0)
near(deltaMm(1), (55 * 55 * 1 / 1000) / (1 - 0.055), 1e-12); near(deltaMm(1), 3.2011, 1e-3)
near(deltaMm(0.5), (55 * 55 * 0.5 / 1000) / (1 - 0.0275), 1e-12)
assert.ok(deltaMm(0.6) > deltaMm(0.5))
assert.equal(focusDistanceM(0), Infinity); assert.equal(focusDistanceM(1), 1); assert.equal(focusDistanceM(0.5), 2)
near(splitOffsetMm(deltaMm(1)), deltaMm(1) / 5.6, 1e-12); near(matteBlurMm(deltaMm(1)), deltaMm(1) / 1.2, 1e-12)

// ---- blackout: the share of a wedge's zone that lies inside the pupil
near(zoneShare(0, 0.5), 1); near(zoneShare(0.9, 0.05), 1); near(zoneShare(1.2, 0.05), 0); near(zoneShare(1, 0.1), 0.5, 0.05, 'half out at the rim')
near(zoneShare(0.1, 3), 1 / 9, 1e-12, 'a pupil inside a huge zone')
for (let d = 0; d < 1.6; d += 0.05) assert.ok(zoneShare(d, 0.3) <= zoneShare(d - 0.05 < 0 ? 0 : d - 0.05, 0.3) + 1e-12, 'monotone in distance')
{
  const b = blackoutShare()
  near(b.split, 1, 0, 'the f/1.2 Nikkor fills the f/5.6 wedges: no blackout'); near(b.prism, 1, 0)
  const slow = blackoutShare({ ...NIKON, N: 5.6, f: 250 })
  near(slow.split, zoneShare(1, zoneRadius({ ...NIKON, N: 5.6 })), 1e-12); assert.ok(slow.split < 0.6, 'a slow lens blacks the prism half out')
}

// ---- geometry: 24 mm is the SHORT side
near(pxPerMm(1280, 800), 800 / 24, 1e-12); near(pxPerMm(800, 1280), 800 / 24, 1e-12); near(pxPerMm(1081, 2402), 1081 / 24, 1e-12)
near(splitRadiusPx(1280, 800), 1.5 * 800 / 24, 1e-9); near(ringRadiusPx(1280, 800), 2.5 * 800 / 24, 1e-9)
assert.ok(copyRegionPx(1280, 800) % 2 === 0 && copyRegionPx(1280, 800) > 2 * ringRadiusPx(1280, 800))
assert.ok(copyRegionPx(1280, 800) < 0.4 * 800, 'a small square, not the frame')
assert.ok(sampleReachMm() > 0 && sampleReachMm() < 1)

// ---- err from the share still coarse and the size of the missing detail
assert.equal(errOf(0, 5), 0); assert.equal(errOf(LOADING_SHARE, 5), 0, 'at the threshold: nothing loading')
near(errOf(1, FULL_LACK_PER_640), 1); near(errOf(0.5, 1.5), ERR_FLOOR + (1 - ERR_FLOOR) * 0.5, 1e-12); assert.equal(errOf(1, 99), 1)
// Anything loading shows a visible split (owner 2026-10-31): the smallest measured error still starts at the floor.
near(errOf(LOADING_SHARE * 1.01, 0), ERR_FLOOR, 1e-12); assert.ok(ERR_FLOOR >= 0.4 && ERR_FLOOR < 1)
assert.ok(errOf(0.02, 3) < errOf(0.5, 3), 'a sliver of the frame is a small error')
assert.ok(errOf(0.5, 1) < errOf(0.5, 3))

// ---- C. visibility: only while loading; fast fades
const run = (s: FocusVisibility, secs: number, loading: boolean, err = 1, dt = 1 / 240): FocusVisibility => { for (let t = 0; t < secs - 1e-9; t += dt) s = stepVisibility(s, dt, loading, err); return s }
{
  // Moving alone shows nothing: the state machine has no input for movement.
  let s = newVisibility()
  s = run(s, 3, false, 0)
  assert.equal(s.vis, 0); assert.equal(visible(s), false)
  // In: time constant 25 ms (63 % after one tau).
  s = run(newVisibility(), FADE_IN_TAU, true)
  near(s.vis, 1 - Math.exp(-1), 0.01, 'fade in tau')
  s = run(newVisibility(), 0.2, true); assert.ok(s.vis > 0.999)
  // Out: a 100 ms hold at full opacity, then tau 70 ms.
  let full = run(newVisibility(), 0.5, true)
  const v0 = full.vis
  full = run(full, HOLD_S - 0.01, false, 0)
  near(full.vis, v0, 1e-9, 'held')
  const h = run(full, 0.02, false, 0) // just past the hold
  assert.ok(h.vis < v0 && h.vis > 0.8, 'starts to fall after the hold')
  const afterTau = run(run(full, 0.01 + 1e-9, false, 0), FADE_OUT_TAU, false, 0)
  near(afterTau.vis, v0 * Math.exp(-1), 0.01, 'fade out tau')
  assert.equal(visible(run(full, HOLD_S + 8 * FADE_OUT_TAU, false, 0)), false, 'gone about 0.7 s after loading ends')
  assert.equal(run(full, HOLD_S + 20 * FADE_OUT_TAU, false, 0).vis, 0)
  // The split holds during the hold (a one-frame dip of the coarse share must not move it), then closes with the fade out.
  { let st = run(newVisibility(), 0.3, true, 0.6); const e0 = st.err; st = stepVisibility(st, 1 / 60, false, 0); near(st.err, e0, 1e-12); st = stepVisibility(st, 1 / 60, true, 0.6); assert.ok(Math.abs(st.err - e0) < 1e-3, 'a one-frame dip leaves the split in place') }
  { const st = run(run(newVisibility(), 0.3, true, 0.6), 1, false, 0); assert.ok(st.err < 1e-3 && st.vis === 0, 'closed and gone after the fade out') }
  // Loading again during the hold cancels it.
  const back = run(run(full, 0.05, false, 0), 0.5, true)
  assert.ok(back.vis > 0.999 && back.hold === 0)
  // A slow frame advances the fade by its real time (up to half a second), not by a clamp that would stretch a 25 ms fade over several frames.
  assert.ok(stepVisibility(newVisibility(), 0.3, true, 1).vis > 0.99)
  // The faster fades the owner asked for.
  assert.ok(FADE_IN_TAU <= 0.025 && FADE_OUT_TAU <= 0.07 && HOLD_S <= 0.1)
  // err lags with ERR_TAU and closes to 0 when loading ends (the halves line up while the indicator fades).
  const e = run(newVisibility(), ERR_TAU, true, 1); near(e.err, 1 - Math.exp(-1), 0.01)
  assert.equal(run(e, 1, false, 1).err, 0)
}
// No hunt (owner review): while loading at a steady err the optics' err is steady, never above 1 or below 0, and it is err x vis.
{
  let st = run(newVisibility(), 0.5, true, 0.8)
  const seen = new Set<number>()
  for (let t = 0; t < 1; t += 0.01) { st = stepVisibility(st, 0.01, true, 0.8); const o = opticsErr(st); seen.add(Math.round(o * 1e6)); assert.ok(o >= 0 && o <= 1); near(o, st.err * st.vis, 1e-12) }
  assert.ok(Math.max(...seen) - Math.min(...seen) < 1000, 'no hunt jitter')
}
assert.ok(VISIBLE_MIN > 0 && VISIBLE_MIN < 0.01)
assert.equal(focusMatteTraced(''), false); assert.equal(focusMatteTraced('?focusmatte=traced'), true); assert.equal(focusMatteTraced('?focusmatte=1'), false)

// ---- the shader transcribes these numbers (post/focusScreenPass.ts)
{
  const src = readFileSync(new URL('../src/post/focusScreenPass.ts', import.meta.url), 'utf8')
  for (const needle of ['vec2 q = c + R * (rr * vec2(cos(th), sin(th))) * r;', 'S(px + q / (2.0 * uN) * uDelta * uPxMm)', 'dir * side * uN / uNp', 'dir * uN / uNm', 'mod(mm, uPitch) / uPitch - 0.5', 'col = z.rgb * z.a;', 'mix(base, col, uVis)', '} else discard;']) {
    assert.ok(src.includes(needle), `shader keeps: ${needle}`)
  }
  assert.ok(!src.includes('lines'), 'no cross lines')
  assert.ok(src.includes('uAngle: { value: SPLIT_ANGLE }') && src.includes('uZr: { value: zoneRadius() }') && src.includes('uN: { value: NIKON.N }'))
}
console.log('focus-screen: ok')

// ---- the indicator also reads the detail on its way (owner walkthrough 2026-10-31: a zoom at the surface never showed it; rig r2-tiles: colour coarse 0 on
// every sample of the zoom while Terrain Camera tiles were in flight)
assert.equal(loadingOf(null), false)
assert.equal(loadingOf({ coarse: 0, lackPer640: 0 }), false, 'nothing loading')
assert.equal(loadingOf({ coarse: LOADING_SHARE * 2, lackPer640: 1 }), true, 'colour coarse as before')
assert.equal(loadingOf({ coarse: 0, lackPer640: 0, detail: DETAIL_LOADING_SHARE }), false, 'a sliver of detail is not loading')
assert.equal(loadingOf({ coarse: 0, lackPer640: 0, detail: 0.5 }), true, 'detail on its way at the surface')
near(indicatorErr(null), 0); near(indicatorErr({ coarse: 0, lackPer640: 0, detail: 0.05 }), 0, 0, 'detail below the share: no err')
near(indicatorErr({ coarse: 0, lackPer640: 0, detail: 1 }), ERR_FLOOR + (1 - ERR_FLOOR) * 0.5, 1e-12, 'all detail missing: halfway past the floor')
assert.ok(indicatorErr({ coarse: 0, lackPer640: 0, detail: 0.2 }) >= ERR_FLOOR, 'detail loading starts at the floor (the split is visible)')
{
  const colourOnly = { coarse: 0.5, lackPer640: 3 }
  near(indicatorErr(colourOnly), errOf(0.5, 3), 0, 'colour alone: errOf unchanged')
  near(indicatorErr({ ...colourOnly, detail: 0.2 }), Math.max(errOf(0.5, 3), indicatorErr({ coarse: 0, lackPer640: 0, detail: 0.2 })), 0, 'the larger of the two')
}
