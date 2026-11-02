import { ABLATE } from '../abl'
import { HorizonStream, bakedUniforms } from './baked/HorizonStream'
import { linkOutcome } from './linkStatus'
import { bakedSamplerFits, horizonBase } from './baked/format'
import type { QualityClass } from '../quality/startupClass'
import * as THREE from 'three'
/** Diagnostic only (term-fix E): `?pvariant=0` never selects the heavier site-patch shader programs, to see whether they carry the terminator cost. Changes the picture over a patch. */
/** `?nfmotion=1` keeps the grazing normal filter on motion frames (term-fix G A/B). */
const NF_MOTION = typeof location !== 'undefined' && new URLSearchParams(location.search).get('nfmotion') === '1'
const PATCH_VARIANT_OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('pvariant') === '0'
import { FULLSCREEN_VERTEX, MOON_R_KM, fullscreenTriangle } from '../glsl/common'
import type { Ephemeris } from '../ephemeris'
import type { MoonMaps } from './maps'
import { HL_SEAS, MOON_COVER_BLIT_FRAGMENT, MOON_COVER_FRAGMENT, MOTION_TERRAIN_ITER, moonCoverFragment, moonFragment } from './moonShader'
import type { TileStreamer } from './tiles/TileStreamer'
import type { ShadowCache } from './tiles/ShadowCache'
import { cacheLevelFlags, type PatchShadowCache } from './patch/PatchShadowCache'
import { trackGpu } from '../quality/track'
import { AsyncTexelRead, type ReadGl } from '../ground/asyncRead'
import { reliefShare } from '../camera/pose'
import { type Exposure, nightFloorRadiance } from '../post/exposure'
import { MAX_PATCH_LEVELS } from './patch/config'
import { fadeFor, levelMatrix } from './patch/levels'
import type { PatchLayer } from './patch/PatchLayer'
import { patchFootprintRadius, sphericalCapInFrustum } from './patch/visibility'
import type { PatchLayout } from './moonShader'
import { detailStrength } from './tiles/detail'
import { horizonFromSearch, horizonSettings, type HorizonMode } from './horizon'
import { tcGain, tcUvMode } from './tiles/tcDetail'
import { rangeMetersForAltitude } from '../topography/elevation'
import { getShadowMode, SHADOW_MODE_UNIFORM, type ShadowMode } from './shadowMode'
import { compileForTarget } from '../net/compileTarget'
import { parseShadowDebug, SERVE_DBG_VALUE } from './shadowServe'

/**
 * The horizon envelopes are unsigned-integer textures (RG32UI), so their samplers must never see a float texture: three binds a float placeholder for a null sampler, and WebGL
 * rejects the draw ("sampler type mismatch"), which would black the Moon before the envelopes exist. These 1 x 1 integer textures stand in until they do.
 */
function emptyEnvTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint32Array(2), 1, 1, THREE.RGIntegerFormat, THREE.UnsignedIntType)
  t.internalFormat = 'RG32UI'
  t.minFilter = t.magFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
}
function emptyEnvArray(): THREE.DataArrayTexture {
  const t = new THREE.DataArrayTexture(new Uint32Array(2), 1, 1, 1)
  t.format = THREE.RGIntegerFormat
  t.type = THREE.UnsignedIntType
  t.internalFormat = 'RG32UI'
  t.minFilter = t.magFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
}

type Common = Record<string, THREE.IUniform>

export class MoonPass {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera()
  private readonly metadataScene = new THREE.Scene()
  private metadataMesh: THREE.Mesh | null = null
  private metadataKey = '' 
  private readonly coverMesh: THREE.Mesh
  private readonly shadeMesh: THREE.Mesh
  readonly uniforms: Record<string, THREE.IUniform>
  private readonly emptyEnv = emptyEnvTexture()
  private readonly emptyTileEnv = emptyEnvArray()
  private shade: THREE.ShaderMaterial
  private tileShade: THREE.ShaderMaterial | null = null
  private patchShade: THREE.ShaderMaterial | null = null
  /** The patch shade program WITH the shadow cache read (the layout's `cache` flags). The plain `patchShade` is the live-march program, byte for byte what it was before the cache: the read adds code that costs the live path ~14 per cent at Apollo 17's low Sun on the L4 (register pressure, measured), so a frame draws with this one only while the cache serves. 0: not compiled yet, 1: compiling, 2: ready. */
  private patchShadeC: THREE.ShaderMaterial | null = null
  private patchShadeCState: 0 | 1 | 2 | 3 = 0
  private patchOn = false
  private patchVariantActive = false
  private patchRadiusRad = 0
  private patchLayoutKey = ''
  /** Layouts whose shaders are compiled (prepare) but not yet bound, by layout key. */
  private readonly warm = new Map<string, { cover: THREE.ShaderMaterial; shade: THREE.ShaderMaterial; shadeC: THREE.ShaderMaterial | null; compiled: boolean }>()
  /** The loaded patch's level layout (the ground pass compiles for the same one), or null. */
  patchLayout: PatchLayout | null = null
  private tilesOn = false
  private readonly cover: THREE.ShaderMaterial
  /** Shared terrain hit: 'motion' = on motion frames, 'always' = every frame (the rest-frame comparison), 'off'. */
  private hitShare: 'off' | 'motion' | 'always' = 'off'
  private gridFrame = false
  /** Whether the last drawn frame used the shared hit (measurement: `__moon.perf.hitShared`). */
  hitShared = false
  /** The hit targets by size, at most two (the rest size and the current motion-grid size), so a gesture does not allocate and free one at every start and end. */
  private hitRTs: THREE.WebGLRenderTarget[] = []
  private hitRT: THREE.WebGLRenderTarget | null = null
  private readonly hitScene = new THREE.Scene()
  private readonly blitScene = new THREE.Scene()
  private hitMesh!: THREE.Mesh
  private blitShadeMesh!: THREE.Mesh
  private readonly hitMats = new Map<THREE.ShaderMaterial, THREE.ShaderMaterial>()
  private blitMat!: THREE.ShaderMaterial
  private readonly sizeTmp = new THREE.Vector2()
  private tileCover: THREE.ShaderMaterial | null = null
  private patchCover: THREE.ShaderMaterial | null = null
  /** Debug: the ground hit stays on the sphere (for before and after comparisons). */
  terrainOff = false
  private baked: HorizonStream | null = null
  private maxSamplers = 16
  private boundPatch: PatchLayer | null = null
  private requestedShadow: ShadowMode = getShadowMode()
  private readonly bakedMaterials = new Map<string, { material: THREE.ShaderMaterial; ready: boolean; compiling: boolean }>()
  private bakedDirty: () => void = () => {}
  private bakedDrawing = false
  get bakedStats() { return this.baked ? { ...this.baked.stats, drawing: this.bakedDrawing } : null }
  get bakedAvailable(): boolean { return this.bakedSupported() && (this.baked?.available ?? false) }
  /** The shadow implementation selected for the most recently prepared Moon draw. */
  get shadowServePath(): 'global-cache' | 'patch-cache' | 'baked' | 'live-march' | 'off' {
    if (this.requestedShadow === 'off') return 'off'
    if (this.requestedShadow === 'baked') return this.bakedDrawing ? 'baked' : 'live-march'
    if (this.patchVariantActive) {
      const cached = this.patchShadeC && this.patchShadeCState === 2 && !!this.patchCache?.shaderOn
      return cached ? 'patch-cache' : this.fixedShadowPolicy && this.uniforms.uShOn.value === 1 ? 'global-cache' : 'live-march'
    }
    return this.uniforms.uShOn.value === 1 ? 'global-cache' : 'live-march'
  }
  disposeBaked(): void {
    this.baked?.dispose(); this.baked = null; this.bakedDrawing = false
    for (const entry of this.bakedMaterials.values()) entry.material.dispose()
    this.bakedMaterials.clear()
  }
  configureBaked(renderer: THREE.WebGLRenderer, cls: QualityClass, ceiling: number, changed: () => void): void {
    this.disposeBaked()
    this.maxSamplers = renderer.capabilities.maxTextures; this.bakedDirty = changed
    const base = horizonBase()
    if (base) this.baked = new HorizonStream(base, this.uniforms, cls, (renderer.getContext() as WebGL2RenderingContext).getParameter((renderer.getContext() as WebGL2RenderingContext).MAX_ARRAY_TEXTURE_LAYERS) as number, ceiling, changed)
  }
  private bakedSupported(): boolean {
    return !this.patchInView() || bakedSamplerFits(this.patchLayout ?? [], this.maxSamplers)
  }
  private readonly maps: MoonMaps
  private readonly extraGlsl: string
  /** ?terrain=off, read once (the URL does not change under a running page). */
  private readonly terrainParamOff: boolean
  private readonly tstepsParam: boolean
  private readonly fixedShadowPolicy: boolean

  constructor(common: Common, maps: MoonMaps, extraGlsl = '', fixedShadowPolicy = false) {
    this.maps = maps
    this.extraGlsl = extraGlsl
    this.fixedShadowPolicy = fixedShadowPolicy
    const q = new URLSearchParams(location.search)
    this.terrainParamOff = q.get('terrain') === 'off'
    this.tstepsParam = !!q.get('tsteps')
    const geometry = fullscreenTriangle()
    const tanPerPx = { value: 1e-3 }
    this.uniforms = {
      ...common,
      ...bakedUniforms(),
      uTanPerPx: tanPerPx,
      uK: { value: new THREE.Vector3() },
      uX: { value: new THREE.Vector3() },
      uY: { value: new THREE.Vector3() },
      uS: { value: new THREE.Vector3() },
      uEarth: { value: new THREE.Vector3() },
      uSunPos: { value: new THREE.Vector3() },
      uEarthPos: { value: new THREE.Vector3() },
      uEarthshine: { value: 0 },
      uColor: { value: maps.color },
      uHeight: { value: maps.height.texture },
      uHeightLevels: { value: maps.height.levels },
      uHeightMix: { value: maps.height.pending ? 0 : 1 },
      // Milestone-2 tiles: none until a TileStreamer is attached (setTiles).
      uTileH: { value: null },
      uTileC: { value: null },
      uTilePage: { value: null },
      uTileD: { value: null },
      uDetailPage: { value: null },
      uDetailK: { value: 1 },
      uTcD: { value: null },
      uTcPage: { value: null },
      uTcK: { value: 1 },
      uTcUv: { value: tcUvMode() },
      uTcScale: { value: new THREE.Vector2(128, 100) },
      // The Sun-keyed shadow cache (setShadowCache): off until one is attached.
      uTileS: { value: null },
      uShFade: { value: null },
      // The horizon envelope of the 4k map (setGlobalHorizon, fixed shadow policy): the texture and whether the shader reads it.
      uEnvTex: { value: this.emptyEnv },
      uEnvOn: { value: 0 },
      // The Sun-keyed 4k horizon bake (setSunBake, fixed shadow policy): an RG8 float texture (lo / hi codes, lod bins stacked), and whether the shader reads it.
      uSunBake: { value: null },
      uSbOn: { value: 0 },
      // The per-tile horizon envelope (setTileEnvelope, fixed shadow policy): the R8 array indexed by tile layer, and whether the shader reads it.
      uTileEnv: { value: this.emptyTileEnv },
      uTenvOn: { value: 0 },
      uShOn: { value: 0 },
      uTileBlend: { value: 0 },
      uTileTanPerPx: { value: 1e-3 },
      // The ground hit follows the relief near the floor (0: the sphere) and the shadow march reads tile heights (1) or not (0, ?march=old).
      uTerrain: { value: 0 },
      uTileMarch: { value: q.get('march') === 'old' || ABLATE.has('coverage') ? 0 : 1 },
      // The highest and lowest ground of each 20 deg tile (the terrain shell), and the terrain march's budget (?tsteps=128 is the reference).
      uTileBound: { value: null },
      uTerrIter: { value: Math.max(8, Math.min(128, Number(q.get('tsteps')) || 56)) },
      uTerrBounded: { value: 1 },
      // ?horizon=: sub-pixel rays on the skyline band and the far low-pass (moon/horizon.ts); the ground pass shares these uniforms.
      uHzK: { value: horizonSettings(horizonFromSearch(location.search)).k },
      uHzLp: { value: horizonSettings(horizonFromSearch(location.search)).lp },
      uDbgKill: { value: Number(q.get('dbgkill')) || 0 },
      uDbg: { value: Number(q.get('dbg')) || (import.meta.env?.VITE_NATIVE_BUILD !== 'true' && parseShadowDebug(q.toString()) === 'serve' ? SERVE_DBG_VALUE : 0) },
      // Relative elevation colours are opt-in; the uniform branch avoids height reads while disabled.
      uTopoOn: { value: 0 },
      uTopoRangeM: { value: 250 },
      uTopoWhiteIF: { value: 0.05 },
      // The night side's display floor (setNightFloor): off until ?nightfloor= asks for one.
      uNightFloor: { value: 0 },
      // The Labels layer's highlight (setHighlight): off until a label is hovered or flown to.
      uHlOn: { value: 0 },
      uHlDir: { value: new THREE.Vector4(1, 0, 0, 0.01) },
      uHlMode: { value: 0 },
      // The labels' gold (#f3d38c) in linear light.
      uHlTint: { value: new THREE.Vector3(0.896, 0.651, 0.262) },
      uHlSeas: { value: Array.from({ length: HL_SEAS }, () => new THREE.Vector4(1, 0, 0, 0.01)) },
      uHlSeaCount: { value: 0 },
      uHlSel: { value: -1 },
      // The site patch (setPatch): none until one is attached.
      uPatchBlend: { value: 0 },
      uPSlopeMax: { value: 1e6 },
      uPH0M: { value: 0 },
      uPatchGround: { value: 0 },
      uSurround: { value: 0 },
      // Per level slot i (0 the coarsest, at most MAX_PATCH_LEVELS): heights uPH, image detail uPR, grid uPG, size uPS.
      ...Object.fromEntries(Array.from({ length: MAX_PATCH_LEVELS }, (_, i) => [
        [`uPHOffset${i}`, { value: 0 }], [`uPH${i}`, { value: null }], [`uPR${i}`, { value: null }],
        [`uPG${i}`, { value: new THREE.Vector4() }], [`uPA${i}`, { value: new THREE.Vector4(1, 0, 0, -1) }], [`uPS${i}`, { value: new THREE.Vector2() }],
      ]).flat()),
      // The patch shadow cache (setPatchShadowCache): the atlas, whether the shader reads it, and per cached level its layer (x, y, width, height) and texel ratio.
      uPSC: { value: null }, uPShOn: { value: 0 }, uPCoB: { value: new THREE.Vector4() }, uPCkB: { value: 1 },
      ...Object.fromEntries(Array.from({ length: MAX_PATCH_LEVELS }, (_, i) => [[`uPCo${i}`, { value: new THREE.Vector4() }], [`uPCk${i}`, { value: 1 }]]).flat()),
      uPSite: { value: new THREE.Vector3() }, uPEast: { value: new THREE.Vector3() }, uPNorth: { value: new THREE.Vector3() },
      uTerrMinDiv: { value: q.get('tsteps') ? 256 : 48 },
      uMotion: { value: 0 }, uFlightHz: { value: 0 }, uNormalFilter: { value: 1 },
      uTermAA: { value: 1 },
      // Motion-frame caps (setMotionCaps): the shipped values until a phone class lowers them.
      // Shared terrain hit (setHitShare): the cover pass writes it to a float target, the shade pass reads it.
      uHitIn: { value: 0 }, uHitOut: { value: 0 }, uHitTex: { value: null },
      uMStride: { value: 2 }, uMTerr: { value: MOTION_TERRAIN_ITER }, uMLite: { value: 0 }, uShMode: { value: SHADOW_MODE_UNIFORM[getShadowMode()] },
    }
    // Pass 1: dst *= 1 - cover, colour and key alike.
    const cover = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: MOON_COVER_FRAGMENT,
      uniforms: { ...common, uTanPerPx: tanPerPx },
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    })
    // Pass 2: dst += radiance x cover, key x cover.
    const shade = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: moonFragment(maps.height.lonSpan, maps.height.size[0], extraGlsl, false, null, false, 0, false, undefined, false, false, fixedShadowPolicy),
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    })
    this.shade = shade
    this.cover = cover
    this.coverMesh = new THREE.Mesh(geometry, cover)
    this.shadeMesh = new THREE.Mesh(geometry, shade)
    for (const m of [this.coverMesh, this.shadeMesh]) {
      m.frustumCulled = false
      this.scene.add(m)
    }
    this.coverMesh.renderOrder = 0
    this.shadeMesh.renderOrder = 1
    // The shared-hit frame: hit pass (cover shader, no blend) -> hit target; then the cover blend read back from it, then the shade pass.
    this.hitMesh = new THREE.Mesh(geometry, cover)
    this.blitMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERTEX, fragmentShader: MOON_COVER_BLIT_FRAGMENT, uniforms: { uHitTex: this.uniforms.uHitTex },
      depthTest: false, depthWrite: false, blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    })
    const blitMesh = new THREE.Mesh(geometry, this.blitMat)
    blitMesh.renderOrder = 0
    this.blitShadeMesh = new THREE.Mesh(geometry, shade)
    this.blitShadeMesh.renderOrder = 1
    for (const m of [this.hitMesh, blitMesh, this.blitShadeMesh]) m.frustumCulled = false
    this.hitScene.add(this.hitMesh)
    this.blitScene.add(blitMesh, this.blitShadeMesh)
  }

  /** A frame on the motion grid (a gesture): one shadow sample, no viewer-horizon march, every second near step, a 24-step terrain march. Rest frames are unchanged. */
  /** Phone classes: a motion frame marches 12 terrain steps, strides the shadow march by 4 and skips its edge refine and deep-near loop. Rest frames never read these. */
  /** `capsTerrain`: the capped terrain march length (default 12); the phone motion policy keeps MOTION_TERRAIN_ITER (reliable terrain hits at the limb; the march is a few % of the frame). */
  setMotionCaps(on: boolean, capsTerrain = 12): void { const u = this.uniforms; u.uMStride.value = on ? 4 : 2; u.uMTerr.value = on ? capsTerrain : MOTION_TERRAIN_ITER; u.uMLite.value = on ? 1 : 0 }
  /** One terrain hit per frame: the cover pass writes it, the shade pass reads it (`?hitshare=off|motion|1` forces it; every non-patch frame by default: L4 A/B, rest frame -14 to -24 % desktop, -3 to -19 % phone class, 8 B/px target). */
  setHitShare(mode: 'off' | 'motion' | 'always'): void { this.hitShare = mode }
  /** Whether this device and quality ever write the shared hit target (so a centre read can run at all); a phone class with sharing off never does. */
  centreReadPossible(renderer: THREE.WebGLRenderer): boolean { return this.hitShare !== 'off' && renderer.extensions.has('EXT_color_buffer_float') }
  private shareHit(renderer: THREE.WebGLRenderer): boolean {
    if (this.hitShare === 'off' || !this.tilesOn || this.patchVariantActive || this.uniforms.uTerrain.value <= 0 || !renderer.extensions.has('EXT_color_buffer_float')) return false
    return this.hitShare === 'always' || this.gridFrame
  }
  private hitMaterialFor(cover: THREE.ShaderMaterial): THREE.ShaderMaterial {
    let m = this.hitMats.get(cover)
    if (!m) {
      m = cover.clone()
      m.uniforms = this.uniforms
      m.blending = THREE.NoBlending
      this.hitMats.set(cover, m)
    }
    return m
  }
  private readonly centreRead = new AsyncTexelRead()
  private readonly centreBuf = new Float32Array(4)
  /**
   * The centre caption's one readback: the centre texel of the last shared-hit target (r the ray distance of the drawn ground hit, 0 on the sphere;
   * g the cover), through a fence, never `readRenderTargetPixels`. False when the last frame did not share its hit (patch shader, no tiles, relief off,
   * no float targets) or a read is already in flight. The caller checks that the camera that drew the target is the one on screen.
   */
  beginCentreRead(renderer: THREE.WebGLRenderer): { w: number; h: number; ix: number; iy: number } | null {
    const rt = this.hitRT
    if (!rt || !this.hitShared || this.centreRead.pending) return null
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(rt)
    const ix = Math.floor(rt.width / 2), iy = Math.floor(rt.height / 2)
    const ok = this.centreRead.begin(renderer.getContext() as unknown as ReadGl, 1, 1, ix, iy)
    renderer.setRenderTarget(prev)
    if (!ok) return null
    // The texel read and the target's own size travel with the result: on an even-sized target it is not the screen-centre ray.
    return (this.centreInfo = { w: rt.width, h: rt.height, ix, iy })
  }
  private centreInfo: { w: number; h: number; ix: number; iy: number } | null = null
  /** The finished `beginCentreRead`: undefined while the GPU has not finished; otherwise the ray distance (Moon radii; 0 = the sphere) and cover. */
  pollCentreRead(renderer: THREE.WebGLRenderer): { range: number; cover: number; w: number; h: number; ix: number; iy: number } | undefined {
    if (!this.centreRead.poll(renderer.getContext() as unknown as ReadGl, this.centreBuf)) return undefined
    const info = this.centreInfo ?? { w: 0, h: 0, ix: 0, iy: 0 }
    return { range: this.centreBuf[0], cover: this.centreBuf[1], ...info }
  }
  /** Drops an unfinished centre read (a new pause, a lost context). */
  cancelCentreRead(renderer: THREE.WebGLRenderer | null): void { this.centreRead.release(renderer ? renderer.getContext() as unknown as ReadGl : null) }
  /** Whether a centre read is in flight. */
  get centreReadPending(): boolean { return this.centreRead.pending }

  private renderShared(renderer: THREE.WebGLRenderer): void {
    const u = this.uniforms
    const target = renderer.getRenderTarget()
    const size = target ? this.sizeTmp.set(target.width, target.height) : renderer.getDrawingBufferSize(this.sizeTmp)
    let rt = this.hitRTs.find((t) => t.width === size.x && t.height === size.y)
    if (!rt) {
      if (this.hitRTs.length >= 2) this.hitRTs.shift()?.dispose()
      // RG32F, 8 bytes a pixel: r the ray distance of the ground hit (0 where the sphere stands), g the cover.
      rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.FloatType, format: THREE.RGFormat, internalFormat: 'RG32F', depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false })
      trackGpu('targets', 'moon-hit', size.x * size.y * 8, rt)
      this.hitRTs.push(rt)
    }
    this.hitRT = rt
    u.uHitTex.value = this.hitRT.texture
    this.hitMesh.material = this.hitMaterialFor(this.coverMesh.material as THREE.ShaderMaterial)
    this.blitShadeMesh.material = this.shadeMesh.material
    u.uHitOut.value = 1; u.uHitIn.value = 0
    renderer.setRenderTarget(this.hitRT)
    renderer.render(this.hitScene, this.camera)
    renderer.setRenderTarget(target)
    u.uHitOut.value = 0; u.uHitIn.value = 1
    renderer.render(this.blitScene, this.camera)
    u.uHitIn.value = 0
  }
  setTermAA(k: number): void { this.uniforms.uTermAA.value = k }
  /** The horizon option (moon/horizon.ts); a switch for A/B captures, the page reads `?horizon=` once at start. */
  setHorizon(mode: HorizonMode): void { const h = horizonSettings(mode); this.uniforms.uHzK.value = h.k; this.uniforms.uHzLp.value = h.lp }
  /** Scripted-flight frames keep the rest terrain march and skyline AA (?flighthz=1, or ?sharp=1 unless ?flighthz=0). Never set on a gesture frame. */
  setFlightHz(on: boolean): void { this.uniforms.uFlightHz.value = on ? 1 : 0 }
  setMotion(on: boolean): void { this.uniforms.uMotion.value = on ? 1 : 0; this.uniforms.uNormalFilter.value = on && !NF_MOTION ? 0 : 1 }
  /** True on a frame drawn below full scale (a gesture's grid), whatever shader it runs: `hitshare=motion` reads this, NOT uMotion (which is 1 on gesture frames when the Motion detail row is Smooth). */
  setGridFrame(on: boolean): void { this.gridFrame = on }

  /** Toggle relative elevation colours. The displayed range follows camera altitude. */
  setTopography(on: boolean): void { this.uniforms.uTopoOn.value = on ? 1 : 0 }
  /**
   * The Labels layer's highlight: `strength` 0 to 1, the feature's Moon-fixed centre and angular radius, and for a sea its index
   * in `seas` (every labelled sea's centre and radius, set once) so its dark ground can be told from its neighbours'.
   */
  setHighlight(strength: number, dir: [number, number, number], radiusRad: number, seaIndex = -1, seas?: Array<[number, number, number, number]>): void {
    const u = this.uniforms
    u.uHlOn.value = Math.max(0, Math.min(1, strength))
    ;(u.uHlDir.value as THREE.Vector4).set(dir[0], dir[1], dir[2], radiusRad)
    u.uHlMode.value = seaIndex >= 0 ? 1 : 0
    u.uHlSel.value = seaIndex
    if (seas) {
      const arr = u.uHlSeas.value as THREE.Vector4[]
      seas.slice(0, HL_SEAS).forEach((v, i) => arr[i].set(v[0], v[1], v[2], v[3]))
      u.uHlSeaCount.value = Math.min(HL_SEAS, seas.length)
    }
  }
  /** Current un-pre-exposed white point, supplied by main's exposure pass for stable overlay brightness. */
  setTopographyWhiteIF(whiteIF: number): void { this.uniforms.uTopoWhiteIF.value = Number.isFinite(whiteIF) ? Math.max(1e-6, whiteIF) : 0.05 }
  /** Per frame: the night side's display floor for this exposure, `share` of display white on unlit ground (0 off; post/exposure.ts nightFloorRadiance). */
  setNightFloor(share: number, x: Exposure): boolean {
    const radiance = nightFloorRadiance(share, x)
    this.uniforms.uNightFloor.value = radiance
    return radiance > 0
  }
  topographyRangeMeters(): number { return this.uniforms.uTopoRangeM.value as number }

  /** Per frame: the moment's geometry and the pixel scale of the target. */
  update(e: Ephemeris, tanPerPx: number, canvasTanPerPx = tanPerPx): void {
    const u = this.uniforms
    u.uTanPerPx.value = tanPerPx
    u.uTileTanPerPx.value = canvasTanPerPx
    ;(u.uK.value as THREE.Vector3).copy(e.moonZ)
    ;(u.uX.value as THREE.Vector3).copy(e.moonX)
    ;(u.uY.value as THREE.Vector3).copy(e.moonY)
    ;(u.uS.value as THREE.Vector3).copy(e.sunDir)
    ;(u.uEarth.value as THREE.Vector3).copy(e.earthDir)
    ;(u.uSunPos.value as THREE.Vector3).copy(e.sunKm).divideScalar(MOON_R_KM)
    ;(u.uEarthPos.value as THREE.Vector3).copy(e.earthKm).divideScalar(MOON_R_KM)
    u.uEarthshine.value = e.earthshine
    const altitudeKm = Math.max(0, (u.uCamPos.value as THREE.Vector3).length() - 1) * MOON_R_KM
    // ~25 m at a site, growing smoothly to the full global relief at orbital views.
    u.uTopoRangeM.value = rangeMetersForAltitude(altitudeKm)
    if (this.baked) {
      const wantsBaked = getShadowMode() === 'baked'
      const origin = u.uCamPos.value as THREE.Vector3
      const ray = new THREE.Vector3(0, 0, 1).applyMatrix4(u.uInvViewProj.value as THREE.Matrix4).sub(origin).normalize()
      const b = origin.dot(ray), disc = b * b - origin.lengthSq() + 1
      const distance = disc >= 0 ? -b - Math.sqrt(disc) : -1
      const camera = distance >= 0 ? origin.clone().addScaledVector(ray, distance).normalize() : origin.clone().normalize()
      const body = new THREE.Vector3(camera.dot(e.moonX), camera.dot(e.moonY), camera.dot(e.moonZ))
      this.baked?.update(this.patchInView() ? this.boundPatch : null, body, wantsBaked && this.bakedSupported())
    }
    u.uTerrain.value = this.terrainOff || this.terrainParamOff ? 0 : reliefShare((u.uCamPos.value as THREE.Vector3).length())
  }

  /** Full / Baked / Fast / Off. Baked warms its own program once; other choices use the existing programs. */
  setShadowMode(m: ShadowMode): void { this.requestedShadow = m; this.uniforms.uShMode.value = SHADOW_MODE_UNIFORM[m === 'baked' ? 'fast' : m] }

  /** Attaches (or, with null, detaches) the Sun-keyed shadow cache: the shader reads its horizons where a layer is valid (ShadowCache.ts). */
  setShadowCache(c: ShadowCache | null): void {
    const u = this.uniforms
    u.uTileS.value = c ? c.texture : null
    u.uShFade.value = c ? c.fade : null
    u.uShOn.value = c ? 1 : 0
  }

  /** Attaches (or, with null, detaches) the horizon envelope (GlobalHorizonCache.ts); the shader reads it while `on`. */
  setGlobalHorizon(texture: THREE.Texture | null, on = false): void {
    // The envelope's render target has no GL texture until the dilate pass first draws into it; three binds its FLOAT placeholder to an unallocated render-target texture, and a usampler2D
    // reading a float texture makes WebGL reject every Moon draw ("Mismatch between texture format and sampler type"). So the real texture is bound only once it is read (on); the integer placeholder until then.
    this.uniforms.uEnvTex.value = texture && on ? texture : this.emptyEnv; this.uniforms.uEnvOn.value = texture && on ? 1 : 0 }

  /** Attaches (or, with null, detaches) the Sun-keyed 4k horizon bake (tiles/SunHorizonBake.ts); the shader reads it while `on`. Unlike the integer envelopes it is an ordinary float sampler, so a null stands in safely. */
  setSunBake(texture: THREE.Texture | null, on = false): void {
    this.uniforms.uSunBake.value = texture && on ? texture : null; this.uniforms.uSbOn.value = texture && on ? 1 : 0 }

  /** Attaches (or, with null, detaches) the per-tile horizon envelope (TileEnvelope.ts); the shader reads it while `on`. */
  setTileEnvelope(texture: THREE.Texture | null, on = false): void {
    // As setGlobalHorizon: the array's render target is bound to the sampler only once it is read.
    this.uniforms.uTileEnv.value = texture && on ? texture : this.emptyTileEnv; this.uniforms.uTenvOn.value = texture && on ? 1 : 0 }

  /** The patch shadow cache (PatchShadowCache.ts), or null: the patch shader variants then carry no cache read (the layout flags below) and march live. */
  private patchCache: PatchShadowCache | null = null
  /** Attaches (or, with null, detaches) the patch shadow cache. Attach it before the first setPatch: the cache read is part of the patch shader's layout. */
  setPatchShadowCache(c: PatchShadowCache | null): void { this.patchCache = c }

  /** The Quality sheet changed Surface detail: re-read both detail gains. */
  refreshDetailGain(): void { this.uniforms.uTcK.value = tcGain(); this.uniforms.uDetailK.value = detailStrength() }

  /** Attaches (or, with null, detaches) the tile cache; the shader then mixes its tiles over the 4k maps. */
  setTiles(t: TileStreamer | null): void {
    const u = this.uniforms
    // The shader is generated for the finest level the set has (a manifest's `deeper` block); a different depth rebuilds the variants.
    const deepest = t ? t.deepest : 0
    const hasDetail = !!t?.detail
    const hasTc = hasDetail && !!t?.tc
    if (hasDetail !== this.tileDetail || hasTc !== this.tcDetail) { this.tileDetail = hasDetail; this.tcDetail = hasTc; this.tileShade = null; this.tileCover = null; this.tilesPrepared = null; this.metadataKey = '' }
    u.uTcD.value = hasTc ? t!.tc!.tex : null
    u.uTcPage.value = hasTc ? t!.tc!.page : null
    u.uTcK.value = tcGain()
    if (hasTc) u.uTcScale.value.set(t!.tc!.man.mid, t!.tc!.man.perOctave)
    u.uTileD.value = t?.detail ? t.detail.tex : null
    u.uDetailPage.value = t?.detail ? t.detail.page : null
    u.uDetailK.value = detailStrength()
    if (deepest !== this.tileDeepest) { this.tileDeepest = deepest; this.tileShade = null; this.tileCover = null; this.tilesPrepared = null; this.metadataKey = '' }
    u.uTileH.value = t ? t.texH : null
    u.uTileC.value = t ? t.texC : null
    u.uTilePage.value = t ? t.page : null
    u.uTileBound.value = t ? t.bound : null
    u.uTileBlend.value = t ? 1 : 0
    // The tile variant of the shader: built here when prepareTiles did not already compile it; without tiles
    // the milestone-1 shader runs, unchanged.
    if (t) this.buildTileMaterials()
    this.tilesOn = !!t
    this.pickShade()
  }

  /** The tile variants of the two passes, built once (setTiles binds them, prepareTiles compiles them ahead of the first tap). */
  private buildTileMaterials(): { shade: THREE.ShaderMaterial; cover: THREE.ShaderMaterial } {
    if (!this.tileShade || !this.tileCover) {
      const m = this.shade.clone()
      m.uniforms = this.uniforms
      m.fragmentShader = moonFragment(this.maps.height.lonSpan, this.maps.height.size[0], this.extraGlsl, true, null, false, this.tileDeepest, this.tileDetail, undefined, this.tcDetail, false, this.fixedShadowPolicy)
      m.needsUpdate = true
      this.tileShade = m
      const c = this.cover.clone()
      c.uniforms = this.uniforms
      c.fragmentShader = moonCoverFragment(this.maps.height.lonSpan, this.maps.height.size[0], null, this.tileDeepest)
      c.needsUpdate = true
      this.tileCover = c
    }
    return { shade: this.tileShade, cover: this.tileCover }
  }

  /**
   * Compiles the tile variants in the background (KHR_parallel_shader_compile) before anything draws with them. Compiled on the
   * first draw instead, they stall the main thread for as long as the GPU driver takes to link them, which on a cold shader cache
   * is the freeze at the first tap on a surface pin. Draws nothing and changes no state the passes read.
   */
  async prepareTiles(renderer: THREE.WebGLRenderer): Promise<void> {
    if (this.tilesPrepared) return this.tilesPrepared
    const { shade, cover } = this.buildTileMaterials()
    const scene = new THREE.Scene()
    for (const m of [cover, shade]) { const mesh = new THREE.Mesh(this.shadeMesh.geometry, m); mesh.frustumCulled = false; scene.add(mesh) }
    this.tilesPrepared = compileForTarget(renderer, scene, this.camera).then(() => undefined)
    return this.tilesPrepared
  }
  private tilesPrepared: Promise<void> | null = null
  /**
   * After a lost WebGL context nothing is linked any more. Forget what was compiled so the next prepare/compile runs again in the background
   * instead of the first draw relinking everything on this thread (5 to 6 s stalls on a phone).
   */
  resetPrograms(): void {
    this.tilesPrepared = null
    for (const w of this.warm.values()) w.compiled = false
    this.patchShadeCState = 0
    // The mesh drawn so far stays until a fresh variant is linked.
    this.metadataVariants.clear()
    this.metadataKey = ''
  }
  /** Finest tile level the attached set streams (0: the three built levels; -3: 512 ppd). The shader is generated for it. */
  private tileDeepest = 0
  /** The attached set streams the WAC detail ratio: the shader variant carries its sampling. */
  private tileDetail = false
  /** The attached set also streams the JAXA TC ratio (`?tc=`): the shader variant carries it. */
  private tcDetail = false

  /** Attaches (or, with null, detaches) the site patch. It needs the tiles' shader variant, so it draws only while tiles are attached. */
  setPatch(p: PatchLayer | null, slopeMax = 1e6, fusedGround = false): void {
    const u = this.uniforms
    // A site whose heights make the ground gets the terrain march's reference budget (128 steps, smallest step 1/256 of the shell's path; the shipped 56 and 48 left terraces
    // and a stepped skyline across a valley), unless ?tsteps= chose one.
    this.boundPatch = p && fusedGround ? p : null
    u.uPatchGround.value = p && fusedGround ? 1 : 0
    u.uSurround.value = p && fusedGround && new URLSearchParams(location.search).get('surround') === '1' ? 1 : 0
    if (!this.tstepsParam) { u.uTerrIter.value = p && fusedGround ? 128 : 56; u.uTerrMinDiv.value = p && fusedGround ? 256 : 48 }
    u.uPSlopeMax.value = slopeMax
    this.patchOn = !!p
    if (p) {
      this.patchRadiusRad = patchFootprintRadius(p.availableLevels)
      const layout = this.layoutOf(p)
      const key = JSON.stringify(layout)
      this.patchLayout = layout
      this.boundResident = p.levels.length
      u.uPH0M.value = p.manifest.h0M
      for (let i = 0; i < layout.length; i++) {
        const l = p.levels[i]
        u[`uPHOffset${i}`].value = l ? (l.h0M ?? p.manifest.h0M) : 0
        u[`uPH${i}`].value = l ? (p.heights[l.name] ?? null) : null
        u[`uPR${i}`].value = l ? (p.detail[l.name] ?? null) : null
        ;(u[`uPA${i}`].value as THREE.Vector4).set(...(l ? levelMatrix(l) : [1, 0, 0, -1] as [number, number, number, number]))
        ;(u[`uPG${i}`].value as THREE.Vector4).set(...(l ? [l.eastM, l.northM, l.texelEastM, l.texelNorthM] as [number, number, number, number] : [0, 0, 0, 0] as [number, number, number, number]))
        ;(u[`uPS${i}`].value as THREE.Vector2).set(l ? l.w : 0, l ? l.h : 0)
      }
      ;(u.uPSite.value as THREE.Vector3).copy(p.site)
      ;(u.uPEast.value as THREE.Vector3).copy(p.east)
      ;(u.uPNorth.value as THREE.Vector3).copy(p.north)
      u.uPatchBlend.value = 1
      this.patchCache?.bind(p.levels, layout, !!fusedGround)
      // The shader is written for the levels' layout; sites with the same layout share one.
      if (this.patchShade && this.patchLayoutKey !== key) { this.patchShade.dispose(); this.patchShade = null; this.patchShadeC?.dispose(); this.patchShadeC = null; this.patchShadeCState = 0; this.patchCover?.dispose(); this.patchCover = null }
      if (!this.patchShade) {
        // The materials a prepare() compiled in the background, or fresh ones (the first draw then compiles them on this thread).
        const w = this.warm.get(key) ?? this.buildPatchMaterials(layout)
        this.warm.delete(key)
        this.patchCover = w.cover
        this.patchShade = w.shade
        this.patchShadeC = w.shadeC
        this.patchShadeCState = 0
        this.patchLayoutKey = key
      }
    } else {
      this.patchRadiusRad = 0
      u.uPatchBlend.value = 0
      this.patchLayout = null
      this.boundResident = 0
      this.patchCache?.bind([], null, false)
      for (const w of this.warm.values()) { w.cover.dispose(); w.shade.dispose(); w.shadeC?.dispose() }
      this.warm.clear()
      // Let go of the levels' textures (they are disposed next), or the old ones would be drawn from once more.
      for (let i = 0; i < MAX_PATCH_LEVELS; i++) { u[`uPH${i}`].value = null; u[`uPR${i}`].value = null }
    }
    this.pickShade()
  }

  private layoutOf(p: PatchLayer): PatchLayout {
    // The layout of EVERY level the site declares, resident or not: one shader per site, compiled once before the descent. A level that
    // is not resident yet has no rectangle (uPS 0) so its weight is zero everywhere; it used to be a new shader per level arriving.
    const cache = this.patchCache ? cacheLevelFlags(p.availableLevels) : []
    return p.availableLevels.map((l, i) => ({ h: !!l.heights, r: !!l.detail, fadeM: fadeFor(l.texelM), ...(cache[i] ? { cache: true } : {}), shade: !(l.name === 'L-1h' && new URLSearchParams(location.search).get('tierdtm') === 'off') }))
  }

  private buildPatchMaterials(layout: PatchLayout): { cover: THREE.ShaderMaterial; shade: THREE.ShaderMaterial; shadeC: THREE.ShaderMaterial | null; compiled: boolean } {
    const cover = this.cover.clone()
    cover.uniforms = this.uniforms
    cover.fragmentShader = moonCoverFragment(this.maps.height.lonSpan, this.maps.height.size[0], layout, this.tileDeepest)
    cover.needsUpdate = true
    const shade = this.shade.clone()
    shade.uniforms = this.uniforms
    // The live-march program takes the layout without the cache flags: no atlas unit, no read.
    const live = layout.map(({ cache: _c, ...rest }) => rest)
    void live.length
    shade.fragmentShader = moonFragment(this.maps.height.lonSpan, this.maps.height.size[0], this.extraGlsl, true, live, false, this.tileDeepest, this.tileDetail, undefined, this.tcDetail, false, this.fixedShadowPolicy)
    shade.needsUpdate = true
    let shadeC: THREE.ShaderMaterial | null = null
    if (layout.some((l) => l.cache)) {
      shadeC = this.shade.clone()
      shadeC.uniforms = this.uniforms
      shadeC.fragmentShader = moonFragment(this.maps.height.lonSpan, this.maps.height.size[0], this.extraGlsl, true, layout, false, this.tileDeepest, this.tileDetail, undefined, this.tcDetail, false, this.fixedShadowPolicy)
      shadeC.needsUpdate = true
    }
    return { cover, shade, shadeC, compiled: false }
  }

  /** How many levels the bound layout has (0: no patch bound). */
  get boundLevels(): number { return this.boundResident }
  private boundResident = 0

  /** True when `setPatch(p)` would draw with a linked shader (bound, or compiled by prepare), or with fewer levels than are bound (a level left). */
  layoutReady(p: PatchLayer): boolean {
    const key = this.layoutKeyOf(p)
    return (key === this.patchLayoutKey && !!this.patchShade) || !!this.warm.get(key)?.compiled
  }

  /** The key of the layout `setPatch(p)` would draw with. */
  layoutKeyOf(p: PatchLayer): string { return JSON.stringify(this.layoutOf(p)) }

  /**
   * Compiles the shaders for the layout of `p`'s resident levels in the background (KHR_parallel_shader_compile), so the
   * setPatch that follows binds a program that is already linked. A layout is a new fragment shader: compiled on the first draw it
   * stalls the main thread for seconds on a real GPU (audit 4: six stalls of 5 to 6 s, one per level that became resident).
   */
  async prepare(renderer: THREE.WebGLRenderer, p: PatchLayer): Promise<void> {
    const key = this.layoutKeyOf(p)
    if (key === this.patchLayoutKey && this.patchShade) return
    let w = this.warm.get(key)
    if (!w) { w = this.buildPatchMaterials(this.layoutOf(p)); this.warm.set(key, w) }
    if (w.compiled) return
    const scene = new THREE.Scene()
    for (const m of [w.cover, w.shade]) { const mesh = new THREE.Mesh(this.shadeMesh.geometry, m); mesh.frustumCulled = false; scene.add(mesh) }
    await compileForTarget(renderer, scene, this.camera)
    w.compiled = true
    // The metadata pass has its own program per layout, drawn only by a visibility calibration or an audit: warm it in the same background step
    // only then. A visitor never draws it, and it was a second full-size fragment shader to link per layout (R50).
    if (!this.metadataWanted) return
    const meta = this.metadataVariant(renderer, this.layoutOf(p))
    for (let i = 0; i < 400 && !meta.ready && !meta.failed; i++) await new Promise((r) => setTimeout(r, 25))
  }

  /** Whether the independent metadata program is warmed with each layout (a visibility calibration or an audit is on, or `?precompile=meta`). Off for a visitor. */
  private metadataWanted = false
  setMetadataWanted(on: boolean): void { this.metadataWanted = on }
  /** The metadata variants built so far (tests and the rig's program count: 0 on a visitor's path). */
  get metadataVariantCount(): number { return this.metadataVariants.size }

  private pickShade(): void {
    this.bakedDrawing = false
    this.patchVariantActive = this.patchOn && this.tilesOn && !!this.patchLayout && !PATCH_VARIANT_OFF && this.patchVisibleInFrame()
    this.coverMesh.material = this.patchVariantActive && this.patchCover ? this.patchCover : this.tilesOn && this.tileCover ? this.tileCover : this.cover
    const cached = this.requestedShadow !== 'baked' && this.patchVariantActive && this.patchShadeC && this.patchShadeCState === 2 && (this.fixedShadowPolicy || !!this.patchCache?.shaderOn)
    this.uniforms.uShMode.value = SHADOW_MODE_UNIFORM[this.requestedShadow === 'baked' ? 'fast' : this.requestedShadow]
    this.shadeMesh.material = cached ? this.patchShadeC! : this.patchVariantActive && this.patchShade ? this.patchShade : this.tilesOn && this.tileShade ? this.tileShade : this.shade
    if (this.requestedShadow === 'baked' && this.baked && this.bakedSupported()) {
      const layout = this.patchVariantActive ? this.patchLayout : null
      const key = JSON.stringify([this.tilesOn, layout, this.tileDeepest, this.tileDetail, this.tcDetail])
      let entry = this.bakedMaterials.get(key)
      if (!entry) {
        const material = this.shade.clone()
        material.uniforms = this.uniforms
        material.fragmentShader = moonFragment(this.maps.height.lonSpan, this.maps.height.size[0], this.extraGlsl, this.tilesOn, layout, false, this.tileDeepest, this.tileDetail, 'margin', this.tcDetail, true)
        entry = { material, ready: false, compiling: false }
        this.bakedMaterials.set(key, entry)
      }
      if (entry.ready) { this.bakedDrawing = true; this.shadeMesh.material = entry.material; this.uniforms.uShMode.value = SHADOW_MODE_UNIFORM.baked }
    }
  }

  /** The patch shader variant would draw this frame (a patch bound with its tiles, and in view). The patch shadow cache builds only then. */
  patchInView(): boolean { return this.patchOn && this.tilesOn && !!this.patchLayout && this.patchVisibleInFrame() }

  /** A patch shader is only needed while any part of its photo/height footprint can meet the current view frustum. */
  private patchVisibleInFrame(): boolean {
    const u = this.uniforms
    if (this.patchRadiusRad <= 0 || (u.uPatchBlend.value as number) <= 0) return false
    const camera = u.uCamPos.value as THREE.Vector3
    const inverse = u.uInvViewProj.value as THREE.Matrix4
    const site = u.uPSite.value as THREE.Vector3
    const x = u.uX.value as THREE.Vector3, y = u.uY.value as THREE.Vector3, k = u.uK.value as THREE.Vector3
    const center = x.clone().multiplyScalar(site.x).addScaledVector(y, site.y).addScaledVector(k, site.z)
    return sphericalCapInFrustum(camera, inverse, center, this.patchRadiusRad)
  }

  /** The metadata variant for a layout: the material, compiled in the background (KHR_parallel_shader_compile) so the swap to it is no main-thread stall. */
  private metadataVariant(renderer: THREE.WebGLRenderer, layout: PatchLayout | null): { material: THREE.ShaderMaterial; ready: boolean; failed: boolean } {
    const key = `${this.tilesOn}:${JSON.stringify(layout)}:${this.tileDeepest}:${this.tileDetail}:${this.tcDetail}`
    let v = this.metadataVariants.get(key)
    if (!v) {
      const material = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERTEX,
        fragmentShader: moonFragment(this.maps.height.lonSpan, this.maps.height.size[0], this.extraGlsl, this.tilesOn, layout, true, this.tileDeepest, this.tileDetail, undefined, this.tcDetail),
        uniforms: this.uniforms, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
      })
      const entry = { material, ready: false, failed: false }
      v = entry
      // The oldest variants go (a patch's layout changes a handful of times per visit).
      if (this.metadataVariants.size >= 6) {
        const oldest = this.metadataVariants.keys().next().value as string
        const old = this.metadataVariants.get(oldest)
        if (old && old.material !== this.metadataMesh?.material) old.material.dispose()
        this.metadataVariants.delete(oldest)
      }
      this.metadataVariants.set(key, entry)
      const scene = new THREE.Scene()
      const mesh = new THREE.Mesh(this.shadeMesh.geometry, material)
      mesh.frustumCulled = false
      scene.add(mesh)
      // A variant the GPU refused is never marked ready: the mesh drawn so far stays (the first one ever has nothing to keep and is used regardless).
      compileForTarget(renderer, scene, this.camera).then(() => { if (linkOutcome(renderer, material) === 'failed') entry.failed = true; else entry.ready = true }, () => { entry.failed = true })
    }
    return v
  }
  private readonly metadataVariants = new Map<string, { material: THREE.ShaderMaterial; ready: boolean; failed: boolean }>()

  /** Same ray/terrain hit and low-frequency measured albedo, separate from radiance and exposure key. */
  renderMetadata(renderer: THREE.WebGLRenderer): void {
    this.pickShade()
    const layout = this.patchVariantActive ? this.patchLayout : null
    // (A change of the tile set's detail keys resets metadataKey to '' above, so the variant is selected again; the variant cache is keyed by those too.)
    const key = `${this.tilesOn}:${JSON.stringify(layout)}`
    if (!this.metadataMesh || this.metadataKey !== key) {
      // A new layout (a level became resident, the patch came into view) is compiled in the background; the mesh drawn so far stays until it is
      // linked, so there is no multi-second compile on this thread in the middle of a flight. The first one ever has nothing to keep and compiles at once.
      const variant = this.metadataVariant(renderer, layout)
      if (!this.metadataMesh || variant.ready) {
        if (this.metadataMesh) this.metadataScene.remove(this.metadataMesh)
        this.metadataMesh = new THREE.Mesh(this.shadeMesh.geometry, variant.material)
        this.metadataMesh.frustumCulled = false
        this.metadataScene.add(this.metadataMesh)
        this.metadataKey = key
      }
    }
    renderer.render(this.metadataScene, this.camera)
  }

  /** Draws both passes into rows [k/n, (k+1)/n) of `target` (scissored; the rest of the target is untouched). */
  renderBand(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, k: number, n: number): void {
    this.pickShade()
    this.compileCachedShade(renderer)
    const h = target.height
    const y0 = Math.floor((k * h) / n), y1 = k === n - 1 ? h : Math.floor(((k + 1) * h) / n)
    target.scissor.set(0, y0, target.width, y1 - y0)
    target.scissorTest = true
    renderer.setRenderTarget(target)
    try { renderer.render(this.scene, this.camera) } finally {
      target.scissorTest = false
      renderer.setRenderTarget(target)
    }
  }

  /**
   * The cache-reading patch program compiles in the background the first frame the cache serves, with the target the Moon is drawn into bound (three keys a program
   * by the target's colour space and tone mapping); until it is ready the live program draws. Never a stall on the main thread.
   */
  private compileCachedShade(renderer: THREE.WebGLRenderer): void {
    for (const entry of this.bakedMaterials.values()) {
      if (entry.ready || entry.compiling) continue
      entry.compiling = true
      const scene = new THREE.Scene(), mesh = new THREE.Mesh(this.shadeMesh.geometry, entry.material)
      mesh.frustumCulled = false; scene.add(mesh)
      void compileForTarget(renderer, scene, this.camera).then(() => { if (linkOutcome(renderer, entry.material) === 'failed') return; entry.ready = true; this.bakedDirty() }, () => { /* Keep Fast if compilation fails. */ })
    }
    if (this.patchShadeCState !== 0 || !this.patchShadeC || !this.patchVariantActive || (!this.fixedShadowPolicy && !this.patchCache?.shaderOn)) return
    this.patchShadeCState = 1
    const m = this.patchShadeC
    const scene = new THREE.Scene()
    const mesh = new THREE.Mesh(this.shadeMesh.geometry, m)
    mesh.frustumCulled = false
    scene.add(mesh)
    // 2: the cache-reading program linked and draws. 3: the GPU refused it (or the compile rejected): the live patch program stays (Fast), never a program that draws nothing.
    compileForTarget(renderer, scene, this.camera).then(() => { if (this.patchShadeC === m) this.patchShadeCState = linkOutcome(renderer, m) === 'failed' ? 3 : 2 }, () => { if (this.patchShadeC === m) this.patchShadeCState = 3 })
  }

  /** Draws both passes into the bound target (no clear). */
  render(renderer: THREE.WebGLRenderer): void {
    this.pickShade()
    this.compileCachedShade(renderer)
    this.hitShared = this.shareHit(renderer)
    if (this.hitShared) { this.renderShared(renderer); return }
    renderer.render(this.scene, this.camera)
  }
}
