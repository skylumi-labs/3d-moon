import { GLSL_COMMON, GLSL_FLUSH16, EARTH_R_KM, MOON_R_KM } from '../glsl/common'
import { SUN_LIMB_U } from '../lighting/solar'
import { ATMOSPHERE_TOP_KM, AEROSOL, CLOUD_SCREEN, GRAZING_N, TRANSMITTANCE_H, TRANSMITTANCE_W } from './atmosphere'
import { BEND_SCALE, PROFILE_N, PROFILE_SCALE } from './atmosphereTextures'
import { MOON_SHADOW_GLSL } from './moonShadowChunk'

/**
 * The Earth as seen from the Moon: a day/night globe with its atmosphere,
 * drawn as two full-screen ray-cast draws like the Moon (EarthPass.ts).
 *
 * What is measured and what is modelled (the page says the same):
 *  - Surface colour: NASA Blue Marble (a month of 2004), sRGB-decoded into
 *    an albedo (scripts/build-earth-maps.mjs states the inversion).
 *  - Clouds: the Blue Marble cloud layer, ONE day in 2002, not today's
 *    weather. Full cover is given the albedo CLOUD_ALBEDO (a modelled value
 *    for an optically thick water cloud); the layer's brightness is a display
 *    stretch, so how much of the sky it covers is approximate.
 *  - Air: ONE modelled state, atmosphere.ts (clear standard atmosphere, 300
 *    DU ozone, background aerosol), SINGLE scattering only. Multiple
 *    scattering would brighten and whiten the disc a little; it is left out.
 *  - Night lights: Black Marble 2016, whose stretch is unpublished; the
 *    conversion to I/F (LIGHTS_IF_MAX) is a model good to a factor of 2-3.
 *  - Sun glint on the sea: Cox-Munk slope statistics for one assumed wind.
 */

/** Albedo of full cloud cover: a modelled thick-deck value (optical depth of order 20-40). */
export const CLOUD_ALBEDO = 0.72

/**
 * I/F of the brightest 3 km night-light pixel, LIGHTS_REF_NW = 100 nW cm-2
 * sr-1 (an assumed ceiling for a 3 km VIIRS pixel) over the radiance of a
 * white Lambert surface facing the Sun in the same band: the DNB's
 * 505-890 nm carries about 0.46 of the solar constant, 626 W m-2, so
 * 626 / pi = 1.99e7 nW cm-2 sr-1. MODELLED, not measured; see the script.
 */
export const LIGHTS_REF_NW = 100
export const LIGHTS_IF_MAX = LIGHTS_REF_NW / 1.99e7

/** Cox-Munk mean-square slope for an assumed 7 m/s wind: 0.003 + 0.00512 w. */
const GLINT_SIGMA2 = 0.003 + 0.00512 * 7

const f = (v: number): string => {
  const s = v.toPrecision(9)
  return /[.e]/.test(s) ? s : `${s}.0`
}

const COMMON_EARTH = /* glsl */ `
const float R_E = ${f(EARTH_R_KM)};
const float R_M = ${f(MOON_R_KM)};
const float TOP = ${f(ATMOSPHERE_TOP_KM)};
const float TOP_R = ${f(EARTH_R_KM + ATMOSPHERE_TOP_KM)};
const vec3 LIMB_U = vec3(${SUN_LIMB_U.map(f).join(', ')});

uniform float uTanPerPx;
uniform vec3 uEarthRel;      // camera to the Earth's centre, Moon radii (CPU double precision)
`

// Coverage of a pixel by the disc (m < R_E) and by the atmosphere shell, from
// the pixel's miss distance mc (km) and half-width p (km): one dimension,
// exact for a pixel far from the disc's centre, which is where it matters.
const GEOMETRY = /* glsl */ `
struct Geo {
  vec3 d;      // camera ray, unit
  vec3 n;      // unit vector from the Earth's centre to the ray's closest point
  float mc;    // miss distance of the pixel centre ray, km
  float p;     // half a pixel at the Earth, km
  float D;     // camera to Earth centre, km
  float covD;  // share of the pixel inside the disc
  float covS;  // share of the pixel inside the atmosphere shell
};
bool earthGeo(vec2 fragCoord, out Geo g) {
  g.d = cameraRay(fragCoord);
  vec3 cE = uEarthRel * R_M;
  g.D = length(cE);
  float tca = dot(cE, g.d);
  g.mc = length(cross(cE, g.d));
  g.p = max(0.5 * uTanPerPx * g.D, 0.5);
  g.covD = clamp((R_E - g.mc) / (2.0 * g.p) + 0.5, 0.0, 1.0);
  float lo = max(g.mc - g.p, R_E), hi = min(g.mc + g.p, TOP_R);
  g.covS = max(hi - lo, 0.0) / (2.0 * g.p);
  g.n = normalize(tca * g.d - cE);
  return tca > 0.0;
}
`

export const EARTH_COVER_FRAGMENT = /* glsl */ `
${GLSL_COMMON}
${COMMON_EARTH}
${GEOMETRY}
out vec4 fragColor;
void main() {
  Geo g;
  if (!earthGeo(gl_FragCoord.xy, g) || g.covD <= 0.0) discard;
  fragColor = vec4(g.covD);
}
`

export const EARTH_SHADE_FRAGMENT = /* glsl */ `
${GLSL_COMMON}
${GLSL_FLUSH16}
${COMMON_EARTH}
${GEOMETRY}
${MOON_SHADOW_GLSL}

uniform vec3 uSunE;          // unit vector, Earth to Sun
uniform vec3 uSunPos;        // Moon to Sun, Moon radii
uniform vec3 uEarthPos;      // Moon to Earth, Moon radii
uniform float uSunTheta;     // the Sun's angular radius at the Moon, rad
uniform vec3 uSunPerp;       // the Sun's offset from the Earth's centre line, seen from the camera, rad
uniform float uRingOn;
uniform float uShadowOn;
uniform mat3 uWorldToEarth;
uniform sampler2D uAlbedo, uClouds, uLights, uWater;
uniform sampler2D uTrans, uProf, uGraz;
uniform float uLod0;         // log2 of (pixel arc on the globe, rad) / (map texel, rad), face-on

const float CLOUD_ALBEDO = ${f(CLOUD_ALBEDO)};
const float LIGHTS_IF_MAX = ${LIGHTS_IF_MAX.toExponential(6)};
const float GLINT_SIGMA2 = ${f(GLINT_SIGMA2)};
const float CLEAR_KM = ${f(CLOUD_SCREEN.clearKm)};
const float PER_COVER_KM = ${f(CLOUD_SCREEN.perCoverKm)};
const float SCREEN_W_KM = ${f(CLOUD_SCREEN.widthKm)};
const float MIE_G = ${f(AEROSOL.g)};
const float PROFILE_N = ${f(PROFILE_N)};
const float PROFILE_SCALE = ${f(PROFILE_SCALE)};
const float GRAZING_N = ${f(GRAZING_N)};
const float BEND_SCALE = ${f(BEND_SCALE)};
const float TRANS_W = ${f(TRANSMITTANCE_W)};
const float TRANS_H = ${f(TRANSMITTANCE_H)};

vec3 srgbDecode(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }

// Optical depth from radius r along mu (cosine from the vertical) to the top
// of the air: the inverse of buildTransmittanceLut's mapping.
vec3 tauToTop(float r, float mu) {
  r = clamp(r, R_E, TOP_R);
  float H = sqrt(TOP_R * TOP_R - R_E * R_E);
  float rho = sqrt(max(r * r - R_E * R_E, 0.0));
  float dMin = TOP_R - r, dMax = rho + H;
  float d = -r * mu + sqrt(max(r * r * mu * mu - r * r + TOP_R * TOP_R, 0.0));
  float xmu = clamp((d - dMin) / max(dMax - dMin, 1e-3), 0.0, 1.0);
  float xr = clamp(rho / H, 0.0, 1.0);
  vec2 uv = vec2(xmu * (1.0 - 1.0 / TRANS_W) + 0.5 / TRANS_W, xr * (1.0 - 1.0 / TRANS_H) + 0.5 / TRANS_H);
  return texture(uTrans, uv).rgb;
}

// Sunlight reaching pos (km from the Earth's centre): 0 in the Earth's shadow.
vec3 sunTrans(vec3 pos) {
  float r = length(pos);
  float mu = dot(pos, uSunE) / r;
  if (mu < 0.0 && r * sqrt(1.0 - mu * mu) < R_E) return vec3(0.0);
  return exp(-tauToTop(r, mu));
}

float profU(float h) { return sqrt(clamp(h, 0.0, TOP) / TOP) * ((PROFILE_N - 1.0) / PROFILE_N) + 0.5 / PROFILE_N; }
float grazU(float h) { return sqrt(clamp(h, 0.0, TOP) / TOP) * ((GRAZING_N - 1.0) / GRAZING_N) + 0.5 / GRAZING_N; }

vec2 lonLatUv(vec3 pWorld) {
  vec3 b = uWorldToEarth * pWorld;
  return vec2(atan(b.y, b.x) / (2.0 * PI) + 0.5, asin(clamp(b.z, -1.0, 1.0)) / PI + 0.5);
}

float cloudAt(vec2 uv) { return texture(uClouds, uv).r; }

float phaseHG(float c, float g) {
  float k = 1.0 + g * g - 2.0 * g * c;
  return (1.0 - g * g) / (k * sqrt(k));
}

// Single-scattered light (I/F) along a ray whose closest approach to the
// Earth's centre is m km, in the direction n, heading d. Straight rays: the
// bending is ~1 deg at most, and matters only for the refracted ring below.
// s runs along the ray from the tangent point; s < 0 is toward the camera.
// Returns the scattered radiance; tauView is the optical depth of the whole
// path (for the ground's radiance or the alpha of the glow).
vec3 march(float m, vec3 n, vec3 d, float sIn, float sT, float sOut, out vec3 tauView) {
  vec3 L = vec3(0.0);
  vec3 tau = vec3(0.0);
  float cs = dot(uSunE, d);
  float pR = 0.75 * (1.0 + cs * cs);
  float pM = phaseHG(cs, MIE_G);
  const int N = 16;
  for (int half_ = 0; half_ < 2; half_++) {
    float a = half_ == 0 ? sIn : sT;
    float b = half_ == 0 ? sT : sOut;
    if (b <= a) continue;
    float len = b - a;
    for (int k = 0; k < N; k++) {
      // Steps shrink toward the tangent point (or the ground): the air is thin at the ends.
      float t0 = float(k) / float(N), t1 = float(k + 1) / float(N);
      float s0, s1;
      if (half_ == 0) { s0 = sT - len * (1.0 - t0) * (1.0 - t0); s1 = sT - len * (1.0 - t1) * (1.0 - t1); }
      else { s0 = sT + len * t0 * t0; s1 = sT + len * t1 * t1; }
      float ds = s1 - s0;
      vec3 pos = m * n + 0.5 * (s0 + s1) * d;
      float h = length(pos) - R_E;
      float u = profU(h);
      vec3 ray = texture(uProf, vec2(u, 1.0 / 6.0)).rgb * (1.0 / PROFILE_SCALE);
      vec3 mie = texture(uProf, vec2(u, 3.0 / 6.0)).rgb * (1.0 / PROFILE_SCALE);
      vec3 abs_ = texture(uProf, vec2(u, 5.0 / 6.0)).rgb * (1.0 / PROFILE_SCALE);
      vec3 dt = (ray + mie + abs_) * ds;
      vec3 sun = sunTrans(pos);
      if (uShadowOn > 0.5) sun *= moonShadowOnEarth(uEarthPos + pos / R_M, uSunPos, vec3(0.0));
      // I/F = (1/4) beta p T ds: a white Lambert surface facing the Sun reads 1.
      L += 0.25 * (ray * pR + mie * pM) * sun * exp(-tau - 0.5 * dt) * ds;
      tau += dt;
    }
  }
  tauView = tau;
  return L;
}

// The Sun's limb-darkened surface brightness in I/F (mean over the disc = 1 / theta^2).
vec3 sunRadiance(float r) {
  float mu = sqrt(max(0.0, 1.0 - r * r));
  return (1.0 - LIMB_U * (1.0 - mu)) / (1.0 - LIMB_U / 3.0) / (uSunTheta * uSunTheta);
}

float rhoOf(float h, float D) { return asin(min((R_E + h) / D, 1.0)); }
float bendOf(float h) { return texture(uGraz, vec2(grazU(h), 0.5)).a / BEND_SCALE; }
// Tangent altitude at which the refracted line of sight reaches source angle f
// (rad from the Earth's centre line; f increases with height).
float solveH(float f, float D) {
  float lo = 0.0, hi = TOP;
  for (int i = 0; i < 22; i++) {
    float mid = 0.5 * (lo + hi);
    if (rhoOf(mid, D) - bendOf(mid) < f) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// The Sun seen through the Earth's air with the Earth in front of it: a line
// of sight grazing at height h arrives bent by alpha(h), so the Sun is seen
// at the height where rho(h) - alpha(h) equals its angular distance from
// the Earth's centre line. Surface brightness is kept by refraction; the
// air dims it by the grazing transmittance, and clouds block the low rays.
// Returns the pixel-averaged radiance (a ring far thinner than a pixel
// contributes its width's share).
vec3 refractedRing(Geo g) {
  vec3 dPerp = g.d - dot(g.d, normalize(uEarthRel)) * normalize(uEarthRel);
  float lp = length(dPerp);
  if (lp < 1e-9) return vec3(0.0);
  vec3 rHat = dPerp / lp;
  float sr = dot(uSunPerp, rHat);
  float st = length(uSunPerp - sr * rHat);
  float th = uSunTheta;
  if (st >= th) return vec3(0.0);
  float w = sqrt(th * th - st * st);
  float h1 = solveH(sr - w, g.D), h2 = solveH(sr + w, g.D);
  if (rhoOf(TOP, g.D) - bendOf(TOP) < sr - w) return vec3(0.0);
  float a = max(R_E + h1, g.mc - g.p), b = min(R_E + h2, g.mc + g.p);
  if (b <= a) return vec3(0.0);
  float hm = 0.5 * (a + b) - R_E;
  vec3 tau = texture(uGraz, vec2(grazU(hm), 0.5)).rgb;
  vec2 uv = lonLatUv(g.n);
  float c = cloudAt(uv);
  float open = 1.0 / (1.0 + exp(-(hm - (CLEAR_KM + PER_COVER_KM * c)) / SCREEN_W_KM));
  // Mean surface brightness along the chord (Simpson, ends at the Sun's edge).
  vec3 Lm = (sunRadiance(1.0) + 4.0 * sunRadiance(min(1.0, st / th)) + sunRadiance(1.0)) / 6.0;
  return Lm * exp(-tau) * open * (b - a) / (2.0 * g.p);
}

out vec4 fragColor;

void main() {
  Geo g;
  if (!earthGeo(gl_FragCoord.xy, g)) discard;
  if (g.covD <= 0.0 && g.covS <= 0.0) discard;
  vec3 col = vec3(0.0);
  float key = 0.0;
  vec3 tv;

  if (g.covD > 0.0) {
    // The globe. A pixel straddling the limb takes the ground just inside it.
    float m = min(g.mc, R_E - 0.3);
    float sHit = -sqrt(R_E * R_E - m * m);
    float sIn = -sqrt(max(TOP_R * TOP_R - m * m, 0.0));
    vec3 Lsc = march(m, g.n, g.d, sIn, sHit, sHit, tv);
    vec3 pos = m * g.n + sHit * g.d;
    vec3 ph = pos / R_E;
    float mu0 = dot(ph, uSunE);
    float muV = max(dot(ph, -g.d), 0.0);
    vec2 uv = lonLatUv(ph);
    // Mip level from the pixel's footprint on the ground (foreshortened).
    float lod = max(0.0, uLod0 - log2(max(muV, 0.3)));
    vec3 surf = srgbDecode(textureLod(uAlbedo, uv, lod).rgb);
    float c = textureLod(uClouds, uv, lod).r;
    float water = textureLod(uWater, uv, lod).r;
    vec3 A = mix(surf, vec3(CLOUD_ALBEDO), c);
    vec3 tSun = sunTrans(pos);
    if (uShadowOn > 0.5) tSun *= moonShadowOnEarth(uEarthPos + pos / R_M, uSunPos, vec3(0.0));
    vec3 tView = exp(-tv);
    // Lambert ground, and the sun glint on open water (Cox-Munk).
    vec3 ground = A * max(mu0, 0.0) * tSun;
    vec3 hv = normalize(uSunE - g.d);
    float cb = clamp(dot(ph, hv), 0.0, 1.0);
    float tan2 = (1.0 - cb * cb) / max(cb * cb, 1e-4);
    float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(hv, uSunE), 0.0, 1.0), 5.0);
    float glint = 3.14159265 * fres * exp(-tan2 / GLINT_SIGMA2) / (3.14159265 * GLINT_SIGMA2)
      / (4.0 * max(muV, 0.05) * max(cb * cb * cb * cb, 1e-3)) * step(0.0, mu0);
    ground += vec3(glint) * water * (1.0 - c) * tSun;
    // Night lights show through thin cloud only, on the dark side.
    vec3 lights = vec3(srgbDecode(vec3(textureLod(uLights, uv, lod).r)).r) * LIGHTS_IF_MAX * (1.0 - 0.8 * c)
      * smoothstep(0.03, -0.06, mu0);
    vec3 Ld = (ground + lights) * tView + Lsc;
    col += Ld * g.covD;
    // The day side is sunlit ground for the exposure (README): key 1.
    key = g.covD * smoothstep(-0.03, 0.12, mu0);
  }

  if (g.covS > 0.0) {
    // The air above the limb: a shell 60 km thick, thinner than a pixel from
    // the Moon, so it adds its share of the pixel (covS) and hides nothing.
    float m = clamp(g.mc, R_E + 0.5, TOP_R - 0.5);
    float sOut = sqrt(TOP_R * TOP_R - m * m);
    vec3 Lg = march(m, g.n, g.d, -sOut, 0.0, sOut, tv);
    col += Lg * g.covS;
    if (uRingOn > 0.5) col += refractedRing(g);
  }

  // Stored pre-exposed and capped below half-float's maximum (README).
  col = min(col * uPreExpose, vec3(6.0e4));
  fragColor = vec4(flush16(col), key);
}
`
