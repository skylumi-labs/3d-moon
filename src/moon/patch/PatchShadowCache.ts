import { FenceBlockTimer, fixedBlockBudget, type FenceGl } from '../tiles/fenceBlockTimer'
import * as THREE from 'three'
import { FULLSCREEN_VERTEX, fullscreenTriangle } from '../../glsl/common'
import type { Ephemeris } from '../../ephemeris'
import { patchShadowBuildFragment, type PatchLayout } from '../moonShader'
import type { PatchLevel } from './PatchLayer'
import { PSH_BASE_HALF_M, PSH_BASE_TEXEL_M } from './shadowBase'
import type { CacheTiles } from '../tiles/ShadowCache'
import { levelDeg } from '../tiles/grid'
import { marchReachKm, shReachOn } from '../march'
import { ledger, textureBytes } from '../../quality/ledger'

/**
 * The patch shadow cache: the Sun-keyed horizon cache (tiles/ShadowCache.ts) for the ground of a fused-ground site patch (Apollo 17).
 *
 * Why it exists. The global cache is keyed to the tile layers and is read only by the tile shader; the patch shader variants (a site patch in view) have
 * no cache and march the horizon live in every pixel. On the rig that is the whole cost of the Apollo 17 low-Sun views (38.9 ms at Sun 7 deg against 12.1 ms at
 * Sun 30 deg, where the march exits early). Here the horizon toward the Sun is built once per cache texel of the patch's own height levels, in the patch frame
 * (metres east and north of the site), and the pixel shader reads one bilinear tap (four texel fetches) of it instead of marching ~70 samples.
 *
 * Layout. One R16F atlas holds a layer per cached height level (the finest axis-aligned levels of 1 to 16 m: Apollo 17's 8 m and 2 m), each at `k` level texels
 * per cache texel (k = 2 on the phone class and by default: the layer is a smooth function of position, the near-field detail is the height texel's own).
 * Each layer is cut into BLOCK x BLOCK blocks; a block is one scissored draw of the build fragment (`patchShadowBuildFragment`: the pixel shader's own march from
 * the texel's ground point). Unbuilt texels hold -100, and the shader reads a tap only when all four are built, so a half-built atlas is safe to read.
 *
 * Validity. Every built block was built for one Sun (`sunNew`; an older one `sunOld` while a drift rebuild runs). An interactive Sun move (a drag, the time
 * slider, a seek) drops the whole atlas at once (`shaderOn` false that frame, texels cleared before the next build), exactly like the global cache's layers:
 * nothing stale is drawn while the Sun is moved. The live clock's tick (`opts.drift`, a few thousandths of a degree) keeps serving the old blocks while they are
 * rebuilt in place, for at most DRIFT_TOL of Sun movement from the oldest block. A changed height source or layout (`bind`) clears it. A changed far-field tile
 * set (the march reads the resident tiles beyond the patch) rebuilds in place after QUIET_MS.
 *
 * Budget. Blocks are built nearest the view's ground point first, only in a rest frame (not a gesture, not a Sun move, not an over-budget frame), a few ms of
 * GPU a frame.
 *
 * Pre-arrival catch-up (`opts.catchUp`, `?pshcatchup=0` turns it off). A scripted arrival (the descent, a landing, a fly-to) is all motion frames, so a patch
 * bound on the way in built nothing until the camera stopped, and the first rest frames at the site marched live (phone class: 1 block a frame, so many frames).
 * While the Sun is still and the patch is bound, a catch-up frame builds the blocks around the site at half the rest rate (never a burst, never when the frame is
 * over budget, the site as the build order's centre while the patch is not yet in view), so the atlas is largely built when the camera arrives. The blocks are the
 * same ones a rest frame would build; only the time they are built moves earlier. A block is read only once built. The live march stays the fallback everywhere the cache is not built, so any frame is complete without it.
 */

/** Cache texels per block edge. */
export const PSH_BLOCK = 128
/** Atlas residency cap (bytes). The phone class cap is the 16 MiB budget; the desktop uses the same cap (k = 2 fits both). */
export const PSH_CAP_BYTES = { desktop: 16 << 20, low: 16 << 20 }
/** A block built for a Sun within this of the current one is current (0.01 deg, as the global cache). */
export const PSH_SUN_TOL_RAD = 0.01 * Math.PI / 180
/** During clock drift a block stays served this far from the current Sun (0.05 deg). */
export const PSH_DRIFT_TOL_RAD = 0.05 * Math.PI / 180
const DRIFT_STEP_MAX_RAD = 0.03 * Math.PI / 180
const MOVING_RAD = 2e-6
/** The Sun must have been still this long before a build starts (ms). */
export const PSH_SETTLE_MS = 120
/** The far-field tile set must have been unchanged this long before the cache rebuilds for it (ms). */
const QUIET_MS = 150
/** GPU time a rest frame may spend on builds (ms), by device class. */
const BUDGET_MS = { desktop: 5, low: 2.5 }
const GUESS_MS_PER_BLOCK = { desktop: 0.4, low: 2.5 }
const FALLBACK_BLOCKS = { desktop: 8, low: 1 }
const MAX_BLOCKS_PER_FRAME = 64
const FIXED_BUILD_MS = { desktop: 3, low: 1.5 }
const FIXED_BLOCK_FLOOR_MS = { desktop: 0.25, low: 0.2 }
/** The first build frame after the Sun settles may spend this many times the normal budget (one burst of the visible blocks). */
const BURST_X = 4
const OVER_CPU_MS = { desktop: 6, low: 10 }
const OVER_FRAME_X = 2.2
const OVER_FRAME_MIN_MS = { desktop: 30, low: 45 }
const DEFER_STREAK_MAX = 3
/** Sun elevation band a texel's horizon is built for (the pixel shader marches only -10 to 38), and the range a block must meet to be built at all. */
const BAND_LO = -13
const BAND_HI = 41
const SKIP_LO = -14
const SKIP_HI = 42
const RAD = Math.PI / 180
const PR_M = 1737400
/** A far tile changing moves the horizon within the march's reach (300 km). */
const REACH_RAD = 300 / (PR_M / 1000)
/**
 * Reach (rad) from the site for a far tile of `level`: the march reads a finer tile only near its origin (marchReachKm), and its origin
 * lies anywhere in the base square (PSH_BASE_HALF_M, corner at sqrt2 times that). Level 2 keeps REACH_RAD exactly; `flat` (`?shreach=300`) keeps it for all.
 */
function tileReachRad(level: number, flat: boolean): number {
  const km = marchReachKm(level)
  if (flat || km >= 300) return REACH_RAD
  return Math.min(REACH_RAD, (km + Math.SQRT2 * PSH_BASE_HALF_M / 1000) / (PR_M / 1000))
}

/** Which of a site's declared levels get a cache layer: heights, an axis-aligned grid, a texel of 1 to 16 m (the 8 m and 2 m levels; not the 118 m bridge, not the 25 cm tier). */
export function cacheLevelFlags(levels: ReadonlyArray<Pick<PatchLevel, 'heights' | 'texelM' | 'axisEastPerTexelM' | 'heightFormat'>>): boolean[] {
  return levels.map((l) => !!l.heights && !l.axisEastPerTexelM && l.heightFormat !== 'f32' && l.heightFormat !== 'q16' && l.texelM >= 1 && l.texelM <= 16)
}

export interface AtlasRect { x: number; y: number; cw: number; ch: number }
/** Shelf-packs layers of the given cache sizes into an atlas at most `maxSide` wide and tall, or null when they do not fit. */
export function packAtlas(sizes: ReadonlyArray<{ cw: number; ch: number }>, maxSide: number): { rects: AtlasRect[]; W: number; H: number } | null {
  const rects: AtlasRect[] = []
  let x = 0, y = 0, rowH = 0, W = 0
  for (const s of sizes) {
    if (s.cw > maxSide || s.ch > maxSide) return null
    if (x + s.cw > maxSide) { x = 0; y += rowH; rowH = 0 }
    rects.push({ x, y, cw: s.cw, ch: s.ch })
    x += s.cw; rowH = Math.max(rowH, s.ch); W = Math.max(W, x)
  }
  const H = y + rowH
  return H > maxSide ? null : { rects, W, H }
}

/**
 * Level texels per cache texel for each layer, and the atlas that holds them: every layer starts at `kMin`, and while the atlas is over `capBytes` (or the
 * texture limit) the layer with the coarsest cache texel (texel metres x k) is made one step coarser, so the fine level the camera sees close up keeps its
 * resolution and the broad outer level gives way first. Null when even k = 8 everywhere does not fit.
 */
export function chooseLayout(dims: ReadonlyArray<{ w: number; h: number; texelM: number; kMin?: number; kMax?: number }>, capBytes: number, maxSide: number, kMin = 1): { ks: number[]; rects: AtlasRect[]; W: number; H: number; bytes: number } | null {
  const ks = dims.map((d) => Math.max(1, d.kMin ?? kMin))
  for (let guard = 0; guard < 64; guard++) {
    const pk = packAtlas(dims.map((d, i) => ({ cw: Math.ceil(d.w / ks[i]), ch: Math.ceil(d.h / ks[i]) })), maxSide)
    if (pk) {
      const bytes = textureBytes(pk.W, pk.H, 2)
      if (bytes <= capBytes) return { ks: [...ks], ...pk, bytes }
    }
    let worst = -1, wt = -1
    for (let i = 0; i < ks.length; i++) if (ks[i] < (dims[i].kMax ?? 8) && dims[i].texelM * ks[i] > wt) { wt = dims[i].texelM * ks[i]; worst = i }
    if (worst < 0) return null
    ks[worst]++
  }
  return null
}

function deviceClass(): 'desktop' | 'low' {
  try {
    const forced = new URLSearchParams(location.search).get('class')
    if (forced === 'phone-android' || forced === 'tablet' || forced === 'ios' || forced === 'ipad') return 'low'
    if (forced === 'desktop') return 'desktop'
    const nav = navigator as Navigator & { deviceMemory?: number }
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    const small = Math.min(screen.width, screen.height) < 700
    return coarse || small || (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) ? 'low' : 'desktop'
  } catch { return 'desktop' }
}

interface Block {
  slot: number
  x: number; y: number; w: number; h: number
  /** Centre in metres east / north of the site, and the half extent. */
  e: number; n: number; half: number
  /** Epoch it was built in (-1: not built). */
  built: number
  /** Never built: wholly inside a finer level's fully weighted area, or outside the Sun band for the current Sun. */
  inner: boolean
  band: boolean
}
interface LayerPlan { slot: number; level: PatchLevel; rect: AtlasRect; fadeM: number; k: number }

export interface PatchShadowStats {
  on: boolean
  k: number
  ks: string
  layers: number
  blocks: number
  built: number
  skipped: number
  pending: number
  serving: number
  buildsTotal: number
  buildsLastFrame: number
  gpuBytes: number
  atlas: string
  msPerBlock: number
  deferredOver: number
  invalidated: number
  cleared: number
  rebuilds: number
  /** From the Sun's last move to every needed block built (ms; -1 until measured). */
  timeToCachedMs: number
  failed: boolean
  updateMsMax: number
  /** CPU time of one block build (the draw call itself), worst and total (ms). */
  buildMsMax: number
  buildMsTotal: number
  /** Blocks built in motion frames by the pre-arrival catch-up, and the frames that built them. */
  catchUpBuilds: number
  catchUpFrames: number
}

/** Blocks a pre-arrival catch-up frame may build: half the rest rate, at least one. */
export function catchUpBlocks(restBlocks: number): number { return Math.max(1, Math.floor(restBlocks / 2)) }

type TimerExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
export interface PatchCacheOpts {
  /** Supplied only for the fixed shadow policy. */
  fixedPolicy?: boolean
  fixedBudgetMs?: number
  /** Fixed policy: at most this many blocks this frame (a gesture or flight frame passes 1). */
  maxBlocks?: number
  active: boolean
  drift?: boolean
  motion?: boolean
  /** A scripted arrival at the bound patch's site is running (not a user gesture, not a reduced-scale frame): build at the catch-up rate even in a motion frame, and before the patch is in view. */
  catchUp?: boolean
  frameStart?: number
  frameQuery?: { suspend(): void; resume(): void }
  camPos: THREE.Vector3
  camBack: THREE.Vector3
}

export class PatchShadowCache {
  readonly stats: PatchShadowStats = {
    on: false, k: 0, ks: '', layers: 0, blocks: 0, built: 0, skipped: 0, pending: 0, serving: 0, buildsTotal: 0, buildsLastFrame: 0, gpuBytes: 0, atlas: '', msPerBlock: -1,
    deferredOver: 0, invalidated: 0, cleared: 0, rebuilds: 0, timeToCachedMs: -1, failed: false, updateMsMax: 0, buildMsMax: 0, buildMsTotal: 0, catchUpBuilds: 0, catchUpFrames: 0,
  }
  failed = false
  /** The shader may read the atlas (?pshcache=0 and the debug switch turn it off). */
  readOn = true
  shaderOn = false
  private readonly cls = deviceClass()
  private rt: THREE.WebGLRenderTarget | null = null
  private material: THREE.ShaderMaterial | null = null
  private materialKey = ''
  private ready = false
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera()
  private plan: LayerPlan[] = []
  private blocks: Block[] = []
  private epoch = 0
  private validCount = 0
  private needClear = false
  private sunNew = new THREE.Vector3()
  private sunOld: THREE.Vector3 | null = null
  private haveEpoch = false
  private bandEpoch = -1
  private readonly sunB = new THREE.Vector3()
  private readonly prevSunB = new THREE.Vector3()
  private haveSun = false
  private lastNow = -1
  private lastSunMoveAt = -1e9
  private lastChangeAt = -1e9
  private tileSig = -1
  private tileDirty = false
  private frameMs = 16
  private lastDt = 0
  private wasBusy = false
  private burst = false
  private deferStreak = 0
  private fixedPolicy = false
  private fixedBudgetMs = 0
  private msPerBlock = -1
  /** No timer query (most Android GPUs): block cost from fences. */
  fence: FenceBlockTimer | null = null
  private awaiting = false
  private timer: TimerExt | null = null
  private readonly queries: Array<{ q: WebGLQuery; n: number }> = []
  private fbChecked = false
  private readonly ledgerKey = 'patch-shadow-cache'
  private readonly fixedBudget: number
  /** `?shreach=300`: every tile level counts within the flat 300 km (today's reach). */
  private readonly flatReach: boolean
  private readonly kOverride: number
  /** `?pshcatchup=0` turns the pre-arrival catch-up off (A/B). */
  private readonly catchUpOn: boolean
  private readonly v1 = new THREE.Vector3()
  private readonly v2 = new THREE.Vector3()

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly passUniforms: Record<string, THREE.IUniform>,
    private readonly lonSpan: number,
    private readonly mapWidth: number,
    private readonly tileDeepest: number,
  ) {
    const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search)
    this.flatReach = !shReachOn(q.toString())
    this.catchUpOn = q.get('pshcatchup') !== '0'
    this.fixedBudget = Math.max(0, Math.min(64, Math.floor(Number(q.get('pshbudget')) || 0)))
    const kq = Math.floor(Number(q.get('pshk')) || 0)
    this.kOverride = kq === 1 || kq === 2 || kq === 4 || kq === 8 ? kq : 0
    try {
      const gl = renderer.getContext?.() as WebGL2RenderingContext | undefined
      this.timer = (gl?.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null | undefined) ?? null
    } catch { this.timer = null }
    try { if (!this.timer) { const g = renderer.getContext?.() as unknown as FenceGl | undefined; this.fence = g && typeof g.fenceSync === 'function' ? new FenceBlockTimer(g) : null } } catch { this.fence = null }
  }

  /**
   * The patch's levels changed (a level arrived, another site, none): lay the atlas out for the resident cached levels, drop every block, and compile the build
   * program for the layout. `fused` false (Apollo 11: its heights shade the surface only) builds nothing.
   */
  bind(levels: readonly PatchLevel[], layout: PatchLayout | null, fused: boolean): void {
    this.dropAll()
    this.plan = []
    this.blocks = []
    this.stats.on = false
    if (!layout || !fused || this.failed) { this.releaseTarget(); this.clearUniforms(); return }
    const lv: LayerPlan[] = []
    for (let i = 0; i < Math.min(levels.length, layout.length); i++) {
      const l = levels[i]
      if (layout[i].cache && layout[i].h && l && l.heights) lv.push({ slot: i, level: l, rect: { x: 0, y: 0, cw: 0, ch: 0 }, fadeM: layout[i].fadeM, k: 2 })
    }
    const maxSide = Math.min(this.renderer.capabilities.maxTextureSize, 8192)
    // The base layer: a square around the site over the composite ground (slot -1), for where no cached level is fully weighted.
    const baseN = Math.round((2 * PSH_BASE_HALF_M) / PSH_BASE_TEXEL_M)
    const baseLevel = { name: 'base', w: baseN, h: baseN, texelM: PSH_BASE_TEXEL_M, eastM: -PSH_BASE_HALF_M, northM: PSH_BASE_HALF_M, texelEastM: PSH_BASE_TEXEL_M, texelNorthM: PSH_BASE_TEXEL_M, heights: 'base' } as PatchLevel
    lv.push({ slot: -1, level: baseLevel, rect: { x: 0, y: 0, cw: 0, ch: 0 }, fadeM: 0, k: 1 })
    const dims = lv.map((p) => ({ w: p.level.w, h: p.level.h, texelM: p.level.texelM, kMin: p.slot < 0 ? 1 : undefined, kMax: p.slot < 0 ? 2 : undefined }))
    const cap = this.kOverride ? Infinity : PSH_CAP_BYTES[this.cls]
    const fit = chooseLayout(dims, cap, maxSide, this.kOverride || 2)
    if (!fit) { this.releaseTarget(); this.clearUniforms(); return }
    lv.forEach((p, n) => { p.rect = fit.rects[n]; p.k = fit.ks[n] })
    this.plan = lv
    this.ensureTarget(fit.W, fit.H, fit.bytes)
    this.ensureMaterial(layout)
    this.buildBlocks()
    this.writeUniforms()
    this.stats.on = true
    this.stats.k = Math.max(...fit.ks)
    this.stats.ks = fit.ks.join(',')
    this.stats.layers = lv.length - 1
    this.stats.blocks = this.blocks.length
    this.stats.atlas = `${fit.W}x${fit.H}`
  }

  private ensureTarget(W: number, H: number, bytes: number): void {
    if (this.rt && this.rt.width === W && this.rt.height === H) return
    this.releaseTarget()
    const rt = new THREE.WebGLRenderTarget(W, H, {
      format: THREE.RedFormat, type: THREE.HalfFloatType, internalFormat: 'R16F',
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false,
    })
    rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping
    this.rt = rt
    this.fbChecked = false
    this.stats.gpuBytes = bytes
    ledger.set('patch', this.ledgerKey, bytes)
  }
  private releaseTarget(): void {
    if (this.rt) { this.rt.dispose(); this.rt = null }
    ledger.release('patch', this.ledgerKey)
    this.stats.gpuBytes = 0
  }
  private ensureMaterial(layout: PatchLayout): void {
    const key = JSON.stringify(layout)
    if (this.material && this.materialKey === key) return
    this.material?.dispose()
    this.ready = false
    const own = { uPShOrg: { value: new THREE.Vector4() }, uPShG: { value: new THREE.Vector4() }, uPShK: { value: 2 }, uPShClear: { value: 0 }, uMotion: { value: 0 }, uShMode: { value: 0 }, uPShBand: { value: new THREE.Vector2(BAND_LO, BAND_HI) } }
    // The build pass shares the Moon pass's uniforms (the body axes, the Sun, the tile arrays, the patch levels) but not the atlas it draws into.
    const { uPSC: _a, uPShOn: _b, ...shared } = this.passUniforms as Record<string, THREE.IUniform>
    void _a; void _b
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERTEX, fragmentShader: patchShadowBuildFragment(layout, this.lonSpan, this.mapWidth, this.tileDeepest),
      uniforms: { ...shared, ...own }, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    })
    this.materialKey = key
    this.scene.clear()
    const mesh = new THREE.Mesh(fullscreenTriangle(), this.material)
    mesh.frustumCulled = false
    this.scene.add(mesh)
    const mat = this.material
    // Compiled in the background: the first build waits for it (a compile on the first draw stalls the main thread for as long as the driver takes). Compiled
    // with the atlas bound: three keys a program by the target kind (colour space, tone mapping), so a compile against the canvas would be a different program.
    const prev = this.renderer.getRenderTarget()
    if (this.rt) this.renderer.setRenderTarget(this.rt)
    const compiling = this.renderer.compileAsync(this.scene, this.camera)
    this.renderer.setRenderTarget(prev)
    void compiling.then(() => { if (this.material === mat) this.ready = true }).catch(() => { if (this.material === mat) { this.failed = true; this.stats.failed = true } })
  }

  private clearUniforms(): void {
    const u = this.passUniforms
    if (u.uPSC) u.uPSC.value = null
    if (u.uPShOn) u.uPShOn.value = 0
  }
  private writeUniforms(): void {
    const u = this.passUniforms
    u.uPSC.value = this.rt ? this.rt.texture : null
    for (const p of this.plan) {
      const name = p.slot < 0 ? 'B' : String(p.slot)
      ;(u[`uPCo${name}`].value as THREE.Vector4).set(p.rect.x, p.rect.y, p.rect.cw, p.rect.ch)
      u[`uPCk${name}`].value = p.k
    }
  }

  private buildBlocks(): void {
    const out: Block[] = []
    for (const p of this.plan) {
      const l = p.level
      const nx = Math.ceil(p.rect.cw / PSH_BLOCK), ny = Math.ceil(p.rect.ch / PSH_BLOCK)
      for (let by = 0; by < ny; by++) for (let bx = 0; bx < nx; bx++) {
        const x0 = bx * PSH_BLOCK, y0 = by * PSH_BLOCK
        const w = Math.min(PSH_BLOCK, p.rect.cw - x0), h = Math.min(PSH_BLOCK, p.rect.ch - y0)
        const qx = (x0 + w / 2) * p.k, qy = (y0 + h / 2) * p.k
        const e = l.eastM + qx * l.texelEastM, n = l.northM - qy * l.texelNorthM
        const half = 0.5 * p.k * Math.max(w * l.texelEastM, h * l.texelNorthM)
        out.push({ slot: p.slot, x: p.rect.x + x0, y: p.rect.y + y0, w, h, e, n, half, built: -1, inner: false, band: true })
      }
    }
    // A block wholly inside a finer cached level's fully weighted area is never read (the finest fully weighted level wins in the shader).
    for (const b of out) {
      for (const f of this.plan) {
        if (f.slot <= b.slot) continue
        const l = f.level
        const e0 = l.eastM + f.fadeM, e1 = l.eastM + l.w * l.texelEastM - f.fadeM
        const n1 = l.northM - f.fadeM, n0 = l.northM - l.h * l.texelNorthM + f.fadeM
        if (b.e - b.half >= e0 && b.e + b.half <= e1 && b.n - b.half >= n0 && b.n + b.half <= n1) { b.inner = true; break }
      }
    }
    this.blocks = out
  }

  /** Sun band per block for the current Sun (body frame): blocks the shader never reads for this Sun are not built. */
  private computeBands(sun: THREE.Vector3): void {
    const u = this.passUniforms
    const site = u.uPSite.value as THREE.Vector3, east = u.uPEast.value as THREE.Vector3, north = u.uPNorth.value as THREE.Vector3
    const v = this.v1
    let skipped = 0
    for (const b of this.blocks) {
      const f = Math.sqrt(Math.max(0, 1 - (b.e * b.e + b.n * b.n) / (PR_M * PR_M)))
      v.copy(site).multiplyScalar(f).addScaledVector(east, b.e / PR_M).addScaledVector(north, b.n / PR_M)
      const elev = Math.asin(Math.max(-1, Math.min(1, v.dot(sun)))) / RAD
      const r = (b.half / PR_M) / RAD
      b.band = !(elev + r < SKIP_LO || elev - r > SKIP_HI)
      if (!b.band || b.inner) skipped++
    }
    this.stats.skipped = skipped
  }

  /** Drops every block at once: nothing is served until the Sun settles and blocks are rebuilt. */
  private dropAll(): void {
    if (this.validCount > 0) this.stats.invalidated++
    for (const b of this.blocks) b.built = -1
    this.validCount = 0
    this.stats.serving = 0
    this.stats.built = 0
    this.needClear = true
    this.haveEpoch = false
    this.sunOld = null
    this.shaderOn = false
    this.passUniforms.uPShOn.value = 0
    this.tileDirty = false
  }

  /** Per frame, after the tile streamer's update and before the Moon is drawn. True while it wants more frames. */
  update(tiles: CacheTiles | null, e: Ephemeris, now: number, o: PatchCacheOpts): boolean {
    const c0 = performance.now()
    const wants = this.updateInner(tiles, e, now, o)
    const c1 = performance.now() - c0
    if (c1 > this.stats.updateMsMax) this.stats.updateMsMax = c1
    return wants
  }

  /** True only after the Sun and tile inputs have settled and every required block is current. */
  captureIdle(now = performance.now()): boolean {
    return !this.failed && !this.wasBusy && this.stats.pending === 0 && !this.tileDirty &&
      now - this.lastChangeAt >= QUIET_MS && now - this.lastSunMoveAt >= PSH_SETTLE_MS && !this.awaiting && !this.sunOld
  }

  private updateInner(tiles: CacheTiles | null, e: Ephemeris, now: number, o: PatchCacheOpts): boolean {
    const u = this.passUniforms
    if (this.failed || !this.rt || !this.material || !this.plan.length) { this.shaderOn = false; u.uPShOn.value = 0; return false }
    const sun = this.sunB.set(e.sunDir.dot(e.moonX), e.sunDir.dot(e.moonY), e.sunDir.dot(e.moonZ)).normalize()
    if (!this.haveSun) { this.prevSunB.copy(sun); this.haveSun = true }
    const step = sun.angleTo(this.prevSunB)
    if (step > MOVING_RAD) { this.lastSunMoveAt = now; this.awaiting = true; this.burst = true }
    this.prevSunB.copy(sun)
    this.fixedPolicy = o.fixedPolicy === true
    this.fixedBudgetMs = o.fixedBudgetMs ?? FIXED_BUILD_MS[this.cls]
    const dt = this.lastNow < 0 ? 0 : Math.max(0, Math.min(100, now - this.lastNow))
    this.lastNow = now
    const prevFrameMs = this.frameMs
    this.lastDt = dt
    if (dt > 0 && this.wasBusy) this.frameMs = 0.8 * this.frameMs + 0.2 * dt
    const drift = o.drift === true && step <= DRIFT_STEP_MAX_RAD
    this.pollQueries()
    this.fence?.poll(now)
    // Validity against THIS frame's Sun, before the draw. Interactive movement (or a drift past its tolerance) drops every block this frame.
    if (this.validCount > 0) {
      const d = sun.angleTo(this.sunNew)
      const dOld = this.sunOld ? sun.angleTo(this.sunOld) : 0
      if (dOld > PSH_DRIFT_TOL_RAD) this.dropAll()
      else if (d > PSH_SUN_TOL_RAD) {
        if (drift && d <= PSH_DRIFT_TOL_RAD) this.startEpoch(sun, true)
        else this.dropAll()
      }
    }
    // The far-field tile set (the march reads the resident tiles beyond the patch within 300 km): a change rebuilds in place once things are quiet.
    if (tiles) {
      const sig = this.tilesSignature(tiles)
      if (sig !== this.tileSig) { this.tileSig = sig; this.lastChangeAt = now; if (this.validCount > 0) this.tileDirty = true }
    }
    const quiet = now - this.lastChangeAt >= QUIET_MS
    if (this.tileDirty && quiet && this.validCount > 0) { this.tileDirty = false; this.startEpoch(this.sunNew, true) }
    const blendOk = (u.uPatchBlend.value as number) * (u.uPatchGround.value as number) >= 0.999
    const approach = o.catchUp === true && this.catchUpOn
    // A catch-up frame is a motion frame: it builds at the reduced rate and never over a dear frame (no starved override).
    const catching = approach && o.motion === true
    const on = (o.active || approach) && blendOk && this.readOn
    const still = now - this.lastSunMoveAt >= PSH_SETTLE_MS
    const stalled = this.wasBusy && this.lastDt > Math.max(OVER_FRAME_MIN_MS[this.cls], OVER_FRAME_X * prevFrameMs)
    const cpuOver = o.frameStart !== undefined && now - o.frameStart > OVER_CPU_MS[this.cls]
    const over = stalled || cpuOver
    const starved = over && this.deferStreak >= DEFER_STREAK_MAX
    const canBuild = on && still && (!o.motion || catching) && this.ready && (catching ? !over : (!over || starved))
    let pendingNow = 0
    if (on) {
      if (this.bandEpoch !== this.epoch || !this.haveEpoch) {
        // Sun band per block, once per epoch (and at the first build).
        if (!this.haveEpoch) this.computeBands(sun)
        this.bandEpoch = this.epoch
      }
      for (const b of this.blocks) if (!b.inner && b.band && b.built !== this.epoch) pendingNow++
    }
    let built = 0
    if (canBuild && pendingNow > 0) {
      if (!this.haveEpoch) this.startEpoch(sun, false)
      if (this.needClear) this.clearAtlas()
      const budget = catching ? catchUpBlocks(this.blocksThisFrame(false)) : starved ? 1 : this.blocksThisFrame(this.burst, o.maxBlocks)
      const focus = approach && !o.active ? { e: 0, n: 0 } : this.focusENU(e, o)
      let queryOpen = false
      for (let n = 0; n < budget; n++) {
        let best: Block | null = null, bd = Infinity
        for (const b of this.blocks) {
          if (b.inner || !b.band || b.built === this.epoch) continue
          const de = b.e - focus.e, dn = b.n - focus.n
          // The finer level first at equal distance: the finest fully weighted level is the one read.
          const dd = de * de + dn * dn - b.slot * 1e-3
          if (dd < bd) { bd = dd; best = b }
        }
        if (!best) break
        if (!queryOpen) queryOpen = this.beginQuery(o.frameQuery)
        const b0 = performance.now()
        const okb = this.build(best)
        const bms = performance.now() - b0
        this.stats.buildMsTotal += bms; if (bms > this.stats.buildMsMax) this.stats.buildMsMax = bms
        if (!okb) break
        if (best.built < 0) this.validCount++
        best.built = this.epoch
        built++
      }
      if (queryOpen) this.endQuery(built, o.frameQuery)
      else if (this.fixedPolicy && !this.timer && built > 0) this.fence?.mark(built, performance.now())
      if (built > 0) {
        if (!catching) { this.burst = false; this.deferStreak = 0 }
        else { this.stats.catchUpBuilds += built; this.stats.catchUpFrames++ }
      }
    } else if (on && still && !o.motion && pendingNow > 0 && over) { this.stats.deferredOver++; this.deferStreak++ }
    else if (!pendingNow || (o.motion && !catching)) this.deferStreak = 0
    let pending = 0
    for (const b of this.blocks) if (!b.inner && b.band && b.built !== this.epoch) pending++
    if (pending === 0 && this.validCount > 0) {
      // Every needed block is current: the older Sun is no longer held.
      if (this.sunOld) { this.sunOld = null }
      if (this.awaiting && still) { this.stats.timeToCachedMs = now - this.lastSunMoveAt; this.awaiting = false }
    }
    this.stats.built = this.validCount
    this.stats.pending = pending
    this.stats.serving = this.validCount
    this.stats.buildsLastFrame = built
    this.stats.buildsTotal += built
    this.stats.msPerBlock = this.msPerBlock
    this.stats.failed = this.failed
    this.shaderOn = on && this.validCount > 0
    u.uPShOn.value = this.shaderOn ? 1 : 0
    const wants = on && pending > 0
    this.wasBusy = wants
    return wants
  }

  /** Starts a build epoch for `sun`: blocks of older epochs are rebuilt (and served meanwhile when `keep`). */
  private startEpoch(sun: THREE.Vector3, keep: boolean): void {
    if (keep && this.validCount > 0) {
      if (!this.sunOld) this.sunOld = this.sunNew.clone()
      this.stats.rebuilds++
    }
    this.epoch++
    this.sunNew.copy(sun)
    this.haveEpoch = true
    this.bandEpoch = -1
    if (this.validCount > 0 || keep) this.computeBands(sun)
    this.bandEpoch = this.epoch
    this.burst = true
  }

  private readonly sigCen: Array<{ level: number; tx: number; ty: number; x: number; y: number; z: number; half: number } | undefined> = []
  /** Far tiles within the march's reach of the site: layer, generation and whether they are fully in. */
  private tilesSignature(tiles: CacheTiles): number {
    const site = this.passUniforms.uPSite.value as THREE.Vector3
    let h = 0
    for (const s of tiles.cacheSlots()) {
      if (!s.full) continue
      // Tile centre in the body frame, as ShadowCache.tileCentre, kept per layer while it holds the same tile (no trig per slot per frame).
      let k = this.sigCen[s.layer]
      if (!k || k.level !== s.level || k.tx !== s.tx || k.ty !== s.ty) {
        const deg = levelDeg(s.level)
        const lon = ((s.tx + 0.5) * deg - 180) * RAD, lat = (90 - (s.ty + 0.5) * deg) * RAD
        k = this.sigCen[s.layer] = { level: s.level, tx: s.tx, ty: s.ty, x: Math.cos(lat) * Math.cos(lon), y: Math.cos(lat) * Math.sin(lon), z: Math.sin(lat), half: 0.7072 * deg * RAD }
      }
      // angle(centre, site) > lim, as a dot against a cosine: no acos.
      const lim = tileReachRad(s.level, this.flatReach) + k.half + 0.01
      if (lim < Math.PI && k.x * site.x + k.y * site.y + k.z * site.z < Math.cos(lim)) continue
      h = (Math.imul(h, 31) + s.layer * 7919 + s.gen * 104729 + 1) | 0
    }
    return h
  }

  /** Where the camera looks on the ground, metres east and north of the site (the build order's centre). */
  private focusENU(e: Ephemeris, o: PatchCacheOpts): { e: number; n: number } {
    const u = this.passUniforms
    const site = u.uPSite.value as THREE.Vector3, east = u.uPEast.value as THREE.Vector3, north = u.uPNorth.value as THREE.Vector3
    const ro = o.camPos, rd = this.v1.copy(o.camBack).negate().normalize()
    const b = ro.dot(rd), cc = ro.dot(ro) - 1
    const disc = b * b - cc
    const hit = this.v2
    if (disc >= 0 && -b - Math.sqrt(disc) > 0) hit.copy(ro).addScaledVector(rd, -b - Math.sqrt(disc))
    else hit.copy(ro).normalize()
    const bx = hit.dot(e.moonX), by = hit.dot(e.moonY), bz = hit.dot(e.moonZ)
    void site
    return { e: (bx * east.x + by * east.y + bz * east.z) * PR_M, n: (bx * north.x + by * north.y + bz * north.z) * PR_M }
  }

  private blocksThisFrame(burst: boolean, maxBlocks?: number): number {
    if (this.fixedPolicy) {
      const budget = Math.max(0.25, Math.min(8, this.fixedBudgetMs))
      return fixedBlockBudget(budget, this.msPerBlock, this.timer ? 0 : this.fence?.perBlockMs ?? 0, FIXED_BLOCK_FLOOR_MS[this.cls], maxBlocks)
    }
    if (this.fixedBudget > 0) return this.fixedBudget
    const per = this.msPerBlock > 0 ? this.msPerBlock : GUESS_MS_PER_BLOCK[this.cls]
    const grow = this.msPerBlock > 0 || this.timer === null ? Math.max(1, Math.min(4, 0.3 * this.frameMs / BUDGET_MS[this.cls])) : 1
    // Without the timer a layer's cost is unknown: the first burst is no bigger than a normal frame.
    const x = burst && this.timer !== null ? BURST_X : 1
    if (this.timer === null) return Math.round(FALLBACK_BLOCKS[this.cls] * grow * x)
    return Math.max(1, Math.min(MAX_BLOCKS_PER_FRAME, Math.floor(BUDGET_MS[this.cls] * grow * x / per)))
  }

  private clearAtlas(): void {
    const r = this.renderer
    const u = this.material!.uniforms
    const rt = this.rt!
    const prevTarget = r.getRenderTarget(), prevAuto = r.autoClear
    u.uPShClear.value = 1
    rt.scissorTest = false
    r.autoClear = false
    r.setRenderTarget(rt)
    r.render(this.scene, this.camera)
    r.setRenderTarget(prevTarget)
    r.autoClear = prevAuto
    u.uPShClear.value = 0
    this.needClear = false
    this.stats.cleared++
  }

  private build(b: Block): boolean {
    const r = this.renderer
    const rt = this.rt!
    const u = this.material!.uniforms
    const pl = this.plan.find((p) => p.slot === b.slot)!
    const l = pl.level
    ;(u.uPShOrg.value as THREE.Vector4).set(pl.rect.x, pl.rect.y, pl.rect.cw, pl.rect.ch)
    ;(u.uPShG.value as THREE.Vector4).set(l.eastM, l.northM, l.texelEastM, l.texelNorthM)
    u.uPShK.value = pl.k
    u.uPShClear.value = 0
    const prevTarget = r.getRenderTarget(), prevAuto = r.autoClear
    rt.scissor.set(b.x, b.y, b.w, b.h)
    rt.scissorTest = true
    r.autoClear = false
    r.setRenderTarget(rt)
    if (!this.fbChecked) {
      this.fbChecked = true
      const gl = r.getContext?.() as WebGL2RenderingContext | undefined
      if (gl && gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        this.failed = true; this.stats.failed = true
        r.setRenderTarget(prevTarget); r.autoClear = prevAuto
        return false
      }
    }
    r.render(this.scene, this.camera)
    r.setRenderTarget(prevTarget)
    r.autoClear = prevAuto
    return true
  }

  private beginQuery(frame?: { suspend(): void; resume(): void }): boolean {
    const t = this.timer
    if (!t || this.queries.length >= 6) return false
    let suspended = false
    try {
      const gl = this.renderer.getContext() as WebGL2RenderingContext
      if (gl.getQuery(t.TIME_ELAPSED_EXT, gl.CURRENT_QUERY) && frame) { frame.suspend(); suspended = true }
      if (gl.getQuery(t.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) { if (suspended) frame!.resume(); return false }
      const q = gl.createQuery()
      if (!q) { if (suspended) frame!.resume(); return false }
      gl.beginQuery(t.TIME_ELAPSED_EXT, q)
      this.queries.push({ q, n: 0 })
      return true
    } catch { if (suspended) frame!.resume(); return false }
  }
  private endQuery(n: number, frame?: { suspend(): void; resume(): void }): void {
    const t = this.timer
    if (!t) return
    try {
      const gl = this.renderer.getContext() as WebGL2RenderingContext
      gl.endQuery(t.TIME_ELAPSED_EXT)
      const last = this.queries[this.queries.length - 1]
      if (last) last.n = n
    } catch { /* ignore */ }
    frame?.resume()
  }
  private pollQueries(): void {
    const t = this.timer
    if (!t || !this.queries.length) return
    try {
      const gl = this.renderer.getContext() as WebGL2RenderingContext
      while (this.queries.length) {
        const h = this.queries[0]
        if (!gl.getQueryParameter(h.q, gl.QUERY_RESULT_AVAILABLE)) break
        const disjoint = gl.getParameter(t.GPU_DISJOINT_EXT)
        if (!disjoint && h.n > 0) {
          const ms = (gl.getQueryParameter(h.q, gl.QUERY_RESULT) as number) / 1e6 / h.n
          if (ms > 0) this.msPerBlock = this.msPerBlock < 0 ? ms : 0.7 * this.msPerBlock + 0.3 * ms
        }
        gl.deleteQuery(h.q)
        this.queries.shift()
      }
    } catch { this.queries.length = 0 }
  }

  dispose(lost = false): void {
    ledger.release('patch', this.ledgerKey)
    for (const q of this.queries) { try { (this.renderer.getContext() as WebGL2RenderingContext).deleteQuery(q.q) } catch { /* ignore */ } }
    this.queries.length = 0
    this.clearUniforms()
    if (!lost) { this.rt?.dispose(); this.material?.dispose() }
    this.rt = null; this.material = null; this.plan = []; this.blocks = []; this.shaderOn = false
  }
}
