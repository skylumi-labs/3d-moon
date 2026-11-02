import * as THREE from 'three'
import { fullscreenTriangle } from '../glsl/common'

/** The post passes' vertex shader: the screen triangle with texture coordinates. */
export const POST_VERTEX = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

/** One full-screen draw with its own material; no blending, no depth. */
export class FullscreenPass {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera()
  readonly material: THREE.ShaderMaterial

  constructor(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, vertexShader: string = POST_VERTEX) {
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    })
    const mesh = new THREE.Mesh(fullscreenTriangle(), this.material)
    mesh.frustumCulled = false
    this.scene.add(mesh)
  }

  get uniforms(): Record<string, THREE.IUniform> {
    return this.material.uniforms
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null): void {
    renderer.setRenderTarget(target)
    renderer.render(this.scene, this.camera)
  }
}
