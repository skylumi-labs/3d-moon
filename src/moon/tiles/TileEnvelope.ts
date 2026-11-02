import * as THREE from 'three'
import { FULLSCREEN_VERTEX, fullscreenTriangle } from '../../glsl/common'
import { tileEnvelopeFragment } from '../moonShader'
import { levelDeg } from './grid'
import { MOON_R_KM } from './grid'
import { marchReachKm } from '../march'
import { ledger } from '../../quality/ledger'
import { EnvReadback } from './envReadback'
import { TENV_BLOCKS, TENV_CELL_BYTES, TENV_N, envBlocksFromSearch, tenvBytes } from '../globalHorizon'

/**
 * The fixed policy's per-tile horizon envelope (globalHorizon.ts has the design; moonShader.ts tileEnvelopeFragment is the build pass, horizonBound the read).
 *
 * Per resident height tile, one TENV_N x TENV_N byte layer of an R8 array (the layer index is the tile's own layer in the streamer's arrays): the highest horizon the
 * tile march gives from anywhere in a cell, in any azimuth. It does not depend on the Sun, so a Sun change never touches it. It does depend on the ground the march reads
 * (the tile's neighbours at its level and the coarser ones, then the 4k map), exactly as the ShadowCache's layers do, so it follows the same lifecycle:
 *  - built when the tile is fully faded in and shaded and the ground has been quiet for QUIET_MS, in TENV_BLOCKS row blocks under a measured GPU budget (timer query; one
 *    block a frame until a batch has been timed), the most on-screen tile first;
 *  - cleared (code 0 everywhere = "no bound", which the shader answers with the live march) the moment a tile within the march's reach of it arrives, leaves or finishes fading,
 *    or the layer is given to another tile, and rebuilt after the next quiet period; a half-built layer is safe to read, its unbuilt rows are zero;
 *  - released with the tile (the layer is cleared when the streamer reuses it).
 * Memory: tenvBytes(layers, N) bytes, in the ledger under 'tiles'. Layers past the class cap are never built (no bound there).
 */

const RAD = Math.PI / 180
/** The angular reach (deg) of a changed tile of `level`: how far from it a march sample can read it (ShadowCache.ts reachDeg without its flat-reach switch). */
function reachDeg(level: number): number { return marchReachKm(level) / MOON_R_KM * 180 / Math.PI }
/** Ground that has not changed this long (ms) before layers are built: an arrival or a fade completion restarts the layers within its reach. */
export const TENV_QUIET_MS = 150
/** GPU time the build may take per frame (ms), by device class. */
const BUDGET_MS = { desktop: 2, low: 1 }
/** First guess of one block's GPU time (ms) until a timer query has measured it. */
const GUESS_MS_PER_BLOCK = { desktop: 1, low: 4 }
const MAX_BLOCKS_PER_FRAME = 24
/** A frame already this slow (ms) builds one block. */
const OVER_FRAME_MS = 33
/** Class memory cap for the array (bytes). */
export const TENV_BYTES_CAP = { desktop: 16 << 20, low: 1 << 20 }
const COMPILE_WAIT_MS = 3000

/** What the envelope needs of the tile streamer (TileStreamer implements it; the unit test stubs it). */
export interface EnvelopeTiles {
  cacheSlots(): readonly { layer: number; level: number; tx: number; ty: number; gen: number; full: boolean; shade: boolean; keep: number }[]
  takeEnvChanges(): { changes: Array<{ level: number; tx: number; ty: number }>; overflow: boolean }
  trackEnvChanges: boolean
}

export interface TileEnvelopeOpts {
  /** performance.now(). */
  now: number
  /** This frame's smoothed length (ms): a slow frame builds one block. */
  frameMs: number
  /** False when the Moon pass must not read the envelope (the ground view, baked or off shadows). */
  allowed: boolean
  /** The frame timer's open TIME_ELAPSED query: ended around the build batch (only one can be active) and resumed after. */
  frameQuery?: { suspend(): void; resume(): void }
  /** A camera-motion frame: nothing is built now. */
  motion?: boolean
}

export interface TileEnvelopeStats {
  gpuBytes: number
  n: number
  layers: number
  /** Layers complete, layers partly built, layers wanting a build (full, shaded, quiet or not). */
  built: number
  partial: number
  eligible: number
  blocksBuilt: number
  blocksLastFrame: number
  msPerBlock: number
  timed: boolean
  buildMs: number
  clears: number
  invalidations: number
  overflows: number
  /** From the first build to every eligible layer complete (ms; -1 until then), updated each time it settles. */
  settledMs: number
  readOn: boolean
  failed: boolean
}

interface LayerState { gen: number; level: number; tx: number; ty: number; next: number; clear: boolean }

function tileCentre(level: number, tx: number, ty: number, out: THREE.Vector3): number {
  const d = levelDeg(level)
  const lon = ((tx + 0.5) * d - 180) * RAD
  const lat = (90 - (ty + 0.5) * d) * RAD
  out.set(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat))
  return 0.7072 * d
}

export class TileEnvelope {
  /** The array (RG32UI: eight azimuth-sector bytes a cell), read by the Moon pass as `uTileEnv`. */
  readonly texture: THREE.Texture
  readonly stats: TileEnvelopeStats
  readOn = false
  failed = false
  /** Layers the array holds (the class cap may be below the streamer's). */
  readonly layers: number
  readonly n: number
  private readonly rt: THREE.WebGLArrayRenderTarget
  private readonly material: THREE.ShaderMaterial
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.Camera()
  private readonly state: LayerState[]
  private readonly cls: 'desktop' | 'low'
  private readonly cen: Float64Array
  private readonly cenR: Float64Array
  private readonly cenKey: Int32Array
  private readonly scratch = new THREE.Vector3()
  private readonly ledgerKey = 'tile-envelope'
  private lastChangeAt = -1e9
  private msPerBlock: number
  private compiled = false
  private compileWaitFrom = -1
  private startedAt = -1
  private timer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null
  private readonly queries: Array<{ q: WebGLQuery; n: number }> = []
  private readonly order: number[] = []
  private reader: EnvReadback | null = null

  constructor(private readonly renderer: THREE.WebGLRenderer, passUniforms: Record<string, THREE.IUniform>, tileLayers: number, lonSpan: number, mapWidth: number, deepest: number, low = false) {
    this.cls = low ? 'low' : 'desktop'
    this.n = TENV_N[this.cls]
    this.layers = Math.max(1, Math.min(tileLayers, Math.floor(TENV_BYTES_CAP[this.cls] / (this.n * this.n * TENV_CELL_BYTES))))
    this.msPerBlock = GUESS_MS_PER_BLOCK[this.cls]
    try { this.timer = ((renderer.getContext?.() as WebGL2RenderingContext | undefined)?.getExtension('EXT_disjoint_timer_query_webgl2') as typeof this.timer | null | undefined) ?? null } catch { this.timer = null }
    this.rt = new THREE.WebGLArrayRenderTarget(this.n, this.n, this.layers, { format: THREE.RGIntegerFormat, type: THREE.UnsignedIntType, internalFormat: 'RG32UI', minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false })
    this.rt.texture.wrapS = this.rt.texture.wrapT = THREE.ClampToEdgeWrapping
    this.texture = this.rt.texture
    this.state = Array.from({ length: tileLayers }, () => ({ gen: -1, level: 0, tx: 0, ty: 0, next: 0, clear: false }))
    this.cen = new Float64Array(3 * tileLayers)
    this.cenR = new Float64Array(tileLayers)
    this.cenKey = new Int32Array(3 * tileLayers).fill(-0x7fffffff)
    // Shares the Moon pass's uniform objects (the body axes, the tile arrays, the 4k map) but pins the march to the full rest march.
    const own = { uMotion: { value: 0 }, uShMode: { value: 0 }, uMStride: { value: 1 }, uMLite: { value: 0 } }
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: tileEnvelopeFragment(lonSpan, mapWidth, deepest),
      uniforms: { ...passUniforms, ...own, uTenvLevel: { value: 0 }, uTenvTile: { value: new THREE.Vector2() }, uTenvN: { value: this.n }, uTenvClear: { value: 0 } },
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    })
    const mesh = new THREE.Mesh(fullscreenTriangle(), this.material)
    mesh.frustumCulled = false
    this.scene.add(mesh)
    const bytes = tenvBytes(this.layers, this.n)
    this.stats = { gpuBytes: bytes, n: this.n, layers: this.layers, built: 0, partial: 0, eligible: 0, blocksBuilt: 0, blocksLastFrame: 0, msPerBlock: this.msPerBlock, timed: false, buildMs: 0, clears: 0, invalidations: 0, overflows: 0, settledMs: -1, readOn: false, failed: false }
    ledger.set('tiles', this.ledgerKey, bytes)
    this.precompile()
  }

  private fail(): void { this.failed = true; this.stats.failed = true; this.readOn = false; this.stats.readOn = false }

  /** Links the build program in the background with the array bound (three keys a program by the target), so the first block does not stall a frame on it. */
  private precompile(): void {
    const r = this.renderer
    const prev = r.getRenderTarget(), prevFace = r.getActiveCubeFace(), prevMip = r.getActiveMipmapLevel()
    let compiling: Promise<unknown> | null = null
    try {
      r.setRenderTarget(this.rt, 0)
      const gl = r.getContext?.() as WebGL2RenderingContext | undefined
      if (gl && gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { this.fail(); return }
      compiling = typeof r.compileAsync === 'function' ? r.compileAsync(this.scene, this.camera) : null
    } catch { this.fail(); return } finally { r.setRenderTarget(prev, prevFace, prevMip) }
    if (!compiling) { this.compiled = true; return }
    compiling.then(() => { this.compiled = true }, () => this.fail())
  }

  private centreOf(layer: number, level: number, tx: number, ty: number): number {
    const k = 3 * layer, key = this.cenKey
    if (key[k] !== level || key[k + 1] !== tx || key[k + 2] !== ty) {
      this.cenR[layer] = tileCentre(level, tx, ty, this.scratch)
      this.cen[k] = this.scratch.x; this.cen[k + 1] = this.scratch.y; this.cen[k + 2] = this.scratch.z
      key[k] = level; key[k + 1] = tx; key[k + 2] = ty
    }
    return k
  }

  /** One draw into layer `layer` of the array: a block of rows, or (clear) the whole layer written as "no bound". */
  private draw(layer: number, level: number, tx: number, ty: number, y0: number, rows: number, clear: boolean): boolean {
    const r = this.renderer
    const prevTarget = r.getRenderTarget(), prevFace = r.getActiveCubeFace(), prevMip = r.getActiveMipmapLevel(), prevAuto = r.autoClear
    const u = this.material.uniforms
    u.uTenvClear.value = clear ? 1 : 0
    u.uTenvLevel.value = level
    ;(u.uTenvTile.value as THREE.Vector2).set(tx, ty)
    r.autoClear = false
    this.rt.scissor.set(0, y0, this.n, rows)
    this.rt.scissorTest = true
    r.setRenderTarget(this.rt, layer)
    r.render(this.scene, this.camera)
    r.setRenderTarget(prevTarget, prevFace, prevMip)
    r.autoClear = prevAuto
    this.rt.scissorTest = false
    return true
  }

  private invalidate(st: LayerState): void {
    if (st.next > 0 || st.clear) { st.next = 0; st.clear = true; this.stats.invalidations++ }
  }

  /** Called once per frame before the Moon is drawn, after the streamer's update. True while blocks remain (the frame loop keeps drawing). */
  update(tiles: EnvelopeTiles, o: TileEnvelopeOpts): boolean {
    if (this.failed) { this.readOn = false; return false }
    tiles.trackEnvChanges = true
    const slots = tiles.cacheSlots()
    const ch = tiles.takeEnvChanges()
    const now = o.now
    if (ch.changes.length || ch.overflow) this.lastChangeAt = now
    // A layer given to another tile (or whose tile left) holds the old tile's cells: written as "no bound" before anything reads it.
    const live = new Uint8Array(this.state.length)
    for (const s of slots) {
      if (s.layer >= this.state.length) continue
      live[s.layer] = 1
      const st = this.state[s.layer]
      if (st.gen !== s.gen) { st.gen = s.gen; st.level = s.level; st.tx = s.tx; st.ty = s.ty; st.next = 0; st.clear = true }
    }
    for (let l = 0; l < this.state.length; l++) if (!live[l] && this.state[l].gen !== -1) { const st = this.state[l]; st.gen = -1; st.next = 0; st.clear = true }
    // A tile arriving, leaving or finishing its fade changes the ground the march reads within its reach. A layer at level L reads levels L and coarser only, so a change at a
    // FINER level cannot touch it; a tile's own arrival does not change the ground its own layer is built from (it is built only once faded in).
    if (ch.overflow) { this.stats.overflows++; for (let l = 0; l < this.state.length; l++) this.invalidate(this.state[l]) }
    else if (ch.changes.length) {
      const c1 = new THREE.Vector3()
      for (const c of ch.changes) {
        const rc = tileCentre(c.level, c.tx, c.ty, c1)
        const reach = reachDeg(c.level)
        for (const s of slots) {
          if (s.layer >= this.state.length) continue
          const st = this.state[s.layer]
          if (c.level < s.level || (c.level === s.level && c.tx === s.tx && c.ty === s.ty)) continue
          const k = this.centreOf(s.layer, s.level, s.tx, s.ty)
          const lim = (rc + this.cenR[s.layer] + reach) * RAD
          if (lim >= Math.PI || c1.x * this.cen[k] + c1.y * this.cen[k + 1] + c1.z * this.cen[k + 2] > Math.cos(lim)) this.invalidate(st)
        }
      }
    }
    // Owed clears first (a stale layer must not be readable): one cheap draw each.
    for (let l = 0; l < this.state.length && l < this.layers; l++) {
      const st = this.state[l]
      if (!st.clear) continue
      if (!this.compiled) break
      this.draw(l, 0, 0, 0, 0, this.n, true)
      st.clear = false
      this.stats.clears++
    }
    let built = 0, partial = 0, eligible = 0
    const todo = this.order
    todo.length = 0
    for (const s of slots) {
      if (s.layer >= this.layers) continue
      const st = this.state[s.layer]
      if (!s.full || !s.shade) continue
      eligible++
      if (st.next >= TENV_BLOCKS) built++
      else { if (st.next > 0) partial++; todo.push(s.layer) }
    }
    this.stats.built = built; this.stats.partial = partial; this.stats.eligible = eligible
    this.readOn = o.allowed
    this.stats.readOn = o.allowed
    this.stats.blocksLastFrame = 0
    if (!o.allowed || o.motion || todo.length === 0) {
      if (todo.length === 0 && eligible > 0 && this.startedAt >= 0 && this.stats.settledMs < 0) this.stats.settledMs = now - this.startedAt
      return false
    }
    this.pollQueries()
    if (!this.compiled) {
      if (this.compileWaitFrom < 0) this.compileWaitFrom = now
      if (now - this.compileWaitFrom < COMPILE_WAIT_MS) return true
      this.compiled = true
    }
    if (now - this.lastChangeAt < TENV_QUIET_MS) return true
    if (this.startedAt < 0) this.startedAt = now
    this.stats.settledMs = -1
    // The most on-screen tile first (keep: lower is more on screen), the layer already started before another.
    const keepOf = new Map<number, { keep: number; level: number }>()
    for (const s of slots) keepOf.set(s.layer, { keep: s.keep, level: s.level })
    todo.sort((a, b) => (this.state[b].next > 0 ? 1 : 0) - (this.state[a].next > 0 ? 1 : 0) || keepOf.get(a)!.keep - keepOf.get(b)!.keep || keepOf.get(a)!.level - keepOf.get(b)!.level)
    const budget = BUDGET_MS[this.cls]
    const forced = typeof location === 'undefined' ? null : envBlocksFromSearch(location.search)
    const nBlocks = forced ?? (o.frameMs > OVER_FRAME_MS || !this.stats.timed ? 1 : Math.max(1, Math.min(MAX_BLOCKS_PER_FRAME, Math.floor(budget / this.msPerBlock))))
    const timing = this.beginQuery(o.frameQuery)
    const rows = Math.ceil(this.n / TENV_BLOCKS)
    let done = 0
    for (const l of todo) {
      const st = this.state[l]
      while (done < nBlocks && st.next < TENV_BLOCKS) {
        const y0 = st.next * rows
        if (!this.draw(l, st.level, st.tx, st.ty, y0, Math.min(rows, this.n - y0), false)) { if (timing) this.endQuery(done, o.frameQuery); return false }
        st.next++; done++
      }
      if (done >= nBlocks) break
    }
    if (timing) this.endQuery(done, o.frameQuery)
    this.stats.blocksBuilt += done
    this.stats.blocksLastFrame = done
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
        if (!gl.getParameter(t.GPU_DISJOINT_EXT) && h.n > 0) {
          const ms = (gl.getQueryParameter(h.q, gl.QUERY_RESULT) as number) / 1e6
          const per = ms / h.n
          this.msPerBlock = this.stats.timed ? 0.5 * this.msPerBlock + 0.5 * per : per
          this.stats.timed = true
          this.stats.msPerBlock = +this.msPerBlock.toFixed(3)
          this.stats.buildMs += ms
        }
        gl.deleteQuery(h.q)
        this.queries.shift()
      }
    } catch { this.queries.length = 0 }
  }

  /** Dev/rig: one layer read back (n * n * 8 bytes, ((y * n + x) * 8 + sector)). */
  readLayer(layer: number): Uint8Array {
    this.reader ??= new EnvReadback(this.renderer)
    return this.reader.readLayer(this.texture, layer, this.n)
  }

  /** True when nothing is left to build or clear (a deterministic capture can draw). */
  captureIdle(): boolean { return this.failed || !this.readOn || (this.stats.eligible === this.stats.built && !this.state.some((s) => s.clear)) }

  dispose(lost = false): void {
    ledger.release('tiles', this.ledgerKey)
    for (const q of this.queries) { try { (this.renderer.getContext() as WebGL2RenderingContext).deleteQuery(q.q) } catch { /* ignore */ } }
    this.queries.length = 0
    if (!lost) { this.rt.dispose(); this.material.dispose(); this.reader?.dispose() }
  }
}
