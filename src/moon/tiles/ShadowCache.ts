import { FenceBlockTimer, fixedBlockBudget, type FenceGl } from './fenceBlockTimer'
import * as THREE from 'three'
import { FULLSCREEN_VERTEX, fullscreenTriangle } from '../../glsl/common'
import type { Ephemeris } from '../../ephemeris'
import { SH_CACHE_PAGE_W, SH_PATCH_CLEAR_KM, ringEnvelopeOn, shadowCacheFragment } from '../moonShader'
import { H_SIZE, MOON_R_KM, levelDeg } from './grid'
import { marchReachKm, shReachOn } from '../march'
import { ledger, textureBytes } from '../../quality/ledger'
import { parseShadowPolicy, shadowJobCanPublish } from '../shadowPolicy'

/**
 * The Sun-keyed shadow cache (render architecture option A4, R5 of OPTIONS-render-architecture-2026-10-06.md).
 *
 * Three cases, switched per tile layer and per frame behind a fade, so a visitor never sees a mode:
 * - **Static Sun** (camera drag, zoom, rest): each resident height tile has a cache layer holding, per texel, the horizon angle toward the Sun,
 *   built on the GPU by the pixel shader's own march (`shadowCacheFragment`) in a tile-sized pass. The pixel shader then reads one bilinear
 *   tap (`horizonSun`) instead of marching 70 samples. The Sun's 0.53 deg disc is untouched: the shader still smoothsteps the margin over
 *   its penumbra, the cache only replaces the horizon it compares against.
 * - **Interactive Sun or time** (Sun drag, time slider, eclipse playback, journeys, seeks): the moment the Sun leaves the direction a layer was
 *   built for by more than SUN_TOL_RAD the layer is dropped (this frame, before it is drawn), so the pixel shader marches live for it, exactly
 *   as without a cache. When the Sun has been still for SETTLE_MS the visible layers are rebuilt and each fades in over FADE_MS.
 * - **Clock drift** (the live clock's 60 s tick, `opts.drift`): the Sun moves ~0.01 deg a tick, and dropping every layer to the live march
 *   then rebuilding it would flash the shadow edges every minute at rest. Here the layer already built stays drawn while a replacement is
 *   built into a spare cache layer, and the shader crossfades old cache -> new cache (never cache -> live -> cache). The old layer is shown
 *   only while its Sun is within DRIFT_TOL_RAD and for at most STALE_MAX_MS: one rebuild cycle.
 *
 * A stale shadow is never drawn as current while the Sun is moved interactively: validity is decided against the Sun of THIS frame, in the
 * Moon's body frame, and the fade texture the shader reads is uploaded in the same frame, before the Moon is drawn.
 *
 * Error bounds. The cache stores the horizon toward ONE azimuth; the Sun's elevation is live in the shader (`shadowMargin = elevS - hz`). So a
 * layer built for a Sun an angle D away differs from a fresh one only by the horizon's change over that azimuth shift, |dhz/daz| * D. The
 * azimuthal slope L is a few tenths on ordinary relief and about 1 on a crater rim. The Sun's penumbra half-width is 0.267 deg (its disc's
 * radius), the margin ramp the shader smoothsteps over.
 *   SUN_TOL_RAD   0.01 deg: error <= 0.01 deg * L, 4 % of the half-width at L = 1. Treated as exact (no rebuild).
 *   DRIFT_TOL_RAD 0.05 deg: error <= 0.05 deg * L, 19 % of the half-width at L = 1 (37 % at L = 2), shown for one rebuild cycle only.
 * Residual: during a drift cycle (about 0.5 s each minute) a shadow edge on a steep rim can sit up to 0.05 deg of margin off the live one;
 * it then crossfades to the exact edge over FADE_MS, an ease with no hard cut. A cliff steeper than L = 2 is as sharp in the live march.
 */

/** A layer built for a Sun within this of the current one is current (0.01 deg; see the error bounds above). */
export const SUN_TOL_RAD = 0.01 * Math.PI / 180
const COS_SUN_TOL = Math.cos(SUN_TOL_RAD)
/** During clock drift a layer stays drawn this far from the current Sun (0.05 deg), until its replacement is ready. */
export const DRIFT_TOL_RAD = 0.05 * Math.PI / 180
/** A drift step larger than this in one frame is a jump (a seek, a dropped tab), not the clock ticking: the live path takes over. */
const DRIFT_STEP_MAX_RAD = 0.03 * Math.PI / 180
/** A layer is drawn stale during drift for at most this (ms): one rebuild cycle. */
export const STALE_MAX_MS = 3000
/** The Sun counts as moving while it changed by more than this since the last frame (rad). */
const MOVING_RAD = 2e-6
/** The Sun must have been still this long before a rebuild starts (ms): a drag's pauses must not start work that the next move discards. */
export const SETTLE_MS = 120
/** Tile arrivals, evictions and fade-ins must have stopped this long before layers are rebuilt for a changed neighbour (ms). */
const QUIET_MS = 150
/** A rebuilt layer fades in over this (ms). */
export const FADE_MS = 250
/** Spare cache layers beyond one per tile layer: the pool a rebuild draws on while the layer it replaces is still shown, by device class. */
export const SPARE_LAYERS = { desktop: 16, low: 4 }
/** Class memory cap for the cache array (bytes): a phone class holds 111 layers (~22 MB, against 29.4 MB for every height tile): the ~100 on-screen tiles at a close terminator pose fit with 4 spares; layers past the cap are never built (the live march serves them). */
export const CACHE_BYTES_CAP = { desktop: 64 << 20, low: 22 << 20 }
/**
 * A build never starts in a frame that is already over budget: when the CPU part of this frame (from its start to the build) took longer than this (ms),
 * or the previous frame took more than OVER_FRAME_X times the smoothed frame time (a stall), the build waits for the next frame. Deferred, not lost.
 */
const OVER_CPU_MS = { desktop: 6, low: 10 }
const OVER_FRAME_X = 2.2
const OVER_FRAME_MIN_MS = { desktop: 30, low: 45 }
/** A tile counts as on screen for the time-to-cached figure when its centre is within this of the view centre (wanted.ts keepScore: centre + 0.25 * level). */
const VISIBLE_CENTRE = 1.25
/**
 * Fixed policy: a fresh build does not START while tiles are still arriving (QUIET_MS since the last change), for at most this long (ms). A job started
 * before the ground settles is restarted by the next arrival within reach (its horizon reads neighbours), so its blocks are wasted work.
 */
const FRESH_QUIET_MAX_MS = 1200
/** A built layer is evicted for the memory cap only for a tile this much more on screen (keep score difference), so near-equal tiles do not trade places. */
const EVICT_MARGIN = 0.3
/** Most records `tileDiag` keeps. */
export const DIAG_MAX = 48
/** GPU time the rebuilds may take per rest frame (ms), by device class; ?shbudget=N overrides with a fixed layer count (tuning). */
const BUDGET_MS = { desktop: 5, low: 2.5 }
/** First guess of one layer's GPU time (ms) until a timer query has measured it, by device class. */
const GUESS_MS_PER_LAYER = { desktop: 0.4, low: 2.5 }
/** Layers built per frame when there is no timer query, by device class. */
const FALLBACK_LAYERS = { desktop: 4, low: 1 }
const MAX_LAYERS_PER_FRAME = 128
/** Fixed-policy tile builds are split into 3x3 scissored blocks. */
const FIXED_BLOCK = 128
const FIXED_BLOCKS = Math.ceil(H_SIZE / FIXED_BLOCK) ** 2
const FIXED_BUILD_MS = { desktop: 3, low: 1.5 }
const FIXED_BLOCK_FLOOR_MS = { desktop: 0.25, low: 0.2 }
/**
 * term-fix C. A layer's build is a full 322x322 draw of the whole march; on Apple's Metal a timer query under-reads it (the rig showed 5 to 7x),
 * so a measured time below this floor is not believed, and the budget cannot balloon from a 0.3 ms reading (`?shfix=0` restores the old sizing).
 */
const MS_PER_LAYER_FLOOR = { desktop: 1.5, low: 2.5 }
/** Hard cap on layers one desktop frame may build (each is a render pass and a full-resolution rest redraw follows the batch). */
const MAX_BUILDS_DESKTOP = 8
/** A frame already over this (ms) gets no growth of the build budget. */
const OVER_FRAME_BUDGET_MS = 33
const SHFIX_PARAM = typeof location === 'undefined' || new URLSearchParams(location.search).get('shfix') !== '0'
/**
 * The build material is compiled in the background at construction (compileAsync, KHR_parallel_shader_compile) and its framebuffer is checked there, so the
 * first build does not link the program and drain the GPU inside a frame (137-152 ms on the L4 cold pass, stall-diag #5). `?shprecompile=0` restores the old
 * path (link on the first draw, framebuffer check in the first build) for a same-build A/B.
 */
export function shPrecompileOn(search: string): boolean { return new URLSearchParams(search).get('shprecompile') !== '0' }
/** Builds wait for the background compile at most this long (ms of frame time from the first frame with a build to do), then go ahead anyway: a compile
 *  promise that never settles must not leave the cache dead. Without KHR_parallel_shader_compile, compileAsync resolves at once and the link happens on the first draw. */
export const COMPILE_WAIT_MS = 3000
/** After the compile settles, run the program's first-use queries between frames (default), or leave them to the first build (`?shwarm=0`). */
export function shWarmOn(search: string): boolean { return new URLSearchParams(search).get('shwarm') !== '0' }
/** Consecutive over-budget deferrals after which one small build is let through, and its size in layers. */
const DEFER_STREAK_MAX = 3
const STARVED_LAYERS = 2
/**
 * GPU time the FIRST build frame after the Sun stops may take (ms), by device class. That frame is the first full-size one with every layer
 * stale, so it pays the whole live march; building the visible set before it is drawn (one burst, then the normal budget) turns one expensive
 * frame plus several half-cached ones into one cheap burst.
 */
const BURST_MS = { desktop: 24, low: 10 }
/**
 * The burst may grow to half the slowest recent frame (that frame is the live march the burst replaces: on a phone it is several hundred ms, so one
 * burst of the visible set is cheaper than the four to five live frames that building a few layers a frame would take), up to this (ms).
 */
const BURST_CAP_MS = { desktop: 40, low: 200 }
/** Sun elevation range (deg) a texel's horizon is built for: the pixel shader marches only for -12 to 40 (moonShader.ts), plus a degree of margin each side. */
const BAND_LO = -13
const BAND_HI = 41
/** A tile whose whole area is outside this elevation range holds nothing the shader will read (the band plus a degree more). */
const SKIP_LO = -14
const SKIP_HI = 42
/** A tile arriving or leaving changes horizons within the march's reach (300 km: what a level-2 tile, the coarsest, is read from). */
const REACH_DEG = 300 / MOON_R_KM * 180 / Math.PI
/**
 * The angular reach (deg) of a changed tile of `level`, between the two tiles' edges. A finer tile is read only by samples near the origin
 * (marchReachKm: level 0 about 11 km, 1 about 22 km, -3 about 1.4 km), so a change at one cannot move a horizon farther away than that.
 * Level 2 returns REACH_DEG itself, the same number as before. `?shreach=300` (flat = true) returns it for every level.
 */
export function reachDeg(level: number, flat = false): number {
  const km = marchReachKm(level)
  return flat || km >= 300 ? REACH_DEG : km / MOON_R_KM * 180 / Math.PI
}
/** The shader keeps the live march within this of a fused-ground site patch (SH_PATCH_CLEAR_KM, shared with it); a tile wholly inside is never read, so never built. */
const PATCH_CLEAR_RAD = SH_PATCH_CLEAR_KM / MOON_R_KM

const RAD = Math.PI / 180

/** What the cache needs of the tile streamer (TileStreamer implements it; the unit tests stub it). */
export interface CacheTiles {
  /** Read within the frame, not kept: TileStreamer refills one array in place. */
  cacheSlots(): readonly { layer: number; level: number; tx: number; ty: number; gen: number; full: boolean; shade: boolean; keep: number }[]
  takeChanges(): { changes: Array<{ level: number; tx: number; ty: number }>; overflow: boolean }
  trackChanges: boolean
}

/** One built cache layer: where it lives, the Sun it was built for, how much of it is shown. */
interface Buf {
  idx: number
  sx: number
  sy: number
  sz: number
  /** Share shown (0..1); the rest is the live march or the other build. */
  w: number
  /** When it first stopped matching the current Sun (ms), or -1 while it matches. */
  staleSince: number
}
interface LayerState {
  gen: number
  /** The newest build. */
  cur: Buf | null
  /** The build `cur` replaced, shown while `cur` fades in; null otherwise. */
  old: Buf | null
  /** A neighbouring tile changed: rebuild once things are quiet (the layer keeps serving meanwhile). */
  dirty: boolean
  /** A fixed-policy layer stays invisible until every block from this epoch completes. */
  job: { idx: number; epoch: number; next: number; sx: number; sy: number; sz: number; terrain: number; startedAt: number } | null
}

/** One demanded (visible, shaded, in the Sun band) tile that is not exact yet: the dev-only per-tile diagnostic record. */
export interface ShadowTileDiag {
  level: number; tx: number; ty: number; layer: number; gen: number
  keep: number; full: boolean; shade: boolean
  /** Why the tile is demanded ('in-band') plus 'capacity-blocked' when no cache layer was available for it this frame. */
  reason: string
  dirty: boolean
  /** Weight of the newest and the older build (-1: none). */
  curW: number; oldW: number
  /** How long the newest build has not matched the Sun (ms; -1: it matches or there is none). */
  sunAgeMs: number
  /** Fixed-policy job: Sun epoch, blocks done, age (ms); null without a job. */
  job: { epoch: number; next: number; ageMs: number } | null
  /** The last reason the scheduler did not build or finish this tile ('' when it has not been rejected). */
  rejected: string
}

/** Cache-layer pool totals (dev diagnostic). */
export interface ShadowPoolDiag {
  capacity: number; free: number; current: number; old: number
  /** Unfinished fixed-policy jobs, and the ones whose tile is no longer eligible for a build (reclaimed at the next update). */
  partial: number; abandoned: number
  capacityFailures: number; evictions: number; jobsReclaimed: number; jobRestarts: number
}

export interface ShadowCacheStats {
  layers: number
  built: number
  serving: number
  buildsTotal: number
  buildsLastFrame: number
  /** Builds by cause (fresh: no layer yet; sun: the Sun moved on; dirty: a neighbouring tile changed). */
  buildsFresh: number
  buildsSun: number
  buildsDirty: number
  gpuBytes: number
  sunMoving: boolean
  pendingBuild: number
  /** Layers per frame the budget currently allows, and the measured GPU ms of one layer (-1: not measured). */
  budgetLayers: number
  msPerLayer: number
  /** From the Sun's last movement to every wanted layer built and shown (k > 0), and to every one fully faded in (ms; -1 until measured). */
  timeToCachedMs: number
  /** Same, counting every wanted layer including those off screen (ms; -1 until measured). */
  timeToCachedAllMs: number
  timeToFadedMs: number
  /** Builds deferred because the frame was already over budget. */
  deferredOver: number
  /** Layers given up to a more on-screen tile because of the class memory cap. */
  evictedForCap: number
  /** Wanted layers on screen, how many of them are built, and wanted ones left on the live march by the cap (diagnostics). */
  visibleWanted: number
  visibleBuilt: number
  /** Visible terrain tiles with a fully faded horizon for the current Sun epoch. */
  visibleExact: number
  /** Visible tiles in the Sun band that want a build and have none (as of the last update): outside the band, under a patch and class-capped tiles never count. */
  visibleUnmetBand: number
  /** Build-only catch-up frames after a camera stop (rest-frame catch-up), and the layers they built. */
  catchUpFrames: number
  catchUpLayers: number
  cappedOut: number
  /** CPU time of update() (diagnostics): calls, total and worst (ms). */
  updateCalls: number
  updateMsTotal: number
  updateMsMax: number
  /** Cache layers (array depth) after the class memory cap. */
  cacheLayers: number
  /** How many Sun movements ended in a measured time to cached. */
  cachedEvents: number
  fadedEvents: number
  /** Frames a layer was shown stale (drift), and layers dropped to the live march by the Sun moving. */
  staleServedFrames: number
  invalidated: number
  /** The cache's framebuffer was not complete, or its shader failed to compile: the cache is off for good. */
  failed: boolean
  /** Background compile (shprecompile): on, the time from construction to the compile settling (ms, performance.now; -1 while pending or when off),
   *  whether builds went ahead on the COMPILE_WAIT_MS fallback, and whether the context offers KHR_parallel_shader_compile (null: unknown). */
  precompile: boolean
  compileMs: number
  compileFallback: boolean
  parallelCompile: boolean | null
  /** Revision of the terrain the builds depend on: bumps whenever a neighbour change dirties a layer or a job. */
  terrainRev: number
  /** Hash of the visible demand set (layer and generation of every demanded tile): changes when the camera demands other tiles. */
  demandSig: number
  /** Time (ms of update clock) from the last Sun/terrain/demand revision change to every demanded tile being exact and idle; -1 until then. Set by update(), never by a read. */
  settledMs: number
  /** Allocation failures under the class cap (events), and visible demand left without a layer this frame (reported as unmet, never excluded). */
  capacityFailures: number
  capacityBlockedVisible: number
  /** Demanded tiles that are not exact (the unmet share of visibleWanted). */
  visibleNotExact: number
  /** Partial jobs given up because their tile lost eligibility or a better tile needed the slot, and jobs restarted because terrain changed. */
  jobsReclaimed: number
  jobRestarts: number
}

/** Tile centre unit vector in the Moon's body frame, and the half-diagonal of its footprint in degrees (an upper bound: a lon arc is shorter off the equator). */
function tileCentre(level: number, tx: number, ty: number, out: THREE.Vector3): number {
  const d = levelDeg(level)
  const lon = ((tx + 0.5) * d - 180) * RAD
  const lat = (90 - (ty + 0.5) * d) * RAD
  out.set(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat))
  return 0.7072 * d
}

function deviceClass(): 'desktop' | 'low' {
  try {
    // ?class= forces the startup class (measurement and emulation): everything but desktop is a phone-or-tablet budget.
    const forced = new URLSearchParams(location.search).get('class')
    if (forced === 'phone-android' || forced === 'tablet' || forced === 'ios' || forced === 'ipad') return 'low'
    if (forced === 'desktop') return 'desktop'
    const nav = navigator as Navigator & { deviceMemory?: number }
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    const small = Math.min(screen.width, screen.height) < 700
    return coarse || small || (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) ? 'low' : 'desktop'
  } catch { return 'desktop' }
}

export interface ShadowCacheOpts {
  /** New block scheduler is supplied only by ?shadowpolicy=fixed; omitted preserves the legacy scheduler. */
  fixedPolicy?: boolean
  fixedBudgetMs?: number
  /** Fixed policy: at most this many 128 px blocks this frame (a gesture or flight frame passes 1). */
  maxBlocks?: number
  /** The Sun's motion this frame is the live clock ticking (not a drag, a slider, a journey or a seek). */
  drift?: boolean
  /** This is a camera-motion frame (scale < 1): no layers are built now (a build wave inside a frame that is already a degraded one costs the drag more than it saves). */
  motion?: boolean
  /** A frame that draws nothing (the hand-back's cache catch-up): build at the burst budget and ignore the over-budget deferral. */
  catchUp?: boolean
  /** A deterministic capture settle draw (`__moon.capture.frame`): a draw is deliberately slow (full quality, polled), so the over-budget deferral is ignored; otherwise a build waited ~4 draws per 2 layers and the frame timed out. */
  capture?: boolean
  /** performance.now() at the start of this frame: a build is skipped when more than OVER_CPU_MS of the frame is already spent. */
  frameStart?: number
  /** The frame timer's open query: ended around the cache's own builds so their cost is measured (only one TIME_ELAPSED query can be active). */
  frameQuery?: { suspend(): void; resume(): void }
}

type TimerExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

export class ShadowCache {
  /** The cache array (R16F), read by the Moon shader as `uTileS`. */
  readonly texture: THREE.Texture
  /** Per tile layer: (cache layer of its newest build, its share, cache layer of the build it replaces, its share); RGBA32F, SH_CACHE_PAGE_W wide, read as `uShFade`. */
  readonly fade: THREE.DataTexture
  readonly stats: ShadowCacheStats = {
    layers: 0, built: 0, serving: 0, buildsTotal: 0, buildsLastFrame: 0, buildsFresh: 0, buildsSun: 0, buildsDirty: 0, gpuBytes: 0, sunMoving: false,
    pendingBuild: 0, budgetLayers: 0, msPerLayer: -1, timeToCachedMs: -1, timeToCachedAllMs: -1, timeToFadedMs: -1, deferredOver: 0, evictedForCap: 0, visibleWanted: 0, visibleBuilt: 0, visibleExact: 0, visibleUnmetBand: 0, catchUpFrames: 0, catchUpLayers: 0, cappedOut: 0, updateCalls: 0, updateMsTotal: 0, updateMsMax: 0, cacheLayers: 0, cachedEvents: 0, fadedEvents: 0, staleServedFrames: 0, invalidated: 0, failed: false,
    precompile: false, compileMs: -1, compileFallback: false, parallelCompile: null,
    terrainRev: 0, demandSig: 0, settledMs: -1, capacityFailures: 0, capacityBlockedVisible: 0, visibleNotExact: 0, jobsReclaimed: 0, jobRestarts: 0,
  }
  /** Set when the framebuffer was incomplete (an unrenderable R16F layer) or the build shader failed to compile: the owner detaches the cache and the shader marches live. */
  failed = false
  /** The Moon shader may read the cache (the debug read switch); `serving` frames also need a layer shown, see `shaderOn`. */
  readOn = true
  /** True when this frame's shader should take the cache path: some layer is shown. With none, the plain live march is cheaper (no fade fetch, no branch). */
  shaderOn = false
  private readonly rt: THREE.WebGLArrayRenderTarget
  private readonly material: THREE.ShaderMaterial
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera()
  private readonly fadeData: Float32Array
  private readonly state: LayerState[]
  /** Free cache layer indices (one per tile layer, plus the spares). */
  private readonly free: number[] = []
  private readonly fixedBudget: number
  /** `?shreach=300`: every level invalidates over the flat 300 km (today's reach). */
  private readonly flatReach: boolean
  private readonly cls = deviceClass()
  /** term-fix C applies to the desktop class only; phones keep main's sizing. */
  private readonly shfix = SHFIX_PARAM && this.cls === 'desktop'
  private readonly sunB = new THREE.Vector3()
  private readonly prevSunB = new THREE.Vector3()
  private haveSun = false
  private lastNow = -1
  private lastSunMoveAt = -1e9
  private lastChangeAt = -1e9
  /** Fixed policy: when fresh builds first had to wait for terrain to stop changing (-1: not waiting). */
  private freshWaitFrom = -1
  private fadeDirty = true
  private fbChecked = false
  /** The build program is compiled (or precompile is off): builds may run. */
  private compiled = false
  /** Frame time (update's `now`) of the first frame that had a build to do while the compile was pending; -1: none yet. */
  private compileWaitFrom = -1
  private searchQ = ''
  private awaiting = false
  private awaitingVis = false
  private awaitingFade = false
  private readonly ledgerKey = 'shadow-cache'
  private readonly scratch = new THREE.Vector3()
  private readonly scratch2 = new THREE.Vector3()
  private liveStamp = 0
  private liveAt!: Int32Array
  /** Per-layer tile centre (unit vector) and footprint radius, kept while the layer holds the same tile: the neighbour walk reads them instead of redoing the trig. */
  private cen!: Float64Array
  private cenR!: Float64Array
  private cenKey!: Int32Array
  private msPerLayer = -1
  /** No timer query (most Android GPUs): block cost from fences. */
  fence: FenceBlockTimer | null = null
  /** Smoothed time between frames (ms) while updating: the rebuild budget grows with it. */
  private frameMs = 16
  /** The previous frame's interval (ms), for the over-budget test. */
  private lastDt = 0
  /** Slowest recent frame interval (ms) among frames that asked for the next one; decays 2 % a frame. */
  private peakMs = 0
  /** The last update asked for another frame (a build wave or fade was running), so the interval since it is a frame time and not an idle gap. */
  private wasBusy = false
  /** The Sun moved since the last build frame: the next one may build a burst. */
  private burst = false
  private timer: TimerExt | null = null
  private deferStreak = 0
  private fixedEpoch = 0
  private fixedPolicy = false
  private fixedBudgetMs = 0
  private fixedCursor = 0
  /** Dev diagnostics (set by the app when dev tools are on): fills `tileDiag`. Off: no per-tile records are built. */
  diagnostics = false
  /** Demanded-but-not-exact tiles as of the last update (bounded by DIAG_MAX); empty unless `diagnostics`. */
  readonly tileDiag: ShadowTileDiag[] = []
  private readonly rejected: string[]
  private wantStamp!: Int32Array
  private skipStamp!: Int32Array
  private updateStamp = 0
  private settleKey = ''
  private settleKeyAt = 0
  private readonly queries: Array<{ q: WebGLQuery; n: number; blocks: boolean }> = []
  private readonly layerCount: number
  /** The layers carry the ring's footprint envelope (RG16F). */
  readonly envelope: boolean

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    /** The Moon pass's uniforms: the body axes, the Sun, the tile arrays and the 4k map the build march reads (and the site patch the cache keeps clear of). */
    private readonly passUniforms: Record<string, THREE.IUniform>,
    private readonly tileLayers: number,
    lonSpan: number,
    mapWidth: number,
    deepest: number,
    /**
     * Tiles the cache is sized for (the streamer's `heightWant`): the ARRAY holds `cacheWant + SPARE_LAYERS` layers while `state` and `uShFade` stay indexed by
     * tile layer (`tileLayers`). A streamer with history layers past its want (parked slots, TileStreamer.park) gets no cache layer for them until they
     * are wanted again; the cap-eviction path below already serves fewer cache layers than tiles. Defaults to `tileLayers` (the old sizing).
     */
    cacheWant: number = tileLayers,
  ) {
    const cls = deviceClass()
    // Fixed policy, three-level tile set, ring cache on: each layer also carries the footprint envelope of its texels (g channel; src/moon/ringEnvelope.ts), so RG16F: twice the bytes, and the class cap doubles with it (same layer count).
    const search = typeof location === 'undefined' ? '' : location.search
    const envOn = parseShadowPolicy(search) === 'fixed' && ringEnvelopeOn(deepest)
    this.envelope = envOn
    const layerBytes = textureBytes(H_SIZE, H_SIZE, envOn ? 4 : 2)
    // ?shcap=N overrides the class cap with a layer count (tuning and the unit test).
    const capQ = Math.floor(Number(new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('shcap')) || 0)
    this.layerCount = Math.max(1, Math.min(Math.min(cacheWant, tileLayers) + SPARE_LAYERS[cls], capQ >= 8 ? capQ : Math.floor(CACHE_BYTES_CAP[cls] * (envOn ? 2 : 1) / layerBytes)))
    this.rt = new THREE.WebGLArrayRenderTarget(H_SIZE, H_SIZE, this.layerCount, {
      format: envOn ? THREE.RGFormat : THREE.RedFormat, type: THREE.HalfFloatType, internalFormat: envOn ? 'RG16F' : 'R16F',
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false,
    })
    this.rt.texture.wrapS = this.rt.texture.wrapT = THREE.ClampToEdgeWrapping
    this.texture = this.rt.texture
    const rows = Math.max(1, Math.ceil(tileLayers / SH_CACHE_PAGE_W))
    this.fadeData = new Float32Array(4 * SH_CACHE_PAGE_W * rows)
    for (let i = 0; i < this.fadeData.length; i += 4) { this.fadeData[i] = -1; this.fadeData[i + 2] = -1 }
    this.fade = new THREE.DataTexture(this.fadeData, SH_CACHE_PAGE_W, rows, THREE.RGBAFormat, THREE.FloatType)
    this.fade.internalFormat = 'RGBA32F'
    this.fade.minFilter = this.fade.magFilter = THREE.NearestFilter
    this.fade.generateMipmaps = false
    this.fade.needsUpdate = true
    this.state = Array.from({ length: tileLayers }, () => ({ gen: -1, cur: null, old: null, dirty: false, job: null }))
    this.liveAt = new Int32Array(tileLayers)
    this.wantStamp = new Int32Array(tileLayers)
    this.skipStamp = new Int32Array(tileLayers)
    this.rejected = new Array<string>(tileLayers).fill('')
    this.cen = new Float64Array(3 * tileLayers)
    this.cenR = new Float64Array(tileLayers)
    this.cenKey = new Int32Array(3 * tileLayers).fill(-0x7fffffff)
    for (let i = this.layerCount - 1; i >= 0; i--) this.free.push(i)
    const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search)
    this.flatReach = !shReachOn(q.toString())
    this.fixedBudget = Math.max(0, Math.min(64, Math.floor(Number(q.get('shbudget')) || 0)))
    try {
      const gl = renderer.getContext?.() as WebGL2RenderingContext | undefined
      this.timer = (gl?.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null | undefined) ?? null
    } catch { this.timer = null }
    try { if (!this.timer) { const g = renderer.getContext?.() as unknown as FenceGl | undefined; this.fence = g && typeof g.fenceSync === 'function' ? new FenceBlockTimer(g) : null } } catch { this.fence = null }
    // The build pass shares the Moon pass's uniform objects (the body axes, the Sun, the tile arrays, the 4k map), but not the cache's own
    // three (and uShMode, pinned to Full: layers are always built with the full march whatever mode is shown): sampling the array it is drawing into would be a feedback loop.
    const own = { uTileS: { value: null }, uShFade: { value: null }, uShOn: { value: 0 }, uMotion: { value: 0 }, uShMode: { value: 0 } }
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: shadowCacheFragment(lonSpan, mapWidth, deepest, envOn),
      uniforms: {
        ...passUniforms, ...own,
        uShLevel: { value: 0 }, uShTile: { value: new THREE.Vector2() }, uShBand: { value: new THREE.Vector2(BAND_LO, BAND_HI) },
      },
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    })
    const mesh = new THREE.Mesh(fullscreenTriangle(), this.material)
    mesh.frustumCulled = false
    this.scene.add(mesh)
    const bytes = textureBytes(H_SIZE, H_SIZE, envOn ? 4 : 2, { layers: this.layerCount }) + this.fadeData.byteLength
    this.stats.gpuBytes = bytes
    this.stats.layers = tileLayers
    this.stats.cacheLayers = this.layerCount
    ledger.set('tiles', this.ledgerKey, bytes)
    this.searchQ = q.toString()
    this.stats.precompile = shPrecompileOn(this.searchQ)
    if (this.stats.precompile) this.precompile()
    else this.compiled = true
  }

  /**
   * Checks the framebuffer and starts the background compile, with the cache array bound: three keys a program by the target (colour space, tone
   * mapping), so a compile against the canvas would be a different program (the pattern of PatchShadowCache.ensureMaterial). Binding allocates the
   * R16F array now rather than at the first build.
   */
  private precompile(): void {
    const r = this.renderer
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0
    try { this.stats.parallelCompile = r.extensions ? r.extensions.has('KHR_parallel_shader_compile') : null } catch { this.stats.parallelCompile = null }
    const prevTarget = r.getRenderTarget()
    const prevFace = r.getActiveCubeFace()
    const prevMip = r.getActiveMipmapLevel()
    let compiling: Promise<unknown> | null = null
    try {
      r.setRenderTarget(this.rt, 0)
      this.fbChecked = true
      const gl = r.getContext?.() as WebGL2RenderingContext | undefined
      if (gl && gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { this.fail(); return }
      compiling = typeof r.compileAsync === 'function' ? r.compileAsync(this.scene, this.camera) : null
    } catch { this.fail(); return } finally { r.setRenderTarget(prevTarget, prevFace, prevMip) }
    const done = () => {
      // Without KHR_parallel_shader_compile, compileAsync settles at once and three's first-use queries (getProgramInfoLog, the uniform table) would
      // still run inside the first build, each a synchronous round trip that waits for the whole GPU queue (110 ms on the L4 cold pass). The link was
      // issued at construction and is done by now, so they run here instead, between frames, where the queue is short. `?shwarm=0` skips this.
      if (shWarmOn(this.searchQ)) this.warm()
      this.compiled = true; this.stats.compileMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0
    }
    if (!compiling) { done(); return }
    compiling.then(done, () => { this.fail(); this.stats.compileMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0 })
  }

  private fail(): void { this.failed = true; this.stats.failed = true }

  /** Runs three's first-use step for the build program now (error checks, the uniform and attribute tables); a program that failed to link fails the cache. */
  private warm(): void {
    try {
      const props = this.renderer.properties?.get(this.material) as { currentProgram?: { program?: WebGLProgram; getUniforms(): unknown } } | undefined
      const prog = props?.currentProgram
      if (!prog) return
      prog.getUniforms()
      const gl = this.renderer.getContext?.() as WebGL2RenderingContext | undefined
      if (gl && prog.program && gl.getProgramParameter(prog.program, gl.LINK_STATUS) === false) this.fail()
    } catch { /* the first build does it */ }
  }

  /**
   * Per frame, after the streamer's update and before the Moon is drawn: drop the layers whose Sun is no longer the current one, build some
   * when the Sun has settled, advance the fades and upload them. True while this wants more frames (builds pending or fading).
   */
  update(tiles: CacheTiles, e: Ephemeris, now: number, opts: ShadowCacheOpts = {}): boolean {
    if (this.failed) return false
    const c0 = typeof performance !== 'undefined' ? performance.now() : 0
    const wants = this.updateInner(tiles, e, now, opts)
    const c1 = typeof performance !== 'undefined' ? performance.now() - c0 : 0
    this.stats.updateCalls++; this.stats.updateMsTotal += c1; if (c1 > this.stats.updateMsMax) this.stats.updateMsMax = c1
    return wants
  }

  /** Compact state used by deterministic capture to detect an in-progress shadow fade. */
  captureFadeSignature(): number {
    let hash = 2166136261
    for (let i = 0; i < this.fadeData.length; i += 4) {
      const a = Math.round(this.fadeData[i + 1] * 1000), b = Math.round(this.fadeData[i + 3] * 1000)
      hash = Math.imul(hash ^ a ^ (b << 10) ^ i, 16777619)
    }
    return hash >>> 0
  }

  /** True only after builds, neighbour invalidations, fades and Sun settling are all complete. */
  captureIdle(now = performance.now()): boolean {
    return !this.failed && !this.wasBusy && this.stats.pendingBuild === 0 && !this.stats.sunMoving &&
      now - this.lastChangeAt >= QUIET_MS && now - this.lastSunMoveAt >= SETTLE_MS &&
      !this.awaiting && !this.awaitingFade && this.state.every((s) => !s.dirty && !s.old)
  }

  /** Index into `cen` of the layer's tile centre, computed when the layer's tile changed (level, tx, ty) since it was last asked. */
  private centreOf(layer: number, level: number, tx: number, ty: number): number {
    const k = 3 * layer, key = this.cenKey
    if (key[k] !== level || key[k + 1] !== tx || key[k + 2] !== ty) {
      this.cenR[layer] = tileCentre(level, tx, ty, this.scratch2)
      this.cen[k] = this.scratch2.x; this.cen[k + 1] = this.scratch2.y; this.cen[k + 2] = this.scratch2.z
      key[k] = level; key[k + 1] = tx; key[k + 2] = ty
    }
    return k
  }

  private updateInner(tiles: CacheTiles, e: Ephemeris, now: number, opts: ShadowCacheOpts): boolean {
    tiles.trackChanges = true
    const sun = this.sunB.set(e.sunDir.dot(e.moonX), e.sunDir.dot(e.moonY), e.sunDir.dot(e.moonZ)).normalize()
    if (!this.haveSun) { this.prevSunB.copy(sun); this.haveSun = true }
    const step = sun.angleTo(this.prevSunB)
    if (step > MOVING_RAD) {
      this.lastSunMoveAt = now; this.awaiting = true; this.awaitingVis = true; this.awaitingFade = true; this.burst = true
      if (opts.fixedPolicy) { this.fixedEpoch++; for (const st of this.state) this.cancelJob(st) }
    }
    this.fixedPolicy = opts.fixedPolicy === true
    this.fixedBudgetMs = opts.fixedBudgetMs ?? FIXED_BUILD_MS[this.cls]
    this.prevSunB.copy(sun)
    const dt = this.lastNow < 0 ? 0 : Math.max(0, Math.min(100, now - this.lastNow))
    this.lastNow = now
    const prevFrameMs = this.frameMs
    this.lastDt = dt
    if (dt > 0 && this.wasBusy) { this.frameMs = 0.8 * this.frameMs + 0.2 * dt; this.peakMs = Math.max(dt, this.peakMs * 0.98) }
    // Clock drift: the live clock's tick, small. Anything else (a drag, a slider, a seek) is interactive and never shown stale.
    const drift = opts.drift === true && step <= DRIFT_STEP_MAX_RAD
    this.stats.sunMoving = now - this.lastSunMoveAt < SETTLE_MS
    this.pollQueries()
    this.fence?.poll(now)
    // Fast path while the Sun is moved interactively and no cache layer is held (a Sun drag, the time slider: every layer was dropped to the live march at the
    // first move): nothing can serve and nothing can build until the Sun settles, so the per-frame slot walk, the neighbour dirtying and the todo list are
    // skipped. update() cost 0.24 ms a frame there on the rig (about 1.2 ms on a phone CPU est.), a few points of presented fps in drag-sun-turn.
    if (this.stats.sunMoving && this.free.length === this.layerCount) {
      if (tiles.takeChanges().changes.length) this.lastChangeAt = now
      this.shaderOn = false
      this.stats.serving = 0; this.stats.built = 0; this.stats.buildsLastFrame = 0; this.stats.visibleUnmetBand = 0; this.stats.visibleWanted = 0; this.stats.visibleBuilt = 0; this.stats.visibleExact = 0
      this.wasBusy = true
      return true
    }
    const slots = tiles.cacheSlots()
    const ch = tiles.takeChanges()
    if (ch.changes.length || ch.overflow) this.lastChangeAt = now
    const c1 = this.scratch
    const stamp = ++this.liveStamp
    const liveAt = this.liveAt
    for (const s of slots) {
      if (s.layer >= this.tileLayers) continue
      liveAt[s.layer] = stamp
      const st = this.state[s.layer]
      if (st.gen !== s.gen) { this.reset(st); st.gen = s.gen; this.setFade(s.layer, st) }
    }
    for (let l = 0; l < this.tileLayers; l++) if (liveAt[l] !== stamp && this.state[l].gen !== -1) { const st = this.state[l]; this.reset(st); st.gen = -1; this.setFade(l, st) }
    // A tile arriving, leaving or finishing its fade changes the ground the march reads within 300 km. A layer at level L marches levels L and
    // coarser only (marchH reads lm..2), so a change at a FINER level (lower number) cannot touch it. The layers keep serving and rebuild
    // after QUIET_MS (into a spare, then a crossfade, so the swap does not pop).
    if (ch.overflow) { for (const s of slots) { const st = this.state[s.layer]; if (st && (st.cur || st.job)) { st.dirty = true; this.restartJob(st) } } if (slots.length) this.stats.terrainRev++ }
    else if (ch.changes.length) {
      for (const c of ch.changes) {
        const rc = tileCentre(c.level, c.tx, c.ty, c1)
        const reach = reachDeg(c.level, this.flatReach)
        for (const s of slots) {
          const st = this.state[s.layer]
          // A fixed-policy job whose ground changed mid-build restarts (never published as a mix of terrain states): job-only layers and already-dirty ones with a job count.
          if (!st || (!st.cur && !st.job) || (st.dirty && !st.job) || c.level < s.level) continue
          // A tile's own arrival, fade completion or re-page (an unparked slot) does not change the ground ITS OWN layer was built from.
          if (c.level === s.level && c.tx === s.tx && c.ty === s.ty) continue
          // angle(c, s) < rc + rs + reach, as a dot against a cosine: no acos, and the slot's centre comes from the per-layer cache (no trig per pair).
          const k = this.centreOf(s.layer, s.level, s.tx, s.ty)
          const lim = (rc + this.cenR[s.layer] + reach) * RAD
          if (lim >= Math.PI || c1.x * this.cen[k] + c1.y * this.cen[k + 1] + c1.z * this.cen[k + 2] > Math.cos(lim)) { st.dirty = true; this.restartJob(st); this.stats.terrainRev++ }
        }
      }
    }
    // Validity against THIS frame's Sun. A build matching it within SUN_TOL is current. During clock drift a build is also kept (stale, then
    // rebuilt and crossfaded) while within DRIFT_TOL and for at most STALE_MAX_MS; otherwise it is dropped now, before the draw: fade 0, the
    // shader marches live.
    let staleShown = false
    for (const s of slots) {
      const st = this.state[s.layer]
      if (!st) continue
      for (const which of ['cur', 'old'] as const) {
        const b = st[which]
        if (!b) continue
        const dot = b.sx * sun.x + b.sy * sun.y + b.sz * sun.z
        // Inside the tolerance (almost every build, every frame): a dot against its cosine; the angle itself only for a build that is off.
        if (dot >= COS_SUN_TOL) { b.staleSince = -1; continue }
        const d = Math.acos(Math.max(-1, Math.min(1, dot)))
        if (d <= SUN_TOL_RAD) { b.staleSince = -1; continue }
        if (b.staleSince < 0) b.staleSince = now
        if (drift && d <= DRIFT_TOL_RAD && now - b.staleSince <= STALE_MAX_MS) { staleShown = true; continue }
        this.release(b)
        st[which] = null
        this.stats.invalidated++
      }
      if (!st.cur && st.old) { st.cur = st.old; st.old = null }
    }
    if (staleShown) this.stats.staleServedFrames++
    // What wants a build: faded-in tiles the shader reads for shading with some of their area in the Sun band, with no layer yet (fresh), whose
    // layer is for another Sun (sun) or whose neighbourhood changed (dirty). Tiles wholly under a fused-ground patch are never read, so never built.
    const still = now - this.lastSunMoveAt >= SETTLE_MS
    const quiet = now - this.lastChangeAt >= QUIET_MS
    if (quiet) this.freshWaitFrom = -1
    else if (this.freshWaitFrom < 0) this.freshWaitFrom = now
    const freshOk = quiet || (this.freshWaitFrom >= 0 && now - this.freshWaitFrom >= FRESH_QUIET_MAX_MS)
    const siteOn = (this.passUniforms.uPatchBlend?.value as number) * (this.passUniforms.uPatchGround?.value as number) > 0
    const site = siteOn ? (this.passUniforms.uPSite.value as THREE.Vector3) : null
    const todo: Array<{ layer: number; level: number; tx: number; ty: number; kind: 0 | 1 | 2; keep: number; skip?: boolean; visited?: boolean }> = []
    let olds = 0
    const stampU = ++this.updateStamp
    const fixed = this.fixedPolicy
    for (const s of slots) {
      const st = this.state[s.layer]
      if (!st) continue
      if (st.old) olds++
      // A partial job on a tile that stopped being a build candidate (parked, no longer shaded, out of the Sun band, under a patch) gives its cache layer back now.
      if (!s.full || !s.shade) { if (fixed) this.reclaimJob(st); continue }
      let kind: 0 | 1 | 2
      if (!st.cur) kind = 0
      else if (st.cur.staleSince >= 0) kind = 1
      else if (st.dirty) kind = 2
      else continue
      const r = tileCentre(s.level, s.tx, s.ty, c1)
      const elev = Math.asin(Math.max(-1, Math.min(1, c1.dot(sun)))) / RAD
      if (elev + r < SKIP_LO || elev - r > SKIP_HI) { if (fixed) this.reclaimJob(st); continue }
      if (site && Math.acos(Math.max(-1, Math.min(1, c1.dot(site)))) + r * RAD < PATCH_CLEAR_RAD) { if (fixed) this.reclaimJob(st); continue }
      this.wantStamp[s.layer] = stampU
      todo.push({ layer: s.layer, level: s.level, tx: s.tx, ty: s.ty, kind, keep: s.keep })
    }
    // Never build inside a frame that is already over budget: a stalled previous frame, or a CPU part of this one that already ran long.
    // A gap after an idle stretch (the loop asked for no frame) is not a slow frame: only an interval between frames that were requested counts.
    const stalled = this.wasBusy && this.lastDt > Math.max(OVER_FRAME_MIN_MS[this.cls], OVER_FRAME_X * prevFrameMs)
    const cpuOver = opts.frameStart !== undefined && now - opts.frameStart > OVER_CPU_MS[this.cls]
    const over = !opts.catchUp && !opts.capture && (stalled || cpuOver)
    // A frame that is over budget defers the build, but never forever: a loop that keeps asking for frames (builds pending) while every one of them is
    // deferred redraws the live march at full price and never gets cheaper. After DEFER_STREAK_MAX deferrals in a row one small build goes ahead.
    const starved = over && this.deferStreak >= DEFER_STREAK_MAX
    // The build program is compiling in the background: wait for it (a build now would link it synchronously), but at most COMPILE_WAIT_MS of frames.
    let compiled = this.compiled
    if (!compiled && todo.length) {
      if (this.compileWaitFrom < 0) this.compileWaitFrom = now
      if (now - this.compileWaitFrom >= COMPILE_WAIT_MS) { this.compiled = compiled = true; this.stats.compileFallback = true }
    }
    const canBuild = compiled && still && !opts.motion && (!over || starved)
    if (over && still && !opts.motion && todo.length) { this.stats.deferredOver++; if (!starved) this.deferStreak++ }
    const budget = this.fixedPolicy
      ? fixedBlockBudget(this.fixedBudgetMs, this.msPerLayer > 0 ? this.msPerLayer / FIXED_BLOCKS : 0, this.timer ? 0 : this.fence?.perBlockMs ?? 0, FIXED_BLOCK_FLOOR_MS[this.cls], opts.maxBlocks)
      : starved ? Math.min(STARVED_LAYERS, this.layersThisFrame(false)) : this.layersThisFrame(canBuild && (this.burst || !!opts.catchUp))
    this.stats.budgetLayers = budget
    // Fresh builds first, by how central the tile is in the frame (keep: lower is more on screen), then the Sun's, then the neighbours'.
    if (this.fixedPolicy) {
      // Visible demand first, then jobs already started (finish what holds a layer), then round-robin across the rest so continuous camera motion cannot pin work to one centre tile.
      const visRank = (t: { keep: number; level: number }): number => (t.keep - 0.25 * t.level <= VISIBLE_CENTRE ? 0 : 1)
      todo.sort((a, b) => visRank(a) - visRank(b) || (this.state[b.layer].job ? 1 : 0) - (this.state[a.layer].job ? 1 : 0) ||
        ((a.layer - this.fixedCursor + this.tileLayers) % this.tileLayers) - ((b.layer - this.fixedCursor + this.tileLayers) % this.tileLayers))
    } else todo.sort((a, b) => a.kind - b.kind || a.keep - b.keep || a.level - b.level)
    let built = 0
    let workUnits = 0
    let queryOpen = false
    // Fixed policy keeps spare layers back from fresh builds while visible replacements (a Sun or terrain change on an already cached tile) wait for one.
    let reserve = 0
    if (fixed) { for (const t of todo) if (t.kind > 0 && t.keep - 0.25 * t.level <= VISIBLE_CENTRE) reserve++; reserve = Math.min(reserve, SPARE_LAYERS[this.cls]) }
    for (const t of todo) {
      if (!canBuild || (this.fixedPolicy ? workUnits >= budget : built >= budget)) break
      t.visited = true
      if (t.kind === 2 && !quiet) { this.rejected[t.layer] = 'terrain-quiet-wait'; continue }
      const st = this.state[t.layer]
      if (fixed && t.kind === 0 && !st.job && !freshOk) { this.rejected[t.layer] = 'terrain-streaming'; continue }
      // A replacement needs a spare, and a layer still fading its last one in waits for it.
      if (t.kind > 0 && (st.old || (st.cur && st.cur.w < 1) || olds >= SPARE_LAYERS[this.cls])) { this.rejected[t.layer] = 'spare-wait'; continue }
      let idx = st.job?.idx
      let reserved = false
      if (idx === undefined) { if (fixed && t.kind === 0 && reserve > 0 && this.free.length <= reserve) reserved = true; else idx = this.free.pop() }
      if (idx === undefined) {
        // The class memory cap holds fewer cache layers than there are tiles: a more on-screen tile takes the layer of the least on-screen built one
        // (that one goes back to the live march), so the visible set is cached first and the cap never leaves the screen uncached for tiles off it.
        // A replacement (Sun drift, changed neighbour) may only take the layer of a parked build (not full: kept by TileStreamer.park, nothing draws it),
        // else parked builds holding every spare would starve every rebuild.
        // Fixed policy also reclaims the unfinished job of a less visible uncached tile (its slot is held and serves nothing).
        let victim = -1, worst = t.kind === 0 ? t.keep + EVICT_MARGIN : -Infinity
        for (const s of slots) {
          const v = this.state[s.layer]
          if (!v || s.layer === t.layer) continue
          const jobOnly = fixed && !!v.job && !v.cur
          const floor = jobOnly ? Math.max(worst, t.keep + EVICT_MARGIN) : worst
          if ((jobOnly || (v.cur && !v.old && (t.kind === 0 || !s.full))) && s.keep > floor) { worst = s.keep; victim = s.layer }
        }
        if (victim >= 0) {
          const v = this.state[victim]
          if (v.cur) { this.release(v.cur); v.cur = null; v.dirty = false; this.stats.evictedForCap++ } else this.stats.jobsReclaimed++
          this.cancelJob(v)
          idx = this.free.pop()
        }
      }
      if (idx === undefined) {
        t.skip = true; this.skipStamp[t.layer] = stampU
        if (reserved) this.rejected[t.layer] = 'reserved-for-replacement'
        else { this.rejected[t.layer] = 'no-slot'; this.stats.capacityFailures++ }
        continue
      }
      if (!queryOpen) queryOpen = this.beginQuery(opts.frameQuery)
      if (this.fixedPolicy) {
        let job = st.job
        if (!job) job = st.job = { idx, epoch: this.fixedEpoch, next: 0, sx: sun.x, sy: sun.y, sz: sun.z, terrain: this.stats.terrainRev, startedAt: now }
        if (!shadowJobCanPublish(job.epoch, this.fixedEpoch)) { this.cancelJob(st); continue }
        let ok = true
        if (job.next < FIXED_BLOCKS && workUnits < budget) {
          const bx = job.next % Math.ceil(H_SIZE / FIXED_BLOCK), by = Math.floor(job.next / Math.ceil(H_SIZE / FIXED_BLOCK))
          const x = bx * FIXED_BLOCK, y = by * FIXED_BLOCK
          const w = Math.min(FIXED_BLOCK, H_SIZE - x), h = Math.min(FIXED_BLOCK, H_SIZE - y)
          if (!this.build(idx, t.level, t.tx, t.ty, { x, y, w, h })) { ok = false; this.rejected[t.layer] = 'build-failed'; break }
          job.next++; workUnits++; this.rejected[t.layer] = 'in-progress'
          this.fixedCursor = (t.layer + 1) % this.tileLayers
        }
        if (!ok) { this.cancelJob(st); break }
        if (job.next < FIXED_BLOCKS) continue
        st.job = null
        if (st.cur) { st.old = st.cur; olds++ }
        st.cur = { idx: job.idx, sx: job.sx, sy: job.sy, sz: job.sz, w: st.cur ? 0 : 1, staleSince: -1 }
        st.dirty = false
        this.rejected[t.layer] = ''
        built++
      } else {
        if (!this.build(idx, t.level, t.tx, t.ty)) { this.free.push(idx); break }
        if (st.cur) { st.old = st.cur; olds++ }
        st.cur = { idx, sx: sun.x, sy: sun.y, sz: sun.z, w: st.cur ? 0 : 1, staleSince: -1 }
        st.dirty = false
        built++; workUnits++
      }
      // A first build over the live march shows at once: the live and cached edges differ by under half a pixel, and a fade would run BOTH the live march and
      // the cache read for 250 ms (a rest frame at the terminator costs the live march again, 57 ms on the L4, 4-5 frames of it). Only a replacement for a layer
      // that is already cached (clock drift, a changed neighbour) crossfades, and that costs two cheap cache reads.
      if (t.kind === 0) this.stats.buildsFresh++
      else if (t.kind === 1) this.stats.buildsSun++
      else this.stats.buildsDirty++
    }
    if (this.diagnostics) {
      const why = !compiled ? 'compile-pending' : !still ? 'sun-moving' : opts.motion ? 'camera-motion' : over && !starved ? 'over-frame-budget' : 'frame-budget'
      for (const t of todo) if (!t.visited) this.rejected[t.layer] = why
    }
    if (queryOpen) this.endQuery(this.fixedPolicy ? workUnits : built, opts.frameQuery, this.fixedPolicy)
    else if (this.fixedPolicy && !this.timer && workUnits > 0) this.fence?.mark(workUnits, performance.now())
    if (opts.catchUp && !opts.motion) { this.stats.catchUpFrames++; this.stats.catchUpLayers += built }
    // The burst is spent by the first frame that builds (a frame that could build but found every layer blocked keeps it for the next).
    if (built > 0) { this.burst = false; this.deferStreak = 0 }
    else if (!todo.length || opts.motion) this.deferStreak = 0
    // Fades: the newest build rises, the one it replaces falls by the same amount (a crossfade, total share 1), then its layer is returned.
    let fading = false
    let nBuilt = 0, nServing = 0, visW = 0, visB = 0, visExact = 0, blockedVis = 0, sig = 2166136261
    if (this.diagnostics) this.tileDiag.length = 0
    for (const s of slots) {
      const st = this.state[s.layer]
      if (!st) continue
      // Advance this tile's fade (and release the older build when it ends) BEFORE counting it: a count taken ahead of the final fade step would call a tile
      // not-yet-exact in the very update that finishes it, and the update that finishes the last fade asks for no further frame to repair it.
      const b = st.cur
      if (b) {
        if (b.w < 1) { b.w = Math.min(1, b.w + dt / FADE_MS); if (b.w < 1) fading = true }
        if (st.old) {
          st.old.w = Math.max(0, Math.min(st.old.w, 1 - b.w))
          if (b.w >= 1 || st.old.w <= 0) { this.release(st.old); st.old = null }
        }
        nBuilt++
        if (b.w > 0 && (s.full || st.old)) nServing++
      }
      if (s.full && s.shade && (fixed || s.keep - 0.25 * s.level <= VISIBLE_CENTRE)) {
        const r = tileCentre(s.level, s.tx, s.ty, c1)
        const elev = Math.asin(Math.max(-1, Math.min(1, c1.dot(sun)))) / RAD
        const inBand = elev + r >= SKIP_LO && elev - r <= SKIP_HI
        const underPatch = site && Math.acos(Math.max(-1, Math.min(1, c1.dot(site)))) + r * RAD < PATCH_CLEAR_RAD
        if (inBand && !underPatch) {
          visW++
          sig = Math.imul(sig ^ (s.layer * 4099 + s.gen), 16777619)
          if (st.cur) visB++
          const exact = !!st.cur && st.cur.staleSince < 0 && st.cur.w >= 1 && !st.old && !st.dirty
          if (exact) visExact++
          else {
            const blocked = this.skipStamp[s.layer] === stampU
            if (blocked) blockedVis++
            if (this.diagnostics && this.tileDiag.length < DIAG_MAX) {
              const j = st.job
              this.tileDiag.push({
                level: s.level, tx: s.tx, ty: s.ty, layer: s.layer, gen: s.gen, keep: s.keep, full: s.full, shade: s.shade,
                reason: blocked ? 'in-band,capacity-blocked' : 'in-band', dirty: st.dirty,
                curW: st.cur ? st.cur.w : -1, oldW: st.old ? st.old.w : -1,
                sunAgeMs: st.cur && st.cur.staleSince >= 0 ? now - st.cur.staleSince : -1,
                job: j ? { epoch: j.epoch, next: j.next, ageMs: now - j.startedAt } : null,
                rejected: this.rejected[s.layer],
              })
            }
          }
        }
      }
      this.setFade(s.layer, st)
    }
    if (this.fadeDirty) { this.fade.needsUpdate = true; this.fadeDirty = false }
    // Layers the Sun's position (not a neighbour) asks for and that are not yet current: when none is left and every one is shown, the Sun's move is "cached".
    this.stats.cappedOut = 0
    let unmet = 0, ready = 0, shown = true, unmetVis = 0, shownVis = true
    for (const t of todo) {
      if (t.skip) { this.stats.cappedOut++; continue } // no cache layer left under the class cap and nothing less visible to give one up: this tile stays on the live march
      const c = this.state[t.layer].cur
      const vis = fixed || t.keep - 0.25 * t.level <= VISIBLE_CENTRE
      if (t.kind < 2 && (!c || c.staleSince >= 0)) { unmet++; if (vis) unmetVis++ }
      if (t.kind < 2 && (!c || c.w <= 0)) { shown = false; if (vis) shownVis = false }
      if (t.kind < 2 || quiet) ready++
    }
    if (this.awaitingVis && still && unmetVis === 0 && shownVis) { this.stats.timeToCachedMs = now - this.lastSunMoveAt; this.stats.cachedEvents++; this.awaitingVis = false }
    if (this.awaiting && still && unmet === 0 && shown) { this.stats.timeToCachedAllMs = now - this.lastSunMoveAt; this.awaiting = false }
    if (this.awaitingFade && !this.awaiting && !fading && still) { this.stats.timeToFadedMs = now - this.lastSunMoveAt; this.stats.fadedEvents++; this.awaitingFade = false }
    this.stats.built = nBuilt
    this.stats.visibleWanted = visW
    this.stats.visibleBuilt = visB
    this.stats.visibleExact = visExact
    this.stats.visibleNotExact = visW - visExact
    this.stats.capacityBlockedVisible = blockedVis
    this.stats.demandSig = sig >>> 0
    this.stats.visibleUnmetBand = unmetVis
    this.stats.serving = nServing
    this.shaderOn = this.readOn && nServing > 0
    this.stats.buildsLastFrame = built
    this.stats.buildsTotal += built
    this.stats.pendingBuild = Math.max(0, ready - built)
    this.stats.msPerLayer = this.msPerLayer
    this.stats.failed = this.failed
    // Wants more frames: layers fading, builds it can do now, or builds waiting for the Sun or the neighbours to settle (not for camera motion: that ends on its own).
    // An over-budget frame still asks for the next one: the deferred build runs there.
    // Settlement is keyed by the Sun epoch, the terrain revision and the visible-demand set: any of them changing starts a new clock, and the latch drops when a tile stops being exact.
    if (this.fixedPolicy) {
      const key = `${this.fixedEpoch}:${this.stats.terrainRev}:${this.stats.demandSig}`
      if (key !== this.settleKey) { this.settleKey = key; this.settleKeyAt = now; this.stats.settledMs = -1 }
      else if (this.stats.settledMs < 0) { if (visW === visExact && !fading && still) this.stats.settledMs = now - this.settleKeyAt }
      else if (visW !== visExact) { this.stats.settledMs = -1; this.settleKeyAt = now }
    }
    const wants = fading || (this.stats.pendingBuild > 0 && still && !opts.motion) || (todo.length > 0 && !(still && quiet))
    this.wasBusy = wants
    return wants
  }

  /**
   * How many layers this frame may build: a fixed count (?shbudget), or the device's GPU-time budget over a layer's measured time. The budget
   * grows with the frame time (a frame costing 100 ms can spare 20 ms for builds, which then finish the visible set in two frames rather than
   * seven), up to 4x the base, so a slow device is not the one that waits longest for its cache.
   */
  /** Visible layers a build can still supply (in the Sun band, not under a patch, not class-capped, none built or stale), as of the last update(): what a rest catch-up has left to build. */
  visibleUnmet(): number { return this.stats.visibleUnmetBand }

  private layersThisFrame(burst: boolean): number {
    if (this.fixedBudget > 0) return this.fixedBudget
    const n = this.layersRaw(burst)
    if (!this.shfix) return n
    const capped = Math.max(1, Math.min(n, MAX_BUILDS_DESKTOP))
    // Catch-up (issue #64): between a Sun stop and the visible set being cached, a desktop frame that is within budget builds up to the cap rather than
    // the rest-frame budget. The rest budget (5 ms over a floored 1.5 ms layer = 3 layers) needed ~37 frames for the ~111 visible layers at the
    // terminator (440-830 ms on the L4, ~620 ms at 60 Hz); the cap is what the burst frame already spends. A frame over OVER_FRAME_BUDGET_MS gets none.
    if (!burst && this.cls === 'desktop' && this.awaitingVis && this.frameMs <= OVER_FRAME_BUDGET_MS) return MAX_BUILDS_DESKTOP
    return capped
  }

  private layersRaw(burst: boolean): number {
    const measured = this.msPerLayer > 0 ? (this.shfix ? Math.max(this.msPerLayer, MS_PER_LAYER_FLOOR[this.cls]) : this.msPerLayer) : this.msPerLayer
    if (burst && this.timer !== null) {
      const per0 = measured > 0 ? measured : GUESS_MS_PER_LAYER[this.cls]
      // A layer's time that no timer query has measured (the rig's reads 0) is a guess, so the burst takes half its time: two frames at most, never one that
      // lands 4x over when the GPU is still at idle clocks (rig 2026-10-07: 60 layers cost 35 ms warm, ~120 ms cold).
      const full = Math.min(BURST_CAP_MS[this.cls], Math.max(BURST_MS[this.cls], 0.5 * this.peakMs))
      const ms = measured > 0 ? full : full / 2
      return Math.max(1, Math.min(MAX_LAYERS_PER_FRAME, Math.floor(ms / per0)))
    }
    if (burst) return 4 * FALLBACK_LAYERS[this.cls]
    // The budget grows with the frame time only once a layer's cost is measured: a guess times a growth factor fed by the slow frames it causes is a loop.
    // Grow with frame time once a layer is measured, or always on the no-timer path (it can never measure, so the fixed fallback scales as before).
    // term-fix C: no growth while the frame is already over budget (that is the positive feedback: slow frames from builds buy more builds).
    const grow = measured > 0 || this.timer === null ? (this.shfix && this.frameMs > OVER_FRAME_BUDGET_MS ? 1 : Math.max(1, Math.min(4, 0.3 * this.frameMs / BUDGET_MS[this.cls]))) : 1
    if (this.timer === null) return Math.round(FALLBACK_LAYERS[this.cls] * grow)
    const per = measured > 0 ? measured : GUESS_MS_PER_LAYER[this.cls]
    return Math.max(1, Math.min(MAX_LAYERS_PER_FRAME, Math.floor(BUDGET_MS[this.cls] * grow / per)))
  }

  private beginQuery(frame?: { suspend(): void; resume(): void }): boolean {
    const t = this.timer
    if (!t || this.queries.length >= 6) return false
    let suspended = false
    try {
      const gl = this.renderer.getContext() as WebGL2RenderingContext
      // One TIME_ELAPSED query can be active. The frame timer holds one around the whole frame on every path with a timer query, so without ending it
      // here the cache's builds were never measured (msPerLayer stayed -1 on the desktop): the frame query is ended for the builds and resumed after.
      if (gl.getQuery(t.TIME_ELAPSED_EXT, gl.CURRENT_QUERY) && frame) { frame.suspend(); suspended = true }
      if (gl.getQuery(t.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) { if (suspended) frame!.resume(); return false }
      const q = gl.createQuery()
      if (!q) { if (suspended) frame!.resume(); return false }
      gl.beginQuery(t.TIME_ELAPSED_EXT, q)
      this.queries.push({ q, n: 0, blocks: false })
      return true
    } catch { if (suspended) frame!.resume(); return false }
  }
  private endQuery(n: number, frame?: { suspend(): void; resume(): void }, blocks = false): void {
    const t = this.timer
    if (!t) return
    try {
      const gl = this.renderer.getContext() as WebGL2RenderingContext
      gl.endQuery(t.TIME_ELAPSED_EXT)
      const last = this.queries[this.queries.length - 1]
      if (last) { last.n = n; last.blocks = blocks }
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
          const measured = (gl.getQueryParameter(h.q, gl.QUERY_RESULT) as number) / 1e6 / h.n
          const ms = h.blocks ? measured * FIXED_BLOCKS : measured
          this.msPerLayer = this.msPerLayer < 0 ? ms : 0.7 * this.msPerLayer + 0.3 * ms
        }
        gl.deleteQuery(h.q)
        this.queries.shift()
      }
    } catch { this.queries.length = 0 }
  }

  /** A build's cache layer goes back to the pool. */
  private release(b: Buf): void { b.w = 0; this.free.push(b.idx) }

  private reset(st: LayerState): void {
    this.cancelJob(st)
    if (st.cur) this.release(st.cur)
    if (st.old) this.release(st.old)
    st.cur = null; st.old = null; st.dirty = false
  }

  /** Fixed policy: gives back the cache layer of a partial job whose tile is no longer a build candidate. */
  private reclaimJob(st: LayerState): void {
    if (!st.job) return
    this.cancelJob(st)
    this.stats.jobsReclaimed++
  }

  /** Fixed policy: terrain this job depends on changed, so its blocks (some built from the old ground) are dropped and it starts over; never published as a mix. */
  private restartJob(st: LayerState): void {
    if (!st.job) return
    this.cancelJob(st)
    this.stats.jobRestarts++
  }

  /** Cache-layer pool totals for the dev diagnostic (computed on demand from the state, no side effects). */
  poolStats(): ShadowPoolDiag {
    let current = 0, old = 0, partial = 0, abandoned = 0
    for (let l = 0; l < this.tileLayers; l++) {
      const st = this.state[l]
      if (st.cur) current++
      if (st.old) old++
      if (st.job) { partial++; if (this.wantStamp[l] !== this.updateStamp) abandoned++ }
    }
    return {
      capacity: this.layerCount, free: this.free.length, current, old, partial, abandoned,
      capacityFailures: this.stats.capacityFailures, evictions: this.stats.evictedForCap, jobsReclaimed: this.stats.jobsReclaimed, jobRestarts: this.stats.jobRestarts,
    }
  }

  private cancelJob(st: LayerState): void {
    if (!st.job) return
    this.free.push(st.job.idx)
    st.job = null
  }

  /** Writes a tile layer's fade texel: (cache layer of the newest build, its share, cache layer of the older one, its share). */
  private setFade(layer: number, st: LayerState): void {
    const o = 4 * layer
    const d = this.fadeData
    const a = st.cur, b = st.old
    const v0 = a ? a.idx : -1, v1 = a ? a.w : 0, v2 = b ? b.idx : -1, v3 = b ? b.w : 0
    if (d[o] === v0 && d[o + 1] === v1 && d[o + 2] === v2 && d[o + 3] === v3) return
    d[o] = v0; d[o + 1] = v1; d[o + 2] = v2; d[o + 3] = v3
    this.fadeDirty = true
  }

  /** Draws one tile's horizons into cache layer `idx`. False when its framebuffer cannot be rendered to (the cache then turns itself off). */
  private build(idx: number, level: number, tx: number, ty: number, block?: { x: number; y: number; w: number; h: number }): boolean {
    const r = this.renderer
    const prevTarget = r.getRenderTarget()
    const prevFace = r.getActiveCubeFace()
    const prevMip = r.getActiveMipmapLevel()
    const prevAuto = r.autoClear
    const u = this.material.uniforms
    u.uShLevel.value = level
    ;(u.uShTile.value as THREE.Vector2).set(tx, ty)
    r.autoClear = false
    if (block) { this.rt.scissor.set(block.x, block.y, block.w, block.h); this.rt.scissorTest = true }
    r.setRenderTarget(this.rt, idx)
    if (!this.fbChecked) {
      this.fbChecked = true
      const gl = r.getContext?.() as WebGL2RenderingContext | undefined
      if (gl && gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        this.fail()
        r.setRenderTarget(prevTarget, prevFace, prevMip)
        r.autoClear = prevAuto
        if (block) this.rt.scissorTest = false
        return false
      }
    }
    r.render(this.scene, this.camera)
    r.setRenderTarget(prevTarget, prevFace, prevMip)
    r.autoClear = prevAuto
    if (block) this.rt.scissorTest = false
    return true
  }

  /** The frame loop's reaction to a failed cache (framebuffer incomplete, compile rejected): detach it from the Moon pass so the shader marches live,
   *  dispose it and stop the tile change feed. True when it was detached (the caller drops its reference). */
  detachIfFailed(moon: { setShadowCache(c: null): void }, tiles: { trackChanges: boolean } | null): boolean {
    if (!this.failed) return false
    moon.setShadowCache(null)
    this.dispose()
    if (tiles) tiles.trackChanges = false
    return true
  }

  /** Every layer is dropped (a lost context, or the tile set replaced). */
  dispose(lost = false): void {
    ledger.release('tiles', this.ledgerKey)
    for (const q of this.queries) { try { (this.renderer.getContext() as WebGL2RenderingContext).deleteQuery(q.q) } catch { /* ignore */ } }
    this.queries.length = 0
    if (!lost) { this.rt.dispose(); this.fade.dispose(); this.material.dispose() }
  }
}
