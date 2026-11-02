/**
 * WP4b: no straight step at the terminator. WP4 shipped a flat grey sheet that ended in a vertical line a little inside the terminator (a modelled
 * fill in shadow, read by the final pass's LONG exposure, which saturates at any light above the earthshine). A step is a function of the Sun's
 * elevation only, so it is a straight line in any view; this test walks a shadowed pixel across the terminator through a CPU twin of the final
 * pass's two-exposure fusion (post/final.ts FINAL_FRAGMENT) with the real constants of the fill and the key, and requires the displayed grey to
 * change smoothly (no jump over a tenth of a degree larger than a few levels, and a bounded second difference).
 *   npm test
 */
import assert from 'node:assert/strict'
import { FILL_RAMP_POWER, SHADOW_FILL, SUN_KEY_HI, SUN_KEY_LO, moonFragment } from '../src/moon/moonShader.ts'
import { computeExposure } from '../src/post/exposure.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { earthViewCamera } from '../src/camera/pose.ts'
import { maxStepGrey, secondDifferenceMax } from '../audit/profile.ts'

const smoothstep = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const phaseA = (a: number): number => Math.exp(-0.0025 * a) * (1 + 0.9 * Math.exp(-a / 20)) / 1.9

// The exposure of the quarter-phase frame the owner looked at (2026-10-10 12:00 UTC, Earth view).
const e = ephemerisAt(new Date('2026-10-10T12:00:00Z'))
const ex = computeExposure({ cam: earthViewCamera(e, 1.6), aspect: 1.6, canvasHeight: 900, ephem: e, albedo: null, lonSpan: 360, preExposeOn: true })

/** The displayed level (0..1, linear) of a pixel in SHADOW at Sun elevation `elevDeg`, earthshine `es` (I/F) and a fill share `fill` times key^power. */
function shadowLevel(elevDeg: number, fill: number, power: number, es: number): number {
  const dot = Math.sin((elevDeg * Math.PI) / 180)
  const key = smoothstep(SUN_KEY_LO, SUN_KEY_HI, dot)
  const albedo = 0.1
  const Y = es + albedo * phaseA(90) * Math.max(dot, 0) * fill * Math.pow(key, power)
  const x = Y / ex.white
  const sE = x / Math.max(ex.esLevel / ex.white, 1e-9)
  const yLong = ex.longMax * (1 - Math.exp(-0.7 * sE))
  const yShort = 0.02 + 0.98 * Math.pow(x, 0.9)
  return yLong + (yShort - yLong) * key
}
const toGrey = (y: number): number => 255 * (y <= 0.0031308 ? y * 12.92 : 1.055 * Math.pow(y, 1 / 2.4) - 0.055)

function profile(fill: number, power: number): number[] {
  const out: number[] = []
  for (let d = -3; d <= 14.0001; d += 0.1) out.push(toGrey(shadowLevel(d, fill, power, 0.8 * ex.esLevel)))
  return out
}

// 1. The shipped fill (ramp power FILL_RAMP_POWER) has no step: neighbours 0.1 degree apart differ by under 3 levels, and the profile bends gently.
{
  const p = profile(SHADOW_FILL, FILL_RAMP_POWER)
  console.log('shipped fill: max step', maxStepGrey(p).toFixed(2), 'max bend', secondDifferenceMax(p).toFixed(2), 'levels')
  assert.ok(maxStepGrey(p) < 3, `a smooth fill: largest 0.1 degree step ${maxStepGrey(p).toFixed(2)} levels`)
  assert.ok(secondDifferenceMax(p) < 2, `a smooth fill: largest second difference ${secondDifferenceMax(p).toFixed(2)} levels`)
}

// 2. The instrument sees a step: WP4's fill (no ramp, power 0) has one, and so does a synthetic edge.
{
  const wp4 = profile(SHADOW_FILL, 0)
  console.log('WP4 fill: max step', maxStepGrey(wp4).toFixed(2), 'max bend', secondDifferenceMax(wp4).toFixed(2), 'levels')
  assert.ok(maxStepGrey(wp4) >= 3 || secondDifferenceMax(wp4) >= 2, `WP4's fill is caught (step ${maxStepGrey(wp4).toFixed(2)}, bend ${secondDifferenceMax(wp4).toFixed(2)})`)
  const edge = Array.from({ length: 100 }, (_, i) => (i < 50 ? 60 : 40))
  assert.ok(maxStepGrey(edge) >= 19 && secondDifferenceMax(edge) >= 19, 'a synthetic straight edge is caught')
  const ramp = Array.from({ length: 100 }, (_, i) => 60 - i * 0.2)
  assert.ok(maxStepGrey(ramp) < 0.3 && secondDifferenceMax(ramp) < 1e-9, 'a plain ramp passes')
}

// 3. The shader uses the same constants as this twin.
{
  const fs = moonFragment(360, 4096, '', false, null)
  assert.ok(fs.includes(`pow(fillKey, ${FILL_RAMP_POWER.toFixed(2)})`), 'fill follows the key to the tested power')
  assert.ok(fs.includes(`smoothstep(${SUN_KEY_LO.toFixed(3)}, ${SUN_KEY_HI.toFixed(3)}, dot(p, uS))`), 'the key edges are the tested ones')
  assert.ok(fs.includes('* SHADOW_FILL * fillRamp * (1.0 - lit)'), 'the ramp multiplies the fill')
}
console.log('terminator-step.test.mts: ok')
