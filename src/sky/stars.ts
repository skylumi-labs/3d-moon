import * as THREE from 'three'
import { GLSL_FLUSH16 } from '../glsl/common'
import { SUN_V } from '../moon/photometry'
import { boostGain, clampBoost } from './starBoost'
import { starDotMode, type StarDotMode } from './starDots'
import { drawCount, starMagOf, type StarMagConfig } from './starLimit'

/**
 * Background stars: the HYG catalogue to V 6.5 (asteroid-stars.json, as
 * moon-v1 draws them), fixed in the world frame (J2000). Each star is one
 * normalised Gaussian, sigma 0.7 px, added into the scene target in I/F
 * units, so the exposures treat a star exactly as they treat the ground:
 * I/F of a pixel that caught all of a star's light is pi F / F_sun / omega.
 * Alpha is left alone (stars are not sunlit ground). Drawn first; the Moon
 * pass then hides the ones behind the disc.
 * `?stars=native` (sky/starDots.ts) draws the same catalogue as dots in the final pass at canvas resolution instead: render() then draws nothing
 * here, and the dots layer shares this geometry, draw range and flux uniforms.
 */

const STARS_URL = new URL('../../shared-assets/asteroid-stars.json', import.meta.url).href
const DEG = Math.PI / 180

const VERTEX = /* glsl */ `
uniform mat4 uViewRotProj;   // world direction to clip, the camera's rotation only
uniform float uIf0;          // I/F of one pixel holding all of a 0 mag star
uniform float uPreExpose;
uniform float uGain;         // 1: physical flux; more: the boost slider's lift
uniform float uCap;          // where a lifted star levels off, stored units
uniform float uMix;          // 0..1 boost: 0 is exactly the physical star
in vec3 aColor;              // rgb with luminance 1
in float aFlux;              // 10^(-0.4 V)
out vec3 vCol;
out vec3 vLim;
void main() {
  vCol = aColor * aFlux * uIf0 * uPreExpose;
  vLim = vec3(uGain, uCap, uMix);
  vec4 c = uViewRotProj * vec4(position, 0.0);
  // At infinity: depth is irrelevant (no depth buffer), and a star behind
  // the camera has w < 0 and is clipped.
  gl_Position = vec4(c.xy, 0.0, c.w);
  gl_PointSize = 5.0;
}
`

const FRAGMENT = /* glsl */ `
${GLSL_FLUSH16}
in vec3 vCol;
in vec3 vLim;   // gain, cap, mix
out vec4 fragColor;
void main() {
  // gl_PointCoord puts the sprite's centre on the star's exact sub-pixel
  // position, so this samples the Gaussian at each pixel centre.
  vec2 d = (gl_PointCoord - 0.5) * 5.0;
  float w = exp(-dot(d, d) / (2.0 * 0.49)) / (2.0 * 3.14159265 * 0.49);
  // Capped below half-float's maximum (README): at the Earth view's 0.6 deg
  // field a first-magnitude star's peak pixel is already near 1e4.
  vec3 phys = min(vCol * w, vec3(6.0e4));
  // The boost leaves the physical star at mix 0 and eases to a smoothly capped, lifted one at 1: continuous in between.
  vec3 lifted = vCol * w * vLim.x;
  vec3 soft = vLim.y * (1.0 - exp(-lifted / vLim.y));
  vec3 o = mix(phys, soft, vLim.z);
  // moon-v1 emulated only the zeroing flush here.
  if (uFlush16 == 1) o = flush16(o);
  fragColor = vec4(o, 0.0);
}
`

export class StarPass {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera()
  readonly uniforms: Record<string, THREE.IUniform>
  readonly count: number
  /** Stars drawn this frame (the limiting-magnitude cull, `?starmag=`); `count` is the catalogue. */
  drawn: number
  private readonly mags: Float32Array
  /** Shared with the native dots layer (sky/starDots.ts): positions, colour, flux and the draw range. */
  readonly geometry: THREE.BufferGeometry
  private readonly magCfg: StarMagConfig = starMagOf(typeof location === 'undefined' ? '' : location.search)
  /** Where the stars are drawn: `scene` (these sprites; the default off the desktop class) or `native` (the default on the desktop class) (the final pass's dots). Never both. */
  readonly dots: StarDotMode
  /** Whether render() draws the sprites this frame: set by FinalPass.setStarDots (starPathsForFrame) before the scene is drawn; always in scene mode. */
  sprites = true

  private constructor(common: Record<string, THREE.IUniform>, geometry: THREE.BufferGeometry, count: number, mags: Float32Array, desktopClass = false) {
    this.dots = starDotMode(typeof location === 'undefined' ? '' : location.search, desktopClass)
    this.count = count
    this.drawn = count
    this.mags = mags
    this.geometry = geometry
    this.uniforms = {
      uPreExpose: common.uPreExpose,
      uFlush16: common.uFlush16,
      uViewRotProj: { value: new THREE.Matrix4() },
      uIf0: { value: 0 },
      uGain: { value: 1 },
      uCap: { value: 1 },
      uMix: { value: 0 },
    }
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    })
    const points = new THREE.Points(geometry, material)
    points.frustumCulled = false
    this.scene.add(points)
  }

  static async load(common: Record<string, THREE.IUniform>, desktopClass = false): Promise<StarPass> {
    const res = await fetch(STARS_URL)
    if (!res.ok) throw new Error(`Could not load the star catalogue (${res.status})`)
    const data = (await res.json()) as { stars: number[][] }
    // Brightest first, so a limiting magnitude is a draw range. Additive blending: the order does not change the picture.
    const stars = [...data.stars].sort((a, b) => a[2] - b[2])
    const n = stars.length
    const mags = new Float32Array(n)
    const pos = new Float32Array(n * 3)
    const col = new Float32Array(n * 3)
    const flux = new Float32Array(n)
    stars.forEach((s, i) => {
      mags[i] = s[2]
      const ra = s[0] * DEG, dec = s[1] * DEG
      pos.set([Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)], i * 3)
      const Y = 0.2126 * s[3] + 0.7152 * s[4] + 0.0722 * s[5]
      col.set([s[3] / Y, s[4] / Y, s[5] / Y], i * 3)
      flux[i] = Math.pow(10, -0.4 * s[2])
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
    g.setAttribute('aFlux', new THREE.BufferAttribute(flux, 1))
    return new StarPass(common, g, n, mags, desktopClass)
  }

  /**
   * Per frame. `viewRotProj` takes world directions to clip space (the
   * camera's rotation and projection, no translation: stars are at
   * infinity); `tanPerPx` is the target's pixel scale, so a coarse frame
   * spreads the same flux over bigger pixels. `skyGain` is the final pass's display-space lift (sky/skyStars.ts skyCullGain): stars it lifts must be drawn.
   * In native mode (sky/starDots.ts) the uniforms set here are read by the dots layer at the canvas's pixel scale, and the draw range set here is
   * replaced by cullFor() at that scale inside the final pass.
   */
  update(viewRotProj: THREE.Matrix4, tanPerPx: number, level = 1, boost = 0, cap = 1, white = 0, skyGain = 1): void {
    ;(this.uniforms.uViewRotProj.value as THREE.Matrix4).copy(viewRotProj)
    this.uniforms.uIf0.value = Math.PI * Math.pow(10, -0.4 * (0 - SUN_V)) / (tanPerPx * tanPerPx) * level
    this.uniforms.uGain.value = boostGain(boost)
    this.uniforms.uCap.value = Math.max(cap, 1e-6)
    this.uniforms.uMix.value = clampBoost(boost)
    // `white` 0 (not given): nothing is culled in auto mode.
    this.drawn = drawCount(this.magCfg, this.mags, this.uniforms.uIf0.value as number, white, (boost > 0 ? boostGain(boost) : 1) * Math.max(1, skyGain))
    this.geometry.setDrawRange(0, this.drawn)
  }

  /** The boost's flux gain as the cull sees it (1 with the boost off), from the last update(). */
  get fluxGain(): number { return (this.uniforms.uMix.value as number) > 0 ? (this.uniforms.uGain.value as number) : 1 }

  /** The cull again for another pixel scale (the native dots: the canvas's uIf0 and cull gain), so a grid step never changes which stars are drawn. */
  cullFor(if0: number, white: number, gain: number): number {
    this.drawn = drawCount(this.magCfg, this.mags, if0, white, gain)
    this.geometry.setDrawRange(0, this.drawn)
    return this.drawn
  }

  /** The scene-target sprites; nothing while the final pass draws the dots this frame (`sprites`, from starPathsForFrame). */
  render(renderer: THREE.WebGLRenderer): void {
    if (!this.sprites) return
    renderer.render(this.scene, this.camera)
  }
}
