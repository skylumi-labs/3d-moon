import * as THREE from 'three'

/**
 * Shared GLSL for the full-screen ray-cast passes (README, "Contract").
 * Units are Moon radii in the world frame (Moon-centred, J2000 axes).
 */
export const GLSL_COMMON = /* glsl */ `
#define PI 3.141592653589793
uniform mat4 uInvViewProj;   // clip to world, Moon radii
uniform vec3 uCamPos;        // camera in the world frame, Moon radii
uniform vec2 uResolution;    // drawing-buffer size, px
uniform float uPreExpose;    // radiance multiplier before the store

// The camera ray through a fragment, world frame, unit length.
vec3 cameraRay(vec2 fragCoord) {
  vec2 ndc = fragCoord / uResolution * 2.0 - 1.0;
  vec4 p = uInvViewProj * vec4(ndc, 1.0, 1.0);
  return normalize(p.xyz / p.w - uCamPos);
}

// Distance along o + t d to the near side of a sphere (centre c, radius r):
// -1 when the ray misses, 0 when o is inside. The Earth sits about 220 radii
// away, where float32 keeps the discriminant to ~1e-3 of r^2; the Sun is far
// enough that it is drawn by angle, never with this.
float sphereHit(vec3 o, vec3 d, vec3 c, float r) {
  vec3 oc = o - c;
  float b = dot(oc, d);
  float h = b * b - (dot(oc, oc) - r * r);
  if (h < 0.0) return -1.0;
  h = sqrt(h);
  float t = -b - h;
  if (t > 0.0) return t;
  return -b + h > 0.0 ? 0.0 : -1.0;
}
`

/**
 * Test switch for the half-float store (?fp16flush=1|2, README "Radiance"):
 * 1 zeroes every value below half-float's smallest normal number, one
 * channel at a time, as many phone and Apple GPUs do; 2 keeps them only in
 * half-float's subnormal steps of 6e-8. Apply to what a pass writes.
 */
export const GLSL_FLUSH16 = /* glsl */ `
uniform int uFlush16;
vec3 flush16(vec3 c) {
  if (uFlush16 == 1) return c * step(6.103515625e-5, c);
  if (uFlush16 == 2) return mix(round(c / 5.9604645e-8) * 5.9604645e-8, c, step(6.103515625e-5, c));
  return c;
}
`

/** One triangle that covers the screen; its vertex shader ignores the camera. */
export const FULLSCREEN_VERTEX = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`

export function fullscreenTriangle(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
  return g
}

/** The uniforms every pass shares; main.ts updates one set and passes share it. */
export function commonUniforms() {
  return {
    uInvViewProj: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uPreExpose: { value: 1 },
    // GLSL_FLUSH16's switch; a pass that does not declare it ignores it.
    uFlush16: { value: 0 },
  }
}

export const MOON_R_KM = 1737.4
export const EARTH_R_KM = 6371.0
export const SUN_R_KM = 695700
