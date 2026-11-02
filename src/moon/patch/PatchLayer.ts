import * as THREE from 'three'
import { MOON_R_KM } from '../../glsl/common'
import type { SiteTerrain } from '../../camera/pose'
import { SM_CELL_M, SiteMax, type SiteLevel } from '../../ground/siteMax'
import { MAX_PATCH_LEVELS, MAX_PATCH_SAMPLERS } from './config'
import { fadeFor, levelMatrix, patchDetailWeightAt, patchHeightWeightAt } from './levels'
import { LoadProgress, fetchRetry, type ProgressSnapshot, type RetryOpts } from '../../net/load'
import { wantsLevel, type PatchDemand } from './demand'
import { validateManifest, sourceBytes, samplerCount, levelsWithinSamplerBudget, type PatchProvenance, type PatchAssetIntegrity } from './manifest'
import { fetchPatchAsset, fetchPatchQ16 } from './assets'
import { trackGpu } from '../../quality/track'
export { fadeFor, levelMatrix }

/** Hands the main thread back to the page between slices of a long loop (a frame is not held up by more than a few ms of it). */
const yieldToMain = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const SLICE = 1 << 20
/** A long loop works for about this long (ms), then hands the page a frame. Time-based: the frame itself can take 100 ms on a busy GPU, and a fixed slice of elements made each loop wait for dozens of them. Audit 6: at 24 ms the loops got a quarter of the thread (one slice per ~90 ms frame), and the descent crawled at 0.15x for 22 s while the large levels were converted; 60 ms halves that and keeps the frames at 8 per second or better. */
const SLICE_MS = 60
let sliceT = performance.now()
const due = (): boolean => performance.now() - sliceT > SLICE_MS
const resume = async (): Promise<void> => { await yieldToMain(); sliceT = performance.now() }
async function hasValue(a: Uint8Array, v: number): Promise<boolean> {
  for (let i = 0; i < a.length; i += SLICE) {
    if (a.subarray(i, i + SLICE).includes(v)) return true
    if (due()) await resume()
  }
  return false
}

/** Main-thread phase timings of the level loads (debug readout `__moon.patchTrace()`): each mark is the time since the one before it. */
export const patchTrace: Array<{ level: string; phase: string; at: number; ms: number }> = []
Object.assign(globalThis, { __patchTrace: patchTrace })
function tracer(level: string): (phase: string) => void {
  let last = performance.now()
  return (phase) => { const now = performance.now(); patchTrace.push({ level, phase, at: Math.round(now), ms: Math.round((now - last) * 10) / 10 }); last = now }
}

/**
 * A local high-resolution patch over the global tiles (scripts/build-patch.mts
 * writes it; ZOOM-SITE notes in RESEARCH-SITES.md). A site declares its own levels,
 * coarse to fine, in its manifest: each has an image detail texture and may have
 * heights (Apollo 11 and 17: 8 m heights and image, 2 m heights and image, and a
 * finest image only, at 0.5 or 0.6 m). The shader (moonShader.ts, PATCH_*) reads
 * them by metres east and north of the site, mixes their slopes over the global
 * slopes and multiplies the global albedo by their detail ratio, each level fading
 * in as a pixel gets smaller than its texel and out toward the edge of its
 * rectangle. The heights only feed the surface normal (slopes): the ground hit, the
 * shadow march and the absolute heights stay the global tiles'.
 *
 * A level taller or wider than the GPU's texture limit (some phones stop at 4096)
 * is resampled down at load to fit: the level then says its own, larger texel.
 */

export interface PatchLevel {
  name: string
  /** Absolute metres represented by encoded zero; each validated source keeps its own datum. */
  h0M?: number
  maxAltitudeKm?: number
  provenance?: PatchProvenance
  /** Missing/invalid pixels reject this level, leaving the complete coarser fallback. */
  nodata?: number
  w: number
  h: number
  texelM: number
  /** Left and top edge of the grid, metres east and north of the site. */
  eastM: number
  northM: number
  texelEastM: number
  texelNorthM: number
  heights?: string
  /**
   * 'f16x2': the heights file holds two half float rasters, a high part then the remainder (so the sum
   * carries about 22 bits, well under a millimetre). 'f32': one float32 raster (the 25 cm tier's 1.5 m
   * DTM), which the loader smooths to twice the density with a Catmull-Rom (bicubic) filter before it is
   * sampled bilinearly. Absent: one half float raster (Apollo 11).
   */
  heightFormat?: 'f16x2' | 'f32' | 'q16'
  /** Metres represented by one integer step for the q16 predictor/zig-zag encoding. */
  heightStepM?: number
  /** Absent on a heights-only level (the tier's DTM). */
  detail?: string
  /** A rotated grid (the 25 cm tier): the (east, north) metres of one texel step in x, and in y (which points south). */
  axisEastPerTexelM?: [number, number]
  axisSouthPerTexelM?: [number, number]
  /** The data's own texel (metres) where the drawn one is a resample of it (the tier's 1.5 m DTM is drawn at 0.75 m). */
  sourceTexelM?: number
  /** What sets the camera's floor when this level is the finest image (default texelM): the tier's is a compromise, see loadTier. */
  floorTexelM?: number
  /** Sun and provenance of a level under its own light (the tier's photograph). */
  light?: { label: string; elDeg: number; azFromNorthDeg: number; inferred: boolean }
}
export interface PatchManifest {
  version: number
  /** Runtime composition retains independently validated coarse provenance alongside legacy NAC. */
  heightBand?: PatchManifest
  capabilities?: ('continuous-mid-v1' | 'continuous-height-mid-v1')[]
  assets?: Record<string, PatchAssetIntegrity>
  site: { name: string; lat: number; lon: number; groundM: number }
  heightRangeM?: [number, number]
  h0M: number
  light: { time: string; sunElevationDeg: number; sunEastFromNorthDeg: number }
  levels: PatchLevel[]
  credit: string
  /** The optional finest tier (haase-tier.manifest.json) was found and added as the last two levels. */
  tier?: { credit: string; frameShiftEastNorthM: [number, number]; effectiveTexelM: number; light: { label: string; elDeg: number; azFromNorthDeg: number; inferred: boolean }; heightSourceTexelM: number; nativePixelM: [number, number] }
}

/** The floor's texel for the 25 cm tier: 25 cm resampled from native 27 cm across x 56 cm along track pixels, so 0.4 m, not 0.25 m. */
export const TIER_EFFECTIVE_TEXEL_M = 0.4

/** Catmull-Rom (bicubic) resample of a w by h float raster to 2w by 2h: the same grid origin, half the texel. */
export function upsample2x(src: Float32Array, w: number, h: number): Float32Array {
  const W = 2 * w, H = 2 * h
  const out = new Float32Array(W * H)
  const cr = (t: number): [number, number, number, number] => {
    const t2 = t * t, t3 = t2 * t
    return [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2]
  }
  const at = (x: number, y: number) => src[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))]
  for (let y = 0; y < H; y++) {
    const fy = (y + 0.5) / 2 - 0.5, y0 = Math.floor(fy), wy = cr(fy - y0)
    for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) / 2 - 0.5, x0 = Math.floor(fx), wx = cr(fx - x0)
      let v = 0
      for (let j = 0; j < 4; j++) {
        let row = 0
        for (let i = 0; i < 4; i++) row += wx[i] * at(x0 - 1 + i, y0 - 1 + j)
        v += wy[j] * row
      }
      out[y * W + x] = v
    }
  }
  return out
}

// Half float bits <-> number. The heights are stored as half floats (metres minus h0M).
let HALF_TABLE: Float32Array | null = null
function halfToFloat(h: number): number {
  if (!HALF_TABLE) {
    HALF_TABLE = new Float32Array(65536)
    const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer)
    for (let i = 0; i < 65536; i++) {
      const sign = (i & 0x8000) << 16, exp = (i >> 10) & 31, man = i & 1023
      if (exp === 0) { HALF_TABLE[i] = (sign ? -1 : 1) * man * 2 ** -24; continue }
      u32[0] = exp === 31 ? sign | 0x7f800000 | (man << 13) : sign | ((exp + 112) << 23) | (man << 13)
      HALF_TABLE[i] = f32[0]
    }
  }
  return HALF_TABLE[h]
}
const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer)
function floatToHalf(v: number): number {
  F32[0] = v
  const x = U32[0], sign = (x >>> 16) & 0x8000
  let e = ((x >>> 23) & 0xff) - 112
  const m = x & 0x7fffff
  if (e <= 0) {
    if (e < -10) return sign
    const mm = (m | 0x800000) >> (1 - e)
    return sign | ((mm + 0x1000) >> 13)
  }
  if (e >= 31) return sign | 0x7bff
  const r = ((e << 10) | (m >> 13)) + ((m & 0x1000) >> 12)
  e = r
  return sign | e
}

/** Bilinear resample of a w by h raster to nw by nh (values through `get`, results through `put`), edge-clamped. */
async function resample(w: number, h: number, nw: number, nh: number, get: (i: number) => number, put: (i: number, v: number) => void): Promise<void> {
  const sx = w / nw, sy = h / nh
  for (let y = 0; y < nh; y++) {
    if (due()) await resume()
    const fy = Math.max(0, Math.min(h - 1, (y + 0.5) * sy - 0.5))
    const y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ay = fy - y0
    for (let x = 0; x < nw; x++) {
      const fx = Math.max(0, Math.min(w - 1, (x + 0.5) * sx - 0.5))
      const x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), ax = fx - x0
      const top = get(y0 * w + x0) * (1 - ax) + get(y0 * w + x1) * ax
      const bot = get(y1 * w + x0) * (1 - ax) + get(y1 * w + x1) * ax
      put(y * nw + x, top * (1 - ay) + bot * ay)
    }
  }
}

/** The size a level is drawn at on a GPU whose textures stop at `maxTexture`: unchanged when it fits, else scaled (aspect kept) to fit. */
export function fittedSize(w: number, h: number, maxTexture: number): { w: number; h: number } {
  if (Math.max(w, h) <= maxTexture) return { w, h }
  const k = maxTexture / Math.max(w, h)
  return { w: Math.min(maxTexture, Math.max(1, Math.floor(w * k))), h: Math.min(maxTexture, Math.max(1, Math.floor(h * k))) }
}

async function validateHeights(values: Float32Array, nodata?: number): Promise<void> {
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (!Number.isFinite(v) || v === nodata) throw new Error('invalid/nodata height; retaining coarse fallback')
    if ((i & 4095) === 4095 && due()) await resume()
  }
}

function resizeLevel(lv: PatchLevel, w: number, h: number): void {
  const sx = lv.w / w, sy = lv.h / h
  lv.w = w; lv.h = h
  lv.texelEastM *= sx; lv.texelNorthM *= sy
  lv.texelM *= Math.sqrt(sx * sy)
  if (lv.axisEastPerTexelM && lv.axisSouthPerTexelM) {
    lv.axisEastPerTexelM = [lv.axisEastPerTexelM[0] * sx, lv.axisEastPerTexelM[1] * sx]
    lv.axisSouthPerTexelM = [lv.axisSouthPerTexelM[0] * sy, lv.axisSouthPerTexelM[1] * sy]
  }
}

export interface PatchOptions {
  /** Actual camera state at admission; never a selected future site alone. */
  initialDemand?: PatchDemand
  onResident?: (layer: PatchLayer) => void
  /** Uploads a finished raster in slices (see sliceUpload.ts). Absent: three uploads the texture whole on its first draw. */
  upload?: (texture: THREE.DataTexture, data: ArrayBufferView) => Promise<boolean>
  maxTexture?: number
  terrainCellM?: number
  tier?: boolean
  floatLinear?: boolean
  onProgress?: (s: ProgressSnapshot) => void
  net?: RetryOpts
  /** Raster input allocation cap. No remote cache or unbounded prefetch. */
  maxSourceBytes?: number
  /** CPU texture arrays plus estimated GPU allocation, including image mipmaps. */
  maxResidentBytes?: number
  /** Available patch sampler slots, after the Moon's six non-patch samplers. */
  maxSamplers?: number
}

export class PatchLayer {
  readonly manifest: PatchManifest
  /** The levels as drawn (coarse to fine): the manifest's, with any resampled to the GPU's texture limit. */
  readonly levels: PatchLevel[]
  /** Heights (R16F, metres minus h0M) and detail (R8) per level name. */
  readonly heights: Record<string, THREE.DataTexture> = {}
  readonly detail: Record<string, THREE.DataTexture> = {}
  /** The terrain model coarsened for the camera's floor and altitude (see SiteTerrain), when asked for. */
  terrain: SiteTerrain | null = null
  /** The patch's max-height grid for the ground pass's terrain hit (ground/siteMax.ts): every height level drawn is in it. */
  siteMax: SiteMax | null = null
  /** Unit vectors in the Moon body frame: the site, and its local east and north. */
  readonly site = new THREE.Vector3()
  readonly east = new THREE.Vector3()
  readonly north = new THREE.Vector3()
  /** Ground height at the site, radii from the 1 radius sphere (negative here). */
  readonly groundR: number

  revision = 0
  readyCoarse = false
  loading = false
  lastError: string | null = null
  private sources: PatchLevel[] = []
  private contexts = new Map<string, { base: string; h0M: number; assets?: Record<string, PatchAssetIntegrity> }>()
  private readonly gpuBytes = new WeakMap<THREE.DataTexture, number>()
  private base = ''
  private options: PatchOptions = {}
  private readonly progress = new LoadProgress()
  private controller: AbortController | null = null
  private disposed = false
  private desired = 0
  private activeIndex = -1
  private failed = new Set<number>()
  private pending: Promise<void> | null = null
  private externalAbort: (() => void) | null = null

  get availableLevels(): readonly PatchLevel[] { return this.sources }
  /** Names of the declared levels whose fetch failed (404, no data, integrity): their pictures are not there, so the camera floor must not count them. */
  get failedLevelNames(): string[] { return [...this.failed].map((i) => this.sources[i]?.name).filter((n): n is string => !!n) }
  get refinementPending(): boolean { return this.loading || (this.desired >= this.levels.length && !this.failed.has(this.levels.length)) }
  get residentBytes(): number {
    let n = this.terrain ? this.terrain.mean.byteLength + this.terrain.max.byteLength : 0
    for (const t of [...Object.values(this.heights), ...Object.values(this.detail)])
      n += (t.image.data?.byteLength ?? 0) + (this.gpuBytes.get(t) ?? 0)
    return n
  }
  get continuousHeightMidAvailable(): boolean { return this.manifest.heightBand?.capabilities?.includes('continuous-height-mid-v1') || this.manifest.capabilities?.includes('continuous-height-mid-v1') || false }
  get continuousMidAvailable(): boolean { return this.manifest.capabilities?.includes('continuous-mid-v1') ?? false }

  private constructor(m: PatchManifest) {
    this.manifest = m
    this.levels = m.levels.map((l) => ({ ...l }))
    const lon = m.site.lon * Math.PI / 180, lat = m.site.lat * Math.PI / 180
    this.site.set(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat))
    this.east.set(-Math.sin(lon), Math.cos(lon), 0)
    this.north.set(-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat))
    this.groundR = m.site.groundM / 1000 / MOON_R_KM
  }

  /**
   * The optional 25 cm tier around the lander (data/apollo17/haase-tier.manifest.json, from the Haase et al. LROC NAC
   * M168000580RE orthoimage and 1.5 m DTM): two more levels after the base ones, its DTM (heights only) then its image
   * detail. Absent or unreadable: the site is as before. eastM/northM already carry the +12.7 m east, +7.2 m north shift
   * that registers it to the base patch. The image is ratio detail (like L0), never albedo, and lit by the
   * runtime Sun: its own Sun (2011-08-14 22:35 UTC, 44.8 deg) is inferred from the spacecraft clock anchor, so the HUD says so.
   * Its native pixels are 27 cm across track by 56 cm along track, so the picture is not 25 cm in both directions; the camera
   * floor is set from an effective 0.4 m, a compromise between the two.
   */
  private async addTier(base: string, net: RetryOpts = {}): Promise<void> {
    let m: any
    try {
      // Optional: one quick retry for a dropped connection, none for a 404 (the site has no tier).
      const res = await fetchRetry(`${base}haase-tier.manifest.json`, { ...net, delaysMs: [700] })
      if (!res.ok) return
      m = await res.json()
    } catch { return }
    if (!m?.level?.detail || !m?.heights?.file || this.levels.length + 2 > MAX_PATCH_LEVELS) return
    const hv = m.heights, dv = m.level
    if (!m.sun) return
    const light = { label: m.sun.label as string, elDeg: m.sun.elDeg as number, azFromNorthDeg: m.sun.azFromNorthDeg as number, inferred: true }
    this.levels.push({
      name: 'L-1h', w: hv.w, h: hv.h, texelM: hv.texelM, eastM: hv.eastM, northM: hv.northM,
      texelEastM: Math.hypot(...(hv.axisEastPerTexelM as [number, number])), texelNorthM: Math.hypot(...(hv.axisSouthPerTexelM as [number, number])),
      heights: hv.file, heightFormat: 'f32', axisEastPerTexelM: hv.axisEastPerTexelM, axisSouthPerTexelM: hv.axisSouthPerTexelM,
    })
    this.levels.push({
      name: 'L-1', w: dv.w, h: dv.h, texelM: dv.texelM, eastM: dv.eastM, northM: dv.northM,
      texelEastM: Math.hypot(...(dv.axisEastPerTexelM as [number, number])), texelNorthM: Math.hypot(...(dv.axisSouthPerTexelM as [number, number])),
      detail: dv.detail, axisEastPerTexelM: dv.axisEastPerTexelM, axisSouthPerTexelM: dv.axisSouthPerTexelM,
      floorTexelM: TIER_EFFECTIVE_TEXEL_M, light,
    })
    try { validateManifest({ ...this.manifest, levels: this.levels, version: 1, capabilities: undefined }, MAX_PATCH_LEVELS) }
    catch { this.levels.splice(-2); return }
    this.manifest.tier = {
      credit: m.credit, frameShiftEastNorthM: m.frameShiftEastNorthM, effectiveTexelM: TIER_EFFECTIVE_TEXEL_M, light,
      heightSourceTexelM: hv.texelM, nativePixelM: [0.27, 0.56],
    }
  }

  level(name: string): PatchLevel {
    return this.levels.find((l) => l.name === name) as PatchLevel
  }
  /** The finest level (the last): the image the floor is set by. */
  get finest(): PatchLevel {
    return this.levels[this.levels.length - 1] ?? this.sources[0]
  }
  /** The finest level that has heights. */
  get finestHeights(): PatchLevel {
    return ([...this.levels].reverse().find((l) => l.heights) ?? this.sources.find(l => l.heights)) as PatchLevel
  }

  /** Loads just the coarsest fallback. Camera demand requests subsequent levels in order. */
  static async create(base: string, opts: PatchOptions = {}): Promise<PatchLayer> {
    const net = opts.net ?? {}
    const res = await fetchRetry(`${base}manifest.json`, { ...net, delaysMs: [] })
    const manifest = await res.json() as PatchManifest
    validateManifest(manifest, MAX_PATCH_LEVELS)
    const layer = new PatchLayer(manifest)
    layer.options = opts
    layer.base = base
    layer.progress.onChange = opts.onProgress ?? null
    if (opts.tier !== false && manifest.version === 1) await layer.addTier(base, { ...net, delaysMs: [] })
    const budgeted = levelsWithinSamplerBudget(layer.levels, opts.maxSamplers ?? MAX_PATCH_SAMPLERS)
    if (!budgeted.length) {
      layer.dispose()
      throw new Error(`patch sampler budget cannot fit the coarsest level (${opts.maxSamplers ?? MAX_PATCH_SAMPLERS} available)`)
    }
    layer.levels.splice(0, layer.levels.length, ...budgeted)
    layer.sources = layer.levels.splice(0)
    for (const l of layer.sources) layer.contexts.set(l.name, { base, h0M: manifest.h0M, assets: manifest.assets })
    const external = net.init?.signal
    if (external) {
      external.throwIfAborted()
      layer.externalAbort = () => layer.dispose()
      external.addEventListener('abort', layer.externalAbort, { once: true })
    }
    try {
      const coarse = layer.sources[0]
      if (coarse.texelM < 30 && (!opts.initialDemand || !wantsLevel(coarse, opts.initialDemand))) {
        layer.desired = -1
        return layer
      }
      await layer.loadIndex(0)
      layer.readyCoarse = true
      return layer
    } catch (e) { layer.dispose(); throw e }
  }

  /** Compose separately validated measured wide heights and legacy NAC; keep each datum/integrity origin explicit. */
  static compose(coarse: PatchLayer, fine: PatchLayer): PatchLayer {
    if (coarse.loading || fine.loading || fine.levels.length || coarse.disposed || fine.disposed)
      throw new Error('Compose only a settled coarse layer and manifest-only fine layer')
    if (Math.hypot(coarse.manifest.site.lon - fine.manifest.site.lon, coarse.manifest.site.lat - fine.manifest.site.lat) > .001)
      throw new Error('Wide/NAC site registration mismatch')
    if (!coarse.continuousHeightMidAvailable) throw new Error('Wide layer lacks independently validated measured height capability')
    const combined = [...coarse.sources, ...fine.sources]
    if (combined.length > MAX_PATCH_LEVELS || new Set(combined.map(l => l.name)).size !== combined.length)
      throw new Error('Wide/NAC level capacity/name collision')
    const layer = new PatchLayer({ ...fine.manifest, heightBand: coarse.manifest })
    layer.levels.splice(0)
    const selected = levelsWithinSamplerBudget(combined, fine.options.maxSamplers ?? MAX_PATCH_SAMPLERS)
    if (!selected.length) throw new Error('Wide/NAC sampler budget cannot fit the coarse fallback')
    const selectedNames = new Set(selected.map((l) => l.name))
    layer.sources = selected
    layer.options = fine.options
    layer.base = fine.base
    layer.contexts = new Map([...coarse.contexts, ...fine.contexts])
    for (const l of coarse.levels) if (selectedNames.has(l.name)) layer.levels.push(l)
    for (const [name, t] of Object.entries(coarse.heights)) {
      if (!selectedNames.has(name)) continue
      layer.heights[name] = t
      layer.ownTexture(t, false)
      delete coarse.heights[name]
    }
    for (const [name, t] of Object.entries(coarse.detail)) {
      if (!selectedNames.has(name)) continue
      layer.detail[name] = t; layer.ownTexture(t, true); delete coarse.detail[name]
    }
    layer.terrain = coarse.terrain; coarse.terrain = null
    // The band's heights must reach the combined layer's grid: carry the copies across (a grid the band layer already built cannot be re-fed).
    layer.siteSnaps = coarse.siteSnaps; coarse.siteSnaps = []
    layer.siteMaxLost = coarse.siteMaxLost || coarse.siteMax !== null
    layer.readyCoarse = layer.levels.length > 0
    layer.revision = 1; layer.desired = layer.levels.length - 1
    coarse.dispose(); fine.dispose()
    const external = layer.options.net?.init?.signal
    if (external) {
      external.throwIfAborted()
      layer.externalAbort = () => layer.dispose()
      external.addEventListener('abort', layer.externalAbort, { once: true })
    }
    return layer
  }

  /** GPU allocation remains counted after CPU upload bytes are released; context recovery recreates the layer. */
  private ownTexture(texture: THREE.DataTexture, detail: boolean): void {
    const channels = texture.format === THREE.RGFormat ? 2 : 1
    const bytesPerChannel = texture.type === THREE.FloatType ? 4 : texture.type === THREE.HalfFloatType ? 2 : 1
    const gpu = texture.image.width * texture.image.height * channels * bytesPerChannel * (detail ? 4 / 3 : 1)
    this.gpuBytes.set(texture, Math.ceil(gpu))
    trackGpu('patch', detail ? 'detail' : 'heights', Math.ceil(gpu), texture)
    texture.onUpdate = () => { texture.image.data = null }
  }

  /** Puts a finished raster on the GPU: in slices when the page gave an uploader (it may not be ready before this resolves), else three does it on first draw. */
  private async upload(t: THREE.DataTexture): Promise<void> {
    const data = t.image.data as ArrayBufferView | null
    if (this.options.upload && data && await this.options.upload(t, data)) return
    t.needsUpdate = true
  }

  /** Updates camera demand without starting duplicate requests. Returns when this queue settles. */
  updateDemand(demand: PatchDemand): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.desired = this.sources[0].texelM >= 30 || wantsLevel(this.sources[0], demand, this.levels.length > 0) ? 0 : -1
    for (let i = 1; i < this.sources.length; i++) {
      if (this.desired < 0 || !wantsLevel(this.sources[i], demand, i < this.levels.length)) break
      this.desired = i
    }
    if (demand.hold) this.desired = Math.max(this.desired, this.levels.length - 1, this.activeIndex)
    if (this.activeIndex > this.desired) this.controller?.abort()
    // Evict fine textures on zoom out. Retain the complete coarse chain for missing-data fallback.
    while (this.levels.length > this.desired + 1) {
      const l = this.levels.pop()!
      this.heights[l.name]?.dispose(); this.detail[l.name]?.dispose()
      delete this.heights[l.name]; delete this.detail[l.name]
      this.readyCoarse = this.levels.length > 0
      this.revision++
      this.options.onResident?.(this)
    }
    if (!this.pending) {
      this.pending = this.refine().finally(() => { this.pending = null })
    }
    return this.pending
  }

  /** Stop aborts the in-flight refinement, retaining the last usable resident chain. */
  cancelRefinement(): void {
    this.desired = Math.max(-1, this.levels.length - 1)
    this.controller?.abort()
  }

  /** Explicit retry only: a missing tier never generates a request storm each animation frame. */
  retryRefinement(): void { this.failed.clear(); this.lastError = null }

  private async refine(): Promise<void> {
    while (!this.disposed && this.levels.length <= this.desired) {
      const index = this.levels.length
      if (this.failed.has(index)) break
      try { await this.loadIndex(index) }
      catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError') && (e as Error).message !== 'stale patch level' && !this.disposed) {
          this.failed.add(index)
          this.lastError = (e as Error).message
        }
        break
      }
    }
  }

  private async loadIndex(index: number): Promise<void> {
    const source = this.sources[index]
    if (!source) return
    if (sourceBytes(source) > (this.options.maxSourceBytes ?? 128 * 1024 * 1024)) throw new Error(`${source.name}: source byte budget exceeded`)
    if (samplerCount([...this.levels, source]) > (this.options.maxSamplers ?? MAX_PATCH_SAMPLERS)) throw new Error(`${source.name}: patch sampler budget exceeded`)
    // Fit to both hardware and a conservative resident budget before allocating.
    const remaining = (this.options.maxResidentBytes ?? 192 * 1024 * 1024) - this.residentBytes
    const bytesPerPixel = (source.heights ? 8 : 0) + (source.detail ? 7 / 3 : 0)
    const budgetEdge = Math.floor(Math.sqrt(Math.max(0, remaining) / bytesPerPixel))
    if (budgetEdge < 32) throw new Error(`${source.name}: resident byte budget exceeded`)
    const maxTexture = Math.min(this.options.maxTexture ?? 4096, budgetEdge)
    const lv: PatchLevel = { ...source }
    const controller = new AbortController()
    this.controller = controller
    this.activeIndex = index
    this.loading = true
    const net = { ...this.options.net, init: { ...this.options.net?.init, signal: controller.signal } }
    try {
      await this.loadLevel(lv, maxTexture, net)
      controller.signal.throwIfAborted()
      if (this.disposed || index > this.desired) throw new Error('stale patch level')
      this.levels.push(lv)
      if (index === 0) this.readyCoarse = true
      this.revision++
      this.options.onResident?.(this)
    } catch (e) {
      this.heights[lv.name]?.dispose(); this.detail[lv.name]?.dispose()
      delete this.heights[lv.name]; delete this.detail[lv.name]
      throw e
    } finally { this.loading = false; this.activeIndex = -1; this.controller = null }
  }

  private async loadLevel(lv: PatchLevel, maxTexture: number, net: RetryOpts): Promise<void> {
    const context = this.contexts.get(lv.name) ?? { base: this.base, h0M: this.manifest.h0M, assets: this.manifest.assets }
    const base = context.base, progress = this.progress, opts = this.options
    lv.h0M = context.h0M
    const mark = tracer(lv.name)
      const fit = fittedSize(lv.w, lv.h, maxTexture)
      const w0 = lv.w, h0 = lv.h
      if (lv.heights && (lv.heightFormat === 'f32' || lv.heightFormat === 'q16')) {
        // The tier's DTM: float32 metres minus h0M on a 1.5 m grid, smoothed to 0.75 m (bicubic) and stored as two half floats.
        const rawBytes = lv.w * lv.h * (lv.heightFormat === 'q16' ? 2 : 4)
        const f = lv.heightFormat === 'q16'
          ? await fetchPatchQ16(`${base}${lv.heights}`, lv.w, lv.h, lv.heightStepM!, progress, net, context.assets?.[lv.heights])
          : new Float32Array((await fetchPatchAsset(`${base}${lv.heights}`, rawBytes, progress, net, context.assets?.[lv.heights])).buffer)
        mark(lv.heightFormat === 'q16' ? 'fetch-decode-q16' : 'fetch-f32-copy')
        await validateHeights(f, lv.nodata)
        mark('validate-f32')
        if (opts.terrainCellM) this.terrain = await this.coarsen(i => f[i], lv, opts.terrainCellM)
        mark('coarsen-f32')
        const scale = !lv.detail && lv.texelM < 2 ? 2 : 1
        const target = fittedSize(lv.w * scale, lv.h * scale, maxTexture)
        const up = target.w === lv.w * 2 && target.h === lv.h * 2 ? upsample2x(f, lv.w, lv.h) : new Float32Array(target.w * target.h)
        if (up.length === target.w * target.h && (target.w !== lv.w * 2 || target.h !== lv.h * 2))
          await resample(lv.w, lv.h, target.w, target.h, (i) => f[i], (i, v) => { up[i] = v })
        mark('upsample')
        await validateHeights(up, lv.nodata)
        mark('validate-up')
        { const off = lv.h0M ?? this.manifest.h0M; await this.noteHeights(lv, target.w, target.h, (i) => up[i] + off) }
        let t: THREE.DataTexture
        if (opts.floatLinear) {
          // A float32 raster filtered in float32: the half float pair below is filtered by the GPU with a rounded result on some parts,
          // which draws a contour line at every 0.5 m of height (where the values pass 512).
          t = new THREE.DataTexture(up, target.w, target.h, THREE.RedFormat, THREE.FloatType)
        } else {
          const rg = new Uint16Array(up.length * 2)
          for (let i = 0; i < up.length; i++) {
            const hi = floatToHalf(up[i])
            rg[2 * i] = hi
            rg[2 * i + 1] = floatToHalf(up[i] - halfToFloat(hi))
            if ((i & 4095) === 4095 && due()) await resume()
          }
          t = new THREE.DataTexture(rg, target.w, target.h, THREE.RGFormat, THREE.HalfFloatType)
        }
        t.minFilter = t.magFilter = THREE.LinearFilter
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
        t.generateMipmaps = false
        mark('half-pack')
        this.ownTexture(t, false)
        await this.upload(t)
        this.heights[lv.name] = t
        lv.sourceTexelM = lv.texelM
        resizeLevel(lv, target.w, target.h)
      } else if (lv.heights) {
        const bytes = await fetchPatchAsset(`${base}${lv.heights}`, lv.w * lv.h * (lv.heightFormat ? 4 : 2), progress, net, context.assets?.[lv.heights])
        mark('fetch-heights')
        const n = lv.w * lv.h
        const two = lv.heightFormat === 'f16x2'
        // hi: the half float heights; lo: the remainder (zero for a single raster).
        let hi = new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + n * 2))
        let lo: Uint16Array | null = two ? new Uint16Array(bytes.buffer.slice(bytes.byteOffset + n * 2, bytes.byteOffset + n * 4)) : null
        for (let i = 0; i < n; i++) {
          const value = halfToFloat(hi[i]) + (lo ? halfToFloat(lo[i]) : 0)
          if (!Number.isFinite(value) || value === lv.nodata) throw new Error(`${lv.name}: invalid/nodata height; retaining coarse fallback`)
          if ((i & 4095) === 4095 && due()) await resume()
        }

        mark('check-f16')
        if (opts.terrainCellM) this.terrain = await this.coarsen((i) => halfToFloat(hi[i]) + (lo ? halfToFloat(lo[i]) : 0), lv, opts.terrainCellM)
        mark('coarsen-f16')
        if (fit.w !== w0 || fit.h !== h0) {
          const oh = new Uint16Array(fit.w * fit.h), ol = two ? new Uint16Array(fit.w * fit.h) : null
          const full = new Float32Array(fit.w * fit.h)
          const h0a = hi, l0a = lo
          await resample(w0, h0, fit.w, fit.h, (i) => halfToFloat(h0a[i]) + (l0a ? halfToFloat(l0a[i]) : 0), (i, v) => { full[i] = v })
          for (let i = 0; i < full.length; i++) {
            oh[i] = floatToHalf(full[i])
            if (ol) ol[i] = floatToHalf(full[i] - halfToFloat(oh[i]))
            if ((i & 4095) === 4095 && due()) await resume()
          }
          hi = oh
          lo = ol
        }
        { const off = lv.h0M ?? this.manifest.h0M, fh = hi, fl = lo; await this.noteHeights(lv, fit.w, fit.h, (i) => halfToFloat(fh[i]) + (fl ? halfToFloat(fl[i]) : 0) + off) }
        let t: THREE.DataTexture
        if (lo && opts.floatLinear) {
          // The two parts summed into one float32 raster (the same four bytes a texel): filtered in float32, so no contour lines (see the tier's DTM).
          const f = new Float32Array(hi.length)
          for (let i = 0; i < f.length; i++) { f[i] = halfToFloat(hi[i]) + halfToFloat(lo[i]); if ((i & 4095) === 4095 && due()) await resume() }
          t = new THREE.DataTexture(f, fit.w, fit.h, THREE.RedFormat, THREE.FloatType)
        } else if (lo) {
          const rg = new Uint16Array(fit.w * fit.h * 2)
          for (let i = 0; i < hi.length; i++) { rg[2 * i] = hi[i]; rg[2 * i + 1] = lo[i]; if ((i & 4095) === 4095 && due()) await resume() }
          t = new THREE.DataTexture(rg, fit.w, fit.h, THREE.RGFormat, THREE.HalfFloatType)
        } else t = new THREE.DataTexture(hi, fit.w, fit.h, THREE.RedFormat, THREE.HalfFloatType)
        t.minFilter = t.magFilter = THREE.LinearFilter
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
        t.generateMipmaps = false
        this.ownTexture(t, false)
        await this.upload(t)
        this.heights[lv.name] = t
      }
      if (!lv.detail) {
        if (lv.heightFormat !== 'f32' && lv.heightFormat !== 'q16') resizeLevel(lv, fit.w, fit.h)
        return
      }
      let d = await fetchPatchAsset(`${base}${lv.detail}`, w0 * h0, progress, net, context.assets?.[lv.detail])
      mark('fetch-detail')
      if (lv.nodata !== undefined && await hasValue(d, lv.nodata)) throw new Error(`${lv.name}: nodata detail; retaining coarse fallback`)
      if (fit.w !== w0 || fit.h !== h0) {
        const out = new Uint8Array(fit.w * fit.h)
        await resample(w0, h0, fit.w, fit.h, (i) => d[i], (i, v) => { out[i] = Math.max(1, Math.min(255, Math.round(v))) })
        d = out
      }
      resizeLevel(lv, fit.w, fit.h)
      if (lv.nodata !== undefined && (fit.w !== w0 || fit.h !== h0) && await hasValue(d, lv.nodata)) throw new Error(`${lv.name}: nodata detail; retaining coarse fallback`)
      const t = new THREE.DataTexture(d, lv.w, lv.h, THREE.RedFormat, THREE.UnsignedByteType)
      t.minFilter = THREE.LinearMipmapLinearFilter
      t.magFilter = THREE.LinearFilter
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
      t.generateMipmaps = true
      t.unpackAlignment = 1
      this.ownTexture(t, true)
      await this.upload(t)
      this.detail[lv.name] = t
      mark('detail-texture')
  }


  /** Heights of levels noted before the grid's extent could be chosen (the wide band, noted before `compose` adds the fine layer), kept to be fed to the grid later. */
  private siteSnaps: { level: SiteLevel; z: Float32Array }[] = []
  /** Set when a grid was built from a layer that `compose` then replaced: its levels cannot be re-fed, so this layer builds none (the ground pass then marches as before). */
  private siteMaxLost = false

  /**
   * Feeds a height level's final raster (w x h, the size it is drawn at; `at` absolute metres) to the ground hit's max grid.
   * The grid covers the finest level's rectangle (a wide band as the grid's frame would be 4736 x 4736 cells), but every level's heights that
   * fall inside it count, the band's too: the shader blends the band into the fine level's edge ring, so a bound without it is not a bound.
   */
  private async noteHeights(lv: PatchLevel, w: number, h: number, at: (i: number) => number): Promise<void> {
    if (typeof location === 'undefined' || new URLSearchParams(location.search).get('hit') !== 'mm' || this.siteMaxLost) return
    const sx = lv.w / w, sy = lv.h / h
    const level: SiteLevel = {
      eastM: lv.eastM, northM: lv.northM, w, h, texelEastM: lv.texelEastM * sx, texelNorthM: lv.texelNorthM * sy,
      ...(lv.axisEastPerTexelM && lv.axisSouthPerTexelM ? { axisEastPerTexelM: [lv.axisEastPerTexelM[0] * sx, lv.axisEastPerTexelM[1] * sx] as [number, number], axisSouthPerTexelM: [lv.axisSouthPerTexelM[0] * sy, lv.axisSouthPerTexelM[1] * sy] as [number, number] } : {}),
    }
    if (!this.siteMax) {
      const area = (l: PatchLevel): number => l.w * l.texelEastM * l.h * l.texelNorthM
      let frame: PatchLevel | null = null, extent: PatchLevel | null = null
      for (const l of this.sources) {
        if (!l.heights) continue
        if (!frame || area(l) > area(frame)) frame = l
        if (l.texelM <= SM_CELL_M && (!extent || area(l) > area(extent))) extent = l
      }
      if (!frame) return
      if (!extent) {
        // Only coarse levels so far (the wide band before `compose`): keep a copy until a fine level's rectangle is known.
        const z = new Float32Array(w * h)
        for (let i = 0; i < z.length; i++) { z[i] = at(i); if ((i & 4095) === 4095 && due()) await resume() }
        this.siteSnaps.push({ level, z })
        return
      }
      const asLevel = (l: PatchLevel): SiteLevel => ({ eastM: l.eastM, northM: l.northM, w: l.w, h: l.h, texelEastM: l.texelEastM, texelNorthM: l.texelNorthM, ...(l.axisEastPerTexelM && l.axisSouthPerTexelM ? { axisEastPerTexelM: l.axisEastPerTexelM, axisSouthPerTexelM: l.axisSouthPerTexelM } : {}) })
      // The shader's ring is measured with the texel the level has AFTER resizeLevel (a smaller raster means a larger texel, and `fadeFor` is not monotonic),
      // which this frame level may not have had yet: take the widest ring over every texel it could end up with. A wider ring only opens more cells.
      const fadeM = Math.max(...[1, 1.5, 2, 3, 4, 8].map((k) => fadeFor(frame.texelM * k)), fadeFor(frame === lv ? lv.texelM * Math.sqrt(sx * sy) : frame.texelM))
      const sm = new SiteMax(asLevel(frame), fadeM, asLevel(extent))
      for (const snap of this.siteSnaps) await sm.addLevel(snap.level, (i) => snap.z[i], async () => { if (due()) await resume() })
      this.siteSnaps = []
      this.siteMax = sm
    }
    await this.siteMax.addLevel(level, at, async () => { if (due()) await resume() })
  }

  /** Mean and cell-neighbourhood maximum of a level's heights on square cells of about `cellM` metres, in radii from the sphere. */
  private async coarsen(at: (i: number) => number, lv: PatchLevel, cellM: number): Promise<SiteTerrain> {
    const bx = Math.max(1, Math.round(cellM / lv.texelEastM)), by = Math.max(1, Math.round(cellM / lv.texelNorthM))
    const w = Math.ceil(lv.w / bx), h = Math.ceil(lv.h / by)
    const mean = new Float32Array(w * h), max = new Float32Array(w * h)
    const k = 1 / 1000 / MOON_R_KM
    for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
      if (cx === 0 && due()) await resume()
      let sum = 0, n = 0, hi = -Infinity
      for (let y = cy * by; y < Math.min(lv.h, (cy + 1) * by); y++) for (let x = cx * bx; x < Math.min(lv.w, (cx + 1) * bx); x++) {
        const v = at(y * lv.w + x)
        sum += v; n++
        if (v > hi) hi = v
      }
      mean[cy * w + cx] = (sum / n + (lv.h0M ?? this.manifest.h0M)) * k
      max[cy * w + cx] = (hi + (lv.h0M ?? this.manifest.h0M)) * k
    }
    const dil = new Float32Array(max)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = max[y * w + x]
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && max[yy * w + xx] > m) m = max[yy * w + xx]
      }
      dil[y * w + x] = m
    }
    return { eastM: lv.eastM, northM: lv.northM, cellM: bx * lv.texelEastM, cellNorthM: by * lv.texelNorthM, w, h, mean, max: dil }
  }

  /** Where a body-frame point sits on the site's tangent plane, metres (east, north). */
  metresFromSite(bodyX: number, bodyY: number, bodyZ: number): [number, number] {
    const dx = bodyX - this.site.x, dy = bodyY - this.site.y, dz = bodyZ - this.site.z
    const R = MOON_R_KM * 1000
    return [(dx * this.east.x + dy * this.east.y + dz * this.east.z) * R, (dx * this.north.x + dy * this.north.y + dz * this.north.z) * R]
  }

  /**
   * True when (lon, lat) in degrees is within `radiusM` of the 25 cm tier's centre. The HUD asks with the camera's nadir and a radius
   * larger than the tier's half width: an oblique view from a kilometre back is still looking at the tier.
   */
  tierNear(lonDeg: number, latDeg: number, radiusM: number): boolean {
    const l = this.levels.find((v) => v.name === 'L-1')
    if (!l || !this.manifest.tier) return false
    const lo = lonDeg * Math.PI / 180, la = latDeg * Math.PI / 180
    const [e, n] = this.metresFromSite(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la))
    const cE = l.eastM + 0.5 * l.w * l.texelEastM, cN = l.northM - 0.5 * l.h * l.texelNorthM
    return Math.hypot(e - cE, n - cN) <= radiusM
  }

  /** Image or shaded-height levels with positive shader weight at a visible surface sample. */
  sourceLevelsAt(lonDeg: number, latDeg: number, fpM: number): string[] {
    const lo = lonDeg * Math.PI / 180, la = latDeg * Math.PI / 180
    const [eastM, northM] = this.metresFromSite(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la))
    return this.levels.filter((level) => patchDetailWeightAt(level, eastM, northM, fpM, !!this.detail[level.name]) > 0
      || patchHeightWeightAt(level, eastM, northM, fpM, !!this.heights[level.name], !(level.name === 'L-1h' && new URLSearchParams(location.search).get('tierdtm') === 'off')) > 0).map((level) => level.name)
  }

  dispose(): void {
    this.disposed = true
    this.controller?.abort()
    if (this.externalAbort) this.options.net?.init?.signal?.removeEventListener('abort', this.externalAbort)
    for (const t of [...Object.values(this.heights), ...Object.values(this.detail)]) t.dispose()
  }
}

/**
 * Idle prefetch: the manifest and the coarsest `count` levels' files of a site, held in memory for the real load
 * (net/load.ts `fetchBytesCached`). The coarse levels are what the descent needs first and the smallest part of
 * the download; the 0.5 m image is left for the real load. Failures are silent: the real load retries and reports.
 */
export async function prefetchPatch(base: string): Promise<void> {
  // Metadata only. Coarse and fine raster requests are owned by a camera-demanded layer.
  try {
    const res = await fetchRetry(`${base}manifest.json`, { delaysMs: [] })
    validateManifest(await res.json() as PatchManifest, MAX_PATCH_LEVELS)
  } catch { /* the real load will say */ }
}
