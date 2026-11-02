import * as THREE from 'three'
import { FULLSCREEN_VERTEX, fullscreenTriangle } from '../../glsl/common'
import { globalHorizonFragment } from '../moonShader'
import { ledger } from '../../quality/ledger'
import { EnvReadback } from './envReadback'
import { ENV_BLOCK, ENV_FINE_GRID, ENV_SECTOR_AZ, ENV_SECTOR_WIDTH, envBlockOrder, envBlocksFromSearch, envSectorBytes, sectorAzFromSearch, sectorGridFromSearch } from '../globalHorizon'

/**
 * The fixed policy's horizon envelope of the 4k height map (globalHorizon.ts has the design and the CPU twin): per texel the highest horizon in any azimuth,
 * Sun-independent, so it is built ONCE per height map (not per Sun epoch, so a moving Sun never empties it) and read by the Moon pass to skip the Sun march where
 * the Sun clears it and the viewer-visibility march where the viewer does.
 *
 * Build: the same march the Moon pass runs, in 128-texel blocks under a GPU-time budget (block cost measured with EXT_disjoint_timer_query_webgl2 around each
 * batch, polled on later frames; gl.finish is NOT a measurement in Chrome, it returned in 0.05 ms per block on the L4; without the extension one block a frame), nearest the camera first. When every block is in, one dilate pass writes the 3x3-maximum texture the shader reads and
 * the raw texture is released: 4 MiB (desktop, 1024 x 512) or 1 MiB (low class, 512 x 256), RG32UI: eight azimuth-sector bytes a texel, stay resident. Until then `readOn` is false and every pixel
 * marches live, as legacy; an unbuilt or unbounded texel does the same.
 */
/** A 1 x 1 RG32UI texture for a usampler2D that must not read anything now (three binds a float placeholder to a null sampler, which WebGL rejects for an unsigned sampler). */
function emptyIntTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint32Array(2), 1, 1, THREE.RGIntegerFormat, THREE.UnsignedIntType)
  t.internalFormat = 'RG32UI'
  t.minFilter = t.magFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
}
/** GPU time the build may take per frame (ms), by device class. */
const BUDGET_MS = { desktop: 2, low: 1 }
/** First guess of one block's GPU time (ms) until it is measured: a 128 x 128 block is 16384 texels x 5 points x 8 azimuths x 4 lods = 2.6 M marches. */
const GUESS_MS_PER_BLOCK = { desktop: 4, low: 8 }
const MAX_BLOCKS_PER_FRAME = 16
/** A frame already this slow (ms) gets one block. */
const OVER_FRAME_MS = 33

export interface GlobalHorizonOpts {
  /** performance.now(). */
  now: number
  /** This frame's smoothed length (ms): a slow frame builds one block. */
  frameMs: number
  /** False when the Moon pass must not read the envelope at all (the ground view, baked shadows, heights still easing in). */
  allowed: boolean
  /** False when no build should start now. */
  build?: boolean
  /** The frame timer's open TIME_ELAPSED query: ended around the build batch (only one can be active) and resumed after. */
  frameQuery?: { suspend(): void; resume(): void }
}

export interface GlobalHorizonStats {
  gpuBytes: number
  width: number
  blocks: number
  blocksBuilt: number
  blocksLastFrame: number
  msPerBlock: number
  /** True once a timer query has measured a batch (msPerBlock is then a measurement, else only the first guess). */
  timed: boolean
  buildMs: number
  /** ms from the first build to the envelope being ready; -1 until then. */
  readyMs: number
  state: 'idle' | 'raw' | 'ready'
  readOn: boolean
  failed: boolean
}

export class GlobalHorizonCache {
  /** The dilated envelope (RG32UI), read by the Moon pass as `uEnvTex`. */
  readonly texture: THREE.Texture
  readonly stats: GlobalHorizonStats
  /** The shader may read the envelope (set by update()). */
  readOn = false
  failed = false
  private rtRaw: THREE.WebGLRenderTarget | null
  private readonly rtEnv: THREE.WebGLRenderTarget
  private readonly material: THREE.ShaderMaterial
  private readonly noRaw = emptyIntTexture()
  private reader: EnvReadback | null = null
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.Camera()
  private readonly w: number
  private readonly h: number
  private readonly cls: 'desktop' | 'low'
  private order: Array<{ bx: number; by: number }> = []
  private next = 0
  private fbChecked = false
  private msPerBlock: number
  private buildFrames = 0
  private timer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null
  private queries: Array<{ q: WebGLQuery; n: number }> = []
  private startedAt = -1
  private readonly ledgerKey = 'horizon-envelope'
  private allowedLast = true

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly passUniforms: Record<string, THREE.IUniform>, lonSpan: number, mapWidth: number, low = false, az: number = typeof location === 'undefined' ? ENV_SECTOR_AZ : sectorAzFromSearch(location.search), private readonly block: number = ENV_BLOCK, grid: number = typeof location === 'undefined' ? ENV_FINE_GRID : sectorGridFromSearch(location.search)) {
    this.cls = low ? 'low' : 'desktop'
    this.w = Math.min(ENV_SECTOR_WIDTH[this.cls], mapWidth >> 1)
    this.h = this.w >> 1
    this.msPerBlock = GUESS_MS_PER_BLOCK[this.cls]
    try { this.timer = ((renderer.getContext?.() as WebGL2RenderingContext | undefined)?.getExtension('EXT_disjoint_timer_query_webgl2') as typeof this.timer | null | undefined) ?? null } catch { this.timer = null }
    const mk = (): THREE.WebGLRenderTarget => {
      const rt = new THREE.WebGLRenderTarget(this.w, this.h, { format: THREE.RGIntegerFormat, type: THREE.UnsignedIntType, internalFormat: 'RG32UI', minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false })
      rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping
      return rt
    }
    this.rtRaw = mk()
    this.rtEnv = mk()
    this.texture = this.rtEnv.texture
    const shared: Record<string, THREE.IUniform> = {}
    for (const k of ['uK', 'uX', 'uY', 'uHeight', 'uHeightLevels', 'uHeightMix']) shared[k] = passUniforms[k]
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: globalHorizonFragment(lonSpan, mapWidth, az, grid),
      uniforms: { ...shared, uGhMode: { value: 0 }, uEnvSize: { value: new THREE.Vector2(this.w, this.h) }, uEnvRaw: { value: this.noRaw } },
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    })
    const mesh = new THREE.Mesh(fullscreenTriangle(), this.material)
    mesh.frustumCulled = false
    this.scene.add(mesh)
    const bytes = 2 * envSectorBytes(this.w)
    this.stats = { gpuBytes: bytes, width: this.w, blocks: Math.ceil(this.w / this.block) * Math.ceil(this.h / this.block), blocksBuilt: 0, blocksLastFrame: 0, msPerBlock: this.msPerBlock, timed: false, buildMs: 0, readyMs: -1, state: 'idle', readOn: false, failed: false }
    ledger.set('tiles', this.ledgerKey, bytes)
    // Link the build program in the background with the target bound (three keys a program by the target), so the first block does not stall a frame on it.
    const prevTarget = renderer.getRenderTarget()
    try { renderer.setRenderTarget(this.rtRaw); void renderer.compileAsync?.(this.scene, this.camera)?.catch?.(() => undefined) } catch { /* the first block compiles it */ } finally { renderer.setRenderTarget(prevTarget) }
  }

  private fail(): void { this.failed = true; this.stats.failed = true; this.readOn = false; this.stats.readOn = false }

  /** One draw into `rt` with an optional scissor rectangle (texels). */
  private draw(rt: THREE.WebGLRenderTarget, mode: number, rect: { x: number; y: number; w: number; h: number } | null): boolean {
    const r = this.renderer
    const prevTarget = r.getRenderTarget(), prevFace = r.getActiveCubeFace(), prevMip = r.getActiveMipmapLevel(), prevAuto = r.autoClear
    this.material.uniforms.uGhMode.value = mode
    // The program samples uEnvRaw in its dilate branch. While a block is drawn INTO the raw texture, that texture must not be bound to the sampler (WebGL rejects the draw as a
    // feedback loop even when the branch is not taken: the first rig run built nothing, 4 ms for 32 blocks). Only the dilate pass, which draws into rtEnv, binds it.
    // A null sampler value would make three bind its FLOAT placeholder to this usampler2D, and WebGL rejects the draw ("Mismatch between texture format and sampler type"): the integer placeholder stands in.
    this.material.uniforms.uEnvRaw.value = mode === 1 ? this.rtRaw?.texture ?? this.noRaw : this.noRaw
    r.autoClear = false
    if (rect) { rt.scissor.set(rect.x, rect.y, rect.w, rect.h); rt.scissorTest = true } else rt.scissorTest = false
    r.setRenderTarget(rt)
    let ok = true
    if (!this.fbChecked) {
      this.fbChecked = true
      const gl = r.getContext?.() as WebGL2RenderingContext | undefined
      if (gl && gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { this.fail(); ok = false }
    }
    if (ok) r.render(this.scene, this.camera)
    r.setRenderTarget(prevTarget, prevFace, prevMip)
    r.autoClear = prevAuto
    rt.scissorTest = false
    return ok
  }

  /** Called once per frame before the Moon is drawn. Returns true while blocks remain (the frame loop keeps drawing). */
  update(o: GlobalHorizonOpts): boolean {
    if (this.failed) { this.readOn = false; return false }
    const u = this.passUniforms
    const heightsReady = (u.uHeightMix?.value as number | undefined) === undefined || (u.uHeightMix.value as number) >= 1
    this.allowedLast = o.allowed && heightsReady
    if (!o.allowed || !heightsReady) { this.readOn = false; this.stats.readOn = false; return false }
    if (this.stats.state === 'ready') { this.readOn = true; this.stats.readOn = true; return false }
    this.readOn = false; this.stats.readOn = false
    if (o.build === false) return true
    if (this.order.length === 0) {
      const cam = (u.uCamPos.value as THREE.Vector3).clone()
      const d = new THREE.Vector3(cam.dot(u.uX.value as THREE.Vector3), cam.dot(u.uY.value as THREE.Vector3), cam.dot(u.uK.value as THREE.Vector3)).normalize()
      this.order = envBlockOrder(this.w, this.h, [d.x, d.y, d.z], this.block)
      this.stats.state = 'raw'
      this.startedAt = o.now
    }
    this.pollQueries()
    const budget = BUDGET_MS[this.cls]
    // Until a batch has been timed (or with no timer extension) one block a frame: the cost of a block is unknown, and a guess that is too small stalls the frame.
    const forced = typeof location === 'undefined' ? null : envBlocksFromSearch(location.search)
    const n = forced ?? (o.frameMs > OVER_FRAME_MS || !this.stats.timed ? 1 : Math.max(1, Math.min(MAX_BLOCKS_PER_FRAME, Math.floor(budget / this.msPerBlock))))
    const timing = this.beginQuery(o.frameQuery)
    let built = 0
    while (built < n && this.next < this.order.length) {
      const b = this.order[this.next]
      const x = b.bx * this.block, y = b.by * this.block
      if (!this.draw(this.rtRaw!, 0, { x, y, w: Math.min(this.block, this.w - x), h: Math.min(this.block, this.h - y) })) { if (timing) this.endQuery(built, o.frameQuery); return false }
      this.next++; built++
    }
    if (timing) this.endQuery(built, o.frameQuery)
    this.buildFrames++
    this.stats.blocksBuilt += built
    this.stats.blocksLastFrame = built
    if (this.next >= this.order.length) {
      // Every block is in: the 3x3 maximum, then the raw texture is released.
      if (!this.draw(this.rtEnv, 1, null)) return false
      this.rtRaw!.dispose(); this.rtRaw = null
      this.material.uniforms.uEnvRaw.value = this.noRaw
      ledger.set('tiles', this.ledgerKey, envSectorBytes(this.w))
      this.stats.gpuBytes = envSectorBytes(this.w)
      this.stats.state = 'ready'
      this.stats.readyMs = o.now - this.startedAt
      this.readOn = true; this.stats.readOn = true
      return true
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

  /** Dev/rig: the dilated envelope read back through an RGBA8 copy (EnvReadback): w * h * 8 bytes, ((y * w + x) * 8 + sector); null until it is built. */
  readback(): Uint8Array | null {
    if (this.stats.state !== 'ready') return null
    this.reader ??= new EnvReadback(this.renderer)
    return this.reader.read2D(this.rtEnv.texture, this.w, this.h)
  }
  get size(): { w: number; h: number } { return { w: this.w, h: this.h } }

  /** True when nothing is left to build (a deterministic capture can draw). */
  captureIdle(): boolean { return this.failed || this.stats.state === 'ready' || !this.allowedLast }

  dispose(lost = false): void {
    ledger.release('tiles', this.ledgerKey)
    if (!lost) { this.rtRaw?.dispose(); this.rtEnv.dispose(); this.material.dispose(); this.noRaw.dispose(); this.reader?.dispose() }
  }
}
