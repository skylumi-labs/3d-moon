import * as THREE from 'three'
import { fullscreenTriangle } from '../glsl/common'
import {
  NIKON, SCREEN, SPLIT_ANGLE, copyRegionPx, deltaMm, pxPerMm, ringRadiusPx, zoneRadius,
} from '../quality/focusScreen'

/** Taps on the pupil zone per pixel (the prototype used 96); a per-pixel rotation keeps the lower count free of banding. */
const SAMPLES = 64

const VERTEX = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`

/**
 * The traced split prism (quality/focusScreen.ts has the optics and their numbers; this is the prototype's `physical()` shader). It reads the frame the app
 * has just drawn, from a copy of the middle of the framebuffer, and rewrites only the pixels inside the microprism ring (the split spot and the ring around it):
 * everything else is left exactly as drawn. `traced` (the `?focusmatte=traced` comparison) copies the whole frame and gives the rest of it the matte's blur.
 */
const FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uImg;
uniform vec2 uOrigin;   // framebuffer px of the copy's lower-left corner
uniform vec2 uCopy;     // the copy's size, px
uniform vec2 uCentre;   // the screen's centre, framebuffer px
uniform float uPxMm, uDelta, uN, uNp, uNm, uZr, uSplitR, uRingR, uPitch, uAngle, uVis, uTraced;
out vec4 fragColor;
vec3 S(vec2 px) { return texture(uImg, clamp((px - uOrigin) / uCopy, vec2(0.0), vec2(1.0))).rgb; }
// The mean over the part of the pupil zone (centre c, radius r, in exit-pupil radii) that lies inside the pupil, and the share of the zone that does.
vec4 zone(vec2 px, vec2 c, float r) {
  vec3 acc = vec3(0.0); float n = 0.0;
  float a = fract(sin(dot(px, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
  mat2 R = mat2(cos(a), sin(a), -sin(a), cos(a));
  for (int i = 0; i < ${SAMPLES}; i++) {
    float rr = sqrt((float(i) + 0.5) / ${SAMPLES}.0), th = float(i) * 2.399963;
    vec2 q = c + R * (rr * vec2(cos(th), sin(th))) * r;
    if (dot(q, q) <= 1.0) { acc += S(px + q / (2.0 * uN) * uDelta * uPxMm); n += 1.0; }
  }
  return vec4(n > 0.0 ? acc / n : vec3(0.0), n / ${SAMPLES}.0);
}
void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 mm = (px - uCentre) / uPxMm;
  float d = length(mm);
  vec3 base = S(px), col;
  if (d < uSplitR) {
    vec2 dir = vec2(cos(uAngle), sin(uAngle)); vec2 nrm = vec2(-dir.y, dir.x);
    float side = dot(mm, nrm) >= 0.0 ? 1.0 : -1.0;
    vec4 z = zone(px, dir * side * uN / uNp, uZr); col = z.rgb * z.a;
  } else if (d < uRingR) {
    vec2 l = mod(mm, uPitch) / uPitch - 0.5;
    vec2 dir = abs(l.x) > abs(l.y) ? vec2(sign(l.x), 0.0) : vec2(0.0, sign(l.y));
    vec4 z = zone(px, dir * uN / uNm, uZr); col = z.rgb * z.a;
  } else if (uTraced > 0.5) {
    col = zone(px, vec2(0.0), 1.0).rgb;
  } else discard;
  fragColor = vec4(mix(base, col, uVis), 1.0);
}
`

/**
 * One small pass after the final image: copies a square of the default framebuffer around the centre, then redraws the ring from it inside a scissor of the
 * same square. Not constructed with `?focuspull=0`; `draw` is not called while the indicator is invisible.
 */
export class FocusScreenPass {
  private readonly material: THREE.ShaderMaterial
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera()
  private tex: THREE.FramebufferTexture | null = null
  private readonly size = new THREE.Vector2()
  private readonly origin = new THREE.Vector2()

  constructor(private readonly traced: boolean) {
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uImg: { value: null }, uOrigin: { value: new THREE.Vector2() }, uCopy: { value: new THREE.Vector2(1, 1) }, uCentre: { value: new THREE.Vector2() },
        uPxMm: { value: 1 }, uDelta: { value: 0 }, uN: { value: NIKON.N }, uNp: { value: SCREEN.Np }, uNm: { value: SCREEN.Nm }, uZr: { value: zoneRadius() },
        uSplitR: { value: SCREEN.splitD / 2 }, uRingR: { value: SCREEN.splitD / 2 + SCREEN.ringW }, uPitch: { value: SCREEN.pitch },
        uAngle: { value: SPLIT_ANGLE }, uVis: { value: 0 }, uTraced: { value: traced ? 1 : 0 },
      },
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    })
    const mesh = new THREE.Mesh(fullscreenTriangle(), this.material)
    mesh.frustumCulled = false
    this.scene.add(mesh)
  }

  /** Draw onto the default framebuffer. `err` is the optics' focus error (focusScreen.opticsErr), `vis` the opacity. */
  draw(renderer: THREE.WebGLRenderer, err: number, vis: number): void {
    renderer.getDrawingBufferSize(this.size)
    const w = this.size.x, h = this.size.y
    if (w < 2 || h < 2) return
    // The copy is the ring's square, or the whole frame for the matte comparison.
    const side = this.traced ? 0 : Math.min(copyRegionPx(w, h), Math.floor(Math.min(w, h)))
    const cw = this.traced ? w : side, ch = this.traced ? h : side
    const ox = this.traced ? 0 : Math.max(0, Math.round(w / 2 - side / 2)), oy = this.traced ? 0 : Math.max(0, Math.round(h / 2 - side / 2))
    if (!this.tex || this.tex.image.width !== cw || this.tex.image.height !== ch) {
      this.tex?.dispose()
      this.tex = new THREE.FramebufferTexture(cw, ch)
      this.tex.minFilter = THREE.LinearFilter
      this.tex.magFilter = THREE.LinearFilter
    }
    this.origin.set(ox, oy)
    renderer.setRenderTarget(null)
    renderer.copyFramebufferToTexture(this.tex, this.origin)
    const u = this.material.uniforms
    u.uImg.value = this.tex
    u.uOrigin.value.set(ox, oy)
    u.uCopy.value.set(cw, ch)
    u.uCentre.value.set(w / 2, h / 2)
    u.uPxMm.value = pxPerMm(w, h)
    u.uDelta.value = deltaMm(err)
    u.uVis.value = vis
    const pr = renderer.getPixelRatio()
    const prevScissor = renderer.getScissorTest()
    const r = Math.ceil(ringRadiusPx(w, h)) + 1
    if (!this.traced) {
      renderer.setScissorTest(true)
      renderer.setScissor((w / 2 - r) / pr, (h / 2 - r) / pr, (2 * r) / pr, (2 * r) / pr)
    }
    const prevClear = renderer.autoClear
    renderer.autoClear = false
    renderer.render(this.scene, this.camera)
    renderer.autoClear = prevClear
    renderer.setScissorTest(prevScissor)
  }

  dispose(): void {
    this.tex?.dispose()
    this.material.dispose()
  }
}
