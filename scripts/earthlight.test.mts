// Earthlight where the Earth is not overhead (poles): the Earth's disc, the ambient estimate scaled by the computed earthshine, and the exposure search seeing it.
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { AMBIENT_EARTHSHINE_SHARE, EARTHLIGHT_GLSL, earthAngularRadius, earthDiscMu } from '../src/moon/earthlight.ts'
import { moonFragment } from '../src/moon/moonShader.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { searchFrame } from '../src/post/exposure.ts'
import { MOON_R_KM } from '../src/glsl/common.ts'
import type { ViewCamera } from '../src/camera/pose.ts'

const DEG = Math.PI / 180
const near = (a: number, b: number, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`)

// The Earth is 1.9 deg across: angular radius from the real distance (356,500 to 406,700 km).
for (const km of [356500, 384400, 406700]) {
  const r = earthAngularRadius(km / MOON_R_KM, MOON_R_KM) / DEG
  assert.ok(r > 0.89 && r < 1.03, `${km} km -> ${r} deg`)
}
const r = 0.95 * DEG
// Away from the horizon the disc is a point: the mean cosine is the centre's.
near(earthDiscMu(Math.cos(40 * DEG), r), Math.cos(40 * DEG), 1e-6)
near(earthDiscMu(Math.cos(80 * DEG), r), Math.cos(80 * DEG), 1e-4)
// The Earth's centre on the horizon: half the disc is up, the mean cosine is r * 2/(3 pi) (small, not zero).
near(earthDiscMu(0, r), r * 2 / (3 * Math.PI), 1e-9)
// Fully below its own width: nothing. Continuous and monotone through the horizon.
assert.equal(earthDiscMu(-Math.sin(1.2 * r), r), 0)
let prev = -1
for (let a = -3; a <= 3; a += 0.01) {
  const m = earthDiscMu(Math.sin(a * DEG), r)
  assert.ok(m >= prev - 1e-12, `monotone at ${a}`)
  prev = m
}
// Within the disc's width of the horizon the answer differs from the point value by less than the disc's radius.
for (const el of [0.2, 0.5, 1, 2, 10]) assert.ok(Math.abs(earthDiscMu(Math.sin(el * DEG), r) - Math.sin(el * DEG)) < r, `el ${el}`)

// The ambient is an estimate scaled by the COMPUTED earthshine: zero with no earthshine, proportional, small against direct earthlight.
const ambient = (earthshine: number) => earthshine * AMBIENT_EARTHSHINE_SHARE * 0.5
assert.equal(ambient(0), 0)
near(ambient(2e-5) / ambient(1e-5), 2, 1e-12)
assert.ok(AMBIENT_EARTHSHINE_SHARE > 0 && AMBIENT_EARTHSHINE_SHARE <= 0.1, 'an estimate of a few percent, labelled as one')
// And the Earth's phase drives earthshine itself: a nearly full Earth (new Moon) is far brighter than a nearly new one (full Moon).
const newMoon = ephemerisAt(new Date('2026-10-10T15:00:00Z')).earthshine
const fullMoon = ephemerisAt(new Date('2026-10-26T04:00:00Z')).earthshine
assert.ok(newMoon > 10 * fullMoon, `earthshine at new Moon ${newMoon} vs full Moon ${fullMoon}`)

// The shader carries the same function and the ambient term, with the constants from the module.
const frag = moonFragment(180, 4096)
assert.ok(frag.includes(EARTHLIGHT_GLSL.trim().split('\n')[1]), 'earthDiscMu comment line')
assert.ok(frag.includes('float earthDiscMu(float s, float r)'))
assert.ok(frag.includes(`const float AMBIENT_ES = ${AMBIENT_EARTHSHINE_SHARE.toFixed(3)};`))
assert.ok(frag.includes('earthDiscMu(dot(nrm, uEarth), earthR)'), 'the earthlit term uses the disc')
assert.ok(frag.includes('uEarthshine * AMBIENT_ES'), 'ambient scales with the computed earthshine')
// The night floor (?nightfloor=, src/post/exposure.ts nightFloorRadiance) is a display term apart from the earthlight: added after the fill's hand-off
// and the radiance key have read the earthshine alone (esL), in the ground's own albedo, under the inverse fill key.
assert.ok(frag.includes('uniform float uNightFloor;'))
const floorLine = 'es += albedo * (uNightFloor / 0.12) * (1.0 - smoothstep(-0.030, 0.120, dot(p, uS)));'
assert.ok(frag.includes(floorLine), 'the floor follows the continuous inverse fill key across the terminator')
assert.ok(frag.includes('if (uNightFloor > 0.0) {'), 'off costs nothing')
Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: '?radkey=1' } })
const radKeyShader = await import(new URL('../src/moon/moonShader.ts?earthlight-radkey', import.meta.url).href) as typeof import('../src/moon/moonShader.ts')
const radFrag = radKeyShader.moonFragment(180, 4096)
assert.ok(radFrag.includes('float esL = ') && radFrag.indexOf('float esL = ') < radFrag.indexOf(floorLine), 'with ?radkey=1, the radiance key and fill hand-off see earthshine before the floor')
assert.ok(frag.indexOf('float groundLum = ') < frag.indexOf(floorLine) && frag.indexOf(floorLine) < frag.indexOf('vec3 col = flush16((sun + es)'), 'the highlight reads the ground before the floor; the floor is in the stored colour')

// The exposure search sees earthlight over the north pole when the Earth is below the horizon there (before: esMax 0 and the frame was exposed for stars).
let date = new Date('2026-10-01T00:00:00Z')
let e = ephemerisAt(date)
while (e.subEarth.lat > -5.5 && date.getTime() < Date.parse('2026-12-01')) { date = new Date(date.getTime() + 6 * 3600e3); e = ephemerisAt(date) }
assert.ok(e.subEarth.lat <= -5.5, `found a date with the Earth 5.5 deg below the north pole's horizon: ${e.subEarth.lat}`)
const pole = e.moonZ.clone()
const cam: ViewCamera = { pos: pole.clone().multiplyScalar(1.2), right: e.moonX.clone(), up: e.moonY.clone(), back: pole.clone(), tanHalf: Math.tan(3 * DEG) } as unknown as ViewCamera
const s = searchFrame(cam, 1.6, e, null, 180)
assert.ok(s.hits > 0, 'the pole is in view')
assert.ok(e.earthDir.dot(pole) < -0.09, 'the Earth is below the pole horizon')
near(s.esMax, AMBIENT_EARTHSHINE_SHARE * 0.5, 1e-12)
void Vector3
console.log('earthlight: ok')
