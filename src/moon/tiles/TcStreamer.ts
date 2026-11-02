import * as THREE from 'three'
import { FailureBook, isPermanentFailure, settleJob } from './jobBook'
import { HttpError } from '../../net/load'
import { withTightUnpack, type PixelStoreState } from './unpack'
import { span } from '../../perf/perf'
import { ABL } from '../../abl'
import { fadeBatchMs, fadeInFrom, fadeInLevel, fadeOutLevel, fadeOutOn, fadeStartAt } from './fades'
import { type StreamView, type Want, computeWanted, wantResidency, uploadsThisFrame, inflightCap, wantedMemoKey, wantedMemoValid, FLIGHT_WANTED_MS, mayPump, takeReady } from './wanted'
import { C_SIZE, detailPath, levelNx, levelNy, tileIndex, tileOf } from './grid'
import { detailTexelKm } from './detail'
import { presenceAt } from './levels'
import { decodeGrey } from './greyDecode'
import { GpuGroup } from '../../quality/track'
import { textureBytes } from '../../quality/ledger'
import { neighbourMask } from './feather'
import { ParkWake, parkMsOf, parkingOn, tcWantCap } from './capacity'
import { abortAllJobs } from './abortJobs'
import {
  TC_CAPACITY, TC_FADE_MS, TC_LEVELS, TC_PAGE_H, TC_PAGE_W, tcBase, tcRow, tcSourceAt, validateTcManifest, type TcManifest,
} from './tcDetail'

const MAX_INFLIGHT = 4
const MAX_INFLIGHT_FLIGHT = 8
const UNWANTED_ABORT_MS = 1500

interface Slot { layer: number; key: number; level: number; tx: number; ty: number; lastWanted: number; readyAt: number
  /** Left the wanted set: layer and data kept, page entry cleared (the shader draws the WAC detail there again). */
  parked: boolean
  /** Parked, but still paged while its fade falls from `leaveFrom` (0..1, set at `leaveAt`) to 0; see fades.ts. */
  leaving: boolean
  leaveFrom: number
  leaveAt: number
}
interface Job { key: number; level: number; tx: number; ty: number; abort: AbortController; lastWanted: number }

/**
 * Streams the JAXA TC detail-ratio tiles (levels -3, -4, -5; tcDetail.ts) into an R8 texture array and an RGBA8 page table
 * (r = layer + 1, g = fade 0..255, a = absent-neighbour mask). Same shape as DetailStreamer, but sparse and opt-in: the base comes from `?tc=`,
 * the manifest `tc.json` lists the tiles that exist, and nothing is created without both.
 */
export class TcStreamer {
  readonly tex: THREE.ExternalTexture
  readonly page: THREE.DataTexture
  onChange: () => void = () => {}
  readonly stats = { requested: 0, loaded: 0, failed: 0, evicted: 0, parked: 0, unparked: 0, bytes: 0, failedUrls: [] as string[] }
  wantedByLevel: Record<string, number> = {}
  /**
   * Slots that leave the wanted set are parked (page entry cleared, layer and data kept) and paged again with the arrival fade when wanted, so the layers
   * past `wantCap` are history that is not drawn (the shader replaces the WAC detail wherever a TC tile is paged, moonShader.ts). Off with no history
   * (want = capacity - 2, the 96-layer cache) and with `?park=0`.
   */
  readonly parking: boolean
  /** Unwanted this long (ms) before a slot is parked (`?parkms=`). */
  parkMs: number
  private readonly parkWake = new ParkWake()

  private readonly gl: WebGL2RenderingContext
  private readonly glT: WebGLTexture
  readonly pageData = new Uint8Array(TC_PAGE_W * TC_PAGE_H * 4)
  private readonly bySlotKey = new Map<number, Slot>()
  private readonly jobs = new Map<number, Job>()
  private readonly failed = new FailureBook()
  private readonly ready: Array<{ job: Job; mips: Uint8Array[] }> = []
  private readonly free: number[] = []
  private readonly touched = new Set<number>()
  private disposed = false
  private readonly gpuLedger = new GpuGroup('tc')

  /** Fetches `<base>tc.json`; null (never a throw) when `?tc=` is absent, the manifest is missing or unreadable. */
  static async create(renderer: THREE.WebGLRenderer, signal?: AbortSignal, search?: string, capacity: number = TC_CAPACITY): Promise<TcStreamer | null> {
    const base = tcBase(search)
    if (!base) return null
    try {
      const res = await fetch(`${base}tc.json`, { signal })
      if (!res.ok) throw new Error(`tc.json ${res.status}`)
      const man = validateTcManifest(await res.json())
      if (!man) throw new Error('unreadable tc.json')
      const gl = renderer.getContext() as WebGL2RenderingContext
      const cap = Math.max(8, Math.min(capacity, gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number, 254))
      const q = search ?? (globalThis as { location?: { search?: string } }).location?.search ?? ''
      return new TcStreamer(renderer, base, man, cap, tcWantCap(cap, q), new URLSearchParams(q).get('park') !== '0', parkMsOf(q))
    } catch (err) {
      console.warn('TC detail disabled:', (err as Error).message)
      return null
    }
  }

  private constructor(private readonly renderer: THREE.WebGLRenderer, private readonly base: string, readonly man: TcManifest, readonly capacity: number, readonly wantCap: number = capacity - 2, parkSwitch = true, parkMs: number = parkMsOf('')) {
    this.parkMs = parkMs
    this.parking = parkingOn(parkSwitch, wantCap, capacity - 2)
    const gl = renderer.getContext() as WebGL2RenderingContext
    this.gl = gl
    for (let i = capacity - 1; i >= 0; i--) this.free.push(i)
    const state = renderer.state
    const t = gl.createTexture() as WebGLTexture
    state.bindTexture(gl.TEXTURE_2D_ARRAY, t)
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.floor(Math.log2(C_SIZE)) + 1, gl.R8, C_SIZE, C_SIZE, capacity)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const ext = gl.getExtension('EXT_texture_filter_anisotropic')
    if (ext) gl.texParameterf(gl.TEXTURE_2D_ARRAY, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number))
    state.unbindTexture()
    this.glT = t
    this.tex = new THREE.ExternalTexture(t)
    this.page = new THREE.DataTexture(this.pageData, TC_PAGE_W, TC_PAGE_H, THREE.RGBAFormat, THREE.UnsignedByteType)
    this.page.internalFormat = 'RGBA8'
    this.page.minFilter = this.page.magFilter = THREE.NearestFilter
    this.page.generateMipmaps = false
    this.page.needsUpdate = true
    // R8 array with the full chain, and the RGBA8 page table (as large as the cache itself: SPEC 1.1).
    this.gpuLedger.add('array', textureBytes(C_SIZE, C_SIZE, 1, { layers: capacity, mips: true }))
    this.gpuLedger.add('page-table', TC_PAGE_W * TC_PAGE_H * 4)
  }

  /** Read-only: does a TC tile contribute at this surface point (Credits panel). */
  sourceAt(lonDeg: number, latDeg: number, fpKm: number, gate = 1): boolean { return tcSourceAt(this.pageData, lonDeg, latDeg, fpKm, gate) }

  /**
   * Ground size (km) of the finest TC texel the manifest lists under a point; Infinity where it lists none. The camera floor follows it
   * (main.ts applyFloor): the TC picture is finer than the height tiles, so the SLDEM floor would otherwise keep the camera above it.
   */
  texelKmAt(lonDeg: number, latDeg: number): number {
    for (let i = TC_LEVELS.length - 1; i >= 0; i--) {
      const l = TC_LEVELS[i]
      const { tx, ty } = tileOf(l, lonDeg, latDeg)
      if (this.present(l, tileIndex(l, tx, ty))) return detailTexelKm(l)
    }
    return Infinity
  }

  /** Ground size (km) of the finest TC texel DRAWN under a point: a tile counts only once it is resident and fully faded in; Infinity where none is. */
  residentTexelKmAt(lonDeg: number, latDeg: number): number {
    for (let i = TC_LEVELS.length - 1; i >= 0; i--) {
      const l = TC_LEVELS[i]
      const { tx, ty } = tileOf(l, lonDeg, latDeg)
      const key = this.keyOf(l, tx, ty)
      const s = this.bySlotKey.get(key)
      if (s && !s.parked && this.pageData[4 * key] > 0 && this.pageData[4 * key + 1] >= 255) return detailTexelKm(l)
    }
    return Infinity
  }

  private present(level: number, index: number): boolean {
    const e = this.man.levels.find((x) => x.level === level)
    return !!e && presenceAt(e, index)
  }
  private keyOf(level: number, tx: number, ty: number): number { return (tcRow(level) + ty) * TC_PAGE_W + tx }
  get resident(): number { return this.bySlotKey.size }
  get inflight(): number { return this.jobs.size }
  /** Tiles the server said are not there (404/403/410): never asked for again this session. */
  get absentTiles(): number { return this.failed.absentCount }
  get busy(): boolean { return this.touched.size > 0 || this.ready.length > 0 || this.jobs.size > 0 }

  /** The app went to the background: every request in flight is aborted and forgotten (see TileStreamer.abortInFlight). */
  abortInFlight(): number {
    const n = abortAllJobs(this.jobs.values())
    this.jobs.clear()
    return n
  }
  completeFadesForCapture(now: number): void {
    for (const s of this.bySlotKey.values()) {
      if (s.leaving) this.finishLeave(s)
      if (s.parked) continue
      s.readyAt = now - TC_FADE_MS
      const i = 4 * s.key + 1
      if (this.pageData[i] !== 255) { this.pageData[i] = 255; this.touched.add(s.key) }
    }
  }
  captureFadeSignature(): number {
    let hash = 2166136261
    for (const w of this.wantedMemo?.values() ?? []) hash = Math.imul(hash ^ this.pageData[4 * w.key + 1] ^ w.key, 16777619)
    return hash >>> 0
  }
  /** Measurement only (?wantprobe=1): see TileStreamer.exactResidency. */
  exactResidency(v: StreamView): { wanted: number; resident: number; stale: number } {
    let exact = computeWanted(v, { deepest: -5, isPresent: (l, i) => (TC_LEVELS as readonly number[]).includes(l) && this.present(l, i), keyOf: (l, tx, ty) => this.keyOf(l, tx, ty) })
    if (exact.size > this.wantCap) exact = new Map([...exact.values()].sort((a, b) => a.keep - b.keep).slice(0, Math.max(1, this.wantCap)).map((w) => [w.key, w]))
    return wantResidency(exact, this.wantedMemo, (k) => this.bySlotKey.has(k))
  }
  /**
   * The focus pull indicator's detail signal (focusPull.ts detailLoading): the share of the wanted tiles that are not resident yet and still on their way
   * (not backed off after a failure), 0 while nothing is in flight. A share of tiles, not of the frame: the want is the frame's own ray grid.
   */
  missingShare(now: number): number {
    const w = this.wantedMemo
    if (!w || w.size === 0 || this.jobs.size === 0) return 0
    let missing = 0
    for (const x of w.values()) if (!this.bySlotKey.has(x.key) && this.failed.allows(x.key, now)) missing++
    return missing / w.size
  }
  wantedResidentByLevel(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const w of this.wantedMemo?.values() ?? []) if (this.bySlotKey.has(w.key)) out[w.level] = (out[w.level] ?? 0) + 1
    return out
  }

  private wantedKey = ''
  private wantedAt = -1
  private wantedComputedAt = -1
  private wantedView: StreamView | undefined
  private wantedMemo: Map<number, Want> | null = null
  update(v: StreamView, now: number): boolean {
    if (this.disposed) return false
    const key = wantedMemoKey(v)
    let wanted = this.wantedMemo
    if (!wanted || !wantedMemoValid(this.wantedKey, key, v, this.wantedAt, now, !!v.flight || ABL.has('nothrottle'), ABL.has('nothrottle') ? 0 : FLIGHT_WANTED_MS.tc, this.wantedView, this.wantedComputedAt)) {
      wanted = span('wanted.tc', () => computeWanted(v, { deepest: -5, isPresent: (l, i) => (TC_LEVELS as readonly number[]).includes(l) && this.present(l, i), keyOf: (l, tx, ty) => this.keyOf(l, tx, ty) }))
      // Keep the finest tiles first when the cache is short. The want stops at `wantCap` (capacity.ts tcWantCap): the layers above it hold history.
      if (wanted.size > this.wantCap) {
        const keep = [...wanted.values()].sort((a, b) => a.keep - b.keep).slice(0, Math.max(1, this.wantCap))
        wanted = new Map(keep.map((w) => [w.key, w]))
      }
      const byLevel: Record<string, number> = {}
      for (const w of wanted.values()) byLevel[w.level] = (byLevel[w.level] ?? 0) + 1
      this.wantedByLevel = byLevel
      this.wantedKey = key
      // Staggered: the three streamers' recomputes land on different frames of a gesture, not one 15 ms frame in six.
      this.wantedAt = now - 60
      this.wantedComputedAt = now
      this.wantedView = { ...v, pos: v.pos.clone(), back: v.back.clone(), moonX: v.moonX.clone(), moonY: v.moonY.clone(), moonZ: v.moonZ.clone() }
      this.wantedMemo = wanted
    }
    for (const w of wanted.values()) {
      const s = this.bySlotKey.get(w.key)
      if (s) { s.lastWanted = now; if (s.parked) this.unpark(s, now) }
      const j = this.jobs.get(w.key)
      if (j) j.lastWanted = now
    }
    if (this.parking) {
      let due = -1
      for (const s of this.bySlotKey.values()) {
        if (s.parked || wanted.has(s.key)) continue
        if (now - s.lastWanted > this.parkMs) this.park(s, now)
        else if (due < 0 || s.lastWanted + this.parkMs < due) due = s.lastWanted + this.parkMs
      }
      // Dirty-gated rendering: one wake at the earliest deadline so a settled view still parks.
      this.parkWake.schedule(due, now, () => this.onChange())
    }
    for (const j of this.jobs.values()) if (!wanted.has(j.key) && now - j.lastWanted > UNWANTED_ABORT_MS) { j.abort.abort(); this.jobs.delete(j.key) }
    this.pumpView = v; this.pumpWanted = wanted
    this.admit(v, wanted, now)
    for (let k = uploadsThisFrame(v, v.frameMs); k > 0 && this.ready.length > 0; k--) { const p = takeReady(this.ready, wanted)!; this.upload(p.job, p.mips, wanted, now) }
    let fading = false
    const becameVisible: Slot[] = []
    for (const s of this.bySlotKey.values()) {
      if (s.leaving) {
        // Parked but still weighing in: the fade falls to 0 on the arrival's slope, then the entry is cleared (the WAC detail shows through again).
        const g = Math.round(fadeOutLevel(s.leaveFrom, s.leaveAt, now, TC_FADE_MS) * 255)
        if (g <= 0) this.finishLeave(s)
        else { const li = this.keyOf(s.level, s.tx, s.ty); if (this.pageData[4 * li + 1] !== g) { this.pageData[4 * li + 1] = g; this.touched.add(li) }; fading = true }
        continue
      }
      if (s.parked) continue
      const a = Math.round(fadeInLevel(now, s.readyAt, TC_FADE_MS) * 255)
      const i = this.keyOf(s.level, s.tx, s.ty)
      const wasVisible = this.pageData[4 * i + 1] >= 255
      if (this.pageData[4 * i + 1] !== a) { this.pageData[4 * i + 1] = a; this.touched.add(i) }
      if (!wasVisible && a >= 255) becameVisible.push(s)
      if (a < 255) fading = true
    }
    for (const s of becameVisible) this.refreshMasks(s.level, s.tx, s.ty)
    this.flush()
    const busy = fading || this.ready.length > 0
    this.fadeOnlyBusy = busy && this.ready.length === 0
    return busy
  }
  /** The last update() was busy only because tiles are fading (main.ts may then draw them at the class's fade cadence). */
  fadeOnlyBusy = false

  /** Context lost: cancel the parking wake (the streamer stays alive until restoration disposes it). */
  suspend(): void { this.parkWake.suspend() }

  /** The latest view and wanted set update() admitted against: a settled job admits more from them without waiting for a frame (the tile pump). */
  private pumpView: StreamView | null = null
  private pumpWanted: Map<number, Want> | null = null
  /** Start queued fetches up to the in-flight cap and the free room. Called by update() every frame and by a settled job (pump). */
  private admit(v: StreamView, wanted: Map<number, Want>, now: number): void {
    const queue = [...wanted.values()].filter((w) => !this.bySlotKey.has(w.key) && !this.jobs.has(w.key) && !this.ready.some((p) => p.job.key === w.key)
      && this.failed.allows(w.key, now)).sort((a, b) => a.priority - b.priority)
    let room = this.free.length + [...this.bySlotKey.values()].filter((s) => !wanted.has(s.key) && now - s.lastWanted > 300).length - this.jobs.size - this.ready.length
    for (const w of queue) {
      if (this.jobs.size >= inflightCap(v, MAX_INFLIGHT, MAX_INFLIGHT_FLIGHT) || room <= 0) break
      this.start(w, now)
      room--
    }
  }
  private pump(): void {
    if (this.disposed || !mayPump(this.pumpView)) return
    this.admit(this.pumpView!, this.pumpWanted!, performance.now())
  }

  dispose(lost = false): void {
    this.disposed = true
    this.parkWake.suspend()
    for (const j of this.jobs.values()) j.abort.abort()
    this.jobs.clear()
    this.gpuLedger.releaseAll()
    if (!lost) { this.gl.deleteTexture(this.glT); this.page.dispose() }
  }

  private flush(): void {
    if (this.touched.size === 0) return
    for (const i of this.touched) this.page.addUpdateRange(4 * i, 4)
    this.touched.clear()
    this.page.needsUpdate = true
  }

  private start(w: Want, now: number): void {
    const job: Job = { key: w.key, level: w.level, tx: w.tx, ty: w.ty, abort: new AbortController(), lastWanted: now }
    this.jobs.set(w.key, job)
    this.stats.requested++
    const sig = job.abort.signal
    const url = this.base + detailPath(w.level, w.tx, w.ty)
    ;(async () => {
      const res = await fetch(url, { signal: sig })
      if (!res.ok) throw new HttpError(`tc ${w.level}/${w.tx}_${w.ty}`, res.status)
      const buf = await res.arrayBuffer()
      this.stats.bytes += buf.byteLength
      const mips = await decodeGrey(buf, this.man.mid, 'tc')
      if (this.disposed || sig.aborted) return
      if (!settleJob(this.jobs, w.key, job)) return
      this.failed.succeed(w.key)
      this.ready.push({ job, mips })
      this.stats.loaded++
      this.onChange()
      this.pump()
    })().catch((err: unknown) => {
      // Only the job's own entry: an aborted job's late rejection must not delete the replacement started under the same key.
      if (!settleJob(this.jobs, w.key, job) || sig.aborted) return
      this.stats.failed++
      this.stats.failedUrls.push(url)
      this.failed.fail(w.key, performance.now(), isPermanentFailure(err))
      console.warn('tc detail tile failed', w.level, w.tx, w.ty, (err as Error).message)
      // Wake the loop: the next frame's update() starts the queued fetches this one held back (no in-flight busy flag keeps it drawing).
      this.onChange()
      this.pump()
    })
  }

  private takeLayer(wanted: Map<number, unknown>): number | undefined {
    const f = this.free.pop()
    if (f !== undefined) return f
    let victim: Slot | null = null
    for (const s of this.bySlotKey.values()) if (!wanted.has(s.key) && (!victim || s.lastWanted < victim.lastWanted)) victim = s
    if (!victim) return undefined
    const layer = victim.layer
    this.evict(victim)
    return layer
  }

  private upload(j: Job, mips: Uint8Array[], wanted: Map<number, unknown>, now: number): void {
    const layer = this.takeLayer(wanted)
    if (layer === undefined) return
    const gl = this.gl, state = this.renderer.state
    withTightUnpack(state as unknown as PixelStoreState, gl, () => {
      state.bindTexture(gl.TEXTURE_2D_ARRAY, this.glT)
      let w = C_SIZE
      for (let lv = 0; lv < mips.length; lv++) {
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, lv, 0, 0, layer, w, w, 1, gl.RED, gl.UNSIGNED_BYTE, mips[lv])
        w >>= 1
      }
      state.unbindTexture()
    })
    this.bySlotKey.set(j.key, { layer, key: j.key, level: j.level, tx: j.tx, ty: j.ty, lastWanted: now, readyAt: fadeStartAt(now, this.pumpView?.flightReuse === false ? 0 : fadeBatchMs()), parked: false, leaving: false, leaveFrom: 0, leaveAt: 0 })
    const i = this.keyOf(j.level, j.tx, j.ty)
    this.pageData[4 * i] = layer + 1
    this.pageData[4 * i + 1] = 0
    this.touched.add(i)
    this.refreshMasks(j.level, j.tx, j.ty)
  }

  private visible(level: number, tx: number, ty: number): boolean {
    const i = this.keyOf(level, tx, ty)
    const slot = this.bySlotKey.get(i)
    return !!slot && slot.level === level && this.pageData[4 * i + 1] >= 255
  }

  private refreshMasks(level: number, tx: number, ty: number): void {
    const nx = levelNx(level), ny = levelNy(level)
    for (let dy = -1; dy <= 1; dy++) {
      const y = ty + dy
      if (y < 0 || y >= ny) continue
      for (let dx = -1; dx <= 1; dx++) {
        const x = (tx + dx + nx) % nx
        const i = this.keyOf(level, x, y)
        if (this.pageData[4 * i] <= 0) continue
        const mask = neighbourMask(level, x, y, (a, b) => this.visible(level, a, b))
        if (this.pageData[4 * i + 3] !== mask) { this.pageData[4 * i + 3] = mask; this.touched.add(i) }
      }
    }
  }

  /** Left the wanted set: nothing draws the tile (the WAC detail shows through again); layer and data stay for a later want. */
  private park(s: Slot, now: number): void {
    s.parked = true
    const i = this.keyOf(s.level, s.tx, s.ty)
    const g = this.pageData[4 * i + 1]
    if (fadeOutOn() && g > 0) {
      // Still weighing in the shader: fade out over TC_FADE_MS instead of stepping back to the WAC detail (update() clears the entry at 0).
      s.leaving = true; s.leaveFrom = g / 255; s.leaveAt = now
    } else {
      this.pageData[4 * i] = 0; this.pageData[4 * i + 1] = 0; this.pageData[4 * i + 2] = 0; this.pageData[4 * i + 3] = 0
      this.touched.add(i)
    }
    this.stats.parked++
    this.refreshMasks(s.level, s.tx, s.ty)
  }
  /** The fade-out reached 0 (or a capture settles it): the entry is cleared, as park() does without a fade. */
  private finishLeave(s: Slot): void {
    s.leaving = false
    const i = this.keyOf(s.level, s.tx, s.ty)
    this.pageData[4 * i] = 0; this.pageData[4 * i + 1] = 0; this.pageData[4 * i + 2] = 0; this.pageData[4 * i + 3] = 0
    this.touched.add(i)
    this.refreshMasks(s.level, s.tx, s.ty)
  }
  /** Wanted again: page the resident layer with the arrival fade, no fetch, decode or upload. */
  private unpark(s: Slot, now: number): void {
    s.parked = false
    const i = this.keyOf(s.level, s.tx, s.ty)
    if (s.leaving) {
      // Wanted again mid fade-out: climb back from where the fade stands (the entry is still paged), not from 0.
      s.leaving = false
      s.readyAt = fadeInFrom(this.pageData[4 * i + 1] / 255, now, TC_FADE_MS)
      this.stats.unparked++
      return
    }
    s.readyAt = now
    this.pageData[4 * i] = s.layer + 1
    this.pageData[4 * i + 1] = 0
    this.touched.add(i)
    this.stats.unparked++
    this.refreshMasks(s.level, s.tx, s.ty)
  }

  private evict(s: Slot): void {
    this.bySlotKey.delete(s.key)
    const i = this.keyOf(s.level, s.tx, s.ty)
    this.pageData[4 * i] = 0; this.pageData[4 * i + 1] = 0; this.pageData[4 * i + 2] = 0; this.pageData[4 * i + 3] = 0
    this.touched.add(i)
    this.stats.evicted++
    this.refreshMasks(s.level, s.tx, s.ty)
  }
}
