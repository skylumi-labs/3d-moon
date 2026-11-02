import { ECLIPSE_GLSL } from '../lighting'
import { GLSL_FLUSH16, MOON_R_KM } from '../glsl/common'
import { TILE_DECLS, TILE_MARCH_FN, heightGlsl, patchDecls, type PatchLayout } from '../moon/moonShader'
import { H_TEXEL_KM } from '../moon/tiles/grid'
import { LM_SHADE_GLSL } from './lmShadow'
import { GM_EPS, GM_HOLD_M, GM_ITER, GM_MARGIN_M, GM_START, SM_LEVELS } from './siteMax'
import { NEAR, NEAR_BAKED, NEAR_GLSL, NEAR_LOOK, NF_GSTEPS, NF_MAX_M } from './nearField'
import { NB_FOOTPRINT, nearBakedGlsl } from './nearBake'

/**
 * The ground pass (G1): the Moon's surface near a site, rendered in the site's own metre frame
 * (src/ground/frame.ts) instead of in Moon radii. Same data as the Moon pass (the tiles' heights and
 * colour under the site patch's levels, read through `patchGroundEN`), the same photometry
 * (lunar-Lambert with the fitted phase function, earthshine, the eclipse hook), the same
 * exposure contract (radiance x uPreExpose, alpha the exposure key). What differs is precision:
 * the camera, the ray and every sample are numbers of at most a few kilometres, so a camera 1.7 m
 * over the ground and a pebble 10 cm across are drawn exactly, where float32 in Moon radii steps 0.2 m.
 *
 * Geometry: the ground is a height field over the tangent plane of the frame's origin,
 * z(e, n) = H(e, n) - h0 - (e^2 + n^2) / 2R (the drop of the sphere included). Rays are traced by
 * clearance-stepped sphere tracing with a 3% floor (a ray skimming the ground still makes progress),
 * then six halvings across the crossing. A ray that misses keeps the share of the pixel its closest
 * approach covers, so the skyline is antialiased against the stars like the limb is.
 *
 * Kinds: 'cover' (dst *= 1 - cover), 'shade' (dst += radiance x cover; also writes the hit's depth,
 * so the mesh pass can test against it) and 'probe' (a row of points in, ground height and sunlight
 * out: how the CPU learns the height under a footpad, a step or a shadow).
 */

/** Measurement switches (A/B and ablation; the defaults leave the shader text byte-identical): ?gsteps=N caps the hit's march (8..384, default 384; changes the image), ?gshadow=0 skips the Sun-visibility march, ?ghitx=N repeats the hit's main ray (image unchanged). */
/** `?near=photo` (nearField.ts): the modelled near-field ground. Its finer hit steps take a larger march budget; every other default is byte-identical to the frozen text. */
const GSTEPS_PARAM = typeof location === 'undefined' ? NaN : Number(new URLSearchParams(location.search).get('gsteps'))
/** The hit march's budget: `?gsteps=N` clamped to 8..default, else the default (384; the near field's 640). An absent param is 0 in a browser and NaN in Node: both fall to the default. */
export function gstepsOf(param: number, nearOn: boolean): number {
  const dflt = nearOn ? NF_GSTEPS : 384
  return Math.max(8, Math.min(dflt, Math.floor(param)) || dflt)
}
/** `?nearlook=film`'s soil tint (a gain per channel, darker and browner than the map's grey) and its contrast about flat sunlit ground (an exponent on the Sun term's ratio to it). A look, not a measurement. */
const LOOK_TINT = '1.0, 0.98, 0.95'
const LOOK_GAIN = '0.66'
const LOOK_CONTRAST = '0.35'
const LOOK_SUN_EXP = '0.9'
const gsteps = (nearOn: boolean): number => gstepsOf(GSTEPS_PARAM, nearOn)
/** ?ghitx=N (2..4): the hit's main ray is marched N times (the extra results cannot change the image), so (N - 1) hit costs are added: the cost of the hit alone, with the image untouched. */
const GHITX = typeof location === 'undefined' ? 1 : Math.max(1, Math.min(4, Math.floor(Number(new URLSearchParams(location.search).get('ghitx'))) || 1))
const GHITX_GLSL = Array.from({ length: GHITX - 1 }, (_, i) => ` { GHit x${i} = groundHitRay(o + vec3(uMotion * 1.0e-9 * ${i + 1}.0), d); if (x${i}.t > g.t + 1.0e6) g.t = x${i}.t; }`).join('')
/** `?surround=1`: the modelled surround also textures the ground view beyond the photographs (off: the text is the frozen default). */
const SURROUND_PARAM = typeof location !== 'undefined' && new URLSearchParams(location.search).get('surround') === '1'
const GSHADOW = typeof location === 'undefined' || new URLSearchParams(location.search).get('gshadow') !== '0'
/** `?hit=mm`: the max-mip descent for the ground hit (opt-in until the review blockers are fixed and re-measured). Without it the fixed-step march runs. */
const HIT_MM = typeof location !== 'undefined' && new URLSearchParams(location.search).get('hit') === 'mm'

export type GroundKind = 'cover' | 'shade' | 'probe' | 'metadata'
/** Longest ray the ground pass follows, metres. */
export const GROUND_MAX_M = 60000

function patchGroundLook(layout: PatchLayout, surround = false): string {
  const idx = layout.map((_, i) => i)
  const hs = idx.filter((i) => layout[i].h && layout[i].shade !== false)
  const rs = idx.filter((i) => layout[i].r)
  return /* glsl */ `
// Slopes (rise over run, east and north) of the ground at mEN: the patch levels' heights mixed coarse to fine.
// A level fades out only when a pixel is 4 to 16 of its texels (the coarsest never: far ground keeps its slope).
vec2 groundSlope(vec2 mEN, float fpM) {
  vec2 sl = vec2(0.0);
${hs.map((i, n) => `  {
    vec2 q = patchQ(uPG${i}, uPA${i}, mEN);
    float w = patchEdge(q, uPS${i}, uPG${i}, ${layout[i].fadeM.toFixed(1)}) * uPatchBlend${n === 0 ? '' : ` * (1.0 - smoothstep(4.0, 16.0, fpM / uPG${i}.z))`};
    if (w > 0.0) sl = mix(sl, patchSlope(uPH${i}, q, uPS${i}, uPG${i}), w);
  }`).join('\n')}
  return sl;
}
// log2 of the image ratio at mEN, mixed coarse to fine (patchNormal's).
float groundDetail(vec2 mEN, float fpM) {
  float lr = 0.0;
${rs.map((i) => `  {
    vec2 q = patchQ(uPG${i}, uPA${i}, mEN);
    float w = patchEdge(q, uPS${i}, uPG${i}, ${layout[i].fadeM.toFixed(1)}) * uPatchBlend * (1.0 - smoothstep(8.0, 32.0, fpM / uPG${i}.z));
    if (w > 0.0) lr = mix(lr, patchDetail(uPR${i}, q, uPS${i}, uPG${i}, fpM), w);
  }`).join('\n')}
  return lr;
}
${surround ? surroundGlsl(rs, layout) : ''}`
}

/**
 * `?surround=1` in ground mode: the Moon pass's modelled surround (patchNormal's, moonShader.ts) applied to the ground's albedo where no photograph reaches
 * (ratio byte 128 / no level covers), so the hills beyond the photograph are not flat grey. The same five octaves, so the two passes agree; plus a mild
 * slope- and aspect-keyed term (steeper ground a little brighter, Sun-facing a little brighter). Modelled, not data: the HUD says so exactly as for the Moon pass.
 */
function surroundGlsl(rs: number[], layout: PatchLayout): string {
  const cover = ['realC', ...rs.slice(1).map((i) => `e${i}`)].reduce((a, b) => `max(${a}, ${b})`)
  return /* glsl */ `
float groundSurround(vec2 mEN, float fpM, vec2 sl, vec2 sunXY) {
  if (uSurround <= 0.0) return 0.0;
${rs.map((i) => `  float e${i} = patchEdge(patchQ(uPG${i}, uPA${i}, mEN), uPS${i}, uPG${i}, ${layout[i].fadeM.toFixed(1)});`).join('\n')}
  float dC = ${rs.length ? `e${rs[0]} > 0.0 ? patchDetail(uPR${rs[0]}, patchQ(uPG${rs[0]}, uPA${rs[0]}, mEN), uPS${rs[0]}, uPG${rs[0]}, fpM) : 0.0` : '0.0'};
  float realC = ${rs.length ? `e${rs[0]} * smoothstep(0.008, 0.02, abs(dC))` : '0.0'};
  float sw = uSurround * (1.0 - ${cover}) * (1.0 - smoothstep(30000.0, 60000.0, length(mEN)));
  if (sw <= 0.0) return 0.0;
  float nz = 0.0;
  nz += 0.115 * surrNoise(mEN / 24.0) * (1.0 - smoothstep(0.5, 1.5, fpM / 24.0));
  nz += 0.085 * surrNoise(mEN / 48.0 + 17.3) * (1.0 - smoothstep(0.5, 1.5, fpM / 48.0));
  nz += 0.070 * surrNoise(mEN / 96.0 + 41.9) * (1.0 - smoothstep(0.5, 1.5, fpM / 96.0));
  nz += 0.090 * surrNoise(mEN / 192.0 + 7.7) * (1.0 - smoothstep(0.5, 1.5, fpM / 192.0));
  nz += 0.100 * surrNoise(mEN / 384.0 + 91.1) * (1.0 - smoothstep(0.5, 1.5, fpM / 384.0));
  float m = length(sl);
  float steep = smoothstep(0.10, 0.40, m);
  vec2 sunH = sunXY / max(length(sunXY), 1e-4);
  float facing = -dot(sl, sunH) / max(m, 1e-4);   // 1: the slope faces the Sun
  nz += 0.10 * steep + 0.04 * facing * steep;
  return sw * nz;
}
`
}

/** The fixed-step march (`?hit=old`, and the descent's fallback when it runs out of iterations). Starts from tb. */
const oldMarch = (NEAR_ON: boolean): string => /* glsl */ `for (int i = 0; i < ${gsteps(NEAR_ON)}; i++) {
    vec3 x = o + d * tb;
    float c = x.z - terrainZ(x.xy, tb * uTanPerPx);
    if (c < 0.0) { hit = true; break; }
    float ang = c / tb;
    if (ang < minAng) { minAng = ang; tMin = tb; }
    ta = tb;
    if (tb >= G_MAXT) break;
    tb = min(G_MAXT, tb + ${NEAR_ON ? 'nfStep(c, d.z, tb)' : 'max(c / (0.75 + abs(d.z)), 0.012 * tb + 0.02)'});
  }`

/**
 * `NEAR_ON` (default: the page's `?near=photo`) adds the modelled near-field ground (nearField.ts); off, the text is the frozen default. `BAKED` (default: near=photo
 * without `&bake=0`) reads it from the baked levels (nearBake.ts) instead of evaluating it per march step; `LOOK` (`?nearlook=0` turns it off) adds the film-look tweak.
 */
export function groundFragment(kind: GroundKind, lonSpan: number, mapWidth: number, layout: PatchLayout, NEAR_ON = NEAR === 'photo', BAKED_ = NEAR_ON && NEAR_BAKED, LOOK_ = NEAR_ON && NEAR_LOOK, SURROUND = SURROUND_PARAM): string {
  // Baked and the look only exist with the near field: near off ignores both.
  const BAKED = NEAR_ON && BAKED_, LOOK = NEAR_ON && LOOK_
  const OLD_MARCH = oldMarch(NEAR_ON)
  const texelKm = (2 * Math.PI * MOON_R_KM) / mapWidth
  const i0 = Math.max(0, layout.findIndex((l) => l.h))
  return /* glsl */ `
#define PI 3.141592653589793
${GLSL_FLUSH16}
uniform vec2 uResolution;
uniform float uPreExpose;
uniform float uTanPerPx;
uniform float uHzK;          // ?horizon=: sub-pixel rays for a pixel on the skyline (0: the single ray of before; moon/horizon.ts)
uniform float uMotion;       // 1 on a gesture frame: no sub-pixel rays
${heightGlsl(lonSpan, texelKm)}
uniform vec3 uS;
uniform vec3 uEarth;
uniform vec3 uSunPos;
uniform vec3 uEarthPos;
uniform float uEarthshine;
uniform sampler2D uColor;
${TILE_DECLS}
${TILE_MARCH_FN}
${patchDecls(layout)}
${patchGroundLook(layout, SURROUND)}

// ---- The frame (src/ground/frame.ts): metres east, north, up of the origin, float32-safe.
uniform vec3 uGCam;          // camera
uniform vec3 uGRight;        // camera basis in the frame
uniform vec3 uGUp;
uniform vec3 uGBack;
uniform float uGTanHalf;     // tangent of the vertical half-field
uniform vec3 uGSunL;         // Moon to Sun, unit, in the frame
uniform vec3 uGEarthL;       // Moon to Earth, unit, in the frame
uniform vec2 uGOff;          // the origin's metres east and north of the patch's site point
uniform float uGH0;          // ground height of the origin over the 1737.4 km sphere, metres
uniform float uGR;           // radius of the origin from the Moon's centre, metres
uniform vec2 uGUv0;          // the global maps' uv at the origin
uniform vec2 uGDuv;          // uv per metre east and per metre north (the second is negative: v runs south)
uniform vec3 uGSiteW;        // the origin's direction from the Moon's centre, world frame, unit
uniform float uGNear;        // the mesh camera's planes: the depth this pass writes is theirs
uniform float uGFar;
${HIT_MM ? `uniform highp sampler2D uGMax;   // R32F max-height pyramid of the site patch (siteMax.ts), patch metres
uniform vec4 uGMG;               // its corner (east, north of the site point), cell size (m), levels
uniform vec2 uGMS;               // its size in cells
uniform float uGMOn;             // 1: the max-mip descent; 0: the fixed-step march (?hit=old, or no grid yet)
` : ''}const float SUN_R = 0.267;
const float SUN_RAD = 0.267 * 0.017453292519943295;
const float G_MAXT = ${GROUND_MAX_M.toFixed(1)};

float terrainH(vec2 en, float fpM) {
  float lmf = log2(max(1.0, fpM / (TH_KM * 1000.0)));
  int lm = clamp(int(floor(lmf + 0.5)), 0, 2);
  float lodG = log2(max(1.0, fpM / (TEXEL_KM * 1000.0)));
  return patchGroundEN(en + uGOff, uGUv0 + en * uGDuv, fpM, lm, lodG);
}
${NEAR_ON ? (BAKED ? nearBakedGlsl() : NEAR_GLSL) : ''}float terrainZ${NEAR_ON ? 'Base' : ''}(vec2 en, float fpM) {
  return terrainH(en, fpM) - uGH0 - dot(en, en) / (2.0 * uGR);${NEAR_ON ? `
}
${BAKED ? `// The measured ground plus the baked near field (nearBake.ts): a texel or three where a level holds the point, nothing beyond the outermost.
float terrainZ(vec2 en, float fpM) {
  return terrainZBase(en, fpM) + nfFetch(en, fpM).x;` : `// The measured ground plus the modelled near field (nearField.ts), where its weight is above zero.
float terrainZ(vec2 en, float fpM) {
  float z = terrainZBase(en, fpM);
  float w = nfW(en);
  return w > 0.0 ? z + w * nfDetail(en, fpM) : z;`}` : ''}
}

// Where the ray o + t d meets the ground. hit: a crossing was found; else tMin is where the ray came closest
// (minAng: the angular clearance there, radians) and cover is the share of the pixel that closest approach covers.
struct GHit { float t; bool hit; float cover; float ang; };
float gGPxK = 1.0;   // the share of a pixel the ray stands for (1, or 1 / uHzK for a sub-pixel ray): the width of its coverage ramp
GHit groundHitRay(vec3 o, vec3 d) {
  float ta = 0.05, tb = 0.05;
  float minAng = 1e9, tMin = 0.05;
  bool hit = false;
${HIT_MM ? `  if (uGMOn > 0.5) {
    // The max-mip descent (groundHit.ts is its CPU twin): skip a cell of the patch's max grid wherever the ray stays above its bound to the cell's
    // exit, go down a level where it does not, and take the clearance steps of the fixed march only at level 0 (and anywhere off the grid).
    vec2 o2 = o.xy + uGOff;
    float tLocal = 4.0 * uPG${i0}.z / uTanPerPx;   // farther than this the coarsest patch level fades into the tiles' heights, which the grid does not hold
    int lv = ${GM_START};
    float t = 0.05;
    float hold = -1.0;
    for (int i = 0; i < ${GM_ITER}; i++) {
      vec3 x = o + d * t;
      vec2 g = vec2(x.x + uGOff.x - uGMG.x, uGMG.y - x.y - uGOff.y) / uGMG.z;
      if (t >= hold && t < tLocal && g.x >= 1.0 && g.y >= 1.0 && g.x < uGMS.x - 1.0 && g.y < uGMS.y - 1.0) {
        float sc = float(1 << lv);
        vec2 cc = min(floor(g / sc), vec2(textureSize(uGMax, lv)) - 1.0);
        float mx = texelFetch(uGMax, ivec2(cc), lv).r;
        float size = uGMG.z * sc;
        float xl = uGMG.x + cc.x * size, yt = uGMG.y - cc.y * size;
        float tx = d.x > 1e-9 ? (xl + size - o2.x) / d.x : (d.x < -1e-9 ? (xl - o2.x) / d.x : 1e30);
        float ty = d.y > 1e-9 ? (yt - o2.y) / d.y : (d.y < -1e-9 ? (yt - size - o2.y) / d.y : 1e30);
        float tEnd = max(min(min(tx, ty) + ${GM_EPS} * uGMG.z, min(G_MAXT, tLocal)), t + 1e-3);
        vec2 lo = vec2(xl, yt - size) - uGOff;
        vec2 dm = max(max(lo, -(lo + size)), vec2(0.0));
        float zb = mx - uGH0 - dot(dm, dm) / (2.0 * uGR);
        float z0 = o.z + d.z * t, z1 = o.z + d.z * tEnd;
        if (min(z0, z1) > zb + ${NEAR_ON ? GM_MARGIN_M + NF_MAX_M : GM_MARGIN_M} + tEnd * uTanPerPx) {
          t = tEnd; ta = tEnd;
          if (t >= G_MAXT) break;
          lv = min(lv + 1, ${SM_LEVELS - 1});
          continue;
        }
        if (lv > 0) { lv--; continue; }
        hold = t + ${GM_HOLD_M.toFixed(1)};
      }
      float c = x.z - terrainZ(x.xy, t * uTanPerPx);
      if (c < 0.0) { hit = true; tb = t; break; }
      float ang = c / t;
      if (ang < minAng) { minAng = ang; tMin = t; }
      ta = t;
      if (t >= G_MAXT) break;
      t = min(G_MAXT, t + ${NEAR_ON ? 'nfStep(c, d.z, t)' : 'max(c / (0.75 + abs(d.z)), 0.012 * t + 0.02)'});
    }
    // The budget ran out before the ray ended: finish it with the fixed march from the last point known to be above ground (see groundHit.ts, budget).
    if (!hit && t < G_MAXT) {
      tb = ta;
      ${OLD_MARCH}
    }
  } else {
  ` : ''}  ${OLD_MARCH}${HIT_MM ? '\n  }' : ''}
  if (!hit) return GHit(tMin, false, clamp(0.5 - minAng / (uTanPerPx * gGPxK), 0.0, 1.0), minAng);
  for (int i = 0; i < 7; i++) {
    float tm = 0.5 * (ta + tb);
    vec3 x = o + d * tm;
    if (x.z < terrainZ(x.xy, tm * uTanPerPx)) tb = tm; else ta = tm;
  }
  return GHit(0.5 * (ta + tb), true, 1.0, 0.0);
}

// The skyline against the sky. Before, a ray that hit had coverage exactly 1 and one that missed a ramp from 0.5 to 0, so far ridges were a hard
// staircase. A far hit with sky one pixel above it, or a miss that cleared the ground by under a pixel and a half, is traced as uHzK sub-pixel rays
// stacked across the pixel on the world's vertical, and its coverage is their mean; t, hit and the shading are the centre ray's. A near hit, a miss
// well clear of the ground and any gesture frame cost what they did.
GHit groundHit(vec3 o, vec3 d) {
  gGPxK = 1.0;
  GHit g = groundHitRay(o, d);${GHITX_GLSL}
  if (uHzK < 0.5 || uMotion > 0.5) return g;
  vec3 upv = vec3(0.0, 0.0, 1.0) - d * d.z;
  float ul = length(upv);
  if (ul < 0.05) return g;
  upv /= ul;
  if (g.hit) {
    if (g.t < 150.0) return g;
    if (groundHitRay(o, normalize(d + upv * uTanPerPx)).hit) return g;
  } else if (g.ang > 1.5 * uTanPerPx) return g;
  float k = min(uHzK, 8.0);
  gGPxK = 1.0 / k;
  float acc = 0.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= k) break;
    acc += groundHitRay(o, normalize(d + upv * (((float(i) + 0.5) / k - 0.5) * uTanPerPx))).cover;
  }
  gGPxK = 1.0;
  g.cover = acc / k;
  return g;
}

// The share of the Sun's disc above the terrain's skyline from P: the smallest angular clearance of the ground
// along the ray to the Sun (0.3 m to 30 km, 20% steps), softened over the disc's radius, so the penumbra widens with
// the distance to the edge that casts it.
float sunVisibility(vec3 P, vec3 s, float t0) {${GSHADOW ? '' : ' return 1.0;'}
  float best = 1e9;
  float t = t0;
  float cosE = sqrt(max(1.0 - s.z * s.z, 0.0));
${NEAR_ON ? `  // Near field: finer steps to 90 m (10 %), then 20 %, out to about 60 km (baked: from a centimetre, 12 % to 2 m, 10 % to 40 m, so a pebble shades the ground just behind it); the start is dithered per pixel so a step's edge is grain, not a staircase.
  t *= 1.0 + 0.1 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
` : ''}  for (int k = 0; k < ${NEAR_ON ? (BAKED ? 128 : 96) : 64}; k++) {
    vec3 x = P + s * t;
    float c = x.z - terrainZ(x.xy, t * 0.004);
    best = min(best, c * cosE / t);${BAKED ? `
    if (best < -SUN_RAD) break;` : ''}
    t *= ${NEAR_ON ? (BAKED ? '(k < 45 ? 1.12 : (k < 75 ? 1.1 : 1.2))' : '(k < 60 ? 1.1 : 1.2)') : '1.2'};
  }
  return smoothstep(-SUN_RAD, SUN_RAD, best);
}
// McEwen lunar-Lambert L(alpha), alpha in degrees (photometry.ts's twin), and the fitted phase function.
float lunarL(float a) {
  return max(0.0, 1.0 - 0.019 * a + 2.42e-4 * a * a - 1.46e-6 * a * a * a);
}
float phaseA(float a) { return exp(-0.0025 * a) * (1.0 + 0.9 * exp(-a / 20.0)) / 1.9; }
${ECLIPSE_GLSL}
${LM_SHADE_GLSL}

${kind === 'probe' ? /* glsl */ `
uniform vec2 uPts[32];
uniform int uPtN;
uniform float uRayProbe;
out vec4 fragColor;
void main() {
  if (uRayProbe > 0.5) {
    // One ray down the view centre: t (metres) and whether it met the ground.
    if (gl_FragCoord.x > 1.0 || gl_FragCoord.y > 1.0) { fragColor = vec4(0.0); return; }
    GHit rg = groundHit(uGCam, normalize(-uGBack));
    fragColor = vec4(rg.t, rg.hit ? 1.0 : 0.0, 0.0, 0.0);
    return;
  }
  int i = int(gl_FragCoord.x);
  if (i >= uPtN) { fragColor = vec4(0.0); return; }
  vec2 en = uPts[i];
  float h = terrainH(en, 0.0);
  float z = h - uGH0 - dot(en, en) / (2.0 * uGR);
  vec2 sl = groundSlope(en + uGOff, 0.0);
  if (gl_FragCoord.y > 1.0) {
    // Row 1: the module's shadow at the ground point (1 light, 0 shadow), as the shade pass would see it.
    vec2 s2 = sl - en / uGR;
    fragColor = vec4(lmShadeAt(vec3(en, z), normalize(vec3(-s2.x, -s2.y, 1.0))), 0.0, 0.0, 0.0);
    return;
  }
  float lit = sunVisibility(vec3(en, z + 0.02), uGSunL, 0.3);
  fragColor = vec4(h, lit, sl.x - en.x / uGR, sl.y - en.y / uGR);
}
` : /* glsl */ `
out vec4 fragColor;
uniform vec3 uPads[4];          // footpad centres in the frame (metres); w below is the contact shadow's radius
uniform float uPadR;
uniform float uPadOn;
void main() {
  vec2 ndc = gl_FragCoord.xy / uResolution * 2.0 - 1.0;
  float aspect = uResolution.x / uResolution.y;
  vec3 d = normalize(uGRight * (ndc.x * uGTanHalf * aspect) + uGUp * (ndc.y * uGTanHalf) - uGBack);
  GHit g = groundHit(uGCam, d);
  if (g.cover <= 0.0) discard;
${kind === 'cover' ? `  fragColor = vec4(0.0, 0.0, 0.0, g.cover);
}` : /* glsl */ `
  float cover = g.cover;
  vec3 P = uGCam + d * g.t;
  float fpM = max(g.t, 0.05) * uTanPerPx;
  // A ray that missed shades the ground beneath its closest approach.
  if (!g.hit) P.z = terrainZ(P.xy, fpM);
  vec3 V = normalize(uGCam - P);
  vec2 mEN = P.xy + uGOff;
  vec2 sl = groundSlope(mEN, fpM) - P.xy / uGR;${NEAR_ON ? (BAKED ? `
  // The baked near field's slope (nearBake.ts), by central differences over a pixel's footprint but not under 0.6 of a texel (below that a bilinear height is flat
  // facets), and its albedo factor; the grain finer than the texel is added below.
  vec2 nfv = nfFetch(P.xy, fpM);
  float nfTexel = nfTexelA;
  {
    float ne = max(0.004, max(0.5 * fpM, 0.6 * nfTexel));
    sl += vec2(nfFetch(P.xy + vec2(ne, 0.0), fpM).x - nfFetch(P.xy - vec2(ne, 0.0), fpM).x, nfFetch(P.xy + vec2(0.0, ne), fpM).x - nfFetch(P.xy - vec2(0.0, ne), fpM).x) / (2.0 * ne);
    if (fpM < 0.015) sl += nfBump(P.xy, fpM);
  }` : `
  // The modelled near field's slope (nearField.ts), by finite differences over half a pixel's footprint, and its rock mask.
  float nfw = nfW(P.xy);
  float nfRockM = 0.0;
  if (nfw > 0.0) {
    float ne = max(0.01, 0.5 * fpM);
    float z0 = nfDetail(P.xy, fpM);
    sl += nfw * vec2(nfDetail(P.xy + vec2(ne, 0.0), fpM) - z0, nfDetail(P.xy + vec2(0.0, ne), fpM) - z0) / ne;
    nfRockM = nfRock(P.xy, fpM);
  }`) : ''}
  vec3 nrm = normalize(vec3(-sl.x, -sl.y, 1.0));
  float mu = max(dot(nrm, V), 0.0);
  float muG = max(abs(dot(V, vec3(0.0, 0.0, 1.0))), 0.15);
  fpM /= muG;
  vec2 uv = uGUv0 + P.xy * uGDuv;
  // Colour: the 4k map, the tiles over it, filtered over the pixel's footprint (uv per metre times metres).
  vec2 gx = vec2(fpM * uGDuv.x, 0.0), gy = vec2(0.0, fpM * uGDuv.y);
  vec3 c = textureGrad(uColor, uv, gx, gy).rgb;
  float fpTile = fpM * 0.001;
  float tGate = uTileBlend * (1.0 - smoothstep(0.5, 0.9, fpTile / TEXEL_KM));
  if (tGate > 0.0) {
    Tile t2 = tileAt(uv, 2), t1 = tileAt(uv, 1), t0 = tileAt(uv, 0);
    float w2 = tileWeight(t2, 2, fpTile, tGate), w1 = tileWeight(t1, 1, fpTile, tGate), w0 = tileWeight(t0, 0, fpTile, tGate);
    if (w2 > 0.0) c = mix(c, tileColor(t2, 2, gx, gy), w2);
    if (w1 > 0.0) c = mix(c, tileColor(t1, 1, gx, gy), w1);
    if (w0 > 0.0) c = mix(c, tileColor(t0, 0, gx, gy), w0);
  }
  float Y0 = max(1e-4, dot(c, vec3(0.2126, 0.7152, 0.0722)));
  float An = 0.07 * pow(Y0 / 0.058, 0.6);
  vec3 albedo = An * mix(vec3(1.0), c / Y0, 0.55) * exp2(groundDetail(mEN, fpM)${SURROUND ? ' + groundSurround(mEN, fpM, sl, uGSunL.xy)' : ''});${NEAR_ON ? (BAKED ? `
  albedo *= nfv.y * (1.0 + nfGrainFine(P.xy, fpM) - nfGrainBaked(P.xy, ${NB_FOOTPRINT.toFixed(2)} * nfTexel));${LOOK ? `
  // ?nearlook=film (a look tweak toward the Apollo 17 Hasselblad frames, not a physical claim): near ground, a little darker and browner soil.
  // The gain also follows the Sun's height (the photographer exposed for the ground; the app's own exposure is left alone): a higher Sun brightens it.
  float lookW = 1.0 - smoothstep(150.0, 600.0, g.t);
  float lookG = ${LOOK_GAIN} * clamp(pow(max(uGSunL.z, 0.02) / 0.27, ${LOOK_SUN_EXP}), 0.7, 3.0);
  albedo *= mix(vec3(1.0), lookG * vec3(${LOOK_TINT}), lookW);` : ''}` : `
  if (nfw > 0.0) albedo *= mix(1.0, nfAlbedo(P.xy, fpM, nfRockM), nfw);`) : ''}

  // Sunlight: the skyline marched toward the real Sun, in metres.
  float mu0 = dot(nrm, uGSunL);
  vec3 sun = vec3(0.0);
  float lit = 0.0;
  if (mu0 > 0.0 && uGSunL.z > -0.15) lit = ${NEAR_ON && BAKED ? 'sunVisibility(P + nrm * (0.006 + 0.7 * fpM), uGSunL, max(0.012, 1.5 * fpM))' : 'sunVisibility(P + nrm * (0.02 + 0.7 * fpM), uGSunL, max(0.3, 2.5 * fpM))'};
  // The lunar module's shadow (a depth map from the Sun; lmShadowGlsl: penumbra from the Sun's disc at the occluder's distance).
  float lmShade = lmShadeAt(P, nrm);
  // Contact shadow under each footpad: the pad keeps the sky from the ground beside it (computed, not photographed).
  float contact = 1.0;
  if (uPadOn > 0.0) {
    for (int p = 0; p < 4; p++) {
      float r = length(P.xy - uPads[p].xy);
      contact *= 1.0 - 0.55 * (1.0 - smoothstep(0.0, uPadR, r)) * smoothstep(-0.6, 0.0, uPads[p].z + 0.3 - P.z);
    }
  }
  lit *= lmShade;
  float phase = acos(clamp(dot(V, uGSunL), -1.0, 1.0)) * 180.0 / PI;
  if (mu0 > 0.0) {
    float L = lunarL(phase);
    sun = albedo * phaseA(phase)${NEAR_ON ? ' * nfSurge(phase)' : ''} * (2.0 * L * mu0 / (mu0 + mu + 1e-5) + (1.0 - L) * mu0) * lit;
  }
  vec3 sunRefracted;
  vec3 sunDirect = earthShadowOnMoonParts(uGSiteW, uSunPos, uEarthPos, sunRefracted);
  sun *= sunDirect + sunRefracted;${NEAR_ON && BAKED && LOOK ? `
  // ?nearlook=film: contrast about flat ground in full Sun (the albedo 0.07 times the look's gain, the same phase law): a pixel darker than that goes darker, a brighter one brighter.
  {
    float muS = max(uGSunL.z, 0.02), muV = max(V.z, 0.1), Lr = lunarL(phase);
    float Yr = 0.07 * mix(1.0, lookG, lookW) * phaseA(phase) * (2.0 * Lr * muS / (muS + muV) + (1.0 - Lr) * muS);
    float rr = dot(sun, vec3(0.2126, 0.7152, 0.0722)) / (Yr + 1e-6);
    sun *= mix(1.0, pow(clamp(rr, 0.03, 6.0), ${LOOK_CONTRAST}), lookW);
  }` : ''}
  float muE = max(dot(nrm, uGEarthL), 0.0);
  float phaseE = acos(clamp(dot(V, uGEarthL), -1.0, 1.0)) * 180.0 / PI;
  float LE = lunarL(phaseE);
  vec3 es = albedo * vec3(0.90, 0.98, 1.14) * uEarthshine * phaseA(max(phaseE, 0.5))
    * (2.0 * LE * muE / (muE + mu + 1e-4) + (1.0 - LE) * muE);
  vec3 col = flush16((sun + es) * contact * cover * uPreExpose);
  float sunKey = (uHzK > 0.5 ? 1.0 : cover) * smoothstep(-0.03, 0.12, uGSunL.z) * smoothstep(0.003, 0.03, dot(sunDirect, vec3(0.2126, 0.7152, 0.0722)));
${kind === 'metadata' ? `  float night = 1.0 - smoothstep(-0.08, -0.03, uGSunL.z);
  night = max(night, 1.0 - smoothstep(0.003, 0.03, dot(sunDirect, vec3(0.2126, 0.7152, 0.0722))));
  fragColor = vec4(cover, night * cover, clamp(dot(albedo, vec3(0.2126, 0.7152, 0.0722)) / 0.2, 0.0, 1.0) * cover, clamp(muG, 0.0, 1.0) * cover);` : '  fragColor = vec4(col, sunKey);'}
  // The hit's depth, as the mesh camera (near uGNear, far uGFar) would store it.
  float zv = max(g.t * dot(d, -uGBack), uGNear);
  gl_FragDepth = g.hit ? clamp(uGFar / (uGFar - uGNear) * (1.0 - uGNear / zv), 0.0, 1.0) : 1.0;
}`}
`}
`
}
export const GROUND_TILE_KM = H_TEXEL_KM
