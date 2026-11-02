import * as THREE from 'three'
import { trackGpu } from '../quality/track'

/** Levels of the glare pyramid (moon-v1's LEVELS). */
export const GLARE_LEVELS = 7

/** The scene target and the glare pyramid for one render size. */
export interface TargetSet {
  w: number
  h: number
  scene: THREE.WebGLRenderTarget
  /**
   * RGBA16F: real hit coverage, night eligibility, measured-albedo template, view cosine. Drawn only under a visibility calibration or an audit
   * freeze, so it is allocated on first use (`TargetCache.metadata`); null until then. The final pass binds a 1x1 stand-in meanwhile.
   */
  moonMetadata: THREE.WebGLRenderTarget | null
  down: THREE.WebGLRenderTarget[]
  up: THREE.WebGLRenderTarget[]
}

function halfFloatTarget(w: number, h: number, depth = false): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    // Ground mode (src/ground/): the scene target also holds the ground's depth (32-bit float) for the mesh pass to test against.
    ...(depth ? { depthTexture: new THREE.DepthTexture(w, h, THREE.FloatType) } : {}),
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: depth,
    stencilBuffer: false,
    generateMipmaps: false,
  })
  // RGBA16F colour, plus the 32-bit depth texture in ground mode.
  trackGpu('targets', `rt-${w}x${h}`, Math.round(w * h * (8 + (depth ? 4 : 0))), rt)
  return rt
}

/** Sets kept: the full size, the refine's mid grid and the gesture's grid. A ladder step or a gesture on another grid builds one more and evicts the oldest. */
export const DEFAULT_TARGET_SETS = 3

/**
 * RGBA16F targets by size. Frames in motion render smaller (main.ts), so a
 * few sizes are kept: the full-resolution set and a couple of reduced ones.
 */
export class TargetCache {
  private readonly sets = new Map<string, TargetSet>()
  private depth = false
  /** Sets built and sets disposed by the size limit since the start (a build is a GPU allocation inside a frame; `?targetcache=N` raises the limit for an A/B). */
  built = 0
  evicted = 0
  /** Render sizes kept (the class table's `targetSets`, default DEFAULT_TARGET_SETS; `?targetcache=N` can raise it). Lowering it evicts at the next `get`. */
  maxSets = DEFAULT_TARGET_SETS

  stats(): { targetSets: number; targetBuilt: number; targetEvicted: number } { return { targetSets: this.sets.size, targetBuilt: this.built, targetEvicted: this.evicted } }

  /** Give the scene targets a depth attachment (ground mode) or take it away; the orbital views never pay for one. */
  setDepth(on: boolean): void {
    if (on === this.depth) return
    this.depth = on
    for (const t of this.sets.values()) for (const x of [t.scene, t.moonMetadata, ...t.down, ...t.up]) x?.dispose()
    this.sets.clear()
    this.releaseScratch()
  }

  /** The set's metadata target, allocated on the first call (calibration and audit frames only; ordinary frames never touch it). */
  metadata(t: TargetSet): THREE.WebGLRenderTarget {
    return t.moonMetadata ??= halfFloatTarget(t.w, t.h, this.depth)
  }

  private scratchRt: THREE.WebGLRenderTarget | null = null
  /**
   * A scene target for an off-screen warm-up draw that must not disturb the cache: a cached set of that size is reused without touching its LRU position
   * (nothing is built, nothing evicted); otherwise one scratch target is kept, replaced when the size changes, until `releaseScratch`.
   */
  warmScene(w: number, h: number): THREE.WebGLRenderTarget {
    const hit = this.sets.get(`${w}x${h}`)
    if (hit) return hit.scene
    if (this.scratchRt && (this.scratchRt.width !== w || this.scratchRt.height !== h)) this.releaseScratch()
    return (this.scratchRt ??= halfFloatTarget(w, h, this.depth))
  }
  releaseScratch(): void { this.scratchRt?.dispose(); this.scratchRt = null }

  get(w: number, h: number): TargetSet {
    const key = `${w}x${h}`
    let t = this.sets.get(key)
    if (t) {
      // Most recently used last.
      this.sets.delete(key)
      this.sets.set(key, t)
      return t
    }
    const down: THREE.WebGLRenderTarget[] = []
    let lw = w, lh = h
    for (let i = 0; i < GLARE_LEVELS; i++) {
      lw = Math.max(2, lw >> 1)
      lh = Math.max(2, lh >> 1)
      down.push(halfFloatTarget(lw, lh))
    }
    const up = down.map((d) => halfFloatTarget(d.width, d.height))
    t = { w, h, scene: halfFloatTarget(w, h, this.depth), moonMetadata: null, down, up }
    this.sets.set(key, t)
    this.built++
    while (this.sets.size > Math.max(1, this.maxSets)) {
      this.evicted++
      const [oldKey, old] = this.sets.entries().next().value as [string, TargetSet]
      this.sets.delete(oldKey)
      for (const x of [old.scene, old.moonMetadata, ...old.down, ...old.up]) x?.dispose()
    }
    return t
  }
}
