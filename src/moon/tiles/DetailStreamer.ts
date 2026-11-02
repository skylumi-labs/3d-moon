import * as THREE from 'three'
import { FailureBook, isPermanentFailure, settleJob } from './jobBook'
import { HttpError } from '../../net/load'
import { withTightUnpack, type PixelStoreState } from './unpack'
import { span } from '../../perf/perf'
import { ABL } from '../../abl'
import { fadeBatchMs, fadeInLevel, fadeStartAt } from './fades'
import { type StreamView, type Want, computeWanted, wantResidency, uploadsThisFrame, inflightCap, wantedMemoKey, wantedMemoValid, FLIGHT_WANTED_MS, mayPump, takeReady } from './wanted'
import { C_SIZE, detailPath, levelNx, levelNy, type TileManifest } from './grid'
import { type DeeperEntry, deeperPresent, presenceAt, type Presence } from './levels'
import { DETAIL_FADE_MS, DETAIL_MID, DETAIL_PAGE_H, DETAIL_PAGE_W, DETAIL_PER_OCTAVE, detailRow, detailSourcesAt, detailTileVisible, type DetailSources } from './detail'
import { decodeGrey } from './greyDecode'
import { GpuGroup } from '../../quality/track'
import { textureBytes } from '../../quality/ledger'
import { neighbourMask } from './feather'
import { abortAllJobs } from './abortJobs'

const MAX_INFLIGHT = 4
const MAX_INFLIGHT_FLIGHT = 8
const UNWANTED_ABORT_MS = 1500

interface Slot { layer: number; key: number; level: number; tx: number; ty: number; lastWanted: number; readyAt: number }
interface Job { key: number; level: number; tx: number; ty: number; abort: AbortController; lastWanted: number; polarBlended: boolean }

type DetailEntry = NonNullable<DeeperEntry['detail']> & { polar?: Presence & { path: string } }

/** Keep a bounded finest-detail share while retaining the coarser detail fallback around it. */
export function cutDetailWanted(out: Map<number, Want>, capacity: number, reserve = 2): void {
  const room = Math.max(1, capacity - reserve)
  if (out.size <= room) return
  const levels = [...new Set([...out.values()].map((w) => w.level))].sort((a, b) => a - b)
  const finest = levels[0]
  const fine = [...out.values()].filter((w) => w.level === finest).sort((a, b) => a.keep - b.keep)
  const fineKeep = Math.min(fine.length, Math.max(1, Math.floor(room / 4)))
  const keepFine = new Set(fine.slice(0, fineKeep).map((w) => w.key))
  const remainder = [...out.values()].filter((w) => !keepFine.has(w.key)).sort((a, b) => b.level - a.level || a.keep - b.keep)
  for (let i = room - fineKeep; i < remainder.length; i++) out.delete(remainder[i].key)
}

function validatedPolarDetail(value: unknown): TileManifest['polarDetail'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (raw.version !== 'polar-wac-detail-v1' || raw.path !== 'd-polar/v1'
    || raw.format !== 'webp-u8-ratio' || raw.mid !== DETAIL_MID || raw.perOctave !== DETAIL_PER_OCTAVE
    || raw.blend !== 'log2-global-polar-v1' || !Array.isArray(raw.transitionDeg)
    || raw.transitionDeg.length !== 2 || raw.transitionDeg[0] !== 76 || raw.transitionDeg[1] !== 80
    || !Array.isArray(raw.levels)) return undefined
  const levels: NonNullable<TileManifest['polarDetail']>['levels'] = []
  const seen = new Set<number>()
  for (const value of raw.levels) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const level = value as Record<string, unknown>
    const l = level.level
    if ((l !== -1 && l !== -2) || seen.has(l) || level.nx !== levelNx(l) || level.ny !== levelNy(l)) return undefined
    const total = levelNx(l) * levelNy(l)
    const hasPresent = level.present !== undefined
    const hasRle = level.presentRle !== undefined
    if (!hasPresent && !hasRle) return undefined
    if (hasPresent && (typeof level.present !== 'string' || level.present.length !== total || !/^[01]*$/.test(level.present))) return undefined
    if (hasRle) {
      if (!Array.isArray(level.presentRle)) return undefined
      let end = 0
      for (const run of level.presentRle) {
        if (!Array.isArray(run) || run.length !== 2) return undefined
        const [start, length] = run
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < end || length <= 0 || start + length > total) return undefined
        end = start + length
      }
    }
    seen.add(l)
    levels.push({
      level: l, nx: levelNx(l), ny: levelNy(l),
      ...(hasPresent ? { present: level.present as string } : {}),
      ...(hasRle ? { presentRle: level.presentRle as Array<[number, number]> } : {}),
    })
  }
  return {
    version: 'polar-wac-detail-v1', path: 'd-polar/v1', format: 'webp-u8-ratio',
    mid: DETAIL_MID, perOctave: DETAIL_PER_OCTAVE, transitionDeg: [76, 80],
    blend: 'log2-global-polar-v1', levels,
  }
}

/** Legacy global tiles are capped by pole visibility; declared polar tiles are their replacement above that cutoff. */
export function detailSourceVisible(level: number, ty: number, globalPresent: boolean, polarPresent: boolean): boolean {
  return polarPresent || (globalPresent && detailTileVisible(level, ty))
}

/** The detail entries of a manifest that this client can read (format and scale are baked into the shader). */
export function readableDetail(deeper: readonly DeeperEntry[] | undefined,
                               polarDetail?: TileManifest['polarDetail']): Map<number, DetailEntry> {
  const out = new Map<number, DetailEntry>()
  for (const e of deeper ?? []) {
    const d = e.detail
    if ((e.level === -1 || e.level === -2) && d && d.format === 'webp-u8-ratio' && d.mid === DETAIL_MID && d.perOctave === DETAIL_PER_OCTAVE) out.set(e.level, { ...d })
  }
  // Polar routing is opt-in. A malformed/unsupported block is ignored, leaving
  // every legacy global-detail URL and pole fade as before.
  const polar = validatedPolarDetail(polarDetail)
  if (polar) {
    for (const p of polar.levels) {
      const entry = out.get(p.level) ?? { path: 'd', format: 'webp-u8-ratio' as const, mid: DETAIL_MID, perOctave: DETAIL_PER_OCTAVE }
      entry.polar = { path: polar.path, present: p.present, presentRle: p.presentRle }
      out.set(p.level, entry)
    }
  }
  return out
}

/**
 * Streams the WAC detail-ratio tiles (levels -1, -2) into an R8 texture array and a small page table (r = layer + 1, g = fade 0..1 (RGBA32F: three update ranges assume 4 components)). A tile that
 * is absent weighs nothing in the shader (ratio 1); a tile that arrives fades in over DETAIL_FADE_MS, so nothing pops. The page alpha
 * carries an absent-neighbour mask so a partial resident block hands back to the base albedo smoothly.
 */
export class DetailStreamer {
  readonly tex: THREE.ExternalTexture
  readonly page: THREE.DataTexture
  onChange: () => void = () => {}
  readonly stats = { requested: 0, loaded: 0, failed: 0, evicted: 0, bytes: 0 }
  wantedByLevel: Record<string, number> = {}

  /** Read-only source lookup for a sampled surface point, based on this streamer's bound page table. */
  sourcesAt(lonDeg: number, latDeg: number, fpKm: number, gate = 1, slopeDeg = 0): DetailSources {
    return detailSourcesAt(this.pageData, lonDeg, latDeg, fpKm, gate, slopeDeg)
  }

  private readonly gl: WebGL2RenderingContext
  private readonly glT: WebGLTexture
  private readonly pageData = new Float32Array(DETAIL_PAGE_W * DETAIL_PAGE_H * 4)
  private readonly bySlotKey = new Map<number, Slot>()
  private readonly jobs = new Map<number, Job>()
  private readonly failed = new FailureBook()
  private readonly ready: Array<{ job: Job; mips: Uint8Array[] }> = []
  private readonly free: number[] = []
  private readonly touched = new Set<number>()
  private disposed = false
  private readonly gpuLedger = new GpuGroup('detail')

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly base: string, private readonly entries: Map<number, DetailEntry>, readonly capacity: number) {
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
    this.page = new THREE.DataTexture(this.pageData, DETAIL_PAGE_W, DETAIL_PAGE_H, THREE.RGBAFormat, THREE.FloatType)
    this.page.internalFormat = 'RGBA32F'
    this.page.minFilter = this.page.magFilter = THREE.NearestFilter
    this.page.generateMipmaps = false
    this.page.needsUpdate = true
    // R8 array with the full chain, and the RGBA32F page table.
    this.gpuLedger.add('array', textureBytes(C_SIZE, C_SIZE, 1, { layers: capacity, mips: true }))
    this.gpuLedger.add('page-table', DETAIL_PAGE_W * DETAIL_PAGE_H * 16)
  }

  private present(level: number, index: number): boolean {
    const e = this.entries.get(level)
    if (!e) return false
    const ty = Math.floor(index / levelNx(level))
    return detailSourceVisible(level, ty, deeperPresent(e as unknown as DeeperEntry, index), !!e.polar && presenceAt(e.polar, index))
  }
  private keyOf(level: number, tx: number, ty: number): number { return (detailRow(level) + ty) * DETAIL_PAGE_W + tx }
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
      s.readyAt = now - DETAIL_FADE_MS
      const i = 4 * s.key + 1
      if (this.pageData[i] !== 1) { this.pageData[i] = 1; this.touched.add(s.key) }
    }
  }
  captureFadeSignature(): number {
    let hash = 2166136261
    for (const w of this.wantedMemo?.values() ?? []) hash = Math.imul(hash ^ Math.round(this.pageData[4 * w.key + 1] * 1000) ^ w.key, 16777619)
    return hash >>> 0
  }
  /** Measurement only (?wantprobe=1): see TileStreamer.exactResidency. */
  exactResidency(v: StreamView): { wanted: number; resident: number; stale: number } {
    const exact = computeWanted(v, { deepest: -2, isPresent: (l, i) => l < 0 && this.present(l, i), keyOf: (l, tx, ty) => this.keyOf(l, tx, ty) })
    cutDetailWanted(exact, this.capacity)
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
  /** Per frame: choose tiles, fetch, upload one, advance fades. True while frames are still needed. */
  update(v: StreamView, now: number): boolean {
    if (this.disposed) return false
    // Pure of the view (and of which levels the manifest lists): an unmoved camera wants what it wanted last frame (see TileStreamer.wanted).
    const key = wantedMemoKey(v, `|${this.entries.size}`)
    let wanted = this.wantedMemo
    if (!wanted || !wantedMemoValid(this.wantedKey, key, v, this.wantedAt, now, !!v.flight || ABL.has('nothrottle'), ABL.has('nothrottle') ? 0 : FLIGHT_WANTED_MS.detail, this.wantedView, this.wantedComputedAt)) {
      wanted = span('wanted.detail', () => computeWanted(v, { deepest: -2, isPresent: (l, i) => l < 0 && this.present(l, i), keyOf: (l, tx, ty) => this.keyOf(l, tx, ty) }))
      cutDetailWanted(wanted, this.capacity)
      const byLevel: Record<string, number> = {}
      for (const w of wanted.values()) byLevel[w.level] = (byLevel[w.level] ?? 0) + 1
      this.wantedByLevel = byLevel
      this.wantedKey = key
      // Staggered: the three streamers' recomputes land on different frames of a gesture, not one 15 ms frame in six.
      this.wantedAt = now - 30
      this.wantedComputedAt = now
      this.wantedView = { ...v, pos: v.pos.clone(), back: v.back.clone(), moonX: v.moonX.clone(), moonY: v.moonY.clone(), moonZ: v.moonZ.clone() }
      this.wantedMemo = wanted
    }
    for (const w of wanted.values()) {
      const s = this.bySlotKey.get(w.key)
      if (s) s.lastWanted = now
      const j = this.jobs.get(w.key)
      if (j) j.lastWanted = now
    }
    for (const j of this.jobs.values()) if (!wanted.has(j.key) && now - j.lastWanted > UNWANTED_ABORT_MS) { j.abort.abort(); this.jobs.delete(j.key) }
    this.pumpView = v; this.pumpWanted = wanted
    this.admit(v, wanted, now)
    for (let k = uploadsThisFrame(v, v.frameMs); k > 0 && this.ready.length > 0; k--) { const p = takeReady(this.ready, wanted)!; this.upload(p.job, p.mips, wanted, now) }
    let fading = false
    const becameVisible: Slot[] = []
    for (const s of this.bySlotKey.values()) {
      const a = fadeInLevel(now, s.readyAt, DETAIL_FADE_MS)
      const i = this.keyOf(s.level, s.tx, s.ty)
      const wasVisible = this.pageData[4 * i + 1] >= 1
      if (this.pageData[4 * i + 1] !== a) { this.pageData[4 * i + 1] = a; this.touched.add(i) }
      if (!wasVisible && a >= 1) becameVisible.push(s)
      if (a < 1) fading = true
    }
    for (const s of becameVisible) this.refreshDetailMasks(s.level, s.tx, s.ty)
    this.flush()
    const busy = fading || this.ready.length > 0
    this.fadeOnlyBusy = busy && this.ready.length === 0
    return busy
  }
  /** The last update() was busy only because tiles are fading (main.ts may then draw them at the class's fade cadence). */
  fadeOnlyBusy = false

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
    const e = this.entries.get(w.level)
    const index = w.ty * levelNx(w.level) + w.tx
    const usePolar = !!e?.polar && presenceAt(e.polar, index)
    const job: Job = { key: w.key, level: w.level, tx: w.tx, ty: w.ty, abort: new AbortController(), lastWanted: now, polarBlended: usePolar }
    this.jobs.set(w.key, job)
    this.stats.requested++
    const sig = job.abort.signal
    const globalDir = e?.path ?? 'd'
    const dir = usePolar ? e!.polar!.path : globalDir
    ;(async () => {
      const decode = async (tileDir: string): Promise<Uint8Array[]> => {
        const res = await fetch(this.base + detailPath(w.level, w.tx, w.ty).replace(/^d\//, `${tileDir}/`), { signal: sig })
        if (!res.ok) throw new HttpError(`detail ${w.level}/${w.tx}_${w.ty}`, res.status)
        const buf = await res.arrayBuffer()
        this.stats.bytes += buf.byteLength
        return decodeGrey(buf, DETAIL_MID, 'detail')
      }
      let mips: Uint8Array[]
      try {
        mips = await decode(dir)
      } catch (err) {
        if (!usePolar || sig.aborted || !detailTileVisible(w.level, w.ty)) throw err
        job.polarBlended = false
        mips = await decode(globalDir)
      }
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
      this.failed.fail(w.key, performance.now(), isPermanentFailure(err))
      console.warn('detail tile failed', w.level, w.tx, w.ty, (err as Error).message)
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
    const slot: Slot = { layer, key: j.key, level: j.level, tx: j.tx, ty: j.ty, lastWanted: now, readyAt: fadeStartAt(now, this.pumpView?.flightReuse === false ? 0 : fadeBatchMs()) }
    this.bySlotKey.set(j.key, slot)
    const i = this.keyOf(j.level, j.tx, j.ty)
    this.pageData[4 * i] = layer + 1
    this.pageData[4 * i + 1] = 0
    this.pageData[4 * i + 2] = j.polarBlended ? 1 : 0
    this.touched.add(i)
    this.refreshDetailMasks(j.level, j.tx, j.ty)
  }

  /** A detail neighbour counts only after its 250 ms fade, so a newly arriving tile does not expose a hard edge. */
  private detailVisible(level: number, tx: number, ty: number): boolean {
    const i = this.keyOf(level, tx, ty)
    const slot = this.bySlotKey.get(i)
    return !!slot && slot.level === level && this.pageData[4 * i + 1] >= 1
  }

  /** Refresh a changed detail tile and its eight neighbours; longitude wraps and pole rows clamp like height masks. */
  private refreshDetailMasks(level: number, tx: number, ty: number): void {
    const nx = levelNx(level), ny = levelNy(level)
    for (let dy = -1; dy <= 1; dy++) {
      const y = ty + dy
      if (y < 0 || y >= ny) continue
      for (let dx = -1; dx <= 1; dx++) {
        const x = (tx + dx + nx) % nx
        const i = this.keyOf(level, x, y)
        if (this.pageData[4 * i] <= 0) continue
        const mask = neighbourMask(level, x, y, (nx2, ny2) => this.detailVisible(level, nx2, ny2))
        if (this.pageData[4 * i + 3] !== mask) {
          this.pageData[4 * i + 3] = mask
          this.touched.add(i)
        }
      }
    }
  }

  private evict(s: Slot): void {
    this.bySlotKey.delete(s.key)
    const i = this.keyOf(s.level, s.tx, s.ty)
    this.pageData[4 * i] = 0; this.pageData[4 * i + 1] = 0; this.pageData[4 * i + 2] = 0; this.pageData[4 * i + 3] = 0
    this.touched.add(i)
    this.stats.evicted++
    this.refreshDetailMasks(s.level, s.tx, s.ty)
  }
}
