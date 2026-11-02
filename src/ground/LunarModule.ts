import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { type GroundView, groundBasis } from './frame'
import { G_FAR, G_NEAR } from './GroundPass'
import { LM_SHADOW_FAR, LM_SHADOW_HALF_M, LM_SHADOW_NEAR, LM_SHADOW_RES, lmShadowBytes, lmShadowSize } from './lmShadow'
import { type Placement, attitudeQuat } from './lmPlacement'
import { DustSheet } from '../descent/DustSheet'
import { modelQuaternion } from '../descent/flight'
import type { CameraPreset } from './presets'
import { trackGpu } from '../quality/track'
import { ledger, textureBytes } from '../quality/ledger'
/** Module instances made so far: keys the ledger line of each one's sun shadow map. */
let lmCount = 0
import { bounceAmbientIntensity, bounceLighting } from './bounceLight'
import { type LmLook, lmLook, lmTextures, tuneLmTexture } from './lmMaterials'

/**
 * The lunar module in ground mode (G1): NASA's "Apollo Lunar Module" model (M. Carbajal, NASA-3D-Resources,
 * `public/lm/apollo-lunar-module.glb`, 716,840 bytes, 134 meshes, 97,588 triangles; NASA publishes no licence
 * for it: research build, see README) placed at the Haase control point on the fused ground, lit by the real
 * Sun of the moment, with a shadow onto the regolith (a depth map from the Sun, read by the ground pass).
 *
 * Frames: the model is metres, y up. The ground frame is east, north, up; three's is (east, up, south),
 * so an ENU vector (e, n, u) is (e, u, -n) here.
 *
 * What is measured and what is not (the HUD says it): the position is the Haase control point plus the frame
 * shift; the shape is NASA's model (not necessarily LM-12, which is a J-mission LM); the heading is inferred
 * (windows to the west); the tilt is fitted to the ground under the pads.
 */

const ZERO3 = new THREE.Vector3()
export const enuToThree = (e: number, n: number, u: number): THREE.Vector3 => new THREE.Vector3(e, u, -n)
/** Maps ENU column vectors to three's axes: (e, n, u) to (e, u, -n). */
export const ENU_TO_THREE = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1)

export class LunarModule {
  readonly scene = new THREE.Scene()
  readonly root = new THREE.Group()
  readonly model: THREE.Group
  readonly sun = new THREE.DirectionalLight(0xffffff, Math.PI)
  readonly camera = new THREE.PerspectiveCamera(40, 1, G_NEAR, G_FAR)
  /** Depth of the module seen from the Sun, for the ground pass. */
  readonly shadowTarget: THREE.WebGLRenderTarget
  readonly shadowCam = new THREE.OrthographicCamera(-LM_SHADOW_HALF_M, LM_SHADOW_HALF_M, LM_SHADOW_HALF_M, -LM_SHADOW_HALF_M, LM_SHADOW_NEAR, LM_SHADOW_FAR)
  /** Footpad centres (model space, base of the pad). */
  readonly pads: THREE.Vector3[]
  /** The G1 rest pose of the model root (three's axes), the target of a landing blend. */
  private readonly restPos = new THREE.Vector3()
  private readonly restQuat = new THREE.Quaternion()
  placement: Placement = { headingDeg: 270, pitchDeg: 0, rollDeg: 0, z: 0, clearanceM: [0, 0, 0, 0] }
  private readonly metadataOccluder = new THREE.ShaderMaterial({
    vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
    depthTest: true, depthWrite: false, blending: THREE.NoBlending,
  })
  private readonly depthMat = new THREE.MeshBasicMaterial({ colorWrite: false })
  private envRT: THREE.WebGLRenderTarget | null = null
  /** Phone classes: the bounce is one ambient term and no environment is built (ground/bounceLight.ts). */
  private phone = false
  readonly bounceAmbient = new THREE.AmbientLight(0xffffff, 0)
  /** Flight (G2b): the landing dust and the optional engine glow live in this scene; the rebase is subtracted from every position so a module 500 km away is drawn near the camera. */
  readonly dust = new DustSheet()
  private rebase = new THREE.Vector3()
  private flying = false
  private plume: THREE.Mesh | null = null

  /** Side of the depth target and of the Sun light's shadow map, in texels (the class's `lmShadowRes`; the Reduced chip prints this number). */
  readonly shadowRes: number
  private readonly ledgerId = ++lmCount

  private constructor(model: THREE.Group, shadowRes: number = LM_SHADOW_RES, lite = false, selfShadow = true) {
    this.lite = lite
    this.selfShadow = selfShadow
    this.shadowRes = lmShadowSize(shadowRes)
    const res = this.shadowRes
    this.model = model
    this.root.add(model)
    this.scene.add(this.root)
    this.scene.add(this.sun, this.sun.target)
    this.scene.add(this.dust.mesh)
    this.shadowTarget = new THREE.WebGLRenderTarget(res, res, { depthBuffer: true, depthTexture: new THREE.DepthTexture(res, res, THREE.FloatType), type: THREE.HalfFloatType })
    // Half-float colour + 32-bit float depth. The sun light's own shadow map (same side) is allocated by three on first draw (an RGBA8 colour
    // plus depth, ~8 bytes a texel by estimate); it is registered here because it is owned by this module's one light.
    const bytes = lmShadowBytes(res)
    trackGpu('lm', 'shadow-target', bytes.target, this.shadowTarget)
    // Registered once under this module's own key and released in dispose() (issue #206: the line used to be registered twice and never freed).
    // Without self-shadowing (lmSelfShadow) the Sun light never casts, so three never allocates its map.
    if (selfShadow) ledger.set('lm', `sun-shadow-map-est#${this.ledgerId}`, bytes.sunMap)
    this.pads = detectPads(model)
    this.sun.castShadow = selfShadow
    this.sun.shadow.mapSize.set(res, res)
    const c = this.sun.shadow.camera
    c.left = -8; c.right = 8; c.top = 8; c.bottom = -8; c.near = 1; c.far = 60
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.02
  }

  /** Whether the model's materials are `MeshStandardMaterial` (the phone-class knob, `lmLite`) instead of `MeshPhysicalMaterial` (clearcoat on the foil). */
  readonly lite: boolean
  /** The Sun light casts three's shadow map onto the module itself (lmShadow.ts lmSelfShadow); false compiles its materials without USE_SHADOWMAP. */
  readonly selfShadow: boolean

  static async load(url: string, dracoPath: string, shadowRes: number = LM_SHADOW_RES, opts: { phone?: boolean; lite?: boolean; selfShadow?: boolean; look?: LmLook } = {}): Promise<LunarModule> {
    const draco = new DRACOLoader().setDecoderPath(dracoPath)
    const loader = new GLTFLoader().setDRACOLoader(draco)
    const gltf = await loader.loadAsync(url)
    draco.dispose()
    const lm = new LunarModule(gltf.scene, shadowRes, opts.lite === true, opts.selfShadow !== false)
    lm.phone = opts.phone === true
    lm.scene.add(lm.bounceAmbient)
    // The look-dev variant the page asks for (`?lmlook=`, lmMaterials.ts), read here so the arrival's preload (main.ts) builds the same module.
    lm.tuneMaterials(opts.look ?? lmLook(typeof location === 'undefined' ? '' : location.search))
    return lm
  }

  /** The look the materials were tuned with (`?lmlook=`). */
  look: LmLook | null = null

  /**
   * PBR for the materials that dominate. The descent stage is wrapped in aluminised Kapton: not a flat paint but a crinkled foil
   * that breaks the Sun into a mottle of glints over a dull amber-brown. The model's own colours are paint-saturated (a flat
   * yellow-orange), so the foil is desaturated toward Apollo-era surface photographs and given a procedural crinkle normal map;
   * the legs' orange foil is darker; bare structure stays grey and rough. Colours are a CHOICE from reference photographs, not a measurement.
   * An authored normal, roughness or metalness map is kept where the model has one (this glb has none: lmMaterials.ts); the crinkle stands in only without.
   * The `look` sets the albedo scale, the foil's roughness and metalness and the crinkle's strength (lmMaterials.ts LM_LOOKS).
   */
  private tuneMaterials(look: LmLook): void {
    this.look = look
    const crinkle = crinkleNormalMap()
    const lite = this.lite
    const done = new Map<THREE.Material, THREE.MeshStandardMaterial>()
    this.model.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      m.castShadow = true
      m.receiveShadow = true
      const old = m.material as THREE.MeshStandardMaterial
      const cached = done.get(old)
      if (cached) { m.material = cached; return }
      const col = old.color ? old.color.clone() : new THREE.Color(0.5, 0.5, 0.5)
      // The model's own maps, where it has them: base colour, and a normal, roughness or metalness map (none in this glb) that a procedural stand-in must not replace.
      const authored = { map: old.map ?? null, normalMap: old.normalMap ?? null, roughnessMap: old.roughnessMap ?? null, metalnessMap: old.metalnessMap ?? null }
      // `lite` (phone classes): the standard PBR program instead of the physical one. The only physical term in use is the foil's clearcoat, scaled to 0.1
      // below, so the look is near identical; the point is one smaller program family to link on the main thread (R50). `?lmmat=physical` restores it.
      const mat: THREE.MeshStandardMaterial = lite
        ? new THREE.MeshStandardMaterial({ color: col, ...authored, roughness: 0.4, metalness: 0.0 })
        : new THREE.MeshPhysicalMaterial({ color: col, ...authored, roughness: 0.4, metalness: 0.0 })
      const phys = mat instanceof THREE.MeshPhysicalMaterial ? mat : null
      if (authored.normalMap) mat.normalScale.set(old.normalScale?.x ?? 1, old.normalScale?.y ?? 1)
      // The crinkle stands in for a normal map the model lacks, at the strength `k` (0 keeps the surface flat).
      const crinkled = (k: number): void => {
        if (authored.normalMap || k <= 0) return
        mat.normalMap = crinkle; mat.normalScale.set(k, k)
        if (phys && phys.clearcoat > 0) { phys.clearcoatNormalMap = crinkle; phys.clearcoatNormalScale.set(k, k) }
      }
      const lum = 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b
      const gold = col.r > col.b * 3 && col.r > 0.4
      if (gold) {
        const orange = col.g < 0.4 * col.r
        // Foil: amber-brown, a little less saturated and a third darker than the paint; crinkled; half metallic (the look's numbers).
        mat.color.setRGB(orange ? 0.30 : 0.46, orange ? 0.16 : 0.27, orange ? 0.05 : 0.07)
        mat.metalness = look.foilMetalness; mat.roughness = look.foilRoughness
        if (phys) { phys.clearcoat = 0.25; phys.clearcoatRoughness = 0.5 }
        crinkled(look.crinkle)
      } else if (lum > 0.6) { mat.metalness = 0.3; mat.roughness = 0.4; mat.color.multiplyScalar(0.75); crinkled(look.structureCrinkle) }
      else if (lum < 0.1) { mat.roughness = 0.7 }
      // An authored roughness or metalness map multiplies the factor in three: the factor becomes the map's scale, so it is 1 where a map exists.
      if (authored.roughnessMap) mat.roughness = 1
      if (authored.metalnessMap) mat.metalness = 1
      // Ground mode is exposed for the regolith (white at 5x its I/F, ~0.11). The model's paint and foil are several times brighter than regolith, so at full albedo the foil
      // and the white structure clip (audit 6/7: foil near white in the strut view). Scaled down so the sunlit module sits below white; a look choice, not a measured albedo.
      mat.color.multiplyScalar(look.albedoScale)
      if (phys) phys.clearcoat *= 0.4
      mat.name = old.name
      done.set(old, mat)
      m.material = mat
    })
  }

  /**
   * Trilinear mips and `aniso` (lmMaterials.lmAnisotropy of the GPU's maximum) on every texture the materials hold, the crinkle included: the model's
   * loader leaves anisotropy at 1, which smears the foil along a grazing view. Called by GroundMode.loadLm with the renderer in hand (the preload builds
   * the module without one); a texture already on the GPU is re-uploaded once. Returns how many textures changed.
   */
  setAnisotropy(aniso: number): number {
    let n = 0
    for (const t of lmTextures(this.model)) if (tuneLmTexture(t, aniso)) { t.needsUpdate = true; n++ }
    return n
  }

  /** The soft ground bounce and dark sky: a two-tone environment (lit regolith below at `groundRadiance`, the Sun of the moment's I/F of the ground; black above). */
  private bounce = 0
  private preExpose = 1
  /** Sets the ground bounce (I/F of the lit ground the module's underside sees), rebuilding the environment only when it moved by more than 5%. */
  setBounce(renderer: THREE.WebGLRenderer, iof: number): void {
    if (this.bounce > 0 && Math.abs(Math.log(Math.max(iof, 1e-4) / this.bounce)) < 0.05) return
    this.buildEnvironment(renderer, Math.max(iof, 1e-4))
  }

  buildEnvironment(renderer: THREE.WebGLRenderer, groundRadiance = 0.03): void {
    this.bounce = groundRadiance
    if (bounceLighting(this.phone) === 'ambient') {
      // A phone: no environment and no PMREM chain; the ambient term carries the bounce (its pre-exposure follows in place()).
      this.envRT?.dispose()
      this.envRT = null
      this.scene.environment = null
      this.bounceAmbient.intensity = bounceAmbientIntensity(this.phone, groundRadiance, this.preExpose)
      return
    }
    this.envRT?.dispose()
    const s = new THREE.Scene()
    const geo = new THREE.SphereGeometry(50, 32, 16)
    const pos = geo.attributes.position
    const colors = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) { const v = pos.getY(i) < 0 ? groundRadiance : 0; colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = v }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })))
    const pm = new THREE.PMREMGenerator(renderer)
    this.envRT = pm.fromScene(s, 0.02)
    // The PMREM cube-UV chain is half-float RGBA.
    trackGpu('lm', 'pmrem-env', textureBytes(this.envRT.width, this.envRT.height, 8), this.envRT)
    pm.dispose()
    geo.dispose()
    this.scene.environment = this.envRT.texture
  }

  /** Places the module: origin at the frame's (0, 0), with the attitude. `z` is the model origin's height in the frame. */
  setPlacement(p: Placement): void {
    this.placement = p
    this.restPos.set(0, p.z, 0)
    this.restQuat.copy(attitudeQuat(p))
    this.flying = false
    this.rebase.set(0, 0, 0)
    this.dust.mesh.visible = false
    this.root.position.set(0, p.z, 0)
    this.root.quaternion.copy(attitudeQuat(p))
    this.root.updateMatrixWorld(true)
  }

  /**
   * Flight: the model origin at `pos` (frame ENU metres) with the attitude `bodyToEnu`, everything drawn relative to `rebase`
   * (frame metres; zero in ground mode, the camera's own position far from the site).
   */
  setFlightPose(pos: THREE.Vector3, bodyToEnu: THREE.Quaternion, rebase: THREE.Vector3): void {
    this.flying = true
    this.rebase.copy(rebase)
    this.root.position.set(pos.x - rebase.x, pos.z - rebase.z, -(pos.y - rebase.y))
    this.root.quaternion.copy(modelQuaternion(bodyToEnu))
    this.root.updateMatrixWorld(true)
  }
  /** Flight, settling: the track's pose blended `k` (0 to 1) toward the G1 rest placement last set by `setPlacement` (k = 1 is exactly the rest pose). */
  setFlightPoseBlend(pos: THREE.Vector3, bodyToEnu: THREE.Quaternion, k: number): void {
    this.flying = true
    this.rebase.set(0, 0, 0)
    const p = new THREE.Vector3(pos.x, pos.z, -pos.y)
    this.root.position.copy(p.lerp(this.restPos, k))
    this.root.quaternion.copy(modelQuaternion(bodyToEnu).slerp(this.restQuat, k))
    this.root.updateMatrixWorld(true)
  }
  get rebaseM(): THREE.Vector3 { return this.rebase }

  /** The engine glow: a MODELLED cone under the bell, off by default (the real exhaust was invisible in the film). `throttle` 0 to 1 scales its length. */
  setPlume(on: boolean, throttle: number): void {
    if (!this.plume) {
      const geo = new THREE.ConeGeometry(0.55, 1, 24, 1, true)
      geo.translate(0, -0.5, 0)
      this.plume = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.72, 0.4), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }))
      this.plume.position.set(0, 0.4, 0)
      this.model.add(this.plume)
    }
    this.plume.visible = on && throttle > 0.01
    this.plume.scale.set(0.6 + 0.6 * throttle, 1.5 + 5 * throttle, 0.6 + 0.6 * throttle)
  }

  /** A preset as a ground view (frame metres and degrees), for the module as placed. */
  presetView(pr: CameraPreset): GroundView {
    const pos = this.toFrame(new THREE.Vector3(...pr.eye))
    const d = new THREE.Vector3(...pr.look).normalize().applyQuaternion(this.root.quaternion)
    const e = d.x, n = -d.z, u = d.y
    return { pos, headingDeg: Math.atan2(e, n) * 180 / Math.PI, pitchDeg: Math.asin(u) * 180 / Math.PI, rollDeg: 0, tanHalf: Math.tan(pr.fovDeg * Math.PI / 360) }
  }

  /** A model-space point in frame metres (east, north, up). */
  toFrame(v: THREE.Vector3): THREE.Vector3 {
    const w = v.clone().applyMatrix4(this.root.matrixWorld)
    return new THREE.Vector3(w.x + this.rebase.x, -w.z + this.rebase.y, w.y + this.rebase.z)
  }

  /** Per frame: the Sun (frame direction), the exposure scale, and how much of the Sun reaches the module (terrain shadow, 0 to 1). */
  updateLight(sunFrame: THREE.Vector3, preExpose: number, sunShare: number): void {
    const s3 = enuToThree(sunFrame.x, sunFrame.y, sunFrame.z).normalize()
    const mid = this.flying ? this.root.position : ZERO3
    this.sun.position.copy(s3).multiplyScalar(40).add(mid)
    this.sun.target.position.set(mid.x, mid.y + 2, mid.z)
    this.sun.target.updateMatrixWorld()
    this.sun.intensity = Math.PI * preExpose * sunShare
    this.dust.setSun(s3)
    // A basic (unlit) material is not scaled by the pre-exposure the lit surfaces are, so its colour carries it: about a sunlit surface's radiance, times 0.12: a faint glow.
    if (this.plume) (this.plume.material as THREE.MeshBasicMaterial).color.setRGB(1.0, 0.72, 0.4).multiplyScalar(preExpose * 0.12)
    this.sun.castShadow = this.selfShadow && sunShare > 0.01
    this.scene.environmentIntensity = preExpose
    this.preExpose = preExpose
    // Only the phone path (no PMREM environment) lights the bounce with the ambient; desktop and tablet keep it at 0.
    this.bounceAmbient.intensity = bounceAmbientIntensity(this.phone, this.bounce, preExpose)
    // The ground pass's shadow camera: from the Sun, looking at the module.
    const c = this.shadowCam
    c.position.copy(s3).multiplyScalar(60).add(mid)
    c.up.set(0, 1, 0)
    if (Math.abs(s3.y) > 0.99) c.up.set(0, 0, 1)
    c.lookAt(mid)
    c.updateMatrixWorld(true)
    c.updateProjectionMatrix()
  }

  /** The matrix taking frame metres to the shadow camera's clip space. */
  shadowMatrix(): THREE.Matrix4 {
    return new THREE.Matrix4().multiplyMatrices(this.shadowCam.projectionMatrix, this.shadowCam.matrixWorldInverse).multiply(ENU_TO_THREE)
  }

  renderShadow(renderer: THREE.WebGLRenderer): void {
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(this.shadowTarget)
    renderer.clear(false, true, false)
    this.scene.overrideMaterial = this.depthMat
    const shadowOn = renderer.shadowMap.enabled
    renderer.shadowMap.enabled = false
    renderer.render(this.scene, this.shadowCam)
    renderer.shadowMap.enabled = shadowOn
    this.scene.overrideMaterial = null
    renderer.setRenderTarget(prev)
  }

  /** Draws the module into the bound target, testing against the ground pass's depth in it. */
  render(renderer: THREE.WebGLRenderer, view: GroundView, aspect: number): void {
    const cam = this.camera
    cam.fov = 2 * Math.atan(view.tanHalf) * 180 / Math.PI
    cam.aspect = aspect
    cam.near = G_NEAR
    cam.far = G_FAR
    cam.updateProjectionMatrix()
    const b = groundBasis(view)
    const r = enuToThree(b.right.x, b.right.y, b.right.z), u = enuToThree(b.up.x, b.up.y, b.up.z), k = enuToThree(b.back.x, b.back.y, b.back.z)
    cam.matrixAutoUpdate = false
    cam.matrixWorld.makeBasis(r, u, k).setPosition(enuToThree(view.pos.x, view.pos.y, view.pos.z))
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert()
    renderer.render(this.scene, cam)
  }

  /** Exclude the actual module geometry from Moon eligibility without changing its shading. */
  renderMetadataOcclusion(renderer: THREE.WebGLRenderer, view: GroundView, aspect: number): void {
    const dust = this.dust.mesh.visible, plume = this.plume?.visible
    const previous = this.scene.overrideMaterial
    this.dust.mesh.visible = false
    if (this.plume) this.plume.visible = false
    this.scene.overrideMaterial = this.metadataOccluder
    try { this.render(renderer, view, aspect) }
    finally {
      this.scene.overrideMaterial = previous
      this.dust.mesh.visible = dust
      if (this.plume && plume !== undefined) this.plume.visible = plume
    }
  }

  dispose(): void {
    ledger.release('lm', `sun-shadow-map-est#${this.ledgerId}`)
    this.metadataOccluder.dispose()
    this.dust.dispose()
    this.shadowTarget.dispose()
    this.envRT?.dispose()
    this.sun.shadow.dispose()
    // The model's own GPU objects: geometry, materials and every texture they hold (the shared crinkle map is disposed once, repeats are harmless).
    this.model.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      m.geometry.dispose()
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose()
        mat.dispose()
      }
    })
  }
}

/**
 * The four pad bases. The model draws all four pads in one mesh (group31_19, x and z within +-3.21, base at y 0.10, 0.17 thick),
 * so the centres are read from its extent less a pad radius of 0.45 m (a real pad is 0.94 m across): +-2.76 m on the two axes.
 */
function detectPads(_model: THREE.Object3D): THREE.Vector3[] {
  const c = 3.21 - 0.45
  // The four legs stand on the model's axes (the front leg with the ladder on +z), not on the diagonals: the base vertices of the pad mesh cluster at (0, +-2.9) and (+-2.9, 0).
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, z]) => new THREE.Vector3(c * x, 0.1, c * z))
}

/**
 * A tileable crinkled-foil normal map: ridged value noise at four scales (sharp creases over broad waves), 256 px, wrapping.
 * Procedural, so it ships no image and has no source to credit.
 */
let crinkleCache: THREE.DataTexture | null = null
function crinkleNormalMap(): THREE.DataTexture {
  if (crinkleCache) return crinkleCache
  const N = 256
  const lattice = (cells: number, seed: number): Float32Array => {
    const g = new Float32Array(cells * cells)
    let x = seed >>> 0
    for (let i = 0; i < g.length; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; g[i] = x / 4294967296 }
    return g
  }
  const h = new Float32Array(N * N)
  const octaves: Array<[number, number, number]> = [[4, 1, 11], [8, 0.6, 23], [16, 0.35, 37], [32, 0.18, 51]]
  for (const [cells, amp, seed] of octaves) {
    const g = lattice(cells, seed)
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = x / N * cells, fy = y / N * cells
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty)
      const at = (i: number, j: number) => g[(j % cells) * cells + (i % cells)]
      const v = at(x0, y0) * (1 - sx) * (1 - sy) + at(x0 + 1, y0) * sx * (1 - sy) + at(x0, y0 + 1) * (1 - sx) * sy + at(x0 + 1, y0 + 1) * sx * sy
      h[y * N + x] += amp * (1 - Math.abs(2 * v - 1))
    }
  }
  const data = new Uint8Array(N * N * 4)
  const strength = 7
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (h[y * N + (x + 1) % N] - h[y * N + (x + N - 1) % N]) * strength
    const dy = (h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x]) * strength
    const len = Math.hypot(dx, dy, 1)
    const o = (y * N + x) * 4
    data[o] = Math.round((-dx / len * 0.5 + 0.5) * 255); data[o + 1] = Math.round((-dy / len * 0.5 + 0.5) * 255); data[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255); data[o + 3] = 255
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter
  t.generateMipmaps = true
  t.repeat.set(3, 3)
  t.needsUpdate = true
  trackGpu('lm', 'crinkle-normal', textureBytes(N, N, 4, { mips: true }), t)
  crinkleCache = t
  return t
}
