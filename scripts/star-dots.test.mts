// Stars as native-resolution dots (sky/starDots.ts, owner complaint 9): the switch, exactly one draw path per frame, the pixel-scale rescaling that
// keeps brightness and the star count steady across motion-grid steps, the canvas-aspect projection, the per-star integrated display flux, the dot's
// footprint (moment FWHM 1.65 px, flux steady under sub-pixel pans, the measurement window against the canvas dither) and the mask rule.
import assert from 'node:assert/strict'
import { Matrix4, Vector3, Vector4 } from 'three'
import {
  DOT_ALPHA_HIDE, DOT_SIGMA_PX, DOT_SPRITE_PX, canvasPerTargetPx, dotIf0, dotMask, dotProjection, dotSamples, dotSkyGain, dotWeight, momentFwhm,
  profileFwhm, starDotAmplitude, starDotMode, starDotPeak, starPathsForFrame, type StarDotExposure,
} from '../src/sky/starDots.ts'
import { skyStarGain, skyStarLift } from '../src/sky/skyStars.ts'
import { SUN_V } from '../src/moon/photometry.ts'
import { drawCount } from '../src/sky/starLimit.ts'
import { SunPass } from '../src/sun/SunPass.ts'

// The switch: off by default off the desktop class (the scene sprites); `?stars=0` is main.ts' "no stars", never native.
assert.equal(starDotMode(''), 'scene')
// Desktop class (2026-10-23, owner complaint 9): native dots by default, scene is the opt-out, 0 and other values are never native.
assert.equal(starDotMode('', true), 'native')
assert.equal(starDotMode('?stars=scene', true), 'scene')
assert.equal(starDotMode('?stars=0', true), 'scene')
assert.equal(starDotMode('?stars=native', false), 'native')
assert.equal(starDotMode('?stars=native'), 'native')
assert.equal(starDotMode('?stars=scene'), 'scene')
assert.equal(starDotMode('?stars=0'), 'scene')
assert.equal(starDotMode('?stars=1'), 'scene')
// The Earth mask is computed even when the Sun is behind the camera; native stars still need it over black Earth pixels.
{
  const pass = new SunPass({})
  const ephemeris = {
    sunKm: new Vector3(0, 0, 400_000),
    earthKm: new Vector3(0, 0, -400_000),
  } as never
  const cam = {
    pos: new Vector3(), back: new Vector3(0, 0, 1),
    right: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0), tanHalf: 0.5,
  } as never
  pass.update(ephemeris, cam, 800, 600, 0.001, 1)
  assert.deepEqual(pass.glare.earthDisc?.slice(0, 2), [0.5, 0.5], 'Earth ahead projects at the canvas centre')
  assert.ok((pass.glare.earthDisc?.[2] ?? 0) > 0, 'Earth disc is produced while the Sun is behind the camera')
}
// Exactly one draw path per frame: StarPass.render draws the sprites unless the final pass takes the dots; a ridge frame (dots not allowed) keeps
// the sprites even in native mode; scene mode never gives the dots.
for (const mode of ['scene', 'native'] as const) for (const allowed of [true, false]) {
  const p = starPathsForFrame(mode, allowed)
  assert.equal(Number(p.sprites) + Number(p.dots), 1, `${mode} allowed ${allowed}: exactly one path`)
}
assert.deepEqual(starPathsForFrame('scene', true), { sprites: true, dots: false })
assert.deepEqual(starPathsForFrame('native', true), { sprites: false, dots: true })
assert.deepEqual(starPathsForFrame('native', false), { sprites: true, dots: false }, 'a ridge frame keeps the sprites')

// The canvas pixel from the two heights: 1 at full resolution, 1/scale on a grid, 1 when a height is missing.
assert.equal(canvasPerTargetPx(900, 900), 1)
assert.equal(canvasPerTargetPx(315, 900), 900 / 315)
assert.equal(canvasPerTargetPx(0, 900), 1)

// The projection for the canvas aspect: a direction that lands at clip x with the target's aspect lands at x times (target aspect / canvas aspect);
// y and w are untouched; equal aspects change nothing. (t.w, t.h are the rounded grid: 1440 x 900 at 0.35 is 504 x 315, aspect 1.6000; 1439 x 900 is 1.5989.)
{
  const tanHalf = 0.268, near = 0.001, far = 100
  const proj = (w: number, h: number) => new Matrix4().makePerspective(-near * tanHalf * (w / h), near * tanHalf * (w / h), near * tanHalf, -near * tanHalf, near, far)
  const dir = new Vector4(0.1, 0.05, -1, 0)
  const a = dir.clone().applyMatrix4(proj(504, 315)), c = dir.clone().applyMatrix4(proj(1439, 900))
  const out = dotProjection(proj(504, 315), 504, 315, 1439, 900, new Matrix4())
  const d = dir.clone().applyMatrix4(out)
  assert.ok(Math.abs(d.x - c.x) < 1e-9 && Math.abs(d.y - c.y) < 1e-9 && Math.abs(d.w - c.w) < 1e-9, `re-projected ${d.x} vs canvas ${c.x} (target ${a.x})`)
  assert.ok(Math.abs(a.x - c.x) > 1e-5, 'the aspects differ enough to matter')
  const same = dotProjection(proj(1440, 900), 1440, 900, 1440, 900, new Matrix4())
  assert.deepEqual(same.elements, proj(1440, 900).elements, 'equal aspects: identical')
}

// Grid invariance: the target's uIf0 and sky gain are set for its pixel (StarPass.update, skyStarGain); rescaled to the canvas pixel they are the
// full-resolution values at every motion scale, so a star's amplitude (V0 and V5, beside a sunlit Moon and on the night side) does not step with the grid.
const CANVAS_H = 900, TAN_HALF = 0.268, WHITE = 0.19, PRE = 1
const if0At = (h: number) => { const t = TAN_HALF / (h / 2); return Math.PI * Math.pow(10, -0.4 * (0 - SUN_V)) / (t * t) }
const gainAt = (h: number) => skyStarGain(TAN_HALF / (h / 2), 80, WHITE, TAN_HALF)
const full = { if0: if0At(CANVAS_H), gain: gainAt(CANVAS_H) }
const exposures: StarDotExposure[] = [
  { white: WHITE * PRE, hdr: 0, esLevel: 0.02, longMax: 0.3, starLift: 0, skyGain: full.gain },     // Home beside a sunlit Moon
  { white: 0.004 * PRE, hdr: 1, esLevel: 0.5, longMax: 0.3, starLift: 0.6, skyGain: 0 },           // the night side's long exposure
]
const fluxOf = (v: number, if0: number) => ({ flux: Math.pow(10, -0.4 * v), if0, preExpose: PRE, gain: 80, cap: 0.45 * WHITE * PRE, mix: 1 })
for (const scale of [1, 0.7, 0.5, 0.35, 0.25]) {
  const h = Math.round(CANVAS_H * scale)
  const k = canvasPerTargetPx(h, CANVAS_H)
  const if0 = dotIf0(if0At(h), k)
  assert.ok(Math.abs(if0 / full.if0 - 1) < 1e-3, `scale ${scale}: canvas I/F ${if0} vs full ${full.if0}`)
  const g = dotSkyGain(gainAt(h), k)
  assert.ok(Math.abs(g / full.gain - 1) < 1e-3, `scale ${scale}: canvas sky gain ${g} vs full ${full.gain}`)
  for (const ex of exposures) for (const v of [0, 3, 5]) {
    const atScale = starDotAmplitude(fluxOf(v, if0), { ...ex, skyGain: ex.skyGain > 0 ? g : 0 })
    const atFull = starDotAmplitude(fluxOf(v, full.if0), ex)
    assert.ok(atFull > 0 && Math.abs(atScale / atFull - 1) < 2e-3, `scale ${scale} hdr ${ex.hdr} V${v}: amplitude ${atScale} vs ${atFull}`)
  }
  // The cull at the canvas scale draws the same stars at every grid step (the target's own cull would drop faint ones on a coarse grid).
  const mags = Float32Array.from({ length: 27 }, (_, i) => i * 0.25)
  assert.equal(drawCount({ mode: 'auto' }, mags, if0, WHITE, 80 * g), drawCount({ mode: 'auto' }, mags, full.if0, WHITE, 80 * full.gain), `scale ${scale}: same draw range`)
}
assert.ok(dotIf0(2, 1) === 2 && dotSkyGain(2, 1) === 2, 'k 1: unchanged')
assert.equal(dotIf0(if0At(450), canvasPerTargetPx(450, 900)) < dotIf0(if0At(450), 2.0001), true, 'I/F grows with k squared')

// The per-pixel curve (starDotPeak): a V5 star beside the sunlit Moon shows (the sky lift), brighter stars grade and level off at the lift's cap;
// off the lift, the physical sky is black.
{
  const ex = exposures[0]
  const y5 = starDotPeak(fluxOf(5, full.if0), ex)
  assert.ok(y5 > 0.01 && y5 < 0.08, `V5 beside the Moon: ${y5}`)
  let prev = Infinity
  for (let v = -1; v <= 6; v++) { const y = starDotPeak(fluxOf(v, full.if0), ex); assert.ok(y <= prev + 1e-12 && y <= 0.3 + 1e-9, `V${v}: ${y} <= ${prev}, within the cap`); prev = y }
  assert.ok(starDotPeak(fluxOf(5, full.if0), { ...ex, skyGain: 0 }) < 1e-3, 'no lift: a V5 star is black beside the Moon, as today')
  // hdr 0 without the lift is the boosted physical star itself (stars.ts' soft cap at the Gaussian's centre), in white units.
  const xs = 0.45 * (1 - Math.exp(-80 * Math.pow(10, -2) * full.if0 * (1 / (2 * Math.PI * 0.49)) / (0.45 * WHITE)))
  assert.ok(Math.abs(starDotPeak(fluxOf(5, full.if0), { ...ex, skyGain: 0 }) / xs - 1) < 1e-9, 'hdr 0, no lift: the boosted physical star itself')
  // The lift is the same function the scene path's pixel uses (skyStars.ts): a dot's y is never below it.
  assert.ok(Math.abs(y5 - skyStarLift(xs, full.gain, 1, 0)) < 1e-12, 'V5 at hdr 0 is exactly the sky lift of its boosted peak')
}

// The amplitude keeps the integrated display flux: the dot's summed value (amplitude x the centred Gaussian) equals the sum of the per-pixel curve
// over the same sprite, i.e. what the scene path draws at full resolution; a faint star (curve linear) gets exactly curve(peak); a star at the
// lift's cap gets more than the cap at its centre (the wings' light moves inward), which the final pass's shoulder rolls off. "Flux unchanged"
// between the paths means the catalogue flux and the full-resolution display flux; on a motion grid the display flux differs by design.
for (const ex of exposures) for (let v = -1; v <= 6.5; v += 0.5) {
  const f = fluxOf(v, full.if0)
  const amp = starDotAmplitude(f, ex)
  const samples = dotSamples(0, 0)
  const dotSum = samples.reduce((a, p) => a + amp * p.w, 0)
  const sceneSum = samples.reduce((a, p) => a + starDotPeak({ ...f, flux: f.flux * p.w }, ex), 0)
  assert.ok(Math.abs(dotSum / sceneSum - 1) < 1e-9, `hdr ${ex.hdr} V${v}: dot flux ${dotSum} vs scene ${sceneSum}`)
}
{
  const ex = exposures[0]
  assert.ok(Math.abs(starDotAmplitude(fluxOf(6, full.if0), ex) / starDotPeak(fluxOf(6, full.if0), ex) - 1) < 0.06, 'V6 near the soft cap: amplitude stays close to the peak')
  assert.ok(starDotAmplitude(fluxOf(0, full.if0), ex) > 0.3 && starDotAmplitude(fluxOf(0, full.if0), ex) < 1.2, `V0 at the cap: amplitude ${starDotAmplitude(fluxOf(0, full.if0), ex)} above the cap, bounded`)
}

// The footprint: sigma 0.7 canvas px, a 5 px sprite. The moment FWHM (the gate scripts/star-fwhm.mjs applies, 2 px) is the Gaussian's 1.65 px at every
// sub-pixel position; the half-maximum crossings through the peak row and column read up to 2.15 px for a star between two pixels (the method's
// bias on 1 px samples, see momentFwhm). The dot's summed weight (its flux on the canvas) moves under 0.5 % as the star pans across a pixel: no shimmer.
assert.equal(DOT_SIGMA_PX, 0.7); assert.equal(DOT_SPRITE_PX, 5)
assert.equal(dotWeight(0, 0), 1)
assert.ok(Math.abs(dotWeight(1, 0) - Math.exp(-1 / 0.98)) < 1e-12)
const sums: number[] = []
for (const [ox, oy] of [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5], [0.25, 0.75], [0.1, 0.9], [-0.5, 0.5]] as const) {
  const px = dotSamples(ox, oy)
  assert.equal(px.length, DOT_SPRITE_PX * DOT_SPRITE_PX)
  const img = new Map<string, number>()
  for (const p of px) img.set(`${p.i},${p.j}`, p.w)
  let peak = 0, at = [0, 0]
  for (const p of px) if (p.w > peak) { peak = p.w; at = [p.i, p.j] }
  const row = [-2, -1, 0, 1, 2].map((i) => img.get(`${at[0] + i},${at[1]}`) ?? 0)
  const col = [-2, -1, 0, 1, 2].map((j) => img.get(`${at[0]},${at[1] + j}`) ?? 0)
  for (const [name, p] of [['row', row], ['col', col]] as const) {
    const f = profileFwhm(p)
    assert.ok(f >= 1.3 && f <= 2.2, `offset ${ox},${oy} ${name}: crossing FWHM ${f} px`)
  }
  const m = momentFwhm(px.map((p) => ({ x: p.dx, y: p.dy, v: p.w })))
  assert.ok(Math.abs(m - 1.648) < 0.03 && m <= 2.0, `offset ${ox},${oy}: moment FWHM ${m} px`)
  sums.push(px.reduce((a, p) => a + p.w, 0))
}
assert.ok((Math.max(...sums) - Math.min(...sums)) / Math.max(...sums) < 5e-3, `flux across a pan: ${JSON.stringify(sums)}`)
// The continuous Gaussian's FWHM for sigma 0.7 is 1.648 px; the sampled one on a pixel centre is a little under it.
assert.ok(Math.abs(2 * Math.sqrt(2 * Math.log(2)) * DOT_SIGMA_PX - 1.648) < 1e-3)
assert.ok(Number.isNaN(momentFwhm([{ x: 0, y: 0, v: 0 }])))
assert.ok(Math.abs(momentFwhm([{ x: -1, y: 0, v: 1 }, { x: 1, y: 0, v: 1 }]) - 2.355 * Math.sqrt(0.5)) < 1e-3, 'two pixels 2 apart: per-axis sigma sqrt(1/2)')
// A 5 px plateau (today's lifted blob on a 0.35 grid, flat across the sprite) reads about 3.4 px: the gate separates the two pictures.
assert.ok(momentFwhm(dotSamples().map((p) => ({ x: p.dx, y: p.dy, v: 1 }))) > 3, 'a flat 5 x 5 blob is far over the gate')
// The measurement window against the canvas dither (final.ts adds +-1/255 before the sRGB bytes; about an eighth of black-sky pixels read byte 1,
// 3e-4 linear): a V5 dot (peak 0.0133 linear) measured over radius 2 moves under 0.1 px; over radius 4 the same noise, with weights up to r^2 = 32,
// adds over 0.2 px. That is why star-fwhm.mjs sums the moment over 5 x 5 and reads the background from a ring further out.
{
  const PEAK = 0.0133, BYTE1 = 3.035e-4
  let seed = 7
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const window = (r: number) => { const px: { x: number; y: number; v: number }[] = []; for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) px.push({ x: i, y: j, v: PEAK * dotWeight(i, j) + (rnd() < 0.125 ? BYTE1 : 0) }); return px }
  const w2: number[] = [], w4: number[] = []
  for (let t = 0; t < 40; t++) { w2.push(momentFwhm(window(2))); w4.push(momentFwhm(window(4))) }
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
  assert.ok(mean(w2) < 1.648 + 0.1 && mean(w2) > 1.55, `radius 2 under dither: ${mean(w2)} px`)
  assert.ok(mean(w4) > 1.648 + 0.2, `radius 4 under dither: ${mean(w4)} px (the bias the window avoids)`)
}
assert.equal(profileFwhm([0, 0.5, 1, 0.5, 0]), 2)
assert.equal(profileFwhm([0, 1, 0]), 1)
assert.ok(Number.isNaN(profileFwhm([0, 0, 0])))
assert.ok(Math.abs(profileFwhm([0, 0, 1, 0, 0]) - 1) < 1e-12, 'a single pixel: 1')

// The mask rule (final.ts starSky): 1 on sky, 0 on the Moon (the limb rule, widened by SKY_MARGIN_PX, is in `hide`), on the Earth's disc whenever it
// is in front of the camera and on foreground depth (also `hide`), and wherever the scene alpha (sunlit ground, the ridge's coverage) reaches
// DOT_ALPHA_HIDE; smooth below it, so a limb pixel never flickers. The shader adds a fourth term this twin does not carry: any scene light at all
// hides the dot (in native mode the sky holds no stars, so light is a body: shadowed slopes, the Moon's night side, the dark Earth).
assert.equal(dotMask(1, 0), 1)
assert.equal(dotMask(0, 0), 0, 'on a body')
assert.equal(dotMask(1, DOT_ALPHA_HIDE), 0, 'sunlit ground')
assert.equal(dotMask(1, 1), 0)
assert.equal(dotMask(0.5, 0), 0.5, 'the limb margin fades the dot')
const a1 = dotMask(1, 0.01), a2 = dotMask(1, 0.03)
assert.ok(a1 > a2 && a2 > 0 && a1 < 1, `alpha ramps the mask down: ${a1} > ${a2}`)
assert.equal(dotMask(2, -1), 1, 'clamped')
console.log('star-dots ok')

// The display gain on the dots (owner 2026-10-31: too dim on a phone): applied once, in the final pass's composite, before the shoulder; the
// footprint above (sigma, the 2.0 px moment gate) does not change with it.
{
  const { STAR_DOT_GAIN } = await import('../src/sky/starDots.ts')
  const { readFileSync } = await import('node:fs')
  assert.equal(STAR_DOT_GAIN, 3)
  const fin = readFileSync(new URL('../src/post/final.ts', import.meta.url), 'utf8')
  assert.match(fin, /float y = texture\(uStarDots, vUv\)\.r \* starSky\(\) \* \$\{STAR_DOT_GAIN\.toFixed\(3\)\};\n\s+if \(y <= 0\.0\) return s;\n\s+if \(y > 0\.8\)/, 'the gain is applied before the shoulder')
  assert.equal(fin.match(/STAR_DOT_GAIN\.toFixed/g)?.length, 1, 'applied once')
  const { dotDisplay } = await import('../src/sky/starDots.ts')
  // Faint stars (the linear range): 3 x brighter on the display curve's input; the brightest beside a full Moon (the lift's cap, 0.3 linear)
  // roll into the shoulder and stay just off white: bright, not a clipped lamp.
  { const r = dotDisplay(0.01) / dotDisplay(0.01, 1 / STAR_DOT_GAIN); assert.ok(r > 2.9 && r < 3.1, `faint: ${r}x`) }
  const capShown = dotDisplay(0.3)
  assert.ok(capShown > 0.8 && capShown < 0.95, `the lift's cap shows at ${capShown}`)
  assert.ok(dotDisplay(10) < 1 && dotDisplay(10) > 0.95, 'a saturated dot rolls into white, no clip')
  assert.equal(dotDisplay(0.5, 0), 0, 'masked: nothing')
}

