import * as THREE from 'three'
import { FULLSCREEN_VERTEX, fullscreenTriangle } from '../../glsl/common'
import { ledger } from '../../quality/ledger'

/**
 * Dev/rig: reads an unsigned-integer envelope texture (RG32UI, eight sector bytes a texel) back to the CPU. three's readRenderTargetPixels cannot read an integer target, so a
 * pass copies one 32-bit word of each texel into an RGBA8 target (its four bytes as the four channels, exact: byte / 255 round-trips through unorm8) and that is read.
 * Output layout: ((y * w + x) * 8 + sector), the byte of sector s being byte (s & 3) of word (s >> 2) (little-endian: sector 0 in the low byte of .x, sector 4 in the low byte of .y).
 */
export const ENV_READBACK_FRAGMENT = /* glsl */ `
out vec4 fragColor;
uniform highp usampler2D uSrc2;
uniform highp usampler2DArray uSrcArr;
uniform int uWord;      // 0: .x (sectors 0..3), 1: .y (sectors 4..7)
uniform int uLayer;     // array layer
uniform int uIsArray;
void main() {
  ivec2 i = ivec2(floor(gl_FragCoord.xy));
  uvec2 v = uIsArray > 0 ? texelFetch(uSrcArr, ivec3(i, uLayer), 0).rg : texelFetch(uSrc2, i, 0).rg;
  uint w = uWord == 0 ? v.x : v.y;
  fragColor = vec4(float(w & 255u), float((w >> 8u) & 255u), float((w >> 16u) & 255u), float(w >> 24u)) / 255.0;
}
`

function emptyU2(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint32Array(2), 1, 1, THREE.RGIntegerFormat, THREE.UnsignedIntType)
  t.internalFormat = 'RG32UI'; t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true
  return t
}
function emptyUA(): THREE.DataArrayTexture {
  const t = new THREE.DataArrayTexture(new Uint32Array(2), 1, 1, 1)
  t.format = THREE.RGIntegerFormat; t.type = THREE.UnsignedIntType; t.internalFormat = 'RG32UI'; t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true
  return t
}

export class EnvReadback {
  private readonly material: THREE.ShaderMaterial
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.Camera()
  private rt: THREE.WebGLRenderTarget | null = null
  private readonly e2 = emptyU2()
  private readonly ea = emptyUA()

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: ENV_READBACK_FRAGMENT,
      uniforms: { uSrc2: { value: this.e2 }, uSrcArr: { value: this.ea }, uWord: { value: 0 }, uLayer: { value: 0 }, uIsArray: { value: 0 } },
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    })
    const mesh = new THREE.Mesh(fullscreenTriangle(), this.material)
    mesh.frustumCulled = false
    this.scene.add(mesh)
  }

  private target(w: number, h: number): THREE.WebGLRenderTarget {
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      this.rt?.dispose()
      ledger.set('tiles', 'env-readback', w * h * 4)
      this.rt = new THREE.WebGLRenderTarget(w, h, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false })
    }
    return this.rt
  }

  private pass(w: number, h: number, word: number, out: Uint8Array): void {
    const r = this.renderer
    const rt = this.target(w, h)
    const prev = r.getRenderTarget(), prevFace = r.getActiveCubeFace(), prevMip = r.getActiveMipmapLevel(), prevAuto = r.autoClear
    this.material.uniforms.uWord.value = word
    r.autoClear = false
    r.setRenderTarget(rt)
    r.render(this.scene, this.camera)
    const px = new Uint8Array(w * h * 4)
    r.readRenderTargetPixels(rt, 0, 0, w, h, px)
    r.setRenderTarget(prev, prevFace, prevMip)
    r.autoClear = prevAuto
    for (let t = 0; t < w * h; t++) for (let b = 0; b < 4; b++) out[t * 8 + word * 4 + b] = px[t * 4 + b]
  }

  /** A w x h RG32UI texture: w * h * 8 bytes. */
  read2D(texture: THREE.Texture, w: number, h: number): Uint8Array {
    this.material.uniforms.uIsArray.value = 0
    this.material.uniforms.uSrc2.value = texture
    const out = new Uint8Array(w * h * 8)
    this.pass(w, h, 0, out); this.pass(w, h, 1, out)
    this.material.uniforms.uSrc2.value = this.e2
    return out
  }

  /** One layer of an n x n RG32UI array: n * n * 8 bytes. */
  readLayer(texture: THREE.Texture, layer: number, n: number): Uint8Array {
    this.material.uniforms.uIsArray.value = 1
    this.material.uniforms.uSrcArr.value = texture
    this.material.uniforms.uLayer.value = layer
    const out = new Uint8Array(n * n * 8)
    this.pass(n, n, 0, out); this.pass(n, n, 1, out)
    this.material.uniforms.uSrcArr.value = this.ea
    return out
  }

  dispose(): void { ledger.release('tiles', 'env-readback'); this.rt?.dispose(); this.material.dispose(); this.e2.dispose(); this.ea.dispose() }
}
