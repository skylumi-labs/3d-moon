import * as THREE from 'three'
import { trackGpu } from '../quality/track'
import { SM_CELL_M, type SiteMax } from './siteMax'
import { FULLSCREEN_VERTEX, fullscreenTriangle } from '../glsl/common'
import type { Ephemeris } from '../ephemeris'
import type { MoonPass } from '../moon/MoonPass'
import type { PatchLayout } from '../moon/moonShader'
import { R_M, type FrameAxes, type GroundView, type SiteFrame, enuDir, groundBasis } from './frame'
import { groundFragment, type GroundKind } from './groundShader'
import { groundWarmKinds, type GroundWarmKind } from './warmKinds'
import { AsyncTexelRead, type ReadGl } from './asyncRead'
import { NEAR_BAKED } from './nearField'
import { NearBakePass } from './NearBakePass'
import { compileForTarget } from '../net/compileTarget'

const DEG = Math.PI / 180
/** The mesh camera's planes, metres. The ground pass writes the depth this camera would store. */
export const G_NEAR = 0.2
export const G_FAR = 60000

/** What the ground pass needs for one frame. */
export interface GroundFrameInput {
  frame: SiteFrame
  axes: FrameAxes
  ephem: Ephemeris
  view: GroundView
  /** The frame origin's metres east and north of the patch's site point. */
  patchOffEN: [number, number]
  aspect: number
}

/** One probed point: the ground height over the 1737.4 km sphere, the Sun's visibility, and the slope (rise over run east, north). */
export interface GroundSample { h: number; lit: number; slopeE: number; slopeN: number; lmShade: number }

const MAX_PROBE = 32

/** The probe target's two rows as samples (the fence read, `probePoll`; `probe` unpacks the same layout inline): row 0 height, Sun visibility, slope; row 1 the module's shade. */
function unpackSamples(buf: Float32Array, n: number): GroundSample[] {
  const out: GroundSample[] = []
  for (let i = 0; i < n; i++) out.push({ h: buf[i * 4], lit: buf[i * 4 + 1], slopeE: buf[i * 4 + 2], slopeN: buf[i * 4 + 3], lmShade: buf[(MAX_PROBE + i) * 4] })
  return out
}

/**
 * Renders the Moon's ground in the site frame (groundShader.ts) over the Moon pass's data: it borrows the
 * Moon pass's uniform table (tiles, patch levels, maps, the Sun and Earth), so it sees exactly what that pass sees.
 */
export class GroundPass {
  private readonly moon: MoonPass
  private readonly lonSpan: number
  private readonly mapWidth: number
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera()
  private readonly geometry = fullscreenTriangle()
  private readonly uniforms: Record<string, THREE.IUniform>
  private materials: Partial<Record<GroundKind, THREE.ShaderMaterial>> = {}
  private layoutKey = ''
  /** The layout object the key was built from: MoonPass holds one object until its layout changes, so ensure() stringifies once per layout, not per call. */
  private layoutRef: PatchLayout | null = null
  private readonly meshes: Partial<Record<GroundKind, THREE.Mesh>> = {}
  private probeTarget: THREE.WebGLRenderTarget | null = null
  private readonly probeBuf = new Float32Array(MAX_PROBE * 8)
  /** `?near=photo`'s baked near field (nearBake.ts); null unless the page runs with it. Its targets exist only while the ground is drawn. */
  readonly nearBake: NearBakePass | null = NEAR_BAKED ? new NearBakePass() : null
  /** Set by the lunar module: a depth map from the Sun and the footpads (contact shadows). */
  readonly lm = {
    shadow: { value: null as THREE.Texture | null },
    shadowM: { value: new THREE.Matrix4() },
    shadowOn: { value: 0 },
    pads: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    padR: { value: 1.2 },
    padOn: { value: 0 },
  }

  constructor(moon: MoonPass, lonSpan: number, mapWidth: number) {
    this.moon = moon
    this.lonSpan = lonSpan
    this.mapWidth = mapWidth
    this.uniforms = {
      ...moon.uniforms,
      uGCam: { value: new THREE.Vector3() }, uGRight: { value: new THREE.Vector3() }, uGUp: { value: new THREE.Vector3() }, uGBack: { value: new THREE.Vector3() },
      uGTanHalf: { value: 0.27 }, uGSunL: { value: new THREE.Vector3() }, uGEarthL: { value: new THREE.Vector3() },
      uGOff: { value: new THREE.Vector2() }, uGH0: { value: 0 }, uGR: { value: R_M }, uGUv0: { value: new THREE.Vector2() }, uGDuv: { value: new THREE.Vector2() },
      uGSiteW: { value: new THREE.Vector3() }, uGNear: { value: G_NEAR }, uGFar: { value: G_FAR },
      uLmShadow: this.lm.shadow, uLmShadowM: this.lm.shadowM, uLmShadowOn: this.lm.shadowOn, uPads: this.lm.pads, uPadR: this.lm.padR, uPadOn: this.lm.padOn,
      // The max-mip terrain hit (siteMax.ts, groundShader.ts groundHit): the patch's max grid, its geometry (corner east/north, cell, mip levels) and size.
      uGMax: { value: null as THREE.Texture | null }, uGMG: { value: new THREE.Vector4() }, uGMS: { value: new THREE.Vector2() }, uGMOn: { value: 0 },
      ...(this.nearBake ? this.nearBake.uniforms : {}),
      uRayProbe: { value: 0 }, uPts: { value: Array.from({ length: MAX_PROBE }, () => new THREE.Vector2()) }, uPtN: { value: 0 },
    }
  }

  private siteMaxRev = -1
  private siteMaxTex: THREE.DataTexture | null = null
  /** `?hit=mm`, read once (the URL does not change under a page; this runs every frame). */
  private hitMm: boolean | null = null
  /** Binds the patch's max grid (null: none yet, or `?hit=old`): rebuilds the texture when its revision changed. */
  setSiteMax(sm: SiteMax | null): void {
    const u = this.uniforms
    this.hitMm ??= new URLSearchParams(location.search).get('hit') === 'mm'
    if (!sm || !this.hitMm) { u.uGMOn.value = 0; return }
    if (sm.revision !== this.siteMaxRev) {
      this.siteMaxTex?.dispose()
      const t = new THREE.DataTexture(sm.levels[0], sm.w, sm.h, THREE.RedFormat, THREE.FloatType)
      t.internalFormat = 'R32F'
      t.mipmaps = sm.levels.map((z, l) => ({ data: z, width: sm.size(l)[0], height: sm.size(l)[1] })) as unknown as THREE.DataTexture['mipmaps']
      t.generateMipmaps = false
      t.minFilter = THREE.NearestMipmapNearestFilter
      t.magFilter = THREE.NearestFilter
      t.flipY = false
      t.unpackAlignment = 1
      t.needsUpdate = true
      this.siteMaxTex = t
      trackGpu('patch', 'ground-site-max', sm.levels.reduce((n, z) => n + z.byteLength, 0), t)   // R32F, the mip chain included: the phone ledger sees it
      this.siteMaxRev = sm.revision
      u.uGMax.value = t
      ;(u.uGMG.value as THREE.Vector4).set(sm.e0, sm.n0, SM_CELL_M, sm.levels.length)
      ;(u.uGMS.value as THREE.Vector2).set(sm.w, sm.h)
    }
    u.uGMOn.value = 1
  }

  /** After a lost WebGL context: the materials are rebuilt (and recompiled) on the next use, not relinked on the first draw. */
  resetPrograms(): void { this.layoutKey = ''; this.layoutRef = null; this.nearBake?.release() }

  /** Per frame while the ground is drawn: keeps the baked near field centred on the camera (frame metres east, north). Call before `render`. Returns the levels drawn. */
  updateBake(renderer: THREE.WebGLRenderer, camE: number, camN: number): number {
    return this.nearBake && this.ready ? this.nearBake.update(renderer, camE, camN) : 0
  }

  /** Frees the baked near field's targets (leaving ground mode). */
  releaseBake(): void { this.nearBake?.release() }

  /** True when the Moon pass has a patch to draw the ground from. */
  get ready(): boolean { return !!this.moon.patchLayout }

  private ensure(): boolean {
    const layout: PatchLayout | null = this.moon.patchLayout
    if (!layout) return false
    const key = layout === this.layoutRef ? this.layoutKey : JSON.stringify(layout)
    this.layoutRef = layout
    if (key === this.layoutKey && this.materials.shade) return true
    for (const m of Object.values(this.materials)) m?.dispose()
    for (const kind of ['cover', 'shade', 'probe', 'metadata'] as const) {
      const additive = kind === 'shade' || kind === 'metadata'
      const mat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: FULLSCREEN_VERTEX,
        fragmentShader: groundFragment(kind, this.lonSpan, this.mapWidth, layout),
        uniforms: this.uniforms,
        depthTest: additive,
        depthWrite: additive,
        depthFunc: THREE.AlwaysDepth,
        blending: kind === 'probe' || kind === 'metadata' ? THREE.NoBlending : THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: additive ? THREE.OneFactor : THREE.ZeroFactor,
        blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
        blendEquationAlpha: THREE.AddEquation,
        blendSrcAlpha: additive ? THREE.OneFactor : THREE.ZeroFactor,
        blendDstAlpha: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
      })
      this.materials[kind] = mat
      const mesh = this.meshes[kind] ?? new THREE.Mesh(this.geometry, mat)
      mesh.material = mat
      mesh.frustumCulled = false
      this.meshes[kind] = mesh
    }
    this.layoutKey = key
    return true
  }

  renderMetadata(renderer: THREE.WebGLRenderer): void {
    if (!this.ensure()) throw new Error('Ground metadata unavailable')
    this.scene.clear()
    this.scene.add(this.meshes.metadata as THREE.Mesh)
    renderer.render(this.scene, this.camera)
    this.scene.clear()
  }

  /** Per frame, before render or probe. */
  update(i: GroundFrameInput): void {
    const u = this.uniforms
    const b = groundBasis(i.view)
    ;(u.uGCam.value as THREE.Vector3).copy(i.view.pos)
    ;(u.uGRight.value as THREE.Vector3).copy(b.right)
    ;(u.uGUp.value as THREE.Vector3).copy(b.up)
    ;(u.uGBack.value as THREE.Vector3).copy(b.back)
    u.uGTanHalf.value = i.view.tanHalf
    ;(u.uGSunL.value as THREE.Vector3).copy(enuDir(i.axes, i.ephem.sunDir))
    ;(u.uGEarthL.value as THREE.Vector3).copy(enuDir(i.axes, i.ephem.earthDir))
    ;(u.uGOff.value as THREE.Vector2).set(i.patchOffEN[0], i.patchOffEN[1])
    u.uGH0.value = i.frame.h0M
    u.uGR.value = R_M + i.frame.h0M
    const lat0 = i.frame.latDeg
    ;(u.uGUv0.value as THREE.Vector2).set((i.frame.lonDeg + this.lonSpan) / (2 * this.lonSpan), (90 - lat0) / 180)
    ;(u.uGDuv.value as THREE.Vector2).set(1 / (R_M * Math.cos(lat0 * DEG) * DEG) / (2 * this.lonSpan), -1 / (R_M * DEG) / 180)
    ;(u.uGSiteW.value as THREE.Vector3).copy(i.axes.up)
    u.uGNear.value = G_NEAR
    u.uGFar.value = G_FAR
  }

  /** Compiles the three materials without drawing (parallel shader compile where the browser has it). */
  async warm(renderer: THREE.WebGLRenderer, between?: () => Promise<void>, kinds: readonly GroundWarmKind[] = groundWarmKinds(false)): Promise<void> {
    if (!this.ensure()) return
    let first = true
    for (const kind of kinds) {
      // `between` waits for the next idle slot, so the programs link one per slot (the compile queue passes it).
      if (!first && between) await between()
      first = false
      this.scene.clear()
      this.scene.add(this.meshes[kind] as THREE.Mesh)
      try { await compileForTarget(renderer, this.scene, this.camera) } catch { /* the first draw compiles it */ }
    }
    this.scene.clear()
    // The baked near field's bake program is the one a default ground frame draws besides cover/shade/probe: its own idle slot.
    if (this.nearBake) { if (between) await between(); await this.nearBake.warm(renderer) }
  }

  /** Both passes into the bound target (which needs a depth attachment; the caller clears it). */
  render(renderer: THREE.WebGLRenderer): void {
    if (!this.ensure()) return
    for (const kind of ['cover', 'shade'] as const) {
      this.scene.clear()
      this.scene.add(this.meshes[kind] as THREE.Mesh)
      renderer.render(this.scene, this.camera)
    }
  }

  private probeTargetOf(): THREE.WebGLRenderTarget {
    if (!this.probeTarget) {
      this.probeTarget = new THREE.WebGLRenderTarget(MAX_PROBE, 2, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false })
      trackGpu('probe', 'ground-probe', MAX_PROBE * 2 * 16, this.probeTarget)
    }
    return this.probeTarget
  }

  /** Reads the ground at points (frame metres east, north): height, sun visibility, slope. Synchronous; a few per call. */
  probe(renderer: THREE.WebGLRenderer, pts: ReadonlyArray<readonly [number, number]>): GroundSample[] | null {
    if (!this.ensure()) return null
    const n = Math.min(MAX_PROBE, pts.length)
    this.probeTargetOf()
    const arr = this.uniforms.uPts.value as THREE.Vector2[]
    for (let i = 0; i < n; i++) arr[i].set(pts[i][0], pts[i][1])
    this.uniforms.uPtN.value = n
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(this.probeTargetOf())
    this.scene.clear()
    this.scene.add(this.meshes.probe as THREE.Mesh)
    renderer.render(this.scene, this.camera)
    renderer.readRenderTargetPixels(this.probeTargetOf(), 0, 0, MAX_PROBE, 2, this.probeBuf)
    renderer.setRenderTarget(prev)
    const out: GroundSample[] = []
    for (let i = 0; i < n; i++) out.push({ h: this.probeBuf[i * 4], lit: this.probeBuf[i * 4 + 1], slopeE: this.probeBuf[i * 4 + 2], slopeN: this.probeBuf[i * 4 + 3], lmShade: this.probeBuf[(MAX_PROBE + i) * 4] })
    return out
  }

  private readonly pointRead = new AsyncTexelRead()
  private readonly pointBuf = new Float32Array(MAX_PROBE * 8)
  private pointN = 0
  get probePending(): boolean { return this.pointRead.pending }

  /**
   * `probe` without the wait (`?gprobe=async`): the same pass and points, read back through a fence and collected with `probePoll` on a later frame.
   * False when a read is already in flight or the pass is not ready (the caller keeps its last answer, or probes synchronously).
   */
  probeBegin(renderer: THREE.WebGLRenderer, pts: ReadonlyArray<readonly [number, number]>): boolean {
    if (!this.ensure() || this.pointRead.pending) return false
    const n = Math.min(MAX_PROBE, pts.length)
    this.probeTargetOf()
    const arr = this.uniforms.uPts.value as THREE.Vector2[]
    for (let i = 0; i < n; i++) arr[i].set(pts[i][0], pts[i][1])
    this.uniforms.uPtN.value = n
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(this.probeTargetOf())
    this.scene.clear()
    this.scene.add(this.meshes.probe as THREE.Mesh)
    renderer.render(this.scene, this.camera)
    // The probe's framebuffer is the bound one (as in rangeBegin): both rows, so the module's shade comes with the heights.
    const ok = this.pointRead.begin(renderer.getContext() as unknown as ReadGl, MAX_PROBE, 2)
    renderer.setRenderTarget(prev)
    this.pointN = ok ? n : 0
    return ok
  }

  /** The finished `probeBegin` read, if there is one: its samples in the order asked. `undefined` while nothing new has arrived. */
  probePoll(renderer: THREE.WebGLRenderer): GroundSample[] | undefined {
    if (!this.pointRead.poll(renderer.getContext() as unknown as ReadGl, this.pointBuf)) return undefined
    return unpackSamples(this.pointBuf, this.pointN)
  }

  /** Metres from the camera along the view centre to the ground, from one ray of the ground pass; null when it sees sky. Synchronous, call at a few Hz. */
  rangeAlong(renderer: THREE.WebGLRenderer): number | null {
    if (!this.ensure()) return null
    this.probeTargetOf()
    const prev = renderer.getRenderTarget()
    this.uniforms.uRayProbe.value = 1
    renderer.setRenderTarget(this.probeTargetOf())
    this.scene.clear()
    this.scene.add(this.meshes.probe as THREE.Mesh)
    renderer.render(this.scene, this.camera)
    renderer.readRenderTargetPixels(this.probeTargetOf(), 0, 0, 1, 1, this.probeBuf)
    renderer.setRenderTarget(prev)
    this.uniforms.uRayProbe.value = 0
    return this.probeBuf[1] > 0.5 ? this.probeBuf[0] : null
  }

  private readonly rangeRead = new AsyncTexelRead()
  private readonly rangeBuf = new Float32Array(4)
  get rangePending(): boolean { return this.rangeRead.pending }

  /** Starts `rangeAlong` without waiting for the GPU: the same one-ray probe, read back through a fence. Collect it with `rangePoll`. */
  rangeBegin(renderer: THREE.WebGLRenderer): void {
    if (!this.ensure() || this.rangeRead.pending) return
    this.probeTargetOf()
    const prev = renderer.getRenderTarget()
    this.uniforms.uRayProbe.value = 1
    renderer.setRenderTarget(this.probeTargetOf())
    this.scene.clear()
    this.scene.add(this.meshes.probe as THREE.Mesh)
    renderer.render(this.scene, this.camera)
    // The probe's framebuffer is still the bound one: read straight from it, leaving three's own state untouched.
    this.rangeRead.begin(renderer.getContext() as unknown as ReadGl, 1, 1)
    renderer.setRenderTarget(prev)
    this.uniforms.uRayProbe.value = 0
  }

  /** The finished `rangeBegin` read, if there is one: the range in metres, or null for sky. `undefined` while nothing new has arrived. */
  rangePoll(renderer: THREE.WebGLRenderer): number | null | undefined {
    if (!this.rangeRead.poll(renderer.getContext() as unknown as ReadGl, this.rangeBuf)) return undefined
    return this.rangeBuf[1] > 0.5 ? this.rangeBuf[0] : null
  }

  /** `renderer` is null only after context loss, when WebGL handles cannot be deleted. */
  dispose(renderer: THREE.WebGLRenderer | null): void {
    const gl = renderer ? renderer.getContext() as unknown as ReadGl : null
    this.rangeRead.release(gl)
    this.pointRead.release(gl)
    for (const m of Object.values(this.materials)) m?.dispose()
    this.nearBake?.dispose()
    this.probeTarget?.dispose()
    this.siteMaxTex?.dispose()   // its `ground-site-max` ledger entry follows the texture (trackGpu)
    this.siteMaxTex = null
    this.siteMaxRev = -1
  }
}
