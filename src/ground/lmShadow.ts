/** The lunar module's shadow map from the Sun: one box, shared by the mesh side (LunarModule) and the ground shader. */
export const LM_SHADOW_HALF_M = 30
export const LM_SHADOW_NEAR = 1
export const LM_SHADOW_FAR = 200
/** The full-size map, and the size the compile-time constants below are written for. A class may ask for less (`lmShadowRes` in startupClass.ts): see `lmShadowSize`. */
export const LM_SHADOW_RES = 2048
/** The side, in texels, a class's `lmShadowRes` actually allocates: clamped to 256..LM_SHADOW_RES and rounded, so the chip, the depth target and the Sun light's own map can never disagree. */
export function lmShadowSize(classRes: number): number {
  return Number.isFinite(classRes) ? Math.max(256, Math.min(LM_SHADOW_RES, Math.round(classRes))) : LM_SHADOW_RES
}
/** GPU bytes by estimate of the two maps at one side length: the depth target (half-float colour + 32-bit float depth) and the Sun light's RGBA8 + depth map (~8 bytes a texel). */
export function lmShadowBytes(side: number): { target: number; sunMap: number } {
  return { target: side * side * (8 + 4), sunMap: side * side * 8 }
}
/**
 * Whether the module shadows itself: the Sun light's own shadow map (three's PCF map), sampled by the module's PBR materials. The ground under the module
 * does not depend on it (the ground pass reads its own depth map, LM_SHADE_GLSL).
 *
 * Off in the native app on an Imagination PowerVR GPU (issue #206). On the Pixel 10 Pro XL (PowerVR D-Series DXT-48-1536, Android WebView) the GPU
 * reset (GL_UNKNOWN_CONTEXT_RESET_KHR) 0.3 to 3.7 s after every Viewpoints -> Apollo 17 descent handed over to the ground view. A device bisect
 * cleared it 3/3 by dropping the module's draws, 0/3 by dropping only the shadow-map draws, and 3/3 by
 * compiling the module's materials without USE_SHADOWMAP, so the sampling, not the map, is what the driver cannot take. The website is unchanged: the
 * evidence is from the WebView in the app. `?lmself=0|1` forces it either way (measurement).
 */
export const LM_SELF_SHADOW_OFF_GPU = /PowerVR|Imagination/i
export function lmSelfShadow(nativeShell: boolean, renderer: string | undefined, search = ''): boolean {
  const forced = new URLSearchParams(search).get('lmself')
  if (forced === '0') return false
  if (forced === '1') return true
  return !(nativeShell && LM_SELF_SHADOW_OFF_GPU.test(renderer ?? ''))
}

/** Metres across one texel of the map (plane perpendicular to the Sun). */
export const LM_SHADOW_TEXEL_M = (2 * LM_SHADOW_HALF_M) / LM_SHADOW_RES
/** Depth bias in metres along the Sun ray: two texels, so a pad 6 cm off the ground still casts. */
export const LM_SHADOW_BIAS_M = 2 * LM_SHADOW_TEXEL_M

/**
 * GLSL for the module's ground shadow. Blocker search, then a filter whose radius is the Sun's angular
 * radius times the distance to the blockers: a pad's penumbra is millimetres, the tip of the shadow tens of centimetres.
 * `lmShadeAt(P, nrm)` is 1 in the light, 0 in the shadow. Needs SUN_RAD.
 */
export const LM_SHADE_GLSL = /* glsl */ `
uniform sampler2D uLmShadow;
uniform mat4 uLmShadowM;
uniform float uLmShadowOn;
const float LM_RANGE = ${(LM_SHADOW_FAR - LM_SHADOW_NEAR).toFixed(1)};
const float LM_TEXEL_M = ${LM_SHADOW_TEXEL_M.toFixed(6)};
const float LM_BIAS = ${(LM_SHADOW_BIAS_M / (LM_SHADOW_FAR - LM_SHADOW_NEAR)).toFixed(7)};
float lmShadeAt(vec3 P, vec3 nrm) {
  if (uLmShadowOn <= 0.0) return 1.0;
  vec4 sc = uLmShadowM * vec4(P + nrm * 0.02, 1.0);
  vec3 sp = sc.xyz / sc.w * 0.5 + 0.5;
  if (sp.x <= 0.0 || sp.x >= 1.0 || sp.y <= 0.0 || sp.y >= 1.0 || sp.z <= 0.0 || sp.z >= 0.999) return 1.0;
  vec2 ts = 1.0 / vec2(textureSize(uLmShadow, 0));
  // LM_TEXEL_M and LM_BIAS are written for LM_SHADOW_RES; a class with a smaller map has proportionally larger texels (and a larger two-texel bias).
  float lmK = ${LM_SHADOW_RES.toFixed(1)} * ts.x;
  float lmTexelM = LM_TEXEL_M * lmK;
  float lmBias = LM_BIAS * lmK;
  float rot = fract(sin(dot(P.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
  float sumD = 0.0, nb = 0.0;
  for (int i = 0; i < 16; i++) {
    float a = float(i) * 2.399963 + rot;
    vec2 o = vec2(cos(a), sin(a)) * sqrt((float(i) + 0.5) / 16.0) * 10.0;
    float dm = texture(uLmShadow, sp.xy + o * ts).r;
    // dm > 0: a texel the depth pass never wrote reads 0 (an unwritten map) and would shade the whole ground; only a written texel can occlude.
    if (dm > 0.0 && dm < sp.z - lmBias) { sumD += (sp.z - dm) * LM_RANGE; nb += 1.0; }
  }
  if (nb < 0.5) return 1.0;
  float rTex = clamp(SUN_RAD * (sumD / nb) / lmTexelM, 0.7, 12.0);
  float occ = 0.0;
  for (int i = 0; i < 32; i++) {
    float a = float(i) * 2.399963 + rot;
    vec2 o = vec2(cos(a), sin(a)) * sqrt((float(i) + 0.5) / 32.0) * rTex;
    float dm = texture(uLmShadow, sp.xy + o * ts).r;
    occ += (dm > 0.0 && dm < sp.z - lmBias) ? 1.0 : 0.0;
  }
  return 1.0 - occ / 32.0;
}
`
