// What display grey a star of magnitude V reaches, from the real exposure model (computeExposure) and the final pass's sky-pixel maths
// (post/final.ts, transcribed). This models the PHYSICAL flux (boost 0, no gain, cap or floor); the shipped default boost is 1.0 (src/sky/starBoost.ts), a look setting on top. Any "faint-sky look" belongs in display space, not as a flux gain
// (a x40 gain was reviewed: V5 stayed at grey 0 beside a sunlit Moon, V0 hit the white point on the earthlit side).
import assert from 'node:assert/strict'
import { CameraRig } from '../src/camera/rig.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { computeExposure } from '../src/post/exposure.ts'
import { STAR_PEAK, SUN_V } from '../src/moon/photometry.ts'
import { SKY_CAP, skyCullGain, skyStarGain, skyStarLift } from '../src/sky/skyStars.ts'
import { boostGain, DEFAULT_STAR_BOOST } from '../src/sky/starBoost.ts'
import { dotSamples, starDotAmplitude, starDotPeak } from '../src/sky/starDots.ts'

const H = 800, ASPECT = 1.6
const srgb = (c: number): number => { c = Math.max(0, Math.min(1, c)); return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055 }
type Ex = ReturnType<typeof computeExposure>
function linearY(x: number, ex: Ex, sky = 0): number {
  const sE = x / Math.max(ex.esLevel / ex.white, 1e-9)
  let yLong = ex.longMax * (1 - Math.exp(-0.7 * sE))
  yLong += ex.starLift * 0.6 * (1 - Math.exp(-Math.max(sE - 3, 0) / 12))
  const y = x + (yLong - x) * ex.hdr
  return Math.max(y, sky)   // the sky-star lift (final.ts, linear y before the shoulder)
}
function displayGrey(x: number, ex: Ex, sky = 0): number {
  let y = linearY(x, ex, sky)
  if (y > 0.8) y = 0.8 + 0.2 * Math.tanh((y - 0.8) / 0.2)
  return Math.round(255 * srgb(y * y * (3 - 2 * y) * 0.25 + y * 0.75))
}
function scene(t: string, pose: { lon: number; lat: number; dist: number }): { star: (v: number) => number; ground: number; white: number } {
  const e = ephemerisAt(new Date(t))
  const rig = new CameraRig(); rig.setPose({ ...pose, roll: 0 })
  const cam = rig.camera(e, ASPECT, 1e6)
  const ex = computeExposure({ cam, aspect: ASPECT, canvasHeight: H, ephem: e, albedo: null, lonSpan: 180, preExposeOn: true })
  const tanPerPx = cam.tanHalf / (H / 2)
  const if0 = Math.PI * Math.pow(10, -0.4 * (0 - SUN_V)) / (tanPerPx * tanPerPx)
  return { star: (v) => displayGrey(if0 * Math.pow(10, -0.4 * v) * STAR_PEAK / ex.white, ex), ground: displayGrey(ex.esLevelView / ex.white, ex), white: displayGrey(1, ex) }
}

// Earthlit side (new Moon): the brightest stars never rival the white point or the Moon's own earthlit ground by a wide margin, and they grade by magnitude.
for (const [name, s] of [['home, new Moon', scene('2026-10-10T12:00:00Z', { lon: 0, lat: 0, dist: 6 })], ['crescent, far', scene('2026-10-12T12:00:00Z', { lon: 0, lat: 0, dist: 14 })]] as const) {
  assert.ok(s.star(0) <= 0.5 * s.white, `${name}: V0 (${s.star(0)}) must stay under half the white point (${s.white})`)
  for (let v = 0; v < 4; v++) assert.ok(s.star(v) > s.star(v + 1), `${name}: V${v} must be brighter than V${v + 1} (${s.star(v)} vs ${s.star(v + 1)})`)
}
// A quarter: stars grade by magnitude from V0 to V3 and none reaches the white point.
const q = scene('2026-10-18T00:00:00Z', { lon: 0, lat: 0, dist: 4.5 })
for (let v = 0; v < 3; v++) assert.ok(q.star(v) > q.star(v + 1), `quarter: V${v} brighter than V${v + 1}`)
assert.ok(q.star(0) < q.white, 'quarter: V0 below the white point')
// (The shipped look adds a display-space sky lift on top: sky/skyStars.ts, tested at the end of this file.)
// Beside a sunlit full Moon the physical sky is black: a fifth-magnitude star is not visible (grey < 8), as in a real photograph. Recorded so a "look" change is a decision.
const full = scene('2026-10-26T12:00:00Z', { lon: 0, lat: 0, dist: 4.5 })
assert.ok(full.star(5) < 8, `full Moon: V5 is ${full.star(5)} grey`)

// The shipped look: the default boost (flux x80, soft cap at 0.45 white, as StarPass draws it) plus the final pass's display-space sky lift.
const boosted = (if0: number, v: number, white: number): number => {   // xs of a V star's peak pixel in the scene, in white units
  const cap = 0.45
  const lift = boostGain(DEFAULT_STAR_BOOST) * if0 * Math.pow(10, -0.4 * v) * STAR_PEAK / white
  return cap * (1 - Math.exp(-lift / cap))
}
function sky(t: string, pose: { lon: number; lat: number; dist: number }, fov?: number) {
  const e = ephemerisAt(new Date(t))
  const rig = new CameraRig(); rig.setPose({ ...pose, roll: 0 })
  const cam = rig.camera(e, ASPECT, 1e6)
  const ex = computeExposure({ cam, aspect: ASPECT, canvasHeight: H, ephem: e, albedo: null, lonSpan: 180, preExposeOn: true })
  const tanPerPx = cam.tanHalf / (H / 2)
  const if0 = Math.PI * Math.pow(10, -0.4 * (0 - SUN_V)) / (tanPerPx * tanPerPx)
  const gain = skyStarGain(tanPerPx, boostGain(DEFAULT_STAR_BOOST), ex.white, fov ?? cam.tanHalf)
  return { ex, gain, tanPerPx, if0, fov: cam.tanHalf, star: (v: number, mask = 1) => displayGrey(0, ex, skyStarLift(boosted(if0, v, ex.white), gain, mask, ex.hdr)) / 255 }
}
{
  // Beside a full Moon at Home (hdr 0): a V5 star is clearly visible, the brightest levels off at the cap, and they grade by magnitude.
  const f = sky('2026-10-26T12:00:00Z', { lon: 0, lat: 0, dist: 3.6 })
  assert.equal(f.ex.hdr, 0, 'full Moon at Home is a single exposure')
  assert.ok(f.star(5) >= 0.2 && f.star(5) <= 0.25, `full Moon: V5 displays ${f.star(5)}`)
  const capDisp = displayGrey(0, f.ex, SKY_CAP) / 255
  assert.ok(f.star(0) <= capDisp + 1e-9 && f.star(0) > f.star(3), `full Moon: V0 ${f.star(0)} within the cap ${capDisp}`)
  for (let v = 0; v < 6; v++) assert.ok(f.star(v) >= f.star(v + 1), `full Moon: V${v} not dimmer than V${v + 1}`)
  assert.ok(capDisp < 0.65, `the cap (${capDisp}) stays modest`)
  // The Moon's limb pixel (coverage 0.5, mask 0) and anything on the discs is not lifted: same grey as the unlifted pipeline.
  assert.equal(f.star(0, 0), displayGrey(0, f.ex), 'mask 0: no lift')
  assert.equal(displayGrey(0, f.ex, skyStarLift(0.5, f.gain, 0, f.ex.hdr)), displayGrey(0, f.ex), 'limb pixel at coverage 0.5 is unlifted')
  // A coarse moving target has larger pixels (more flux per pixel) and the inverse sky gain. Rescaling both leaves the displayed star unchanged.
  const motionScale = 0.35
  const motionGain = skyStarGain(f.tanPerPx / motionScale, boostGain(DEFAULT_STAR_BOOST), f.ex.white, f.fov)
  const motionXs = boosted(f.if0 * motionScale * motionScale, 5, f.ex.white)
  const motionGrey = displayGrey(0, f.ex, skyStarLift(motionXs, motionGain, 1, f.ex.hdr)) / 255
  assert.ok(Math.abs(motionGrey - f.star(5)) < 1e-12, 'motion grid keeps a Home V5 star as bright as rest')
  console.log('sky lift full Moon V0..V6 (display)', JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((v) => +f.star(v).toFixed(3))))
  // The night side's long exposure already shows stars: no double lift as hdr rises.
  assert.equal(skyStarLift(1e-3, f.gain, 1, 1), 0, 'hdr 1: no sky lift')
  assert.ok(skyStarLift(1e-3, f.gain, 1, 0.5) < skyStarLift(1e-3, f.gain, 1, 0), 'the lift fades with hdr')
  assert.equal(skyCullGain(f.gain, 1), 1, 'hdr 1: the cull assumes no lift')
  assert.ok(skyCullGain(f.gain, 0) === f.gain && f.gain > 1, 'hdr 0: the cull sees the lift')
  // A wide lens dims the field (item 20: "looks super fake" on a wide low-orbit view).
  const wide = sky('2026-10-26T12:00:00Z', { lon: 0, lat: 0, dist: 3.6 }, 0.577)
  assert.ok(wide.star(5) < f.star(5), 'a 60 degree lens shows its V5 dimmer')
  // Earthlit ground (alpha 0, inside the Moon's cover, so mask 0) is unchanged by the lift, at any brightness.
  const g = displayGrey(0.02, f.ex)
  assert.equal(displayGrey(0.02, f.ex, skyStarLift(0.02, f.gain, 0, f.ex.hdr)), g, 'earthlit ground: unchanged')
  // A crescent (hdr ~0.9): the sky lift adds under 5 grey to a V5 star on top of the long exposure.
  const cr = sky('2026-10-18T00:00:00Z', { lon: 0, lat: 0, dist: 3.6 })
  assert.ok(cr.ex.hdr > 0.8 && Math.abs(cr.star(5) - displayGrey(0, cr.ex) / 255) < 0.05, 'crescent: the sky lift is nearly out')
}
// The native dots (sky/starDots.ts, `?stars=native`): at full resolution a star's dot carries the scene sprite's integrated display flux, the same boosted
// flux through the same sky-pixel maths per sprite pixel (beside the full Moon the lift, on the crescent the long exposure), and for a star the curve
// is linear for (V4 and fainter) its centre is the scene path's peak pixel. The switch changes the footprint, not the light; on a motion grid the
// display flux differs between the paths by design (the sprite is magnified, the dot is not).
for (const [name, t, dist] of [['full Moon', '2026-10-26T12:00:00Z', 3.6], ['crescent', '2026-10-18T00:00:00Z', 3.6], ['new Moon', '2026-10-10T12:00:00Z', 6]] as const) {
  const e = ephemerisAt(new Date(t))
  const rig = new CameraRig(); rig.setPose({ lon: 0, lat: 0, dist, roll: 0 })
  const cam = rig.camera(e, ASPECT, 1e6)
  const ex = computeExposure({ cam, aspect: ASPECT, canvasHeight: H, ephem: e, albedo: null, lonSpan: 180, preExposeOn: true })
  const tanPerPx = cam.tanHalf / (H / 2)
  const if0 = Math.PI * Math.pow(10, -0.4 * (0 - SUN_V)) / (tanPerPx * tanPerPx)
  const gain = skyStarGain(tanPerPx, boostGain(DEFAULT_STAR_BOOST), ex.white, cam.tanHalf)
  for (let v = -1; v <= 6.5; v += 0.5) {
    const flux = { flux: Math.pow(10, -0.4 * v), if0, preExpose: ex.preExpose, gain: boostGain(DEFAULT_STAR_BOOST), cap: 0.45 * ex.white * ex.preExpose, mix: 1 }
    const dx = { white: ex.white * ex.preExpose, hdr: ex.hdr, esLevel: ex.esLevel / ex.white, longMax: ex.longMax, starLift: ex.starLift, skyGain: gain }
    // The scene sprite, star on a pixel centre: each pixel holds the boosted flux times its Gaussian weight, through the sky-pixel maths.
    const samples = dotSamples(0, 0)
    const sceneSum = samples.reduce((a, p) => { const xs = boosted(if0 * p.w, v, ex.white); return a + linearY(xs, ex, skyStarLift(xs, gain, 1, ex.hdr)) }, 0)
    const amp = starDotAmplitude(flux, dx)
    const dotSum = samples.reduce((a, p) => a + amp * p.w, 0)
    assert.ok(sceneSum > 0 && Math.abs(dotSum / sceneSum - 1) < 1e-6, `${name} V${v}: dot flux ${dotSum} vs scene sprite ${sceneSum}`)
    const xs = boosted(if0, v, ex.white)
    const scenePeak = linearY(xs, ex, skyStarLift(xs, gain, 1, ex.hdr))
    assert.ok(Math.abs(starDotPeak(flux, dx) / scenePeak - 1) < 1e-6, `${name} V${v}: the per-pixel curve is the scene pixel's`)
    // With the stronger Home lift, V5 is just into its soft cap; the integrated dot keeps its flux within 6% of the scene peak. On the crescent, the long exposure saturates even V5, so the wings' light moves inward.
    if (v >= 5 && ex.hdr === 0) assert.ok(Math.abs(amp / scenePeak - 1) < 0.06, `${name} V${v}: a faint star's centre stays close to the scene peak (${amp} vs ${scenePeak})`)
    if (ex.hdr > 0.5 && v <= 2) assert.ok(amp > scenePeak, `${name} V${v}: a saturated star's centre is above its scene peak (${amp} vs ${scenePeak})`)
  }
}
console.log('star-grey ok', JSON.stringify({ newMoonV0: scene('2026-10-10T12:00:00Z', { lon: 0, lat: 0, dist: 6 }).star(0), quarterV0to5: [0, 1, 2, 3, 4, 5].map(q.star), fullV0: full.star(0) }))
// ?starlift: absent or 0 leaves starLift exactly as before; a floor raises it only up to itself and never lowers it.
{
  const e = ephemerisAt(new Date('2026-10-18T00:00:00Z'))
  const rig = new CameraRig(); rig.setPose({ lon: 0, lat: 0, dist: 4.5, roll: 0 })
  const cam = rig.camera(e, ASPECT, 1e6)
  const inp = { cam, aspect: ASPECT, canvasHeight: H, ephem: e, albedo: null, lonSpan: 180, preExposeOn: true }
  const base = computeExposure(inp)
  assert.deepEqual(computeExposure({ ...inp, starLiftFloor: 0 }), base, 'floor 0 is byte-identical')
  const lifted = computeExposure({ ...inp, starLiftFloor: 0.3 })
  assert.ok(lifted.starLift >= 0.3 && lifted.starLift >= base.starLift, 'floor lifts starLift to at least 0.3')
  assert.equal(lifted.white, base.white, 'only starLift changes')
}
