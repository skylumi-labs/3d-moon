import * as THREE from 'three'
import { FULLSCREEN_VERTEX, GLSL_COMMON, GLSL_FLUSH16, fullscreenTriangle } from '../glsl/common'
import type { Observer } from './observer'

type Common = Record<string, THREE.IUniform>

/**
 * The air and the ground of the ridge view, drawn over the finished scene (stars, Moon, Earth) before the glare:
 *
 *  1. Extinction: the air's transmission along each ray, per channel, from Kasten-Young airmass and Rayleigh plus
 *     aerosol optical depth (moon-v1's values for 1500 m), scaled by how much of the air's column is above the
 *     camera. A camera balance takes back 60% of the yellowing (a look choice, as in moon-v1).
 *  2. The sky: moon-v1's twilight model (zenith luminance against the Sun's altitude, brighter toward the horizon and
 *     the Sun's side, warm low on that side), plus a thin airglow band above the limb once the camera is high.
 *     Illustrative, not radiative transfer.
 *  3. The ground: a ridge that is procedural and illustrative (moon-v1's fractal line, placed by the Moon's own
 *     azimuth), then the Earth's limb, which is the true horizon for the camera's height. Both are dark shapes.
 *     The exposure key (alpha) goes to 0 there.
 *
 * Everything scales with `air`, so from the top of the lift the pass draws nothing but the dark Earth below the limb.
 */

const COMMON_GLSL = /* glsl */ `
${GLSL_COMMON}
${GLSL_FLUSH16}
uniform vec3 uZenith;
uniform vec3 uNorth;
uniform vec3 uEast;
uniform float uMoonAz;      // deg
uniform float uMoonAlt;     // deg, geometric
uniform float uSunAlt;      // deg
uniform float uSunAz;       // deg
uniform float uAir;         // share of the air column above the camera
uniform float uDipDeg;      // the horizon's dip for the camera's height
uniform float uRidge;       // 0..1
uniform float uLiftKm;
uniform float uHaze;
uniform float uEarthLook;
uniform float uAltKm;
out vec4 fragColor;

// Kasten-Young (1989) relative airmass for a true altitude in deg.
float airmass(float h) {
  h = max(h, -0.5);
  return 1.0 / (sin(radians(h)) + 0.50572 * pow(h + 6.07995, -1.6364));
}
float elevOf(vec3 r) { return degrees(asin(clamp(dot(r, uZenith), -1.0, 1.0))); }
float azOf(vec3 r) { return degrees(atan(dot(r, uEast), dot(r, uNorth))); }
float wrap180(float a) { return a - 360.0 * floor((a + 180.0) / 360.0); }

// Twilight and night sky, I/F units (luminance / 40,400 cd m^-2): moon-v1's model.
float logZenith(float h) {
  if (h >= 0.0) return 3.0;
  if (h > -3.0) return mix(3.0, 1.6, -h / 3.0);
  if (h > -6.0) return mix(1.6, 0.3, (-h - 3.0) / 3.0);
  if (h > -9.0) return mix(0.3, -1.2, (-h - 6.0) / 3.0);
  if (h > -12.0) return mix(-1.2, -2.5, (-h - 9.0) / 3.0);
  if (h > -15.0) return mix(-2.5, -3.3, (-h - 12.0) / 3.0);
  if (h > -18.0) return mix(-3.3, -3.55, (-h - 15.0) / 3.0);
  return -3.55;
}
vec3 skyRad(float altDeg, float dazDeg) {
  float h = uSunAlt;
  float L = pow(10.0, logZenith(h)) / 40400.0;
  float horizon = 1.0 + 2.2 * exp(-max(altDeg, 0.0) / 9.0);
  float sunward = exp(-abs(dazDeg) / 55.0);
  float twilight = smoothstep(-19.0, -4.0, h) * (1.0 - smoothstep(-2.0, 4.0, h));
  vec3 blue = vec3(0.34, 0.52, 1.0);
  vec3 warm = vec3(1.0, 0.55, 0.28);
  float warmMix = twilight * sunward * exp(-max(altDeg, 0.0) / 7.0);
  vec3 c = mix(blue, warm, clamp(warmMix, 0.0, 1.0));
  float night = 1.0 - smoothstep(-18.0, -12.0, h);
  c = mix(c, vec3(0.55, 0.6, 0.75), night);
  return c * L * horizon * (1.0 + 2.0 * warmMix) * (0.8 + 0.4 * uHaze);
}
`

const EXTINCTION = /* glsl */ `
${COMMON_GLSL}
void main() {
  vec3 r = cameraRay(gl_FragCoord.xy);
  float X = airmass(elevOf(r));
  vec3 tau = (vec3(0.045, 0.080, 0.150) + vec3(0.040, 0.050, 0.060) * uHaze) * uAir;
  vec3 T = exp(-tau * X);
  vec3 wb = pow(vec3(T.g) / max(T, vec3(1e-4)), vec3(0.6));
  fragColor = vec4(T * wb, 1.0);
}
`

const SKY = /* glsl */ `
${COMMON_GLSL}
void main() {
  vec3 r = cameraRay(gl_FragCoord.xy);
  float elev = elevOf(r);
  float daz = wrap180(azOf(r) - uSunAz);
  vec3 c = skyRad(elev, daz) * uAir;
  // The airglow band above the limb, once the camera is above most of the air: thin, blue-white, brighter toward the Sun.
  float thin = smoothstep(0.02, 0.5, 1.0 - uAir);
  float above = elev + uDipDeg;
  float tk = 0.25 + 0.06 * sqrt(max(uAltKm, 0.0));
  float band = thin * exp(-max(above, 0.0) / tk) * step(0.0, above);
  vec3 glow = mix(vec3(0.35, 0.55, 1.0), vec3(1.0, 0.6, 0.35), 0.5 * exp(-abs(daz) / 40.0) * step(uSunAlt, 0.0)) * 9.0e-6;
  c += glow * band;
  fragColor = vec4(flush16(c * uPreExpose), 0.0);
}
`

const GROUND = /* glsl */ `
${COMMON_GLSL}
// moon-v1's ridge: a fractal line in screen degrees, low on the right, high on the left.
float ridgeAlt(float xDeg) {
  float r = -0.18 - 0.55 * xDeg;
  float amp = 0.06, f = 3.1;
  for (int i = 0; i < 6; i++) {
    float t = xDeg * f + float(i) * 13.1;
    float n = sin(t) * 0.6 + sin(t * 1.93 + 1.7) * 0.4;
    r += amp * n;
    amp *= 0.5; f *= 2.07;
  }
  return r;
}
void main() {
  vec3 r = cameraRay(gl_FragCoord.xy);
  float elev = elevOf(r);
  float az = azOf(r);
  float w = max(fwidth(elev), 1e-5);
  float xDeg = wrap180(az - uMoonAz) * cos(radians(uMoonAlt));
  // The ridge drops as the camera rises: a ridge about 6 km away.
  float drop = degrees(atan(uLiftKm / 6.0));
  float line = uMoonAlt + ridgeAlt(xDeg) - drop;
  float covRidge = uRidge * clamp(0.5 - (elev - line) / w, 0.0, 1.0);
  float covLimb = (1.0 - uEarthLook) * clamp(0.5 - (elev + uDipDeg) / w, 0.0, 1.0);
  float cov = max(covRidge, covLimb);
  if (cov <= 0.0) discard;
  // Forest and rock lit by twilight only, with a little air in front: a silhouette, not a veil. The Earth below the limb is darker still.
  float daz = wrap180(az - uSunAz);
  vec3 sky = skyRad(max(elev, 0.0), daz) * uAir;
  vec3 g = sky * mix(0.02, 0.012, covRidge) * (0.6 + 0.4 * uHaze) + vec3(0.6, 0.7, 1.0) * 2.0e-7 * (1.0 - uAir);
  fragColor = vec4(flush16(g * uPreExpose), cov);
}
`

export interface RidgeFrame {
  air: number
  altKm: number
  dipDeg: number
  ridge: number
  liftKm: number
  earthLook?: number
}

export class RidgePass {
  private readonly scene = new THREE.Scene()
  private readonly metadataScene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera()
  private readonly uniforms: Record<string, THREE.IUniform>
  /** Aerosol scale: 1 is a clear evening at 1500 m. */
  haze = 1

  constructor(common: Common) {
    this.uniforms = {
      ...common,
      uZenith: { value: new THREE.Vector3(0, 0, 1) },
      uNorth: { value: new THREE.Vector3(1, 0, 0) },
      uEast: { value: new THREE.Vector3(0, 1, 0) },
      uMoonAz: { value: 0 },
      uMoonAlt: { value: 3 },
      uSunAlt: { value: -10 },
      uSunAz: { value: 270 },
      uAir: { value: 1 },
      uDipDeg: { value: 1 },
      uRidge: { value: 1 },
      uLiftKm: { value: 0 },
      uHaze: { value: 1 },
      uAltKm: { value: 0 },
      uEarthLook: { value: 0 },
    }
    const geometry = fullscreenTriangle()
    const mk = (fragmentShader: string, order: number, o: Partial<THREE.ShaderMaterialParameters>): void => {
      const material = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERTEX, fragmentShader, uniforms: this.uniforms,
        depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendEquationAlpha: THREE.AddEquation, ...o,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.frustumCulled = false
      mesh.renderOrder = order
      this.scene.add(mesh)
    }
    const occlusion = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: GROUND.replace('vec4(flush16(g * uPreExpose), cov)', 'vec4(0.0, 0.0, 0.0, cov)'),
      uniforms: this.uniforms, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    })
    const occluder = new THREE.Mesh(geometry, occlusion)
    occluder.frustumCulled = false
    this.metadataScene.add(occluder)
    // 1. Multiply what is there by the transmission; leave alpha (the exposure key) alone.
    mk(EXTINCTION, 0, { blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor })
    // 2. Add the sky's light; alpha alone.
    mk(SKY, 1, { blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor })
    // 3. The ground over everything, by coverage; its exposure key is 0.
    mk(GROUND, 2, { blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor })
  }

  update(obs: Observer, moon: { alt: number; az: number }, sun: { alt: number; az: number }, f: RidgeFrame): void {
    const u = this.uniforms
    ;(u.uZenith.value as THREE.Vector3).copy(obs.zenith)
    ;(u.uNorth.value as THREE.Vector3).copy(obs.north)
    ;(u.uEast.value as THREE.Vector3).copy(obs.east)
    u.uMoonAz.value = moon.az
    u.uMoonAlt.value = moon.alt
    u.uSunAlt.value = sun.alt
    u.uSunAz.value = sun.az
    u.uAir.value = f.air
    u.uAltKm.value = f.altKm
    u.uEarthLook.value = f.earthLook ?? 0
    u.uDipDeg.value = f.dipDeg
    u.uRidge.value = f.ridge
    u.uLiftKm.value = f.liftKm
    u.uHaze.value = this.haze
  }

  renderMetadataOcclusion(renderer: THREE.WebGLRenderer): void { renderer.render(this.metadataScene, this.camera) }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera)
  }
}
