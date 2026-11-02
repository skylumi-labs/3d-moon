/**
 * Earthlight on ground the Earth does not stand over (poles, deep night): the maths shared by the Moon shader (GLSL strings below), the
 * exposure search (src/post/exposure.ts) and the tests (scripts/earthlight.test.mts).
 *
 * 1. The Earth is a disc (about 1.9 deg across at the Moon), not a point. A surface whose horizon cuts that disc is still lit by the part above
 *    it, so earthlight fades out over the Earth's own width instead of cutting off at the horizon (`earthDiscMu`, exact for a flat disc to first order).
 *    At the poles the Earth sits within a few degrees of the horizon all month, so this is the only direct earthlight the ground there gets.
 * 2. Beyond that, shadowed and night ground receives light scattered from the ground around it. The fraction is not measured; it is an ESTIMATE
 *    (`AMBIENT_EARTHSHINE_SHARE`): the earthlit terrain around a point reflects a few percent of the earthshine into it. It scales with the computed
 *    earthshine (src/ephemeris.ts: Earth albedo x phase law x solid angle), so it vanishes when the Earth is new and is strongest when it is full.
 *    It is never used as a floor: with no earthshine there is no ambient, and the HUD says so ("modelled").
 */

/** The Earth's radius, km (the shader's own occluder radius). */
export const EARTH_RADIUS_KM = 6371

/** Estimate, not data: the share of the normal-incidence earthshine reaching ground that has no direct view of the Earth, from the terrain around it. */
export const AMBIENT_EARTHSHINE_SHARE = 0.04

/** Angular radius (rad) of the Earth seen from the Moon, given the Moon-Earth distance in Moon radii and the Moon's radius in km. */
export function earthAngularRadius(earthDistMoonRadii: number, moonRadiusKm: number): number {
  return Math.asin(Math.min(1, EARTH_RADIUS_KM / (earthDistMoonRadii * moonRadiusKm)))
}

/**
 * Mean cosine of incidence over the Earth's disc, max(n . w, 0) averaged over directions w in the disc, for a surface normal whose cosine to the
 * disc's centre is s and a disc of angular radius r (rad). Linearises n . w across the disc: n . w = s + r sqrt(1 - s^2) u, u in the unit disc
 * (density 2 sqrt(1 - u^2) / pi). Equals s above the disc (s >= r_eff), 0 below it, and a smooth ramp over the Earth's width between.
 */
export function earthDiscMu(s: number, r: number): number {
  const re = r * Math.sqrt(Math.max(0, 1 - s * s))
  if (re < 1e-9) return Math.max(s, 0)
  const x = s / re
  if (x >= 1) return s
  if (x <= -1) return 0
  const root = Math.sqrt(1 - x * x)
  const g = (2 / Math.PI) * (x * 0.5 * (Math.PI / 2 + x * root + Math.asin(x)) + (1 - x * x) * root / 3)
  return re * g
}

/** The GLSL twin of earthDiscMu (same maths; keep the two in step, scripts/earthlight.test.mts compares their text and values). */
export const EARTHLIGHT_GLSL = /* glsl */ `
// Mean cosine of incidence over the Earth's disc (src/moon/earthlight.ts earthDiscMu).
float earthDiscMu(float s, float r) {
  float re = r * sqrt(max(1.0 - s * s, 0.0));
  if (re < 1e-9) return max(s, 0.0);
  float x = s / re;
  if (x >= 1.0) return s;
  if (x <= -1.0) return 0.0;
  float root = sqrt(1.0 - x * x);
  float g = (2.0 / PI) * (x * 0.5 * (PI / 2.0 + x * root + asin(x)) + (1.0 - x * x) * root / 3.0);
  return re * g;
}
`
