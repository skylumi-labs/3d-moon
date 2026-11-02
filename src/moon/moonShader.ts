import { bakedShadowRead } from './baked/shader'
import { ECLIPSE_GLSL } from '../lighting'
import { GLSL_COMMON, GLSL_FLUSH16, MOON_R_KM } from '../glsl/common'
import { C_PX, C_SIZE, C_TEXEL_KM, DEEPEST_LEVEL, H_PX, H_SIZE, H_TEXEL_KM } from './tiles/grid'
import { BLUR_PER_LACK, FOCUS_TAPS, MAX_BLUR_PX, MIN_LACK_PX, RELEASE_FLOOR, focusPullOn } from './tiles/focusPull'
import { ENV_FINE_N, FILTER_STEPS, ENV_LEVEL, ENV_SLACK_DEG, ENV_STEP_COARSE, ENV_STEP_FINE, ENV_UNBOUNDED, REFINE_PAD_BASE_DEG, REFINE_PAD_K } from './ringEnvelope'
import { COARSEST_LEVEL, ladder, levelRow } from './tiles/levels'
import { MARCH_DEEP_NEAR_N, MARCH_DEEP_NEAR_START_KM, MARCH_GEO_N, MARCH_GEO_START_KM, MARCH_LINEAR_N, MARCH_LINEAR_STEP_KM, MARCH_MAX_KM, MARCH_MIP, MARCH_N, MARCH_NEAR_N, MARCH_NEAR_START_KM } from './march'
import { AMBIENT_EARTHSHINE_SHARE, EARTHLIGHT_GLSL } from './earthlight'
import { HIGHLIGHT_WASH_GLSL, HL_FILL, HL_LIFT, HL_RIM, HL_RIM_DARK_PROP, HL_RIM_MAX_PX, HL_WASH_WHITE } from '../labels/highlightFit'
import { TC_PAGE_W, TC_ROW } from './tiles/tcDetail'
import { DETAIL_MID, DETAIL_SLOPE_END, DETAIL_SLOPE_START, DETAIL_PAGE_W, DETAIL_PER_OCTAVE, DETAIL_POLE_END, DETAIL_POLE_START, detailTexelKm } from './tiles/detail'
import { TILE_FEATHER_TEXELS } from './tiles/feather'
import { elevationRampGlsl } from '../topography/elevation'
import { SB_BIN_EDGES, SB_BINS, SB_CERT_EXTRA_DEG, SB_GRID, SB_OFF_DEG, SB_Q_DEG, sunBakeOn } from './sunHorizon'
import { BOUND_DEBUG_GLSL, SERVE_DEBUG_GLSL, VIS_DEBUG_GLSL, W_DEBUG_GLSL, countDebugOn, serveDebugOn } from './shadowServe'
import { ENV_LODS, ENV_LOD_MAX, ENV_MARGIN_DEG, ENV_OFF_DEG, ENV_Q_DEG, ENV_VIEW_CLEAR_DEG, GH_AA_MAX_DEG, GH_CERT_EXTRA_DEG, GH_SUBPX_DELTA_DEG, GH_SUBPX_TILE_DELTA_DEG, TENV_SUN_EXTRA_DEG, TENV_VIEW_EXTRA_DEG, TENV_DEFAULT, TENV_STOP_DEG, ENV_SECTORS, ENV_SECTOR_AZ, ENV_SECTOR_DEG, ENV_SECTOR_PAD_DEG, ENV_SECTOR_POINTS, ENV_FINE_GRID, ENV_FINE_LODS, envSectorGrid, tenvConfig, type TenvConfig } from './globalHorizon'
/** `gServe = e;` while the serving-mask view is requested (?shadowdebug=serve, dev builds), nothing otherwise: the shipped shader source is unchanged. */
const sg = (e: string): string => (serveDebugOn() ? `gServe = ${e}; ` : '')
/** `gVis = e;` in the same debug builds: 1 viewer-visibility march skipped by the envelope, 2 marched. */
/** `?ghsub=<deg>` (default 3, 0 = off): the sub-pixel tap reuse margin of the fixed policy, in degrees. */
const ghSubDelta = (): number => { try { const v = new URLSearchParams(location.search).get('ghsub'); const n = v === null || v === '' ? GH_SUBPX_DELTA_DEG : Number(v); return Number.isFinite(n) && n >= 0 && n <= 20 ? n : GH_SUBPX_DELTA_DEG } catch { return GH_SUBPX_DELTA_DEG } }
/** `?ghsubt=<deg>` (default GH_SUBPX_TILE_DELTA_DEG, 0 = off): the same reuse margin for pixels that carry tile ground (an estimate, see globalHorizon.ts). */
const ghSubDeltaTile = (): number => { try { const v = new URLSearchParams(location.search).get('ghsubt'); const n = v === null || v === '' ? GH_SUBPX_TILE_DELTA_DEG : Number(v); return Number.isFinite(n) && n >= 0 && n <= 20 ? n : GH_SUBPX_TILE_DELTA_DEG } catch { return GH_SUBPX_TILE_DELTA_DEG } }
/** `?tenvextra=<deg>` / `?tenvvextra=<deg>`: the extra clearance (deg) a tile pixel needs over the certificate for the Sun skip / the viewer skip (defaults TENV_SUN_EXTRA_DEG, TENV_VIEW_EXTRA_DEG): rig experiments with the sampled bound's reliability. */
const qNum = (name: string, def: number, max = 20): number => { try { const v = new URLSearchParams(location.search).get(name); const n = v === null || v === '' ? def : Number(v); return Number.isFinite(n) && n >= 0 && n <= max ? n : def } catch { return def } }
/** `?tapshare=0` turns the fixed policy's exact sub-pixel tap shortcuts off (A/B): the shadowed taps' early stop and the tight Sun-skip certificate. */
const tapShareOn = (): boolean => { try { return new URLSearchParams(location.search).get('tapshare') !== '0' } catch { return true } }
const tenvSunExtra = (): number => qNum('tenvextra', TENV_SUN_EXTRA_DEG)
/** `?tenvwmin=<w>` (default 0.999): a pixel whose tile share is below this never takes the tile envelope skip (it marches). Rig 2026-10-27 (dist22 phone, NVIDIA L4): in the blend ring (0.75 < share < 1, tile level 2) the sampled bound is exceeded by more than 12 deg at some pixels (32 of the 48 pixels over 8/255 at default 0); with 0.999 the picture differs from legacy by 50 px (2 over 8/255) instead of 110 (48) and the marched share does not change (the ring's skips were a few thousand pixels). */
/** `?shring=0`: the fixed policy's blend ring reads the tile term of its horizon from the Sun-keyed cache (default on; 0 = the live tile march there, as before). */
const shringOn = (): boolean => qNum('shring', 1, 1) !== 0
/** `?shadowdebug=ringdiff&dbg=26` (dev builds, rig only): per pixel, the cached minus the live tile horizon the blend ring reads (largest |difference| over the taps), the tile share and the level. Diagnostic; the shipped source is unchanged without it. */
const ringDiffOn = (): boolean => { try { return import.meta.env?.VITE_NATIVE_BUILD !== 'true' && new URLSearchParams(location.search).get('shadowdebug') === 'ringdiff' } catch { return false } }
/** `?shringe=<deg>` (default RING_ERR_DEG): the error allowance of the blend ring's cached tile horizon. The cache is the live march exactly at a texel centre (rig 2026-10-28: 99% of 656k ring pixels within 0.05 deg) but a bilinear read between centres differs from the march at the exact position by up to several degrees at rims; a pixel whose Sun margin is within the saturation distance plus w times this allowance marches live, anything farther is unchanged by it. */
const RING_ERR_DEG = 4
/** `?shringk=<k>` (default RING_SPREAD_K): the share of the four cache texels' spread added to the ring's error allowance. */
const RING_SPREAD_K = 3
const ringSpreadK = (): number => qNum('shringk', RING_SPREAD_K, 20)
/** A cached horizon below this is a bilinear mix with a texel outside the cache's Sun band (-90): no real skyline is below about -6 deg (a 5 km peak over a smooth Moon sees -4.3 deg). */
const RING_MIN_VALID_DEG = -12
const ringErrDeg = (): number => qNum('shringe', RING_ERR_DEG, 90)
/** `?shringw=1`: the ring's spread covers the 4x4 texels around the read, not the 2x2 it interpolates (a low texel next to the read is seen). */
const ringWideOn = (): boolean => qNum('shringw', 0, 1) !== 0
/**
 * `?shenv=0`: the blend ring reads the cache the old way (bilinear, with the 4 deg + 3 x spread allowance) instead of the per-texel footprint envelope (default on, level-2 layers of the whole-globe fixed variant).
 * The cache layer is then RG16F (r the centre horizon, g the packed bounds; src/moon/ringEnvelope.ts) and the build pass computes the bounds (the deeper tile sets add their near samples and a pad for the crest refinement).
 */
const shenvOn = (): boolean => qNum('shenv', 1, 1) !== 0
/** `?shenvedge=<texel>` (default 0.06): a ring pixel this close to its cell's edge also takes the neighbouring cells' bounds (0 = off, the nearest cell only). */
const ringEdge = (): number => qNum('shenvedge', 0.06, 0.5)
export function ringEnvelopeOn(_tileDeepest: number): boolean { return shringOn() && shenvOn() }
const tenvWMin = (): number => qNum('tenvwmin', 0.999, 1)
const tenvViewExtra = (): number => qNum('tenvvextra', TENV_VIEW_EXTRA_DEG)
const svis = (e: string): string => (serveDebugOn() ? `gVis = ${e}; ` : '')
/**
 * DIAGNOSTIC ONLY (never default, never shipped behaviour; honoured only with `?ablok=1`, like every `abl` switch): upper-bound arms for the fixed policy. Each replaces one live march
 * with a constant (-5 deg: a low horizon, lit) while the envelope and cache lookups, the sub-pixel taps and the branches stay, so the frame time says what that march costs. The picture is wrong.
 *   dtile0  the tile (64-sample) march of the Sun horizon     d4k0  the 4k-map (32-sample) march of the Sun horizon     dview0  the viewer-visibility march
 *   dring1  snap the tile share to 1 for the SHADOW march where it is above 0.75 (the ring is then served from the exact Sun-keyed cache); the colour/normal blend is unchanged
 */
const DIAG_TILE0 = ABL.has('dtile0')
const DIAG_4K0 = ABL.has('d4k0')
const DIAG_VIEW0 = ABL.has('dview0')
const DIAG_RING1 = ABL.has('dring1')
/** `?shadowdebug=count&dbg=25` (dev builds): per pixel, the number of tile / 4k marches the Sun (x, y) and the viewer (z, w) horizon reads RAN, summed over all taps (gMc, see shadowServe.ts COUNT_*). */
const mcInc = (idx: string): string => (countDebugOn() ? `gMc[${idx}] += 1.0; ` : '')
import { PSH_BASE_HALF_M, PSH_BASE_TEXEL_M, PSH_LM_SLACK } from './patch/shadowBase'

/**
 * The Moon pass: a full-screen ray-cast of the unit sphere, shaded as
 * moon-v1's fly mode shades it (public/demos/moon-v1.js, sceneSource with
 * uFly = 1 and no air). What is the same, from the prototype's own notes:
 *
 * - McEwen lunar-Lambert with the fitted phase function, per pixel phase.
 * - Crater shadows: the skyline marched toward the real Sun, 32 steps from
 *   1.5 to 300 km over the LOLA heights and their mips, softened over the
 *   Sun's 0.267 deg radius, four sub-pixel marches along the terminator. A
 *   second march toward the viewer hides ground behind a nearer rim.
 * - Earthshine from the Earth's real direction and phase, shaded like
 *   sunlight (lunar-Lambert at the Earth's phase angle), not shadowed.
 * - The limb: antialiased over one pixel; the Lommel-Seeliger term capped
 *   within LIMB_CAP_DEG of the view horizon so an edge-on limb does not glow.
 * - Albedo: the colour map's contrast mapped onto published normal albedos,
 *   filtered over each pixel's real footprint on the ground.
 *
 * What changed: the ray comes from the shared camera (cameraRay), the
 * vectors are in the world frame, the earthshine tint is the app's newer
 * vec3(0.90, 0.98, 1.14) (a pixel review found moon-v1's too blue), and
 * sunlight is multiplied by the Earth's shadow (src/eclipse/, ECLIPSE_GLSL).
 *
 * It is drawn as two passes into the scene target (README, "Passes"):
 * MOON_COVER_FRAGMENT first multiplies what is behind by (1 - cover), then
 * the shading adds radiance x cover and the exposure key x cover. Alpha is
 * the key, so it cannot also carry coverage in one blend.
 */

/**
 * A tuning constant, overridable from the URL (`?shadowfill=0.03`) so the look can be A/B'd without a build. A missing, non-numeric or out-of-range
 * value falls back to the default, so a bad link cannot break the shader.
 */
/** `?look=a` selects option A's dials as the defaults (each is still overridable by its own parameter); anything else is the original look. */
export function isLookA(search: string): boolean {
  return new URLSearchParams(search).get('look') === 'a'
}
/** The value of a dial for a query string: its own parameter if valid, else option A's value under `?look=a`, else the original look's. Pure, for tests. */
export function dialValue(search: string, name: string, original: number, optionA: number, lo: number, hi: number): number {
  const fallback = isLookA(search) ? optionA : original
  const raw = new URLSearchParams(search).get(name)
  if (raw === null || raw.trim() === '') return fallback
  const v = Number(raw)
  return Number.isFinite(v) && v >= lo && v <= hi ? v : fallback
}
function urlNumber(name: string, original: number, optionA: number, lo = -1, hi = 16): number {
  return typeof location === 'undefined' ? original : dialValue(location.search, name, original, optionA, lo, hi)
}

/** Share of the lit radiance that reaches shadowed ground as modelled fill light (MOON-UX-REDESIGN 5.2). Labelled in the notes (`SHADOW_FILL_NOTE`). */
export const SHADOW_FILL = urlNumber('shadowfill', 0.03, 0.04)
export const SHADOW_FILL_NOTE = 'Shadows are lightened by a modelled 3 % for legibility.'
/** Deep (SLDEM 59 m) ground: the horizon angle of about 1 m of unresolved relief over the 120 m smoothing kernel, degrees. The least a shadow edge there is softened by. */
/**
 * The crest refinement (marchAng) runs only where the winning sample is at least this far (km). Closer in, the winner is the ground's own slope
 * a texel or two away, which the shading normal already has: refining it sharpens the margin to the Sun by a degree or so, and on a slope near
 * grazing that flips single pixels to shadow (a scatter of black dots round every shadow at Apollo 17, Tycho and Copernicus).
 */
export const MARCH_REFINE_MIN_KM = 0.1
/** The terrain march's step budget and smallest-step divisor on a motion frame (rest: 56 and 48, or 128 and 256 over a fused patch). */
export const MOTION_TERRAIN_ITER = 24
export const DEEP_PENUMBRA_DEG = (Math.atan(1 / 120) * 180) / Math.PI
/** The investigative terminator-AA mode uses only the pixel's geometric Sun-elevation footprint. */
export const SHADOW_AA_PIXEL_SCALE = 0.75
/**
 * A motion frame draws on a coarser grid, so the same render-pixel edge width is 1/scale times wider on the screen. `?termaa=<f>` narrows the edge on motion frames
 * (uTermAA, set per frame by termAaFactor): f is the factor at scale 0.25 and it eases to 1 at scale 0.7 (the width compensation follows 1/scale). Default 1.0: unchanged.
 */
export function termAaFactor(f: number, scale: number, gestureOn: boolean): number {
  if (!(f > 0) || f >= 1 || !gestureOn || scale >= 0.7) return 1
  return Math.min(1, Math.max(f, 1 - (1 - f) * (0.7 - scale) / 0.45))
}
export const SHADOW_AA_MAX_DEG = 2
import { ABL, ABLATE } from '../abl'
import { shadowAblation } from '../quality/apply'
import { getQuality } from '../quality/settings'
// Ablations are diagnostic compile-time switches; visitor settings are runtime uniforms.
/** term-fix D: `?shlod=foot` (diagnostic) marches the live shadow with V1.1's pixel-footprint lod; the default is the tile's finest mip (shLodG), which the cache build also uses. The cache BUILD always uses shLodG. */
const SHLOD_FINE = typeof location === 'undefined' || new URLSearchParams(location.search).get('shlod') !== 'foot'
// Load-time shadow choice compiles the terminator sub-pixel pass in or out, as on main (Battery's stored 'fast' drops it); runtime modes stay uniforms.
const ABL_SHADOW = ABL.has('shadow0') || ABLATE.has('shadows') ? 1 : ABL.has('shadow1') ? 2 : shadowAblation(getQuality().shadows)
const ABL_VIEWHZ = ABL.has('noviewhz') || ABLATE.has('viewhz') ? 1 : 0
export type ShadowAAMode = 'legacy' | 'geometry' | 'margin'

function shadowAaModeFromLocation(): ShadowAAMode {
  if (typeof location === 'undefined') return 'margin'
  const value = new URLSearchParams(location.search).get('shadowaa')
  return value === 'legacy' || value === 'geometry' || value === 'margin' ? value : 'margin'
}

export function geometryShadowEdgeAa(dElevDx: number, dElevDy: number): number {
  if (!Number.isFinite(dElevDx) || !Number.isFinite(dElevDy)) return 0
  return Math.min(SHADOW_AA_MAX_DEG, SHADOW_AA_PIXEL_SCALE * (Math.abs(dElevDx) + Math.abs(dElevDy)))
}
/** CPU mirror for the bounded width used by the derivative-safe shadow-margin candidate. */
export function shadowMarginEdgeAa(dMarginDx: number, dMarginDy: number): number {
  if (!Number.isFinite(dMarginDx) || !Number.isFinite(dMarginDy)) return 0
  return Math.min(SHADOW_AA_MAX_DEG, SHADOW_AA_PIXEL_SCALE * (Math.abs(dMarginDx) + Math.abs(dMarginDy)))
}
/** The Lommel-Seeliger limb cap's band, degrees above the view horizon: wide enough that the cap has no visible step at full phase (was 8). */
export const LIMB_CAP_DEG = 15
/** The Moon pass's exposure key (alpha): 0 below the first edge, 1 above the second, in sin(Sun elevation); the final pass reads ground with a key under 1 on its LONG exposure. */
export const SUN_KEY_LO = urlNumber('sunkeylo', -0.03, -0.008)
export const SUN_KEY_HI = urlNumber('sunkeyhi', 0.12, 0.02)
/** The fill follows the key to this power (WP4b): the long exposure saturates at any light above the earthshine, so a fill that is merely small near the terminator draws a flat sheet ending in a straight line. */
export const FILL_RAMP_POWER = urlNumber('fillramp', 4, 1)
/**
 * The fill's hand-off to earthshine, in units of the pixel's own earthshine radiance. The long exposure lifts anything a few times above earthshine to a
 * flat grey, so a fill that is merely small near the terminator is drawn as a grey curtain that ends where the key reaches 1. The fill therefore counts
 * only once it is FILL_ES_LO times earthshine (nil below), full at FILL_ES_HI, and any pixel whose sunlit-plus-fill radiance is a few times
 * earthshine is read on the short exposure (key), so the exposure follows the pixel's radiance, not a band of sphere Sun elevation.
 */
/**
 * The terminator exposure uses the radiance key at every altitude by default.
 * The geometric key sent sunlit crests through the long earthshine exposure
 * below 300 km, clipping away their relief. Explicit `?look=alt` retains the
 * old altitude blend for comparisons; `?look=old` retains the geometric key.
 */
export type LookMode = 'alt' | 'old' | 'a'
export function lookMode(search: string): LookMode {
  const v = new URLSearchParams(search).get('look')
  return v === 'old' || v === 'alt' ? v : 'a'
}
const LOOK: LookMode = lookMode(typeof location === 'undefined' ? '' : location.search)
export const LOOK_ALT = true
export const ALT_LO_KM = LOOK === 'old' ? 1e9 : LOOK === 'a' ? 0 : urlNumber('altlo', 300, 0, 1e6)
export const ALT_HI_KM = LOOK === 'old' ? 2e9 : LOOK === 'a' ? 0.001 : urlNumber('althi', 480, 0, 1e6)
// Fixed modes must not emit smoothstep(0, 0, altitude), whose result is undefined.
const LOOK_W_GLSL = LOOK === 'a' ? 'float lookW = 1.0;\n  ' : LOOK === 'old' ? 'float lookW = 0.0;\n  '
  : `float lookW = smoothstep(${ALT_LO_KM.toFixed(1)}, ${ALT_HI_KM.toFixed(1)}, (length(uCamPos) - 1.0) * R_KM);\n  `
/** 0 (default) = the geometric key (sphere Sun elevation, SUN_KEY_LO..HI), the original look; 1 = the exposure key follows the pixel's radiance (RAD_KEY_LO..HI, in earthshines), option A. `?look=a` is `?radkey=1&radhi=4&sunkeylo=-0.008&sunkeyhi=0.02&fillramp=1&shadowfill=0.04`. */
export const RAD_KEY_WEIGHT = urlNumber('radkey', 0, 1, 0, 1)
/** Whether the radiance key (option A) is compiled in at all; at the default weight of 0 the shader text is the original one. */
export const RADIANCE_KEY = LOOK_ALT || RAD_KEY_WEIGHT > 0
/** `?shadowkey=legacy` keeps shadows on the radiance-only exposure key for A/B. */
/** `?hlwash=legacy` keeps the hover highlight's wash at a fixed share of white whatever the ground's light (the 2026-10-17 form) for A/B; src/labels/highlightFit.ts highlightWash. */
const HL_WASH_LEGACY = typeof location !== 'undefined' && new URLSearchParams(location.search).get('hlwash') === 'legacy'
/** The night floor follows the inverse fill key, complementary across the terminator ramp, and vanishes on the lit side. */
const NIGHT_FLOOR_EDGE = -0.03
const SHADOW_KEY_LEGACY = typeof location !== 'undefined' && new URLSearchParams(location.search).get('shadowkey') === 'legacy'
const FILL_DEST = RADIANCE_KEY ? 'vec3 fillT =' : 'sun +='
/** The radiance key's edges, in units of the pixel's earthshine (`?radlo`, `?radhi`). */
export const RAD_KEY_LO = urlNumber('radlo', 0.75, 0.75, 0, 1e5)
export const RAD_KEY_HI = urlNumber('radhi', 4, 4, 0, 1e5)
export const FILL_ES_LO = urlNumber('fillslo', 1, 1, 0, 1000)
export const FILL_ES_HI = urlNumber('fillshi', 5, 5, 0, 1000)
const SPHERE_KEY_GLSL = `smoothstep(${SUN_KEY_LO.toFixed(3)}, ${SUN_KEY_HI.toFixed(3)}, dot(p, uS))`
const RADIANCE_KEY_GLSL = SHADOW_KEY_LEGACY ? 'radKey' : `max(${SPHERE_KEY_GLSL}, radKey)`
const SUN_EXPOSURE_KEY_GLSL = LOOK_ALT
  ? `mix(smoothstep(-0.03, 0.12, dot(p, uS)), ${RADIANCE_KEY_GLSL}, lookW)`
  : RADIANCE_KEY
    ? `mix(${SPHERE_KEY_GLSL}, ${RADIANCE_KEY_GLSL}, ${RAD_KEY_WEIGHT.toFixed(2)})`
    : SPHERE_KEY_GLSL

/** Ray to sphere, shared by both Moon passes. Needs GLSL_COMMON. */
const MOON_GEOMETRY_GLSL = /* glsl */ `
uniform float uTanPerPx;     // tangent of one pixel's angle at the frame centre
uniform float uTileTanPerPx; // tangent of one canvas pixel (not the scaled target); every variant: the hover rim cap reads it
uniform float uMStride;      // the shadow march's stride on a motion frame (2; 3 on a phone class)
uniform float uMTerr;        // the terrain march's step cap on a motion frame (24; 12 on a phone class)
uniform float uMLite;        // 1: a motion frame also skips the shadow march's edge refine and deep-near loop (phone classes)
float gHzStopDeg = 200.0;    // phone motion frames: a skyline above this (deg) already means shadow, so the march stops there (200 = never)
uniform float uTermAA;       // terminator edge width factor on gesture frames (?termaa=), 1 otherwise
uniform float uHzK;          // ?horizon=: sub-pixel rays traced for a pixel the skyline can pass through (0: one ray, the old edge)
uniform float uHzLp;         // ?horizon=: the far low-pass factor of the march's level of detail (0: off)
uniform float uFlightHz;     // 1 on a scripted-flight motion frame under ?flighthz=1 / ?sharp=1: the terrain march keeps its rest budget and the skyline keeps its sub-pixel rays (uMotion's other effects stay)
uniform float uMotion;       // 1 on a frame drawn on the motion grid (a gesture): cheaper marches, the picture is soft anyway; 0 at rest (rest pixels are unchanged)

// Where a camera ray meets the unit sphere, or, past the limb, the nearest
// limb point (so a pixel straddling the limb still reads real ground). b is
// the ray's closest distance to the centre.
vec3 moonHit(vec3 r, out float b) {
  float tc = -dot(uCamPos, r);
  vec3 m = uCamPos + r * tc;
  b = length(m);
  if (b < 1.0) return normalize(m - r * sqrt(1.0 - b * b));
  return m / max(b, 1e-6);
}

// Share of the pixel inside the disc, ramped over one pixel at the limb.
float moonCover(vec3 r, float b) {
  float dc = length(uCamPos);
  float pxR = uTanPerPx * sqrt(max(dc * dc - 1.0, 1e-6));
  return dot(uCamPos, r) < 0.0 ? clamp((1.0 - b) / pxR + 0.5, 0.0, 1.0) : 0.0;
}
`

/** Pass 1: attenuate what lies behind the disc by (1 - cover). */
export const MOON_COVER_FRAGMENT = /* glsl */ `
${GLSL_COMMON}
${MOON_GEOMETRY_GLSL}
out vec4 fragColor;
void main() {
  vec3 r = cameraRay(gl_FragCoord.xy);
  float b;
  moonHit(r, b);
  float cover = moonCover(r, b);
  if (cover <= 0.0) discard;
  fragColor = vec4(0.0, 0.0, 0.0, cover);
}
`

/** The cover blend from a hit texture the cover pass already wrote (a shared-hit frame): the same (1 - cover) as the cover pass, without marching. */
export const MOON_COVER_BLIT_FRAGMENT = /* glsl */ `
precision highp float;
uniform highp sampler2D uHitTex;
out vec4 fragColor;
void main() {
  float cover = texelFetch(uHitTex, ivec2(gl_FragCoord.xy), 0).g;
  if (cover <= 0.0) discard;
  fragColor = vec4(0.0, 0.0, 0.0, cover);
}
`

/** Tile sampling (milestone 2). Only compiled into the variant that has tiles attached, so the
 * milestone-1 shader, and its first load, are untouched. */
/** ?normalfilter=0 retains the previous isotropic normal LOD for visual comparison. */
const NORMAL_FILTER_ON = typeof location === 'undefined' || new URLSearchParams(location.search).get('normalfilter') !== '0'
const TILE_DECLS_BASE = /* glsl */ `
// ---- Milestone-2 tiles (src/moon/tiles/): 64 px/deg heights and 76 px/deg
// colour in texture arrays, found through a page table. A tile that has not
// arrived (or is not resident) contributes nothing: the 4k maps show through,
// so there is never a hole. Levels 2, 1, 0 (20, 10, 5 deg tiles) are mixed
// coarse to fine, each by its own fade-in, so a fine tile that is still
// loading shows the coarser one. Ramp and gate keep the tiles out of every
// view where a pixel spans 0.9 texels of the 4k map or more: those views are
// unchanged, pixel for pixel.
uniform highp sampler2DArray uTileH;   // R16F metres, 322 x 322 per layer
uniform highp sampler2DArray uTileC;   // sRGB8_A8, 382 x 382 per layer, mipmapped
uniform highp sampler2D uTilePage;     // RGBA32F: r = layer + 1 (0 none), g = fade
uniform float uTileBlend;              // 0: tiles off

const float TH_KM = ${H_TEXEL_KM.toFixed(5)};   // level-0 height texel at the equator, km
const float TH_PX = ${H_PX.toFixed(1)};
const float TH_SZ = ${H_SIZE.toFixed(1)};
const float TC_PX = ${C_PX.toFixed(1)};
const float TC_SZ = ${C_SIZE.toFixed(1)};

struct Tile { vec2 f; float layer; float a; };
// The tile at a level under uv: f is the position inside it (0..1), layer -1 when not resident.
Tile tileAt(vec2 uv, int l) {
  vec2 n = vec2(72.0, 36.0) / float(1 << l);
  vec2 g = uv * n;
  vec2 c = min(floor(g), n - 1.0);
  int row = l == 0 ? 0 : (l == 1 ? 36 : 54);
  vec4 e = texelFetch(uTilePage, ivec2(int(c.x), int(c.y) + row), 0);
  return Tile(g - c, e.x - 1.0, e.y);
}
// The footprint a tile level is chosen for: a pixel on ground at cosine mu covers fp across the view and fp / mu along it; the colour filter
// resolves the long axis down to ANISO_TILE times the short one (wanted.ts effectiveFootprintKm, which the streamer's wanted set mirrors).
const float ANISO_TILE = 8.0;
float effFp(float fp, float mu) { return max(fp, fp / max(mu, 0.15) / ANISO_TILE); }
float tileWeight(Tile t, int l, float fpKm, float gate) {
  if (t.layer < 0.0 || t.a <= 0.0) return 0.0;
  float ramp = 1.0 - smoothstep(1.0, 2.0, fpKm / (TH_KM * float(1 << l)));
  return t.a * ramp * gate;
}
float tileH(Tile t, vec2 df) {
  return textureLod(uTileH, vec3((1.0 + (t.f + df) * TH_PX) / TH_SZ, t.layer), 0.0).r;
}
// East and north slopes (rise over run) from taps one texel either side, but never past the
// 1 px border the tile carries (its neighbours' first pixels): at a seam the tap is pulled in
// and the difference divided by the span actually read (a tap beyond the border would clamp to
// the border texel and understate the slope by up to a quarter).
vec2 tileSlope(Tile t, int l, float cosLat) {
  float d = TH_KM * float(1 << l) * 1000.0;       // metres per texel
  float e = 1.0 / TH_PX;
  vec2 fE = min(t.f + e, vec2(1.0 + 0.5 * e)), fW = max(t.f - e, vec2(-0.5 * e));
  float hE = tileH(t, vec2(fE.x - t.f.x, 0.0)), hW = tileH(t, vec2(fW.x - t.f.x, 0.0));
  float hN = tileH(t, vec2(0.0, fW.y - t.f.y)), hS = tileH(t, vec2(0.0, fE.y - t.f.y));
  return vec2((hE - hW) / ((fE.x - fW.x) * TH_PX * d * max(cosLat, 0.05)), (hN - hS) / ((fE.y - fW.y) * TH_PX * d));
}
// Four strata along the long axis of a grazing pixel. Choosing the mip for
// major/4 keeps cross-view relief sharp while these taps average distant ridges.
// Resolve each tap's page independently so the filter crosses tile boundaries.
uniform float uNormalFilter; // 0 on motion frames (term-fix G): the 4-strata grazing filter is rest quality; ?nfmotion=1 keeps it in motion
vec2 tileSlopeFiltered(Tile center, int l, float cosLat, vec2 uv, vec2 span, float ratio) {
  float blend = ${NORMAL_FILTER_ON ? 'smoothstep(2.0, 4.0, ratio) * uNormalFilter' : '0.0'};
  if (blend <= 0.0) return tileSlope(center, l, cosLat);
  vec2 sum = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 q = uv + span * ((float(i) + 0.5) / 4.0 - 0.5);
    q = vec2(fract(q.x), clamp(q.y, 0.0, 1.0));
    Tile tap = tileAt(q, l);
    // Do not expose an absent/fading neighbour as a seam in an otherwise loaded tile.
    if (tap.layer >= 0.0 && tap.a >= 0.999) sum += tileSlope(tap, l, cosLat);
    else {
      vec2 base = tileSlope(center, l, cosLat);
      sum += tap.layer >= 0.0 && tap.a > 0.0 ? mix(base, tileSlope(tap, l, cosLat), tap.a) : base;
    }
  }
  vec2 filtered = sum * 0.25;
  return blend >= 1.0 ? filtered : mix(tileSlope(center, l, cosLat), filtered, blend);
}
vec3 tileColor(Tile t, int l, vec2 gx, vec2 gy) {
  vec2 n = vec2(72.0, 36.0) / float(1 << l);
  vec2 k = n * (TC_PX / TC_SZ);
  return textureGrad(uTileC, vec3((1.0 + t.f * TC_PX) / TC_SZ, t.layer), gx * k, gy * k).rgb;
}

`

const TILE_NORMAL_BASE = /* glsl */ `
  // Tiles (see above): their weights, and their slopes mixed over the 4k map's.
  float cosLatT = length(vec2(dot(p, uX), dot(p, uY)));
  float tGate = 0.0;
  Tile t0, t1, t2;
  float w0 = 0.0, w1 = 0.0, w2 = 0.0;
  if (uTileBlend > 0.0) {
    float fpTile = effFp(length(uCamPos - p) * R_KM * uTileTanPerPx, muP);
    // Four long-axis samples preserve the short-axis detail of a grazing pixel.
    float fpTileN = ${NORMAL_FILTER_ON ? 'mix(length(uCamPos - p) * R_KM * uTileTanPerPx / max(muP, 0.15), max(kmPerPx, kmPerPx * normalRatio / 4.0), uNormalFilter)' : 'length(uCamPos - p) * R_KM * uTileTanPerPx / max(muP, 0.15)'};
    tGate = uTileBlend * (1.0 - smoothstep(0.5, 0.9, fpTile / TEXEL_KM));
    float nGate = uTileBlend * (1.0 - smoothstep(0.5, 0.9, fpTileN / TEXEL_KM));
    if (tGate > 0.0 || nGate > 0.0) {
      t2 = tileAt(uv, 2); t1 = tileAt(uv, 1); t0 = tileAt(uv, 0);
      w2 = tileWeight(t2, 2, fpTile, tGate);
      w1 = tileWeight(t1, 1, fpTile, tGate);
      w0 = tileWeight(t0, 0, fpTile, tGate);
      float nw2 = tileWeight(t2, 2, fpTileN, nGate);
      float nw1 = tileWeight(t1, 1, fpTileN, nGate);
      float nw0 = tileWeight(t0, 0, fpTileN, nGate);
      if (nw2 + nw1 + nw0 > 0.0) {
        vec2 sl = vec2(sx, sy);
        if (nw2 > 0.0) sl = mix(sl, tileSlopeFiltered(t2, 2, cosLatT, uv, normalSpan, normalRatio), nw2);
        if (nw1 > 0.0) sl = mix(sl, tileSlopeFiltered(t1, 1, cosLatT, uv, normalSpan, normalRatio), nw1);
        if (nw0 > 0.0) sl = mix(sl, tileSlopeFiltered(t0, 0, cosLatT, uv, normalSpan, normalRatio), nw0);
        nrm = normalize(p - sl.x * e - sl.y * n);
      }
    }
  }
  // The shadow march reads tile heights wherever the tiles are drawn (same gate).
  gTileMarch = tGate * uTileMarch;
`


/**
 * The site patch (src/moon/patch/PatchLayer.ts). A patch's levels (slot 0 the coarsest) are read by
 * metres east and north of the site, so float32 never subtracts two longitudes. A level's heights (if
 * it has them) feed only the surface normal; its image detail (the photograph flattened by the terrain
 * shading it was taken under, over its own 400 m average) multiplies the albedo. Each fades in as a
 * pixel gets smaller than its texel and out toward the edge of its rectangle, so nothing pops and the
 * global data shows through everywhere the patch has none. The code is written for the layout a site
 * declares: `layout[i]` says whether level i has heights (the shader is rebuilt per layout).
 */
export interface PatchLevelLayout {
  /** The level has heights (a heights-only level, like the 25 cm tier's 1.5 m DTM, has no detail). */
  h: boolean
  /** The level has image detail. */
  r: boolean
  /** Metres over which the level fades out toward its rectangle's edge. */
  fadeM: number
  /** Its heights also shade the surface (slopes). false: they make the ground only (?tierdtm=off keeps the 2 m level's shading under the 25 cm tier). Default true. */
  shade?: boolean
  /** The level's ground has a horizon cache layer in the patch shadow cache atlas (PatchShadowCache.ts); the shader reads it where it is built. */
  cache?: boolean
}
export type PatchLayout = readonly PatchLevelLayout[]

export function patchDecls(layout: PatchLayout): string {
  const lv = layout.map((l, i) => `${l.h ? `uniform highp sampler2D uPH${i};\n` : ''}${l.r ? `uniform highp sampler2D uPR${i};\n` : ''}uniform float uPHOffset${i};\n uniform vec4 uPG${i};\nuniform vec4 uPA${i};\nuniform vec2 uPS${i};`).join('\n')
  const hs = layout.map((l, i) => (l.h ? i : -1)).filter((i) => i >= 0)
  return /* glsl */ `
${lv}
uniform vec3 uPSite;            // the site, unit, Moon body frame
uniform vec3 uPEast;            // its local east and north, unit
uniform vec3 uPNorth;
uniform float uPatchBlend;      // 0: patch off
uniform float uPatchGround;     // 1: the patch's heights also make the ground (shadow march, ground hit); 0: they shade the surface only (Apollo 11)
uniform float uPH0M;            // heights are stored minus this (metres)
uniform float uSurround;        // 1: modelled surround (?surround=1): a statistically matched texture where no photograph reaches
uniform float uPSlopeMax;       // steepest slope (rise over run) a patch's heights may give; a step in the model (a seam) would otherwise read as a wall
// Per level i: uPG = grid (left edge east (m), top edge north (m), texel east (m), texel north (m)),
// uPA = the metres-to-texels matrix (column, row) = (a.x d.e + a.y d.n, a.z d.e + a.w d.n), uPS = size in texels.
const float PR_M = 1737400.0;

vec2 patchQ(vec4 g, vec4 a, vec2 m) { vec2 d = m - g.xy; return vec2(a.x * d.x + a.y * d.y, a.z * d.x + a.w * d.y); }
// 0 at the rectangle's edge, 1 more than fadeM inside it.
float patchEdge(vec2 q, vec2 size, vec4 g, float fadeM) {
  vec2 d = min(q, size - q) * vec2(g.z, g.w);
  float t = clamp(min(d.x, d.y) / max(fadeM, 1e-6), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}
// A height is .r + .g: a two-part half float raster carries its remainder in .g, a one-part one has .g = 0.
float patchHeightOne(highp sampler2D H, vec2 q, vec2 size) {
  vec2 t = textureLod(H, q / size, 0.0).rg;
  return t.r + t.g;
}
// East and north slopes (rise over run) of a level's heights, one texel either side.
vec2 patchSlope(highp sampler2D H, vec2 q, vec2 size, vec4 g) {
  vec2 uv = q / size;
  vec2 e = 1.0 / size;
  vec2 tE = textureLod(H, uv + vec2(e.x, 0.0), 0.0).rg, tW = textureLod(H, uv - vec2(e.x, 0.0), 0.0).rg;
  vec2 tN = textureLod(H, uv - vec2(0.0, e.y), 0.0).rg, tS = textureLod(H, uv + vec2(0.0, e.y), 0.0).rg;
  float hE = tE.r + tE.g, hW = tW.r + tW.g, hN = tN.r + tN.g, hS = tS.r + tS.g;
  vec2 sl = vec2((hE - hW) / (2.0 * g.z), (hN - hS) / (2.0 * g.w));
  float m = length(sl);
  return m > uPSlopeMax ? sl * (uPSlopeMax / m) : sl;
}
// log2 of the image detail ratio, filtered over a pixel of fpM metres.
float patchDetail(highp sampler2D T, vec2 q, vec2 size, vec4 g, float fpM) {
  vec2 uv = q / size;
  vec2 gx = vec2(fpM / (g.z * size.x), 0.0), gy = vec2(0.0, fpM / (g.w * size.y));
  return (textureGrad(T, uv, gx, gy).r * 255.0 - 128.0) / 40.0;
}
// Value noise on the site's tangent plane (metres) for the modelled surround.
float surrHash(vec2 i) { return fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453); }
float surrNoise(vec2 x) {
  vec2 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(surrHash(i), surrHash(i + vec2(1.0, 0.0)), f.x), mix(surrHash(i + vec2(0.0, 1.0)), surrHash(i + vec2(1.0, 1.0)), f.x), f.y) * 2.0 - 1.0;
}
// Metres east and north of the site of a body-frame unit vector x.
vec2 patchEN(vec3 x) {
  vec3 bP = vec3(dot(x, uX), dot(x, uY), dot(x, uK)) - uPSite;
  return vec2(dot(bP, uPEast), dot(bP, uPNorth)) * PR_M;
}
// Coverage of the coarsest height level at x (0 outside it, 1 more than its fade inside).
float patchCoverAt(vec3 x) {
  if (uPatchBlend * uPatchGround <= 0.0) return 0.0;
  vec2 mEN = patchEN(x);
  vec2 q = patchQ(uPG${hs[0]}, uPA${hs[0]}, mEN);
  return patchEdge(q, uPS${hs[0]}, uPG${hs[0]}, ${layout[hs[0]].fadeM.toFixed(1)}) * uPatchBlend * uPatchGround;
}
// The ground height (metres) at x: the coarsest patch heights over the tiles' (base, computed only where
// the patch does not fully cover), each finer level over the last. fpM is the pixel's footprint on
// the ground (0 for a shadow march sample): a level whose texel is 4 to 16 times smaller than the footprint
// fades out, so a far view is not sampled at 8 m and left to alias. Every level blends by its own edge fade, so the
// surface has no step where a level ends.
float patchGround(vec3 x, float fpM, int lmin, float lodG, float forTerrain) {
  vec2 mEN = patchEN(x);
  float h = 0.0;
  float acc = 1.0;   // the share of the tiles' height still showing
${hs.map((i, n) => `  {
    vec2 q = patchQ(uPG${i}, uPA${i}, mEN);
    float w = patchEdge(q, uPS${i}, uPG${i}, ${layout[i].fadeM.toFixed(1)}) * uPatchBlend * mix(1.0, uPatchGround, forTerrain) * (1.0 - smoothstep(4.0, 16.0, fpM / uPG${i}.z));
    if (w > 0.0) {
      float hv = patchHeightOne(uPH${i}, q, uPS${i}) + uPHOffset${i};
      ${n === 0 ? 'h = w * hv; acc = 1.0 - w;' : 'h = mix(h, hv, w);'}
    }
  }`).join('\n')}
  if (acc > 1e-3) h += acc * marchH(uvOf(x), lmin, lodG);
  return h;
}
// The same ground height from metres east and north of the site and the global map's uv (ground mode, src/ground/): no
// unit vector, so nothing is a 1.7 Mm quantity and the ground can be read to a millimetre.
float patchGroundEN(vec2 mEN, vec2 uv, float fpM, int lmin, float lodG) {
  float h = 0.0;
  float acc = 1.0;
${hs.map((i, n) => `  {
    vec2 q = patchQ(uPG${i}, uPA${i}, mEN);
    float w = patchEdge(q, uPS${i}, uPG${i}, ${layout[i].fadeM.toFixed(1)}) * uPatchBlend * uPatchGround * (1.0 - smoothstep(4.0, 16.0, fpM / uPG${i}.z));
    if (w > 0.0) {
      float hv = patchHeightOne(uPH${i}, q, uPS${i}) + uPHOffset${i};
      ${n === 0 ? 'h = w * hv; acc = 1.0 - w;' : 'h = mix(h, hv, w);'}
    }
  }`).join('\n')}
  if (acc > 1e-3) h += acc * marchH(uv, lmin, lodG);
  return h;
}
`
}

function patchNormal(layout: PatchLayout, tc = false): string {
  const idx = layout.map((_, i) => i)
  const hs = idx.filter((i) => layout[i].h && layout[i].shade !== false)
  const rs = idx.filter((i) => layout[i].r)
  return /* glsl */ `
  // The site patch: slopes from its heights over the global ones, image detail for the albedo.
  float patchLR = 0.0;${tc ? '\n  float patchCov = 0.0;' : ''}
  if (uPatchBlend > 0.0) {
    vec2 mEN = patchEN(p);
    float fpM = kmPerPx * 1000.0 / max(muP, 0.15);
${idx.map((i) => `    vec2 q${i} = patchQ(uPG${i}, uPA${i}, mEN);\n    float e${i} = patchEdge(q${i}, uPS${i}, uPG${i}, ${layout[i].fadeM.toFixed(1)}) * uPatchBlend;`).join('\n')}
${hs.map((i) => `    float wh${i} = e${i} * (1.0 - smoothstep(1.0, 3.0, fpM / uPG${i}.z));`).join('\n')}
    if (${hs.map((i) => `wh${i}`).join(' + ')} > 0.0) {
      vec2 sl = -vec2(dot(nrm, e), dot(nrm, n)) / max(dot(nrm, p), 0.2);
${hs.map((i) => `      if (wh${i} > 0.0) sl = mix(sl, patchSlope(uPH${i}, q${i}, uPS${i}, uPG${i}), wh${i});`).join('\n')}
      nrm = normalize(p - sl.x * e - sl.y * n);
    }
${tc ? rs.map((i) => `    patchCov = max(patchCov, e${i});`).join('\n') + '\n' : ''}${rs.map((i) => `    float wr${i} = e${i} * (1.0 - smoothstep(8.0, 32.0, fpM / uPG${i}.z));`).join('\n')}
${rs.map((i) => `    if (wr${i} > 0.0) patchLR = mix(patchLR, patchDetail(uPR${i}, q${i}, uPS${i}, uPG${i}, fpM), wr${i});`).join('\n')}
    // The modelled surround (off unless ?surround=1): where no photograph reaches (out to 60 km of the site), a smooth-noise
    // ratio of low amplitude (std about 0.1 in log2, under the 8 m level's measured 0.157), in five octaves (24 to 384 m) that
    // fade out as a pixel grows past them. It carries no measured detail: it only breaks up the flat grey, and the HUD says so.
    // The coarsest level's rectangle covers 24 by 39 km, but 30% of it holds no photograph (byte 128, ratio exactly 1): that counts as
    // uncovered. The finer levels count by their rectangles.
    float dC = ${rs.length ? `e${rs[0]} > 0.0 ? patchDetail(uPR${rs[0]}, q${rs[0]}, uPS${rs[0]}, uPG${rs[0]}, fpM) : 0.0` : '0.0'};
    float realC = ${rs.length ? `e${rs[0]} * smoothstep(0.008, 0.02, abs(dC))` : '0.0'};
    float sw = uSurround * (1.0 - ${['realC', ...rs.slice(1).map((i) => `e${i}`)].reduce((a, b) => `max(${a}, ${b})`)}) * (1.0 - smoothstep(30000.0, 60000.0, length(mEN)));
    if (sw > 0.0) {
      float nz = 0.0;
      nz += 0.115 * surrNoise(mEN / 24.0) * (1.0 - smoothstep(0.5, 1.5, fpM / 24.0));
      nz += 0.085 * surrNoise(mEN / 48.0 + 17.3) * (1.0 - smoothstep(0.5, 1.5, fpM / 48.0));
      nz += 0.070 * surrNoise(mEN / 96.0 + 41.9) * (1.0 - smoothstep(0.5, 1.5, fpM / 96.0));
      nz += 0.090 * surrNoise(mEN / 192.0 + 7.7) * (1.0 - smoothstep(0.5, 1.5, fpM / 192.0));
      nz += 0.100 * surrNoise(mEN / 384.0 + 91.1) * (1.0 - smoothstep(0.5, 1.5, fpM / 384.0));
      patchLR += sw * nz;
    }
  }
`
}

/**
 * The WAC detail-ratio product (levels -1 and -2, src/moon/tiles/detail.ts holds the CPU twins): a u8 log2 ratio multiplying the level-0 albedo.
 * An absent tile has weight 0 (ratio 1); a fresh one fades in (page .g); the footprint ramp and the pole cutoff are detail.ts detailWeight/poleWeight.
 */
export const DETAIL_GLSL = /* glsl */ `
uniform highp sampler2DArray uTileD;   // R8, 382 x 382 per layer, mipmapped: byte = 128 + 40 * log2(ratio)
uniform highp sampler2D uDetailPage;   // RGBA32F: r = layer + 1 (0 none), g = fade 0..1, b = preblended polar product, a = absent-neighbour mask
uniform float uDetailK;                // strength (?detail=x), 1 by default
const float DT_MID = ${DETAIL_MID.toFixed(1)};
const float DT_PER_OCT = ${DETAIL_PER_OCTAVE.toFixed(1)};
const float DT_PAGE_W = ${DETAIL_PAGE_W.toFixed(1)};
const float DF_W = ${(TILE_FEATHER_TEXELS / C_PX).toFixed(6)};
float detailFeather(vec2 f, int m) {
  float w = 1.0;
  if ((m & 1) != 0) w *= smoothstep(0.0, DF_W, f.x);
  if ((m & 2) != 0) w *= smoothstep(0.0, DF_W, 1.0 - f.x);
  if ((m & 4) != 0) w *= smoothstep(0.0, DF_W, f.y);
  if ((m & 8) != 0) w *= smoothstep(0.0, DF_W, 1.0 - f.y);
  if ((m & 16) != 0) w *= smoothstep(0.0, DF_W, max(f.x, f.y));
  if ((m & 32) != 0) w *= smoothstep(0.0, DF_W, max(1.0 - f.x, f.y));
  if ((m & 64) != 0) w *= smoothstep(0.0, DF_W, max(f.x, 1.0 - f.y));
  if ((m & 128) != 0) w *= smoothstep(0.0, DF_W, max(1.0 - f.x, 1.0 - f.y));
  return w;
}
// Detail level l (-1, -2): its log2 ratio at uv and its weight (0 when the tile is absent, fading in, too coarse a view or near a pole).
float detailLevel(vec2 uv, int l, vec2 gx, vec2 gy, float fpKm, float gate, float pole, float slope, out float wt) {
  float s = float(1 << (-l));
  vec2 n = vec2(72.0, 36.0) * s;
  vec2 g = uv * n;
  vec2 c = min(floor(g), n - 1.0);
  vec4 e = texelFetch(uDetailPage, ivec2(int(c.x), int(c.y) + (l == -1 ? 0 : 72)), 0);
  float tx = ${detailTexelKm(0).toFixed(5)} / s;
  // Only a validated, loaded polar product bypasses the legacy source cutoff.
  // Its bytes already blend global and polar log-ratios over 76–80 degrees.
  float sourcePole = e.z > 0.5 ? 1.0 : pole;
  wt = e.x > 0.0 ? e.y * detailFeather(g - c, int(e.w + 0.5)) * (1.0 - smoothstep(1.0, 2.0, fpKm / tx)) * gate * sourcePole * slope : 0.0;
  if (wt <= 0.0) return 0.0;
  vec2 k = n * (TC_PX / TC_SZ);
  float b = textureGrad(uTileD, vec3((1.0 + (g - c) * TC_PX) / TC_SZ, e.x - 1.0), gx * k, gy * k).r * 255.0;
  return (b - DT_MID) / DT_PER_OCT;
}
float slopeK(float slopeDeg) { return 1.0 - smoothstep(${DETAIL_SLOPE_START.toFixed(1)}, ${DETAIL_SLOPE_END.toFixed(1)}, slopeDeg); }
float poleK(float latDeg) { return 1.0 - smoothstep(${DETAIL_POLE_START.toFixed(1)}, ${DETAIL_POLE_END.toFixed(1)}, abs(latDeg)); }
`
const DETAIL_APPLY_WAC = /* glsl */ `
  {
    float dLat = asin(clamp(dot(p, uK), -1.0, 1.0)) * 180.0 / PI;
    float dPole = poleK(dLat);
    float dSlope = slopeK(atan(length(vec2(sx, sy))) * 180.0 / PI);
    float dLog = 0.0;
    if (uDetailK > 0.0 && tGate > 0.0 && dSlope > 0.0) {
      float dFp = effFp(length(uCamPos - p) * R_KM * uTileTanPerPx, muP);
      float dw1, dw2;
      float dl1 = detailLevel(uv, -1, gx, gy, dFp, tGate, dPole, dSlope, dw1);
      float dl2 = detailLevel(uv, -2, gx, gy, dFp, tGate, dPole, dSlope, dw2);
      dLog = mix(dl1 * dw1, dl2, dw2);
    }
    albedo *= exp2(dLog * uDetailK);
  }`
/** The same block with the TC layers mixed over the WAC value; `patch` says whether patchCov exists in this variant. */
function detailApplyTc(patch: boolean): string {
  return /* glsl */ `
  {
    float dLat = asin(clamp(dot(p, uK), -1.0, 1.0)) * 180.0 / PI;
    float dPole = poleK(dLat);
    float dSlope = slopeK(atan(length(vec2(sx, sy))) * 180.0 / PI);
    float dLog = 0.0;
    float dFp = effFp(length(uCamPos - p) * R_KM * uTileTanPerPx, muP);
    if (uDetailK > 0.0 && tGate > 0.0 && dSlope > 0.0) {
      float dw1, dw2;
      float dl1 = detailLevel(uv, -1, gx, gy, dFp, tGate, dPole, dSlope, dw1);
      float dl2 = detailLevel(uv, -2, gx, gy, dFp, tGate, dPole, dSlope, dw2);
      dLog = mix(dl1 * dw1, dl2, dw2);
    }
    float dLogK = dLog * uDetailK;
    if (uTcK > 0.0 && tGate > 0.0) {
      // Where to look up: mode 0 the terrain-resolved hit (parallax-correct), 1 the sphere hit moved to the 474 m-smoothed ground, 2 the sphere hit.
      // The filter footprint (gx, gy, squeezed) is measured on sphere hits in main(), the same surface this lookup uses.
      vec2 gxT = gx;
      vec2 gyT = gy;
      vec2 uvT = uv;
      if (uTcUv == 2) uvT = uvOf(pSph);
      else if (uTcUv == 1) {
        float tcRay = -dot(uCamPos, rr);
        float rg = 1.0 + marchH(uvOf(pSph), 0, 0.0) * 0.001 / R_KM;
        float d2 = rg * rg - b * b;
        if (d2 > 0.0) uvT = uvOf(normalize(uCamPos + rr * (tcRay - sqrt(d2))));
      }
      float tjOpen = ${patch ? '1.0 - clamp(patchCov, 0.0, 1.0)' : '1.0'};
      if (tjOpen > 0.0) {
        float tw3, tw4, tw5;
        float t3 = tjLevel(uvT, -3, gxT, gyT, dFp, tGate, dPole, tjOpen, tw3);
        float t4 = tjLevel(uvT, -4, gxT, gyT, dFp, tGate, dPole, tjOpen, tw4);
        float t5 = tjLevel(uvT, -5, gxT, gyT, dFp, tGate, dPole, tjOpen, tw5);
        if (tw3 > 0.0) dLogK = mix(dLogK, t3 * uTcK, tw3);
        if (tw4 > 0.0) dLogK = mix(dLogK, t4 * uTcK, tw4);
        if (tw5 > 0.0) dLogK = mix(dLogK, t5 * uTcK, tw5);
      }
    }
    albedo *= exp2(dLogK);
  }`
}
const detailApply = (tc: boolean, patch: boolean): string => (tc ? detailApplyTc(patch) : DETAIL_APPLY_WAC)

/**
 * The JAXA TC detail ratio (levels -3, -4, -5; src/moon/tiles/tcDetail.ts holds the CPU twins). Compiled only when a viewer opts in (`?tc=`); without it the
 * shader text is the same as before. It REPLACES the WAC detail where its tile is present, weighted like it (tile fade, 1-to-2 texel footprint ramp, view
 * gate, pole cutoff), and fades out inside a NAC site patch (patchCov), where the patch photograph is the detail and the TC Sun is on the other side.
 */
const TJ_GLSL = /* glsl */ `
uniform highp sampler2DArray uTcD;   // R8, 382 x 382 per layer, mipmapped: byte = mid + perOctave * log2(ratio)
uniform highp sampler2D uTcPage;     // RGBA8: r = layer + 1 (0 none), g = fade 0..1, a = absent-neighbour mask / 255
uniform float uTcK;                  // gain on the log2 ratio (?tcgain=x), 1 by default
uniform vec2 uTcScale;               // mid, perOctave
uniform int uTcUv;                   // where the TC is looked up: 0 the terrain-resolved hit, 1 the sphere hit moved to the smoothed (474 m) ground, 2 the sphere hit
const float TJ_PAGE_W = ${TC_PAGE_W.toFixed(1)};
float tjFeather(vec2 f, int m) {
  float w = 1.0;
  if ((m & 1) != 0) w *= smoothstep(0.0, DF_W, f.x);
  if ((m & 2) != 0) w *= smoothstep(0.0, DF_W, 1.0 - f.x);
  if ((m & 4) != 0) w *= smoothstep(0.0, DF_W, f.y);
  if ((m & 8) != 0) w *= smoothstep(0.0, DF_W, 1.0 - f.y);
  if ((m & 16) != 0) w *= smoothstep(0.0, DF_W, max(f.x, f.y));
  if ((m & 32) != 0) w *= smoothstep(0.0, DF_W, max(1.0 - f.x, f.y));
  if ((m & 64) != 0) w *= smoothstep(0.0, DF_W, max(f.x, 1.0 - f.y));
  if ((m & 128) != 0) w *= smoothstep(0.0, DF_W, max(1.0 - f.x, 1.0 - f.y));
  return w;
}
// TC level l (-3, -4, -5): its log2 ratio (before the gain) at uv and its weight (0 when absent, fading in, too coarse a view, near a pole or inside a patch).
float tjLevel(vec2 uv, int l, vec2 gx, vec2 gy, float fpKm, float gate, float pole, float patchOpen, out float wt) {
  float s = float(1 << (-l));
  vec2 n = vec2(72.0, 36.0) * s;
  vec2 g = uv * n;
  vec2 c = min(floor(g), n - 1.0);
  int row = l == -3 ? ${TC_ROW[-3]} : (l == -4 ? ${TC_ROW[-4]} : ${TC_ROW[-5]});
  vec4 e = texelFetch(uTcPage, ivec2(int(c.x), int(c.y) + row), 0);
  float layer = floor(e.x * 255.0 + 0.5);
  float tx = ${detailTexelKm(0).toFixed(5)} / s;
  wt = layer > 0.0 ? e.y * tjFeather(g - c, int(e.w * 255.0 + 0.5)) * (1.0 - smoothstep(1.0, 2.0, fpKm / tx)) * gate * pole * patchOpen : 0.0;
  if (wt <= 0.0) return 0.0;
  vec2 k = n * (TC_PX / TC_SZ);
  float b = textureGrad(uTcD, vec3((1.0 + (g - c) * TC_PX) / TC_SZ, layer - 1.0), gx * k, gy * k).r * 255.0;
  return (b - uTcScale.x) / uTcScale.y;
}
`

const TILE_COLOR = /* glsl */ `
  if (w2 > 0.0) c = mix(c, tileColor(t2, 2, gx, gy), w2);
  if (w1 > 0.0) c = mix(c, tileColor(t1, 1, gx, gy), w1);
  if (w0 > 0.0) c = mix(c, tileColor(t0, 0, gx, gy), w0);
`

/**
 * Focus pull (default on, `?focuspull=0` off, tiles/focusPull.ts holds the CPU twin and the reasoning). Replaces TILE_COLOR only under the switch, so the switch-off text
 * is the frozen text. A resident tile now shows at its full ramp x gate weight the moment its fade leaves 0 (the opacity fade is gone) and the colour is
 * defocused by the detail still lacking:
 *   sRes  texel size (px) of the colour on screen now: the 4k map, then levels 2, 1, 0 mixed by ramp x gate x pull(fade) of each resident level;
 *   sIdeal the same with every resident or PENDING_MARK level fully in (the streamer marks a wanted, not yet resident level's page cell, g = 2); a mark
 *         that is let go (the tile left the wanted set, backed off, or a resident tile finished leaving) ramps from g = 2 down to RELEASE_FLOOR on the
 *         arrival's curve, and the level counts at that strength (g - 1), so the blur ramps out instead of ending on one frame;
 *   lack  = sRes - sIdeal. At rest every fade is exactly 1, so sRes == sIdeal bit for bit, lack is 0 and the plain colour path above runs unchanged.
 * Above MIN_LACK_PX the colour is the mean of FOCUS_TAPS taps on a disc of BLUR_PER_LACK x lack pixels (capped), rotated per pixel, each tap resolving its
 * own tiles. Heights, slopes, the detail ratio layers and the lighting are untouched.
 */
const TILE_COLOR_FOCUS = /* glsl */ `
  if (tGate > 0.0) {
    float fpF = effFp(length(uCamPos - p) * R_KM * uTileTanPerPx, muP);
    const float TC_KM = ${C_TEXEL_KM.toFixed(6)};
    float pxKm = max(kmPerPx, 1e-9);
    // Per level: the weight it would have fully in (ideal), and what is drawn now.
    float wI2 = 0.0, wI1 = 0.0, wI0 = 0.0, wP2 = 0.0, wP1 = 0.0, wP0 = 0.0, wS2 = 0.0, wS1 = 0.0, wS0 = 0.0;
    {
      Tile ts = t2; float ph = ts.layer < 0.0 ? clamp(ts.a - ${RELEASE_FLOOR.toFixed(1)}, 0.0, 1.0) : 1.0; bool drawn = ts.layer >= 0.0 && ts.a > 0.0; float fa = drawn ? ts.a : 0.0;
      ts.layer = ph > 0.0 ? 0.0 : -1.0; ts.a = 1.0;
      wI2 = tileWeight(ts, 2, fpF, tGate) * ph; wS2 = drawn ? wI2 : 0.0; float u2 = 1.0 - clamp(fa, 0.0, 1.0); wP2 = drawn ? wI2 * (1.0 - u2 * u2 * u2) : 0.0;
    }
    {
      Tile ts = t1; float ph = ts.layer < 0.0 ? clamp(ts.a - ${RELEASE_FLOOR.toFixed(1)}, 0.0, 1.0) : 1.0; bool drawn = ts.layer >= 0.0 && ts.a > 0.0; float fa = drawn ? ts.a : 0.0;
      ts.layer = ph > 0.0 ? 0.0 : -1.0; ts.a = 1.0;
      wI1 = tileWeight(ts, 1, fpF, tGate) * ph; wS1 = drawn ? wI1 : 0.0; float u1 = 1.0 - clamp(fa, 0.0, 1.0); wP1 = drawn ? wI1 * (1.0 - u1 * u1 * u1) : 0.0;
    }
    {
      Tile ts = t0; float ph = ts.layer < 0.0 ? clamp(ts.a - ${RELEASE_FLOOR.toFixed(1)}, 0.0, 1.0) : 1.0; bool drawn = ts.layer >= 0.0 && ts.a > 0.0; float fa = drawn ? ts.a : 0.0;
      ts.layer = ph > 0.0 ? 0.0 : -1.0; ts.a = 1.0;
      wI0 = tileWeight(ts, 0, fpF, tGate) * ph; wS0 = drawn ? wI0 : 0.0; float u0 = 1.0 - clamp(fa, 0.0, 1.0); wP0 = drawn ? wI0 * (1.0 - u0 * u0 * u0) : 0.0;
    }
    float sRes = TEXEL_KM / pxKm, sIdeal = sRes;
    sRes = mix(sRes, TC_KM * 4.0 / pxKm, wP2); sIdeal = mix(sIdeal, TC_KM * 4.0 / pxKm, wI2);
    sRes = mix(sRes, TC_KM * 2.0 / pxKm, wP1); sIdeal = mix(sIdeal, TC_KM * 2.0 / pxKm, wI1);
    sRes = mix(sRes, TC_KM / pxKm, wP0); sIdeal = mix(sIdeal, TC_KM / pxKm, wI0);
    float lackF = sRes - sIdeal;
    if (lackF > ${MIN_LACK_PX.toFixed(3)}) {
      float rF = min(${MAX_BLUR_PX.toFixed(1)}, ${BLUR_PER_LACK.toFixed(2)} * lackF);
      float rotF = 6.2831853 * fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
      vec3 acc = vec3(0.0);
      for (int i = 0; i < ${FOCUS_TAPS}; i++) {
        float rr = sqrt((float(i) + 0.5) / ${FOCUS_TAPS.toFixed(1)});
        float an = 2.399963 * float(i) + rotF;
        vec2 o = vec2(cos(an), sin(an)) * (rr * rF);
        vec2 q = uv + gx * o.x + gy * o.y;
        q = vec2(fract(q.x), clamp(q.y, 0.0, 1.0));
        vec3 cq = textureGrad(uColor, q, gx, gy).rgb;
        Tile q2 = tileAt(q, 2); if (q2.layer >= 0.0 && q2.a > 0.0) { q2.a = 1.0; cq = mix(cq, tileColor(q2, 2, gx, gy), tileWeight(q2, 2, fpF, tGate)); }
        Tile q1 = tileAt(q, 1); if (q1.layer >= 0.0 && q1.a > 0.0) { q1.a = 1.0; cq = mix(cq, tileColor(q1, 1, gx, gy), tileWeight(q1, 1, fpF, tGate)); }
        Tile q0 = tileAt(q, 0); if (q0.layer >= 0.0 && q0.a > 0.0) { q0.a = 1.0; cq = mix(cq, tileColor(q0, 0, gx, gy), tileWeight(q0, 0, fpF, tGate)); }
        acc += cq;
      }
      c = acc / ${FOCUS_TAPS.toFixed(1)};
    } else {
      if (wS2 > 0.0) c = mix(c, tileColor(t2, 2, gx, gy), wS2);
      if (wS1 > 0.0) c = mix(c, tileColor(t1, 1, gx, gy), wS1);
      if (wS0 > 0.0) c = mix(c, tileColor(t0, 0, gx, gy), wS0);
    }
  }
`
/** The tile colour block of the Moon shader: the frozen one, or the focus pull's (the default; `?focuspull=0` gives the frozen one). */
const tileColorBlock = (): string => (focusPullOn() ? TILE_COLOR_FOCUS : TILE_COLOR)


/**
 * The 4k height map and the body frame, shared by the shading pass and (with
 * tiles) the cover pass, which must agree on where the ground is.
 * `wrap` says the map wraps across longitude 180.
 */
export function heightGlsl(lonSpan: number, texelKm: number): string {
  const wrap = lonSpan >= 180
  return /* glsl */ `
uniform vec3 uK;             // Moon body axes in the world frame: north pole,
uniform vec3 uX;             // prime meridian,
uniform vec3 uY;             // 90 deg east
uniform sampler2D uHeight;   // R16F metres, a box-filtered mip chain
uniform int uHeightLevels;
uniform float uHeightMix;   // 0 while the 4k heights are on their way, eased to 1 as they arrive: 1 is the map exactly
const float LON_SPAN = ${lonSpan.toFixed(1)};
const float R_KM = ${MOON_R_KM.toFixed(1)};
const float TEXEL_KM = ${texelKm.toFixed(4)};

vec2 uvOf(vec3 p) {
  vec3 b = vec3(dot(p, uX), dot(p, uY), dot(p, uK));
  float lon = atan(b.y, b.x) * 180.0 / PI;
  float lat = asin(clamp(b.z, -1.0, 1.0)) * 180.0 / PI;
  return vec2((lon + LON_SPAN) / (2.0 * LON_SPAN), (90.0 - lat) / 180.0);
}
float hTexel(ivec2 i, int lod) {
  ivec2 s = textureSize(uHeight, lod);${wrap ? `
  // Across longitude 180 the neighbour is on the other edge of the map.
  i.x = i.x < 0 ? i.x + s.x : (i.x >= s.x ? i.x - s.x : i.x);` : ''}
  return texelFetch(uHeight, clamp(i, ivec2(0), s - 1), lod).r;
}
// Bilinear height (m) at a mip level; the texture holds exact metres, so it
// is filtered here rather than by the sampler.
float heightLod(vec2 uv, int lod) {
  vec2 s = vec2(textureSize(uHeight, lod));
  vec2 t = uv * s - 0.5;
  ivec2 i = ivec2(floor(t));
  vec2 f = t - floor(t);
  float a = hTexel(i, lod), b = hTexel(i + ivec2(1, 0), lod);
  float c = hTexel(i + ivec2(0, 1), lod), d = hTexel(i + ivec2(1, 1), lod);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float heightAt(vec2 uv, float lodF) {
  float l = clamp(lodF, 0.0, float(uHeightLevels - 1));
  int l0 = int(floor(l));
  int l1 = min(l0 + 1, uHeightLevels - 1);
  return mix(heightLod(uv, l0), heightLod(uv, l1), l - float(l0)) * uHeightMix;
}
`
}

/**
 * Tile heights for the march and the ground hit (milestone 2, tasks 6 and 7).
 * marchH is the ground height (m) at a point: the finest resident tile at or
 * below level lmin, each mixed over the next coarser by its own fade-in (the
 * same weights the colour uses), and the 4k map beneath whatever is not
 * covered. Using it for the march origin AND its samples is what keeps the
 * shadow free of steps at tile edges: the origin never sits on one height
 * field while the skyline is read from another.
 */
const TILE_MARCH_FN_BASE = /* glsl */ `
const float TM_MIP = ${MARCH_MIP.toFixed(3)};
int marchLevel(float dKm) {
  return clamp(int(floor(log2(max(1.0, TM_MIP * dKm / TH_KM)) + 0.5)), 0, 2);
}
float marchH(vec2 uv, int lmin, float lodG) {
  float acc = 0.0, rem = 1.0;
  for (int l = 0; l < 3; l++) {
    if (l < lmin) continue;
    Tile t = tileAt(uv, l);
    if (t.layer >= 0.0 && t.a > 0.0) {
      acc += rem * t.a * tileH(t, vec2(0.0));
      rem *= 1.0 - t.a;
      if (rem < 1e-3) return acc;
    }
  }
  return acc + rem * heightAt(uv, lodG);
}
`

// ---------------------------------------------------------------------------------------------------------------------------------
// Deeper tile levels (levels < 0, TILE-CONTRACT.md 1b). Every function below returns the three-level text BYTE FOR BYTE when `deepest` is
// 0 (scripts/fixtures/moon-shader-depth0.json is the frozen output; tile-levels.test.mts compares), and patches that text otherwise.
// Deeper tiles carry heights only: colour is the three built levels' at every depth.
// ---------------------------------------------------------------------------------------------------------------------------------
/** Replaces each `[from, to]` and throws when a pattern is gone or ambiguous: a deep variant must never silently fall back to the base text. */
function patched(src: string, pairs: ReadonlyArray<readonly [string, string]>, all = false): string {
  let out = src
  for (const [a, b] of pairs) {
    const n = out.split(a).length - 1
    if (n < 1 || (!all && n > 1)) throw new Error(`moonShader: deep patch pattern matched ${n} times: ${a}`)
    out = out.split(a).join(b)
  }
  return out
}
const lvName = (l: number): string => (l >= 0 ? `${l}` : `n${-l}`)
/** GLSL expression of a level's page-table row for `v` an int variable: levels 2..deepest only (rows of levels a set cannot have are not emitted). */
function rowChain(v: string, deepest: number): string {
  let e = `${levelRow(COARSEST_LEVEL)}`
  for (let l = COARSEST_LEVEL - 1; l >= deepest; l--) e = `${v} == ${l} ? ${levelRow(l)} : (${e})`
  return e
}
const deepOf = (deepest: number): number => Math.max(DEEPEST_LEVEL, Math.min(0, deepest))

/** Tile sampling (milestone 2). Only compiled into the variant that has tiles attached, so the milestone-1 shader, and its first load, are untouched. */
export const tileDecls = (deepest: number): string => {
  const d = deepOf(deepest)
  if (d === 0) return TILE_DECLS_BASE
  return patched(TILE_DECLS_BASE, [
    // Exact power-of-two scale of a level (GLSL's exp2 is allowed an error of several ULP, which can move the last column to the wrong tile).
    ['struct Tile { vec2 f; float layer; float a; };', `float lvScale(int l) { return l >= 0 ? float(1 << l) : 1.0 / float(1 << -l); }
// Deeper levels (page table .z = bits of the absent neighbours, .w = the tile's mid height in metres): a tile's heights are stored minus its mid
// height (half float is exact to the metre only inside +-2048 m) and the weight feathers toward a neighbour that does not exist, so a block of
// finer tiles ends in a smooth hand-over to the coarser level, never a line of change in resolution.
const float TF_W = ${(TILE_FEATHER_TEXELS / H_PX).toFixed(6)};
float tileFeather(vec2 f, int m) {
  float w = 1.0;
  if ((m & 1) != 0) w *= smoothstep(0.0, TF_W, f.x);
  if ((m & 2) != 0) w *= smoothstep(0.0, TF_W, 1.0 - f.x);
  if ((m & 4) != 0) w *= smoothstep(0.0, TF_W, f.y);
  if ((m & 8) != 0) w *= smoothstep(0.0, TF_W, 1.0 - f.y);
  if ((m & 16) != 0) w *= smoothstep(0.0, TF_W, max(f.x, f.y));
  if ((m & 32) != 0) w *= smoothstep(0.0, TF_W, max(1.0 - f.x, f.y));
  if ((m & 64) != 0) w *= smoothstep(0.0, TF_W, max(f.x, 1.0 - f.y));
  if ((m & 128) != 0) w *= smoothstep(0.0, TF_W, max(1.0 - f.x, 1.0 - f.y));
  return w;
}
struct Tile { vec2 f; float layer; float a; float off; };`],
    ['vec2 n = vec2(72.0, 36.0) / float(1 << l);', 'vec2 n = vec2(72.0, 36.0) / lvScale(l);'],
    ['int row = l == 0 ? 0 : (l == 1 ? 36 : 54);', `int row = ${rowChain('l', d)};`],
    ['return Tile(g - c, e.x - 1.0, e.y);', 'vec2 fr = g - c;\n  int m = int(e.z + 0.5);\n  return Tile(fr, e.x - 1.0, e.y * (m == 0 ? 1.0 : tileFeather(fr, m)), e.w);'],
    ['(TH_KM * float(1 << l))', '(TH_KM * lvScale(l))'],
    ['t.layer), 0.0).r;', 't.layer), 0.0).r + t.off;'],
    ['float d = TH_KM * float(1 << l) * 1000.0;', 'float d = TH_KM * lvScale(l) * 1000.0;'],
    // Levels of 118 m and finer (SLDEM 59 m): the heights carry about 1 to 3 m of noise per texel (and a 1 m quantisation), which at a 59 m
    // spacing is a 1 to 3 degree slope facet. A Sun a degree or two over the horizon shades or shadows every such facet, and the lit mare
    // reads as black speckle with stair-stepped edges. The shadow march and the slope therefore read a smoothed height, a 3 x 3 binomial of
    // bilinear taps whose spacing is about 120 m on the ground (2 texels at 59 m, 1 at 118 m, 4 at 30 m): detail finer than that is noise
    // in this data, so nothing is invented, only not drawn. The kernel shrinks toward a tile edge by the same amount on both sides of it,
    // so the smoothed field is continuous across seams (the 1 px border supplies the taps).
    ['// East and north slopes (rise over run)', `// The deep ground is smoothed when the tile is uploaded (tiles/smoothDeep.ts: a 3 x 3 binomial, about 120 m on the ground both ways, shrinking toward
// tile edges), so this is one tap. It used to be nine bilinear taps per read, on every march sample.
float tileHs(Tile t, int l, vec2 df) { return tileH(t, df); }
// East and north slopes (rise over run)`],
    ['float hE = tileH(t, vec2(fE.x - t.f.x, 0.0)), hW = tileH(t, vec2(fW.x - t.f.x, 0.0));', 'float hE = tileHs(t, l, vec2(fE.x - t.f.x, 0.0)), hW = tileHs(t, l, vec2(fW.x - t.f.x, 0.0));'],
    ['float hN = tileH(t, vec2(0.0, fW.y - t.f.y)), hS = tileH(t, vec2(0.0, fE.y - t.f.y));', 'float hN = tileHs(t, l, vec2(0.0, fW.y - t.f.y)), hS = tileHs(t, l, vec2(0.0, fE.y - t.f.y));'],
  ], true)
}
export const TILE_DECLS = tileDecls(0)

const tileNormalDeep = (deepest: number): string => {
  const lv = ladder(deepest)
  const names = lv.map(lvName)
  return /* glsl */ `
  // Tiles (see above): their weights, and their slopes mixed over the 4k map's.
  float cosLatT = length(vec2(dot(p, uX), dot(p, uY)));
  float tGate = 0.0;
  Tile ${names.map((n) => 't' + n).join(', ')};
  float ${names.map((n) => 'w' + n + ' = 0.0').join(', ')};
  float ${names.map((n) => 'nw' + n + ' = 0.0').join(', ')};
  if (uTileBlend > 0.0) {
    float fpTile = effFp(length(uCamPos - p) * R_KM * uTileTanPerPx, muP);
    // Filter normals over the actual render pixel, independently of colour residency.
    float fpTileN = ${NORMAL_FILTER_ON ? 'mix(length(uCamPos - p) * R_KM * uTileTanPerPx / max(muP, 0.15), max(kmPerPx, kmPerPx * normalRatio / 4.0), uNormalFilter)' : 'length(uCamPos - p) * R_KM * uTileTanPerPx / max(muP, 0.15)'};
    tGate = uTileBlend * (1.0 - smoothstep(0.5, 0.9, fpTile / TEXEL_KM));
    float nGate = uTileBlend * (1.0 - smoothstep(0.5, 0.9, fpTileN / TEXEL_KM));
    if (tGate > 0.0 || nGate > 0.0) {
${lv.map((l, i) => `      t${names[i]} = tileAt(uv, ${l});`).join('\n')}
${lv.map((l, i) => `      w${names[i]} = tileWeight(t${names[i]}, ${l}, fpTile, tGate);`).join('\n')}
${lv.map((l, i) => `      nw${names[i]} = tileWeight(t${names[i]}, ${l}, fpTileN, nGate);`).join('\n')}
${lv.map((l, i) => l === -1 ? `      w${names[i]} *= ((uDbgKill > 0.5 && uDbgKill < 2.5) ? 0.0 : 1.0);` : l === -2 ? `      w${names[i]} *= ((uDbgKill > 0.5 && uDbgKill < 1.5) || (uDbgKill > 2.5 && uDbgKill < 3.5) ? 0.0 : 1.0);` : '').join('\n')}
${lv.map((l, i) => l === -1 ? `      nw${names[i]} *= ((uDbgKill > 0.5 && uDbgKill < 2.5) ? 0.0 : 1.0);` : l === -2 ? `      nw${names[i]} *= ((uDbgKill > 0.5 && uDbgKill < 1.5) || (uDbgKill > 2.5 && uDbgKill < 3.5) ? 0.0 : 1.0);` : '').join('\n')}
      if (${names.map((n) => 'nw' + n).join(' + ')} > 0.0) {
        vec2 sl = vec2(sx, sy);
${lv.map((l, i) => `        if (nw${names[i]} > 0.0) sl = mix(sl, tileSlopeFiltered(t${names[i]}, ${l}, cosLatT, uv, normalSpan, normalRatio), nw${names[i]});`).join('\n')}
        nrm = normalize(p - sl.x * e - sl.y * n);
      }
    }
  }
  // The shadow march reads tile heights wherever the tiles are drawn (same gate).
  gTileMarch = tGate * uTileMarch;
  // Share of the pixel whose shadow height still comes from the smoothed deep ground. Keep this on the
  // colour/geometry footprint: the shadow march uses tGate and w*, while nw* is only the normal experiment.
  gDeepK = ${lv.filter((l) => l <= -2).length
    ? `(1.0 - ${lv.filter((l) => l <= -2).map((l) => `(1.0 - w${lvName(l)})`).join(' * ')})`
    : '0.0'} * uTileMarch;
`
}
const tileNormal = (deepest: number): string => (deepOf(deepest) === 0 ? TILE_NORMAL_BASE : tileNormalDeep(deepOf(deepest)))

/**
 * Tile heights for the march and the ground hit (milestone 2, tasks 6 and 7).
 * marchH is the ground height (m) at a point: the finest resident tile at or
 * below level lmin, each mixed over the next coarser by its own fade-in (the
 * same weights the colour uses), and the 4k map beneath whatever is not
 * covered. Using it for the march origin AND its samples is what keeps the
 * shadow free of steps at tile edges: the origin never sits on one height
 * field while the skyline is read from another.
 */
export const tileMarchFn = (deepest: number): string => {
  const d = deepOf(deepest)
  if (d === 0) return TILE_MARCH_FN_BASE
  return patched(TILE_MARCH_FN_BASE, [
    ['int marchLevel(float dKm) {', `const int TL_MIN = ${d};\nint marchLevel(float dKm) {`],
    ['log2(max(1.0, TM_MIP * dKm / TH_KM)) + 0.5)), 0, 2);', 'log2(max(lvScale(TL_MIN), TM_MIP * dKm / TH_KM)) + 0.5)), TL_MIN, 2);'],
    ['  for (int l = 0; l < 3; l++) {\n    if (l < lmin) continue;\n', '  for (int l = max(TL_MIN, lmin); l < 3; l++) {\n'],
    ['acc += rem * t.a * tileH(t, vec2(0.0));', 'acc += rem * t.a * tileHs(t, l, vec2(0.0));'],
  ])
}
export const TILE_MARCH_FN = tileMarchFn(0)

/** Ground height at a body-frame unit vector: tiles alone (no site patch in this shader). */
const MARCH_HQ_PLAIN = /* glsl */ `
float marchHQ(vec3 x, int lmin, float lodG, float fpM) { return marchH(uvOf(x), lmin, lodG); }
float topographyHQ(vec3 x, int lmin, float lodG, float fpM) { return marchH(uvOf(x), lmin, lodG); }
`
/** With a site patch: its heights over the tiles', level by level (patchGround). */
const MARCH_HQ_PATCH = /* glsl */ `
float marchHQ(vec3 x, int lmin, float lodG, float fpM) {
  if (uPatchBlend * uPatchGround <= 0.0) return marchH(uvOf(x), lmin, lodG);
  return patchGround(x, fpM, lmin, lodG, 1.0);
}
float topographyHQ(vec3 x, int lmin, float lodG, float fpM) {
  return patchGround(x, fpM, lmin, lodG, 0.0);
}
`

const TILE_TERRAIN_BASE = /* glsl */ `
uniform float uHitIn;        // 1: this frame's cover pass wrote the terrain hit to uHitTex; the shade pass reads it instead of marching again
uniform float uHitOut;       // 1: this is that cover pass (it writes the hit, not the cover blend)
float gHitT = 0.0;           // the ray distance terrainResolve ended on, 0 where it kept the sphere
uniform float uTerrain;      // 0..1: how much of the relief the ground hit follows (0: the sphere, exactly)
uniform highp sampler2D uTileBound;  // 18 x 9 RG32F: highest and lowest ground (m) of each 20 deg tile, from the manifest
uniform float uTerrIter;     // step budget (a debug switch, ?tsteps=; the reference is 128)
uniform float uTerrMinDiv;   // the smallest step is the shell's path over this
uniform float uTerrBounded;  // 1: the shell is cut to the tiles' own extremes; 0: the globe's (a comparison switch)
float gEdge = 0.0;           // terrainResolveCore: 1 when the ray's closest approach lies where the skyline can be (the band the sub-pixel rays are for)
float gPxK = 1.0;            // the share of a pixel the ray stands for (1, or 1 / uHzK for a sub-pixel ray): the width of its coverage ramp
const float RELIEF_UP_KM = 11.0;   // the highest LOLA ground is 10.76 km
const float RELIEF_DN_KM = 9.3;    // the lowest is -9.12 km

// The highest and lowest ground (km) of the 20 deg tile under x.
vec2 boundAt(vec3 x) {
  vec2 c = min(floor(uvOf(normalize(x)) * vec2(18.0, 9.0)), vec2(17.0, 8.0));
  return texelFetch(uTileBound, ivec2(c), 0).rg * 0.001;
}

// Where the ray meets the ground, inside the shell the relief lives in
// (bounded: at most 56 samples, each stepping by the clearance over the
// ground, then 6 halvings across the crossing). p becomes the point's
// direction from the centre, hitPos the point, and a ray that clears every
// summit of a limb pixel keeps only the share of the pixel the ground covers.
// The shell is first cut to the highest and lowest ground of the 20 deg tiles
// it passes through (the manifest's maxQ and minQ, read at its two ends and
// its middle), so a grazing ray's steps are as short as the local relief
// allows instead of the whole globe's 20 km of it.
// The march's level for a sample at ray distance t (Moon radii): with the far low-pass, the level of ITS footprint (times uHzLp), never finer
// than the nearest sample's (lm, lodG), so a far skyline is read at the scale of a pixel there and not at the texel grid of finer data.
void lpLevel(float t, int lm, float lodG, out int lmS, out float lodS) {
  lmS = lm; lodS = lodG;
  if (uHzLp > 0.0) {
    float fpS = max(t, 1e-4) * R_KM * uTanPerPx * uHzLp;
    lmS = clamp(int(floor(log2(max(1.0, fpS / TH_KM)) + 0.5)), lm, 2);
    lodS = max(lodG, log2(max(1.0, fpS / TEXEL_KM)));
  }
}
void terrainResolveCore(vec3 r, float b, inout vec3 p, out vec3 hitPos, inout float cover) {
  hitPos = p;
  gEdge = 0.0;
  float S = uTerrain;
  float tc = -dot(uCamPos, r);
  if (S <= 0.0 || tc <= 0.0) return;
  float kToR = 0.001 / R_KM;
  float rOut = 1.0 + RELIEF_UP_KM * S / R_KM;
  if (b >= rOut) return;
  float rIn = 1.0 - RELIEF_DN_KM * S / R_KM;
  float sO = sqrt(rOut * rOut - b * b);
  float t0 = max(tc - sO, 0.0);   // a camera inside the shell (a site patch's floor) starts the march at itself
  float t1 = b < rIn ? tc - sqrt(rIn * rIn - b * b) : tc + sO;
  float dc = length(uCamPos);
  float pxR = uTanPerPx * sqrt(max(dc * dc - 1.0, 1e-6)) * gPxK;
  {
    vec2 ba = boundAt(uCamPos + r * t0), bm = boundAt(uCamPos + r * (0.5 * (t0 + t1))), bb = boundAt(uCamPos + r * t1);
    float hi = mix(RELIEF_UP_KM, max(ba.x, max(bm.x, bb.x)) + 0.3, uTerrBounded);
    float lo = mix(-RELIEF_DN_KM, min(ba.y, min(bm.y, bb.y)) - 0.3, uTerrBounded);
    float rOut2 = 1.0 + S * hi / R_KM;
    if (b >= rOut2) { gEdge = b < rOut2 + pxR ? 1.0 : 0.0; return; }
    float rIn2 = 1.0 + S * lo / R_KM;
    gEdge = b >= rIn2 - pxR ? 1.0 : 0.0;
    sO = sqrt(rOut2 * rOut2 - b * b);
    t0 = max(tc - sO, 0.0);
    t1 = b < rIn2 ? tc - sqrt(rIn2 * rIn2 - b * b) : tc + sO;
  }
  // Level of detail from the pixel's footprint at the shell.
  float fpKm = max(t0, 1e-4) * R_KM * uTanPerPx;
  int lm = clamp(int(floor(log2(max(1.0, fpKm / TH_KM)) + 0.5)), 0, 2);
  float lodG = log2(max(1.0, fpKm / TEXEL_KM));
  bool capMarch = uMotion > 0.5 && uFlightHz < 0.5;   // a flight frame under ?flighthz keeps the rest budget: 12 samples per grazing skyline ray draw terraces
  float terrIter = capMarch ? min(uTerrIter, uMTerr) : uTerrIter;
  float minStep = max(t1 - t0, 1e-5) / (capMarch ? min(uTerrMinDiv, uMTerr) : uTerrMinDiv);
  float ta = t0, tb = t0, clear = 1e9;
  bool hit = false;
  for (int i = 0; i < 128; i++) {
    if (float(i) >= terrIter) break;
    vec3 x = uCamPos + r * tb;
    float rad = length(x);
    vec3 xn = x / rad;
    int lmS; float lodS;
    lpLevel(tb, lm, lodG, lmS, lodS);
    float c = rad - 1.0 - S * marchHQ(xn, lmS, lodS, max(tb, 1e-4) * R_KM * 1000.0 * uTanPerPx) * kToR;
    if (c < 0.0) { hit = true; break; }
    clear = min(clear, c);
    ta = tb;
    if (tb >= t1) break;
    tb = min(t1, tb + max(c / (abs(dot(r, xn)) + 0.7), minStep));
  }
  if (!hit) {
    cover = clamp(0.5 - clear / pxR, 0.0, 1.0);
    return;
  }
  for (int i = 0; i < 6; i++) {
    float tm = 0.5 * (ta + tb);
    vec3 x = uCamPos + r * tm;
    float rad = length(x);
    int lmS; float lodS;
    lpLevel(tm, lm, lodG, lmS, lodS);
    float c = rad - 1.0 - S * marchHQ(x / rad, lmS, lodS, max(tm, 1e-4) * R_KM * 1000.0 * uTanPerPx) * kToR;
    if (c < 0.0) tb = tm; else ta = tm;
  }
  hitPos = uCamPos + r * tb;
  gHitT = tb;
  p = normalize(hitPos);
  cover = 1.0;
}

// The ground hit and the coverage of the pixel. Before, a ray that hit had coverage exactly 1 and one that missed a ramp from 0.5 to 0 over half a pixel
// (the clearance of the marched samples, which is coarse), so the skyline was a hard staircase with one dim pixel above it. In the band of pixels the
// skyline can pass through (gEdge) the pixel is now traced as uHzK sub-pixel rays stacked across it on the screen's vertical, each with its own ramp, and
// its coverage is their mean; hit, shading and key stay the centre ray's. Not on a gesture frame (the picture is soft anyway).
void terrainResolve(vec3 r, float b, inout vec3 p, out vec3 hitPos, inout float cover) {
  gPxK = 1.0;
  terrainResolveCore(r, b, p, hitPos, cover);
  if (uHzK < 0.5 || (uMotion > 0.5 && uFlightHz < 0.5) || gEdge < 0.5) return;
  float hitT = gHitT;
  float tcC = -dot(uCamPos, r);
  vec3 mC = uCamPos + r * tcC;
  vec3 up = mC / max(length(mC), 1e-6);      // away from the centre: the way the sky is
  float k = min(uHzK, 8.0);
  gPxK = 1.0 / k;
  float acc = 0.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= k) break;
    vec3 rk = normalize(r + up * (((float(i) + 0.5) / k - 0.5) * uTanPerPx));
    float bk;
    vec3 pk = moonHit(rk, bk);
    float ck = moonCover(rk, bk);
    vec3 hk;
    terrainResolveCore(rk, bk, pk, hk, ck);
    acc += ck;
  }
  gPxK = 1.0;
  gHitT = hitT;
  cover = acc / k;
}
`

/** The terrain shell march, with the level of detail floor of the set's depth. */
const tileTerrain = (deepest: number): string => deepOf(deepest) === 0 ? TILE_TERRAIN_BASE : patched(TILE_TERRAIN_BASE, [
  ['int lm = clamp(int(floor(log2(max(1.0, fpKm / TH_KM)) + 0.5)), 0, 2);', 'int lm = clamp(int(floor(log2(max(lvScale(TL_MIN), fpKm / TH_KM)) + 0.5)), TL_MIN, 2);'],
])

/**
 * Pass 1 with terrain: the same cover the shading pass computes, so the two never disagree. It is generated for the SAME depth as the shading
 * pass (`tileDeepest`): a cover at depth 0 under a shade at depth -3 disagrees on the skyline (a 59 m rim the box-filtered 474 m field lacks).
 */
export function moonCoverFragment(lonSpan: number, mapWidth: number, patch: PatchLayout | null = null, tileDeepest = 0): string {
  const texelKm = (2 * Math.PI * MOON_R_KM) / mapWidth
  return /* glsl */ `
${GLSL_COMMON}
${MOON_GEOMETRY_GLSL}
out vec4 fragColor;
${heightGlsl(lonSpan, texelKm)}
${tileDecls(tileDeepest)}
${tileMarchFn(tileDeepest)}
${patch ? patchDecls(patch) + MARCH_HQ_PATCH : MARCH_HQ_PLAIN}
${tileTerrain(tileDeepest)}
void main() {
  vec3 r = cameraRay(gl_FragCoord.xy);
  float b;
  vec3 p = moonHit(r, b);
  float cover = moonCover(r, b);
  vec3 hp;
  terrainResolve(r, b, p, hp, cover);
  if (uHitOut > 0.5) { fragColor = vec4(gHitT, cover, 0.0, 1.0); return; }
  if (cover <= 0.0) discard;
  fragColor = vec4(0.0, 0.0, 0.0, cover);
}
`
}

/**
 * sin(x) and 1 - cos(x) for the marches' small angles (at most 0.18 rad), by
 * series. GLSL does not require trig to be accurate near zero, and one GPU
 * (SwiftShader) was off by ~2e-4 there: at the first step, 1.5 km out on a
 * 1737 km sphere, that alone turned flat mare into a 17 deg skyline (see
 * moonBakeShaders.ts).
 */
const SIN_SMALL_GLSL = /* glsl */ `
float sinSmall(float x) {
  float x2 = x * x;
  return x * (1.0 - x2 / 6.0 * (1.0 - x2 / 20.0));
}
float omcSmall(float x) {
  float x2 = x * x;
  return 0.5 * x2 * (1.0 - x2 / 12.0 * (1.0 - x2 / 30.0));
}
`

/** ?pedge=0 turns the patch shadow-edge refinement off (for before/after renders). */
const PATCH_EDGE_FIX = typeof location === 'undefined' || new URLSearchParams(location.search).get('pedge') !== '0'

/** The march with tiles: candidate B of DESIGN-M2.md section 6, in rise-over-run form (march.ts is its CPU mirror). */
function tileMarchBase(patch: boolean, deepest = 0): string {
  return /* glsl */ `
const int TM_N = ${MARCH_N};
const int TM_LIN = ${MARCH_LINEAR_N};
const int TM_GEO = ${MARCH_GEO_N};
const float TM_STEP = ${MARCH_LINEAR_STEP_KM.toFixed(3)};
const float TM_G0 = ${MARCH_GEO_START_KM.toFixed(3)};
const float TM_MAX = ${MARCH_MAX_KM.toFixed(3)};
uniform float uTileMarch;    // 1: the tile march; 0: the old one everywhere (?march=old, for comparisons)
float gTileMarch = 0.0;      // this pixel's share of the tile march (0 in views the 4k map already covers)

const int TM_NEAR = ${MARCH_NEAR_N};
const float TM_NEAR0 = ${MARCH_NEAR_START_KM.toFixed(4)};

// The 4k map's mip the march reads beyond the resident tiles, per tile level: the TILE's texel size sets it, not the pixel's footprint, so the live
// march and the shadow cache's build pass (which has no pixel) read the same heights and a layer's horizons equal the live ones.
float shLodG(int lm) { return max(0.0, log2(TH_KM * ${deepOf(deepest) === 0 ? 'float(1 << lm)' : 'lvScale(lm)'} / TEXEL_KM)); }

float horizonDegT(vec3 p, vec3 t, float h0, int lmin0, float lodG) {
  float best = -0.5 * PI;
${patch ? `  // Where a patch's heights are under p: fine steps from 5 m, over the same fused ground as everything else.
  if (patchCoverAt(p) > 0.0) {
    for (int k = 0; k < TM_NEAR; k++) {
      float d = TM_NEAR0 * pow(TM_STEP / TM_NEAR0, float(k) / float(TM_NEAR));
      float th = d / R_KM;
      float s = sinSmall(th), omc = omcSmall(th);
      vec3 q = normalize(p * (1.0 - omc) + t * s);
      float hq = marchHQ(q, lmin0, lodG, 0.0);
      float rq = R_KM + hq * 0.001;
      best = max(best, atan((hq - h0) * 0.001 - rq * omc, rq * s));
    }
  }
` : ''}  for (int k = 0; k < TM_N; k += ((uMotion > 0.5 || uShMode > 0.5) && k < TM_LIN) ? (uShMode > 0.5 ? max(4, int(uMStride)) : int(uMStride)) : 1) {
    if (best > gHzStopDeg * (PI / 180.0)) break;
    float d = k < TM_LIN ? TM_STEP * float(k + 1) : TM_G0 * pow(TM_MAX / TM_G0, float(k - TM_LIN) / float(TM_GEO - 1));
    float th = d / R_KM;
    float s = sinSmall(th), omc = omcSmall(th);
    vec3 q = normalize(p * (1.0 - omc) + t * s);
    float hq = marchHQ(q, max(lmin0, marchLevel(d)), lodG, 0.0);
    float rq = R_KM + hq * 0.001;
    best = max(best, atan((hq - h0) * 0.001 - rq * omc, rq * s));
  }
  return best * 180.0 / PI;
}
// The skyline at p along t, in the tile march where tiles are drawn and the
// old one elsewhere, mixed by the same gate so no view flips between them.
// lod is the global-map level (for the old march and as the fallback under
// the tiles), lodT the tile level of the pixel's footprint along the view.
float horizonAt(vec3 p, vec3 t, float lod, float lodT) {
  float w = gTileMarch;
  vec2 uvp = uvOf(p);
  float hzOld = w < 1.0 ? horizonDeg(p, t, heightAt(uvp, lod), lod) : 0.0;
  if (w <= 0.0) return hzOld;
  int lm = clamp(int(floor(lodT + 0.5)), 0, 2);
  float lodG = ${SHLOD_FINE ? 'shLodG(lm)' : 'max(lod, 0.0)'};
  float hzNew = horizonDegT(p, t, marchHQ(p, lm, lodG, 0.0), lm, lodG);
  hzNew = min(hzNew, gHzStopDeg);
  return w < 1.0 ? mix(hzOld, hzNew, w) : hzNew;
}
`
}
/**
 * The march at depth `deepest`. Deeper than level 0 the 250 m steps would sample 59 m data at 4 texels and skip a rim 100 m from the origin,
 * so MARCH_DEEP_NEAR_N more samples run from one texel out to the first linear step (the CPU twin is march.ts marchDeepNearDistanceKm).
 * Where a site patch is under the origin its own near loop (5 m, finer still) runs instead.
 */
function tileMarch(patch: boolean, deepest: number): string {
  const base = tileMarchBase(patch, deepest)
  if (deepOf(deepest) === 0) return base
  const loop = (pad: string): string => `${pad}for (int k = 0; k < (((uMotion > 0.5 && uMLite > 0.5) || uShMode > 0.5) ? 0 : TM_DNEAR); k++) {
${pad}  float d = TM_DNEAR0 * pow(TM_STEP / TM_DNEAR0, float(k) / float(TM_DNEAR));
${pad}  float th = d / R_KM;
${pad}  float s = sinSmall(th), omc = omcSmall(th);
${pad}  vec3 q = normalize(p * (1.0 - omc) + t * s);
${pad}  float hq = marchHQ(q, max(lmin0, marchLevel(d)), lodG, 0.0);
${pad}  float rq = R_KM + hq * 0.001;
${pad}  best = max(best, atan((hq - h0) * 0.001 - rq * omc, rq * s));
${pad}}
`
  return patched(base, [
    // Where a patch's 2 m heights are under the origin the near samples are 37 per cent apart (12 from 5 to 250 m): at 100 m the winning sample hands
    // over every 37 m, and the shadow edge steps with it (a stair along the rim of every patch crater). The winner is remembered here so the
    // halvings below refine it, from 8 m out (they used to start at 100 m).
    ...(patch && PATCH_EDGE_FIX ? ([['      best = max(best, atan((hq - h0) * 0.001 - rq * omc, rq * s));\n    }\n  }', '      float angN = atan((hq - h0) * 0.001 - rq * omc, rq * s);\n      if (angN > best) { best = angN; bestD = d; }\n    }\n  }']] as Array<readonly [string, string]>) : []),
    ['float gTileMarch = 0.0;', 'uniform float uDbgKill;      // ?dbgkill=1: both deep levels; 2: -1 only; 3: -2 only\nuniform float uDbg;          // debug output mode (?dbg=N), 0 = normal\nfloat gTileMarch = 0.0;\nfloat gDeepK = 0.0;       // share of the pixel drawn from the smoothed 118 m and finer ground (set with the tile normal)'],
    ['const float TM_NEAR0 = ', `const int TM_DNEAR = ${MARCH_DEEP_NEAR_N};\nconst float TM_DNEAR0 = ${MARCH_DEEP_NEAR_START_KM.toFixed(4)};\nconst float TM_NEAR0 = `],
    patch
      ? ['  }\n  for (int k = 0; k < TM_N; k += ((uMotion > 0.5 || uShMode > 0.5) && k < TM_LIN) ? (uShMode > 0.5 ? max(4, int(uMStride)) : int(uMStride)) : 1) {', `  } else {\n${loop('    ')}  }\n  for (int k = 0; k < TM_N; k += ((uMotion > 0.5 || uShMode > 0.5) && k < TM_LIN) ? (uShMode > 0.5 ? max(4, int(uMStride)) : int(uMStride)) : 1) {`]
      : ['  float best = -0.5 * PI;\n  for (int k = 0; k < TM_N; k += ((uMotion > 0.5 || uShMode > 0.5) && k < TM_LIN) ? (uShMode > 0.5 ? max(4, int(uMStride)) : int(uMStride)) : 1) {', `  float best = -0.5 * PI;\n${loop('  ')}  for (int k = 0; k < TM_N; k += ((uMotion > 0.5 || uShMode > 0.5) && k < TM_LIN) ? (uShMode > 0.5 ? max(4, int(uMStride)) : int(uMStride)) : 1) {`],
    ['int lm = clamp(int(floor(lodT + 0.5)), 0, 2);', 'int lm = clamp(int(floor(lodT + 0.5)), TL_MIN, 2);'],
    // The skyline is the largest angle over samples 250 m apart (more at the far end). Between samples the true crest is missed by up to half a
    // step, and as the pixel moves the winning sample hands over from one to the next: the shadow's edge steps with the sample spacing (a
    // sawtooth of 250 m, drawn as stair steps along every crater rim). Three halvings around the winning sample (a step/2, /4, /8 either side)
    // follow the crest to a few tens of metres for six more samples.
    ['float horizonDegT(vec3 p, vec3 t, float h0, int lmin0, float lodG) {', `float marchAng(vec3 p, vec3 t, float h0, int lmin0, float lodG, float d) {
  float th = d / R_KM;
  float s = sinSmall(th), omc = omcSmall(th);
  vec3 q = normalize(p * (1.0 - omc) + t * s);
  float hq = marchHQ(q, max(lmin0, marchLevel(d)), lodG, 0.0);
  float rq = R_KM + hq * 0.001;
  return atan((hq - h0) * 0.001 - rq * omc, rq * s);
}
float horizonDegT(vec3 p, vec3 t, float h0, int lmin0, float lodG) {`],
    ['float best = -0.5 * PI;', 'float best = -0.5 * PI;\n  float bestD = 0.0;'],
    ['    best = max(best, atan((hq - h0) * 0.001 - rq * omc, rq * s));\n  }\n  return best * 180.0 / PI;', `    float ang = atan((hq - h0) * 0.001 - rq * omc, rq * s);
    if (ang > best) { best = ang; bestD = d; }
  }
  float hw = bestD <= TM_STEP ? ${patch && PATCH_EDGE_FIX ? '0.19' : '0.1'} * bestD : (bestD <= 10.0 ? 0.5 * TM_STEP : 0.077 * bestD);
  for (int r = 0; r < (((uMotion > 0.5 && uMLite > 0.5) || uShMode > 0.5) ? 0 : 3); r++) {
    if (bestD < ${(patch && PATCH_EDGE_FIX ? 0.008 : MARCH_REFINE_MIN_KM).toFixed(3)}) break;
    float a1 = marchAng(p, t, h0, lmin0, lodG, bestD - hw);
    float a2 = marchAng(p, t, h0, lmin0, lodG, bestD + hw);
    float c = bestD;
    if (a1 > best) { best = a1; c = bestD - hw; }
    if (a2 > best) { best = a2; c = bestD + hw; }
    bestD = c;
    hw *= 0.5;
  }
  return best * 180.0 / PI;`],
  ])
}
/**
 * The Sun-keyed shadow cache (src/moon/tiles/ShadowCache.ts): per height-tile texel, the horizon toward the Sun the cache was built for,
 * in the same units horizonAt returns (degrees above the local horizontal). A pixel whose footprint level (every built level, the deeper
 * height-only levels included) has a fully faded tile with a valid cache layer reads that, one bilinear tap, instead of the 70-sample march.
 * Interactive Sun motion drops a layer to fade 0 the moment the Sun moves, so a stale horizon is never drawn and the march answers while it is
 * rebuilt; clock drift keeps the old layer and crossfades old cache -> new cache (ShadowCache.ts). Only the SUN sites call this: the view horizon (the `vis` test)
 * looks toward the camera and stays a live march.
 */
const SH_CACHE_PAGE_W = 256
/** Where a site patch's fused heights can change a horizon: within this many km of the site the march stays live. */
export const SH_PATCH_CLEAR_KM = 40
/** The fixed policy's cache declarations and read (one bilinear tap of the Sun-keyed tile cache, honouring the fade between builds). Emitted before the tile march when the blend-ring cache read is on (horizonAtSun uses it). */
const FIXED_CACHE_DECL = /* glsl */ `
uniform highp sampler2DArray uTileS;
uniform highp sampler2D uShFade;
uniform float uShOn;
float cachedHorizon(int level, vec2 uv, out bool valid) {
  Tile tc = tileAt(uv, level);
  valid = tc.layer >= 0.0 && tc.a >= 0.999;
  if (!valid) return 0.0;
  int ly = int(tc.layer + 0.5);
  vec4 f = texelFetch(uShFade, ivec2(ly & ${SH_CACHE_PAGE_W - 1}, ly >> 8), 0);
  float w = f.g + f.a;
  if (w <= 0.0) { valid = false; return 0.0; }
  vec2 q = (1.0 + tc.f * TH_PX) / TH_SZ;
  float hc = 0.0;
  if (f.g > 0.0) hc += f.g * textureLod(uTileS, vec3(q, f.r), 0.0).r;
  if (f.a > 0.0) hc += f.a * textureLod(uTileS, vec3(q, f.b), 0.0).r;
  return hc / w;
}
// The same bilinear value from four texelFetches, with the spread (max - min) of the texels that carry weight: the cache is exact at a texel centre (rig 2026-10-28), so how far a read between centres can be off is bounded by how much the skyline changes across the four.
float cachedHorizonSpread(int level, vec2 uv, out bool valid, out float spread) {
  Tile tc = tileAt(uv, level);
  valid = tc.layer >= 0.0 && tc.a >= 0.999;
  spread = 0.0;
  if (!valid) return 0.0;
  int ly = int(tc.layer + 0.5);
  vec4 f = texelFetch(uShFade, ivec2(ly & ${SH_CACHE_PAGE_W - 1}, ly >> 8), 0);
  float w = f.g + f.a;
  if (w <= 0.0) { valid = false; return 0.0; }
  vec2 sq = 1.0 + tc.f * TH_PX - 0.5;
  ivec2 i0 = ivec2(floor(sq));
  vec2 fr = sq - vec2(i0);
  float hc = 0.0;
  float lo = 1.0e4, hi = -1.0e4;
  for (int k = 0; k < 2; k++) {
    float wk = k == 0 ? f.g : f.a;
    if (wk <= 0.0) continue;
    int lyr = int((k == 0 ? f.r : f.b) + 0.5);
    float h00 = texelFetch(uTileS, ivec3(i0, lyr), 0).r;
    float h10 = texelFetch(uTileS, ivec3(i0 + ivec2(1, 0), lyr), 0).r;
    float h01 = texelFetch(uTileS, ivec3(i0 + ivec2(0, 1), lyr), 0).r;
    float h11 = texelFetch(uTileS, ivec3(i0 + ivec2(1, 1), lyr), 0).r;
    hc += wk * mix(mix(h00, h10, fr.x), mix(h01, h11, fr.x), fr.y);
    lo = min(lo, min(min(h00, h10), min(h01, h11)));
    hi = max(hi, max(max(h00, h10), max(h01, h11)));
${ringWideOn() ? `    for (int dy = -1; dy <= 2; dy++) for (int dx = -1; dx <= 2; dx++) {
      if (dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1) continue;
      float hh = texelFetch(uTileS, ivec3(clamp(i0 + ivec2(dx, dy), ivec2(0), ivec2(int(TH_SZ) - 1)), lyr), 0).r;
      lo = min(lo, hh); hi = max(hi, hh);
    }
` : ''}  }
  spread = hi - lo;
  return hc / w;
}
`
/** The ring's read of the footprint envelope (src/moon/ringEnvelope.ts): the cell holding the point gives the bounds (nearest texel, no interpolation), the value is the bilinear centre horizon held inside them. Unbounded cells, texels outside the Sun band and uncached tiles take the live march. */
const RING_ENV_READ = /* glsl */ `
float ringEnvDeg(float c) { return c <= ${ENV_FINE_N}.0 ? c * ${ENV_STEP_FINE.toFixed(2)} : ${(ENV_FINE_N * ENV_STEP_FINE).toFixed(2)} + (c - ${ENV_FINE_N}.0) * ${ENV_STEP_COARSE.toFixed(2)}; }
float ringEnvRead(int level, vec2 uv, out bool valid, out float hzHi, out float hzLo) {
  Tile tc = tileAt(uv, level);
  valid = tc.layer >= 0.0 && tc.a >= 0.999;
  hzHi = 1.0e4; hzLo = -1.0e4;
  if (!valid) return 0.0;
  int ly = int(tc.layer + 0.5);
  vec4 f = texelFetch(uShFade, ivec2(ly & ${SH_CACHE_PAGE_W - 1}, ly >> 8), 0);
  float w = f.g + f.a;
  if (w <= 0.0) { valid = false; return 0.0; }
  vec2 xp = 1.0 + tc.f * TH_PX;
  ivec2 inn = ivec2(floor(xp));
  vec2 sq = xp - 0.5;
  ivec2 i0 = ivec2(floor(sq));
  vec2 fr = sq - vec2(i0);
  float hc = 0.0, hh = 0.0, hl = 0.0;
  for (int k = 0; k < 2; k++) {
    float wk = k == 0 ? f.g : f.a;
    if (wk <= 0.0) continue;
    int lyr = int((k == 0 ? f.r : f.b) + 0.5);
    vec2 en = texelFetch(uTileS, ivec3(inn, lyr), 0).rg;
    float u = mod(en.g, 32.0), l = floor(en.g / 32.0);
    // -90 holds a texel outside the cache's Sun band; 31 is "no bound".
    if (u >= ${ENV_UNBOUNDED}.0 || l >= ${ENV_UNBOUNDED}.0 || en.r < ${RING_MIN_VALID_DEG.toFixed(1)}) { valid = false; return 0.0; }
    float h00 = texelFetch(uTileS, ivec3(i0, lyr), 0).r, h10 = texelFetch(uTileS, ivec3(i0 + ivec2(1, 0), lyr), 0).r;
    float h01 = texelFetch(uTileS, ivec3(i0 + ivec2(0, 1), lyr), 0).r, h11 = texelFetch(uTileS, ivec3(i0 + ivec2(1, 1), lyr), 0).r;
    float bil = min(min(h00, h10), min(h01, h11)) < ${RING_MIN_VALID_DEG.toFixed(1)} ? en.r : mix(mix(h00, h10, fr.x), mix(h01, h11, fr.x), fr.y);
    float hi = en.r + ringEnvDeg(u), lo = en.r - ringEnvDeg(l);
    // Within ${ringEdge().toFixed(2)} texel of a cell's edge the pixel may belong to the neighbouring cell (position rounding): the union of the bounds of the cells that edge touches.
    vec2 ad = xp - (vec2(inn) + 0.5);
    ivec2 sgn = ivec2(ad.x > 0.0 ? 1 : -1, ad.y > 0.0 ? 1 : -1);
    bool ex = abs(ad.x) > ${(0.5 - ringEdge()).toFixed(3)}, ey = abs(ad.y) > ${(0.5 - ringEdge()).toFixed(3)};
    for (int n = 1; n < 4; n++) {
      bool use = n == 1 ? ex : (n == 2 ? ey : (ex && ey));
      if (!use) continue;
      ivec2 off = n == 1 ? ivec2(sgn.x, 0) : (n == 2 ? ivec2(0, sgn.y) : sgn);
      vec2 e2 = texelFetch(uTileS, ivec3(inn + off, lyr), 0).rg;
      float u2 = mod(e2.g, 32.0), l2 = floor(e2.g / 32.0);
      if (u2 >= ${ENV_UNBOUNDED}.0 || l2 >= ${ENV_UNBOUNDED}.0 || e2.r < ${RING_MIN_VALID_DEG.toFixed(1)}) { valid = false; return 0.0; }
      hi = max(hi, e2.r + ringEnvDeg(u2)); lo = min(lo, e2.r - ringEnvDeg(l2));
    }
    hc += wk * clamp(bil, lo, hi); hh += wk * hi; hl += wk * lo;
  }
  hzHi = hh / w; hzLo = hl / w;
  return hc / w;
}
`
function shadowCacheRead(patch: boolean, deepest: number, fixedFallback = false, ghSun = false, ringCacheOn = false): string {
  if (fixedFallback) return /* glsl */ `
${ringCacheOn ? '' : FIXED_CACHE_DECL}float horizonSun(vec3 p, vec3 t, float lod, float lodT) {
  if (uShOn > 0.5 && gTileMarch >= 0.999${patch ? ` && (uPatchBlend * uPatchGround <= 0.0 || length(p - uPSite) * R_KM > ${SH_PATCH_CLEAR_KM.toFixed(1)})` : ''}) {
    int lm = min(int(floor(lodT + 0.5)), 2);
    if (lm >= ${deepOf(deepest)}) {
      vec2 uv = uvOf(p);
      bool valid;
      float h = cachedHorizon(lm, uv, valid);
      if (valid) { ${sg('1.0')}return h; }
      // A coarser parent tile is not read: its smoothed horizon is a visibly worse picture than legacy's march (owner rule: never worse than legacy).
      ${sg('6.0')}
    } else { ${sg('6.0')} }
  } else { ${sg('5.0')} }
  // Anything not exact (uncached, building, wrong level, tile march not fully on) takes the same live march legacy uses, so the picture is never worse
  // than legacy while a tile builds; exact tiles skip the march. (The 64x32 coarse map was visibly straight and wrong at the terminator, owner 2026-10-26.)
  return ${ghSun ? 'horizonAtSun' : 'horizonAt'}(p, t, lod, lodT);
}
`
  return /* glsl */ `
uniform highp sampler2DArray uTileS;  // R16F, H_SIZE square per cache layer: horizon (deg) toward the Sun a layer was built for
uniform highp sampler2D uShFade;      // RGBA32F, ${SH_CACHE_PAGE_W} wide, per TILE layer: (cache layer of the newest build, its share, cache layer of the build it replaces, its share)
uniform float uShOn;                  // 0: ?shcache=0, always the live march
float horizonSun(vec3 p, vec3 t, float lod, float lodT) {
  if (uShOn > 0.5 && gTileMarch >= 0.999${patch ? ` && (uPatchBlend * uPatchGround <= 0.0 || length(p - uPSite) * R_KM > ${SH_PATCH_CLEAR_KM.toFixed(1)})` : ''}) {
    int lm = min(int(floor(lodT + 0.5)), 2);
    if (lm >= ${deepOf(deepest)}) {
      Tile tc = tileAt(uvOf(p), lm);
      if (tc.layer >= 0.0 && tc.a >= 0.999) {
        int ly = int(tc.layer + 0.5);
        vec4 f = texelFetch(uShFade, ivec2(ly & ${SH_CACHE_PAGE_W - 1}, ly >> 8), 0);
        float w = f.g + f.a;
        if (w > 0.0) {
          vec2 q = (1.0 + tc.f * TH_PX) / TH_SZ;
          float hc = 0.0;
          if (f.g > 0.0) hc += f.g * textureLod(uTileS, vec3(q, f.r), 0.0).r;
          if (f.a > 0.0) hc += f.a * textureLod(uTileS, vec3(q, f.b), 0.0).r;
          ${sg('w >= 0.999 ? 1.0 : 8.0')}return w >= 0.999 ? hc / w : mix(horizonAt(p, t, lod, lodT), hc / w, w);
        }
      }
    }
  }
  ${sg('8.0')}return horizonAt(p, t, lod, lodT);
}
`
}
const noShadowCache = (ghSun = false): string => /* glsl */ `
float horizonSun(vec3 p, vec3 t, float lod, float lodT) { ${sg('8.0')}return ${ghSun ? 'horizonAtSun' : 'horizonAt'}(p, t, lod, lodT); }
`
export { SH_CACHE_PAGE_W }

/**
 * The cache's build pass: one tile layer per draw (a full-layer viewport), each texel's horizon toward the Sun by the same march the pixel
 * shader runs (tileMarch over the plain tile ground, no site patch), from the texel's own position and height. Texels whose Sun elevation is
 * outside [uShBand.x, uShBand.y] are not marched (the pixel shader skips them as well) and hold -90.
 */
export function shadowCacheFragment(lonSpan: number, mapWidth: number, tileDeepest = 0, envelope = false): string {
  const texelKm = (2 * Math.PI * MOON_R_KM) / mapWidth
  const env = envelope
  return /* glsl */ `
${GLSL_COMMON}
out vec4 fragColor;
${heightGlsl(lonSpan, texelKm)}
uniform vec3 uS;             // Moon to Sun, unit
uniform float uMotion;       // always 0 here: the cache is built with the full-quality march (the tile march's motion stride reads it)
uniform float uMStride;      // read by the shared tile march under uMotion > 0.5 only; never set here (the build is a rest frame)
uniform float uMLite;        // same: the motion march's lite switch
uniform float uShMode;       // same: ShadowCache pins it to 0 in its own uniforms, so the build is always the full march whatever mode the Moon pass shows
float gHzStopDeg = 200.0;    // same: the phone motion march's early exit (200 = never)
${SIN_SMALL_GLSL}
// The old march is never reached (the tile march runs everywhere here); the cache's tile march names it.
float horizonDeg(vec3 p, vec3 t, float h0, float lod0) { return -90.0; }
${tileDecls(tileDeepest)}${tileMarchFn(tileDeepest)}${MARCH_HQ_PLAIN}${tileMarch(false, tileDeepest)}
uniform int uShLevel;        // the tile's level (-4..2)
uniform vec2 uShTile;        // its column and row at that level
uniform vec2 uShBand;        // Sun elevation range (deg) the cache covers
${env ? ringEnvelopeBuildGlsl(deepOf(tileDeepest) !== 0) : ''}void main() {
  gTileMarch = 1.0;
  // The layer's texel centre in tile units, as tileH reads it: (1 + f * H_PX) / H_SIZE; the one-texel border is the neighbours' data.
  vec2 f = (gl_FragCoord.xy - 1.0) / TH_PX;
  float lvs = ${deepOf(tileDeepest) === 0 ? 'float(1 << uShLevel)' : 'lvScale(uShLevel)'};
  vec2 n = vec2(72.0, 36.0) / lvs;
  vec2 uv = (uShTile + f) / n;
  float lon = radians(uv.x * 2.0 * LON_SPAN - LON_SPAN);
  float lat = radians(clamp(90.0 - uv.y * 180.0, -90.0, 90.0));
  vec3 p = normalize(cos(lat) * (cos(lon) * uX + sin(lon) * uY) + sin(lat) * uK);
  float elevS = asin(clamp(dot(p, uS), -1.0, 1.0)) * 180.0 / PI;
  float hz = -90.0;
  float code = ${env ? 'ENV_UNB' : '0.0'};
  if (elevS >= uShBand.x && elevS <= uShBand.y) {
    vec3 ts = uS - p * dot(p, uS);
    if (length(ts) > 1e-4) {
      float lodG = shLodG(uShLevel);
      float h0 = marchHQ(p, uShLevel, lodG, 0.0);
      hz = horizonDegT(p, normalize(ts), h0, uShLevel, lodG);
${env ? `      if (uShLevel == ${ENV_LEVEL}) code = ringEnvelopeCode(p, normalize(ts), tileAt(uv, ${ENV_LEVEL}), hz);` : ''}
    }
  }
  fragColor = vec4(hz, ${env ? 'code' : '0.0'}, 0.0, 1.0);
}
`
}

/**
 * The blend ring's footprint envelope (src/moon/ringEnvelope.ts has the construction and its CPU twin): for the texel at p, the highest and the lowest
 * value the level-2 tile march takes over the whole cell (delta in [-0.5, 0.5]^2 texels). Sample k's height at q + delta and the origin's at p + delta are
 * bilinear on every rectangle bounded by the texel-centre lines of p (delta = 0) and of q (its crossings), so the sample's elevation is extreme at the
 * rectangles' vertices: per axis -0.5, 0, 0.5 and the crossings. A sample on a tile that is not fully present, or on ground whose longitude scale differs
 * too much from p's, leaves the texel unbounded. Returns the stored code u + 32 l (src/moon/ringEnvelope.ts packBounds): hi and lo in steps from the
 * stored (half-float rounded) centre value, rounded outward.
 */
function ringEnvelopeBuildGlsl(deep: boolean, dbg = false): string {
  return /* glsl */ `
float envDegOfCode(float c) { return c <= ${ENV_FINE_N}.0 ? c * ${ENV_STEP_FINE.toFixed(2)} : ${(ENV_FINE_N * ENV_STEP_FINE).toFixed(2)} + (c - ${ENV_FINE_N}.0) * ${ENV_STEP_COARSE.toFixed(2)}; }
float envCodeOfDeg(float deg) {
  if (deg <= 0.0) return 0.0;
  return deg <= ${(ENV_FINE_N * ENV_STEP_FINE).toFixed(2)} ? ceil(deg / ${ENV_STEP_FINE.toFixed(2)} - 1e-5) : min(${ENV_FINE_N}.0 + ceil((deg - ${(ENV_FINE_N * ENV_STEP_FINE).toFixed(2)}) / ${ENV_STEP_COARSE.toFixed(2)} - 1e-5), ${ENV_UNBOUNDED}.0);
}
const float ENV_UNB = ${ENV_UNBOUNDED}.0 + 32.0 * ${ENV_UNBOUNDED}.0;
const int ENV_N = TM_N${deep ? ' + TM_DNEAR' : ''};
float envDist(int k) {
${deep ? `  if (k < TM_DNEAR) return TM_DNEAR0 * pow(TM_STEP / TM_DNEAR0, float(k) / float(TM_DNEAR));
  k -= TM_DNEAR;
` : ''}  return k < TM_LIN ? TM_STEP * float(k + 1) : TM_G0 * pow(TM_MAX / TM_G0, float(k - TM_LIN) / float(TM_GEO - 1));
}
// Sample k's extremes over the cell: false when the texel is unbounded because of it. cen: its elevation at the cell's centre.
bool envSampleSup(vec3 p, vec3 t, Tile tp, float cp, int k, out float mx, out float mn, out float cen) {
  float d = envDist(k);
  float th = d / R_KM;
  float s = sinSmall(th), omc = omcSmall(th);
  vec3 q = normalize(p * (1.0 - omc) + t * s);
  mx = -4.0; mn = 4.0; cen = -4.0;
  vec2 uvq = uvOf(q);
  Tile tq = tileAt(uvq, ${ENV_LEVEL});
  if (tq.layer < 0.0 || tq.a < 0.9999) return false;
  float cq = sqrt(max(1.0 - dot(q, uK) * dot(q, uK), 0.0));
  if (cq < 0.2) return false;
  float sx = cp / cq;
  if (sx > 1.2) return false;
  // A tile beside the one under q that is not fully present (the 4k map under it) is a different height field inside the cell's reach: the corners of the cell on q's side must all be on present tiles.
  vec2 du = vec2(0.5 * sx, 0.5) / (TH_PX * vec2(72.0, 36.0) / float(1 << ${ENV_LEVEL}));
  for (int c = 0; c < 4; c++) {
    vec2 uc = uvq + du * vec2((c & 1) == 0 ? -1.0 : 1.0, (c & 2) == 0 ? -1.0 : 1.0);
    Tile tc = tileAt(vec2(fract(uc.x), clamp(uc.y, 0.0, 1.0)), ${ENV_LEVEL});
    if (tc.layer < 0.0 || tc.a < 0.9999) return false;
  }
  vec2 sq = 0.5 + tq.f * TH_PX;
  float ax[7]; float ay[7];
  int nx = 3, ny = 3;
  ax[0] = -0.5; ax[1] = 0.0; ax[2] = 0.5; ay[0] = -0.5; ay[1] = 0.0; ay[2] = 0.5;
  int x0 = int(ceil(sq.x - 0.5 * sx)), x1 = int(floor(sq.x + 0.5 * sx));
  for (int n = x0; n <= x1; n++) { float a = (float(n) - sq.x) / sx; if (a > -0.5 && a < 0.5 && abs(a) > 1e-4 && nx < 7) { ax[nx] = a; nx++; } }
  int y0 = int(ceil(sq.y - 0.5)), y1 = int(floor(sq.y + 0.5));
  for (int n = y0; n <= y1; n++) { float a = float(n) - sq.y; if (a > -0.5 && a < 0.5 && abs(a) > 1e-4 && ny < 7) { ay[ny] = a; ny++; } }
  // The tile seam under the cell: heights beyond it come from the NEXT tile's own data (its border may not equal them), so the seam's two sides are vertices too.
  vec2 fpx = tq.f * TH_PX;
  float sm[4];
  sm[0] = -fpx.x / sx; sm[1] = (TH_PX - fpx.x) / sx; sm[2] = -fpx.y; sm[3] = TH_PX - fpx.y;
  for (int m = 0; m < 4; m++) {
    for (int sd = 0; sd < 2; sd++) {
      float a = sm[m] + (sd == 0 ? -0.002 : 0.002);
      if (a > -0.5 && a < 0.5) {
        if (m < 2) { if (nx < 7) { ax[nx] = a; nx++; } } else { if (ny < 7) { ay[ny] = a; ny++; } }
      }
    }
  }
  vec2 duTex = vec2(1.0) / (TH_PX * vec2(72.0, 36.0) / float(1 << ${ENV_LEVEL}));
  float qLo = 1.0e9, qHi = -1.0e9, oLo = 1.0e9, oHi = -1.0e9;
  for (int j = 0; j < 7; j++) {
    if (j >= ny) break;
    for (int i = 0; i < 7; i++) {
      if (i >= nx) break;
      float h0 = tileH(tp, vec2(ax[i], ay[j]) / TH_PX);
      vec2 oq = vec2(ax[i] * sx, ay[j]);
      vec2 fq = tq.f + oq / TH_PX;
      float hq;
      if (fq.x >= 0.0 && fq.x <= 1.0 && fq.y >= 0.0 && fq.y <= 1.0) hq = tileH(tq, oq / TH_PX);
      else { Tile t2 = tileAt(vec2(fract(uvq.x + oq.x * duTex.x), clamp(uvq.y + oq.y * duTex.y, 0.0, 1.0)), ${ENV_LEVEL}); hq = t2.layer >= 0.0 ? tileH(t2, vec2(0.0)) : tileH(tq, oq / TH_PX); }
      qLo = min(qLo, hq); qHi = max(qHi, hq); oLo = min(oLo, h0); oHi = max(oHi, h0);
      float rq = R_KM + hq * 0.001;
      float ang = atan((hq - h0) * 0.001 - rq * omc, rq * s);
      mx = max(mx, ang); mn = min(mn, ang);
      if (i == 1 && j == 1) cen = ang;
    }
  }
  // The GPU filter's 8-bit weights: a height read is off by up to the cell's spread / 256 and a near sample's elevation is rise over a short run (ringEnvelope.ts filterSlackRad).
  float eps = ${qNum('shenvfilter', 1, 30).toFixed(2)} * 2.0 * max(qHi - qLo, oHi - oLo) / ${FILTER_STEPS}.0 / (d * 1000.0);
  mx += eps; mn -= eps;
  return true;
}
float ringEnvelopeCode(vec3 p, vec3 t, Tile tp, float hz) {
  if (tp.layer < 0.0 || tp.a < 0.9999) return ENV_UNB;
  float cp = sqrt(max(1.0 - dot(p, uK) * dot(p, uK), 0.0));
  float hi = -0.5 * PI, lo = -0.5 * PI, mainC = -0.5 * PI;
  for (int k = 0; k < ENV_N; k++) {
    float mx, mn, cen;
    if (!envSampleSup(p, t, tp, cp, k, mx, mn, cen)) return ENV_UNB;
    hi = max(hi, mx); lo = max(lo, mn); mainC = max(mainC, cen);
  }
  float stored = unpackHalf2x16(packHalf2x16(vec2(hz, 0.0))).x;
${deep ? `  // The crest refinement's extra samples are covered by a pad (ringEnvelope.ts REFINE_PAD_*): its base plus K x the refinement's own gain at the centre.
  float refPad = ${qNum('shenvpad', REFINE_PAD_BASE_DEG, 30).toFixed(2)} + ${qNum('shenvk', REFINE_PAD_K, 30).toFixed(2)} * max(0.0, hz - mainC * 180.0 / PI);
` : `  float refPad = 0.0;
`}  float u = envCodeOfDeg(hi * 180.0 / PI + ${qNum('shenvslack', ENV_SLACK_DEG, 30).toFixed(2)} + refPad - stored);
  float l = envCodeOfDeg(stored - (lo * 180.0 / PI - ${qNum('shenvslack', ENV_SLACK_DEG, 30).toFixed(2)}));
  if (u >= ${ENV_UNBOUNDED}.0 || l >= ${ENV_UNBOUNDED}.0) return ENV_UNB;
  return u + 32.0 * l;
}
${dbg ? `// DIAGNOSTIC (?shadowdebug=ringdiff, dbg 31): the sample at which the live march from the pixel (p, t) exceeds the vertex bound of the cell centred at pc, and by how much (deg); kw -2: the texel is unbounded.
void envDbgWorst(vec3 pc, vec3 tcn, Tile tpc, vec3 p, vec3 t, float lodG, out float kw, out float exc) {
  kw = -1.0; exc = -90.0;
  if (tpc.layer < 0.0 || tpc.a < 0.9999) { kw = -2.0; return; }
  float cp = sqrt(max(1.0 - dot(pc, uK) * dot(pc, uK), 0.0));
  float h0 = marchHQ(p, ${ENV_LEVEL}, lodG, 0.0);
  for (int k = 0; k < ENV_N; k++) {
    float mx, mn, cen;
    if (!envSampleSup(pc, tcn, tpc, cp, k, mx, mn, cen)) { kw = -2.0; return; }
    float d = envDist(k);
    float th = d / R_KM;
    float s = sinSmall(th), omc = omcSmall(th);
    vec3 q = normalize(p * (1.0 - omc) + t * s);
    float hq = marchHQ(q, ${ENV_LEVEL}, lodG, 0.0);
    float rq = R_KM + hq * 0.001;
    float e = (atan((hq - h0) * 0.001 - rq * omc, rq * s) - mx) * 180.0 / PI;
    if (e > exc) { exc = e; kw = float(k); }
  }
}
// DIAGNOSTIC (dbg 30): the live main + near samples from the pixel without the crest refinement, deg.
float envDbgNoRef(vec3 p, vec3 t, float lodG) {
  float h0 = marchHQ(p, ${ENV_LEVEL}, lodG, 0.0);
  float best = -0.5 * PI;
  for (int k = 0; k < ENV_N; k++) {
    float d = envDist(k);
    float th = d / R_KM;
    float s = sinSmall(th), omc = omcSmall(th);
    vec3 q = normalize(p * (1.0 - omc) + t * s);
    float hq = marchHQ(q, ${ENV_LEVEL}, lodG, 0.0);
    float rq = R_KM + hq * 0.001;
    best = max(best, atan((hq - h0) * 0.001 - rq * omc, rq * s));
  }
  return best * 180.0 / PI;
}
// DIAGNOSTIC (dbg 32): at the pixel's own offset inside the cell, the model's heights (tileH at the cell's centre march, offset by the pixel's offset, the sample's offset scaled by the longitude ratio)
// against the live march's (marchHQ at the pixel's origin and at its sample k): metres.
void envDbgModel(vec3 pc, vec3 tcn, Tile tpc, vec3 p, vec3 t, vec2 uvp, int k, float lodG, out float dh0, out float dhq, out vec2 aOut) {
  Tile tp = tileAt(uvp, ${ENV_LEVEL});
  vec2 xp = 1.0 + tp.f * TH_PX;
  vec2 a = xp - (floor(xp) + 0.5);
  aOut = a;
  float d = envDist(k);
  float th = d / R_KM;
  float s = sinSmall(th), omc = omcSmall(th);
  vec3 qc = normalize(pc * (1.0 - omc) + tcn * s);
  Tile tq = tileAt(uvOf(qc), ${ENV_LEVEL});
  float cp = sqrt(max(1.0 - dot(pc, uK) * dot(pc, uK), 0.0));
  float cq = sqrt(max(1.0 - dot(qc, uK) * dot(qc, uK), 0.0));
  float sx = cp / cq;
  float h0m = tileH(tpc, a / TH_PX);
  float hqm = tileH(tq, vec2(a.x * sx, a.y) / TH_PX);
  vec3 ql = normalize(p * (1.0 - omc) + t * s);
  dh0 = h0m - marchHQ(p, ${ENV_LEVEL}, lodG, 0.0);
  dhq = hqm - marchHQ(ql, ${ENV_LEVEL}, lodG, 0.0);
}
` : ''}`
}

/**
 * The per-tile horizon envelope's build pass (src/moon/globalHorizon.ts, tiles/TileEnvelope.ts; fixed policy): one block of rows of one tile layer per draw (scissored),
 * each cell of the TENV_N x TENV_N layer = the highest horizon of the very tile march the pixel shader runs (horizonDegT at the tile's level, from marchHQ heights, the
 * neighbours and then the 4k map beyond) over TENV_AZ azimuths and the cell's TENV_POINTS, plus a margin, as a byte code (ENV_OFF_DEG + (c - 1) * ENV_Q_DEG; 255 = no bound).
 * No Sun is read: the result is Sun-independent.
 */
export function tileEnvelopeFragment(lonSpan: number, mapWidth: number, tileDeepest = 0, cfg: TenvConfig = typeof location === 'undefined' ? TENV_DEFAULT : tenvConfig(location.search)): string {
  const texelKm = (2 * Math.PI * MOON_R_KM) / mapWidth
  const pts = cfg.points.map(([x, y]) => `vec2(${x.toFixed(3)}, ${y.toFixed(3)})`).join(', ')
  return /* glsl */ `
${GLSL_COMMON}
out uvec4 fragColor;
${heightGlsl(lonSpan, texelKm)}
uniform float uMotion;       // always 0 here: the build is a rest frame with the full march
uniform float uMStride;
uniform float uMLite;
uniform float uShMode;       // pinned to 0 by TileEnvelope
float gHzStopDeg = ${TENV_STOP_DEG.toFixed(1)};   // a skyline above this (deg) is unbounded here: the Sun skip needs elevS - bound > the certificate (> 2.3), and the march runs below 38 deg of Sun elevation
${SIN_SMALL_GLSL}
// The old march is never reached (the tile march runs everywhere here); the tile march names it.
float horizonDeg(vec3 p, vec3 t, float h0, float lod0) { return -90.0; }
${tileDecls(tileDeepest)}${tileMarchFn(tileDeepest)}${MARCH_HQ_PLAIN}${tileMarch(false, tileDeepest)}
uniform int uTenvLevel;      // the tile's level (-4..2)
uniform vec2 uTenvTile;      // its column and row at that level
uniform float uTenvN;        // the layer's side in cells
uniform float uTenvClear;    // 1: write "no bound" (code 0) over the layer
void main() {
  if (uTenvClear > 0.5) { fragColor = uvec4(0u); return; }
  gTileMarch = 1.0;
  float lvs = ${deepOf(tileDeepest) === 0 ? 'float(1 << uTenvLevel)' : 'lvScale(uTenvLevel)'};
  vec2 n = vec2(72.0, 36.0) / lvs;
  float lodG = shLodG(uTenvLevel);
  vec2 offs[${cfg.points.length}] = vec2[${cfg.points.length}](${pts});
  float azMax[${cfg.az}];
  for (int a = 0; a < ${cfg.az}; a++) azMax[a] = -90.0;
  for (int k = 0; k < ${cfg.points.length}; k++) {
    vec2 f = (gl_FragCoord.xy + offs[k]) / uTenvN;
    vec2 uv = (uTenvTile + f) / n;
    float lon = radians(uv.x * 2.0 * LON_SPAN - LON_SPAN);
    float lat = radians(clamp(90.0 - uv.y * 180.0, -90.0, 90.0));
    vec3 p = normalize(cos(lat) * (cos(lon) * uX + sin(lon) * uY) + sin(lat) * uK);
    float h0 = marchHQ(p, uTenvLevel, lodG, 0.0);
    vec3 e = normalize(cross(uK, p) + 1e-6);
    vec3 nn = cross(p, e);
    for (int a = 0; a < ${cfg.az}; a++) {
      float ang = float(a) * 6.2831853 / ${cfg.az.toFixed(1)};
      azMax[a] = max(azMax[a], horizonDegT(p, cos(ang) * e + sin(ang) * nn, h0, uTenvLevel, lodG));
    }
  }
  // Eight azimuth sectors: each takes every sampled azimuth within the pad of its edges; one byte each (ENV_OFF_DEG + (c - 1) * ENV_Q_DEG; 255 = no bound).
  uint codes[${ENV_SECTORS}];
  for (int s = 0; s < ${ENV_SECTORS}; s++) {
    float centre = (float(s) + 0.5) * ${ENV_SECTOR_DEG.toFixed(1)};
    float m = -90.0;
    for (int a = 0; a < ${cfg.az}; a++) {
      float d = abs(mod(float(a) * 360.0 / ${cfg.az.toFixed(1)} - centre + 540.0, 360.0) - 180.0);
      if (d <= ${(ENV_SECTOR_DEG / 2 + ENV_SECTOR_PAD_DEG).toFixed(3)} + 1.0e-4) m = max(m, azMax[a]);
    }
    codes[s] = uint(m > gHzStopDeg ? 255.0 : clamp(ceil((m + ${cfg.margin.toFixed(3)} - (${ENV_OFF_DEG.toFixed(1)})) / ${ENV_Q_DEG.toFixed(3)}) + 1.0, 1.0, 255.0));
  }
  fragColor = uvec4(codes[0] | (codes[1] << 8u) | (codes[2] << 16u) | (codes[3] << 24u), codes[4] | (codes[5] << 8u) | (codes[6] << 16u) | (codes[7] << 24u), 0u, 0u);
}
`
}

/**
 * The patch shadow cache's read (PatchShadowCache.ts): the horizon toward the Sun at a fused-ground patch's own texels, in the patch frame (metres east and
 * north), one atlas of R16F texels. horizonSun reads it where the finest fully weighted height level has a cache layer and all four bilinear taps are built,
 * and marches live otherwise (a level without a layer, the fade ring at a level's edge, ground the patch does not cover, a tap not yet built).
 */
function patchShadowRead(layout: PatchLayout, deepest: number): string {
  const hs = layout.map((l, i) => (l.h ? i : -1)).filter((i) => i >= 0)
  const cached = hs.filter((i) => layout[i].cache)
  const firstCached = cached.length ? cached[0] : hs.length
  // A level finer than the first cached one that is not cached (the 25 cm tier) has no layer: wherever it has weight the march is live.
  const uncachedFiner = hs.filter((i) => !layout[i].cache && i > firstCached)
  const lm = deepOf(deepest)
  const w = (i: number): string => `pw${i}`
  return /* glsl */ `
float gPshHit = -1.0;           // debug (?dbg=12): -1 no Sun horizon read, 0 the live march served it, 1 the patch shadow cache did
uniform highp sampler2D uPSC;   // R16F atlas: horizon (deg) toward the Sun per cache texel; -100 where not built
uniform float uPShOn;           // 0: the live march everywhere (no layer built, or ?pshcache=0)
${cached.map((i) => `uniform vec4 uPCo${i};            // level ${i}: atlas x, y of its layer, and its width, height in cache texels\nuniform float uPCk${i};           // level texels per cache texel`).join('\n')}
uniform vec4 uPCoB;             // the base layer (a square around the site over the composite ground): atlas x, y, width, height in cache texels
uniform float uPCkB;            // base texels (${PSH_BASE_TEXEL_M} m) per cache texel
// Bilinear read at q (level texels), or -1000 when any of the four taps is not built.
float pshAt(vec4 o, float k, vec2 q) {
  vec2 c = q / k - 0.5;
  vec2 fl = floor(c);
  vec2 fr = c - fl;
  ivec2 hi = ivec2(o.zw) - 1;
  ivec2 b0 = clamp(ivec2(fl), ivec2(0), hi);
  ivec2 b1 = clamp(ivec2(fl) + 1, ivec2(0), hi);
  ivec2 oo = ivec2(o.xy);
  float a = texelFetch(uPSC, oo + b0, 0).r;
  float b = texelFetch(uPSC, oo + ivec2(b1.x, b0.y), 0).r;
  float c2 = texelFetch(uPSC, oo + ivec2(b0.x, b1.y), 0).r;
  float d = texelFetch(uPSC, oo + b1, 0).r;
  if (min(min(a, b), min(c2, d)) < -95.0) return -1000.0;
  return mix(mix(a, b, fr.x), mix(c2, d, fr.x), fr.y);
}
float horizonSun(vec3 p, vec3 t, float lod, float lodT) {
  gPshHit = 0.0;
  if (uPShOn > 0.5 && gTileMarch >= 0.999 && uPatchBlend * uPatchGround >= 0.999 && int(floor(lodT + 0.5)) <= ${lm + PSH_LM_SLACK}) {
    vec2 mEN = patchEN(p);
${hs.map((i) => `    vec2 pq${i} = patchQ(uPG${i}, uPA${i}, mEN);\n    float ${w(i)} = patchEdge(pq${i}, uPS${i}, uPG${i}, ${layout[i].fadeM.toFixed(1)}) * uPatchBlend * uPatchGround;`).join('\n')}
    int s = -1;
${[...cached].reverse().map((i) => `    if (s < 0 && ${w(i)} >= 0.999) s = ${i};`).join('\n')}
    bool ok = true;
    float v = 0.0;
${uncachedFiner.map((i) => `    if (${w(i)} > 0.0) ok = false;`).join('\n')}
${cached.map((i) => `    if (s == ${i}) v = pshAt(uPCo${i}, uPCk${i}, pq${i});`).join('\n')}
    if (s < 0) {
      // No cached level is fully weighted here: the base layer, in metres east / north of the site.
      vec2 qb = vec2(mEN.x + ${PSH_BASE_HALF_M.toFixed(1)}, ${PSH_BASE_HALF_M.toFixed(1)} - mEN.y) / ${PSH_BASE_TEXEL_M.toFixed(1)};
      if (qb.x >= 0.0 && qb.y >= 0.0 && qb.x < uPCoB.z * uPCkB && qb.y < uPCoB.w * uPCkB) v = pshAt(uPCoB, uPCkB, qb);
      else ok = false;
    }
    if (v < -95.0) ok = false;
${cached.map((i) => `    if (ok && ${i} > s && ${w(i)} > 0.0) { float cv = pshAt(uPCo${i}, uPCk${i}, pq${i}); if (cv < -95.0) ok = false; else v = mix(v, cv, ${w(i)}); }`).join('\n')}
    if (ok) { gPshHit = 1.0; ${sg('7.0')}return min(v, gHzStopDeg); }
  }
  ${sg('8.0')}return horizonAt(p, t, lod, lodT);
}
`
}

/**
 * The patch cache's build pass: one block of one level's layer per draw (scissored in the atlas). Each texel is the horizon toward the Sun, by the same march
 * the pixel shader runs (tile march over the fused patch ground, marchHQ with a zero footprint), from the ground point at the texel's centre in the patch
 * frame (metres east and north of the site, the same quantities patchEN returns). Texels whose Sun elevation is outside uPShBand are not marched and hold -90.
 */
export function patchShadowBuildFragment(layout: PatchLayout, lonSpan: number, mapWidth: number, tileDeepest = 0): string {
  const texelKm = (2 * Math.PI * MOON_R_KM) / mapWidth
  const lm = deepOf(tileDeepest)
  return /* glsl */ `
${GLSL_COMMON}
out vec4 fragColor;
${heightGlsl(lonSpan, texelKm)}
uniform vec3 uS;             // Moon to Sun, unit
uniform float uMotion;       // always 0 here: the cache is built with the full-quality march
uniform float uMStride;
uniform float uMLite;
uniform float uShMode;       // pinned to 0 by PatchShadowCache: the build is always the full march
float gHzStopDeg = 200.0;
${SIN_SMALL_GLSL}
float horizonDeg(vec3 p, vec3 t, float h0, float lod0) { return -90.0; }
${tileDecls(tileDeepest)}${tileMarchFn(tileDeepest)}${patchDecls(layout)}${MARCH_HQ_PATCH}${tileMarch(true, tileDeepest)}
uniform vec4 uPShOrg;        // the layer: atlas x, y and width, height in cache texels
uniform vec4 uPShG;          // the level's grid: left edge east (m), top edge north (m), texel east (m), texel north (m)
uniform float uPShK;         // level texels per cache texel
uniform float uPShClear;     // 1: write the "not built" value
uniform vec2 uPShBand;       // Sun elevation range (deg) the cache covers
void main() {
  if (uPShClear > 0.5) { fragColor = vec4(-100.0, 0.0, 0.0, 1.0); return; }
  gTileMarch = 1.0;
  vec2 c = gl_FragCoord.xy - uPShOrg.xy;
  vec2 q = c * uPShK;                           // level texels, the cache texel's centre is (c) * k with c already at +0.5
  float e = uPShG.x + q.x * uPShG.z;
  float n = uPShG.y - q.y * uPShG.w;
  vec3 sb = uPSite * sqrt(max(0.0, 1.0 - (e * e + n * n) / (PR_M * PR_M))) + uPEast * (e / PR_M) + uPNorth * (n / PR_M);
  vec3 p = normalize(sb.x * uX + sb.y * uY + sb.z * uK);
  float elevS = asin(clamp(dot(p, uS), -1.0, 1.0)) * 180.0 / PI;
  float hz = -90.0;
  if (elevS >= uPShBand.x && elevS <= uPShBand.y) {
    vec3 ts = uS - p * dot(p, uS);
    if (length(ts) > 1e-4) {
      float lodG = shLodG(${lm});
      float h0 = marchHQ(p, ${lm}, lodG, 0.0);
      hz = horizonDegT(p, normalize(ts), h0, ${lm}, lodG);
    }
  }
  fragColor = vec4(hz, 0.0, 0.0, 1.0);
}
`
}
const NO_TILE_MARCH = /* glsl */ `
float horizonAt(vec3 p, vec3 t, float lod, float lodT) {
  return horizonDeg(p, t, heightAt(uvOf(p), lod), lod);
}
`
/** The same with the global-map horizon cache (fixed policy). */
const NO_TILE_MARCH_GH = /* glsl */ `
float horizonAt(vec3 p, vec3 t, float lod, float lodT) {
  return horizonDeg(p, t, heightAt(uvOf(p), lod), lod);
}
float horizonAtSun(vec3 p, vec3 t, float lod, float lodT) {
  return ghOldHorizon(p, t, uvOf(p), lod);
}
`

/**
 * Pass 2: the shading. `extraGlsl` is pasted above main() for the
 * integrator (the eclipse GLSL); `lonSpan` is the maps' longitude span each
 * side of 0 (180 for the whole globe, which wraps), `mapWidth` the height
 * map's width in texels.
 */
/** The old (4k-map only) horizon march's constants and function, shared by the Moon pass and the global-map horizon cache's build pass (the cache must run the very same march). */
const HORIZON_STEPS_GLSL = /* glsl */ `// Horizon march: 32 geometric steps from 1.5 to 300 km.
const int STEPS = 32;
const float D0 = 1.5;
const float DMAX = 300.0;
`
const HORIZON_DEG_GLSL = /* glsl */ `// Elevation (deg) of the skyline seen from the surface at p, looking along
// the tangent t: march out along the great circle, 1.5 to 300 km, reading
// coarser mips for farther samples. Rise over run, so no two 1737 km
// quantities are subtracted (their difference loses the metre-scale rise in
// float32): the rise is the height difference less the curvature drop, the
// run the distance along the ground. The march crosses the poles and
// longitude 180 like anywhere else.
float horizonDeg(vec3 p, vec3 t, float h0, float lod0) {
  float best = -0.5 * PI;
  for (int k = 0; k < STEPS; k++) {
    float d = D0 * pow(DMAX / D0, float(k) / float(STEPS - 1));
    float th = d / R_KM;
    float s = sinSmall(th), omc = omcSmall(th);
    vec3 q = normalize(p * (1.0 - omc) + t * s);
    float lod = max(lod0, log2(max(1.0, 0.19 * d / TEXEL_KM)));
    float hq = heightAt(uvOf(q), lod);
    float rq = R_KM + hq * 0.001;
    best = max(best, atan((hq - h0) * 0.001 - rq * omc, rq * s));
  }
  return best * 180.0 / PI;
}`

/**
 * The horizon envelope's build pass (src/moon/globalHorizon.ts, tiles/GlobalHorizonCache.ts; fixed shadow policy only). Mode 0: one envelope texel (a block of them per
 * draw) = the highest horizon of the very old march the Moon pass runs (HORIZON_DEG_GLSL) over 8 azimuths, lods 0, 2, 4, 6 and the cell's centre and four corners,
 * plus a margin, as a byte code. Mode 1: the 3x3 maximum of the raw codes (any unbuilt neighbour leaves it unbuilt). Positions and axes are the Moon pass's (world frame).
 */
export function globalHorizonFragment(lonSpan: number, mapWidth: number, az: number = ENV_SECTOR_AZ, grid: number = ENV_FINE_GRID): string {
  const texelKm = (2 * Math.PI * MOON_R_KM) / mapWidth
  return /* glsl */ `
${GLSL_COMMON}
out uvec4 fragColor;
${heightGlsl(lonSpan, texelKm)}
${SIN_SMALL_GLSL}
${HORIZON_STEPS_GLSL}
${HORIZON_DEG_GLSL}
uniform float uGhMode;       // 0: raw envelope codes, 1: dilate uEnvRaw
uniform vec2 uEnvSize;       // the envelope texture's size in texels
uniform highp usampler2D uEnvRaw;
vec3 ghDirOf(vec2 uv) {
  float lon = radians(uv.x * 2.0 * LON_SPAN - LON_SPAN);
  float lat = radians(clamp(90.0 - uv.y * 180.0, -90.0, 90.0));
  return normalize(cos(lat) * (cos(lon) * uX + sin(lon) * uY) + sin(lat) * uK);
}
uvec2 ghFetch(ivec2 i, ivec2 sz) {
  i.x = i.x < 0 ? i.x + sz.x : (i.x >= sz.x ? i.x - sz.x : i.x);
  i.y = clamp(i.y, 0, sz.y - 1);
  return texelFetch(uEnvRaw, i, 0).rg;
}
uint ghByte(uvec2 v, int s) { uint w = s < 4 ? v.x : v.y; return (w >> uint(8 * (s & 3))) & 255u; }
uvec4 ghPack(uint c[${ENV_SECTORS}]) {
  return uvec4(c[0] | (c[1] << 8u) | (c[2] << 16u) | (c[3] << 24u), c[4] | (c[5] << 8u) | (c[6] << 16u) | (c[7] << 24u), 0u, 0u);
}
void main() {
  ivec2 tx = ivec2(floor(gl_FragCoord.xy));
  if (uGhMode > 0.5) {
    ivec2 sz = ivec2(uEnvSize);
    uint m[${ENV_SECTORS}];
    for (int s = 0; s < ${ENV_SECTORS}; s++) m[s] = 0u;
    bool unbuilt = false;
    for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
      uvec2 v = ghFetch(tx + ivec2(dx, dy), sz);
      if (ghByte(v, 0) == 0u) unbuilt = true;
      for (int s = 0; s < ${ENV_SECTORS}; s++) m[s] = max(m[s], ghByte(v, s));
    }
    if (unbuilt) { fragColor = uvec4(0u); return; }
    fragColor = ghPack(m);
    return;
  }
  float lods[4] = float[4](${ENV_LODS.map((l) => l.toFixed(1)).join(', ')});
  float azMax[${az}];
  for (int a = 0; a < ${az}; a++) azMax[a] = -90.0;
${[[envSectorGrid(grid), 0, ENV_FINE_LODS], [ENV_SECTOR_POINTS, ENV_FINE_LODS, ENV_LODS.length]].map(([pts, l0, l1]) => `  {
    vec2 offs[${(pts as ReadonlyArray<unknown>).length}] = vec2[${(pts as ReadonlyArray<unknown>).length}](${(pts as ReadonlyArray<readonly [number, number]>).map(([x, y]) => `vec2(${x.toFixed(3)}, ${y.toFixed(3)})`).join(', ')});
    for (int k = 0; k < ${(pts as ReadonlyArray<unknown>).length}; k++) {
      vec2 uv = vec2((float(tx.x) + 0.5 + offs[k].x) / uEnvSize.x, clamp((float(tx.y) + 0.5 + offs[k].y) / uEnvSize.y, 0.25 / uEnvSize.y, 1.0 - 0.25 / uEnvSize.y) /* off the exact pole: its frame (cross(K, p) = 0) is numeric noise */);
      vec3 p = ghDirOf(uv);
      vec3 e = normalize(cross(uK, p) + 1e-6);
      vec3 n = cross(p, e);
      for (int a = 0; a < ${az}; a++) {
        float ang = float(a) * 6.2831853 / ${az.toFixed(1)};
        vec3 t = cos(ang) * e + sin(ang) * n;
        for (int d = ${l0}; d < ${l1}; d++) azMax[a] = max(azMax[a], horizonDeg(p, t, heightAt(uvOf(p), lods[d]), lods[d]));
      }
    }
  }`).join('\n')}
  uint codes[${ENV_SECTORS}];
  for (int s = 0; s < ${ENV_SECTORS}; s++) {
    float centre = (float(s) + 0.5) * ${ENV_SECTOR_DEG.toFixed(1)};
    float m = -90.0;
    for (int a = 0; a < ${az}; a++) {
      float d = abs(mod(float(a) * 360.0 / ${az.toFixed(1)} - centre + 540.0, 360.0) - 180.0);
      if (d <= ${(ENV_SECTOR_DEG / 2 + ENV_SECTOR_PAD_DEG).toFixed(3)} + 1.0e-4) m = max(m, azMax[a]);
    }
    codes[s] = uint(clamp(ceil((m + ${ENV_MARGIN_DEG.toFixed(3)} - (${ENV_OFF_DEG.toFixed(1)})) / ${ENV_Q_DEG.toFixed(3)}) + 1.0, 1.0, 255.0));
  }
  fragColor = ghPack(codes);
}
`
}

/** The Sun-keyed 4k bake is attached to the fixed policy's shader unless `?sunbake=0` (read at shader-build time). */
function sunBakeEnabled(): boolean { try { return sunBakeOn(location.search) } catch { return true } }

/**
 * The Sun-keyed 4k horizon bake's build pass (src/moon/sunHorizon.ts, tiles/SunHorizonBake.ts; fixed shadow policy only). One output texel = one cell of one lod bin (bins stacked
 * vertically: row = bin * cellsH + y): the lowest and highest horizon (the very march the Moon pass runs, HORIZON_DEG_GLSL) toward uS from a g x g grid of positions over the cell and the
 * bin's lods (both edges and the middle), widened by uSbMargin, as two byte codes (lo rounded down, hi rounded up; 0 unbuilt, lo 1 = no lower bound, hi 255 = no upper bound).
 */
export function sunBakeFragment(lonSpan: number, mapWidth: number, grid: number = SB_GRID): string {
  const texelKm = (2 * Math.PI * MOON_R_KM) / mapWidth
  const edges = SB_BIN_EDGES.map((e) => e.toFixed(2)).join(', ')
  const off = `(${SB_OFF_DEG.toFixed(1)})`
  return /* glsl */ `
${GLSL_COMMON}
out vec4 fragColor;
${heightGlsl(lonSpan, texelKm)}
${SIN_SMALL_GLSL}
${HORIZON_STEPS_GLSL}
${HORIZON_DEG_GLSL}
uniform vec3 uS;             // Moon to Sun, unit (the Moon pass's own)
uniform vec2 uSbSize;        // the cells' size (w, h) of ONE bin; the texture is ${SB_BINS} bins tall
uniform float uSbMargin;     // deg added to both sides of the sampled range
vec3 sbDirOf(vec2 uv) {
  float lon = radians(uv.x * 2.0 * LON_SPAN - LON_SPAN);
  float lat = radians(clamp(90.0 - uv.y * 180.0, -90.0, 90.0));
  return normalize(cos(lat) * (cos(lon) * uX + sin(lon) * uY) + sin(lat) * uK);
}
void main() {
  ivec2 px = ivec2(floor(gl_FragCoord.xy));
  int cellsH = int(uSbSize.y + 0.5);
  int bin = min(px.y / cellsH, ${SB_BINS - 1});
  ivec2 tx = ivec2(px.x, px.y - bin * cellsH);
  float edges[${SB_BINS + 1}] = float[${SB_BINS + 1}](${edges});
  float e0 = edges[bin], e1 = edges[bin + 1];
  float lods[3] = float[3](e0, 0.5 * (e0 + e1), e1);
  float lo = 1.0e4, hi = -1.0e4;
  bool noAz = false;
  for (int k = 0; k < ${grid * grid}; k++) {
    float fx = ${grid > 1 ? `-0.5 + float(k % ${grid}) / ${(grid - 1).toFixed(1)}` : '0.0'};
    float fy = ${grid > 1 ? `-0.5 + float(k / ${grid}) / ${(grid - 1).toFixed(1)}` : '0.0'};
    vec2 uv = vec2((float(tx.x) + 0.5 + fx) / uSbSize.x, clamp((float(tx.y) + 0.5 + fy) / uSbSize.y, 0.25 / uSbSize.y, 1.0 - 0.25 / uSbSize.y) /* off the exact pole */);
    vec3 p = sbDirOf(uv);
    vec3 ts = uS - p * dot(p, uS);
    if (length(ts) < 1.0e-4) { noAz = true; continue; }
    vec3 t = normalize(ts);
    for (int l = 0; l < 3; l++) {
      float h = horizonDeg(p, t, heightAt(uvOf(p), lods[l]), lods[l]);
      lo = min(lo, h); hi = max(hi, h);
    }
  }
  float cLo = 1.0, cHi = 255.0;
  if (!noAz) {
    float vLo = lo - uSbMargin, vHi = hi + uSbMargin;
    cLo = vLo < ${off} ? 1.0 : min(254.0, floor((vLo - ${off}) / ${SB_Q_DEG.toFixed(3)}) + 2.0);
    float cH = ceil((vHi - ${off}) / ${SB_Q_DEG.toFixed(3)}) + 2.0;
    cHi = cH > 254.0 ? 255.0 : max(2.0, cH);
  }
  fragColor = vec4(cLo / 255.0, cHi / 255.0, 0.0, 1.0);
}
`
}

/**
 * The Moon pass's read of the Sun-keyed 4k bake. `sbRead` gives the [lo, hi] horizon range toward the baked Sun for the cell under uvp and the bin of the pixel's footprint lod (false: off, unbuilt,
 * or a footprint coarser than the last bin: the envelope and the live march decide). A pixel whose Sun elevation clears hi by more than the certificate is fully lit, one whose lo clears the Sun
 * is fully shadowed; hi / lo are returned in place of the march (the saturated ramp does not see the difference; the certificate keeps the quad's ramp width as legacy computes it).
 */
function sunBakeRead(): string {
  const off = `(${SB_OFF_DEG.toFixed(1)})`
  return /* glsl */ `
uniform highp sampler2D uSunBake;  // RG8, ${SB_BINS} lod bins stacked vertically: lo / hi horizon codes toward the baked Sun, 0 where unbuilt (tiles/SunHorizonBake.ts)
uniform float uSbOn;         // 0: no bake yet, or the Sun moved since
bool sbRead(vec2 uvp, float lod, out float lo, out float hi) {
  lo = -1.0e4; hi = 1.0e4;
  if (uSbOn < 0.5 || !(lod <= ${SB_BIN_EDGES[SB_BINS].toFixed(1)})) return false;
  int bin = lod <= ${SB_BIN_EDGES[1].toFixed(1)} ? 0 : (lod <= ${SB_BIN_EDGES[2].toFixed(1)} ? 1 : (lod <= ${SB_BIN_EDGES[3].toFixed(1)} ? 2 : 3));
  ivec2 sz = textureSize(uSunBake, 0);
  int ch = sz.y / ${SB_BINS};
  ivec2 i = ivec2(floor(uvp.x * float(sz.x)), floor(uvp.y * float(ch)));
  i.x = i.x >= sz.x ? i.x - sz.x : max(i.x, 0);
  i.y = clamp(i.y, 0, ch - 1);
  vec2 c = floor(texelFetch(uSunBake, ivec2(i.x, i.y + bin * ch), 0).rg * 255.0 + 0.5);
  if (c.y < 0.5) return false;
  if (c.x > 1.5) lo = ${off} + (c.x - 2.0) * ${SB_Q_DEG.toFixed(3)};
  if (c.y < 254.5) hi = ${off} + (c.y - 2.0) * ${SB_Q_DEG.toFixed(3)};
  return true;
}
// The clearance a bake skip needs: the lit ramp's cap (2 deg) plus the width its quad partner can force (2 / (0.75 uTermAA)) plus float slack. The bake's own margin covers the bound.
float sbCert() { return ${GH_AA_MAX_DEG.toFixed(1)} + ${GH_AA_MAX_DEG.toFixed(1)} / (0.75 * max(uTermAA, 0.05)) + ${SB_CERT_EXTRA_DEG.toFixed(2)}; }
`
}

/**
 * The Moon pass's read of the horizon envelope: `envMax` is the bound (deg) for the texel under a pixel of footprint `lod` (1e4: none: unbuilt, a code of 255, or a
 * footprint coarser than the sampled lods). `ghOldHorizon` answers where legacy would march the 4k map for the SUN: a pixel whose Sun elevation clears the bound by
 * more than `cert` degrees is fully lit whatever the exact horizon is (globalHorizon.ts ghCertDeg derives it, uTermAA included); everything else marches live as legacy.
 */
function globalHorizonRead(sunBake = false): string {
  return /* glsl */ `
uniform highp usampler2D uEnvTex;  // RG32UI horizon envelope: eight azimuth-sector bytes a texel (dilated), 0 where unbuilt
uniform float uEnvOn;             // 0: no envelope yet
// The azimuth sector (0..7, from the local east e = normalize(cross(K, p) + 1e-6) toward n = cross(p, e)) of the unit tangent t at p: the build's own frame.
int envSector(vec3 p, vec3 t) {
  vec3 e = normalize(cross(uK, p) + 1e-6);
  vec3 n = cross(p, e);
  float a = atan(dot(t, n), dot(t, e));
  return min(int(floor((a / 6.2831853 + (a < 0.0 ? 1.0 : 0.0)) * ${ENV_SECTORS}.0)), ${ENV_SECTORS - 1});
}
float envCode(uvec2 v, int s) { uint w = s < 4 ? v.x : v.y; return float((w >> uint(8 * (s & 3))) & 255u); }
float envMax(vec2 uvp, float lod, vec3 p, vec3 t) {
  if (uEnvOn < 0.5 || !(lod <= ${ENV_LOD_MAX.toFixed(1)})) return 1.0e4;
  ivec2 sz = textureSize(uEnvTex, 0);
  ivec2 i = ivec2(floor(uvp * vec2(sz)));
  i.x = i.x >= sz.x ? i.x - sz.x : max(i.x, 0);
  i.y = clamp(i.y, 0, sz.y - 1);
  float c = envCode(texelFetch(uEnvTex, i, 0).rg, envSector(p, t));
  return (c < 0.5 || c > 254.5) ? 1.0e4 : ${ENV_OFF_DEG.toFixed(1)} + (c - 1.0) * ${ENV_Q_DEG.toFixed(3)};
}
float gCertSub = -1.0;  // >= 0: the certificate the exact sub-pixel taps use (see moonFragment tapShare); -1: the full one
float ghCert() { return gCertSub >= 0.0 ? gCertSub : ${GH_AA_MAX_DEG.toFixed(1)} + ${GH_AA_MAX_DEG.toFixed(1)} / (0.75 * max(uTermAA, 0.05)) + ${GH_CERT_EXTRA_DEG.toFixed(1)}; }
float ghSunElev(vec3 p) { return asin(clamp(dot(p, uS), -1.0, 1.0)) * 180.0 / PI; }
${sunBake ? sunBakeRead() : ''}float ghOldHorizon(vec3 p, vec3 t, vec2 uvp, float lod) {
${sunBake ? `  {
    float sLo, sHi;
    if (sbRead(uvp, lod, sLo, sHi)) {
      float es = ghSunElev(p);
      if (es - sHi > sbCert()) { ${sg('15.0')}return sHi; }
      if (sLo - es > sbCert()) { ${sg('16.0')}return sLo; }
    }
  }
` : ''}  float em = envMax(uvp, lod, p, t);
  if (em < 1.0e3) {
    if (ghSunElev(p) - em > ghCert()) { ${sg('9.0')}return em; }
  } else { ${sg('11.0')} }
  ${mcInc('1')}return ${DIAG_4K0 ? '-5.0' : 'horizonDeg(p, t, heightAt(uvp, lod), lod)'};
}
`
}

/**
 * Functional test program for the 4k envelope's READ (src/moon/dev/envelopeTest.ts, SwiftShader/GPU rig): the very `globalHorizonRead()` text the Moon pass carries, driven by a table of
 * (p, lod, t) rows. Per row it writes (bound deg or 1e4 for none, the live old-march horizon, the sector envSector picked, the raw code envCode read).
 */
export function envReadTestFragment(lonSpan: number, mapWidth: number): string {
  const texelKm = (2 * Math.PI * MOON_R_KM) / mapWidth
  return /* glsl */ `
${GLSL_COMMON}
out vec4 fragColor;
${heightGlsl(lonSpan, texelKm)}
${SIN_SMALL_GLSL}
${HORIZON_STEPS_GLSL}
${HORIZON_DEG_GLSL}
uniform float uTermAA;
uniform vec3 uS;
${globalHorizonRead()}
uniform highp sampler2D uRows;   // RGBA32F, row 2k: p.xyz, lod; row 2k + 1: t.xyz, 0
void main() {
  ivec2 c = ivec2(floor(gl_FragCoord.xy));
  vec4 a = texelFetch(uRows, ivec2(c.x, 2 * c.y), 0);
  vec4 b = texelFetch(uRows, ivec2(c.x, 2 * c.y + 1), 0);
  vec3 p = a.xyz, t = b.xyz;
  float lod = a.w;
  vec2 uvp = uvOf(p);
  float live = horizonDeg(p, t, heightAt(uvp, lod), lod);
  float bound = envMax(uvp, lod, p, t);
  ivec2 sz = textureSize(uEnvTex, 0);
  ivec2 i = ivec2(floor(uvp * vec2(sz)));
  i.x = i.x >= sz.x ? i.x - sz.x : max(i.x, 0);
  i.y = clamp(i.y, 0, sz.y - 1);
  int sec = envSector(p, t);
  fragColor = vec4(bound, live, float(sec), envCode(texelFetch(uEnvTex, i, 0).rg, sec));
}
`
}

const TENV_READ = /* glsl */ `
uniform highp usampler2DArray uTileEnv;  // RG32UI per tile layer: the tile march's highest horizon from anywhere in a cell, per azimuth sector (0 = no bound), tiles/TileEnvelope.ts
uniform float uTenvOn;            // 0: no tile envelope
// The tile envelope's bound (deg) for the fully faded tile of level lm under uvp (1e4: none: off, no such tile, still fading, cell not built or unbounded).
float tileEnvMax(vec2 uvp, int lm, vec3 p, vec3 t) {
  if (uTenvOn < 0.5) return 1.0e4;
  Tile tc = tileAt(uvp, lm);
  ivec3 sz = textureSize(uTileEnv, 0);
  if (tc.layer < 0.0 || tc.a < 0.999 || int(tc.layer + 0.5) >= sz.z) return 1.0e4;
  ivec2 i = clamp(ivec2(floor(tc.f * vec2(sz.xy))), ivec2(0), sz.xy - 1);
  float c = envCode(texelFetch(uTileEnv, ivec3(i, int(tc.layer + 0.5)), 0).rg, envSector(p, t));
  return (c < 0.5 || c > 254.5) ? 1.0e4 : ${ENV_OFF_DEG.toFixed(1)} + (c - 1.0) * ${ENV_Q_DEG.toFixed(3)};
}
`
/** Count mode (?shadowdebug=count): bump gMc where a tile march (x / z) or a 4k march (y / w) of horizonAt runs; gMcV is 2 while the viewer test runs. Identity otherwise. */
function countInstr(text: string): string {
  if (!countDebugOn()) return text
  return text.split('  float hzNew = horizonDegT(').join(`  ${mcInc('gMcV')}\n  float hzNew = horizonDegT(`)
    .split(HZ_OLD_LINE).join(`${HZ_OLD_LINE}\n  if (w < 1.0) { ${mcInc('gMcV + 1')}}`)
}
const HZ_OLD_LINE = '  float hzOld = w < 1.0 ? horizonDeg(p, t, heightAt(uvp, lod), lod) : 0.0;'
/**
 * Fixed policy: a second copy of the tile march's horizonAt for the SUN's horizon only (the view-horizon test calls horizonAt with another direction and keeps the
 * live march), whose old-march term (w = 0 only: a pixel with any tile share keeps the live mix) comes from the global-map horizon cache.
 */
function withGlobalHorizon(tileMarchText: string, ringDeepest: number | null = null, sunBake = false, ringEnv = false, envDbgGlsl = ''): string {
  const start = tileMarchText.indexOf('float horizonAt(vec3 p, vec3 t, float lod, float lodT) {')
  const stop = tileMarchText.indexOf('\n}\n', start)
  if (start < 0 || stop < 0) throw new Error('horizonAt not found in the tile march text')
  const copy = tileMarchText.slice(start, stop + 3)
  const HZ_NEW_LINE = '  float hzNew = horizonDegT('
  // Blend ring (0 < share < 0.999, fixed policy): the tile term of legacy's mix(4k march, tile march, share) is read from the Sun-keyed tile cache (one bilinear tap, the same read the fully tiled pixels use)
  // when the pixel's tile is fully faded in and its cache layer is valid; the 4k term stays the live march (or the envelope skip below). Anything else takes the live tile march, as legacy.
  const RING_PRE = ringDeepest === null ? '' : `  bool rcv = false;
  float hzC = 0.0;
  float rsp = 0.0;
${ringEnv ? `  float rHi = 1.0e4, rLo = -1.0e4;
  if (uShOn > 0.5 && gTileMarch < 0.999 && lm == ${ENV_LEVEL}) hzC = ringEnvRead(lm, uvp, rcv, rHi, rLo);
` : `  if (uShOn > 0.5 && gTileMarch < 0.999 && lm >= ${ringDeepest}) hzC = cachedHorizonSpread(lm, uvp, rcv, rsp);
`}  // A texel outside the cache's Sun band holds -90 (and the bilinear tap mixes it in): no real horizon is below about -6 deg, so anything under RING_MIN_VALID_DEG is contaminated and marches live.
  if (rcv && hzC < ${RING_MIN_VALID_DEG.toFixed(1)}) rcv = false;
  float hzNew = hzC;
  float rE = ${ringEnv ? '0.0' : `rcv ? gTileMarch * (${ringErrDeg().toFixed(2)} + ${ringSpreadK().toFixed(2)} * rsp) : 0.0`};
${ringDiffOn() ? `  if (rcv) {
    float lodGd = shLodG(lm);
    float hzL = horizonDegT(p, t, marchHQ(p, lm, lodGd, 0.0), lm, lodGd);
    float dd = hzC - hzL;
    if (gRd.w < 0.5 || abs(dd) > abs(gRd.x)) { gRd = vec4(dd, gTileMarch, float(lm), 1.0); gRsp = rsp; }
${ringEnv ? `    { float vv = max(hzL - rHi, rLo - hzL); float vn = envDbgNoRef(p, t, lodGd) - rHi; if (gRv.w < 0.5 || vv > gRv.x) gRv = vec4(vv, rHi - rLo, vn, 1.0); }
` : ''}    // The same cache read AT the texel centre nearest p against the live march from exactly that centre: 0 when the cache build is the live march (so any remaining difference is the sub-texel position).
    Tile tcs = tileAt(uvp, lm);
    vec2 nT = vec2(72.0, 36.0) / float(1 << lm);
    vec2 uvs = (uvp * nT - tcs.f + (floor(tcs.f * TH_PX) + 0.5) / TH_PX) / nT;
    float lons = radians(uvs.x * 2.0 * LON_SPAN - LON_SPAN);
    float lats = radians(clamp(90.0 - uvs.y * 180.0, -90.0, 90.0));
    vec3 pS = normalize(cos(lats) * (cos(lons) * uX + sin(lons) * uY) + sin(lats) * uK);
    vec3 tsS = uS - pS * dot(pS, uS);
${ringEnv ? `    { float dm0, dmq; vec2 ao; envDbgModel(pS, normalize(tsS), tileAt(uvs, lm), p, t, uvp, ${Math.floor(qNum('envdbgk', 0, 69))}, lodGd, dm0, dmq, ao); if (gRm.w < 0.5 || abs(dmq - dm0) > abs(gRm.y - gRm.x)) { gRm = vec4(dm0, dmq, max(abs(ao.x), abs(ao.y)), 1.0); Tile tpx = tileAt(uvp, 2); vec2 ff = tpx.f * TH_PX; gRe = vec4(min(min(ff.x, 320.0 - ff.x), min(ff.y, 320.0 - ff.y)), tpx.layer != tileAt(uvs, lm).layer ? 1.0 : 0.0, tpx.a, 1.0); } }
    { float kw, ex; envDbgWorst(pS, normalize(tsS), tileAt(uvs, lm), p, t, lodGd, kw, ex); if (gRk.w < 0.5 || (kw >= 0.0 && ex > gRk.x) || (kw < -1.5 && gRk.y > -1.5)) gRk = vec4(ex, kw, 0.0, 1.0); }
` : ''}    {
      float mx9 = -90.0;
      for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
        vec2 uvq = uvs + vec2(float(i), float(j)) * (0.5 / TH_PX) / nT;
        float lq = radians(uvq.x * 2.0 * LON_SPAN - LON_SPAN);
        float aq = radians(clamp(90.0 - uvq.y * 180.0, -90.0, 90.0));
        vec3 pq = normalize(cos(aq) * (cos(lq) * uX + sin(lq) * uY) + sin(aq) * uK);
        vec3 tq = uS - pq * dot(pq, uS);
        if (length(tq) > 1e-4) mx9 = max(mx9, horizonDegT(pq, normalize(tq), marchHQ(pq, lm, lodGd, 0.0), lm, lodGd));
      }
      if (gRd3.w < 0.5 || abs(hzL - mx9) > abs(gRd3.x)) gRd3 = vec4(hzL - mx9, gTileMarch, dd, 1.0);
    }
    bool rcs;
    float hzCs = cachedHorizon(lm, uvs, rcs);
    if (rcs && length(tsS) > 1e-4) {
      float hzLs = horizonDegT(pS, normalize(tsS), marchHQ(pS, lm, lodGd, 0.0), lm, lodGd);
      float d2 = hzCs - hzLs;
      if (gRd2.w < 0.5 || abs(d2) > abs(gRd2.x)) gRd2 = vec4(d2, gTileMarch, float(lm), 1.0);
    }
  }
` : ''}`
  const REQUIRED = [HZ_OLD_LINE, '  if (w <= 0.0) return hzOld;', '  return w < 1.0 ? mix(hzOld, hzNew, w) : hzNew;', HZ_NEW_LINE]
  for (const r of REQUIRED) if (!copy.includes(r)) throw new Error(`horizonAt line not found: ${r}`)
  const lmLine = /  int lm = [^\n]+;/.exec(copy)
  if (!lmLine) throw new Error('horizonAt: the level line was not found')
  // The tile envelope's read and the combined bound (an upper bound of horizonAt along ANY direction at p): w = 0 the 4k envelope; w = 1 the tile's; between, the mix horizonAt forms,
  // of the two bounds. 1e4 when a needed part has none. Used by the Sun march (horizonAtSun) and the viewer-visibility test.
  const boundFn = `${TENV_READ}
float horizonBound(vec3 p, vec3 t, float lod, float lodT) {
  float w = gTileMarch;
  vec2 uvp = uvOf(p);
  if (w <= 0.0) return envMax(uvp, lod, p, t);
${lmLine[0]}
  float te = tileEnvMax(uvp, lm, p, t);
  if (te > 1.0e3) return 1.0e4;
  if (w >= 1.0) return te;
  float em = envMax(uvp, lod, p, t);
  return em > 1.0e3 ? 1.0e4 : mix(em, te, w);
}
`
  // w = 0: the 4k march alone, from the envelope when the Sun clears it. w > 0: when the tile envelope (and, between, the 4k one) gives a bound the Sun clears by the certificate, neither
  // march runs. Otherwise the tile march runs; for 0 < w < 1 the 4k term is replaced by the envelope when the blended horizon still clears the Sun by the certificate (saturated either
  // way), else it is marched as legacy. w = 1: the tile march alone.
  const sunCopy = copy.replace('float horizonAt(', 'float horizonAtSun(')
    .replace(HZ_OLD_LINE, '  float hzOld = 0.0;')
    .replace('  if (w <= 0.0) return hzOld;', '  if (w <= 0.0) return ghOldHorizon(p, t, uvp, lod);')
    .replace(HZ_NEW_LINE, `  float hb = horizonBound(p, t, lod, lodT);
  if (hb < 1.0e3 && gTileMarch >= ${tenvWMin().toFixed(3)}) {
    if (ghSunElev(p) - hb > ghCert() + ${tenvSunExtra().toFixed(1)}) { ${sg('14.0')}return hb; }
    ${sg('13.0')}
  } else { ${sg('12.0')} }
${ringDeepest === null ? '  float rE = 0.0;\n' + HZ_NEW_LINE : RING_PRE + '  if (!rcv) hzNew = horizonDegT('}`)
    .replace('  return w < 1.0 ? mix(hzOld, hzNew, w) : hzNew;', `  if (w < 1.0) {
${sunBake ? `    {
      float sLo, sHi;
      if (sbRead(uvp, lod, sLo, sHi)) {
        float es = ghSunElev(p);
        float hHi = mix(sHi, ${ringEnv ? '(rcv ? rHi : hzNew)' : 'hzNew'}, w);
        if (es - hHi > sbCert() + rE) { ${sg('15.0')}return hHi; }
        float hLo = mix(sLo, ${ringEnv ? '(rcv ? rLo : hzNew)' : 'hzNew'}, w);
        if (hLo - es > sbCert() + rE) { ${sg('16.0')}return hLo; }
      }
    }
` : ''}    float em = envMax(uvp, lod, p, t);
    if (em < 1.0e3) {
      float hm = mix(em, ${ringEnv ? '(rcv ? rHi : hzNew)' : 'hzNew'}, w);
      if (ghSunElev(p) - hm > ghCert() + rE) { ${sg('9.0')}return hm; }
    }
    hzOld = horizonDeg(p, t, heightAt(uvp, lod), lod);
${ringDeepest === null ? '' : `    if (rcv) {
      float hf = mix(hzOld, hzNew, w);
${ringEnv ? `      float es0 = ghSunElev(p);
      // The cell's bounds (ringEnvelope.ts) hold the live tile horizon wherever the pixel is in it: the Sun clearing the upper one, or the lower one clearing the Sun, by the ramp's saturation distance fixes the pixel whatever the exact horizon is.
      if (es0 - mix(hzOld, rHi, w) > ghCert() - ${GH_CERT_EXTRA_DEG.toFixed(1)} || mix(hzOld, rLo, w) - es0 > ghCert() - ${GH_CERT_EXTRA_DEG.toFixed(1)}) return hf;` : `      if (abs(ghSunElev(p) - hf) > ghCert() - ${GH_CERT_EXTRA_DEG.toFixed(1)} + rE) return hf;`}
      ${mcInc('0')}hzNew = min(horizonDegT(p, t, marchHQ(p, lm, lodG, 0.0), lm, lodG), gHzStopDeg);
    }
`}    return mix(hzOld, hzNew, w);
  }
  return hzNew;`)
  let sunOut = sunCopy
  if (DIAG_TILE0) sunOut = sunOut.replace('hzNew = horizonDegT(', 'hzNew = diagTileStub(')
  if (DIAG_4K0) sunOut = sunOut.replace('    hzOld = horizonDeg(p, t, heightAt(uvp, lod), lod);', '    hzOld = -5.0;')
  if (countDebugOn()) {
    sunOut = (ringDeepest === null ? sunOut.replace('  float hzNew = ', `  ${mcInc('0')}\n  float hzNew = `) : sunOut.replace('  if (!rcv) hzNew = ', `  if (!rcv) ${mcInc('0')}\n  if (!rcv) hzNew = `)).replace('    hzOld = horizonDeg(p, t, heightAt(uvp, lod), lod);', `    ${mcInc('1')}hzOld = horizonDeg(p, t, heightAt(uvp, lod), lod);`)
  }
  const stub = DIAG_TILE0 ? '\nfloat diagTileStub(vec3 p, vec3 t, float h0, int lm, float lodG) { return -5.0 + 0.0 * h0; }\n' : ''
  return countInstr(tileMarchText.slice(0, stop + 3)) + envDbgGlsl + boundFn + stub + sunOut + countInstr(tileMarchText.slice(stop + 3))
}

/**
 * Dev builds with ?shadowdebug=serve: uDbg 23 draws, per pixel, how the fixed policy's envelope bound compares with the live horizon toward the Sun (shadowServe.ts BOUND_CATEGORIES).
 * Both are the shader's own functions at the pixel's lods: horizonBound (the sector of the Sun's azimuth) and horizonAt (the unmodified live march). Returns before any shading.
 */
function boundCheckGlsl(tiles: boolean): string {
  const extra = tiles ? `(gTileMarch > 0.0 ? ${tenvSunExtra().toFixed(1)} : 0.0)` : '0.0'
  return /* glsl */ `  if (uDbg > 22.5 && uDbg < 23.5) {
    float bcat = 0.0;
    vec3 tsb = uS - p * dot(p, uS);
    if (elevS > -10.0 && elevS < 38.0 && length(tsb) > 1e-4) {
      vec3 tb = normalize(tsb);
      float bnd = ${tiles ? 'horizonBound(p, tb, lodS, lodST)' : 'envMax(uvOf(p), lodS, p, tb)'};
      float live = horizonAt(p, tb, lodS, lodST);
      float exc = live - bnd;
      // The skip fires when the Sun clears the bound by cert; the lit ramp is saturated from ${GH_AA_MAX_DEG.toFixed(1)} deg: an excess up to cert - ${GH_AA_MAX_DEG.toFixed(1)} changes nothing.
      float cert = ghCert() + ${extra};
      float tol = cert - ${GH_AA_MAX_DEG.toFixed(1)};
      bool skipFires = elevS - bnd > cert;
      bcat = bnd > 1.0e3 ? 1.0 : (exc <= 0.0 ? 2.0 : (!skipFires ? 6.0 : (exc <= 0.5 * tol ? 3.0 : (exc <= tol ? 4.0 : ${tiles ? '(gTileMarch > 0.0 ? (exc <= tol + 1.0 ? 7.0 : (exc <= tol + 3.0 ? 8.0 : (exc <= tol + 6.0 ? 9.0 : 10.0))) : 5.0)' : '5.0'}))));
    }
    fragColor = vec4(boundDebugColour(bcat), 1.0);
    return;
  }
`
}

/** The most seas the highlight can tell apart (the Labels layer has 22). */
export const HL_SEAS = 24

export function moonFragment(lonSpan: number, mapWidth: number, extraGlsl = '', tiles = false, patch: PatchLayout | null = null, metadata = false, tileDeepest = 0, tileDetail = false, shadowAA: ShadowAAMode | boolean = shadowAaModeFromLocation(), tcDetail = false, baked = false, fixedFallback = false, ablate: ReadonlySet<string> = ABLATE): string {
  // Keep the existing final boolean argument compatible: true selects the
  // investigative geometry mode and false selects the explicit legacy mode.
  const shadowAAMode: ShadowAAMode = typeof shadowAA === 'boolean' ? (shadowAA ? 'geometry' : 'legacy') : shadowAA
  const geometryShadowAA = shadowAAMode === 'geometry'
  const marginShadowAA = shadowAAMode === 'margin'
  // The global-map horizon cache's read: fixed policy, whole-globe height map, and not the site-patch variants (their fragment-unit budget has no room for the atlas).
  const ghOn = fixedFallback && !patch && !baked && lonSpan === 180 && marginShadowAA
  // The blend ring's tile term from the Sun-keyed cache (?shring=0 turns it off, for A/B on the rig). Needs the shadow cache's declarations, so only where the cache read is the fixed one.
  const ringCacheOn = ghOn && !!tiles && shringOn()
  // The footprint envelope of the ring cache (needs the RG16F cache layer ShadowCache builds under the same switch).
  const ringEnv = ringCacheOn && ringEnvelopeOn(tileDeepest)
  // The Sun-keyed 4k bake (src/moon/sunHorizon.ts): fixed policy only, with the envelope; `?sunbake=0` leaves it out (it is one more sampler: 16 of the 16 a phone has in the detail variant).
  const sbOn = ghOn && sunBakeEnabled()
  // The viewer's visibility test: legacy marches toward the viewer; the fixed policy skips it where the viewer's elevation clears the horizon envelope (vis is exactly 1 there).
  // The terminator's four sub-pixel taps (0.125 to 0.375 px from the pixel): with the envelope on, march the first tap and let the other three reuse its horizon where
  // |es - hz0| clears the Sun disc's half-width plus GH_SUBPX_DELTA_DEG (their smoothstep is saturated on the same side). The delta is a measured spread of the
  // horizon over such an offset (scripts/global-horizon-error.mts ... sub), not a proven bound; ?ghsub=0 turns the reuse off.
  const subReuse = ghOn && ghSubDelta() > 0 && !!tiles
  const subDecl = subReuse ? '  float hz0 = 0.0;\n' : ''
  const subLegacy = `      float hzs = length(tss) > 1e-4 ? horizonSun(ps, normalize(tss), lodS, lodST) : -90.0;
      shadowMargin[k] = es - hzs;
`
  // Exact tap shortcuts (fixed policy, ?tapshare=0 turns them off). Both only where nothing but this tap's own smoothstep(-wSun, wSun, es - hz) reads its horizon:
  // the pixel's quad is wholly in the sub-pixel branch (the non-sub-pixel branch and the deep ground's wide ramp read fwidth of the margins, so a margin that is
  // only known to be saturated would change a neighbour's ramp width) and carries no deep ground (gDeepK 0, so wideLit has weight 0).
  //  - The tile march (a fully tiled pixel) stops as soon as its skyline reaches es + wSun: that tap is exactly 0 whatever the rest of the march would find, and the margin it
  //    stores is -wSun, where the ramp is 0 as well.
  //  - The Sun-skip certificate is wSun plus the envelope's sampling slack, not the full one, which also covers the AA ramp of the single-sample path: the tap is exactly 1
  //    wherever the envelope bound clears es by more.
  const tapShare = ghOn && !subReuse && tapShareOn()
  const tapDeep = tiles && deepOf(tileDeepest) < 0 ? 'gDeepK' : '0.0'
  // A quad is uniform when two rounds of fwidth read 0 (one round misses a diagonal partner that differs): v is 0 outside the sub-pixel branch, 1 inside it, 2 inside it on deep ground.
  const tapDecl = tapShare ? `  float tapV = shadowSubpixel ? (${tapDeep} == 0.0 ? 1.0 : 2.0) : 0.0;
  float tapF = fwidth(tapV);
  float tapF2 = tapF + fwidth(tapF);
  bool tapExact = tapV == 1.0 && tapF2 == 0.0;
` : ''
  const subTapShare = `      float hzs = 0.0;
      if (tapExact) {
        gCertSub = wSun + ${GH_CERT_EXTRA_DEG.toFixed(1)};
${tiles ? '        if (gTileMarch >= 1.0) gHzStopDeg = es + wSun;\n' : ''}      }
      hzs = length(tss) > 1e-4 ? horizonSun(ps, normalize(tss), lodS, lodST) : -90.0;
      gCertSub = -1.0;
      gHzStopDeg = 200.0;
      shadowMargin[k] = es - hzs;
`
  const subTap = subReuse ? `      float hzs;
      if (k > 0 && abs(es - hz0) > wSun + (gTileMarch <= 0.0 ? ${ghSubDelta().toFixed(2)} : ${ghSubDeltaTile() > 0 ? ghSubDeltaTile().toFixed(2) : '1.0e4'})) { hzs = hz0; } else { hzs = length(tss) > 1e-4 ? horizonSun(ps, normalize(tss), lodS, lodST) : -90.0; }
      if (k == 0) hz0 = hzs;
      shadowMargin[k] = es - hzs;
` : tapShare ? subTapShare : subLegacy
  const visLegacy = `      ${countDebugOn() ? 'gMcV = 2; ' : ''}float hzV = horizonAt(p, normalize(tv), lod0, lodT0);${countDebugOn() ? ' gMcV = 0;' : ''}
      vis = mix(smoothstep(hzV - 0.5, hzV + 0.5, elevV), 1.0, terrainK);
`
  const visMarch = ghOn ? `      float envV = ${tiles ? 'horizonBound(p, normalize(tv), lod0, lodT0)' : 'envMax(uv, lod0, p, normalize(tv))'};
${serveDebugOn() ? `      if (uDbg > 23.5 && uDbg < 24.5) {
        float clearV = ${ENV_VIEW_CLEAR_DEG.toFixed(1)}${tiles ? ` + (gTileMarch > 0.0 ? ${tenvViewExtra().toFixed(1)} : 0.0)` : ''};
        float excV = horizonAt(p, normalize(tv), lod0, lodT0) - envV;
        float tolV = clearV - 0.5;
        gVb = envV > 1.0e3 ? 1.0 : (excV <= 0.0 ? 2.0 : (elevV - envV < clearV ? 6.0 : (excV <= 0.5 * tolV ? 3.0 : (excV <= tolV ? 4.0 : ${tiles ? '(gTileMarch > 0.0 ? (excV <= tolV + 1.0 ? 7.0 : (excV <= tolV + 3.0 ? 8.0 : (excV <= tolV + 6.0 ? 9.0 : 10.0))) : 5.0)' : '5.0'}))));
      }
` : ''}      if (elevV - envV >= ${ENV_VIEW_CLEAR_DEG.toFixed(1)}${tiles ? ` + (gTileMarch > 0.0 ? ${tenvViewExtra().toFixed(1)} : 0.0)` : ''}) { ${svis('1.0')}vis = 1.0; } else {
        ${tiles ? svis('(envV < 1.0e3 ? 2.0 : (gTileMarch > 0.0 ? 3.0 : 4.0))') : svis('envV < 1.0e3 ? 2.0 : 4.0')}${countDebugOn() ? 'gMcV = 2; ' : ''}float hzV = ${DIAG_VIEW0 ? '-5.0' : 'horizonAt(p, normalize(tv), lod0, lodT0)'};${countDebugOn() ? ' gMcV = 0;' : ''}
        vis = mix(smoothstep(hzV - 0.5, hzV + 0.5, elevV), 1.0, terrainK);
      }
` : visLegacy
  // Patch programs retain their site photo and height samplers first, then
  // stay inside WebGL2's minimum fragment-unit budget by using live global
  // horizons and omitting optional global detail/shared-hit optimizations.
  const globalDetail = tiles && tileDetail && !patch && !ablate.has('detail')
  const useTcDetail = globalDetail && tcDetail
  const shadowCache = tiles && !patch && !baked
  const sharedHit = tiles && !patch
  const texelKm = (2 * Math.PI * MOON_R_KM) / mapWidth
  return /* glsl */ `
${GLSL_COMMON}
${GLSL_FLUSH16}
${MOON_GEOMETRY_GLSL}
uniform float uShMode;       // Shadows: 0 Full, 1 Fast (single lite march at rest too), 2 Off (no horizon march; day/night lighting stays)
out vec4 fragColor;
${heightGlsl(lonSpan, texelKm)}

uniform vec3 uS;             // Moon to Sun, unit
uniform vec3 uEarth;         // Moon to Earth, unit
uniform vec3 uSunPos;        // Moon to Sun, Moon radii (for the eclipse hook)
uniform vec3 uEarthPos;      // Moon to Earth, Moon radii
uniform float uEarthshine;   // earthlight over sunlight, normal incidence
uniform float uTopoOn;        // opt-in relative elevation overlay; its height reads are inside this uniform branch
uniform float uTopoRangeM;    // elevation range either side of the local broad-scale reference, metres
uniform float uTopoWhiteIF;   // current un-pre-exposed exposure white, so the final pass gets a bounded x value
// The Labels layer's highlight (ui/labels.ts, main.ts setHighlight): the area of the hovered feature lights up.
uniform float uNightFloor;    // the night side's display floor: the radiance (I/F, un-pre-exposed) shown at ?nightfloor= of white for 0.12 albedo, 0 off (post/exposure.ts nightFloorRadiance)
uniform float uHlOn;          // 0 off, up to 1 while a feature is highlighted (faded on the CPU)
uniform vec4 uHlDir;          // the feature's centre (Moon-fixed unit vector) and its angular radius, radians
uniform float uHlMode;        // 0 a disc with a rim (craters, mountains, sites), 1 a sea (its dark ground only, see below)
uniform vec3 uHlTint;         // the highlight's colour (the labels' gold, linear)
uniform vec4 uHlSeas[${HL_SEAS}];    // every labelled sea: centre and angular radius, for sharing the dark ground between neighbours
uniform int uHlSeaCount;
uniform int uHlSel;           // the highlighted sea's index in uHlSeas, -1 for none
uniform sampler2D uColor;
// The Sun's angular radius at the Moon, deg: shadow edges soften over it.
const float SUN_R = 0.267;
// Extra mip levels the surface slopes are read at near the terminator (full within 1 deg of Sun elevation 0, none past 6 deg).
const float TERM_SLOPE_LOD = 2.0;
// The relief a shadow is assumed to be cast by, km, for the penumbra and the sub-pixel band; and the penumbra's cap, degrees.
const float REF_RELIEF_KM = 0.5;
const float PENUMBRA_MAX_DEG = 2.0;
// Modelled fill light in shadow, share of the lit radiance (see the notes).
const float SHADOW_FILL = ${SHADOW_FILL.toFixed(3)};
${HORIZON_STEPS_GLSL}// Earthshine's colour against sunlight: bluer by 0.15 to 0.2 mag in B-V.
const vec3 EARTH_TINT = vec3(0.90, 0.98, 1.14);
// Ground with no direct view of the Earth still gets this share of the earthshine from the terrain around it (an estimate, src/moon/earthlight.ts).
const float AMBIENT_ES = ${AMBIENT_EARTHSHINE_SHARE.toFixed(3)};
${EARTHLIGHT_GLSL}
${HIGHLIGHT_WASH_GLSL}
${SIN_SMALL_GLSL}

${HORIZON_DEG_GLSL}

${serveDebugOn() ? SERVE_DEBUG_GLSL + VIS_DEBUG_GLSL + W_DEBUG_GLSL + BOUND_DEBUG_GLSL + 'float gServe = 0.0; // what served this pixel\'s Sun horizon (src/moon/shadowServe.ts)\nfloat gVis = 0.0; // the viewer-visibility march: 0 not needed, 1 skipped by the envelope, 2 marched\nfloat gVb = 0.0; // the viewer-skip bound check (uDbg 24)\n' : ''}${ringDiffOn() ? 'vec4 gRe = vec4(0.0); // tile-edge distance (texels), different tile than the cell centre, tile fade\nvec4 gRm = vec4(0.0); // ring envelope model check: (origin height model - live, sample height model - live (m), 0, 1 when seen)\nvec4 gRk = vec4(0.0); // ring envelope worst sample: (excess deg, sample index or -2 unbounded, 0, 1 when seen)\nvec4 gRv = vec4(0.0); // ring envelope: (live tile horizon outside [lo, hi] by this many deg (negative: inside by), hi - lo, tile share, 1 when seen)\nvec4 gRd3 = vec4(0.0);\nfloat gRsp = 0.0;\nvec4 gRd2 = vec4(0.0); // the same at the nearest texel centre\nvec4 gRd = vec4(0.0); // ring cache vs live tile horizon: (cached - live deg, tile share, level, 1 when seen)\n' : ''}${countDebugOn() ? 'vec4 gMc = vec4(0.0); // marches run: x tile Sun, y 4k Sun, z tile viewer, w 4k viewer (summed over taps)\nint gMcV = 0; // 2 while the viewer test runs\n' : ''}${tiles ? tileDecls(tileDeepest) + tileMarchFn(tileDeepest) + (patch ? patchDecls(patch) + MARCH_HQ_PATCH : MARCH_HQ_PLAIN) + tileTerrain(tileDeepest) + (ghOn ? globalHorizonRead(sbOn) + (ringCacheOn ? FIXED_CACHE_DECL + (ringEnv ? RING_ENV_READ : '') : '') + withGlobalHorizon(tileMarch(!!patch, tileDeepest), ringCacheOn ? deepOf(tileDeepest) : null, sbOn, ringEnv, ringEnv && ringDiffOn() ? ringEnvelopeBuildGlsl(deepOf(tileDeepest) !== 0, true) : '') : countInstr(tileMarch(!!patch, tileDeepest))) + (baked ? bakedShadowRead(tiles, patch) : shadowCache ? shadowCacheRead(!!patch, tileDeepest, fixedFallback, ghOn, ringCacheOn) : patch && patch.some((l) => l.cache) ? patchShadowRead(patch, tileDeepest) : noShadowCache(ghOn)) : (ghOn ? globalHorizonRead(sbOn) + NO_TILE_MARCH_GH : NO_TILE_MARCH) + (baked ? bakedShadowRead(false, null) : noShadowCache(ghOn))}${!baked && tiles && deepOf(tileDeepest) < -1 && !(patch && patch.some((l) => l.cache)) ? 'float gPshHit = -1.0;\n' : ''}${globalDetail ? DETAIL_GLSL : ''}${useTcDetail ? TJ_GLSL : ''}${sharedHit ? 'uniform highp sampler2D uHitTex; // shared terrain hit (non-patch shader variant only)\n' : ''}
// McEwen lunar-Lambert L(alpha), alpha in degrees (photometry.ts's twin).
float lunarL(float a) {
  return max(0.0, 1.0 - 0.019 * a + 2.42e-4 * a * a - 1.46e-6 * a * a * a);
}
// The fitted phase function, 1 at zero phase (photometry.ts's twin).
float phaseA(float a) { return exp(-0.0025 * a) * (1.0 + 0.9 * exp(-a / 20.0)) / 1.9; }

${ECLIPSE_GLSL}
${extraGlsl}
${elevationRampGlsl()}

void main() {
  vec2 px = gl_FragCoord.xy;
  vec3 rr = cameraRay(px);
  float b;
  vec3 p = moonHit(rr, b);
  float cover = moonCover(rr, b);
  // With tiles, the ground hit follows the relief near the floor (terrainResolve); otherwise it is the sphere.
${tiles ? `vec3 hitPos;
  vec3 pSph = p;
  ${sharedHit ? `if (uHitIn > 0.5) {
    vec2 ht = texelFetch(uHitTex, ivec2(px), 0).rg;
    hitPos = p;
    cover = ht.g;
    if (ht.r > 0.0) { hitPos = uCamPos + rr * ht.r; p = normalize(hitPos); }
  } else {
    terrainResolve(rr, b, p, hitPos, cover);
  }` : 'terrainResolve(rr, b, p, hitPos, cover);'}
  float terrainK = uTerrain;` : `vec3 hitPos = p;
  float terrainK = 0.0;`}
  if (cover <= 0.0) discard;

  vec3 V = normalize(uCamPos - hitPos);
  float kmPerPx = length(uCamPos - hitPos) * R_KM * uTanPerPx;
  vec2 uv = uvOf(p);
  // The sphere's own cosine to the viewer.
  float muP = dot(p, V);
  // Local frame: east, north.
  vec3 e = normalize(cross(uK, p) + 1e-6);
  vec3 n = cross(p, e);
  // Mip level from the pixel's footprint on the ground (foreshortened).
  float lod0 = log2(max(1.0, kmPerPx / max(muP, 0.15) / TEXEL_KM));
  // The pixel's footprint in the tile level's texels (the tile march reads that level).
  float lodT0 = log2(max(${deepOf(tileDeepest) === 0 ? '1.0' : Math.pow(2, deepOf(tileDeepest)).toFixed(6)}, kmPerPx / max(muP, 0.15) / ${H_TEXEL_KM.toFixed(5)}));
  // Slopes by central differences at the footprint's scale.
  // Near the terminator the slopes are read one mip coarser: the lit/unlit contour is where the slope's tilt cancels the Sun's few tenths of a
  // degree, the long exposure makes it a razor edge, and a slope that changes at the data's texel scale draws it as a pixel staircase.
  float lodN = lod0 + TERM_SLOPE_LOD * (1.0 - smoothstep(1.0, 6.0, abs(asin(clamp(dot(p, uS), -1.0, 1.0)) * 180.0 / PI)));
  float dKm = TEXEL_KM * exp2(lodN);
  float th = dKm / R_KM;
  float hE = heightAt(uvOf(normalize(p + e * th)), lodN);
  float hW = heightAt(uvOf(normalize(p - e * th)), lodN);
  float hN = heightAt(uvOf(normalize(p + n * th)), lodN);
  float hS = heightAt(uvOf(normalize(p - n * th)), lodN);
  float sx = (hE - hW) * 0.001 / (2.0 * dKm);
  float sy = (hN - hS) * 0.001 / (2.0 * dKm);
  vec3 nrm = normalize(p - sx * e - sy * n);

${tiles ? `  // Elliptical footprint on the local tangent plane; bound the extreme
  // skyline where a single pixel ceases to resolve individual terrain samples.
  float normalRatio = 1.0 / max(abs(muP), 0.02);
  vec3 alongView = V - p * muP;
  alongView /= max(length(alongView), 1e-5);
  float normalSpanRad = kmPerPx * normalRatio / R_KM;
  float normalCosLat = max(length(vec2(dot(p, uX), dot(p, uY))), 0.05);
  vec2 normalSpan = vec2(dot(alongView, e) / (2.0 * PI * normalCosLat), -dot(alongView, n) / PI) * normalSpanRad;
` + tileNormal(tileDeepest) : ''}
${tiles && patch ? patchNormal(patch, false) : ''}
  // Can the viewer see this ground, or is it behind a rim nearer the limb?
  // (A shadow that the viewer cannot see must not cut into the disc.) This
  // guesses from the sphere hit; where terrainResolve found the ground by
  // marching the real ray (terrainK 1) the ray itself already said what is
  // visible, and guessing again would cut a wedge out of visible ground.
  float vis = 1.0;
  float elevV = asin(clamp(muP, -1.0, 1.0)) * 180.0 / PI;
  if (elevV < 38.0 && terrainK < 1.0 && uMotion < 0.5${ABL_VIEWHZ ? ' && false' : ''}) {
    vec3 tv = V - p * muP;
    if (length(tv) > 1e-4) {
${visMarch}    }
  }
  nrm = normalize(mix(p, nrm, vis));

  // Albedo. The filter footprint comes from the neighbouring pixels' ground
  // points, so it is right across longitude 180 (where u wraps), and the
  // meridians' convergence near the poles adds at most the 8 samples the
  // anisotropic filter takes (the map is smooth along its polar rows)
  // instead of blurring the pole to a coarse mip.
  float bx, by;
${tiles ? `  // Both ends of each difference are SPHERE hits (the base is uvSph, never the terrain-resolved uv): terrain parallax is hundreds of metres and
  // radial, and added to a derivative it smears a fine texture along the radius near the camera floor.
  vec2 uvSph = uvOf(pSph);
  vec2 gx = uvOf(moonHit(cameraRay(px + vec2(1.0, 0.0)), bx)) - uvSph;
  vec2 gy = uvOf(moonHit(cameraRay(px + vec2(0.0, 1.0)), by)) - uvSph;` : `  vec2 gx = uvOf(moonHit(cameraRay(px + vec2(1.0, 0.0)), bx)) - uv;
  vec2 gy = uvOf(moonHit(cameraRay(px + vec2(0.0, 1.0)), by)) - uv;`}
  gx.x -= round(gx.x);
  gy.x -= round(gy.x);
  float cosLat = length(vec2(dot(p, uX), dot(p, uY)));
  float squeeze = min(1.0, 8.0 * cosLat);
  gx.x *= squeeze;
  gy.x *= squeeze;
  vec3 c = textureGrad(uColor, uv, gx, gy).rgb;
${tiles ? tileColorBlock() : ''}
  // Mapped onto published normal albedos (Mare Tranquillitatis ~0.07,
  // highlands 0.15 to 0.22): photometry.ts's normalAlbedo.
  float Y0 = max(1e-4, dot(c, vec3(0.2126, 0.7152, 0.0722)));
  float An = 0.07 * pow(Y0 / 0.058, 0.6);
  vec3 chroma = mix(vec3(1.0), c / Y0, 0.55);
  vec3 albedo = An * chroma;${globalDetail ? detailApply(useTcDetail, false) : ''}
${tiles && patch ? '  albedo *= exp2(patchLR);' : ''}

  float mu = max(dot(nrm, V), 0.0);
  // Sunlight, with the skyline marched toward the real Sun.
  float mu0 = dot(nrm, uS);
  vec3 sun = vec3(0.0);
  float elevS = asin(clamp(dot(p, uS), -1.0, 1.0)) * 180.0 / PI;
  float lit = 1.0;
${geometryShadowAA ? `  // Derivatives inside a pixel-varying branch are undefined in GLSL ES. This investigative mode uses only the Sun-elevation change across a pixel as an edge width; it does not include skyline variation.
  float edgeAA = min(${SHADOW_AA_MAX_DEG.toFixed(1)}, ${SHADOW_AA_PIXEL_SCALE.toFixed(2)} * fwidth(elevS));
` : ''}
  // Near the limb one pixel spans many texels along the line of sight, so a
  // single traced shadow there is a bead, not a crater. The march reads
  // heights filtered to the pixel's whole footprint along the view, which
  // keeps the terminator's large-scale raggedness without the beads.
  float texelsAlongView = kmPerPx / max(muP, 0.02) / TEXEL_KM;
  float lodS = max(lod0, log2(max(1.0, texelsAlongView)));
  float lodST = max(lodT0, log2(max(${deepOf(tileDeepest) === 0 ? '1.0' : Math.pow(2, deepOf(tileDeepest)).toFixed(6)}, kmPerPx / max(muP, 0.02) / ${H_TEXEL_KM.toFixed(5)})));
${serveDebugOn() && ghOn ? boundCheckGlsl(!!tiles) : ''}  // Penumbra: the height data cannot place a shadow edge closer than its own
  // texel, so the edge is softened by that texel's angular size at the caster
  // (the DATA's texel, not the pixel footprint, which the mip filter already
  // averages, over the shadow length; the shadow of REF_RELIEF_KM of relief is
  // REF_RELIEF_KM / tan(elevation) long; half of it each side, scaled by 1/2), on top of the Sun's own disc. A
  // magnified LOLA texel then never draws a hard polygon.
  float penumbraDeg = min(PENUMBRA_MAX_DEG, 0.25 * degrees(tan(radians(clamp(elevS, 0.0, 60.0))) * ${H_TEXEL_KM.toFixed(5)} / REF_RELIEF_KM));
  float wSun = max(SUN_R, penumbraDeg);
${tiles && deepOf(tileDeepest) < 0 ? `  // Over the smoothed 118 m and finer ground the horizon is known only to about 1 m of relief over the 120 m kernel (atan(1/120) = ${DEEP_PENUMBRA_DEG.toFixed(2)} deg): a shadow edge is no sharper than that.\n  wSun = max(wSun, ${DEEP_PENUMBRA_DEG.toFixed(3)} * gDeepK);\n` : ''}  // The sub-pixel average runs wherever a shadow is longer than a pixel at this
  // view: elevation below atan(relief / km per pixel), from 2 to 12 degrees
  // (a single sample there sparkles as it crosses texels).
  float bandDeg = clamp(degrees(atan(REF_RELIEF_KM / max(kmPerPx, 1e-3))), 2.0, 12.0);
${marginShadowAA ? `  // Collect signed Sun-minus-skyline margins first. The four offset samples are
  // retained near the terminator; elsewhere only one horizon march is needed.
  // Derivatives are evaluated after the varying branches, in uniform flow.
  vec4 shadowMargin = vec4(90.0);
${DIAG_RING1 ? '  float gtmRing = gTileMarch; if (gtmRing > 0.75) gTileMarch = 1.0;\n' : ''}${subDecl}  bool shadowSubpixel = abs(elevS) < bandDeg && uMotion < 0.5 && uShMode < 0.5${ABL_SHADOW === 0 ? '' : ' && false'};
${tapDecl}${baked ? `  if (true) {
    gHzStopDeg = elevS + wSun;
    vec3 ts = uS - p * dot(p, uS);
    float hz = length(ts) > 1e-4 ? horizonSun(p, normalize(ts), lodS, lodST) : 0.0;
    shadowMargin = vec4(elevS - hz);
  } else ` : '  '}if (shadowSubpixel) {
    vec2 offs[4] = vec2[4](vec2(0.125, 0.375), vec2(-0.375, 0.125), vec2(-0.125, -0.375), vec2(0.375, -0.125));
    for (int k = 0; k < 4; k++) {
      vec3 rs = cameraRay(px + offs[k]);
      float bs;
      vec3 ps = moonHit(rs, bs);
      if (terrainK > 0.0) {
        float dn = dot(rs, p);
        if (dn < -0.05) ps = normalize(uCamPos + rs * (dot(hitPos - uCamPos, p) / dn));
      }
      float es = asin(clamp(dot(ps, uS), -1.0, 1.0)) * 180.0 / PI;
      vec3 tss = uS - ps * dot(ps, uS);
${subTap}    }
  } else if (uShMode < 1.5 && elevS > -10.0 && elevS < (((uMotion > 0.5 && uMLite > 0.5) || uShMode > 0.5) ? 24.0 : 38.0)) {
    // A phone's motion frame: a skyline above the Sun's elevation plus its disc already makes the pixel shadow, so the march stops there; the margin it returns is exactly that edge.
    gHzStopDeg = ((uMotion > 0.5 && uMLite > 0.5) || uShMode > 0.5) ? elevS + wSun : 200.0;
    vec3 ts = uS - p * dot(p, uS);
    float hz = length(ts) > 1e-4${ABL_SHADOW === 1 ? ' && false' : ''} ? horizonSun(p, normalize(ts), lodS, lodST) : -90.0;
    shadowMargin = vec4(elevS - hz);
  } else if (uShMode > 1.5) {
    // Shadows Off: a flat horizon, so the Sun's own elevation decides day or night and the terminator stays where n.l puts it.
    shadowMargin = vec4(elevS);
  }
${DIAG_RING1 ? '  gTileMarch = gtmRing;\n' : ''}  vec4 shadowWidth = min(vec4(${SHADOW_AA_MAX_DEG.toFixed(1)}), ${SHADOW_AA_PIXEL_SCALE.toFixed(2)} * uTermAA * fwidth(shadowMargin));
  vec4 wideLit = smoothstep(-max(vec4(wSun), shadowWidth), max(vec4(wSun), shadowWidth), shadowMargin);
  vec4 sunDiscLit = smoothstep(vec4(-wSun), vec4(wSun), shadowMargin);
  vec4 subpixelLit = mix(sunDiscLit, wideLit, ${tiles && deepOf(tileDeepest) < 0 ? 'gDeepK' : '0.0'});
  if (shadowSubpixel) {
    lit = dot(subpixelLit, vec4(0.25));
  } else if (elevS <= -10.0) {
    lit = 0.0;
  } else if (elevS < 38.0) {
    lit = wideLit.x;
  }
${baked ? '  if (gBakedHit > 0.5) lit = smoothstep(-0.267, 0.267, elevS - gBakedHorizon);\n' : ''}  lit = mix(1.0, lit, vis);` : `  if (abs(elevS) < bandDeg && uMotion < 0.5) {
    // Along the terminator one pixel covers crests whose shadows are thinner
    // than it; a single test leaves one-pixel whiskers pointing at the Sun.
    // Trace four rotated-grid sub-pixel samples and average.
    vec2 offs[4] = vec2[4](vec2(0.125, 0.375), vec2(-0.375, 0.125), vec2(-0.125, -0.375), vec2(0.375, -0.125));
    float acc = 0.0;
    for (int k = 0; k < 4; k++) {
      vec3 rs = cameraRay(px + offs[k]);
      float bs;
      vec3 ps = moonHit(rs, bs);
      // On terrain the neighbouring ray meets the ground where this one's tangent plane does
      // (not on the sphere, which would put the sample off the ground it is averaging).
      if (terrainK > 0.0) {
        float dn = dot(rs, p);
        if (dn < -0.05) ps = normalize(uCamPos + rs * (dot(hitPos - uCamPos, p) / dn));
      }
      float es = asin(clamp(dot(ps, uS), -1.0, 1.0)) * 180.0 / PI;
      vec3 tss = uS - ps * dot(ps, uS);
      float hzs = length(tss) > 1e-4 ? horizonSun(ps, normalize(tss), lodS, lodST) : -90.0;
${tiles && deepOf(tileDeepest) < 0 ? `      // Over the deep ground a steep wall changes the margin by degrees within a pixel: widen each sample's ramp to a pixel (as the branch below does), so the
      // four samples average into a graded edge, not four hard ones.
      float dmS = es - hzs;
${geometryShadowAA ? `      float w = max(wSun, edgeAA);
      acc += smoothstep(-w, w, dmS);
` : `      acc += smoothstep(-wSun, wSun, dmS) * (1.0 - gDeepK) + smoothstep(-max(wSun, 0.75 * fwidth(dmS)), max(wSun, 0.75 * fwidth(dmS)), dmS) * gDeepK;
`}
` : `      acc += smoothstep(-wSun, wSun, es - hzs);
`}    }
    lit = acc * 0.25;
  } else if (elevS <= -10.0) {
    // Ten degrees into the night no lunar peak sees the Sun (the deepest
    // horizon dip, from about 10 km of relief, is 6 deg): the march would
    // only confirm the shadow, so it is skipped.
    lit = 0.0;
  } else if (elevS < 38.0) {
    vec3 ts = uS - p * dot(p, uS);
    float hz = length(ts) > 1e-4 ? horizonSun(p, normalize(ts), lodS, lodST) : -90.0;
    float m = elevS - hz;
    // Soften over the Sun's disc, or over a pixel where the skyline jumps
    // faster than that, so the edge never aliases.
    float w = max(wSun, ${geometryShadowAA ? 'edgeAA' : '0.75 * fwidth(m)'});
    lit = smoothstep(-w, w, m);
  }
  lit = mix(1.0, lit, vis);`}${tiles && deepOf(tileDeepest) < -1 ? `
  if (uDbg > 0.5) {
    // Debug views (?dbg=): 1 normal, 2 height contours, 3 level -2 / -1 weights, 4 lit alone, 5 east slope, 6 north slope
    // Diagnostic channels are bounded linear display values. FinalPass detects
    // this query mode and converts them directly to sRGB, bypassing scene
    // auto-exposure, the two-exposure fusion, and the highlight shoulder.
    if (uDbg < 1.5) { fragColor = vec4(clamp(nrm * 0.5 + 0.5, 0.0, 1.0), 1.0); return; }
    if (uDbg < 2.5) { float hh = marchHQ(p, -3, 0.0, 1.0) * 0.5; fragColor = vec4(vec3(fract(hh / 50.0)), 1.0); return; }
    if (uDbg < 3.5) { fragColor = vec4(clamp(vec3(wn2, wn1, w0), 0.0, 1.0), 1.0); return; }
    if (uDbg < 4.5) { fragColor = vec4(vec3(clamp(lit, 0.0, 1.0)), 1.0); return; }
${ringDiffOn() ? '    if (uDbg > 32.5 && uDbg < 33.5) { vec3 rn = gRe.w < 0.5 ? vec3(0.0) : vec3(clamp(gRe.x / 64.0, 0.0, 1.0), gRe.y, gRe.z); vec3 rl = mix(rn / 12.92, pow((rn + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), rn)); fragColor = vec4(rl, 1.0); return; }\n' : ''}${ringDiffOn() ? '    if (uDbg > 31.5 && uDbg < 32.5) { vec3 rn = gRm.w < 0.5 ? vec3(0.0) : vec3(clamp(0.5 + gRm.x / 8.0, 0.0, 1.0), clamp(0.5 + gRm.y / 8.0, 0.0, 1.0), clamp(gRm.z * 2.0, 0.0, 1.0)); vec3 rl = mix(rn / 12.92, pow((rn + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), rn)); fragColor = vec4(rl, 1.0); return; }\n' : ''}${ringDiffOn() ? '    if (uDbg > 30.5 && uDbg < 31.5) { vec3 rn = gRk.w < 0.5 ? vec3(0.0) : (gRk.y < -1.5 ? vec3(0.0, 0.0, 1.0) : vec3(gRk.x > 0.0 ? clamp(0.25 + gRk.x * 0.05, 0.0, 1.0) : 0.0, clamp(gRk.y / 70.0, 0.0, 1.0), 0.0)); vec3 rl = mix(rn / 12.92, pow((rn + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), rn)); fragColor = vec4(rl, 1.0); return; }\n' : ''}${ringDiffOn() ? '    if (uDbg > 29.5 && uDbg < 30.5) { vec3 rn = gRv.w > 0.5 ? vec3(gRv.x > 0.0 ? clamp(0.25 + gRv.x * 0.1, 0.0, 1.0) : 0.0, clamp(gRv.y / 16.0, 0.0, 1.0), gRv.z > 0.0 ? clamp(0.25 + gRv.z * 0.1, 0.0, 1.0) : 0.0) : vec3(0.0); vec3 rl = mix(rn / 12.92, pow((rn + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), rn)); fragColor = vec4(rl, 1.0); return; }\n' : ''}${ringDiffOn() ? '    if (uDbg > 28.5 && uDbg < 29.5) { vec3 rn = gRd3.w > 0.5 ? vec3(clamp(0.5 + 0.5 * sign(gRd3.x) * sqrt(min(abs(gRd3.x), 64.0)) * 0.125, 0.0, 1.0), clamp(0.5 + 0.5 * sign(gRd3.z) * sqrt(min(abs(gRd3.z), 64.0)) * 0.125, 0.0, 1.0), gRd3.y) : vec3(0.0); vec3 rl = mix(rn / 12.92, pow((rn + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), rn)); fragColor = vec4(rl, 1.0); return; }\n' : ''}${ringDiffOn() ? '    if (uDbg > 27.5 && uDbg < 28.5) { vec3 rn = gRd.w > 0.5 ? vec3(clamp(0.5 + 0.5 * sign(gRd.x) * sqrt(min(abs(gRd.x), 64.0)) * 0.125, 0.0, 1.0), clamp(sqrt(min(gRsp, 64.0)) * 0.125, 0.0, 1.0), gRd.y) : vec3(0.0); vec3 rl = mix(rn / 12.92, pow((rn + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), rn)); fragColor = vec4(rl, 1.0); return; }\n' : ''}${ringDiffOn() ? '    if (uDbg > 26.5 && uDbg < 27.5) { vec3 rn = gRd2.w > 0.5 ? vec3(clamp(0.5 + 0.5 * sign(gRd2.x) * sqrt(min(abs(gRd2.x), 64.0)) * 0.125, 0.0, 1.0), gRd2.y, (gRd2.z + 1.0) * 0.25) : vec3(0.0); vec3 rl = mix(rn / 12.92, pow((rn + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), rn)); fragColor = vec4(rl, 1.0); return; }\n' : ''}${ringDiffOn() ? '    if (uDbg > 25.5 && uDbg < 26.5) { vec3 rn = gRd.w > 0.5 ? vec3(clamp(0.5 + 0.5 * sign(gRd.x) * sqrt(min(abs(gRd.x), 64.0)) * 0.125, 0.0, 1.0), gRd.y, (gRd.z + 1.0) * 0.25) : vec3(0.0); vec3 rl = mix(rn / 12.92, pow((rn + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), rn)); fragColor = vec4(rl, 1.0); return; }\n' : ''}${countDebugOn() ? '    if (uDbg > 24.5 && uDbg < 25.5) { vec3 cn = vec3(min(gMc.x, 4.0), min(gMc.y, 4.0), min(gMc.z + 2.0 * gMc.w, 3.0)) / 4.0; vec3 cl = mix(cn / 12.92, pow((cn + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), cn)); fragColor = vec4(cl, 1.0); return; }\n' : ''}${serveDebugOn() ? '    if (uDbg > 19.5 && uDbg < 20.5) { fragColor = vec4(serveDebugColour(gServe), 1.0); return; }\n    if (uDbg > 20.5 && uDbg < 21.5) { fragColor = vec4(visDebugColour(gVis), 1.0); return; }\n    if (uDbg > 23.5 && uDbg < 24.5) { fragColor = vec4(boundDebugColour(gVb), 1.0); return; }\n    '+(tiles ? 'if (uDbg > 21.5 && uDbg < 22.5) { fragColor = vec4(wDebugColour(gTileMarch), 1.0); return; }\n' : ''): ''}    if (uDbg > 11.5 && uDbg < 12.5) { fragColor = vec4(gPshHit > 0.5 ? vec3(0.0, 0.6, 0.0) : gPshHit > -0.5 ? vec3(0.8, 0.0, 0.0) : vec3(0.15), 1.0); return; }
    if (uDbg > 9.5 && uDbg < 10.5) { fragColor = vec4(vec3(clamp(dot(albedo, vec3(0.2126, 0.7152, 0.0722)) * 2.0, 0.0, 1.0)), 1.0); return; }
    if (uDbg > 10.5 && uDbg < 11.5) { fragColor = vec4(vec3(clamp(max(mu0, 0.0), 0.0, 1.0)), 1.0); return; }
    if (uDbg > 6.5 && uDbg < 9.5) { vec2 q7 = uDbg < 7.5 ? vec2(sx, sy) : (uDbg < 8.5 ? tileSlopeFiltered(t0, 0, cosLatT, uv, normalSpan, normalRatio) : (uDbg < 9.5 ? tileSlopeFiltered(t1, 1, cosLatT, uv, normalSpan, normalRatio) : tileSlopeFiltered(t2, 2, cosLatT, uv, normalSpan, normalRatio))); fragColor = vec4(clamp(vec3(0.5 + q7.x * 60.0, 0.5 + q7.y * 60.0, 0.5), 0.0, 1.0), 1.0); return; }
    vec2 slD = vec2(0.0); if (wn2 > 0.0) slD = tileSlope(tn2, -2, cosLatT); else if (wn1 > 0.0) slD = tileSlope(tn1, -1, cosLatT);
    fragColor = vec4(vec3(clamp(0.5 + (uDbg < 5.5 ? slD.x : slD.y) * 60.0, 0.0, 1.0)), 1.0); return;
  }` : ''}

  // Sun-Moon-viewer angle, per pixel.
  float phase = acos(clamp(dot(V, uS), -1.0, 1.0)) * 180.0 / PI;
  // With the Sun behind the camera and a near limb seen edge-on, mu0 > mu
  // and the Lommel-Seeliger part, 2 mu0 / (mu0 + mu), doubles toward the
  // limb in a bright rim that the regolith's roughness hides. Within LIMB_CAP_DEG
  // of the view horizon the view cosine is raised toward mu0 (never above
  // it), which caps the term at its mu0 = mu value and leaves the
  // terminator alone.
  float capL = smoothstep(${LIMB_CAP_DEG.toFixed(1)}, 0.0, elevV);
  float muL = max(mu, mu0 * capL);
  if (mu0 > 0.0) {
    float L = lunarL(phase);
    sun = albedo * phaseA(phase) * (2.0 * L * mu0 / (mu0 + muL + 1e-5) + (1.0 - L) * mu0) * lit;
  }
  // The final pass reads ground with a Sun key under 1 (sunKey below, ramped over -1.7 to 6.9 degrees of Sun elevation) on a LONG exposure, which
  // saturates at any light above the earthshine: a fill that is merely small there is drawn as a flat grey sheet ending in a straight line at the
  // terminator (WP4 shipped exactly that). The fill therefore follows the key to the power FILL_RAMP_POWER, so it is invisible where the long exposure rules
  // and only arrives, gradually, where the short exposure does.
  ${LOOK_W_GLSL}float fillKey = smoothstep(${SUN_KEY_LO.toFixed(3)}, ${SUN_KEY_HI.toFixed(3)}, dot(p, uS));
  // Two looks, each with its own fill; the blend mixes the two fills (not their ingredients), so no mid-altitude pose is lit more than both ends.
  float fillRamp = ${LOOK_ALT ? `1.0;
  float rampA = pow(fillKey, ${FILL_RAMP_POWER.toFixed(2)});
  float rampO = pow(smoothstep(-0.03, 0.12, dot(p, uS)), 4.0) * 0.75` : `pow(fillKey, ${FILL_RAMP_POWER.toFixed(2)})`};
  // Shadows are not black: a modelled share (SHADOW_FILL) of the sunlight reaches shadowed ground as light scattered from the ground around, which
  // the 474 m relief's oversized shadows would otherwise draw as hard black polygons. Keyed on the SPHERE's Sun elevation, not the slope's cosine, so
  // it is zero on the night side and cannot light single slopes there.
${tiles && deepOf(tileDeepest) < 0 ? `  // Over the deep ground the fill follows the slope: ground that faces away from the sphere's up sees less of the lit surroundings, so a shadow shows its
  // relief (a flat share of 3 % drew every shadow as one flat polygon). Flat ground keeps exactly SHADOW_FILL; a wall at 60 degrees gets 0.55 of it.
  float fillShade = mix(0.55, 1.0, clamp(dot(nrm, p), 0.0, 1.0));
  ${FILL_DEST} albedo * phaseA(phase) * max(dot(p, uS), 0.0) * SHADOW_FILL * fillRamp * fillShade * (1.0 - lit);` : `  ${FILL_DEST} albedo * phaseA(phase) * max(dot(p, uS), 0.0) * SHADOW_FILL * fillRamp * (1.0 - lit);`}

  // ---- The Earth's shadow (src/eclipse/): the share of sunlight, per linear
  // RGB channel, that reaches this point past the Earth, split into the
  // direct part (penumbra) and the reddened light bent through the Earth's
  // air. Exactly 1 and 0 away from an eclipse, so other dates are unchanged.
  vec3 sunRefracted;
  vec3 sunDirect = earthShadowOnMoonParts(p, uSunPos, uEarthPos, sunRefracted);
${RADIANCE_KEY ? `  vec3 sunLight = sunDirect + sunRefracted;\n  sun *= sunLight;\n  fillT *= sunLight;` : `  sun *= sunDirect + sunRefracted;`}

  // Earthshine, lit from the Earth's direction: the earthlit ground shades
  // and dims away from the Earth as sunlit ground does away from the Sun;
  // from the Earth's centre the phase is ~0 and the opposition surge full.
  // The Earth is a disc 1.9 deg wide: a surface whose horizon cuts it is still lit by the part above (poles, where the Earth hugs the horizon).
  float earthR = asin(min(6371.0 / (length(uEarthPos) * R_KM), 1.0));
  float muE = earthDiscMu(dot(nrm, uEarth), earthR);
  float phaseE = acos(clamp(dot(V, uEarth), -1.0, 1.0)) * 180.0 / PI;
  float LE = lunarL(phaseE);
  float muLE = max(mu, muE * capL);
  float phaseAE = phaseA(max(phaseE, 0.5));
  vec3 es = albedo * EARTH_TINT * uEarthshine * phaseAE
    * (2.0 * LE * muE / (muE + muLE + 1e-4) + (1.0 - LE) * muE);
  // Ground the Earth does not stand over is not black: the terrain around it passes on a small share of the earthshine (an estimate, scaled by the computed earthshine).
  es += albedo * EARTH_TINT * uEarthshine * AMBIENT_ES * 0.5;
${RADIANCE_KEY ? `  // The fill counts once it is clearly above earthshine (FILL_ES_LO..HI), so ground it would only lift to the long exposure's grey stays at earthshine.
  float esL = max(dot(es, vec3(0.2126, 0.7152, 0.0722)), 1e-12);
  sun += ${LOOK_ALT ? `fillT * ((1.0 - lookW) * rampO + pow(lookW, 4.0) * rampA * smoothstep(${FILL_ES_LO.toFixed(2)}, ${FILL_ES_HI.toFixed(2)}, dot(fillT * rampA, vec3(0.2126, 0.7152, 0.0722)) / esL))` : `fillT * smoothstep(${FILL_ES_LO.toFixed(2)}, ${FILL_ES_HI.toFixed(2)}, dot(fillT, vec3(0.2126, 0.7152, 0.0722)) / esL)`};
  // Radiance key: ground whose sunlit-plus-fill light is a few times earthshine is read on the short exposure whatever the sphere's Sun elevation.
  float radKey = smoothstep(${RAD_KEY_LO.toFixed(2)}, ${RAD_KEY_HI.toFixed(2)}, dot(sun, vec3(0.2126, 0.7152, 0.0722)) / esL);
` : ''}
  // The ground's own light, in units of the exposure's white (the final pass's x on the short exposure), before the display floor below: the
  // hover highlight's wash follows it, so the floor cannot earn a wash.
${ablate.has('shading') ? '  // ?ablate=shading (dev): the lighting reduced to albedo x lit, so its cost can be read as a difference.\n  sun = albedo * max(mu0, 0.0) * lit; es = vec3(0.0);\n' : ''}  float groundLum = dot(sun + es, vec3(0.2126, 0.7152, 0.0722)) * cover / uTopoWhiteIF;
  if (uNightFloor > 0.0) {
    // The night side's display floor (?nightfloor=, src/post/exposure.ts nightFloorRadiance): a look, not light. Unlit ground (the Sun below the
    // sphere's horizon, ramped against the fill key over NIGHT_FLOOR_EDGE..0.120) is lifted by the radiance the current
    // exposure shows at the asked share of display white, in its own colour and albedo, so the surface and its relief of albedo stay readable under the
    // labels where earthshine is nil (the far side; near full Moon). Solved on the CPU per frame against the final pass's own curve, so the long
    // exposure never saturates it into the flat sheet of the #58 fill. The sky gets nothing (cover). It sits after the fill's hand-off and the
    // radiance key (esL), which must see the earthshine alone.
    es += albedo * (uNightFloor / 0.12) * (1.0 - smoothstep(${NIGHT_FLOOR_EDGE.toFixed(3)}, 0.120, dot(p, uS)));
  }
  // Pre-exposed for the half-float store (README): raw I/F puts earthlit
  // ground near 1e-6, which many phone GPUs flush to zero channel by channel.
  vec3 col = flush16((sun + es) * cover * uPreExpose);
  // Alpha is the exposure key: 1 on sunlit ground, ramped over ~8 deg of
  // Sun elevation at the terminator.
  // Ground that gets under 2% to 5% of the Sun through the penumbra (or only
  // bent light) is read on the long exposure, as a camera would in totality.
  // The key is the ground's own exposure key, not premultiplied by the pixel's coverage, when the horizon AA is on (?horizon=): the final pass fuses a short and a
  // long exposure by this alpha, and a partly covered edge pixel with a key of its coverage was drawn on the long exposure, which saturates, so the
  // antialiased edge came out as a hard step. The colour keeps its coverage; with the key whole the pixel is read on the short exposure, linear in coverage.
  float sunKey = (uHzK > 0.5 ? 1.0 : cover) * ${SUN_EXPOSURE_KEY_GLSL}
    * smoothstep(0.003, 0.03, dot(sunDirect, vec3(0.2126, 0.7152, 0.0722)));
  if (uHlOn > 0.001) {
    vec3 hb = vec3(dot(p, uX), dot(p, uY), dot(p, uK));
    float hd = acos(clamp(dot(hb, uHlDir.xyz), -1.0, 1.0));
    float hr = max(uHlDir.w, 1e-4);
    float hw = 0.0;
    // The rim's own weight (a disc only): the wash keeps a thin floor on it where the interior gets none.
    float hwRim = 0.0;
    if (uHlMode > 0.5) {
      // A sea is its dark lava, not a circle: ground darker than the highlands (normal albedo under about 0.09, mare basalt is
      // ~0.07) that lies nearer this sea's centre, in units of its own radius, than any other labelled sea's.
      float mine = hd / hr;
      float other = 1e9;
      for (int i = 0; i < ${HL_SEAS}; i++) {
        if (i >= uHlSeaCount) break;
        if (i == uHlSel) continue;
        other = min(other, acos(clamp(dot(hb, uHlSeas[i].xyz), -1.0, 1.0)) / max(uHlSeas[i].w, 1e-4));
      }
      float dark = 1.0 - smoothstep(0.082, 0.108, dot(albedo, vec3(0.2126, 0.7152, 0.0722)));
      hw = dark * smoothstep(-0.08, 0.08, other - mine) * (1.0 - smoothstep(1.0, 1.35, mine));
    } else {
      float edge = max(hr * 0.07, 0.0012);
${HL_WASH_LEGACY ? '' : `      // Bounded in output pixels: a close crater's rim was a broad band (kmPerPx is the pixel's size at the hit).
      edge = min(edge, ${HL_RIM_MAX_PX.toFixed(1)} * length(uCamPos - hitPos) * uTileTanPerPx / 1.3);
`}      hwRim = ${HL_RIM.toFixed(2)} * (1.0 - smoothstep(0.0, edge * 1.3, abs(hd - hr)));
      hw = ${HL_FILL.toFixed(2)} * (1.0 - smoothstep(hr - edge, hr + edge, hd)) + hwRim;
    }
    float ha = clamp(hw, 0.0, 1.0) * uHlOn;
${HL_WASH_LEGACY ? `    // Lit ground is lifted a little; every pixel of the area gets a gold wash at a fixed share of the current exposure's white,
    // read on the short exposure (sunKey), so the area shows the same by day, at the terminator and on the earthlit night side.
    col = col * (1.0 + 0.25 * ha) + flush16(uHlTint * (0.16 * uTopoWhiteIF * ha) * cover * uPreExpose);
    sunKey = mix(sunKey, max(sunKey, cover), ha);` : `    // Lit ground is lifted a little, and gets a gold wash at a share of the current exposure's white that follows the ground's own light
    // (src/labels/highlightFit.ts highlightWash): the full wash on sunlit ground, as before; none on unlit ground, where a fixed share of white drew
    // an unlit far-side crater as an opaque tan disc (owner, 2026-10-23), only the rim's thin floor. The pixel moves to the short exposure by the
    // same share, so an unlit interior stays on its long exposure (earthshine, the night floor).
    float hlProp = hlWashProp(groundLum);
    float haRad = clamp((hw - hwRim) * hlProp + hwRim * max(hlProp, ${HL_RIM_DARK_PROP.toFixed(4)}), 0.0, 1.0) * uHlOn;
    col = col * (1.0 + ${HL_LIFT.toFixed(2)} * ha) + flush16(uHlTint * (${HL_WASH_WHITE.toFixed(2)} * uTopoWhiteIF * haRad) * cover * uPreExpose);
    sunKey = mix(sunKey, max(sunKey, cover), haRad);`}
  }
  if (uTopoOn > 0.5) {
    // Compare this pixel's rendered ground against a broader global-map mip. The height at p uses
    // the same global + tile + fused patch composition as the ground march, with no new sampler.
    float topoH = ${tiles ? 'topographyHQ(p, -3, lod0, kmPerPx * 1000.0 / max(muP, 0.15))' : 'heightAt(uv, lodN)'};
    float topoRef = heightAt(uv, min(float(uHeightLevels - 1), lodN + 3.0));
    float topoT = 0.5 + 0.5 * clamp((topoH - topoRef) / max(uTopoRangeM, 1.0), -1.0, 1.0);
    // The final pass divides by its current white point; scale against that same exposure so this
    // synthetic display layer remains saturated instead of clipping to white as the camera re-exposes.
    float topoRelief = 0.42 + 0.58 * max(0.0, dot(nrm, normalize(p + 0.32 * e + 0.38 * n)));
    col = flush16(elevationColor(topoT) * (0.65 * uTopoWhiteIF) * topoRelief * cover * uPreExpose);
    sunKey = cover;
  }
${metadata ? `  // Independent hit-derived display metadata, never the scene exposure alpha.
  float earthT = sphereHit(uCamPos, rr, uEarthPos, 6371.0 / R_KM);
  float moonT = dot(hitPos - uCamPos, rr);
  // The established virtual Earth-centre telescope observer is inside the Earth; no front surface is rendered there.
  if (earthT > 0.0 && earthT < moonT) discard;
  float night = 1.0 - smoothstep(-0.08, -0.03, dot(p, uS));
  // Eclipse totality is eligible; sunlit crater shadows remain untouched.
  night = max(night, 1.0 - smoothstep(0.003, 0.03, dot(sunDirect, vec3(0.2126, 0.7152, 0.0722))));
  fragColor = vec4(cover, night * cover, clamp(dot(albedo, vec3(0.2126, 0.7152, 0.0722)) / 0.2, 0.0, 1.0) * cover, clamp(muP, 0.0, 1.0) * cover);` : '  fragColor = vec4(col, sunKey);'}
}
`
}
