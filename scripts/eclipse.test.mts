/**
 * Checks of the CPU mirror of the eclipse shadow (src/lighting/shadowMath.ts),
 * which the GLSL in src/eclipse/index.ts is written against:
 *   npm test
 */
import assert from 'node:assert/strict'
import { EARTH_R_KM, MOON_R_KM } from '../src/glsl/common.ts'
import { UMBRA_LOG2, UMBRA_D0_KM, UMBRA_U_MAX, UMBRA_N } from '../src/lighting/umbraTable.ts'
import { OCCULT_TOP_KM, earthShadowOnMoonParts, earthShadowOnMoon, moonShadowOnEarth, luminance, type V3 } from '../src/lighting/shadowMath.ts'

const AU = 149597870.7
const SUN_R = 695700
// A point on the Moon's centre; the Earth D km away on +x; the Sun 1 AU beyond it on
// a line rotated by `sepRad` about the point (in the x-y plane, angle from the Earth's direction).
function scene(dKm: number, sepRad: number, azimuth = 0) {
  const p: V3 = [0, 0, 0]
  const earth: V3 = [dKm / MOON_R_KM, 0, 0]
  const R = (AU + dKm) / MOON_R_KM
  // Sun direction: tilt from +x by sepRad, in the plane at angle azimuth around the x axis.
  const sun: V3 = [R * Math.cos(sepRad), R * Math.sin(sepRad) * Math.cos(azimuth), R * Math.sin(sepRad) * Math.sin(azimuth)]
  return { p, earth, sun }
}
const D = UMBRA_D0_KM
const rho0 = Math.asin(EARTH_R_KM / D)
const rhoA = Math.asin((EARTH_R_KM + OCCULT_TOP_KM) / D)
const theta = Math.asin(SUN_R / (AU + D))
const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol * Math.max(Math.abs(b), 1e-30), `${msg}: ${a} vs ${b}`)

// 1. Fully outside: exactly 1, nothing refracted.
{
  const { p, earth, sun } = scene(D, 0.1)
  const s = earthShadowOnMoonParts(p, sun, earth)
  assert.deepEqual(s.direct, [1, 1, 1])
  assert.deepEqual(s.refracted, [0, 0, 0])
  assert.deepEqual(earthShadowOnMoon(p, sun, earth), [1, 1, 1])
}
// 2. Deep umbra (u = 0.5): no direct light, refracted = the table's own value at that u.
{
  const u = 0.5
  const { p, earth, sun } = scene(D, u * (rho0 - theta))
  const s = earthShadowOnMoonParts(p, sun, earth)
  assert.deepEqual(s.direct, [0, 0, 0])
  const x = (u / UMBRA_U_MAX) * (UMBRA_N - 1), i = Math.floor(x), t = x - i
  for (let c = 0; c < 3; c++) {
    const want = 2 ** (UMBRA_LOG2[i][c] * (1 - t) + UMBRA_LOG2[i + 1][c] * t)
    near(s.refracted[c], want, 0.02, `refracted channel ${c}`)
  }
  assert.ok(s.refracted[0] > s.refracted[1] && s.refracted[1] > s.refracted[2], 'red > green > blue in the umbra')
  assert.ok(luminance(s.refracted) < 1e-3 && luminance(s.refracted) > 1e-6, 'umbral luminance in a plausible band')
}
// 3. Penumbra: monotone from 1 at the outer edge to 0, and symmetric about the limb.
{
  let prev = 2
  for (let k = 0; k <= 40; k++) {
    const sep = rhoA + theta - (k / 40) * 2 * theta
    const { p, earth, sun } = scene(D, sep)
    const d = earthShadowOnMoonParts(p, sun, earth).direct[1]
    assert.ok(d <= prev + 1e-12, 'direct light falls monotonically inward')
    prev = d
  }
  const at = (sep: number) => { const { p, earth, sun } = scene(D, sep); return earthShadowOnMoonParts(p, sun, earth).direct[1] }
  near(at(rhoA), 0.5, 0.08, 'about half the Sun at the limb (the Earth edge curves away from it)')
  for (const f of [0.2, 0.5, 0.8]) {
    const sum = at(rhoA - f * theta) + at(rhoA + f * theta)
    near(sum, 1, 0.08, `penumbra symmetric about the limb at ${f}`)
  }
  // Round: the same separation at any azimuth gives the same light.
  for (const az of [0.7, 2.1, 4.0]) {
    const a = scene(D, rhoA + 0.3 * theta, 0), b = scene(D, rhoA + 0.3 * theta, az)
    near(earthShadowOnMoonParts(b.p, b.sun, b.earth).direct[1], earthShadowOnMoonParts(a.p, a.sun, a.earth).direct[1], 1e-9, 'azimuth-independent')
  }
}
// 4. The Moon on the Earth: a total solar eclipse is 0, annular leaves a ring, far away is 1.
{
  const moonAt = (dKm: number, sepRad: number) => {
    const p: V3 = [0, 0, 0], moon: V3 = [dKm / MOON_R_KM, 0, 0]
    const R = (AU - dKm) / MOON_R_KM
    return moonShadowOnEarth(p, [R * Math.cos(sepRad), R * Math.sin(sepRad), 0], moon)
  }
  assert.ok(moonAt(370000, 0).every((v) => v < 1e-12), 'total solar eclipse: no direct light')
  const ann = moonAt(405000, 0)
  assert.ok(ann[1] > 0.05 && ann[1] < 0.2, `annular leaves a ring (${ann[1]})`)
  assert.deepEqual(moonAt(384400, 0.1), [1, 1, 1])
}
console.log('eclipse.test: all checks passed')
