import * as THREE from 'three'
import { trackGpu } from '../quality/track'
import { SKY_GLSL, skyCullGain, skyStarLift } from './skyStars'
import { PEAK_W } from './starLimit'
import type { StarPass } from './stars'

/**
 * Stars as native-resolution dots (owner complaint 9, 2026-10-23: "the stars are way too blotchy ... just clear white dots rather than these blotches").
 *
 * The scene-target sprites (stars.ts) are 5 render-pixel Gaussians on the motion grid (0.25-0.5 of the canvas in a drag or a walk); the final pass
 * magnifies them 2-4x with bilinear plus the anti-sparkle kernel into a 3-6 px blob, and the sky lift's saturating curve flattens the blob into a
 * plateau. This layer draws the same catalogue, draw range and flux into its own canvas-sized target instead, after the upsample has nothing to
 * do with them: one sprite per star, sigma DOT_SIGMA_PX canvas pixels whatever the grid, centred on the star's exact sub-pixel position (the
 * Gaussian sampled at pixel centres is the antialiasing). The exposure curve (post/final.ts' sky-pixel maths, transcribed in starDotPeak) is applied
 * per STAR to its peak, in the vertex shader, and the footprint is the Gaussian of that peak: a star that saturates the lift keeps its width instead
 * of growing a flat top. The final pass (FinalPass.renderStarDots, starDots() in its fragment) masks each pixel by the limb rule (bodiesHide widened by
 * SKY_MARGIN_PX, the Earth, foreground depth) and the scene alpha, puts the dot through the same shoulder, toe and sRGB as the picture, and screens it
 * over the sky. Neutral white: the catalogue colour is not carried (the owner asked for white dots).
 *
 * Pixel scale: the sprites' I/F and the sky lift's gain are both set for the TARGET's pixel (StarPass.update, skyStarGain). Here the pixel is the
 * canvas's, `k` = canvas px per target px: I/F per pixel scales by k^2 (the same flux over smaller pixels) and the lift's gain by 1/k^2, so a V5 star
 * peaks where it did and the brightness does not step with the grid. The limiting-magnitude cull is re-run at the canvas scale (StarPass.cullFor)
 * so a grid step never changes which stars are drawn.
 *
 * `?stars=native` turns it on; it is the default on the desktop class (L4 rig, motion grid 0.35, orbit pose: moment-FWHM 1.62 px on every drag frame against 3.12-3.14 px for the sprites; owner complaint 9, 2026-10-23); every other class keeps `scene` (the sprites) until its own run, and `?stars=scene` is the opt-out. One path at a time: StarPass.render draws
 * nothing in native mode, and the final pass composites nothing in scene mode.
 */

export type StarDotMode = 'scene' | 'native'

/** `?stars=native`: dots in the final pass; `?stars=scene` (or any other value, including `?stars=0`, which main.ts reads as stars off) keeps the scene sprites; with no value the desktop class gets the dots and every other class the sprites. */
export function starDotMode(search: string, desktopClass = false): StarDotMode {
  const v = new URLSearchParams(search).get('stars')
  return v === 'native' || (v === null && desktopClass) ? 'native' : 'scene'
}
/**
 * Which path draws the stars this frame: the scene sprites (StarPass.render) or the final pass's dots, exactly one of them. `dotsAllowed` is false
 * in a ridge frame (RidgePass zeroes the exposure key under its ground and the frame has no depth, so the dots' mask has nothing to hold on to):
 * native mode then keeps the sprites for that frame.
 */
export function starPathsForFrame(mode: StarDotMode, dotsAllowed: boolean): { sprites: boolean; dots: boolean } {
  const dots = mode === 'native' && dotsAllowed
  return { sprites: !dots, dots }
}

/**
 * The dots' projection: the StarPass's `viewRotProj` was built for the TARGET's aspect (t.w / t.h); the layer is the canvas (cw / ch), which the
 * rounded grid does not match exactly, and a row of mismatch is a nearest-sampled row skipped or doubled that moves with the grid. The perspective
 * scales clip x by 1 / aspect, so the clip x row times (target aspect / canvas aspect) is the same rotation projected for the canvas.
 */
export function dotProjection(viewRotProj: THREE.Matrix4, tw: number, th: number, cw: number, ch: number, out: THREE.Matrix4): THREE.Matrix4 {
  out.copy(viewRotProj)
  const f = tw > 0 && th > 0 && cw > 0 && ch > 0 ? (tw / th) / (cw / ch) : 1
  const e = out.elements   // column-major: row 0 is elements 0, 4, 8, 12
  e[0] *= f; e[4] *= f; e[8] *= f; e[12] *= f
  return out
}

/** The dot's Gaussian sigma and sprite size, canvas pixels: as the scene sprite, but on the output grid. */
export const DOT_SIGMA_PX = 0.7
export const DOT_SPRITE_PX = 5
/** stars.ts caps the physical star below half-float's maximum; the same here, before the exposure. */
export const DOT_PHYS_MAX = 6.0e4
/** Scene alpha (the exposure key: sunlit ground, the ridge's coverage) from which a pixel hides the dot entirely. */
export const DOT_ALPHA_HIDE = 0.05
/**
 * Display gain on every dot, applied in the final pass's composite (post/final.ts starDots()) before the shoulder, toe and sRGB: the owner's phone
 * walkthrough (2026-10-31, item 1) found the stars too dim on a phone screen that is not bright, and a later pass (2026-11-01) still barely saw them at Home:
 * x3 (about 1.2 magnitudes; x1.6 before) on the dot's linear
 * display y: a faint star is 3 times brighter, a bright one runs into the shoulder and saturates at white instead of clipping. The footprint (sigma
 * DOT_SIGMA_PX) is unchanged, so the width gate (scripts/star-fwhm.mjs, 2.0 px, #383) is unchanged. The scene sprites keep the previous brightness: `?stars=scene`, a ridge frame (archived view: its stars step by
 * the gain when it hands over), and classes without native dots (a native app shell, `?phonesharp=0`, `?motion=sharp`).
 */
export const STAR_DOT_GAIN = 3
/**
 * The dot's displayed value (0..1, before sRGB) for a layer value `y` (the dot amplitude x weight) and mask `sky`: the TS twin of final.ts starDots()
 * up to the toe (the orbit shoulder, uShoulder 0, the default curve). The magnitude cull (starLimit.ts) does not count the gain: it adds no new
 * stars, it brightens the drawn ones (the faintest culled ones would stay under one display byte).
 */
export function dotDisplay(y: number, sky = 1): number {
  let v = y * sky * STAR_DOT_GAIN
  if (v <= 0) return 0
  if (v > 0.8) { const d = v - 0.8; v = 0.8 + 0.2 * d / (0.2 + d) }
  return v * v * (3 - 2 * v) * 0.25 + v * 0.75
}

/** Canvas pixels per target pixel from the two heights (1 at full resolution, 1/scale on a motion grid). */
export function canvasPerTargetPx(targetH: number, canvasH: number): number {
  return targetH > 0 && canvasH > 0 ? canvasH / targetH : 1
}
/** StarPass's uIf0 (I/F of one TARGET pixel holding all of a 0 mag star) for a canvas pixel. */
export function dotIf0(if0Target: number, k: number): number { return if0Target * k * k }
/** The sky lift's gain (skyStarGain, set for the target's pixel) for a canvas pixel: gain x I/F is what the lift sees, and that must not change. */
export function dotSkyGain(gainTarget: number, k: number): number { return k > 0 ? gainTarget / (k * k) : gainTarget }

export interface StarDotExposure {
  /** The exposure's white in stored units (white x preExpose), as the final pass's uWhite. */
  white: number
  hdr: number
  /** esLevel / white (the final pass's uEsLevel). */
  esLevel: number
  longMax: number
  starLift: number
  /** The sky lift's gain for THIS pixel scale (dotSkyGain); 0 is off. */
  skyGain: number
}
export interface StarDotFlux {
  /** 10^(-0.4 V). */
  flux: number
  /** dotIf0 (I/F of one canvas pixel holding all of a 0 mag star, with the fade level folded in, as StarPass.uniforms.uIf0). */
  if0: number
  preExpose: number
  /** The boost (starBoost.ts): flux gain, cap in stored units, mix 0..1. */
  gain: number
  cap: number
  mix: number
}

/**
 * The TS twin of the vertex shader: the linear display y (before the shoulder, toe and sRGB) of a star's peak pixel, unmasked. The first half is
 * stars.ts' fragment at the Gaussian's centre (physical star, the boost's soft cap, their mix); the second is post/final.ts' sky pixel (alpha 0:
 * the long exposure under hdr, the star lift, the sky-star lift) with the mask 1. The mask is applied per pixel by the final pass.
 */
export function starDotPeak(f: StarDotFlux, x: StarDotExposure): number {
  const a = f.flux * f.if0 * f.preExpose * PEAK_W
  const phys = Math.min(a, DOT_PHYS_MAX)
  const cap = Math.max(f.cap, 1e-6)
  const soft = cap * (1 - Math.exp(-a * f.gain / cap))
  const peak = phys + (soft - phys) * f.mix
  const xs = peak / Math.max(x.white, 1e-12)
  const sE = xs / Math.max(x.esLevel, 1e-9)
  let yLong = x.longMax * (1 - Math.exp(-0.7 * sE))
  yLong += x.starLift * 0.6 * (1 - Math.exp(-Math.max(sE - 3, 0) / 12))
  let y = xs + (yLong - xs) * x.hdr
  y = Math.max(y, skyStarLift(xs, x.skyGain, 1, x.hdr))
  return y
}

/** The dot's weight at (dx, dy) canvas pixels from the star: 1 at the centre. */
export function dotWeight(dx: number, dy: number): number {
  return Math.exp(-(dx * dx + dy * dy) / (2 * DOT_SIGMA_PX * DOT_SIGMA_PX))
}

/**
 * The dot's amplitude (its central value; the pixels are amplitude x dotWeight): the per-star integrated display flux, kept. The exposure curve is
 * not linear, so curve(peak) x weight would lose the light a saturated star's wings carry when the curve runs per pixel (the scene path at full
 * resolution). The amplitude is chosen so the dot's summed value equals the sum of the curve over the sprite's pixels with the star on a pixel centre:
 * the integrated display flux of the full-resolution scene sprite, in a footprint that stays the Gaussian's. A faint star (the curve linear in its
 * range) gets exactly curve(peak); a star at the lift's cap gets more than the cap at its centre, which the final pass's shoulder then rolls off.
 * The TS twin of the vertex shader.
 */
export function starDotAmplitude(f: StarDotFlux, x: StarDotExposure): number {
  let sumY = 0, sumW = 0
  for (const p of dotSamples(0, 0)) { sumY += starDotPeak({ ...f, flux: f.flux * p.w }, x); sumW += p.w }
  return sumW > 0 ? sumY / sumW : 0
}

/** The final pass's per-pixel mask: `hide` is bodiesHide(SKY_MARGIN_PX) (0 on the Moon, the Earth, foreground), `alpha` the scene alpha. */
export function dotMask(hide: number, alpha: number): number {
  const t = Math.min(1, Math.max(0, alpha / DOT_ALPHA_HIDE))
  return Math.min(1, Math.max(0, hide)) * (1 - t * t * (3 - 2 * t))
}

/**
 * The dot as the canvas samples it: the pixels (indices `i, j`) whose centres fall inside the DOT_SPRITE_PX square centred on the star at
 * sub-pixel offset `ox, oy` (the point-sprite rasterisation rule), with their Gaussian weights at the pixel centre, peak 1. The same arithmetic
 * as the fragment shader (gl_PointCoord at pixel centres), for the FWHM and flux checks.
 */
export function dotSamples(ox = 0, oy = 0): { i: number; j: number; dx: number; dy: number; w: number }[] {
  const out: { i: number; j: number; dx: number; dy: number; w: number }[] = []
  const r = DOT_SPRITE_PX / 2
  for (let j = Math.ceil(oy - r); j < Math.ceil(oy + r); j++) for (let i = Math.ceil(ox - r); i < Math.ceil(ox + r); i++) {
    const dx = i - ox, dy = j - oy
    out.push({ i, j, dx, dy, w: dotWeight(dx, dy) })
  }
  return out
}

/**
 * The dot's width as scripts/star-fwhm.mjs measures a PNG: 2 sqrt(2 ln 2) sigma, sigma from the second moment of the pixel values about their
 * centroid (per axis: half the radial moment). Independent of where the star sits inside a pixel, which half-maximum crossings on 1 px samples
 * are not (a star centred between two pixels reads >= 2 px by construction). NaN without light. Callers subtract the background first.
 */
export function momentFwhm(px: ArrayLike<{ x: number; y: number; v: number }>): number {
  let sum = 0, sx = 0, sy = 0
  for (let i = 0; i < px.length; i++) { const p = px[i]; if (p.v > 0) { sum += p.v; sx += p.v * p.x; sy += p.v * p.y } }
  if (!(sum > 0)) return NaN
  const cx = sx / sum, cy = sy / sum
  let m2 = 0
  for (let i = 0; i < px.length; i++) { const p = px[i]; if (p.v > 0) m2 += p.v * ((p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy)) }
  return 2 * Math.sqrt(2 * Math.log(2)) * Math.sqrt(m2 / (2 * sum))
}

/**
 * Full width at half maximum of a 1-D profile sampled at integer pixels, with the half-maximum crossings interpolated linearly: the familiar
 * number, reported beside momentFwhm but not gated (see there). NaN when the profile has no peak.
 */
export function profileFwhm(p: ArrayLike<number>): number {
  let pk = 0, iPk = -1
  for (let i = 0; i < p.length; i++) if (p[i] > pk) { pk = p[i]; iPk = i }
  if (iPk < 0 || !(pk > 0)) return NaN
  const half = pk / 2
  let left = 0, right = p.length - 1
  for (let i = iPk; i > 0; i--) if (p[i - 1] < half) { left = (i - 1) + (half - p[i - 1]) / (p[i] - p[i - 1]); break }
  for (let i = iPk; i < p.length - 1; i++) if (p[i + 1] < half) { right = (i + 1) - (half - p[i + 1]) / (p[i] - p[i + 1]); break }
  return right - left
}

const VERTEX = /* glsl */ `
uniform mat4 uViewRotProj;   // world direction to clip, the camera's rotation only (StarPass's)
uniform float uIf0;          // I/F of one CANVAS pixel holding all of a 0 mag star (dotIf0)
uniform float uPreExpose;
uniform float uGain;         // the boost: flux gain, cap (stored units), mix
uniform float uCap;
uniform float uMix;
uniform float uWhite;        // the final pass's exposure: white (stored), hdr, esLevel / white, longMax, starLift
uniform float uHdr;
uniform float uEsLevel;
uniform float uLongMax;
uniform float uStarLift;
uniform float uSkyGain;      // the sky lift's gain at the canvas pixel scale (dotSkyGain); 0: off
in float aFlux;              // 10^(-0.4 V)
out float vAmp;              // the dot's amplitude: linear display y at its centre, before the shoulder (starDotAmplitude)
${SKY_GLSL}
// The display y of a sky pixel holding stored light a (stars.ts' fragment: the physical star, the boost's soft cap, their mix, neutral; then
// post/final.ts' sky pixel: the long exposure under hdr, the star lift, the sky-star lift with mask 1; the final pass masks per pixel).
float starY(float a) {
  float phys = min(a, ${DOT_PHYS_MAX.toExponential(1)});
  float soft = uCap * (1.0 - exp(-a * uGain / uCap));
  float peak = mix(phys, soft, uMix);
  float x = peak / uWhite;
  float sE = x / max(uEsLevel, 1e-9);
  float yLong = uLongMax * (1.0 - exp(-0.7 * sE));
  yLong += uStarLift * 0.6 * (1.0 - exp(-max(sE - 3.0, 0.0) / 12.0));
  float y = mix(x, yLong, uHdr);
  if (uSkyGain > 0.0) y = max(y, skyLift(x, 1.0, uHdr));
  return y;
}
void main() {
  float a = aFlux * uIf0 * uPreExpose * ${PEAK_W.toFixed(8)};
  // The amplitude keeps the integrated display flux of the full-resolution sprite (the curve per pixel, star on a pixel centre) in the Gaussian footprint.
  float sumY = 0.0, sumW = 0.0;
  for (int j = -${(DOT_SPRITE_PX - 1) / 2}; j <= ${(DOT_SPRITE_PX - 1) / 2}; j++) for (int i = -${(DOT_SPRITE_PX - 1) / 2}; i <= ${(DOT_SPRITE_PX - 1) / 2}; i++) {
    float w = exp(-float(i * i + j * j) / ${(2 * DOT_SIGMA_PX * DOT_SIGMA_PX).toFixed(4)});
    sumY += starY(a * w);
    sumW += w;
  }
  vAmp = sumY / sumW;
  vec4 c = uViewRotProj * vec4(position, 0.0);
  gl_Position = vec4(c.xy, 0.0, c.w);
  gl_PointSize = ${DOT_SPRITE_PX.toFixed(1)};
}
`

const FRAGMENT = /* glsl */ `
in float vAmp;
out vec4 fragColor;
void main() {
  // gl_PointCoord puts the sprite's centre on the star's exact sub-pixel position: the Gaussian sampled at each pixel centre, 1 at the centre.
  vec2 d = (gl_PointCoord - 0.5) * ${DOT_SPRITE_PX.toFixed(1)};
  float w = exp(-dot(d, d) / ${(2 * DOT_SIGMA_PX * DOT_SIGMA_PX).toFixed(4)});
  fragColor = vec4(vAmp * w, 0.0, 0.0, 0.0);
}
`

/** The canvas-sized layer: one R16F target, cleared and drawn each final frame from the StarPass's geometry and draw range. */
export class StarDots {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera()
  private target: THREE.WebGLRenderTarget | null = null
  private readonly clearColor = new THREE.Color()
  readonly uniforms: Record<string, THREE.IUniform>
  readonly stars: StarPass

  /** `exposure` is the final pass's uniform set: uWhite, uHdr, uEsLevel, uLongMax, uStarLift are shared by reference, so the layer sees the frame's values. */
  constructor(stars: StarPass, exposure: Record<string, THREE.IUniform>) {
    this.stars = stars
    const s = stars.uniforms
    this.uniforms = {
      uPreExpose: s.uPreExpose, uGain: s.uGain, uCap: s.uCap, uMix: s.uMix,
      uWhite: exposure.uWhite, uHdr: exposure.uHdr, uEsLevel: exposure.uEsLevel, uLongMax: exposure.uLongMax, uStarLift: exposure.uStarLift,
      uViewRotProj: { value: new THREE.Matrix4() },   // the StarPass's, re-projected for the canvas aspect (dotProjection)
      uIf0: { value: 0 },
      uSkyGain: { value: 0 },
    }
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    })
    const points = new THREE.Points(stars.geometry, material)
    points.frustumCulled = false
    this.scene.add(points)
  }

  /** The layer's texture after render(): linear display y per canvas pixel, unmasked; null before the first render. */
  get texture(): THREE.Texture | null { return this.target?.texture ?? null }

  /**
   * Draws the layer for this frame. `w, h` the real canvas in device px, `tw, th` the scene target (its aspect and the pixel-scale ratio),
   * `white` the exposure's white in I/F (the cull's unit), `hdr` the exposure fuse, `skyGainTarget` the final pass's uSkyGain (for the target pixel).
   * Leaves the renderer's target and clear colour as it found them.
   */
  render(renderer: THREE.WebGLRenderer, w: number, h: number, tw: number, th: number, white: number, hdr: number, skyGainTarget: number): void {
    const k = canvasPerTargetPx(th, h)
    dotProjection(this.stars.uniforms.uViewRotProj.value as THREE.Matrix4, tw, th, w, h, this.uniforms.uViewRotProj.value as THREE.Matrix4)
    if (!this.target || this.target.width !== w || this.target.height !== h) {
      this.target?.dispose()
      this.target = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType, format: THREE.RedFormat, depthBuffer: false, stencilBuffer: false,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
      })
      trackGpu('targets', `stardots-${w}x${h}`, w * h * 2, this.target)
    }
    const s = this.stars.uniforms
    const if0 = dotIf0(s.uIf0.value as number, k)
    const skyGain = dotSkyGain(skyGainTarget, k)
    this.uniforms.uIf0.value = if0
    this.uniforms.uSkyGain.value = skyGain
    // The cull at the canvas scale: the same stars at every grid step.
    this.stars.cullFor(if0, white, this.stars.fluxGain * skyCullGain(skyGain, hdr))
    const was = renderer.getRenderTarget()
    const clearColor = renderer.getClearColor(this.clearColor), clearAlpha = renderer.getClearAlpha()
    renderer.setRenderTarget(this.target)
    renderer.setClearColor(0x000000, 0)
    renderer.clear(true, false, false)
    renderer.render(this.scene, this.camera)
    renderer.setClearColor(clearColor, clearAlpha)
    renderer.setRenderTarget(was)
  }
}
