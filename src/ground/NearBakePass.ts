import * as THREE from 'three'
import { trackGpu } from '../quality/track'
import { FULLSCREEN_VERTEX, fullscreenTriangle } from '../glsl/common'
import { NEAR_TRACKS } from './nearField'
import { NB_LEVELS, NB_RES, NB_EXTENT_M, levelOrigin, levelsToBake, nearBakeBytes, nearBakeFragment, snapCentre, texelM, type BakeLevel } from './nearBake'
import { compileForTarget } from '../net/compileTarget'

/**
 * Draws the near field into its three levels (nearBake.ts) and keeps them centred on the camera. Owned by the ground pass: it makes the target (12 MiB) on the first
 * `update` in ground mode (never in a warm-up) and `release` frees it on leaving ground mode and on a lost context.
 */
export class NearBakePass {
  /** The uniforms the ground shader reads: the level array and each level's place (corner east and north, 1 / width, texel; z = 0 until drawn). */
  readonly uniforms = {
    uNfTex: { value: null as THREE.Texture | null },
    uNfC: { value: Array.from({ length: NB_LEVELS }, () => new THREE.Vector4(0, 0, 0, 1)) },
  }
  readonly levels: BakeLevel[] = Array.from({ length: NB_LEVELS }, () => ({ cx: 0, cy: 0, valid: false }))
  /** Levels drawn since the last `release` (debug and the perf harness: how often a walk redraws). */
  draws = 0
  private rt: THREE.WebGLArrayRenderTarget | null = null
  private material: THREE.ShaderMaterial | null = null
  private mesh: THREE.Mesh | null = null
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera()
  private readonly geometry = fullscreenTriangle()
  private readonly u = { uBakeO: { value: new THREE.Vector2() }, uBakeTexel: { value: 1 } }

  /** The bake program (no GPU memory until it first draws). */
  private ensureProgram(): void {
    if (this.material) return
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: nearBakeFragment(NEAR_TRACKS),
      uniforms: this.u,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    })
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
  }

  /** The 12 MiB target: made on the first draw in ground mode, never by a warm-up. */
  private ensureTarget(): void {
    this.ensureProgram()
    if (this.rt) return
    this.rt = new THREE.WebGLArrayRenderTarget(NB_RES, NB_RES, NB_LEVELS, {
      format: THREE.RGFormat, type: THREE.HalfFloatType, internalFormat: 'RG16F',
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false,
    })
    this.rt.texture.wrapS = this.rt.texture.wrapT = THREE.ClampToEdgeWrapping
    trackGpu('patch', 'ground-near-bake', nearBakeBytes(), this.rt)
    this.uniforms.uNfTex.value = this.rt.texture
  }

  /** Compiles the bake program without drawing and without allocating the target (a visitor who never enters ground mode pays nothing). */
  async warm(renderer: THREE.WebGLRenderer): Promise<void> {
    this.ensureProgram()
    if (!this.mesh) return
    this.scene.clear()
    this.scene.add(this.mesh)
    try { await compileForTarget(renderer, this.scene, this.camera) } catch { /* the first draw compiles it */ }
    this.scene.clear()
  }

  /** Per frame while the ground is drawn: redraws the levels the camera (frame metres east, north) has outgrown. Returns the number drawn. Restores the renderer's target. */
  update(renderer: THREE.WebGLRenderer, camE: number, camN: number): number {
    const due = levelsToBake(this.levels, camE, camN)
    if (due.length === 0) return 0
    this.ensureTarget()
    const rt = this.rt
    const mesh = this.mesh
    if (!rt || !mesh) return 0
    const prevTarget = renderer.getRenderTarget()
    const prevFace = renderer.getActiveCubeFace()
    const prevMip = renderer.getActiveMipmapLevel()
    this.scene.clear()
    this.scene.add(mesh)
    try {
      for (const l of due) {
        const lv = this.levels[l]
        const cx = snapCentre(camE, l), cy = snapCentre(camN, l)
        const [ox, oy] = levelOrigin(cx, cy, l)
        this.u.uBakeO.value.set(ox, oy)
        this.u.uBakeTexel.value = texelM(l)
        renderer.setRenderTarget(rt, l)
        renderer.render(this.scene, this.camera)
        lv.cx = cx; lv.cy = cy; lv.valid = true
        this.uniforms.uNfC.value[l].set(ox, oy, 1 / NB_EXTENT_M[l], texelM(l))
        this.draws++
      }
    } finally {
      this.scene.clear()
      renderer.setRenderTarget(prevTarget, prevFace, prevMip)
    }
    return due.length
  }

  /** What the levels hold is gone (a lost context): the next `update` draws them again. */
  invalidate(): void {
    for (const l of this.levels) l.valid = false
    for (const c of this.uniforms.uNfC.value) c.z = 0
  }

  /** Frees the 12 MiB target (leaving ground mode, a lost context); the program stays (it is small and compiled). The next `update` makes the target again. */
  release(): void {
    this.rt?.dispose()
    this.rt = null
    this.uniforms.uNfTex.value = null
    this.invalidate()
    this.draws = 0
  }

  /** Frees everything. */
  dispose(): void {
    this.release()
    this.material?.dispose()
    this.material = null
    this.mesh = null
    this.geometry.dispose()
  }
}
