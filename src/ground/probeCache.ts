/**
 * Ground heights already probed on the GPU, kept for the last few points.
 *
 * `GroundPass.probe` is a synchronous readback: it returns only when the queued ground march has executed (a 12 ms stall per frame on the GPU rig, #65).
 * Several callers ask for different points in the same frame (the camera's own height, the lunar module's pad discs, the height tape), so a cache of one
 * point is overwritten between two asks for the same point and every ask misses. A few entries make a still camera cost no probe at all.
 */
export class PointCache {
  private readonly pts: Array<{ e: number; n: number; z: number; at: number }> = []
  constructor(private readonly size = 8, private readonly tolM = 0.05, private readonly ttlMs = 1000) {}

  get(e: number, n: number, now: number): number | null {
    for (let i = 0; i < this.pts.length; i++) {
      const c = this.pts[i]
      if (Math.abs(c.e - e) < this.tolM && Math.abs(c.n - n) < this.tolM && now - c.at < this.ttlMs) {
        if (i > 0) { this.pts.splice(i, 1); this.pts.unshift(c) } // most recent first
        return c.z
      }
    }
    return null
  }

  /**
   * The newest height within `reachM` (metres, straight line) of (e, n), expired or not: the async path (`ProbeQueue`) serves it while the GPU reads the
   * asked point, so it may be one frame stale in time and up to `reachM` off in place. Null when nothing that close is known.
   */
  nearest(e: number, n: number, reachM: number): number | null {
    for (const c of this.pts) if (Math.hypot(c.e - e, c.n - n) <= reachM) return c.z
    return null
  }

  set(e: number, n: number, z: number, now: number): void {
    this.pts.unshift({ e, n, z, at: now })
    if (this.pts.length > this.size) this.pts.pop()
  }

  clear(): void { this.pts.length = 0 }
}

/**
 * How far (metres) a cached height may be from the asked point before the async path stops answering with it and the caller waits for the GPU as before.
 * A walking camera moves 2.3 cm a frame (8 cm fast) at 60 Hz, so a one-frame-late answer is a few centimetres off in place; a hitch that moves the camera
 * farther than this in one frame falls back to the synchronous probe rather than set the eye from a height 20 cm away on a slope.
 */
export const PROBE_REACH_M = 0.2

/** One asked read: the points sent, which of them (index, -1 none) is the lunar module's Sun-share ask at the origin, and the terrain generation it was asked under. */
export interface ProbeAsk { pts: Array<[number, number]>; sun: number; gen: number }

/**
 * The asks of the async height path (`?gprobe=async`): at most one fence read in flight; while it is, the latest height ask and a Sun-share ask wait and
 * go out together, in one read, the moment it lands. `begin` draws the probe pass and starts the readback (GroundPass.probeBegin); false when it could not.
 * `drop` goes with every clear of the cache (finer heights arrived, the camera jumped): a read asked before it is answered by the old terrain, so it is
 * discarded when it lands instead of entering the cache as the newest height.
 */
export class ProbeQueue {
  private inFlight: ProbeAsk | null = null
  private wanted: [number, number] | null = null
  private wantSun = false
  private gen = 0
  /** `sameM`: an ask within this of the point already being read (the cache's own tolerance) is that read, not a second one behind it. */
  constructor(private readonly begin: (pts: ReadonlyArray<readonly [number, number]>) => boolean, private readonly sameM = 0.05) {}

  get pending(): boolean { return this.inFlight !== null }

  /** Invalidates the read in flight (its result is dropped when it lands); the asks still waiting go out under the new generation. */
  drop(): void { this.gen++ }

  /**
   * Asks for the height at (e, n): read now, or next (a newer ask replaces an older one still waiting). The same point asked twice in a frame (the
   * camera's follow and the HUD's tape) is one read: a second one would push the next frame's point a read further back.
   */
  ask(e: number, n: number): void {
    const f = this.inFlight
    if (f && f.gen === this.gen && f.pts.some((p) => Math.abs(p[0] - e) < this.sameM && Math.abs(p[1] - n) < this.sameM)) return
    this.wanted = [e, n]
    this.flush()
  }

  /** Asks for the ground sample at the origin (its `lit` is the module's Sun share). */
  askSun(): void { this.wantSun = true; this.flush() }

  private flush(): void {
    if (this.inFlight || (!this.wanted && !this.wantSun)) return
    const pts: Array<[number, number]> = this.wanted ? [this.wanted] : []
    const sun = this.wantSun ? pts.push([0, 0]) - 1 : -1
    if (!this.begin(pts)) return
    this.inFlight = { pts, sun, gen: this.gen }
    this.wanted = null
    this.wantSun = false
  }

  /** The read in flight has landed: what it asked for (null when none was, or when `drop` invalidated it meanwhile), and the waiting asks go out. */
  landed(): ProbeAsk | null {
    const f = this.inFlight
    this.inFlight = null
    this.flush()
    return f && f.gen === this.gen ? f : null
  }

  /** Forgets everything (leaving ground mode, a lost context). */
  clear(): void { this.inFlight = null; this.wanted = null; this.wantSun = false; this.gen++ }
}
