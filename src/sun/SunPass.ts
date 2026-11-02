import * as THREE from 'three'
import { EARTH_R_KM, FULLSCREEN_VERTEX, GLSL_COMMON, GLSL_FLUSH16, MOON_R_KM, fullscreenTriangle } from '../glsl/common'
import { SUN_LIMB_U, SUN_R_KM } from '../lighting/solar'
import type { Ephemeris } from '../ephemeris'
import type { ViewCamera } from '../camera/pose'
import { earthNearSun, sunUsesDisplayPath } from './sunRouting'
import { SUN_LEGACY } from './sunLook'

type Common = Record<string, THREE.IUniform>

/**
 * The Sun's disc (README pass order: after the stars, before the Earth).
 *
 * Surface brightness in I/F is the disc's mean 1 / theta^2 (about 46,000 at
 * the Moon's distance) shaped by linear limb darkening per channel
 * (solar.ts SUN_LIMB_U, normalised so the disc's mean stays 1). Stored
 * pre-exposed, that is far past half-float's 65,504, so the disc is CLAMPED
 * to SUN_CAP when stored; the energy the clamp removes is handed to the
 * final pass as `glare`, which adds it back as an analytic veil (post/final.ts).
 * No corona: it is not drawn, and the page does not claim it.
 */

export const SUN_CAP = 6.0e4
/** `glareScale` main.ts passes while the Moon is the subject (the Sun is then a small bright disc at the frame's edge, not the exposure key). */
export const SUBJECT_SUN_GLARE = 0.003

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
${GLSL_FLUSH16}
uniform vec3 uSunDir;        // unit, camera to the Sun's centre
uniform float uTheta;        // angular radius seen from the camera, rad
uniform float uThetaMoon;    // angular radius at the Moon, rad: sets the surface brightness
uniform float uTanPerPx;
uniform float uCap;          // the stored disc's ceiling: SUN_CAP, or far lower while the Moon is the subject
const vec3 LIMB_U = vec3(${SUN_LIMB_U.map((v) => v.toFixed(4)).join(', ')});
out vec4 fragColor;
void main() {
  vec3 d = cameraRay(gl_FragCoord.xy);
  float sep = atan(length(cross(d, uSunDir)), dot(d, uSunDir));
  float cov = clamp((uTheta - sep) / uTanPerPx + 0.5, 0.0, 1.0);
  if (cov <= 0.0) discard;
  float r = min(1.0, sep / uTheta);
  float mu = sqrt(max(0.0, 1.0 - r * r));
  vec3 I = (1.0 - LIMB_U * (1.0 - mu)) / (1.0 - LIMB_U / 3.0) / (uThetaMoon * uThetaMoon);
  vec3 col = min(I * uPreExpose, vec3(uCap));
  // Alpha: coverage, which also writes the exposure key (the Sun is sunlit).
  fragColor = vec4(flush16(col), cov);
}
`

/** What the final pass needs to add the clamped disc's missing glare. */
export interface SunGlare {
  on: boolean
  /** The Sun's centre in the scene target, 0..1 (x right, y up). */
  uv: [number, number]
  /** Flux the clamp removed, per channel, in stored units x target pixels squared. */
  missing: [number, number, number]
  /** The disc's radius in scene-target pixels (the final pass shapes its display from it). */
  discPx: number
  /** 0..1: how much of the display-space lens glow to draw (the share of the Sun's disc left open, faded while the exposure catches up). */
  glow: number
  /** The disc is drawn by the final pass (Moon as subject), not stored in the scene. */
  direct: boolean
  /** The Earth's disc in the scene target: uv.xy, radius px (0: not near). */
  earthOcc: [number, number, number]
  /** The Earth's disc in the scene target whenever the Earth is in front of the camera (uv.xy, radius in px; 0: none), whatever the Sun's routing: the native star dots' mask (sky/starDots.ts). */
  earthDisc?: [number, number, number]
  /** The display-space Sun look (sunLook.ts) draws this frame's Sun; absent or false: the previous glow block. Only ever true with `direct`. */
  look?: boolean
  /** The scene target's depth is this frame's foreground coverage (ground mode, a flight's lander): the final pass hides the disc and bloom behind it and measures the open share. */
  cover?: boolean
  /** 0..1 share of the Sun's disc the Moon and the Earth leave open (the look's uSunOpen). */
  open?: number
  /** 0..1 how much of the look's glow to draw: falls to 0 as the Sun goes far off screen (the look's uSunFade; the Quality sheet's Glow off zeroes it). */
  fade?: number
}

/** Area of overlap of two discs (radii r1, r2, centres d apart), planar. */
function overlapArea(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0
  const rm = Math.min(r1, r2)
  if (d <= Math.abs(r1 - r2)) return Math.PI * rm * rm
  const a1 = Math.acos(Math.max(-1, Math.min(1, (d * d + r1 * r1 - r2 * r2) / (2 * d * r1))))
  const a2 = Math.acos(Math.max(-1, Math.min(1, (d * d + r2 * r2 - r1 * r1) / (2 * d * r2))))
  return r1 * r1 * (a1 - Math.sin(a1) * Math.cos(a1)) + r2 * r2 * (a2 - Math.sin(a2) * Math.cos(a2))
}

export class SunPass {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera()
  private readonly uniforms: Record<string, THREE.IUniform>
  private visible = false
  readonly glare: SunGlare = { on: false, uv: [0.5, 0.5], missing: [0, 0, 0], discPx: 0, glow: 0, direct: false, earthOcc: [0, 0, 0], earthDisc: [0, 0, 0], look: false, cover: false, open: 0, fade: 0 }

  constructor(common: Common) {
    this.uniforms = {
      ...common,
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uTheta: { value: 0.0047 },
      uThetaMoon: { value: 0.0047 },
      uTanPerPx: { value: 1e-3 },
      uCap: { value: SUN_CAP },
    }
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    })
    const mesh = new THREE.Mesh(fullscreenTriangle(), material)
    mesh.frustumCulled = false
    this.scene.add(mesh)
  }

  update(e: Ephemeris, cam: ViewCamera, width: number, height: number, tanPerPx: number, preExpose: number, glareScale = 1, white = 0, foreground = false, coverage = false): void {
    const u = this.uniforms
    const rel = e.sunKm.clone().divideScalar(MOON_R_KM).sub(cam.pos)
    const distKm = rel.length() * MOON_R_KM
    const dir = rel.clone().normalize()
    const theta = Math.asin(SUN_R_KM / distKm)
    const thetaMoon = Math.asin(SUN_R_KM / e.sunKm.length())
    ;(u.uSunDir.value as THREE.Vector3).copy(dir)
    u.uTheta.value = theta
    u.uThetaMoon.value = thetaMoon
    u.uTanPerPx.value = tanPerPx
    // Exposed for the Moon (white is ~8 after pre-exposure), the Sun is a bright dot a few dozen times white, not 6e4 times it: the glare pyramid of that is the blob that flooded the orbit.
    // The disc is stored a few times white (so it shows as a saturated white disc), not 6e4: the pyramid of that is the blob that flooded the orbit.
    u.uCap.value = glareScale < 1 ? Math.min(SUN_CAP, Math.max(400, 3 * white)) : SUN_CAP

    // Where the Sun's centre falls in the frame (in front of the camera only).
    const back = dir.dot(cam.back)
    const aspect = width / height
    this.visible = back < 0
    const g = this.glare
    g.on = false
    g.glow = 0
    g.look = false
    g.cover = false
    g.open = 0
    g.fade = 0
    g.earthOcc = [0, 0, 0]
    g.earthDisc = [0, 0, 0]
    const earthRel = e.earthKm.clone().divideScalar(MOON_R_KM).sub(cam.pos)
    // Every in-frame Sun is drawn in display space except eclipse views (the Earth covers or nearly covers it) and foreground views (sunRouting.ts).
    const eclipse = earthNearSun(rel, earthRel, earthRel.length() * MOON_R_KM, distKm)
    g.direct = sunUsesDisplayPath({ legacy: SUN_LEGACY, glareScale, foreground, coverage, eclipse })
    // The native star pass needs the geometric Earth mask even when the Sun
    // itself is behind the camera, so project Earth independently of Sun UVs.
    {
      const ed = earthRel.length() * MOON_R_KM
      const eb = earthRel.dot(cam.back)
      if (eb < 0 && ed > 1.5 * EARTH_R_KM) {
        const er = Math.asin(Math.min(1, EARTH_R_KM / ed))
        const ex = earthRel.dot(cam.right) / -eb / (cam.tanHalf * aspect), ey = earthRel.dot(cam.up) / -eb / cam.tanHalf
        g.earthDisc = [0.5 + 0.5 * ex, 0.5 + 0.5 * ey, Math.tan(er) / tanPerPx]
        // The Sun's occultation keeps its routing: only a display-space Sun is hidden by the Earth here.
        if (g.direct) g.earthOcc = g.earthDisc
      }
    }
    if (!this.visible) return
    const ndcX = dir.dot(cam.right) / -back / (cam.tanHalf * aspect)
    const ndcY = dir.dot(cam.up) / -back / cam.tanHalf
    // The flux the clamp removes, per channel: the profile's excess over SUN_CAP,
    // averaged over the disc by area, times the disc's area in target pixels.
    const rPx = Math.tan(theta) / tanPerPx
    const I0 = 1 / (thetaMoon * thetaMoon)
    const missing: [number, number, number] = [0, 0, 0]
    for (let c = 0; c < 3; c++) {
      const uc = SUN_LIMB_U[c]
      let s = 0
      const n = 64
      for (let i = 0; i < n; i++) {
        const r = (i + 0.5) / n
        const mu = Math.sqrt(1 - r * r)
        const val = I0 * (1 - uc * (1 - mu)) / (1 - uc / 3) * preExpose
        s += Math.max(0, val - SUN_CAP) * 2 * r / n
      }
      missing[c] = s * Math.PI * rPx * rPx
    }
    // A Sun the Earth or the Moon hides sends no light into the lens, so no
    // glare: scale by the share of its disc left open (the two bodies'
    // uncovered shares multiplied; they rarely overlap each other on the Sun).
    const open = (centre: THREE.Vector3, radius: number): number => {
      const sep = Math.atan2(dir.clone().cross(centre.clone().normalize()).length(), dir.dot(centre.clone().normalize()))
      return 1 - overlapArea(theta, radius, sep) / (Math.PI * theta * theta)
    }
    const moonRel = cam.pos.clone().negate()
    const earthOpen = earthRel.length() * MOON_R_KM < 1.5 * EARTH_R_KM ? 1
      : open(earthRel, Math.asin(Math.min(1, EARTH_R_KM / (earthRel.length() * MOON_R_KM))))
    const openShare = earthOpen *
      open(moonRel, Math.asin(Math.min(1, 1 / moonRel.length())))
    for (let c = 0; c < 3; c++) missing[c] *= g.direct ? 0 : openShare * glareScale
    g.uv = [0.5 + 0.5 * ndcX, 0.5 + 0.5 * ndcY]
    g.missing = missing
    g.discPx = rPx
    // Moon as the subject or turning to the Sun: the disc and its glow are display-side, so the exposure catching up never pumps them.
    g.glow = g.direct ? openShare : 0
    g.look = g.direct && !SUN_LEGACY
    // Terrain or the module in front of a display-space Sun is hidden per pixel from the scene target's depth (sunCoverage.ts). Legacy keeps the old draw.
    g.cover = g.direct && foreground && coverage && !SUN_LEGACY
    g.open = openShare
    const far = Math.max(Math.abs(ndcX), Math.abs(ndcY))
    g.fade = far <= 2 ? 1 : far >= 4 ? 0 : (() => { const t = (far - 2) / 2; return 1 - t * t * (3 - 2 * t) })()
    g.on = Math.abs(ndcX) < 4 && Math.abs(ndcY) < 4
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.visible || this.glare.direct) return
    renderer.render(this.scene, this.camera)
  }
}
