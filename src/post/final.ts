import { currentSharp } from '../quality/sharp'
import { phoneMotionOn } from '../quality/sharpMotion'
import { catmullOn, upscaleMode, type UpscaleMode } from './upscale'
import * as THREE from 'three'
import { FullscreenPass } from './fullscreen'
import { trackGpu } from '../quality/track'
import { DATE_CROSSFADE_MS, RefinementClock } from '../journey/dateTransition'
import { edgeK } from './edgeSharpen'
import { thinStrength, thinSwitches, ISOLATED_LO, ISOLATED_HI } from './thinClamp'

/** Size of the previous-frame copy a crossfade starts from: the canvas when one is given and larger than the frame, else the frame. */
export function previousSize(w: number, h: number, canvas?: { w: number; h: number }): [number, number] {
  return canvas && canvas.w > w ? [canvas.w, canvas.h] : [w, h]
}
/** Ease back to full detail without a visible focus snap on release. */
export const REFINE_CROSSFADE_MS = 120
/** ?a10thin=0|2 and ?a10ratio=: see thinClamp.ts. `?a10keep=1` keeps a clamped texel's excess over its neighbours shared out over the magnification instead of pulling it to them (rig: dashes stay, 7000 px vs 280, so off). */
const THIN = thinSwitches(typeof location === 'undefined' ? '' : location.search)
const THIN_KEEP = typeof location !== 'undefined' && new URLSearchParams(location.search).get('a10keep') === '1' ? 1 : 0
/** ?sharpen=0 keeps plain bilinear reconstruction for comparison. */
const SHARPEN_ON = typeof location === 'undefined' || new URLSearchParams(location.search).get('sharpen') !== '0'
/** Keep motion-grid silhouette reconstruction enabled; flip here for code-level A/B checks. */
const EDGE_ON = true
/** Chosen on first use (after initQuality has set the sharp holder; module load is earlier). */
let upscale: UpscaleMode | null = null
/** Target transition width on the full-resolution canvas, tuned from the reference rigs. */
const REST_EDGE_CSS_PX = 0.55
/** `?shoulder=legacy` restores the previous orbit highlight rolloff for A/B. */
const LEGACY_SHOULDER = typeof location !== 'undefined' && new URLSearchParams(location.search).get('shoulder') === 'legacy'
import type { Exposure } from './exposure'
import type { TargetSet } from './targets'
import { VISIBILITY_GLSL, validateCalibration, type VisibilityCalibration } from './visibility'
import { WEIGHTS } from './glare'
import type { SunGlare } from '../sun/SunPass'
import { SUN_LOOK_GLSL } from '../sun/sunLook'
import { SKY_GLSL, SKY_MARGIN_PX } from '../sky/skyStars'
import { DOT_ALPHA_HIDE, STAR_DOT_GAIN, StarDots, starPathsForFrame } from '../sky/starDots'
import type { StarPass } from '../sky/stars'
import { SUN_COVER_FRAGMENT_GLSL, SUN_COVER_VERTEX_GLSL } from '../sun/sunCoverage'

/** Whether the URL requests a Moon shader diagnostic view. */
export function diagnosticViewEnabled(search: string): boolean {
  const value = Number(new URLSearchParams(search).get('dbg'))
  return (Number.isFinite(value) && value > 0.5) || (import.meta.env?.VITE_NATIVE_BUILD !== 'true' && new URLSearchParams(search).get('shadowdebug') === 'serve')
}

/**
 * The camera: glare, the two exposures fused per pixel, the shoulder, sRGB
 * and grain (moon-v1's FINAL_FS without the air's aureole).
 */

const HASH_GLSL = /* glsl */ `
uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
uint pcg3(uvec3 v) { return pcg(v.x ^ pcg(v.y ^ pcg(v.z))); }
float u01(uint h) { return float(h >> 8u) / 16777216.0; }
`

/** The post vertex shader plus the Sun's foreground open share (sunCoverage.ts), computed once per vertex and passed flat so no pixel repeats the 16 depth reads. */
export const FINAL_VERTEX = /* glsl */ `
out vec2 vUv;
${SUN_COVER_VERTEX_GLSL}
void main() {
  vUv = position.xy * 0.5 + 0.5;
  vFgOpen = sunFgOpenShare();
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export const FINAL_FRAGMENT = /* glsl */ `
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uPrevious;
uniform float uDateBlend;
uniform sampler2D uScene;
uniform sampler2D uDisplay; // tone-mapped scene, before canvas-space effects
uniform int uStage; // 0: full-resolution composite, 1: tone map, 2: reconstruct display
uniform sampler2D uMoonMetadata;
uniform vec2 uVisibilityLevels;
uniform float uVisibilityOn;
uniform sampler2D uGlare;
uniform sampler2D uAureole; // a coarser level of the glare pyramid: arcminutes, not the frame
uniform vec3 uHazeTint;
uniform float uHazeGain;     // aerosol forward scattering (the ridge view's air); 0 elsewhere
uniform float uGlareGain;
uniform float uMoonGlare;     // Bloom from the lunar disc fades out on its unlit hemisphere
uniform float uWhite;        // stored value that maps to white (I/F x pre-exposure)
uniform float uHdr;          // 0 = one exposure, 1 = two exposures fused
uniform float uEsLevel;      // earthlit highland level, in units of uWhite
uniform float uLongMax;      // where the long exposure tops out
uniform float uStarLift;     // no sunlit ground in view: stars may rise above uLongMax
uniform uint uSeed;
uniform vec2 uSunUv;         // the Sun's centre in the frame, 0..1
uniform vec3 uSunMissing;    // flux the stored disc's clamp removed, stored units x target px^2
uniform vec2 uTargetPx;      // scene target size, px
uniform vec2 uCanvasPx;      // final output size, px
uniform mat4 uSunInvViewProj;
uniform vec3 uSunCamPos;
uniform float uSharpen;      // 1: suppress coarse-grid sparkle, 0: plain bilinear
uniform float uThinLo;       // A10: brightness ratio (texel over the dimmer axis' brighter neighbour) where the clamp starts
uniform float uThinMag;      // A10: canvas px per render texel
uniform float uThinKeep;     // A10: 1 keeps the excess over the neighbours shared out over uThinMag, 0 pulls to the neighbours
uniform float uThin;         // A10: 0..1, clamp one-texel-thin bright Moon texels on dark ground (coarse motion grids, tone-map pass)
uniform float uCatmull;      // 1: Catmull-Rom stage-2 (post/upscale.ts), 0: the bilinear path
uniform float uEdgeK;        // half-width of the edge-aware reconstruction (0.5: identity)
uniform float uSunGlareOn;
uniform float uSunGlow;      // 0..1 display-space lens glow around the Sun
uniform float uSunLook;      // 1: the display-space Sun look (sun/sunLook.ts) replaces the uSunGlow block
uniform float uSunDirect;    // 1: the Sun's disc is drawn here in display space, not stored in the scene (so it feeds no glare pyramid)
uniform float uMoonMetadataOn; // metadata is current only during calibration and audit frames
uniform vec3 uEarthOcc;      // the Earth's disc in the scene target: uv.xy and radius in px (0 radius: none)
uniform float uSunDiscPx;    // the Sun's disc radius in scene-target px
uniform float uSkyGain;      // sky-star lift gain (sky/skyStars.ts); 0: off (ground mode, flights, no stars)
uniform float uSunDiscCanvasPx; // the same radius in CANVAS px: the look is gated on what the visitor sees, so the motion grid (a smaller target) never fades it
uniform float uShoulder;     // ground mode: a long shoulder above 0.8, so a bright module keeps its detail instead of clipping
uniform float uDiagnosticView; // shader debug values are linear display data; bypass the scene exposure/look
uniform sampler2D uStarDots;   // the native star layer (sky/starDots.ts): linear display y of each star's dot per canvas pixel, unmasked
uniform float uStarDotsOn;     // 1: composite it (?stars=native); 0: the stars are scene sprites, nothing to do here
uniform float uStarFgOn;       // 1: the scene target has depth (ground mode, a flight's lander): foreground for the dots, whatever the Sun's routing
uniform vec3 uEarthDisc;       // the Earth's disc in the scene target whenever it is in front of the camera (SunGlare.earthDisc): uv.xy, radius px
uniform float uGlareW[6];
${HASH_GLSL}
${VISIBILITY_GLSL}
${SUN_LOOK_GLSL}
${SKY_GLSL}
${SUN_COVER_FRAGMENT_GLSL}
vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
// Bilinearly reconstruct one coverage class without borrowing colour from the
// other side of the silhouette. If the current footprint has no weight from
// this class, use its nearest texel so the colour stays spatially continuous.
vec4 coverageClassColour(vec4 c00, vec4 c10, vec4 c01, vec4 c11, vec4 alpha,
                         vec4 weights, vec2 f, float midpoint, bool highClass) {
  vec4 member = step(vec4(midpoint), alpha);
  if (!highClass) member = vec4(1.0) - member;
  vec4 classWeights = weights * member;
  float sumWeights = dot(classWeights, vec4(1.0));
  if (sumWeights > 1e-6) {
    return (c00 * classWeights.x + c10 * classWeights.y
          + c01 * classWeights.z + c11 * classWeights.w) / sumWeights;
  }
  vec4 distance = vec4(dot(f, f), dot(f - vec2(1.0, 0.0), f - vec2(1.0, 0.0)),
                       dot(f - vec2(0.0, 1.0), f - vec2(0.0, 1.0)),
                       dot(f - vec2(1.0), f - vec2(1.0)));
  float nearestDistance = 1e20;
  vec4 nearestColour = c00;
  if (member.x > 0.5 && distance.x < nearestDistance) { nearestDistance = distance.x; nearestColour = c00; }
  if (member.y > 0.5 && distance.y < nearestDistance) { nearestDistance = distance.y; nearestColour = c10; }
  if (member.z > 0.5 && distance.z < nearestDistance) { nearestDistance = distance.z; nearestColour = c01; }
  if (member.w > 0.5 && distance.w < nearestDistance) { nearestDistance = distance.w; nearestColour = c11; }
  return nearestColour;
}
// The tone-mapped image magnified to the canvas. Never interpolate HDR radiance
// and its exposure key here: their nonlinear fusion creates false gray maxima.
// Reconstruct silhouettes from scene coverage, not display luminance: glare
// lifts the sky around the Moon's limb, so it is not reliably near black.
// Suppress isolated high-contrast subpixel detail, not coherent crater edges.
// A boosted cubic kernel made tiny shadow samples look like moving grit. These
// five positive-weight reads cannot ring or invent a brighter exposure halo.
vec4 sceneRead(vec2 uv) {
  vec4 c = texture(uDisplay, uv);
  if (uEdgeK < 0.4999) {
    vec2 base = floor(uv * uTargetPx - 0.5);
    vec2 invSize = 1.0 / uTargetPx;
    vec2 uv00 = (base + vec2(0.5, 0.5)) * invSize;
    vec2 uv10 = (base + vec2(1.5, 0.5)) * invSize;
    vec2 uv01 = (base + vec2(0.5, 1.5)) * invSize;
    vec2 uv11 = (base + vec2(1.5, 1.5)) * invSize;
    vec4 a = texture(uDisplay, uv00);
    vec4 b = texture(uDisplay, uv10);
    vec4 d = texture(uDisplay, uv01);
    vec4 e = texture(uDisplay, uv11);
    float aa = texture(uScene, uv00).a;
    float ab = texture(uScene, uv10).a;
    float ad = texture(uScene, uv01).a;
    float ae = texture(uScene, uv11).a;
    float aLo = min(min(aa, ab), min(ad, ae));
    float aHi = max(max(aa, ab), max(ad, ae));
    // The Moon is opaque at its limb; the high-alpha threshold rejects faint
    // stars whose isolated coverage would otherwise resemble a silhouette.
    if (aHi > 0.9 && aHi - aLo > 0.5) {
      // Limitation: this classifier only sees silhouette edges encoded by
      // scene alpha; opaque edges with uniform coverage remain bilinear.
      vec2 f = fract(uv * uTargetPx - 0.5);
      vec4 weights = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y),
                          (1.0 - f.x) * f.y, f.x * f.y);
      float midpoint = 0.5 * (aLo + aHi);
      vec4 alpha = vec4(aa, ab, ad, ae);
      vec4 lowColour = coverageClassColour(a, b, d, e, alpha, weights, f, midpoint, false);
      vec4 highColour = coverageClassColour(a, b, d, e, alpha, weights, f, midpoint, true);
      float alphaBilinear = texture(uScene, uv).a;
      float t = clamp((alphaBilinear - aLo) / max(aHi - aLo, 1e-6), 0.0, 1.0);
      float tSharp = smoothstep(0.5 - uEdgeK, 0.5 + uEdgeK, t);
      // Preserve this bounded silhouette reconstruction; the anti-sparkle
      // kernel below remains active for interior detail only.
      return mix(lowColour, highColour, tSharp);
    }
  }
  if (uCatmull > 0.5) {
    // Catmull-Rom in five bilinear fetches (corners dropped, weights renormalised), then a light unsharp masked to opaque scene alpha.
    vec2 pos = uv * uTargetPx;
    vec2 tc = floor(pos - 0.5) + 0.5;
    vec2 f = pos - tc;
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (-0.5 + 0.5 * f);
    vec2 w12 = w1 + w2;
    vec2 t12 = (tc + w2 / w12) / uTargetPx;
    vec2 t0 = (tc - 1.0) / uTargetPx;
    vec2 t3 = (tc + 2.0) / uTargetPx;
    vec4 cr = texture(uDisplay, vec2(t12.x, t0.y)) * (w12.x * w0.y)
            + texture(uDisplay, vec2(t0.x, t12.y)) * (w0.x * w12.y)
            + texture(uDisplay, t12) * (w12.x * w12.y)
            + texture(uDisplay, vec2(t3.x, t12.y)) * (w3.x * w12.y)
            + texture(uDisplay, vec2(t12.x, t3.y)) * (w12.x * w3.y);
    cr /= (w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y);
    float opaque = smoothstep(0.97, 1.0, texture(uScene, uv).a);
    return max(cr + 0.25 * opaque * (cr - c), 0.0);
  }
  if (uSharpen <= 0.001) return c;
  vec2 px = 1.0 / uTargetPx;
  vec4 n = texture(uDisplay, uv + vec2(0.0, px.y));
  vec4 s = texture(uDisplay, uv - vec2(0.0, px.y));
  vec4 e = texture(uDisplay, uv + vec2(px.x, 0.0));
  vec4 w = texture(uDisplay, uv - vec2(px.x, 0.0));
  vec4 mean = (n + s + e + w) * 0.25;
  float lo = min(c.g, min(min(n.g, s.g), min(e.g, w.g)));
  float hi = max(c.g, max(max(n.g, s.g), max(e.g, w.g)));
  // An edge's linear ramp has little curvature; a one-pixel glint or alternating
  // shadow pattern has a lot. Keep low-contrast albedo texture untouched.
  float contrast = hi - lo;
  float curvature = abs(mean.g - c.g) / max(contrast, 0.001);
  float weight = 0.65 * uSharpen * smoothstep(0.04, 0.18, contrast) * smoothstep(0.15, 0.55, curvature);
  return mix(c, mean, weight);
}

// 1 where nothing in front hides the Sun's disc, 0 on the Moon, the Earth, terrain and the lunar module: the Moon's metadata (calibration and audit
// frames), the analytic lunar sphere along the reconstructed output ray, the Earth's disc, and (ground mode, a flight's lander) the scene target's depth.
float bodiesHide(float margin) {
  vec4 mm = texture(uMoonMetadata, vUv);
  float hide = 1.0 - clamp(mm.r, 0.0, 1.0) * uMoonMetadataOn;
  // Test the reconstructed output ray against the actual lunar sphere.
  // Unlike a projected circle this remains correct at grazing angles and
  // wide fields of view. Derivative-width softening covers the one-pixel limb.
  vec4 farPoint = uSunInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 ray = normalize(farPoint.xyz / farPoint.w - uSunCamPos);
  float b = dot(uSunCamPos, ray);
  float h = b * b - dot(uSunCamPos, uSunCamPos) + 1.0;
  float limbWidth = max(fwidth(h), 1e-7);
  // margin px of extra coverage outside the limb (h falls by about limbWidth per px outside it); 0 is the exact limb.
  float moonCoverage = b < 0.0 ? smoothstep(-(0.5 + margin) * limbWidth, (0.5 - margin) * limbWidth, h) : 0.0;
  hide *= 1.0 - moonCoverage;
  if (uEarthOcc.z > 0.0) {
    float sceneToCanvas = uCanvasPx.x / uTargetPx.x;
    hide *= smoothstep(uEarthOcc.z * sceneToCanvas - 0.5 + margin, uEarthOcc.z * sceneToCanvas + 0.5 + margin, length((vUv - uEarthOcc.xy) * uCanvasPx));
  }
  hide *= 1.0 - sunFgCover(vUv);
  return hide;
}
float sunHide() { return bodiesHide(0.0); }

// Foreground for the star dots: sunFgCover's bilinear depth read, keyed on the depth attachment alone (uStarFgOn). sunFgCover is keyed on the Sun's
// routing (uFgOn = SunGlare.cover, false with the Sun behind the camera or not drawn in display space), which is no statement about the terrain.
float starFgCover(vec2 uv) {
  if (uStarFgOn < 0.5) return 0.0;
  ivec2 hi = ivec2(uTargetPx) - 1;
  vec2 p = uv * uTargetPx - 0.5;
  vec2 fr = fract(p);
  ivec2 i0 = ivec2(floor(p));
  float c00 = texelFetch(uSceneDepth, clamp(i0, ivec2(0), hi), 0).r < 1.0 ? 1.0 : 0.0;
  float c10 = texelFetch(uSceneDepth, clamp(i0 + ivec2(1, 0), ivec2(0), hi), 0).r < 1.0 ? 1.0 : 0.0;
  float c01 = texelFetch(uSceneDepth, clamp(i0 + ivec2(0, 1), ivec2(0), hi), 0).r < 1.0 ? 1.0 : 0.0;
  float c11 = texelFetch(uSceneDepth, clamp(i0 + ivec2(1, 1), ivec2(0), hi), 0).r < 1.0 ? 1.0 : 0.0;
  return mix(mix(c00, c10, fr.x), mix(c01, c11, fr.x), fr.y);
}
// 1 where a star dot may show: the same lunar-sphere test as bodiesHide (margin SKY_MARGIN_PX, the metadata in calibration frames), the Earth's disc
// whenever it is in front of the camera (uEarthDisc, not the Sun's earthOcc, which exists only for a display-space Sun), foreground depth (starFgCover),
// and the scene itself: scene alpha is the exposure key (0 on shadowed slopes and at night, so it alone proves nothing), but in native mode the sky
// holds no stars, so any scene light at all (the Moon's night side, earthlit ground, the dark Earth, relief above the analytic limb) is a body.
float starSky() {
  const float margin = ${SKY_MARGIN_PX.toFixed(1)};
  vec4 mm = texture(uMoonMetadata, vUv);
  float sky = 1.0 - clamp(mm.r, 0.0, 1.0) * uMoonMetadataOn;
  vec4 farPoint = uSunInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 ray = normalize(farPoint.xyz / farPoint.w - uSunCamPos);
  float b = dot(uSunCamPos, ray);
  float h = b * b - dot(uSunCamPos, uSunCamPos) + 1.0;
  float limbWidth = max(fwidth(h), 1e-7);
  float moonCoverage = b < 0.0 ? smoothstep(-(0.5 + margin) * limbWidth, (0.5 - margin) * limbWidth, h) : 0.0;
  sky *= 1.0 - moonCoverage;
  if (uEarthDisc.z > 0.0) {
    float sceneToCanvas = uCanvasPx.x / uTargetPx.x;
    sky *= smoothstep(uEarthDisc.z * sceneToCanvas - 0.5 + margin, uEarthDisc.z * sceneToCanvas + 0.5 + margin, length((vUv - uEarthDisc.xy) * uCanvasPx));
  }
  sky *= 1.0 - starFgCover(vUv);
  vec4 sc = texture(uScene, vUv);
  sky *= 1.0 - smoothstep(0.0, ${DOT_ALPHA_HIDE.toFixed(3)}, sc.a);
  sky *= dot(sc.rgb, vec3(0.2126, 0.7152, 0.0722)) > 0.0 ? 0.0 : 1.0;
  return sky;
}
// The stars as native dots (sky/starDots.ts), over the finished display pixel s: the layer's dot (the star's amplitude times its own Gaussian, times STAR_DOT_GAIN),
// hidden where starSky() is 0, then the picture's own shoulder, toe and sRGB, screened over the sky: adds over black, never darkens, saturates
// at white instead of clipping.
vec3 starDots(vec3 s) {
  if (uStarDotsOn < 0.5) return s;
  // The mask first, in uniform control flow: starSky takes derivatives (fwidth), undefined after a per-pixel early return.
  // STAR_DOT_GAIN: the display gain on the dots (sky/starDots.ts, owner 2026-10-31: too dim on a phone).
  float y = texture(uStarDots, vUv).r * starSky() * ${STAR_DOT_GAIN.toFixed(3)};
  if (y <= 0.0) return s;
  if (y > 0.8) {
    float d = y - 0.8;
    float yOrbit = ${LEGACY_SHOULDER ? '0.8 + 0.2 * tanh(d / 0.2)' : '0.8 + 0.2 * d / (0.2 + d)'};
    float yGround = 0.8 + 0.2 * tanh(log2(y / 0.8) * 0.35);
    y = mix(yOrbit, yGround, clamp(uShoulder, 0.0, 1.0));
  }
  y = y * y * (3.0 - 2.0 * y) * 0.25 + y * 0.75;
  float dot8 = toSrgb(vec3(y)).r;
  return 1.0 - (1.0 - s) * (1.0 - dot8);
}

void main() {
  vec3 s;
  if (uStage == 2) {
    s = sceneRead(vUv).rgb;
    if (uDiagnosticView > 0.5) { fragColor = vec4(s, 1.0); return; }
  } else {
  // Full-size pixels and the motion tone-map pass sample texel centres.
  vec4 sc = texture(uScene, vUv);
  if (uDiagnosticView > 0.5) {
    fragColor = vec4(toSrgb(clamp(sc.rgb, 0.0, 1.0)), 1.0);
    return;
  }
  if (uThin > 0.001 && uStage == 1) {
    // A sunlit texel (alpha: the exposure key) much brighter than the texels across it on BOTH sides in either axis (one texel thin) is sub-pixel detail the
    // coarse grid over-sizes 4-8x (dashes of lit crest on dark ground). Its excess over the neighbours is shared out over the magnification, so a real peak
    // stays as a dimmer glow instead of vanishing. Not applied: outside the lunar disc or within 2 texels of its limb (stars, crescent horns), on foreground
    // (the lander, ground mode), on texels that are not sunlit (earthshine spots, e.g. Aristarchus).
    vec4 fp = uSunInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 ry = normalize(fp.xyz / fp.w - uSunCamPos);
    float bb = dot(uSunCamPos, ry);
    float hh = bb * bb - dot(uSunCamPos, uSunCamPos) + 1.0;
    float hw = fwidth(hh);
    float inDisc = (bb < 0.0 && hh > 2.0 * hw) ? 1.0 : 0.0;
    vec2 tp = 1.0 / uTargetPx;
    vec4 sn4 = texture(uScene, vUv + vec2(0.0, tp.y)), ss4 = texture(uScene, vUv - vec2(0.0, tp.y));
    vec4 se4 = texture(uScene, vUv + vec2(tp.x, 0.0)), sw4 = texture(uScene, vUv - vec2(tp.x, 0.0));
    vec3 sn = sn4.rgb, ss = ss4.rgb, se = se4.rgb, sw = sw4.rgb;
    const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
    float yc = dot(sc.rgb, LW);
    float lim = min(max(dot(sn, LW), dot(ss, LW)), max(dot(se, LW), dot(sw, LW)));
${THIN.wide ? `    {
      // Two texels thin: both texels two away across the thin axis are dim.
      float yn2 = dot(texture(uScene, vUv + vec2(0.0, 2.0 * tp.y)).rgb, LW), ys2 = dot(texture(uScene, vUv - vec2(0.0, 2.0 * tp.y)).rgb, LW);
      float ye2 = dot(texture(uScene, vUv + vec2(2.0 * tp.x, 0.0)).rgb, LW), yw2 = dot(texture(uScene, vUv - vec2(2.0 * tp.x, 0.0)).rgb, LW);
      lim = min(lim, min(max(yn2, ys2), max(ye2, yw2)));
    }
` : ''}    // Context: the four texels 3 away on the diagonals. Over night ground they are dark too; in contrasty lit terrain (shadows between lit ridges) some are bright,
    // and there the clamp would darken real texture.
    vec2 t3 = 3.0 * tp;
    float wide = 0.25 * (dot(texture(uScene, vUv + t3).rgb, LW) + dot(texture(uScene, vUv - t3).rgb, LW)
      + dot(texture(uScene, vUv + vec2(t3.x, -t3.y)).rgb, LW) + dot(texture(uScene, vUv + vec2(-t3.x, t3.y)).rgb, LW));
    float quiet = 1.0 - smoothstep(0.2, 0.4, wide / max(yc, 1e-9));
    float t = uThin * inDisc * quiet * sc.a * (1.0 - sunFgCover(vUv)) * smoothstep(uThinLo, uThinLo * 1.7, yc / max(lim, 1e-9));
${THIN.peaks ? `    if (t > 0.0) {
      // A lone lit peak (nothing bright 2-3 texels away in any direction) is real terrain, not a dash of a crest line: exempt it (thinIsolation in thinClamp.ts).
      vec2 t2 = 2.0 * tp;
      float rm = 0.0;
      rm = max(rm, dot(texture(uScene, vUv + vec2(t2.x, 0.0)).rgb, LW));
      rm = max(rm, dot(texture(uScene, vUv - vec2(t2.x, 0.0)).rgb, LW));
      rm = max(rm, dot(texture(uScene, vUv + vec2(0.0, t2.y)).rgb, LW));
      rm = max(rm, dot(texture(uScene, vUv - vec2(0.0, t2.y)).rgb, LW));
      rm = max(rm, dot(texture(uScene, vUv + vec2(t3.x, 0.0)).rgb, LW));
      rm = max(rm, dot(texture(uScene, vUv - vec2(t3.x, 0.0)).rgb, LW));
      rm = max(rm, dot(texture(uScene, vUv + vec2(0.0, t3.y)).rgb, LW));
      rm = max(rm, dot(texture(uScene, vUv - vec2(0.0, t3.y)).rgb, LW));
      rm = max(rm, dot(texture(uScene, vUv + t2).rgb, LW));
      rm = max(rm, dot(texture(uScene, vUv - t2).rgb, LW));
      rm = max(rm, dot(texture(uScene, vUv + vec2(t2.x, -t2.y)).rgb, LW));
      rm = max(rm, dot(texture(uScene, vUv + vec2(-t2.x, t2.y)).rgb, LW));
      float rr = clamp(rm / max(yc, 1e-9), 0.0, 4.0);
      float iso = 1.0 - smoothstep(${ISOLATED_LO.toFixed(3)}, ${ISOLATED_HI.toFixed(3)}, rr);
      t *= 1.0 - iso;
    }
` : ''}    float keepF = uThinKeep / max(1.0, uThinMag);
    float thinTo = lim + (yc - lim) * keepF;
    sc.rgb *= mix(1.0, thinTo / max(yc, 1e-9), t);
    // The exposure blend keys on alpha (sunlit = short exposure): take the neighbours' too, or the pulled texel draws darker than the ground around it.
    sc.a = mix(sc.a, mix(min(sc.a, min(min(sn4.a, ss4.a), min(se4.a, sw4.a))), sc.a, keepF), t);
  }
  vec3 c = sc.rgb + uGlareGain * uMoonGlare * texture(uGlare, vUv).rgb + uHazeGain * uHazeTint * dot(texture(uAureole, vUv).rgb, vec3(0.333));
  if (uSunGlareOn > 0.5) {
    // The glare of the energy the Sun's clamped disc could not store: the
    // pyramid's own weights, each level a Gaussian as wide as its texel
    // (2^(i+1) px). An analytic stand-in for what the pyramid would have
    // spread had the disc been stored whole.
    vec2 dp = (vUv - uSunUv) * uTargetPx;
    float r2 = dot(dp, dp);
    float k = 0.0;
    for (int i = 0; i < 6; i++) {
      float sg = exp2(float(i + 1));
      k += uGlareW[i] * exp(-r2 / (2.0 * sg * sg)) / (6.2831853 * sg * sg);
    }
    // A warm veil, like the main app's tight corona: the Sun's light is not neutral grey.
    c += uGlareGain * k * uSunMissing * vec3(1.0, 0.985, 0.955);
  }
  float Y = max(1e-9, dot(c, vec3(0.2126, 0.7152, 0.0722)));
  float x = Y / uWhite;
  // Two exposures blended per pixel by what the ground is, as bracketed
  // earthshine photographs are merged: sunlit ground (alpha, written by the
  // Moon pass) from a short exposure that keeps the crescent's own shadows
  // dark, earthlit ground and sky from a long one that lifts them into the
  // lower third with their own contrast. Keyed on geometry, not brightness,
  // so shadows inside the crescent stay shadows, and without an image-space
  // blur, so there are no halos.
  float sE = x / max(uEsLevel, 1e-9);
  float yLong = uLongMax * (1.0 - exp(-0.7 * sE));
  // Points far above the long exposure's key (only stars, when no sunlit
  // ground is in view) keep rising instead of stopping at uLongMax, as they
  // do in a real long exposure; earthlit ground (sE up to ~2) is untouched.
  yLong += uStarLift * 0.6 * (1.0 - exp(-max(sE - 3.0, 0.0) / 12.0));
  float yShort = 0.02 + 0.98 * pow(x, 0.9);
  float fused = mix(yLong, yShort, sc.a);
  float y = mix(x, fused, uHdr);
  if (uSkyGain > 0.0) {
    // Stars beside a sunlit Moon (sky/skyStars.ts): only sky (0 on the Moon and Earth widened by the margin, and wherever the Moon pass wrote alpha),
    // from the scene's own colour so glare and haze never feed it, and faded out as the night-side long exposure takes over.
    float skyMask = bodiesHide(${SKY_MARGIN_PX.toFixed(1)}) * (1.0 - smoothstep(0.0, 0.05, sc.a));
    y = max(y, skyLift(dot(sc.rgb, vec3(0.2126, 0.7152, 0.0722)) / uWhite, skyMask, uHdr));
  }
  // Soft shoulder above 0.8: the brightest highlands stay just short of white.
  // Ground mode: the ground sits below 0.8; a sunlit white panel is 5 stops above it. Roll off on a log scale (0.8 to 0.98 across 4 stops), not by clipping.
  // uShoulder blends the two curves (eased on the CPU) so a bright slope does not step at the hand-over.
  if (y > 0.8) {
    // Fixed reference at 0.8, with unit slope at the join and a gradual
    // saturation to white. A slope searched just below x=1 keeps headroom
    // instead of entering the old tanh's near-flat region immediately.
    float d = y - 0.8;
    float yOrbit = ${LEGACY_SHOULDER ? '0.8 + 0.2 * tanh(d / 0.2)' : '0.8 + 0.2 * d / (0.2 + d)'};
    float yGround = 0.8 + 0.2 * tanh(log2(y / 0.8) * 0.35);
    y = mix(yOrbit, yGround, clamp(uShoulder, 0.0, 1.0));
  }
  // Highlights roll off to white instead of clipping in one channel.
  vec3 rgb = c / Y * y;
  // The Sun's own disc is shaped for the display (the main app's look, ported): limb darkening and a warm limb survive the exposure
  // instead of a flat white dot. Only the disc itself (pixels many times white, inside its own radius), and only once it is a few px wide.
  if (uSunGlareOn > 0.5 && uSunDiscCanvasPx > 1.5) {
    float sunM = smoothstep(6.0, 12.0, x) * smoothstep(1.5, 4.0, uSunDiscCanvasPx);
    float r = length((vUv - uSunUv) * uTargetPx) / uSunDiscPx;
    sunM *= 1.0 - smoothstep(0.97, 1.06, r);
    if (sunM > 0.0) {
      float mu = sqrt(max(0.0, 1.0 - r * r));
      vec3 disc = mix(vec3(1.0, 0.82, 0.62), vec3(1.0, 0.995, 0.98), pow(mu, 0.6)) * (0.86 + 0.14 * mu);
      rgb = mix(rgb, disc, sunM);
    }
  }
  float over = max(max(rgb.r, rgb.g), rgb.b);
  if (over > 1.0) rgb = mix(rgb / over, vec3(1.0), clamp((over - 1.0) * 0.6, 0.0, 1.0));
  // Gentle toe so the sky stays dark, as a raw file processed for the Moon.
  rgb = rgb * rgb * (3.0 - 2.0 * rgb) * 0.25 + rgb * 0.75;
  s = toSrgb(rgb);
  if (uStage == 1) { fragColor = vec4(clamp(s, 0.0, 1.0), 1.0); return; }
  }
  // Keep the analytic Sun, grain, visibility and crossfade at canvas resolution.
  if (uSunLook > 0.5) {
    // The display-space Sun look: disc, bloom, veil, rays, sky lift and grain at canvas resolution (sun/sunLook.ts), hidden per pixel by
    // the Moon, the Earth, terrain and the module. It replaces the block below, and the Sun is not in the HDR scene (no clamped disc, no analytic veil).
    s = sunLook(s, sunHide(), uSunOpen * vFgOpen, vUv, gl_FragCoord.xy);
  } else if (uSunGlow > 0.0) {
    // The Sun with the Moon as the subject. The disc is not in the HDR scene: stored a few times white, the glare pyramid spread it into a flat
    // beige plateau with a hard edge (the long exposure saturates on any glare above earthshine). It is drawn here instead, a small saturated white
    // disc, plus a lens glow whose power-law falloff has no plateau and no edge. The Moon and the Earth hide the disc; the glow stays, as on a lens.
    vec2 gp = (vUv - uSunUv) * uTargetPx;
    float gd = length(gp);
    float gd2 = gd * gd;
    float gs = max(max(uSunDiscPx, 1.0) * 2.0, 0.02 * uTargetPx.y);
    float gh = 0.09 * uTargetPx.y;
    float core = pow(1.0 / (1.0 + gd2 / (gs * gs)), 1.25);
    float halo = 0.036 * pow(1.0 / (1.0 + gd2 / (gh * gh)), 1.5);
    float gl = clamp((0.9 * core + halo) * uSunGlow, 0.0, 1.0);
    vec3 warm = vec3(1.0, 0.985, 0.955);
    s = 1.0 - (1.0 - s) * (1.0 - gl * warm);
    if (uSunDirect > 0.5) {
      vec2 cp = (vUv - uSunUv) * uCanvasPx;
      float cd = length(cp);
      float dr = max(uSunDiscCanvasPx, 0.0);
      float disc = 1.0 - smoothstep(dr - 0.5, dr + 0.5, cd);
      float hide = sunHide();
      // openShare affects the lens glow above, but must not dim the visible
      // crescent of the solar disc. Each covered pixel is masked geometrically.
      s = mix(s, warm, clamp(disc * hide, 0.0, 1.0));
    }
  }
  s = starDots(s);
  // Subtle, fixed canvas-space dither. Visible sensor grain exaggerated the
  // quality change when terrain switched to the motion grid.
  uvec2 ip = uvec2(gl_FragCoord.xy);
  float g = u01(pcg3(uvec3(ip, uSeed))) + u01(pcg3(uvec3(ip, uSeed + 1u))) - 1.0;
  s += g / 255.0;
  s = mix(texture(uPrevious, vUv).rgb, s, uDateBlend);
  s = applyVisibility(s, texture(uMoonMetadata, vUv), uVisibilityLevels, uVisibilityOn);
  fragColor = vec4(clamp(s, 0.0, 1.0), 1.0);
}
`

// Owner feedback (2026-10-09): reduce the broad glare wash, especially when
// the Moon is small, so earthshine and surface contrast remain visible.
export const GLARE_GAIN = 0.007

export class FinalPass {
  private readonly pass: FullscreenPass
  private display: THREE.WebGLRenderTarget | null = null
  private upsample = false
  private previous: THREE.WebGLRenderTarget | null = null
  private scratch: THREE.WebGLRenderTarget | null = null
  private dateBegan = -Infinity
  private dateMs = DATE_CROSSFADE_MS
  private refinement = false
  /** Bound while no metadata target exists (it is allocated for calibration and audit frames only): transparent black, which is what an undrawn target held. */
  private readonly noMetadata = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat)
  private readonly refinementClock = new RefinementClock()

  constructor(seed: number) {
    this.pass = new FullscreenPass(FINAL_FRAGMENT, {
      uPrevious: { value: null },
      uDateBlend: { value: 1 },
      uScene: { value: null },
      uDisplay: { value: null },
      uStage: { value: 0 },
      uMoonMetadata: { value: null },
      uVisibilityLevels: { value: new THREE.Vector2() },
      uVisibilityOn: { value: 0 },
      uGlare: { value: null },
      uAureole: { value: null },
      uHazeTint: { value: new THREE.Vector3(1, 1, 1) },
      uHazeGain: { value: 0 },
      uGlareGain: { value: GLARE_GAIN },
      uMoonGlare: { value: 1 },
      uWhite: { value: 1 },
      uHdr: { value: 1 },
      uEsLevel: { value: 1 },
      uLongMax: { value: 0.3 },
      uStarLift: { value: 0 },
      uSkyGain: { value: 0 },
      uSeed: { value: Math.max(1, Math.floor(seed)) >>> 0 },
      uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
      uSunMissing: { value: new THREE.Vector3() },
      uTargetPx: { value: new THREE.Vector2(1, 1) },
      uCanvasPx: { value: new THREE.Vector2(1, 1) },
      uSunInvViewProj: { value: new THREE.Matrix4() },
      uSunCamPos: { value: new THREE.Vector3() },
      uSharpen: { value: 0 },
      uThin: { value: 0 },
      uThinMag: { value: 1 },
      uThinKeep: { value: THIN_KEEP },
      uThinLo: { value: THIN.ratio },
      uEdgeK: { value: 0.5 },
      uCatmull: { value: 0 },
      uSunGlareOn: { value: 0 },
      uSunGlow: { value: 0 },
      uSunLook: { value: 0 },
      uSunOpen: { value: 0 },
      uSceneDepth: { value: null },
      uFgOn: { value: 0 },
      uSunFade: { value: 0 },
      uSunDirect: { value: 0 },
      uMoonMetadataOn: { value: 0 },
      uEarthOcc: { value: new THREE.Vector3() },
      uSunDiscPx: { value: 0 },
      uSunDiscCanvasPx: { value: 0 },
      uShoulder: { value: 0 },
      uDiagnosticView: { value: typeof location === 'undefined' ? 0 : Number(diagnosticViewEnabled(location.search)) },
      uGlareW: { value: WEIGHTS.slice(0, 6) },
      uStarDots: { value: null },
      uStarDotsOn: { value: 0 },
      uStarFgOn: { value: 0 },
      uEarthDisc: { value: new THREE.Vector3() },
    }, FINAL_VERTEX)
  }

  beginDateTransition(renderer: THREE.WebGLRenderer, t: TargetSet, x: Exposure, now: number, ms = DATE_CROSSFADE_MS, canvas?: { w: number; h: number }): void {
    // Preserve the actual reconstructed canvas image so refinement starts
    // continuously, including when another refinement interrupts the fade.
    const [sw, sh] = previousSize(t.w, t.h, canvas)
    // Two reusable RGBA8 attachments: preserve an interrupted displayed crossfade without read/write feedback.
    if (!this.scratch || this.scratch.width !== sw || this.scratch.height !== sh) {
      this.scratch?.dispose()
      this.scratch = new THREE.WebGLRenderTarget(sw, sh, { type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false })
      trackGpu('crossfade', `final-${sw}x${sh}`, sw * sh * 4, this.scratch)
    }
    this.stepDate(now)
    this.render(renderer, t, x, this.scratch)
    const old = this.previous
    this.previous = this.scratch
    this.scratch = old
    this.pass.uniforms.uPrevious.value = this.previous.texture
    this.dateBegan = now
    this.dateMs = ms
    this.refinement = !!canvas
    this.refinementClock.start(now, ms)
  }
  /** True while a refine crossfade (the hand-back's mid picture into the full one) is mid-transition, as of the last render. */
  refining(): boolean { return this.refinement && this.pass.uniforms.uDateBlend.value < 1 }
  stepDate(now: number): boolean {
    const u = this.refinement ? this.refinementClock.step(now) : Math.max(0, Math.min(1, (now - this.dateBegan) / this.dateMs))
    this.pass.uniforms.uDateBlend.value = u * u * (3 - 2 * u)
    return u < 1
  }

  /** Drop an interrupted date/refine composite before a camera-owned flight starts. */
  cancelDateTransition(): void {
    this.dateBegan = -Infinity
    this.refinement = false
    this.pass.uniforms.uDateBlend.value = 1
  }

  /** No invented numerical default: activation requires lossless calibration and a preserved baseline. */
  setVisibilityCalibration(p: VisibilityCalibration | null): void {
    if (p) validateCalibration(p)
    this.pass.uniforms.uVisibilityOn.value = p ? 1 : 0
    ;(this.pass.uniforms.uVisibilityLevels.value as THREE.Vector2).set(p?.mariaGrey ?? 0, p?.highlandGrey ?? 0)
  }

  /**
   * The aureole (moon-v1): forward scattering by the air's aerosols, a coarse level of the glare pyramid added with a tint.
   * Neutral-cool under a dark sky, warm only low down while the Sun is near the horizon. 0 gain: none (everywhere but the ridge view).
   */
  setAureole(gain: number, tint: [number, number, number]): void {
    this.pass.uniforms.uHazeGain.value = gain
    ;(this.pass.uniforms.uHazeTint.value as THREE.Vector3).set(tint[0], tint[1], tint[2])
  }

  /** Ground mode's long highlight shoulder (for a module 5 stops above the ground). */
  setShoulder(mix: number): void { this.pass.uniforms.uShoulder.value = mix }

  /** The sky-star lift's gain for this frame (sky/skyStars.ts); 0 is off. */
  setSkyStars(gain: number): void { this.pass.uniforms.uSkyGain.value = gain }

  private dots: StarDots | null = null
  private dotStars: StarPass | null = null
  private dotCanvas = { w: 1, h: 1 }
  /**
   * Which path draws the stars this frame (sky/starDots.ts starPathsForFrame): the dots here, or the StarPass's sprites in the scene, never both.
   * `dotsAllowed` is false while the stars are off and in a ridge frame (no depth, and the ridge zeroes the key under its ground); `cw, ch` the real
   * canvas size in device px. Called before the scene is drawn, so the StarPass knows whether to draw.
   */
  setStarDots(stars: StarPass | null, dotsAllowed: boolean, cw: number, ch: number): void {
    const p = stars ? starPathsForFrame(stars.dots, dotsAllowed) : { sprites: true, dots: false }
    if (stars) stars.sprites = p.sprites
    this.dotStars = stars && p.dots ? stars : null
    this.dotCanvas = { w: Math.max(1, Math.round(cw)), h: Math.max(1, Math.round(ch)) }
  }
  /** The native star layer for this frame, from the exposure uniforms render() has just set; the composite is starDots() in the fragment. */
  private renderStarDots(renderer: THREE.WebGLRenderer, t: TargetSet, x: Exposure): void {
    const u = this.pass.uniforms
    const stars = this.dotStars
    if (!stars) { u.uStarDotsOn.value = 0; return }
    if (!this.dots || this.dots.stars !== stars) this.dots = new StarDots(stars, u)
    u.uStarFgOn.value = t.scene.depthTexture ? 1 : 0
    this.dots.render(renderer, this.dotCanvas.w, this.dotCanvas.h, t.w, t.h, x.white, x.hdr, u.uSkyGain.value as number)
    u.uStarDots.value = this.dots.texture
    u.uStarDotsOn.value = 1
  }

  /** The Quality sheet's Glow: off drops the glare pyramid's contribution and the Sun's lens glow (main.ts also skips building the pyramid). */
  setGlow(on: boolean): void {
    this.glowOn = on
    this.pass.uniforms.uGlareGain.value = on ? GLARE_GAIN : 0
    if (!on) this.pass.uniforms.uSunGlow.value = 0
  }
  /** Fades scene-pyramid bloom with lunar illumination while preserving the Sun's separate lens glow. */
  setMoonGlare(scale: number): void { this.pass.uniforms.uMoonGlare.value = Math.max(0, Math.min(1, scale)) }
  glowOn = true

  /** The clamped Sun's missing glare for this frame (SunPass.glare). */
  setSunGlare(g: SunGlare, t: TargetSet, canvasW: number, canvasCssWidth: number, moonMetadataOn: boolean, invViewProj: THREE.Matrix4, camPos: THREE.Vector3): void {
    const u = this.pass.uniforms
    u.uSunGlareOn.value = g.on ? 1 : 0
    u.uSunGlow.value = g.on && this.glowOn ? g.glow : 0
    u.uSunDirect.value = g.direct ? 1 : 0
    // The look: on with the Sun in frame and drawn in display space; the Quality sheet's Glow off keeps only the hard disc (no bloom, veil, rays, lift or grain).
    u.uSunLook.value = g.on && g.direct && g.look ? 1 : 0
    u.uSunOpen.value = g.open ?? 0
    // The foreground coverage is the scene target's depth (ground mode, a flight's lander); orbital targets have none.
    u.uSceneDepth.value = t.scene.depthTexture
    u.uFgOn.value = g.cover && t.scene.depthTexture ? 1 : 0
    u.uSunFade.value = this.glowOn ? g.fade ?? 0 : 0
    u.uMoonMetadataOn.value = moonMetadataOn ? 1 : 0
    ;(u.uEarthOcc.value as THREE.Vector3).set(g.earthOcc[0], g.earthOcc[1], g.earthOcc[2])
    ;(u.uEarthDisc.value as THREE.Vector3).set(g.earthDisc?.[0] ?? 0, g.earthDisc?.[1] ?? 0, g.earthDisc?.[2] ?? 0)
    ;(u.uSunUv.value as THREE.Vector2).set(g.uv[0], g.uv[1])
    ;(u.uSunMissing.value as THREE.Vector3).set(g.missing[0], g.missing[1], g.missing[2])
    ;(u.uTargetPx.value as THREE.Vector2).set(t.w, t.h)
    ;(u.uCanvasPx.value as THREE.Vector2).set(canvasW, canvasW * t.h / t.w)
    ;(u.uSunInvViewProj.value as THREE.Matrix4).copy(invViewProj)
    ;(u.uSunCamPos.value as THREE.Vector3).copy(camPos)
    u.uSunDiscPx.value = g.discPx
    u.uSunDiscCanvasPx.value = g.discPx * canvasW / t.w
    this.upsample = t.w < canvasW * 0.98
    // Mild enlargement already filters isolated samples. Only add the
    // anti-sparkle kernel on genuinely coarse grids; applying its full blur
    // at 0.7 resolution needlessly softened every moving crater rim.
    const magnification = canvasW / t.w
    const coarse = Math.min(1, Math.max(0, (magnification - 1.5) / 1.5))
    u.uSharpen.value = SHARPEN_ON && this.upsample ? coarse * coarse * (3 - 2 * coarse) : 0
    u.uThin.value = THIN.on && this.upsample ? thinStrength(magnification) : 0
    u.uThinMag.value = magnification
    upscale ??= upscaleMode(typeof location === 'undefined' ? '' : location.search, currentSharp().on || phoneMotionOn())
    u.uCatmull.value = this.upsample ? catmullOn(upscale, magnification) : 0
    const pixelRatio = canvasCssWidth > 0 ? canvasW / canvasCssWidth
      : typeof window === 'undefined' ? 2 : window.devicePixelRatio || 1
    const restPx = REST_EDGE_CSS_PX * pixelRatio
    const canvasPxPerTexel = canvasW / t.w
    u.uEdgeK.value = EDGE_ON && this.upsample
      ? edgeK(t.w / canvasW, restPx, canvasPxPerTexel)
      : 0.5
  }

  /** Composites to the canvas (or a target, for captures). */
  render(renderer: THREE.WebGLRenderer, t: TargetSet, x: Exposure, out: THREE.WebGLRenderTarget | null = null): void {
    const u = this.pass.uniforms
    if (!this.previous) u.uPrevious.value = t.scene.texture
    u.uScene.value = t.scene.texture
    u.uMoonMetadata.value = t.moonMetadata ? t.moonMetadata.texture : this.noMetadata
    u.uGlare.value = t.up[0].texture
    u.uAureole.value = t.up[2].texture
    u.uWhite.value = x.white * x.preExpose
    u.uHdr.value = x.hdr
    u.uEsLevel.value = x.esLevel / x.white
    u.uLongMax.value = x.longMax
    u.uStarLift.value = x.starLift
    this.renderStarDots(renderer, t, x)
    if (this.upsample) {
      // Fuse each scene texel's two exposures before enlargement. The final
      // reconstruction is bounded by neighbouring display colours, so a small
      // lit crest cannot acquire a brighter long-exposure halo during zoom.
      if (!this.display || this.display.width !== t.w || this.display.height !== t.h) {
        this.display?.dispose()
        this.display = new THREE.WebGLRenderTarget(t.w, t.h, {
          type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false,
        })
        trackGpu('targets', `display-${t.w}x${t.h}`, t.w * t.h * 4, this.display)
      }
      u.uDisplay.value = null // avoid sampling an attachment of the current framebuffer
      u.uStage.value = 1
      this.pass.render(renderer, this.display)
      u.uDisplay.value = this.display.texture
      u.uStage.value = 2
    } else {
      u.uStage.value = 0
    }
    this.pass.render(renderer, out)
  }
}
