import * as THREE from 'three'
import { GLSL_FLUSH16 } from '../glsl/common'
import { FullscreenPass } from './fullscreen'
import { GLARE_LEVELS, type TargetSet } from './targets'
import { ABL_GLARE_LEVELS } from '../abl'

/**
 * Lens glare from an HDR pyramid (moon-v1): a 13-tap downsample (Jimenez
 * 2014) to 1/128 of the frame, then a 9-tap tent upsample that adds each
 * level's own share on the way back up.
 */

const DOWN_FRAGMENT = /* glsl */ `
${GLSL_FLUSH16}
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uSrcTexel;
void main() {
  vec2 uv = vUv;
  vec2 t = uSrcTexel;
  vec3 a = texture(uSrc, uv + t * vec2(-2, 2)).rgb, b = texture(uSrc, uv + t * vec2(0, 2)).rgb, c = texture(uSrc, uv + t * vec2(2, 2)).rgb;
  vec3 d = texture(uSrc, uv + t * vec2(-2, 0)).rgb, e = texture(uSrc, uv).rgb, f = texture(uSrc, uv + t * vec2(2, 0)).rgb;
  vec3 g = texture(uSrc, uv + t * vec2(-2, -2)).rgb, h = texture(uSrc, uv + t * vec2(0, -2)).rgb, i = texture(uSrc, uv + t * vec2(2, -2)).rgb;
  vec3 j = texture(uSrc, uv + t * vec2(-1, 1)).rgb, k = texture(uSrc, uv + t * vec2(1, 1)).rgb;
  vec3 l = texture(uSrc, uv + t * vec2(-1, -1)).rgb, m = texture(uSrc, uv + t * vec2(1, -1)).rgb;
  vec3 o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  fragColor = vec4(flush16(o), 1.0);
}
`

const UP_FRAGMENT = /* glsl */ `
${GLSL_FLUSH16}
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uLow;      // smaller level, already accumulated
uniform sampler2D uHere;     // this level of the down chain
uniform vec2 uLowTexel;
uniform float uWeight;       // weight of this level's own glare
uniform float uLowWeight;    // 0 for the coarsest level: nothing below it
void main() {
  vec2 t = uLowTexel;
  vec3 s = texture(uLow, vUv + t * vec2(-1, 1)).rgb + texture(uLow, vUv + t * vec2(1, 1)).rgb
         + texture(uLow, vUv + t * vec2(-1, -1)).rgb + texture(uLow, vUv + t * vec2(1, -1)).rgb;
  s += 2.0 * (texture(uLow, vUv + t * vec2(0, 1)).rgb + texture(uLow, vUv + t * vec2(0, -1)).rgb
            + texture(uLow, vUv + t * vec2(1, 0)).rgb + texture(uLow, vUv + t * vec2(-1, 0)).rgb);
  s += 4.0 * texture(uLow, vUv).rgb;
  vec3 o = uLowWeight * s / 16.0 + uWeight * texture(uHere, vUv).rgb;
  fragColor = vec4(flush16(o), 1.0);
}
`

// Weights per level. A lens PSF's wings fall off steeply beyond a few
// arcminutes; with the long exposure lifting the earthlit ground about
// 2,500 times, anything flatter shows as a grey veil (moon-v1, measured
// against a reference photograph).
export const WEIGHTS = [0.30, 0.15, 0.06, 0.015, 0.004, 0.001, 0]

export class GlarePass {
  private readonly down: FullscreenPass
  private readonly up: FullscreenPass

  constructor(common: Record<string, THREE.IUniform>) {
    this.down = new FullscreenPass(DOWN_FRAGMENT, {
      uFlush16: common.uFlush16,
      uSrc: { value: null },
      uSrcTexel: { value: new THREE.Vector2() },
    })
    this.up = new FullscreenPass(UP_FRAGMENT, {
      uFlush16: common.uFlush16,
      uLow: { value: null },
      uHere: { value: null },
      uLowTexel: { value: new THREE.Vector2() },
      uWeight: { value: 0 },
      uLowWeight: { value: 1 },
    })
  }

  /** Fills t.up[0], the glare at half the scene's resolution. */
  run(renderer: THREE.WebGLRenderer, t: TargetSet, maxLevels = GLARE_LEVELS, mark?: (name: string) => void): void {
    if (ABL_GLARE_LEVELS === 0) return
    const L = Math.min(GLARE_LEVELS, ABL_GLARE_LEVELS, maxLevels)
    let src = t.scene
    const du = this.down.uniforms
    let level = 0
    for (const d of t.down.slice(0, L)) {
      mark?.(`glare-down${level++}`)
      du.uSrc.value = src.texture
      ;(du.uSrcTexel.value as THREE.Vector2).set(1 / src.width, 1 / src.height)
      this.down.render(renderer, d)
      src = d
    }
    const uu = this.up.uniforms
    let low = t.down[L - 1]
    for (let i = L - 1; i >= 0; i--) {
      mark?.(`glare-up${i}`)
      uu.uLow.value = low.texture
      uu.uHere.value = t.down[i].texture
      ;(uu.uLowTexel.value as THREE.Vector2).set(1 / low.width, 1 / low.height)
      uu.uWeight.value = WEIGHTS[i]
      // The coarsest level has nothing below it (reading its own down level
      // there once added a frame-wide copy of the crescent as a grey veil).
      uu.uLowWeight.value = i === L - 1 ? 0 : 1
      this.up.render(renderer, t.up[i])
      low = t.up[i]
    }
  }
}
