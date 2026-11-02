import * as THREE from 'three'
import { FULLSCREEN_VERTEX, fullscreenTriangle } from '../../glsl/common'
import { sunBakeFragment } from '../moonShader'
import { ledger } from '../../quality/ledger'
import { SB_BINS, SB_SUN_TOL_RAD, SB_WIDTH, sbBuildOrder, sbBytes, sbGridFromSearch, sbMarginFromSearch } from '../sunHorizon'
import { envBlocksFromSearch } from '../globalHorizon'
import { sunDirectionInBodyFrame } from '../shadowPolicy'

/**
 * The fixed policy's Sun-keyed 4k horizon bake (sunHorizon.ts has the design and the CPU twin): per 4k-map cell and lod bin, the lowest and highest horizon toward the FIXED Sun,
 * so the Moon pass can skip the 32-step 4k march where the Sun is outside that range by the certificate (lit above it, shadowed below it).
 *
 * Build: the Moon pass's own march, in 128 x 128 cell blocks of one bin each (a block is 16,384 cells x 9 positions x 3 lods = 442,368 marches), under a GPU-time budget measured
 * with EXT_disjoint_timer_query_webgl2 (as GlobalHorizonCache), nearest the camera first, only once the Sun has been still for a few frames. A partial bake is read as it stands
 * (an unbuilt cell, code 0, marches live). The bake belongs to the Sun it was built for: when the Sun moves by more than SB_SUN_TOL_RAD the read is switched off (the clock's
 * 0.01 deg tick does not do that) and a new build starts once the Sun is still again. Memory: width x width/2 x 4 bins x 2 bytes (RG8) = 16 MiB desktop (2048), 4 MiB low class (1024).
 */
const BUDGET_MS = { desktop: 2, low: 1 }
/** First guess of one block's GPU time (ms) until it is measured. An ESTIMATE: 442,368 marches at the ~1.5 ns each the rig's d4k0 arm implies. */
const GUESS_MS_PER_BLOCK = { desktop: 1, low: 2 }
const MAX_BLOCKS_PER_FRAME = 8
const OVER_FRAME_MS = 33
/** The Sun must not have moved (beyond a quarter of the tolerance) for this many frames before a build starts. */
const STILL_FRAMES = 12
const BLOCK = 128

export interface SunBakeOpts {
  now: number
  frameMs: number
  /** False when the Moon pass must not read the bake at all (the ground view, baked shadows, heights still easing in). */
  allowed: boolean
  frameQuery?: { suspend(): void; resume(): void }
}

export interface SunBakeStats {
  gpuBytes: number
  width: number
  cellsH: number
  blocks: number
  blocksBuilt: number
  msPerBlock: number
  timed: boolean
  buildMs: number
  /** ms from a build's start to its last block; -1 until one is complete. */
  readyMs: number
  /** Builds started (a Sun move beyond the tolerance starts another). */
  builds: number
  state: 'idle' | 'building' | 'ready'
  readOn: boolean
  failed: boolean
}

export class SunHorizonBake {
  readonly texture: THREE.Texture
  readonly stats: SunBakeStats
  readOn = false
  failed = false
  private readonly rt: THREE.WebGLRenderTarget
  private readonly material: THREE.ShaderMaterial
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.Camera()
  private readonly w: number
  private readonly h: number
  private readonly cls: 'desktop' | 'low'
  private order: Array<{ bx: number; by: number; bin: number }> = []
  private next = 0
  private fbChecked = false
  private msPerBlock: number
  private timer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null
  private queries: Array<{ q: WebGLQuery; n: number }> = []
  private startedAt = -1
  private readonly bakeSun = new THREE.Vector3()
  private readonly sunB = new THREE.Vector3()
  private readonly lastSun = new THREE.Vector3(NaN, 0, 0)
  private stillFrames = 0
  private haveBake = false
  private allowedLast = true
  private readonly ledgerKey = 'sun-horizon-bake'

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly passUniforms: Record<string, THREE.IUniform>, lonSpan: number, mapWidth: number, low = false) {
    this.cls = low ? 'low' : 'desktop'
    this.w = Math.min(SB_WIDTH[this.cls], mapWidth >> 1)
    this.h = (this.w >> 1) * SB_BINS
    this.msPerBlock = GUESS_MS_PER_BLOCK[this.cls]
    try { this.timer = ((renderer.getContext?.() as WebGL2RenderingContext | undefined)?.getExtension('EXT_disjoint_timer_query_webgl2') as typeof this.timer | null | undefined) ?? null } catch { this.timer = null }
    this.rt = new THREE.WebGLRenderTarget(this.w, this.h, { format: THREE.RGFormat, type: THREE.UnsignedByteType, internalFormat: 'RG8', minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false })
    this.rt.texture.wrapS = this.rt.texture.wrapT = THREE.ClampToEdgeWrapping
    this.texture = this.rt.texture
    const shared: Record<string, THREE.IUniform> = {}
    for (const k of ['uK', 'uX', 'uY', 'uHeight', 'uHeightLevels', 'uHeightMix', 'uS']) shared[k] = passUniforms[k]
    const search = typeof location === 'undefined' ? '' : location.search
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: sunBakeFragment(lonSpan, mapWidth, sbGridFromSearch(search)),
      uniforms: { ...shared, uSbSize: { value: new THREE.Vector2(this.w, this.w >> 1) }, uSbMargin: { value: sbMarginFromSearch(search) } },
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    })
    const mesh = new THREE.Mesh(fullscreenTriangle(), this.material)
    mesh.frustumCulled = false
    this.scene.add(mesh)
    const bytes = sbBytes(this.w)
    this.stats = { gpuBytes: bytes, width: this.w, cellsH: this.w >> 1, blocks: Math.ceil(this.w / BLOCK) * Math.ceil((this.w >> 1) / BLOCK) * SB_BINS, blocksBuilt: 0, msPerBlock: this.msPerBlock, timed: false, buildMs: 0, readyMs: -1, builds: 0, state: 'idle', readOn: false, failed: false }
    if (this.h > renderer.capabilities.maxTextureSize) this.fail()
    else ledger.set('tiles', this.ledgerKey, bytes)
    const prev = renderer.getRenderTarget()
    try { renderer.setRenderTarget(this.rt); void renderer.compileAsync?.(this.scene, this.camera)?.catch?.(() => undefined) } catch { /* the first block compiles it */ } finally { renderer.setRenderTarget(prev) }
  }

  private fail(): void { this.failed = true; this.stats.failed = true; this.readOn = false; this.stats.readOn = false }

  /** True once the current Sun is within the tolerance of the bake's. */
  private sunHolds(sun: THREE.Vector3): boolean { return this.haveBake && sun.angleTo(this.bakeSun) <= SB_SUN_TOL_RAD }

  private clearTarget(): void {
    const r = this.renderer
    const prevTarget = r.getRenderTarget(), c = new THREE.Color(), a = r.getClearAlpha()
    r.getClearColor(c)
    r.setRenderTarget(this.rt)
    r.setClearColor(0x000000, 0)
    r.clear(true, false, false)
    r.setClearColor(c, a)
    r.setRenderTarget(prevTarget)
  }

  private draw(rect: { x: number; y: number; w: number; h: number }): boolean {
    const r = this.renderer
    const prevTarget = r.getRenderTarget(), prevFace = r.getActiveCubeFace(), prevMip = r.getActiveMipmapLevel(), prevAuto = r.autoClear
    r.autoClear = false
    this.rt.scissor.set(rect.x, rect.y, rect.w, rect.h)
    this.rt.scissorTest = true
    r.setRenderTarget(this.rt)
    let ok = true
    if (!this.fbChecked) {
      this.fbChecked = true
      const gl = r.getContext?.() as WebGL2RenderingContext | undefined
      if (gl && gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { this.fail(); ok = false }
    }
    if (ok) r.render(this.scene, this.camera)
    r.setRenderTarget(prevTarget, prevFace, prevMip)
    r.autoClear = prevAuto
    this.rt.scissorTest = false
    return ok
  }

  /** Called once per frame before the Moon is drawn. Returns true while blocks remain (the frame loop keeps drawing). */
  update(o: SunBakeOpts): boolean {
    if (this.failed) { this.readOn = false; return false }
    const u = this.passUniforms
    const heightsReady = (u.uHeightMix?.value as number | undefined) === undefined || (u.uHeightMix.value as number) >= 1
    const worldSun = u.uS.value as THREE.Vector3
    const x = u.uX.value as THREE.Vector3, y = u.uY.value as THREE.Vector3, north = u.uK.value as THREE.Vector3
    const [sx, sy, sz] = sunDirectionInBodyFrame([worldSun.x, worldSun.y, worldSun.z], [x.x, x.y, x.z], [y.x, y.y, y.z], [north.x, north.y, north.z])
    const sun = this.sunB.set(sx, sy, sz).normalize()
    // The bake belongs to its Sun: a Sun that left the tolerance switches the read off at once; the build restarts when the Sun has been still.
    if (this.haveBake && !this.sunHolds(sun)) { this.haveBake = false; this.order = []; this.next = 0; this.stats.state = 'idle'; this.stats.blocksBuilt = 0 }
    this.allowedLast = o.allowed && heightsReady
    if (!o.allowed || !heightsReady) { this.readOn = false; this.stats.readOn = false; return false }
    if (Number.isNaN(this.lastSun.x) || sun.angleTo(this.lastSun) > SB_SUN_TOL_RAD / 4) { this.lastSun.copy(sun); this.stillFrames = 0 } else this.stillFrames++
    if (this.stats.state === 'ready') { this.readOn = true; this.stats.readOn = true; return false }
    if (!this.haveBake) {
      this.readOn = false; this.stats.readOn = false
      // Busy while it waits: a still scene draws no further frames on its own, and a build that needs STILL_FRAMES more frames to start would never start.
      if (this.stillFrames < STILL_FRAMES) return true
      // Start a build for this Sun: every cell unbuilt (code 0), nearest the camera first.
      this.clearTarget()
      this.bakeSun.copy(sun)
      this.haveBake = true
      const cam = (u.uCamPos.value as THREE.Vector3).clone()
      const d = new THREE.Vector3(cam.dot(u.uX.value as THREE.Vector3), cam.dot(u.uY.value as THREE.Vector3), cam.dot(u.uK.value as THREE.Vector3)).normalize()
      this.order = sbBuildOrder(this.w, this.w >> 1, [d.x, d.y, d.z], BLOCK)
      this.next = 0
      this.stats.state = 'building'; this.stats.blocksBuilt = 0; this.stats.builds++
      this.startedAt = o.now
    }
    this.pollQueries()
    const budget = BUDGET_MS[this.cls]
    const forced = typeof location === 'undefined' ? null : envBlocksFromSearch(location.search)
    const n = forced ?? (o.frameMs > OVER_FRAME_MS || !this.stats.timed ? 1 : Math.max(1, Math.min(MAX_BLOCKS_PER_FRAME, Math.floor(budget / this.msPerBlock))))
    const timing = this.beginQuery(o.frameQuery)
    let built = 0
    const cellsH = this.w >> 1
    while (built < n && this.next < this.order.length) {
      const b = this.order[this.next]
      const x = b.bx * BLOCK, y = b.by * BLOCK
      const bw = Math.min(BLOCK, this.w - x), bh = Math.min(BLOCK, cellsH - y)
      if (!this.draw({ x, y: b.bin * cellsH + y, w: bw, h: bh })) { if (timing) this.endQuery(built, o.frameQuery); return false }
      this.next++; built++
    }
    if (timing) this.endQuery(built, o.frameQuery)
    this.stats.blocksBuilt += built
    // Whatever is built is read: an unbuilt cell is code 0 and marches live.
    this.readOn = built > 0 || this.stats.blocksBuilt > 0
    this.stats.readOn = this.readOn
    if (this.next >= this.order.length) {
      this.stats.state = 'ready'
      this.stats.readyMs = o.now - this.startedAt
      return false
    }
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

  /** True when nothing is left to build (a deterministic capture can draw). */
  captureIdle(): boolean { return this.failed || this.stats.state === 'ready' || !this.allowedLast }

  dispose(lost = false): void {
    ledger.release('tiles', this.ledgerKey)
    if (!lost) { this.rt.dispose(); this.material.dispose() }
  }
}
