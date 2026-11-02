// The horizon option (src/moon/horizon.ts): names, sub-pixel offsets and the TS twins of the shaders' coverage and low-pass maths.
import assert from 'node:assert/strict'
import { HORIZON_DEFAULT, HORIZON_MAX_RAYS, HORIZON_MODES, LP_FACTOR, exactEdgeCover, flightHzOn, horizonFromSearch, horizonSettings, limbCoverSS, lowpassLevel, rayCover, subRayOffsets } from '../src/moon/horizon.ts'
import { moonFragment, moonCoverFragment } from '../src/moon/moonShader.ts'
import { groundFragment } from '../src/ground/groundShader.ts'

// Flag parsing: the default is the best option; unknown values fall back to it; every name round-trips.
assert.equal(HORIZON_DEFAULT, 'full')
assert.equal(horizonFromSearch(''), 'full')
assert.equal(horizonFromSearch('?horizon=bogus'), 'full')
for (const m of HORIZON_MODES) assert.equal(horizonFromSearch(`?x=1&horizon=${m}`), m)
assert.deepEqual(horizonSettings('off'), { k: 0, lp: 0 }, 'off is the old single ray')
assert.deepEqual(horizonSettings('aa4'), { k: 4, lp: 0 })
assert.deepEqual(horizonSettings('aa'), { k: 8, lp: 0 })
assert.deepEqual(horizonSettings('lp'), { k: 0, lp: LP_FACTOR })
assert.deepEqual(horizonSettings('full'), { k: 8, lp: LP_FACTOR })
for (const m of HORIZON_MODES) assert.ok(horizonSettings(m).k <= HORIZON_MAX_RAYS, `${m} fits the shader's loop`)

// Sub-pixel offsets: stratified, symmetric, inside the pixel.
assert.deepEqual(subRayOffsets(4), [-0.375, -0.125, 0.125, 0.375])
assert.deepEqual(subRayOffsets(0), [])
assert.equal(subRayOffsets(99).length, HORIZON_MAX_RAYS)
for (const k of [1, 2, 3, 4, 8]) {
  const o = subRayOffsets(k)
  assert.ok(o.every((v) => v > -0.5 && v < 0.5), `k=${k} inside the pixel`)
  assert.ok(Math.abs(o.reduce((a, b) => a + b, 0)) < 1e-12, `k=${k} centred`)
}

// One ray: under the ground 1, a ramp from 0.5 to 0 over one extent above it.
assert.equal(rayCover(true, -3, 1), 1)
assert.equal(rayCover(false, 0, 1), 0.5)
assert.equal(rayCover(false, 0.5, 1), 0)
assert.equal(rayCover(false, 9, 1), 0)
assert.equal(rayCover(false, 0.25, 1), 0.25)

// The coverage of a limb pixel: the staircase of the old edge (k = 0) against the sub-pixel mean. Over a sweep of the edge across one pixel the
// mean tracks the exact area far better than the single ray, and it is monotone in the edge position.
const pxR = 0.001
let worstOld = 0, worstK4 = 0, worstK8 = 0, prev = 2
for (let i = 0; i <= 200; i++) {
  const inside = 1.5 - i * 0.015              // the centre's distance inside the limb, in pixels, from +1.5 to -1.5
  const b0 = 1 - inside * pxR
  const exact = exactEdgeCover(inside)
  worstOld = Math.max(worstOld, Math.abs(limbCoverSS(b0, pxR, 0) - exact))
  worstK4 = Math.max(worstK4, Math.abs(limbCoverSS(b0, pxR, 4) - exact))
  worstK8 = Math.max(worstK8, Math.abs(limbCoverSS(b0, pxR, 8) - exact))
  const c8 = limbCoverSS(b0, pxR, 8)
  assert.ok(c8 <= prev + 1e-12, 'coverage never rises as the edge moves away')
  prev = c8
}
assert.ok(worstOld > 0.45, `the single ray is a hard step (worst error ${worstOld.toFixed(3)})`)
assert.ok(worstK4 < 0.13, `4 rays within an eighth of a pixel (${worstK4.toFixed(3)})`)
assert.ok(worstK8 < 0.07, `8 rays within a fourteenth of a pixel (${worstK8.toFixed(3)})`)
assert.ok(worstK8 < worstK4 && worstK4 < worstOld, 'more rays, closer')
assert.equal(limbCoverSS(1 - 5 * pxR, pxR, 8), 1, 'well inside: 1')
assert.equal(limbCoverSS(1 + 5 * pxR, pxR, 8), 0, 'well outside: 0')

// A straight edge's silhouette is smooth: along a line of slope 1/16 the 8-ray coverage steps by at most 1/16 + eps per column (the old edge
// jumped by a whole pixel every 16 columns).
{
  const col = (x: number): number => limbCoverSS(1 - (2 - x / 16) * pxR, pxR, 8)
  let maxStep = 0, maxStepOld = 0
  for (let x = 0; x < 64; x++) {
    maxStep = Math.max(maxStep, Math.abs(col(x + 1) - col(x)))
    maxStepOld = Math.max(maxStepOld, Math.abs(limbCoverSS(1 - (2 - (x + 1) / 16) * pxR, pxR, 0) - limbCoverSS(1 - (2 - x / 16) * pxR, pxR, 0)))
  }
  assert.ok(maxStep < 0.13, `a shallow edge fades in by small steps (${maxStep.toFixed(3)})`)
  assert.ok(maxStepOld > maxStep, 'the old edge steps harder than the new one')
}

// The low-pass level: never finer than the nearest sample's, coarser with distance, off leaves the floor.
const TH = 0.4738
assert.equal(lowpassLevel(100, TH, 1, 0), 1, 'off: the floor')
assert.equal(lowpassLevel(0.1, TH, 0, LP_FACTOR), 0, 'near: the finest')
assert.equal(lowpassLevel(0.1, TH, 1, LP_FACTOR), 1, 'never finer than the floor')
assert.equal(lowpassLevel(1.1, TH, 0, LP_FACTOR), 2, 'a 1.1 km pixel (a horizon 700 km away) reads level 2 under the low-pass')
assert.equal(lowpassLevel(1.1, TH, 0, 0), 0, 'and level 0 without')
let lv = 0
for (let fp = 0.1; fp < 20; fp *= 1.1) { const l = lowpassLevel(fp, TH, 0, LP_FACTOR); assert.ok(l >= lv && l <= 2); lv = l }

// The shaders carry the option, and `off` costs one uniform test: the loop is bounded, gesture frames skip it, the ground shader declares it.
for (const [name, g] of [['moon', moonFragment(180, 4096, '', true)], ['cover', moonCoverFragment(180, 4096)]] as const) {
  assert.ok(g.includes('uniform float uHzK;') && g.includes('uniform float uHzLp;'), `${name}: the uniforms`)
  assert.ok(g.includes('terrainResolveCore') && g.includes('uHzK < 0.5 || (uMotion > 0.5 && uFlightHz < 0.5) || gEdge < 0.5'), `${name}: the band loop skips off, gesture frames and pixels off the band`)
  assert.ok(g.includes('for (int i = 0; i < 8; i++)') && g.includes('lpLevel('), `${name}: bounded loop and the low-pass level`)
}
const gl = groundFragment('shade', 180, 4096, [{ h: true, r: true, fadeM: 40, shade: true }])
assert.ok(gl.includes('uniform float uHzK;') && gl.includes('GHit groundHitRay') && gl.includes('uHzK < 0.5 || uMotion > 0.5'), 'ground: sub-pixel rays behind the same switch')

// ?flighthz: off by default, on with =1, on under ?sharp=1 unless =0; a scripted-flight frame then keeps the rest march and the skyline rays (uFlightHz), never the gesture's.
assert.equal(flightHzOn(null, false), false, 'default off')
assert.equal(flightHzOn(null, true), true, '?sharp=1 turns it on')
assert.equal(flightHzOn('0', true), false, '?flighthz=0 wins over sharp')
assert.equal(flightHzOn('1', false), true)
{
  const m = moonFragment(180, 4096, '', true)
  assert.ok(m.includes('uniform float uFlightHz;'), 'moon: the uniform')
  assert.ok(m.includes('bool capMarch = uMotion > 0.5 && uFlightHz < 0.5;') && m.includes('capMarch ? min(uTerrIter, uMTerr) : uTerrIter') && m.includes('capMarch ? min(uTerrMinDiv, uMTerr) : uTerrMinDiv'), 'moon: the march caps skip a flight-hz frame')
  assert.ok(!m.includes('uMotion > 0.5 ? min(uTerrIter'), 'moon: no uncapped-by-flight motion cap is left')
}

console.log('horizon ok')
