import { STAR_PEAK, SUN_V } from '../moon/photometry'

/**
 * The sky-star lift: stars stay visible beside a sunlit Moon (owner 2026-10, items 4/17/28), as a display-space path in the final pass.
 *
 * Why it is needed: beside a sunlit disc the exposure is keyed on the highlands (white ~0.19 I/F, hdr 0), so a sky pixel maps y = Y / white and even
 * a boosted fifth-magnitude star peaks near 2e-4 of white, black after the sRGB curve. The night-side long exposure (hdr -> 1) already shows stars,
 * so this lift fades out as hdr rises (no double lift).
 *
 * The lift is `y = max(y, mask * cap * (1 - exp(-gain * xs / cap)))`, xs = scene luminance / white, in the pass's linear y before the toe and sRGB.
 * `mask` is 0 on the Moon (widened SKY_MARGIN_PX outside the analytic limb), the Earth's disc and anything with scene alpha (sunlit ground), so a
 * star is never drawn over a body and the limb has no halo: the lift only exists where a star's own flux does. The gain is set on the CPU so a V5
 * star peaks near SKY_V5_PEAK however the boost slider and lens are set; brighter stars saturate softly at SKY_CAP (modest, not a night-club sky).
 */
/** Linear y (before the pass's toe and sRGB) where a lifted star levels off: about 0.57 as displayed. */
export const SKY_CAP = 0.3
/** Linear y a V5 star peaks at on the 30 degree lens: a clear star beside a sunlit Moon. A look setting, not a physical brightness. */
export const SKY_V5_PEAK = 0.05
/** The 30 degree home lens; a wider lens dims the field (stars crowd and read as fake on a wide low-orbit view), floor SKY_WIDE_FLOOR. */
export const SKY_REF_TAN_HALF = 0.268
export const SKY_WIDE_FLOOR = 0.35
/** Pixels outside the Moon's analytic limb and the Earth's disc where the lift is still 0. */
export const SKY_MARGIN_PX = 2
/** The lift's gain stays inside this range: 0 is "off" in the shader, and a runaway gain would only amplify noise. */
export const SKY_GAIN_MAX = 1e6

/**
 * The shader's gain (0: off). `tanPerPx` is the target's pixel scale (StarPass's uIf0 at level 1 follows from it), `flux` the flux gain the scene
 * stars already carry (boostGain), `white` the exposure's white in I/F, `tanHalf` the lens.
 */
export function skyStarGain(tanPerPx: number, flux: number, white: number, tanHalf: number): number {
  const if0Unit = Math.PI * Math.pow(10, -0.4 * (0 - SUN_V)) / (tanPerPx * tanPerPx)
  if (!(if0Unit > 0) || !(white > 0) || !(flux > 0) || !(tanHalf > 0)) return 0
  const xs5 = if0Unit * Math.pow(10, -2) * STAR_PEAK * flux / white   // a V5 star's peak in white units, boost cap ignored (it is far below it)
  const lens = Math.min(1, Math.max(SKY_WIDE_FLOOR, SKY_REF_TAN_HALF / tanHalf))
  const g = SKY_V5_PEAK * lens / xs5
  return Number.isFinite(g) ? Math.min(SKY_GAIN_MAX, Math.max(0, g)) : 0
}

/** The lift in linear y for a pixel at `xs` white units: the TS twin of the shader's. `mask` 0..1, `hdr` the exposure fuse (0 beside a sunlit Moon). */
export function skyStarLift(xs: number, gain: number, mask: number, hdr: number): number {
  if (!(gain > 0) || !(xs > 0)) return 0
  return Math.max(0, 1 - hdr) * Math.min(1, Math.max(0, mask)) * SKY_CAP * (1 - Math.exp(-gain * xs / SKY_CAP))
}

/** The gain the magnitude cull should assume: the lift makes fainter stars visible, in proportion to how much of it applies. */
export function skyCullGain(gain: number, hdr: number): number {
  return Math.max(1, gain * Math.max(0, 1 - hdr))
}

/** GLSL for the final pass (uniforms uSkyGain, and `skyMask()` defined by the pass). */
export const SKY_GLSL = /* glsl */ `
const float SKY_CAP = ${SKY_CAP.toFixed(4)};
float skyLift(float xs, float mask, float hdr) {
  return max(0.0, 1.0 - hdr) * mask * SKY_CAP * (1.0 - exp(-uSkyGain * xs / SKY_CAP));
}
`
