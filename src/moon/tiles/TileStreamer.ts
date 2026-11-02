import * as THREE from 'three'
import { FailureBook, isPermanentFailure, settleJob } from './jobBook'
import { HttpError, isTransient } from '../../net/load'
import { CpuGate } from './CpuGate'
import { withTightUnpack, type PixelStoreState } from './unpack'
import { loadManifest, prefetcherFor, type PrefetchTarget } from '../../net/prefetch'
import { gunzipIfNeeded } from './codec'
import { decodeTileHeights, prepareColour } from './tileDecode'
import { TilePool, WorkerUnavailable, createTilePool } from './tilePool'
import { span as perfSpan, add as perfAdd } from '../../perf/perf'
import { span } from '../../perf/perf'
import { ABL } from '../../abl'
import { fadeBatchMs, fadeInFrom, fadeInLevel, fadeOutLevel, fadeOutOn, fadeStartAt } from './fades'
import { focusPullOn, tileFadeMs, PENDING_MARK, SIGMA_PER_LACK, buildFocusRays, measureCoarse, markStrength, release, releaseMark, RELEASE_FLOOR, type FocusRays, type CoarseMeasure } from './focusPull'
import { type StreamView, type Want, WANT_TEXELS, GLOBAL_TEXEL_KM, sharedRaySamples, SAMPLES_X, SAMPLES_Y, uploadsThisFrame, inflightCap, boundGrid, computeWanted, cutWantedSplit, wantResidency, wantedMemoKey, wantedMemoValid, FLIGHT_WANTED_MS, mayPump, takeReady } from './wanted'
import { ParkWake, parkMsOf, parkingOn } from './capacity'
import { neighbourMask } from './feather'
import { GpuGroup } from '../../quality/track'
import { textureBytes } from '../../quality/ledger'
import { colorMips } from './colorMips'
import { ReliefStore } from './relief'
import {
  C_SIZE, H_SIZE, H_STEP_M, H_TEXEL_KM, TILE_LEVELS, colorPath, heightPath,
  levelNx, levelNy, pageWidth, tileIndex, tileOf, type TileManifest,
} from './grid'
import { DetailStreamer, readableDetail } from './DetailStreamer'
import { TcStreamer } from './TcStreamer'
import { detailStrength } from './detail'
import { type DeeperEntry, type PathPoint, pathTargets, deeperPresent, deepestOf, levelRow, pageRows } from './levels'
import { abortAllJobs, abortEverywhere } from './abortJobs'

/** The manifest as the streamer reads it: the built three levels plus an optional `deeper` block (TILE-CONTRACT.md 1b). */
type Man = TileManifest & { deeper?: DeeperEntry[] }

/**
 * Streams the milestone-2 tiles into two texture arrays (heights R16F, colour
 * sRGB8_ALPHA8) and a page table the Moon shader reads (moonShader.ts).
 *
 * - The page table (RGBA32F, levels stacked; wider and taller when the manifest has deeper levels) holds, per tile,
 *   r = cache layer + 1 (0 = not resident), g = fade-in 0..1 and, for a deeper tile, b = bits of the absent neighbours (feather.ts) and
 *   a = the tile's mid height in metres (its heights are stored minus it: half float is exact to the metre only inside +-2048 m).
 *   Only the texels that changed are uploaded (addUpdateRange): the table is 5 MB with a -3 level.
 * - Two caches share the layer index: the heights array has `capacity` layers, the colour array only the first `colourCapacity`. The built
 *   levels carry colour and take a layer below that; deeper tiles are heights only (colour is the level-0 map's) and use the layers past it.
 * - Each frame update() finds the tiles the camera needs (a grid of rays over
 *   the frame, the level chosen from the pixel footprint on the ground), asks
 *   for them coarsest first, each with its coarser ancestors as fallback, and
 *   evicts the least recently wanted tile when the cache is full.
 * - A tile becomes visible only when both its files have arrived; it fades in
 *   over the arrival fade so no hole or pop shows. Uploads are one tile per frame.
 * - Nothing here touches the network until the site is close enough for a
 *   tile to matter (main.ts calls TileStreamer.create then).
 *
 * The texture arrays are raw GL textures handed to three as ExternalTexture:
 * three only binds them, this class allocates and fills them (texSubImage3D
 * per layer), through renderer.state so three's binding cache stays true.
 */

const OPACITY_FADE_MS = 250
/** The arrival fade: 250 ms of opacity, or with the focus pull on (the default; `?focuspull=0` off) the 350 ms focus-pull ramp (focusPull.ts); the colour is then defocused, not faded. */
const fadeMs = (): number => tileFadeMs(OPACITY_FADE_MS)
const MAX_INFLIGHT = 6
/** Keep enough tile jobs admitted during a scripted pass to match the ahead-prefetch workers. */
const MAX_INFLIGHT_FLIGHT = 12
const UNWANTED_ABORT_MS = 1500
/** A tile that arrived with no layer to take waits this long before it is fetched again (upload). */
const DROP_RETRY_MS = 3_000
/** Height-only deeper tiles may take a colour layer only while this many stay free for the built levels. */
const COLOUR_RESERVE = 6
/** Comparison switch for the frame-paced tile CPU queue. */
const CPU_GATE = typeof location === 'undefined' || new URLSearchParams(location.search).get('cpugate') !== '0' 
/** `?park=0` keeps every uploaded tile paged until it is evicted (as first shipped); the default parks a tile that leaves the wanted set (capacity.ts parkingOn). */
const PARK_SWITCH = typeof location === 'undefined' || new URLSearchParams(location.search).get('park') !== '0'

export type { StreamView }

/** The most tile changes remembered for the shadow cache between two of its updates. */
const CHANGES_CAP = 512
interface Slot {
  layer: number
  key: number
  level: number
  tx: number
  ty: number
  lastWanted: number
  readyAt: number
  /** Holds a colour layer's data (so its layer is below colourCapacity). */
  colour: boolean
  /** Upload serial: a layer reused for another tile (or the same one again) has a new one, so a cache keyed to it knows its data changed. */
  gen: number
  /** The tile's mid height (page table w), kept so a parked slot can be paged again without its payload. */
  mid: number
  /** The tile's relief summary, kept so a parked slot leaves and rejoins the exposure search's store. */
  relief: Float32Array
  /** Left the wanted set: layer and data are kept, the page entry is cleared (nothing draws it), and the shadow cache's build for the layer stays. */
  parked: boolean
  /** Parked, but still paged while its fade falls from `leaveFrom` (set at `leaveAt`) to 0 (`?fadeout=0`: the entry is cleared at once and this stays false). */
  leaving: boolean
  leaveFrom: number
  leaveAt: number
}
interface Job {
  key: number
  level: number
  tx: number
  ty: number
  priority: number
  lastWanted: number
  abort: AbortController
  failedAt: number
}
interface Payload {
  job: Job
  /** Float32Array from the page's own decode; the Worker sends half-float bits (Uint16Array) unless `?half=0`. Same R16F contents either way. */
  heights: Float32Array | Uint16Array
  /** Mid height (m) taken off `heights` (0 for the built levels). */
  mid: number
  relief: Float32Array
  color: Uint8Array[]
}

/** Wait `ms`, or reject as soon as the job is aborted (an abandoned tile does not hold its retry timer). */
function sleepFor(ms: number, sig: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (sig.aborted) { reject(new DOMException('aborted', 'AbortError')); return }
    const t = setTimeout(() => { sig.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = (): void => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')) }
    sig.addEventListener('abort', onAbort, { once: true })
  })
}

/** One resident tile as the shadow cache sees it (see cacheSlots). */
export interface CacheSlot { layer: number; level: number; tx: number; ty: number; gen: number; full: boolean; shade: boolean; keep: number }

export { colorMips }

export class TileStreamer {
  /** Layers of the heights array (every resident tile holds one). */
  readonly capacity: number
  /** Layers of the colour array: the first `colourCapacity` layers of the heights array pair with it. Equal to `capacity` without deeper levels. */
  readonly colourCapacity: number
  /** Height layers the wanted set may fill (capacity.ts heightWantCap); the layers past it hold recently wanted tiles. */
  readonly heightWant: number
  /**
   * Slots that leave the wanted set are parked (page entry cleared, layer and data kept) and re-paged with the arrival fade when wanted again, so the
   * layers past `heightWant` are history that is not drawn. Off for a cache whose want is its whole array (no history: nothing to park) and with `?park=0`.
   */
  parking = false
  /** Unwanted this long (ms) before a slot is parked (`?parkms=`, capacity.ts parkMsOf). */
  parkMs = parkMsOf(typeof location === 'undefined' ? '' : location.search)
  private readonly parkWake = new ParkWake()
  /** The two arrays, as textures three can bind (uniforms uTileH / uTileC). */
  readonly texH: THREE.ExternalTexture
  readonly texC: THREE.ExternalTexture
  readonly page: THREE.DataTexture
  /** 18 x 9 RG32F: the highest and lowest ground (m) of each 20 deg tile, from the manifest (the terrain shell, moonShader.ts boundAt). */
  readonly bound: THREE.DataTexture
  /** Finest tile level this set streams: 0 for the three built levels, down to -3 (512 ppd) with a manifest `deeper` block. The shader is generated for it. */
  readonly deepest: number
  /** The WAC detail-ratio cache (levels -1, -2; detail.ts), null when the manifest has none or `?detail=0`. */
  readonly detail: DetailStreamer | null = null
  /** The opt-in JAXA TC detail-ratio cache (levels -3 to -5; `?tc=<base>`, tcDetail.ts), null without it. */
  readonly tc: TcStreamer | null = null
  private readonly gpuLedger = new GpuGroup('tiles')
  readonly pageW: number
  readonly pageH: number
  /**
   * Data texel of the BUILT set (level 0), km: the global camera floor is derived from it. It does not drop with a manifest's `deeper` block:
   * a deeper block covers a region, and the floor over the rest of the Moon must stay where the data runs out (a deeper texel over 474 m
   * heights is 8x magnification with nothing to sharpen it). A coverage-aware floor (moon-zoom-apollo's zoomFloorAt) uses
   * `heightTexelKmAt(lon, lat)` under the camera instead.
   */
  readonly texelKm: number
  /** Texel of the finest deeper level the manifest lists, km (equals `texelKm` without one): valid only inside that level's regions. */
  readonly deepestTexelKm: number
  /** Colour texel of the finest layer, km. */
  readonly colourTexelKm: number
  /** Validated polar WAC detail is active and can contribute imagery. */
  readonly polarDetailEnabled: boolean
  /** Something arrived, faded or was evicted: draw again. */
  onChange: () => void = () => {}
  /** Counters for tests and the report. */
  /** Per-tile relief summaries of the resident tiles, for the exposure search. */
  readonly relief = new ReliefStore()
  /** Debug: tiles wanted by the last frame, per level. */
  wantedByLevel: Record<string, number> = {}
  readonly stats = { requested: 0, loaded: 0, failed: 0, evicted: 0, bytes: 0, uploads: 0, pageUploads: 0, pageBytes: 0, pageFullBytes: 0, busyFading: 0, busyReady: 0, busyGate: 0, busyDetail: 0, parked: 0, unparked: 0, retried: 0 }

  private readonly gl: WebGL2RenderingContext
  private readonly glH: WebGLTexture
  private readonly glC: WebGLTexture
  private readonly pageData: Float32Array
  private readonly slots: (Slot | null)[]
  private readonly bySlotKey = new Map<number, Slot>()
  private readonly jobs = new Map<number, Job>()
  /** A descent waits for its patch (the last update's view): fetches go out at low priority. */
  private yieldLink = false
  /** Waits (ms) before the first and second retry of a transient fetch failure inside one job; a test sets [0, 0]. */
  retryDelaysMs: number[] = [400, 1500]
  private readonly failed = new FailureBook()
  private readonly ready: Payload[] = []
  /** Free layers below `colourCapacity` (paired with a colour layer) and past it (heights only). */
  private readonly freeC: number[] = []
  private readonly freeH: number[] = []
  private readonly deeperByLevel = new Map<number, DeeperEntry>()
  /** Page-table texels changed since the last upload: only these are sent (three's updateRanges). */
  private readonly touched = new Set<number>()
  private disposed = false
  private genCounter = 0
  /** Tiles that arrived, left or finished fading since the shadow cache last asked (their neighbours' horizons may have changed). */
  private changes: Array<{ level: number; tx: number; ty: number }> = []
  /** Recorded only while a consumer (the shadow cache) is attached: with none, nothing would ever drain the list. */
  trackChanges = false
  private changesOverflow = false
  /** The same feed for a second consumer (the tile horizon envelope, tiles/TileEnvelope.ts), drained separately. */
  private envChanges: Array<{ level: number; tx: number; ty: number }> = []
  trackEnvChanges = false
  private envChangesOverflow = false
  private readonly cpuGate = new CpuGate(() => this.onChange())
  private readonly pool: TilePool | null = createTilePool()

  private constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly base: string,
    private readonly man: Man,
    colourCap: number,
    heightCap: number,
    tc: TcStreamer | null = null,
    heightWant: number = heightCap,
  ) {
    this.deepest = deepestOf(man.deeper)
    const dEntries = readableDetail(man.deeper, man.polarDetail)
    for (const e of man.deeper ?? []) this.deeperByLevel.set(e.level, e)
    this.pageW = pageWidth(this.deepest)
    this.pageH = pageRows(this.deepest)
    this.pageData = new Float32Array(this.pageW * this.pageH * 4)
    const gl = renderer.getContext() as WebGL2RenderingContext
    this.gl = gl
    this.capacity = heightCap
    this.heightWant = Math.min(heightWant, heightCap)
    this.parking = parkingOn(PARK_SWITCH, this.heightWant, heightCap)
    this.colourCapacity = colourCap
    this.texelKm = man.height.texelKm
    this.deepestTexelKm = this.deepest < 0 ? this.deeperByLevel.get(this.deepest)?.texelKm ?? man.height.texelKm : man.height.texelKm
    this.colourTexelKm = man.color.texelKm
    const detailEnabled = detailStrength() > 0
    this.polarDetailEnabled = detailEnabled && [...dEntries.values()].some((entry) => entry.polar !== undefined)
    if (dEntries.size > 0 && detailEnabled) {
      this.detail = new DetailStreamer(renderer, base, dEntries, Math.max(24, Math.round(colourCap * 0.75)))
      this.detail.onChange = () => this.onChange()
    }
    if (tc && this.detail) { this.tc = tc; tc.onChange = () => this.onChange() }
    else tc?.dispose()
    this.slots = new Array(heightCap).fill(null)
    for (let i = colourCap - 1; i >= 0; i--) this.freeC.push(i)
    for (let i = heightCap - 1; i >= colourCap; i--) this.freeH.push(i)
    const state = renderer.state
    const make = (internal: number, size: number, levels: number, layers: number, mag: number, min: number, aniso: boolean): WebGLTexture => {
      const t = gl.createTexture() as WebGLTexture
      state.bindTexture(gl.TEXTURE_2D_ARRAY, t)
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, internal, size, size, layers)
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, min)
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, mag)
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const ext = aniso ? gl.getExtension('EXT_texture_filter_anisotropic') : null
      if (ext) gl.texParameterf(gl.TEXTURE_2D_ARRAY, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number))
      state.unbindTexture()
      return t
    }
    // Heights: no mips (the shader reads level 0; a max-height pyramid for the
    // shadow march is task 6's to add). Colour: full chain, built on the CPU.
    this.glH = make(gl.R16F, H_SIZE, 1, heightCap, gl.LINEAR, gl.LINEAR, false)
    const colorLevels = Math.floor(Math.log2(C_SIZE)) + 1
    this.glC = make(gl.SRGB8_ALPHA8, C_SIZE, colorLevels, colourCap, gl.LINEAR, gl.LINEAR_MIPMAP_LINEAR, true)
    // Heights R16F no mips; colour SRGB8_A8 with the full chain; the page table RGBA32F; the bound grid RG32F.
    this.gpuLedger.add('heights-array', textureBytes(H_SIZE, H_SIZE, 2, { layers: heightCap }))
    this.gpuLedger.add('colour-array', textureBytes(C_SIZE, C_SIZE, 4, { layers: colourCap, mips: true }))
    this.gpuLedger.add('page-table', this.pageW * this.pageH * 16)
    this.texH = new THREE.ExternalTexture(this.glH)
    this.texC = new THREE.ExternalTexture(this.glC)
    this.page = new THREE.DataTexture(this.pageData, this.pageW, this.pageH, THREE.RGBAFormat, THREE.FloatType)
    this.page.internalFormat = 'RGBA32F'
    this.page.minFilter = this.page.magFilter = THREE.NearestFilter
    this.page.generateMipmaps = false
    this.page.needsUpdate = true
    // 18 x 9 cells of 20 deg: the extremes of the level-0 tiles inside (boundGrid says why not level 2's own).
    const nx = levelNx(2), ny = levelNy(2)
    const bd = boundGrid(man)
    this.bound = new THREE.DataTexture(bd, nx, ny, THREE.RGFormat, THREE.FloatType)
    this.bound.internalFormat = 'RG32F'
    this.bound.minFilter = this.bound.magFilter = THREE.NearestFilter
    this.bound.generateMipmaps = false
    this.bound.needsUpdate = true
    this.gpuLedger.add('bound-grid', nx * ny * 8)
  }

  /** Fetches the manifest and allocates the cache. Rejects when the base has no tiles. */
  static async create(renderer: THREE.WebGLRenderer, base: string, capacity: number, signal?: AbortSignal, heightCapacityFor: (colourCap: number, deepest: number, maxLayers: number) => number = (c) => c, opts: { tc?: boolean; tcCapacity?: number; heightWantFor?: (colourCap: number, deepest: number, maxLayers: number, heightCap: number) => number } = {}): Promise<TileStreamer> {
    // Shared with the boot's manifest fetch (net/prefetch.ts): one request, however many callers.
    const man = await loadManifest(base, signal) as Man
    if (man.version !== 1 || man.height.px !== 320 || man.levels !== TILE_LEVELS) throw new Error('unsupported tile manifest')
    const gl = renderer.getContext() as WebGL2RenderingContext
    const maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number
    const cap = Math.max(8, Math.min(capacity, maxLayers))
    const hcap = Math.max(cap, Math.min(heightCapacityFor(cap, deepestOf(man.deeper), maxLayers), maxLayers))
    // The startup class may leave the TC cache out (a phone: ~38 MB of GPU memory for the finest ratio detail).
    const tc = opts.tc === false ? null : await TcStreamer.create(renderer, signal, undefined, opts.tcCapacity)
    const hwant = opts.heightWantFor ? Math.max(cap, Math.min(opts.heightWantFor(cap, deepestOf(man.deeper), maxLayers, hcap), hcap)) : hcap
    return new TileStreamer(renderer, base, man, cap, hcap, tc, hwant)
  }

  /** Fetches the two coarsest (or `levels`) tiles over (lon, lat) ahead of need; `get` takes them when the tile is wanted. */
  prefetch(lon: number, lat: number, levels?: number[]): Promise<void> {
    return prefetcherFor(this.base).prefetch([{ lon, lat, levels }] satisfies PrefetchTarget[])
  }

  /**
   * Warms the tiles a planned camera path will need (moon-zoom-apollo: call it when a flight is planned). Each point is where the camera
   * looks on the ground and the ground size of one canvas pixel there; the tiles come in path order, so the start of the flight is
   * ready first. `take` hands them to the streamer when it wants them: nothing is drawn differently, it only arrives sooner.
   */
  prefetchAlong(path: readonly PathPoint[]): Promise<void> {
    return prefetcherFor(this.base).prefetch(pathTargets(path, H_TEXEL_KM, WANT_TEXELS, this.deepest), undefined, (l, tx, ty) => this.bySlotKey.has(this.keyOf(l, tx, ty)))
  }

  get resident(): number { return this.bySlotKey.size }

  /** Read-only query for colour or height influence from the bound page table at a sampled surface point. */
  sourceAt(lonDeg: number, latDeg: number, fpColorKm: number, fpHeightKm: number, baseHeightTexelKm: number): boolean {
    const ramp = (fp: number, texel: number): number => {
      const x = Math.max(0, Math.min(1, (fp / texel - 1) / 1))
      return 1 - x * x * (3 - 2 * x)
    }
    const gate = (fp: number): number => {
      const x = Math.max(0, Math.min(1, (fp / baseHeightTexelKm - 0.5) / 0.4))
      return 1 - x * x * (3 - 2 * x)
    }
    const present = (level: number, fp: number, enabled: number, colourOnly: boolean): boolean => {
      if (enabled <= 0) return false
      const { tx, ty } = tileOf(level, lonDeg, latDeg)
      const key = this.keyOf(level, tx, ty)
      const entry = this.pageData[4 * key]
      const fade = this.pageData[4 * key + 1]
      const slot = this.bySlotKey.get(key)
      if (!slot || entry <= 0 || fade <= 0 || (colourOnly && !slot.colour)) return false
      const texel = H_TEXEL_KM * 2 ** level
      return fade * ramp(fp, texel) * enabled > 0
    }
    const colorGate = gate(fpColorKm)
    const normalGate = gate(fpHeightKm)
    for (let level = 0; level <= 2; level++) {
      if (present(level, fpColorKm, colorGate, true) || present(level, fpHeightKm, normalGate, false)) return true
    }
    for (let level = this.deepest; level < 0; level++) if (present(level, fpHeightKm, normalGate, false)) return true
    return false
  }
  /** Resident tiles per BUILT level 0..2 (for the report and tests); `residentLevels` also counts the deeper ones. */
  residentByLevel(): number[] {
    const n = new Array(TILE_LEVELS).fill(0) as number[]
    for (const s of this.bySlotKey.values()) if (s.level >= 0) n[s.level]++
    return n
  }
  get inflight(): number { return this.jobs.size }
  /** Tiles the server said are not there (404/403/410): never asked for again this session. */
  get absentTiles(): number { return this.failed.absentCount }
  /** Bytes the two arrays hold on the GPU (colour with its mips). */
  get gpuBytes(): number { return this.capacity * H_SIZE * H_SIZE * 2 + this.colourCapacity * Math.round(C_SIZE * C_SIZE * 4 * 4 / 3) }

  has(level: number, tx: number, ty: number): boolean { return this.isPresent(level, tileIndex(level, tx, ty)) }
  private isPresent(level: number, index: number): boolean {
    if (level >= 0) return this.man.present[level][index] === '1'
    const e = this.deeperByLevel.get(level)
    return !!e && deeperPresent(e, index)
  }
  private keyOf(level: number, tx: number, ty: number): number { return (levelRow(level) + ty) * this.pageW + tx }
  /** Resident tiles per level, deeper levels included (level -> count). */
  residentLevels(): Map<number, number> {
    const n = new Map<number, number>()
    for (const s of this.bySlotKey.values()) n.set(s.level, (n.get(s.level) ?? 0) + 1)
    return n
  }
  /** Measurement only (?wantprobe=1): residency of an exact want for `v` (tiles + detail + TC), memos untouched; `stale` = exact tiles the throttled want lacks. */
  exactResidency(v: StreamView): { wanted: number; resident: number; stale: number } {
    const exact = computeWanted(v, { deepest: this.deepest, isPresent: (l, index) => this.isPresent(l, index), keyOf: (l, tx, ty) => this.keyOf(l, tx, ty), shaderShade: this.shaderShade })
    cutWantedSplit(exact, this.colourCapacity, this.heightWant, COLOUR_RESERVE)
    const parts = [wantResidency(exact, this.wantedMemo, (k) => this.bySlotKey.has(k))]
    if (this.detail) parts.push(this.detail.exactResidency(v))
    if (this.tc) parts.push(this.tc.exactResidency(v))
    return parts.reduce((a, b) => ({ wanted: a.wanted + b.wanted, resident: a.resident + b.resident, stale: a.stale + b.stale }))
  }
  /** Exact overlap of this frame's wanted set with resident tiles, grouped by level. */
  wantedResidentByLevel(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const w of this.wantedMemo?.values() ?? []) if (this.bySlotKey.has(w.key)) out[w.level] = (out[w.level] ?? 0) + 1
    return out
  }

  /**
   * Texel of the finest height level DRAWN under (lon, lat), km: a deeper tile counts only once it is resident and fully faded in; otherwise the built
   * set's. `heightTexelKmAt` answers what the manifest lists, which is more than the picture shows while a tile loads, so a label must read this one.
   */
  residentHeightTexelKmAt(lon: number, lat: number): number {
    for (let l = this.deepest; l < 0; l++) {
      const { tx, ty } = tileOf(l, lon, lat)
      const e = this.deeperByLevel.get(l)
      if (!e || !deeperPresent(e, tileIndex(l, tx, ty))) continue
      const key = this.keyOf(l, tx, ty)
      const s = this.bySlotKey.get(key)
      if (s && !s.parked && this.pageData[4 * key] > 0 && this.pageData[4 * key + 1] >= 1) return e.texelKm
    }
    return this.texelKm
  }

  /**
   * Texel of the finest height level present under (lon, lat), km: the built set's where no deeper tile exists. This is the per-region value a
   * coverage-aware floor reads (INTEGRATION POINT for moon-zoom-apollo's zoomFloorAt: replace its `texelKm` with this at the camera's ground point).
   */
  heightTexelKmAt(lon: number, lat: number): number {
    for (let l = this.deepest; l < 0; l++) {
      const { tx, ty } = tileOf(l, lon, lat)
      const e = this.deeperByLevel.get(l)
      if (e && deeperPresent(e, tileIndex(l, tx, ty))) return e.texelKm
    }
    return this.texelKm
  }

  /**
   * The resident tiles, every level, for the shadow cache (ShadowCache.ts): `full` once faded in, `shade` when the last wanted set reads
   * the level for shading (wanted.ts), keyed by `layer` with `gen` changing whenever that layer holds new data.
   */
  cacheSlots(): readonly CacheSlot[] {
    // One array and one record per resident slot, refilled in place: the shadow cache walks this several times a frame, and a fresh array of fresh
    // objects every call was the garbage of every rendered frame. The caller reads it within the frame and keeps no reference past it.
    const out = this.slotViews
    let n = 0
    const memo = this.wantedMemo
    for (const s of this.bySlotKey.values()) {
      const i = (levelRow(s.level) + s.ty) * this.pageW + s.tx
      // A parked slot stays listed (omitted, the cache would drop its build and `gen` bookkeeping) but is neither full nor shaded: the build walk and
      // visibleWanted skip it, and with keep 9 it is the first layer the cache's cap-eviction takes back.
      const w = memo?.get(s.key)
      const v = out[n] ?? (out[n] = { layer: 0, level: 0, tx: 0, ty: 0, gen: 0, full: false, shade: false, keep: 9 })
      v.layer = s.layer; v.level = s.level; v.tx = s.tx; v.ty = s.ty; v.gen = s.gen
      v.full = !s.parked && this.pageData[4 * i + 1] >= 1
      v.shade = !s.parked && w?.shade === true
      v.keep = w?.keep ?? 9
      n++
    }
    out.length = n
    return out
  }
  private readonly slotViews: CacheSlot[] = []
  /**
   * Tile arrivals, evictions and fade completions since the last call. The list is capped (CHANGES_CAP): past it `overflow` is set and the
   * consumer treats every layer as changed, so a long stretch without a consumer (ground mode) cannot grow it without bound.
   */
  takeChanges(): { changes: Array<{ level: number; tx: number; ty: number }>; overflow: boolean } {
    const out = { changes: this.changes, overflow: this.changesOverflow }
    this.changes = []
    this.changesOverflow = false
    return out
  }
  /** Tile arrivals, evictions and fade completions since the tile envelope last asked (same capped list and overflow rule as takeChanges). */
  takeEnvChanges(): { changes: Array<{ level: number; tx: number; ty: number }>; overflow: boolean } {
    const out = { changes: this.envChanges, overflow: this.envChangesOverflow }
    this.envChanges = []
    this.envChangesOverflow = false
    return out
  }
  private noteChange(level: number, tx: number, ty: number): void {
    if (this.trackEnvChanges) {
      if (this.envChanges.length >= CHANGES_CAP) this.envChangesOverflow = true
      else this.envChanges.push({ level, tx, ty })
    }
    if (!this.trackChanges) return
    if (this.changes.length >= CHANGES_CAP) { this.changesOverflow = true; return }
    this.changes.push({ level, tx, ty })
  }

  /** The last update() was busy only because tiles are fading (here, in the detail streamer or in the TC streamer). */
  fadeOnlyBusy = false

  /** Fully faded in? Used by tests: is every wanted tile at its final look. */
  busy(): boolean { return this.touched.size > 0 || this.ready.length > 0 || this.cpuGate.pending }

  /** Capture-only settle: resident wanted textures take their final fade state before deterministic frames are sampled. */
  completeFadesForCapture(now: number): void {
    // Focus pull: a released mark ramping out takes its end state too.
    for (const k of this.released.keys()) if (this.pageData[4 * k] === 0) this.setPage(k, 0, 0, 0, 0)
    this.released.clear()
    for (const s of this.bySlotKey.values()) {
      if (s.leaving) this.finishLeave(s)
      if (s.parked) continue
      s.readyAt = now - fadeMs()
      const i = 4 * s.key + 1
      if (this.pageData[i] !== 1) { this.pageData[i] = 1; this.touched.add(s.key) }
    }
  }
  captureFadeSignature(): number {
    let hash = 2166136261
    for (const w of this.wantedMemo?.values() ?? []) {
      const q = Math.round(this.pageData[4 * w.key + 1] * 1000)
      hash = Math.imul(hash ^ q ^ w.key, 16777619)
    }
    return hash >>> 0
  }

  /** Per frame: choose tiles, start fetches, upload one, advance fades. True while frames are still needed. */
  update(v: StreamView, now: number): boolean {
    this.yieldLink = !!v.patchLoading
    this.scripted = !!(v.flight || v.scripted)
    if (this.disposed) return false
    this.cpuGate.tick()
    const wanted = this.wanted(v, now)
    if (focusPullOn() && this.focusRaysFor !== wanted) { this.focusRays = this.buildFocusRays(v); this.focusRaysFor = wanted }
    for (const w of wanted.values()) {
      const s = this.bySlotKey.get(w.key)
      if (s) { s.lastWanted = now; if (s.parked) this.unpark(s, now) }
      const j = this.jobs.get(w.key)
      if (j) { j.lastWanted = now; j.priority = w.priority }
    }
    if (this.parking) {
      let due = -1
      for (const s of this.bySlotKey.values()) {
        if (s.parked || wanted.has(s.key)) continue
        if (now - s.lastWanted > this.parkMs) this.park(s, now)
        else if (due < 0 || s.lastWanted + this.parkMs < due) due = s.lastWanted + this.parkMs
      }
      // Rendering is dirty-gated: wake once at the earliest deadline so a settled view still parks (and the shadow cache hears of it).
      this.parkWake.schedule(due, now, () => this.onChange())
    }
    // Drop fetches nobody wants any more.
    for (const j of this.jobs.values()) if (!wanted.has(j.key) && now - j.lastWanted > UNWANTED_ABORT_MS) { j.abort.abort(); this.jobs.delete(j.key) }
    // Start new ones, best first, while there is a slot to put the result in.
    this.pumpView = v; this.pumpWanted = wanted
    this.admit(v, wanted, now)
    // One upload per frame while a gesture moves (a hitch is worse than a late tile); at rest up to UPLOADS_AT_REST, so the picture sharpens in a few frames,
    // not one tile per (full-size, 50 ms) frame: a time-slider release measured 2 s of one-tile frames.
    for (let k = uploadsThisFrame(v, v.frameMs); k > 0 && this.ready.length > 0; k--) this.upload(takeReady(this.ready, wanted)!, wanted, now)
    // Fades.
    let fading = false
    const deepBecameVisible: Slot[] = []
    for (const s of this.bySlotKey.values()) {
      if (s.leaving) {
        // A parked tile still weighing in: its fade falls to 0 on the arrival's slope, then the entry is cleared.
        const g = fadeOutLevel(s.leaveFrom, s.leaveAt, now, fadeMs())
        if (g <= 0) this.finishLeave(s, now)
        else { const li = (levelRow(s.level) + s.ty) * this.pageW + s.tx; if (this.pageData[4 * li + 1] !== g) { this.pageData[4 * li + 1] = g; this.touched.add(li) }; fading = true }
        continue
      }
      if (s.parked) continue
      const a = fadeInLevel(now, s.readyAt, fadeMs())
      const i = (levelRow(s.level) + s.ty) * this.pageW + s.tx
      const wasVisible = this.pageData[4 * i + 1] >= 1
      if (this.pageData[4 * i + 1] !== a) { this.pageData[4 * i + 1] = a; this.touched.add(i) }
      if (!wasVisible && a >= 1 && s.level < 0) deepBecameVisible.push(s)
      if (!wasVisible && a >= 1) this.noteChange(s.level, s.tx, s.ty)
      if (a < 1) fading = true
    }
    // All page fade values are current before any mask is recalculated, so a group of
    // adjacent tiles completing together gets the same symmetric resident masks.
    for (const s of deepBecameVisible) this.refreshDeepMasks(s.level, s.tx, s.ty)
    if (focusPullOn() && this.markPending(wanted, now)) fading = true
    this.focusFading = fading
    this.flushPage()
    // (The `||` keeps the old short circuit: a busy detail streamer means the TC streamer is not updated this frame.)
    const dDetail = span('detail.update', () => (this.detail ? this.detail.update(v, now) : false))
    const dTc = dDetail ? false : span('tc.update', () => (this.tc ? this.tc.update(v, now) : false))
    const dBusy = dDetail || dTc
    if (fading) this.stats.busyFading++
    if (this.ready.length > 0) this.stats.busyReady++
    if (this.cpuGate.pending) this.stats.busyGate++
    if (dBusy) this.stats.busyDetail++
    const busy = fading || this.ready.length > 0 || this.cpuGate.pending || dBusy
    // Only fades are keeping frames coming: nothing waits to upload, decode or build (main.ts may then draw them at the class's fade cadence).
    this.fadeOnlyBusy = busy && this.ready.length === 0 && !this.cpuGate.pending && (!dDetail || !!this.detail?.fadeOnlyBusy) && (!dTc || !!this.tc?.fadeOnlyBusy)
    return busy
  }

  /** The latest view and wanted set update() admitted against: a settled job admits more from them without waiting for a frame (the tile pump). */
  private pumpView: StreamView | null = null
  private pumpWanted: Map<number, Want> | null = null
  /** Start queued fetches up to the in-flight cap and the free layers. Called by update() every frame and by a settled job (pump). */
  private admit(v: StreamView, wanted: Map<number, Want>, now: number): void {
    const queue = [...wanted.values()].filter((w) => !this.bySlotKey.has(w.key) && !this.jobs.has(w.key) && !this.ready.some((p) => p.job.key === w.key)
      && this.failed.allows(w.key, now)).sort((a, b) => a.priority - b.priority)
    // Admission must use the same compatible-layer budget as takeLayer(). In
    // particular, free colour layers below COLOUR_RESERVE are unavailable to
    // height-only payloads; counting them here creates a retry loop where a
    // wanted payload is decoded, dropped, and fetched again every 3 seconds.
    let freeC = this.freeC.length
    let freeH = this.freeH.length
    const evictableC: Slot[] = []
    const evictableDeepHigh: Slot[] = []
    const evictableDeepShared: Slot[] = []
    for (const s of this.bySlotKey.values()) {
      if (wanted.has(s.key) || now - s.lastWanted <= 300) continue
      if (s.layer < this.colourCapacity) evictableC.push(s)
      if (s.layer >= this.colourCapacity) evictableDeepHigh.push(s)
      else if (!s.colour) evictableDeepShared.push(s) // shared with evictableC; the planner consumes it once.
    }
    evictableC.sort((a, b) => a.lastWanted - b.lastWanted)
    evictableDeepHigh.sort((a, b) => a.lastWanted - b.lastWanted)
    evictableDeepShared.sort((a, b) => a.lastWanted - b.lastWanted)
    const removeToken = (tokens: Slot[], token: Slot) => {
      const i = tokens.indexOf(token)
      if (i >= 0) tokens.splice(i, 1)
    }
    const reserveBuilt = () => {
      if (freeC > 0) { freeC--; return true }
      const victim = evictableC.shift()
      if (victim) { removeToken(evictableDeepShared, victim); return true }
      return false
    }
    const reserveDeep = () => {
      if (freeH > 0) { freeH--; return true }
      if (freeC > COLOUR_RESERVE) { freeC--; return true }
      const high = evictableDeepHigh.shift()
      if (high) return true
      const shared = evictableDeepShared.shift()
      if (shared) { removeToken(evictableC, shared); return true }
      return false
    }
    // Reserve already-decoding/ready payloads before admitting another job.
    // The order mirrors the cache's class compatibility: colour payloads can
    // only use colour layers, while deeper payloads can use height layers or
    // spare colour layers above COLOUR_RESERVE.
    let blockedBuilt = 0
    let blockedDeep = 0
    for (const j of this.jobs.values()) {
      const ok = j.level >= 0 ? reserveBuilt() : reserveDeep()
      if (!ok) (j.level >= 0 ? blockedBuilt++ : blockedDeep++)
    }
    for (const p of this.ready) {
      const built = p.color.length > 0
      const ok = built ? reserveBuilt() : reserveDeep()
      if (!ok) (built ? blockedBuilt++ : blockedDeep++)
    }
    for (const w of queue) {
      if (this.jobs.size >= inflightCap(v, MAX_INFLIGHT, MAX_INFLIGHT_FLIGHT)) break
      if ((w.level >= 0 && blockedBuilt > 0) || (w.level < 0 && blockedDeep > 0)) continue
      if (!(w.level >= 0 ? reserveBuilt() : reserveDeep())) continue
      this.start(w, now)
    }
  }
  private pump(): void {
    if (this.disposed || !mayPump(this.pumpView)) return
    this.admit(this.pumpView!, this.pumpWanted!, performance.now())
  }

  /** Context lost: the streamers stay alive until restoration disposes them, so nothing may wake the loop meanwhile (the parking wake). */
  suspend(): void { this.parkWake.suspend(); this.tc?.suspend() }
  /** The app went to the background (native/lifecycle): every tile request in flight, in the base, detail and TC streamers, is aborted and forgotten; the next resume asks again. */
  abortInFlight(): number {
    return abortEverywhere([{ abortInFlight: () => { const n = abortAllJobs(this.jobs.values()); this.jobs.clear(); return n } }, this.detail, this.tc])
  }

  /** `lost`: the context is gone with the textures, so there is nothing to delete (deleting them would only warn). */
  dispose(lost = false): void {
    this.disposed = true
    this.parkWake.suspend()
    this.cpuGate.dispose()
    for (const j of this.jobs.values()) j.abort.abort()
    this.jobs.clear()
    this.pool?.dispose()
    this.detail?.dispose(lost)
    this.tc?.dispose(lost)
    this.gpuLedger.releaseAll()
    if (!lost) {
      this.gl.deleteTexture(this.glH)
      this.gl.deleteTexture(this.glC)
      this.page.dispose()
      this.bound.dispose()
    }
  }

  /** Sends only the page-table texels that changed (three merges adjacent ranges): the table is 5 MB with a -3 level, 21 MB at -4. */
  private flushPage(): void {
    if (this.touched.size === 0) return
    for (const i of this.touched) this.page.addUpdateRange(4 * i, 4)
    this.stats.pageUploads++
    this.stats.pageBytes += this.touched.size * 16
    this.stats.pageFullBytes += this.pageW * this.pageH * 16
    this.touched.clear()
    this.page.needsUpdate = true
  }
  private setPage(i: number, r: number, g: number, z: number, w: number): void {
    const d = this.pageData
    d[4 * i] = r; d[4 * i + 1] = g; d[4 * i + 2] = z; d[4 * i + 3] = w
    this.touched.add(i)
  }

  /** A deep neighbour counts only once its page entry is fully visible. During its 250 ms fade the coarser
   * fallback is still visible, so retaining the edge feather avoids exposing an unblended seam. */
  private deepVisible(level: number, tx: number, ty: number): boolean {
    const i = (levelRow(level) + ty) * this.pageW + tx
    const slot = this.bySlotKey.get(i)
    return !!slot && slot.level === level && this.pageData[4 * i + 1] >= 1
  }

  /** Refresh the changed deep tile and its 8 neighbours after residency changes. */
  private refreshDeepMasks(level: number, tx: number, ty: number): void {
    if (level >= 0) return
    const nx = levelNx(level), ny = levelNy(level)
    for (let dy = -1; dy <= 1; dy++) {
      const y = ty + dy
      if (y < 0 || y >= ny) continue
      for (let dx = -1; dx <= 1; dx++) {
        const x = (tx + dx + nx) % nx
        const i = (levelRow(level) + y) * this.pageW + x
        const r = this.pageData[4 * i]
        if (r <= 0) continue
        const mask = neighbourMask(level, x, y, (nx2, ny2) => this.deepVisible(level, nx2, ny2))
        this.setPage(i, r, this.pageData[4 * i + 1], mask, this.pageData[4 * i + 3])
      }
    }
  }

  // ------------------------------------------------------- focus pull (default on, ?focuspull=0 off, focusPull.ts)
  /** Wanted colour tiles (levels 0..2) that are not resident and not failed: their page cell reads PENDING_MARK so the shader defocuses what they will sharpen. */
  private pendingKeys = new Set<number>()
  private focusRays: FocusRays | null = null
  private focusRaysFor: Map<number, Want> | null = null
  private focusFading = false
  /** The last update was a scripted move (fly-to, cinematic flight, intro): the detail signal stays out of it (focusMeasure). */
  private scripted = false
  /** Marks let go (page key -> when): each ramps from PENDING_MARK down to RELEASE_FLOOR over FOCUS_PULL_MS (focusPull.ts release), then the cell is cleared. */
  private released = new Map<number, number>()
  private markPending(wanted: Map<number, Want>, now: number): boolean {
    const next = new Set<number>()
    for (const w of wanted.values()) {
      if (w.level < 0 || w.level >= TILE_LEVELS || this.bySlotKey.has(w.key) || !this.failed.allows(w.key, now)) continue
      next.add(w.key)
      this.released.delete(w.key)
      if (this.pageData[4 * w.key] === 0 && this.pageData[4 * w.key + 1] !== PENDING_MARK) this.setPage(w.key, 0, PENDING_MARK, 0, 0)
    }
    // A tile that leaves the wanted set or backs off (a failure, no layer for it) lets its mark go: the blur it caused ramps out, as an arrival's ramps in.
    for (const k of this.pendingKeys) if (!next.has(k) && this.pageData[4 * k] === 0 && this.pageData[4 * k + 1] === PENDING_MARK) this.released.set(k, now)
    this.pendingKeys = next
    return this.stepReleased(now)
  }
  /**
   * Advance every released mark; true while one still ramps. A cell that became resident (an upload, an unpark) or pending again is left to its owner. A cell
   * an eviction cleared mid-ramp (a parked slot's layer taken back) is written again here: the ramp is the picture's, not the slot's.
   */
  private stepReleased(now: number): boolean {
    for (const [k, at] of this.released) {
      if (this.pageData[4 * k] !== 0 || this.pendingKeys.has(k)) { this.released.delete(k); continue }
      const p = release(now - at)
      if (p <= 0) { this.setPage(k, 0, 0, 0, 0); this.released.delete(k); continue }
      const g = releaseMark(p)
      if (this.pageData[4 * k + 1] !== g) this.setPage(k, 0, g, 0, 0)
    }
    return this.released.size > 0
  }
  /** The ray grid of the view a new wanted set was computed for (the ray pass is the memo computeWanted just filled), keyed to this streamer's page cells. */
  private buildFocusRays(v: StreamView): FocusRays {
    const rs = sharedRaySamples(v, undefined)
    const st = v.moving && !v.flight ? 2 : 1
    const total = Math.ceil(SAMPLES_X / st) * Math.ceil(SAMPLES_Y / st)
    return buildFocusRays(rs, total, GLOBAL_TEXEL_KM, (level, lonW, lat) => {
      const { tx, ty } = tileOf(level, lonW - 180, lat)
      return this.isPresent(level, tileIndex(level, tx, ty)) ? this.keyOf(level, tx, ty) : -1
    })
  }
  /**
   * How much of the frame is drawn coarser than wanted right now, with a finer level on its way (zeros when nothing is pending or fading, and always
   * with the switch off). `canvasW` is the canvas width in pixels: `lackPer640` is the blur sigma (0.7 x the lack, the prototype's `miss`) in pixels of a 640 px wide canvas, the indicator's unit.
   */
  focusMeasure(canvasW: number, now = performance.now()): CoarseMeasure & { lackPer640: number; detail: number } {
    const rays = this.focusRays
    if (!focusPullOn()) return { coarse: 0, lackPx: 0, lackPer640: 0, detail: 0 }
    // The finer detail on its way (WAC ratio -1..-2, Terrain Camera -3..-5): close to the surface the colour levels are in long before these, and they are
    // what the visitor sees sharpen (owner walkthrough 2026-10-31: the indicator never showed on a zoom at the surface). Indicator only: no defocus.
    // Not during a scripted move (a flight, the hover over a site while its photograph loads, a descent: cameraOwned() in main.ts): a flyover streams detail the whole way and the ring would sit over its subject for half the flight (rig r2-tiles, branch
    // 6f52492: Copernicus flyover up on 315 of 584 samples vs 189 with colour alone). The colour signal there is unchanged.
    const detail = this.scripted ? 0 : Math.max(this.detail?.missingShare(now) ?? 0, this.tc?.missingShare(now) ?? 0)
    if (!rays || (this.pendingKeys.size === 0 && this.released.size === 0 && !this.focusFading)) return { coarse: 0, lackPx: 0, lackPer640: 0, detail }
    const m = measureCoarse(rays, GLOBAL_TEXEL_KM, (key) => {
      const r = this.pageData[4 * key], g = this.pageData[4 * key + 1]
      return r > 0 ? { resident: true, pending: false, fade: g } : { resident: false, pending: g > RELEASE_FLOOR, fade: 0, hold: markStrength(g) }
    })
    return { ...m, lackPer640: canvasW > 0 ? SIGMA_PER_LACK * m.lackPx * 640 / canvasW : 0, detail }
  }

  // ---------------------------------------------------------------- wanted
  private wantedKey = ''
  private wantedMemo: Map<number, Want> | null = null
  private wantedAt = -1
  private wantedComputedAt = -1
  private wantedView: StreamView | undefined
  /** Fixed shadow policy: mark the level the shader's cached-horizon read rounds to as shaded (wanted.ts WantContext.shaderShade). Set once at start-up; off for legacy. */
  shaderShade = false
  private wanted(v: StreamView, now: number): Map<number, Want> {
    // The wanted set is a pure function of the view (the manifest is fixed once the streamer exists): a camera that has not moved wants what it
    // wanted last frame. computeWanted samples 4480 rays and walks up to seven levels for each: about 10 ms a call at the Copernicus floor,
    // every frame, at rest too (profile on the GPU rig).
    const key = wantedMemoKey(v)
    if (this.wantedMemo && wantedMemoValid(this.wantedKey, key, v, this.wantedAt, now, !!v.flight || ABL.has('nothrottle'), ABL.has('nothrottle') ? 0 : FLIGHT_WANTED_MS.tiles, this.wantedView, this.wantedComputedAt)) return this.wantedMemo
    const out = span('wanted.tiles', () => computeWanted(v, {
      deepest: this.deepest,
      isPresent: (l, index) => this.isPresent(l, index),
      keyOf: (l, tx, ty) => this.keyOf(l, tx, ty),
      shaderShade: this.shaderShade,
    }))
    cutWantedSplit(out, this.colourCapacity, this.heightWant, COLOUR_RESERVE)
    const byLevel: Record<string, number> = {}
    for (const w of out.values()) byLevel[w.level] = (byLevel[w.level] ?? 0) + 1
    this.wantedByLevel = byLevel
    this.wantedKey = key
    this.wantedMemo = out
    this.wantedAt = now
    this.wantedComputedAt = now
    this.wantedView = { ...v, pos: v.pos.clone(), back: v.back.clone(), moonX: v.moonX.clone(), moonY: v.moonY.clone(), moonZ: v.moonZ.clone() }
    return out
  }

  // ------------------------------------------------------------------ fetch
  private start(w: Want, now: number): void {
    const job: Job = { key: w.key, level: w.level, tx: w.tx, ty: w.ty, priority: w.priority, lastWanted: now, abort: new AbortController(), failedAt: 0 }
    this.jobs.set(w.key, job)
    this.stats.requested++
    const sig = job.abort.signal
    const get = async (path: string): Promise<ArrayBuffer> => {
      const pre = prefetcherFor(this.base).take(path)
      if (pre) {
        try { const b = await pre; this.stats.bytes += b.byteLength; return b } catch { /* prefetch failed: fetch for real */ }
      }
      const init: RequestInit & { priority?: 'low' | 'high' | 'auto' } = { signal: sig }
      if (this.yieldLink) init.priority = 'low'
      // A transient answer (5xx, 408, 429, a dropped connection) is asked again twice, soon, before the key joins the 10 s+ failure back-off: one 503 from
      // the edge otherwise left the tile on the coarser level for ten seconds. 404/403/410 and an abort are not retried.
      for (let attempt = 0; ; attempt++) {
        let failure: unknown
        try {
          const res = await fetch(this.base + path, init)
          if (res.ok) {
            const buf = await res.arrayBuffer()
            this.stats.bytes += buf.byteLength
            return buf
          }
          failure = new HttpError(path, res.status)
          if (!isTransient(res.status)) throw failure
        } catch (e) {
          if (e instanceof HttpError && !isTransient(e.status)) throw e
          if (sig.aborted) throw e
          failure = e
        }
        if (attempt >= this.retryDelaysMs.length) throw failure
        this.stats.retried++
        await sleepFor(this.retryDelaysMs[attempt], sig)
      }
    }
    ;(async () => {
      // Deeper levels (level < 0) are heights only: their colour is the level-0 map's (a baked-sun mosaic cannot be a colour source here; see
      // The manifest's per-level `color` block is ignored.
      const deeper = w.level < 0
      const wantColor = !deeper
      const [hb, cb] = await Promise.all([get(heightPath(w.level, w.tx, w.ty)), wantColor ? get(colorPath(w.level, w.tx, w.ty)) : Promise.resolve(null)])
      const stepM = deeper ? this.deeperByLevel.get(w.level)?.stepM ?? H_STEP_M : H_STEP_M
      const pool = this.pool
      if (pool?.usable) {
        // Off the page's thread: gunzip, decode, smooth, summarise and mip the tile in a Worker (tileJob.ts is the one implementation).
        const t0 = performance.now()
        const r = await pool.run({ hb, cb, level: w.level, ty: w.ty, deeper, stepM })
        perfAdd('tile.worker.roundtrip', performance.now() - t0)
        if (this.disposed || sig.aborted) return
        if (!settleJob(this.jobs, w.key, job)) return
        this.failed.succeed(w.key)
        this.ready.push({ job, heights: r.heights, mid: r.mid, relief: r.relief, color: r.color })
        this.stats.loaded++
        this.onChange()
        this.pump()
        return
      }
      const raw = await gunzipIfNeeded(hb)
      if (CPU_GATE) await this.cpuGate.wait(sig)
      if (this.disposed || sig.aborted) return
      const dec = perfSpan('tile.decode.main', () => decodeTileHeights(new Uint8Array(raw), w.level, w.ty, deeper, stepM, cb === null))
      if (cb === null) {
        if (this.disposed || sig.aborted) return
        if (!settleJob(this.jobs, w.key, job)) return
        this.failed.succeed(w.key)
        this.ready.push({ job, heights: dec.heights, mid: dec.mid, relief: dec.relief, color: [] })
        this.stats.loaded++
        this.onChange()
        this.pump()
        return
      }
      const bmp = await createImageBitmap(new Blob([cb], { type: 'image/webp' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
      if (CPU_GATE) await this.cpuGate.wait(sig)
      if (this.disposed || sig.aborted) { bmp.close(); return }
      let px: Uint8ClampedArray
      try {
        const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(C_SIZE, C_SIZE) : Object.assign(document.createElement('canvas'), { width: C_SIZE, height: C_SIZE })
        const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
        ctx.drawImage(bmp, 0, 0)
        px = ctx.getImageData(0, 0, C_SIZE, C_SIZE).data
      } finally { bmp.close() }
      const color = perfSpan('tile.colour.main', () => prepareColour(px, w.level, C_SIZE))
      if (this.disposed || sig.aborted) return
      if (!settleJob(this.jobs, w.key, job)) return
      this.failed.succeed(w.key)
      this.ready.push({ job, heights: dec.heights, mid: dec.mid, relief: dec.relief, color })
      this.stats.loaded++
      this.onChange()
      this.pump()
    })().catch((e: unknown) => {
      // Only the job's own entry: an aborted job's late rejection must not delete the replacement started under the same key.
      if (!settleJob(this.jobs, w.key, job) || sig.aborted) return
      // The Worker pool turned itself off with this tile in it (its buffers went with it): the next frame fetches it again, decoded on the page.
      if (e instanceof WorkerUnavailable) { this.onChange(); this.pump(); return }
      this.stats.failed++
      this.failed.fail(w.key, performance.now(), isPermanentFailure(e))
      console.warn('tile failed', w.level, w.tx, w.ty, (e as Error).message)
      // Wake the loop: the next frame's update() starts the queued fetches this one held back (no in-flight busy flag keeps it drawing).
      this.onChange()
      this.pump()
    })
  }

  // ----------------------------------------------------------------- upload
  /**
   * A layer for a tile: a colour-bearing tile takes one below `colourCapacity`; a heights-only tile takes one past it, or a spare colour layer
   * while COLOUR_RESERVE stay free. When none is free the least recently wanted unwanted tile that holds a usable layer is evicted.
   * With parking every unwanted resident slot is parked, so the LRU victim is always the oldest parked slot: the parked slots are the history pool.
   */
  private takeLayer(colour: boolean, wanted: Map<number, unknown>): number | undefined {
    let layer = colour ? this.freeC.pop() : (this.freeH.pop() ?? (this.freeC.length > COLOUR_RESERVE ? this.freeC.pop() : undefined))
    if (layer !== undefined) return layer
    let victim: Slot | null = null
    for (const s of this.bySlotKey.values()) {
      if (wanted.has(s.key)) continue
      // A colour tile needs a paired layer; a heights-only one may take any layer that is not holding a colour tile it would starve.
      if (colour && s.layer >= this.colourCapacity) continue
      if (!colour && s.layer < this.colourCapacity) continue // prefer dedicated height layers; shared colour-range layers are fallback.
      if (!victim || s.lastWanted < victim.lastWanted) victim = s
    }
    if (!colour && !victim) {
      for (const s of this.bySlotKey.values()) {
        if (wanted.has(s.key) || s.layer >= this.colourCapacity || s.colour) continue
        if (!victim || s.lastWanted < victim.lastWanted) victim = s
      }
    }
    if (!victim) return undefined // nothing evictable: the tile is dropped, the fetch repeats if still wanted
    layer = victim.layer
    this.evict(victim)
    return layer
  }

  private upload(p: Payload, wanted: Map<number, unknown>, now: number): void {
    span('upload.tiles', () => this.uploadNow(p, wanted, now))
  }
  private uploadNow(p: Payload, wanted: Map<number, unknown>, now: number): void {
    const colour = p.color.length > 0
    const layer = this.takeLayer(colour, wanted)
    if (layer === undefined) {
      // No layer for it and nothing evictable: the wanted set can hold a few tiles more than the heights array lets a deeper tile have (the
      // COLOUR_RESERVE layers stay free). Dropped bare, the tile was wanted again the next frame, fetched, decoded, smoothed and summarised
      // again, about 25 tiles a second for as long as the view stayed (measured on the Copernicus oblique: the main thread was 100 % busy
      // on it). Hold it off for DROP_RETRY_MS; a layer that frees sooner is taken by the next wanted tile, which is the same outcome.
      this.failed.hold(p.job.key, now, DROP_RETRY_MS)
      return
    }
    const gl = this.gl
    const state = this.renderer.state
    // three implements WebGLState.pixelStorei (cached) but @types/three omits it.
    withTightUnpack(state as unknown as PixelStoreState, gl, () => {
      state.bindTexture(gl.TEXTURE_2D_ARRAY, this.glH)
      if (p.heights instanceof Uint16Array) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, H_SIZE, H_SIZE, 1, gl.RED, gl.HALF_FLOAT, p.heights)
      else gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, H_SIZE, H_SIZE, 1, gl.RED, gl.FLOAT, p.heights)
      if (!colour) { state.unbindTexture(); return }
      state.bindTexture(gl.TEXTURE_2D_ARRAY, this.glC)
      let w = C_SIZE
      for (let lv = 0; lv < p.color.length; lv++) {
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, lv, 0, 0, layer, w, w, 1, gl.RGBA, gl.UNSIGNED_BYTE, p.color[lv])
        w >>= 1
      }
      state.unbindTexture()
    })
    const j = p.job
    // Fades that start on a shared grid line (fades.ts): a frame-stepped capture starts at the upload, so its frames stay what they were.
    const batchMs = this.pumpView?.flightReuse === false ? 0 : fadeBatchMs()
    const slot: Slot = { layer, key: j.key, level: j.level, tx: j.tx, ty: j.ty, lastWanted: now, readyAt: fadeStartAt(now, batchMs), colour, gen: ++this.genCounter, mid: p.mid, relief: p.relief, parked: false, leaving: false, leaveFrom: 0, leaveAt: 0 }
    this.slots[layer] = slot
    this.bySlotKey.set(j.key, slot)
    this.relief.add(j.level, j.tx, j.ty, p.relief)
    const i = (levelRow(j.level) + j.ty) * this.pageW + j.tx
    // b: bits of absent resident neighbours of a deeper tile (the shader feathers toward them); a: its mid height. Built levels write 0 and 0.
    this.setPage(i, layer + 1, 0, 0, p.mid)
    if (j.level < 0) this.refreshDeepMasks(j.level, j.tx, j.ty)
    this.stats.uploads++
  }

  /**
   * The tile left the wanted set: nothing draws it, so the shader falls back to the coarser level exactly as if it were absent, and the shadow cache
   * (cacheSlots: not full, not shaded) neither builds nor live-marches it. Layer, data and `gen` stay, so a build the cache made for the layer survives.
   * The change IS reported (noteChange): shadow builds read the paged heights, so a neighbour's build made with this tile present is stale once it is
   * gone. The cache rebuilds such a layer after its quiet period with a crossfade, never at once. Eviction of the parked tile reports it again.
   */
  private park(s: Slot, now: number): void {
    s.parked = true
    this.noteChange(s.level, s.tx, s.ty)
    this.relief.remove(s.level, s.tx, s.ty)
    const i = (levelRow(s.level) + s.ty) * this.pageW + s.tx
    const g = this.pageData[4 * i + 1]
    if (fadeOutOn() && g > 0) {
      // Still weighing in the shader: fade it out over the arrival fade instead of stepping to the coarser level (update() clears the entry at 0).
      // The neighbours' masks are refreshed now, as for an arrival: a tile below full weight does not count as a resident neighbour.
      s.leaving = true; s.leaveFrom = g; s.leaveAt = now
    } else this.setPage(i, 0, 0, 0, 0)
    if (s.level < 0) this.refreshDeepMasks(s.level, s.tx, s.ty)
    this.stats.parked++
  }
  /** The fade-out reached 0 (or a capture settles it): the entry is cleared, as park() does without a fade. */
  private finishLeave(s: Slot, now?: number): void {
    s.leaving = false
    const i = (levelRow(s.level) + s.ty) * this.pageW + s.tx
    // Focus pull: a colour level that faded out was blurring the coarser colour under it towards its own detail (its fade, pull(a), fell while its ideal
    // stayed in): that blur ramps out as a released mark instead of ending on the frame the entry is cleared.
    if (now !== undefined && focusPullOn() && s.level >= 0 && s.level < TILE_LEVELS) { this.setPage(i, 0, PENDING_MARK, 0, 0); this.released.set(i, now); return }
    this.setPage(i, 0, 0, 0, 0)
  }
  /** Wanted again: page the resident layer with the arrival fade (no fetch, decode or upload), as uploadNow does for a new tile. */
  private unpark(s: Slot, now: number): void {
    s.parked = false
    this.relief.add(s.level, s.tx, s.ty, s.relief)
    const i = (levelRow(s.level) + s.ty) * this.pageW + s.tx
    if (s.leaving) {
      // Wanted again mid fade-out: climb back from where the fade stands (the entry is still paged), not from 0.
      s.leaving = false
      s.readyAt = fadeInFrom(this.pageData[4 * i + 1], now, fadeMs())
      this.stats.unparked++
      if (s.level < 0) this.refreshDeepMasks(s.level, s.tx, s.ty)
      return
    }
    s.readyAt = now
    this.setPage(i, s.layer + 1, 0, 0, s.mid)
    if (s.level < 0) this.refreshDeepMasks(s.level, s.tx, s.ty)
    this.stats.unparked++
  }

  private evict(s: Slot): void {
    this.bySlotKey.delete(s.key)
    if (!s.parked) this.relief.remove(s.level, s.tx, s.ty)
    this.slots[s.layer] = null
    this.noteChange(s.level, s.tx, s.ty)
    this.setPage((levelRow(s.level) + s.ty) * this.pageW + s.tx, 0, 0, 0, 0)
    if (s.level < 0) this.refreshDeepMasks(s.level, s.tx, s.ty)
    this.stats.evicted++
  }
}
