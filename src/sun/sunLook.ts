/**
 * The Sun's display-space look: disc, core bloom, veil, fine random rays, sky lift and grain, drawn by the final pass at canvas
 * resolution, after the tone map. Tuned in a separate look-dev prototype; the values here are the chosen preset.
 *
 * Routing (which Sun frames use this look and which keep the HDR path) is in sunRouting.ts; `?sun=legacy` restores the old look and routing.
 */

/** The look's parameters. Keys and values are those of the look-dev prototype's chosen preset. */
export interface SunLookParams {
  openK: number
  tint: readonly [number, number, number]
  discStr: number
  discLimb: number
  coreStr: number
  coreW: number
  coreAspect: number
  corePow: number
  coreMask: number
  coreTint: readonly [number, number, number]
  veilStr: number
  veilScale: number
  veilN: number
  veilMask: number
  veilTint: readonly [number, number, number]
  rayStr: number
  rayCount: number
  rayLen: number
  rayLenVar: number
  rayWidth: number
  rayFine: number
  rayChroma: number
  raySeed: number
  streakMask: number
  rayTint: readonly [number, number, number]
  smearStr: number
  smearAngle: number
  smearLen: number
  smearWidth: number
  smearBack: number
  smearTint: readonly [number, number, number]
  ghostStr: number
  ghostSoft: number
  ghostT: readonly [number, number, number]
  ghostR: readonly [number, number, number]
  /** Horizon glow: zero in the owner's pick. The coverage-texture silhouette search that drove it is not ported (see SUN_LOOK_GLSL). */
  hzStr: number
  hzSoft: number
  hzLineW: number
  hzSoftH: number
  hzWidth: number
  hzFloor: number
  skyLift: number
  skyTint: readonly [number, number, number]
  grain: number
  /** How far from the Sun the sky lift and the grain reach, as a share of the canvas height: full strength next to the Sun, gone by this distance, so the rest of the sky stays black with its stars. */
  skyLiftRadius: number
}

/**
 * The owner's pick (2026-10-10) with the starburst toned down on 2026-10-31 (owner phone walkthrough, item 5: on the horizon with the Sun the big
 * starburst looked strange): rays rayStr 2.4 -> 1.1, rayCount 80 -> 50, rayLen 0.14 -> 0.08, rayFine 0.68 -> 0.4 (fewer, shorter, fainter spikes);
 * core bloom coreStr 10.7 -> 8, coreW 4.6 -> 3.8 (a smaller glare). Disc, veil, sky lift and grain are unchanged.
 */
export const SUN_LOOK: Readonly<SunLookParams> = {
  openK: 6.8, tint: [1, 1, 1],
  discStr: 0.77, discLimb: 0.34,
  coreStr: 8, coreW: 3.8, coreAspect: 1.05, corePow: 0.43, coreMask: 0.26, coreTint: [1, 0.96, 0.88],
  veilStr: 0.785, veilScale: 0.09, veilN: 1.85, veilMask: 0.5, veilTint: [1, 0.86, 0.66],
  rayStr: 1.1, rayCount: 50, rayLen: 0.08, rayLenVar: 0.7, rayWidth: 0.85, rayFine: 0.4, rayChroma: 0.69, raySeed: 7, streakMask: 0.74, rayTint: [1, 0.62, 0.32],
  smearStr: 0, smearAngle: 40, smearLen: 0.15, smearWidth: 0.1, smearBack: 0.3, smearTint: [1, 0.95, 0.85],
  ghostStr: 0, ghostSoft: 0.3, ghostT: [0.69, 0.3, 0.19], ghostR: [0.035, 0.025, 0.03],
  hzStr: 0, hzSoft: 0, hzLineW: 1.2, hzSoftH: 0.02, hzWidth: 0.35, hzFloor: 0.2,
  skyLift: 0.4, skyTint: [0.12, 0.26, 0.52], grain: 0.07, skyLiftRadius: 0.33,
}

/** The share of the sky lift and the grain left at `rPx` from the Sun in a canvas `heightPx` tall (the GLSL's `reach`): 1 to 0.3 radius x height, 0 from radius x height. */
export function skyLiftReach(rPx: number, heightPx: number, radius: number = SUN_LOOK.skyLiftRadius): number {
  const lo = 0.3 * radius * heightPx, hi = Math.max(radius * heightPx, 1)
  const t = Math.max(0, Math.min(1, (rPx - lo) / (hi - lo)))
  return 1 - t * t * (3 - 2 * t)
}

/** `?sun=legacy` restores the previous Sun (HDR-path routing, the clamped disc and analytic veil, the old display glow block) for A/B. */
export const SUN_LEGACY = typeof location !== 'undefined' && new URLSearchParams(location.search).get('sun') === 'legacy'

const lit = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v))
const lit3 = (v: readonly number[]): string => `vec3(${v.map(lit).join(', ')})`

/** The look parameters as GLSL consts under the prototype's uniform names (u + Key), so the block below is the prototype's text. They are constant, so the compiler drops the zero-strength terms (smear, ghosts). */
export function sunLookConsts(p: Readonly<SunLookParams> = SUN_LOOK): string {
  const out: string[] = []
  for (const [k, v] of Object.entries(p)) {
    if (k.startsWith('hz')) continue // the horizon glow is not ported
    const name = 'u' + k[0].toUpperCase() + k.slice(1)
    out.push(typeof v === 'number' ? `const float ${name} = ${lit(v)};` : `const vec3 ${name} = ${lit3(v as readonly number[])};`)
  }
  return out.join('\n')
}

/**
 * The look's GLSL: constants, the ray and look functions. The host shader must declare, before this text:
 *   uniform vec2 uSunUv;            the Sun's centre in the frame, 0..1
 *   uniform vec2 uCanvasPx;         output size, px
 *   uniform float uSunDiscCanvasPx; the Sun's disc radius, canvas px
 *   uniform uint uSeed;             the app's grain seed
 * and this text declares the two per-frame uniforms it adds:
 *   uSunOpen   0..1 share of the Sun's disc the Moon / Earth leave open (SunPass); the host passes it to sunLook() as `open`
 *   uSunFade   0..1 how much of the light terms, sky lift and grain to draw: 0 with the Quality sheet's Glow off, and falling to 0 as the Sun goes far off screen
 * sunLook(s, hide, open, uv, fragPx): s is the tone-mapped colour, hide = 1 - coverage (0 on the Moon, the Earth, terrain or the lander, 1 in the sky),
 * open the share of the Sun's disc left open (the host passes uSunOpen, times the foreground's open share where it has one). The disc is hard and
 * hidden per pixel by `hide`; sky lift and grain apply only where hide is 1. Everything is O(1) per pixel.
 *
 * Not ported: the prototype's horizon-glow term (hzStr, hzSoft, both 0 in the owner's pick) and its 16-tap silhouette search of a coverage texture
 * (the app now has a coverage source for ground mode, sunCoverage.ts, so it could be added there).
 */
export const SUN_LOOK_GLSL = /* glsl */ `
uniform float uSunOpen;
uniform float uSunFade;
${sunLookConsts()}
uint sunPcg(uint v) { uint s = v * 747796405u + 2891336281u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float sunHf(uint n) { return float(sunPcg(n)) * (1.0 / 4294967296.0); }
float sunHr(uint key, uint j) { return sunHf(sunPcg(key ^ (j * 2654435769u + 1u))); }

// Fine random radial streaks, O(1) per pixel: the pixel's angle is hashed into bins, each bin owns one jittered ray with its own length
// (log-normal), intensity and width; the pixel sums its own bin and the two neighbours. Two layers (coarse and fine). Red reaches furthest.
vec3 sunRays(vec2 cp, float r, float H, float discR) {
  float u = atan(cp.y, cp.x) * 0.15915494 + 0.5;
  vec3 acc = vec3(0.0);
  float k1 = H / 1000.0;
  float wpx = max(uRayWidth * k1, 0.5), skirt = 3.0 * k1, r0 = max(3.0 * discR, 0.03 * H);
  uint seed = uint(uRaySeed) * 7919u + 13u;
  for (int layer = 0; layer < 2; layer++) {
    float amp = layer == 0 ? 1.0 : uRayFine;
    if (amp <= 0.0) continue;
    float N = floor((layer == 0 ? uRayCount : uRayCount * 3.5) + 0.5);
    float lenK = layer == 0 ? 1.0 : 0.45;
    float a = u * N, i0 = floor(a);
    for (int k = -1; k <= 1; k++) {
      float bi = i0 + float(k);
      uint key = sunPcg(uint(int(mod(bi, N))) + seed + uint(layer) * 104729u);
      float centre = bi + sunHr(key, 0u);                          // anywhere in the bin: irregular spacing, no visible period
      float dperp = (a - centre) / N * 6.2831853 * r;
      float sig = wpx * (0.8 + 0.4 * sunHr(key, 5u));
      float prof = exp(-0.5 * dperp * dperp / (sig * sig)) + 0.12 * exp(-0.5 * dperp * dperp / (skirt * skirt));
      if (prof < 0.002) continue;
      float inten = pow(10.0, -sunHr(key, 1u));                    // log-uniform over one decade
      float gauss = (sunHr(key, 2u) + sunHr(key, 3u) + sunHr(key, 4u) - 1.5) * 2.0;
      float Li = clamp(uRayLen * H * lenK * exp(uRayLenVar * gauss), 4.0 * discR, 0.55 * H);
      vec3 Lc = Li * vec3(1.0, 1.0 - 0.1 * uRayChroma, 1.0 - 0.2 * uRayChroma);
      vec3 f = pow(max(1.0 - r / Lc, 0.0), vec3(1.5));
      acc += uRayTint * f * (r0 / (r + r0)) * inten * amp * prof;
    }
  }
  return acc * uRayStr;
}

vec3 sunLook(vec3 s, float hide, float open, vec2 uv, vec2 fragPx) {
  vec2 pxPos = uv * uCanvasPx, cp = pxPos - uSunUv * uCanvasPx;   // px from the Sun, y up
  float H = uCanvasPx.y, r = length(cp), discR = max(uSunDiscCanvasPx, 0.0);
  float fl = (1.0 - pow(1.0 - clamp(open, 0.0, 1.0), uOpenK)) * uSunFade;   // how much of the Sun's light reaches the lens
  // 8. sky lift: the black is a dark tinted grey, a little more near the Sun; sky only. It and the grain fade out with the distance from the Sun
  // (full to 0.3 skyLiftRadius x H, gone at skyLiftRadius x H), so the sky beyond that stays black with its stars.
  float reach = 1.0 - smoothstep(0.3 * uSkyLiftRadius * H, max(uSkyLiftRadius * H, 1.0), r);
  vec3 lift = uSkyTint * uSkyLift * hide * fl * reach * (0.5 + 0.5 / (1.0 + r * r / (0.25 * H * H)));
  s += lift;
  vec3 light = vec3(0.0);
  // 2. core bloom: Gaussian plus power law, a few disc radii wide, only partly hidden by the Moon / Earth
  float re = length(vec2(cp.x / uCoreAspect, cp.y)), sg = max(uCoreW * discR, 1.0);
  float bloom = uCoreStr * mix(exp(-0.5 * re * re / (sg * sg)), pow(1.0 / (1.0 + re * re / (0.5 * sg * sg)), 0.9), uCorePow);
  light += uCoreTint * bloom * fl * mix(1.0, hide, uCoreMask);
  // 3. veil: power-law wings, no edge; only partly hidden by the Moon / Earth (veilMask)
  float sv = max(uVeilScale * H, 1.0);
  light += uVeilTint * uVeilStr * pow(1.0 / (1.0 + r * r / (sv * sv)), 0.5 * uVeilN) * fl * mix(1.0, hide, uVeilMask);
  // 4. starburst rays
  if (uRayStr > 0.0 && fl > 0.0) light += sunRays(cp, r, H, discR) * fl * mix(1.0, hide, uStreakMask);
  // 5. sensor bloom smear: Gaussian across, exponential along (one-sided, softly two-sided with smearBack)
  if (uSmearStr > 0.0) {
    float an = radians(uSmearAngle); vec2 dir = vec2(cos(an), sin(an));
    float al = dot(cp, dir), ac = dot(cp, vec2(-dir.y, dir.x));
    float La = max(uSmearLen * H, 1.0), Wc = max(uSmearWidth * H, 1.0);
    float up = smoothstep(-0.2 * Wc, 0.2 * Wc, al);
    float along = mix(uSmearBack * exp(min(al, 0.0) / (0.6 * La)), exp(-max(al, 0.0) / La), up);
    light += uSmearTint * uSmearStr * exp(-0.5 * ac * ac / (Wc * Wc)) * along * fl * mix(1.0, hide, uStreakMask);
  }
  // 6. lens ghosts on the line from the Sun through the frame centre (t = 1 is the Sun, 0 the centre)
  if (uGhostStr > 0.0) {
    vec2 ctr = 0.5 * uCanvasPx, sp = uSunUv * uCanvasPx;
    vec3 gsum = vec3(0.0);
    for (int k = 0; k < 3; k++) {
      float d = length(pxPos - (ctr + uGhostT[k] * (sp - ctr))) / max(uGhostR[k] * H, 1.0);
      float body = (1.0 - smoothstep(1.0 - uGhostSoft, 1.0, d)) * (0.35 + 0.65 * d * d);
      vec3 col = k == 0 ? vec3(0.9, 0.8, 0.45) : (k == 1 ? vec3(0.55, 0.75, 1.0) : vec3(1.0, 0.65, 0.4));
      gsum += mix(col, vec3(0.9), 0.55) * body;   // barely coloured
    }
    light += gsum * uGhostStr * fl;
  }
  // 7. (horizon glow: not ported)
  // 9. camera cast, applied before the soft clip so a saturated core still goes white
  s *= uTint; light *= uTint;
  s = 1.0 - (1.0 - clamp(s, 0.0, 1.0)) * exp(-light);
  // 1. the disc: small, hard, saturated, with the limb's warm tint; hidden by the Moon / Earth
  float rr = r / max(discR, 0.5), mu = sqrt(max(0.0, 1.0 - rr * rr));
  vec3 limb = mix(vec3(1.0, 0.82, 0.62), vec3(1.0, 0.995, 0.98), pow(mu, 0.6)) * (0.86 + 0.14 * mu);
  vec3 dcol = mix(vec3(1.0, 0.985, 0.955), limb, uDiscLimb);
  s = mix(s, dcol, clamp((1.0 - smoothstep(discR - 0.5, discR + 0.5, r)) * hide * uDiscStr, 0.0, 1.0));
  // 8. grain: shot-noise look, amplitude grows with the local glow (sky lift counts as signal); sky only, seeded by the app's seed
  vec3 gl3 = 1.0 - exp(-light);
  float sig = dot(gl3, vec3(0.299, 0.587, 0.114)) + dot(lift, vec3(0.299, 0.587, 0.114)) * 2.0;
  float amp = uGrain * sqrt(sig + 0.01) * hide * uSunFade * reach;
  uvec2 q = uvec2(fragPx);
  uint nk = sunPcg(q.x + sunPcg(q.y + sunPcg(uSeed + 977u)));
  vec3 nz = vec3(sunHr(nk, 1u) + sunHr(nk, 2u) - 1.0) + 0.6 * vec3(sunHr(nk, 3u) + sunHr(nk, 4u) - 1.0, sunHr(nk, 5u) + sunHr(nk, 6u) - 1.0, sunHr(nk, 7u) + sunHr(nk, 8u) - 1.0);
  return s + nz * amp;
}
`
