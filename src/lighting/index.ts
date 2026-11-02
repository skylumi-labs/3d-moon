import { EARTH_R_KM, MOON_R_KM, SUN_R_KM } from '../glsl/common'
import { OCCULT_TOP_KM } from './shadowMath'
import { SUN_TWO_DISC, UMBRA_D0_KM, UMBRA_DIST_EXP, UMBRA_LOG2, UMBRA_N, UMBRA_U_MAX } from './umbraTable'

export { earthShadowOnMoon, earthShadowOnMoonParts, moonShadowOnEarth } from './shadowMath'

/**
 * GLSL for how much of the Sun a point sees past the other body (README,
 * "Shadows between bodies"). shadowMath.ts is the CPU reference: same
 * formulas, same generated tables, tested in scripts/eclipse.test.mts.
 *
 * Inputs are in Moon radii, world frame. Outputs are linear RGB factors on
 * unobstructed sunlight; both are exactly vec3(1.0) when the body is nowhere
 * near the Sun, so ordinary dates render as before.
 *
 *   vec3 earthShadowOnMoon(vec3 p, vec3 sunPos, vec3 earthPos)
 *   vec3 earthShadowOnMoonParts(p, sunPos, earthPos, out vec3 refracted)
 *        returns the direct part; the reddened light bent through the
 *        Earth's air is in `refracted`. earthShadowOnMoon is their sum.
 *   vec3 moonShadowOnEarth(vec3 p, vec3 sunPos, vec3 moonPos)
 *
 * Modelled, not measured: the two-disc Sun, the standard atmosphere and the
 * one tuned cloud screen behind the table (src/earth/atmosphere.ts).
 * Needs GLSL_COMMON (PI).
 */
const f = (v: number): string => {
  const s = v.toPrecision(8)
  return /[.e]/.test(s) ? s : `${s}.0`
}
const v3 = (a: ArrayLike<number>): string => `vec3(${f(a[0])}, ${f(a[1])}, ${f(a[2])})`
const arr = (rows: ReadonlyArray<ArrayLike<number>>): string => rows.map(v3).join(',\n  ')

export const ECLIPSE_GLSL = /* glsl */ `
const float ECL_MOON_R_KM = ${f(MOON_R_KM)};
const float ECL_EARTH_R_KM = ${f(EARTH_R_KM)};
const float ECL_TOP_KM = ${f(OCCULT_TOP_KM)};
const float ECL_SUN_R_KM = ${f(SUN_R_KM)};
const float ECL_D0_KM = ${f(UMBRA_D0_KM)};
const float ECL_U_MAX = ${f(UMBRA_U_MAX)};
const int ECL_N = ${UMBRA_N};
const float ECL_K = ${f(SUN_TWO_DISC.k)};
const vec3 ECL_A = ${v3(SUN_TWO_DISC.a)};
const vec3 ECL_C = ${v3(SUN_TWO_DISC.c)};
const vec3 ECL_LOG2[${UMBRA_N}] = vec3[${UMBRA_N}](
  ${arr(UMBRA_LOG2)}
);
const vec3 ECL_EXP[${UMBRA_N}] = vec3[${UMBRA_N}](
  ${arr(UMBRA_DIST_EXP)}
);

// Angle between two vectors, well conditioned when it is small.
float eclAngle(vec3 a, vec3 b) { return atan(length(cross(a, b)), dot(a, b)); }

// Overlap area of discs of radii r1, r2 with centres d apart (planar).
float eclOverlap(float r1, float r2, float d) {
  if (d >= r1 + r2) return 0.0;
  float rm = min(r1, r2);
  if (d <= abs(r1 - r2)) return PI * rm * rm;
  float a1 = acos(clamp((d * d + r1 * r1 - r2 * r2) / (2.0 * d * r1), -1.0, 1.0));
  float a2 = acos(clamp((d * d + r2 * r2 - r1 * r1) / (2.0 * d * r2), -1.0, 1.0));
  return r1 * r1 * (a1 - sin(a1) * cos(a1)) + r2 * r2 * (a2 - sin(a2) * cos(a2));
}

// Share of the limb-darkened Sun (two discs) that a disc of radius occR
// centred sep from the Sun's centre leaves uncovered, per channel.
vec3 eclSunUncovered(float theta, float occR, float sep) {
  float full1 = PI * theta * theta, full2 = PI * ECL_K * ECL_K * theta * theta;
  float open1 = max(0.0, full1 - eclOverlap(theta, occR, sep));
  float open2 = max(0.0, full2 - eclOverlap(ECL_K * theta, occR, sep));
  return (ECL_A * open1 + ECL_C * open2) / (ECL_A * full1 + ECL_C * full2);
}

vec3 earthShadowOnMoonParts(vec3 p, vec3 sunPos, vec3 earthPos, out vec3 refracted) {
  refracted = vec3(0.0);
  vec3 sv = sunPos - p, ev = earthPos - p;
  float dSun = length(sv) * ECL_MOON_R_KM, dE = length(ev) * ECL_MOON_R_KM;
  float theta = asin(ECL_SUN_R_KM / dSun);
  float rho0 = asin(ECL_EARTH_R_KM / dE);
  float rhoA = asin((ECL_EARTH_R_KM + ECL_TOP_KM) / dE);
  float sep = eclAngle(sv, ev);
  float u = sep / (rho0 - theta);
  if (sep >= rhoA + theta && u >= ECL_U_MAX) return vec3(1.0);
  if (u < ECL_U_MAX) {
    float x = max(u, 0.0) / ECL_U_MAX * float(ECL_N - 1);
    int i = min(int(floor(x)), ECL_N - 2);
    float t = x - float(i);
    vec3 l = mix(ECL_LOG2[i], ECL_LOG2[i + 1], t);
    vec3 k = mix(ECL_EXP[i], ECL_EXP[i + 1], t);
    refracted = exp2(l + k * log2(dE / ECL_D0_KM));
  }
  return eclSunUncovered(theta, rhoA, sep);
}

vec3 earthShadowOnMoon(vec3 p, vec3 sunPos, vec3 earthPos) {
  vec3 r;
  vec3 d = earthShadowOnMoonParts(p, sunPos, earthPos, r);
  return d + r;
}

vec3 moonShadowOnEarth(vec3 p, vec3 sunPos, vec3 moonPos) {
  vec3 sv = sunPos - p, mv = moonPos - p;
  float theta = asin(ECL_SUN_R_KM / (length(sv) * ECL_MOON_R_KM));
  float rhoM = asin(1.0 / length(mv));
  float sep = eclAngle(sv, mv);
  if (sep >= rhoM + theta) return vec3(1.0);
  return eclSunUncovered(theta, rhoM, sep);
}
`
