/**
 * The Moon's reflectance, as moon-v1 fitted it, for the CPU side (the
 * exposure search must see the ground exactly as the shader lights it).
 * The GLSL twins are in moonShader.ts; keep both in step.
 */

const DEG = Math.PI / 180

/** McEwen lunar-Lambert L(alpha), alpha in degrees. */
export function lunarL(a: number): number {
  return Math.max(0, 1 - 0.019 * a + 2.42e-4 * a * a - 1.46e-6 * a * a * a)
}

/**
 * Phase function fitted so the disc-integrated brightness follows
 * astronomy-engine's MoonMagnitude within ~15% from full to a 150 deg
 * crescent. 1 at zero phase.
 */
export function phaseA(a: number): number {
  return Math.exp(-0.0025 * a) * (1 + 0.9 * Math.exp(-a / 20)) / 1.9
}

/**
 * The colour map's linear luminance mapped onto published normal albedos
 * (Mare Tranquillitatis ~0.07, highlands 0.15 to 0.22).
 */
export function normalAlbedo(mapLuminance: number): number {
  return 0.07 * Math.pow(Math.max(1e-4, mapLuminance) / 0.058, 0.6)
}

/** The Sun's V magnitude, for star fluxes in the scene's I/F units. */
export const SUN_V = -26.74

/** Share of a star's light in its brightest pixel (the Gaussian of the star pass, sigma 0.7 px). */
export const STAR_PEAK = 1 / (2 * Math.PI * 0.49)

/**
 * The dimmest white point: a 0.2-albedo highland lit at 10 deg, seen from
 * 170 deg of phase (the lunar-Lambert L term is 0 there). The short
 * exposure is never longer than that sliver needs, so a thinner one fades.
 */
export const WHITE_FLOOR = 0.2 * phaseA(170) * Math.sin(10 * DEG)

/**
 * The long exposure is never longer than the brightest earthshine needs: a
 * 0.16-albedo highland under a full Earth at the mean distance (geometric
 * albedo 0.3 times (6371 / 384,400)^2, 1.3e-5 of sunlight).
 */
export const ES_KEY_MAX = 0.16 * 0.3 * (6371 / 384400) ** 2
