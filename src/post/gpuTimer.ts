import type { FrameCost } from './motionGrid'
/**
 * What a frame costs the GPU, read without stalling it.
 *
 * rAF intervals are CPU time. With a GPU backlog (draws queue up, the compositor presents the oldest) the interval stays short while the
 * picture is 45 ms or more behind, so every controller fed from `dt` is blind to the real cost. This reads the GPU's own clock:
 *
 *  - EXT_disjoint_timer_query_webgl2 when the browser offers it (TIME_ELAPSED around the whole frame: pure GPU work, no queue wait);
 *  - otherwise a fenceSync after the frame, polled with a non-blocking clientWaitSync: the interval between two completions while the queue
 *    is backed up IS the per-frame GPU time, and submit-to-complete latency is the backlog.
 *
 * Neither path blocks: results are collected a few frames late, from `poll()`.
 */

export interface GpuPerf {
  /** 'query' (disjoint timer), 'fence' (clientWaitSync polling) or 'none'. */
  source: 'query' | 'fence' | 'none'
  gpuMsP50: number
  gpuMsP95: number
  /** Submit-to-complete latency of the newest finished frame (the backlog), ms. */
  latencyMs: number
  /** Same-frame query duration and fence-observed submit latency; diagnostic only (the fence observation includes polling delay). */
  latestTiming: { queryMs: number; latencyMs: number; scale: number; at: number } | null
  /** Frames the GPU finished in the last second (presented-frame estimate). */
  presentedFps: number
  /** The display's refresh rate measured from rAF cadence at rest (0 until measured). */
  displayHz: number
  samples: number
  /** Frames not timed because too many were still unread (the ladder's `fresh` stalls with them). */
  dropped: number
  /** Query/fence pairs rejected or bounded because the timer result was inconsistent. */
  invalidTimings: number
}

interface Pending { q: WebGLQuery | null; /** Later segments of the same frame (the query was suspended for a nested measurement and resumed). */ more?: WebGLQuery[]; sync: WebGLSync | null; submitted: number; tag: boolean; epoch: number; scale: number; alone: boolean; ctx: number; bad?: boolean }

const WINDOW = 90
/** A queued frame's submit-to-done time at or under this (ms) is evidence the frame was cheap (the framePacer's light limit). */
export const PERIOD_LIGHT_MS = 25

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1) + 0.5))]
}

export class GpuTimer {
  readonly source: GpuPerf['source']
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null
  private readonly pending: Pending[] = []
  private readonly ms: number[] = []
  private readonly done: number[] = []
  private open: Pending | null = null
  /** Bumped by reset(): a frame submitted before it is on another grid and its time is dropped. */
  private epoch = 0
  private lastDone = 0
  private lastLatency = 0
  /** begin() calls skipped because the unread queue was full. */
  dropped = 0
  /** Invalid timer or fence observations; cumulative across resets for diagnostics. */
  invalidTimings = 0
  /** The smoothed GPU ms per frame the ladder reads (fast attack, slower release). */
  smoothed = 0
  /** Latest valid query measurement, retaining its actual grid across reset(). */
  latestSample: FrameCost | null = null
  /** Actual full-quality frame cost; fence estimates are accepted only with no queue ahead. */
  fullFrame: FrameCost | null = null

  constructor(private readonly gl: WebGL2RenderingContext, enabled = true, forceFence = false) {
    const ext = enabled && !forceFence ? (gl.getExtension('EXT_disjoint_timer_query_webgl2') as unknown as GpuTimer['ext']) : null
    this.ext = ext
    this.source = !enabled ? 'none' : ext ? 'query' : 'fence'
  }

  /** performance.now() when the newest TAGGED frame (the post-gesture full-size one) finished on the GPU, and how long that frame took. */
  taggedDoneAt = 0
  taggedMs = 0
  /** Paired query and fence timing for the newest completed query frame. */
  latestTiming: GpuPerf['latestTiming'] = null

  /** Frame periods (done - submitted, ms) of motion frames that were alone in flight when submitted, collected by poll(); take them with drainPeriods(). Fence path only. */
  private periods: Array<{ scale: number; ms: number; ctx: number }> = []
  drainPeriods(): Array<{ scale: number; ms: number; ctx: number }> { const p = this.periods; this.periods = []; return p }
  /**
   * Completed query measurements (the raw frame time on the grid it was SUBMITTED at, with the context it was submitted in), each handed out exactly once by
   * drainSamples(). The smoothed figure and `fresh` are not samples: they repeat until the next frame lands. Bounded: only a consumer that drains keeps up.
   */
  private samples: Array<{ scale: number; ms: number; ctx: number }> = []
  drainSamples(): Array<{ scale: number; ms: number; ctx: number }> { const p = this.samples; this.samples = []; return p }

  /** `scale` identifies the rendered grid; reduced frames also feed drainPeriods(), full frames inform recovery. */
  begin(now: number, tag = false, scale = 0, ctx = 0): void {
    if (this.source === 'none' || this.open) return
    if (this.pending.length > 6) { this.dropped++; return }
    const gl = this.gl
    const p: Pending = { q: null, sync: null, submitted: now, tag, epoch: this.epoch, scale, alone: this.pending.length === 0, ctx }
    if (this.ext) {
      p.q = gl.createQuery()
      if (!p.q) return
      gl.beginQuery(this.ext.TIME_ELAPSED_EXT, p.q)
    }
    this.open = p
  }

  /** True while the frame query is ended on purpose (suspend() without resume()). */
  private suspended = false
  /**
   * Ends the open frame query so another TIME_ELAPSED query can run inside the frame (the shadow cache times its layer builds this way: only one
   * TIME_ELAPSED query can be active, so under an open frame query its builds were never measured). resume() starts the frame's next segment; the
   * frame's time is the sum of its segments, so the work in between is excluded from the frame figure and counted by the nested query instead.
   */
  suspend(): void {
    if (!this.open || !this.ext || this.suspended) return
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT)
    this.suspended = true
  }
  resume(): void {
    const p = this.open
    if (!p || !this.ext || !this.suspended) return
    this.suspended = false
    const q = this.gl.createQuery()
    if (!q) { p.bad = true; return }
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q)
    ;(p.more ??= []).push(q)
  }

  end(): void {
    const p = this.open
    if (!p) return
    this.open = null
    const gl = this.gl
    if (this.ext && !this.suspended) gl.endQuery(this.ext.TIME_ELAPSED_EXT)
    this.suspended = false
    p.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    gl.flush()
    this.pending.push(p)
  }

  /** Collects every finished frame, in order, without waiting. Call once per rAF. */
  poll(now: number): void {
    const gl = this.gl
    while (this.pending.length) {
      const p = this.pending[0]
      if (!p.sync) {
        this.pending.shift()
        this.invalidTimings++
        for (const q of p.q ? [p.q, ...(p.more ?? [])] : (p.more ?? [])) gl.deleteQuery(q)
        continue
      }
      const st = gl.clientWaitSync(p.sync, 0, 0)
      if (st === gl.TIMEOUT_EXPIRED) break
      this.pending.shift()
      gl.deleteSync(p.sync)
      // WAIT_FAILED is not a completion. Treating it as one would turn the
      // current poll time into a too-short latency and could validate a bad
      // elapsed-query result against it.
      if (st === gl.WAIT_FAILED) {
        this.invalidTimings++
        for (const q of p.q ? [p.q, ...(p.more ?? [])] : (p.more ?? [])) gl.deleteQuery(q)
        continue
      }
      if (st !== gl.ALREADY_SIGNALED && st !== gl.CONDITION_SATISFIED) {
        this.invalidTimings++
        for (const q of p.q ? [p.q, ...(p.more ?? [])] : (p.more ?? [])) gl.deleteQuery(q)
        continue
      }
      let v = -1
      let rawQueryMs = -1
      if (this.ext && p.q) {
        // Reading GPU_DISJOINT clears it, so one read speaks for every query submitted before it: mark them all, not only this one.
        if (gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean) { p.bad = true; for (const o of this.pending) o.bad = true }
        const all = p.more ? [p.q, ...p.more] : [p.q]
        if (p.bad) this.invalidTimings++
        else if (all.every((q) => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE))) {
          rawQueryMs = all.reduce((sum: number, q) => sum + (gl.getQueryParameter(q, gl.QUERY_RESULT) as number), 0) / 1e6
          v = rawQueryMs
        } else this.invalidTimings++
        for (const q of all) gl.deleteQuery(q)
      } else {
        // Fence path: completions closer together than the draw spacing mean a queue; the gap between them is the frame cost.
        const gap = this.lastDone ? now - this.lastDone : p.submitted ? now - p.submitted : 0
        v = Math.min(gap, now - p.submitted)
      }
      this.lastLatency = now - p.submitted
      this.lastDone = now
      if (this.ext && rawQueryMs >= 0) {
        // Keep the raw pair for diagnosis. A successful fence follows the
        // elapsed query on this context's command stream, so a query more than
        // two milliseconds longer than submit-to-fence wall time is impossible
        // apart from a faulty timer clock/result. With no prior fence pending,
        // the fence latency is a safe (slightly high) substitute. Under a queue
        // it includes unrelated work, so exclude this sample from adaptation.
        this.latestTiming = { queryMs: rawQueryMs, latencyMs: this.lastLatency, scale: p.scale, at: now }
        if (rawQueryMs > this.lastLatency + 2) {
          this.invalidTimings++
          v = p.alone ? this.lastLatency : -1
        }
      }
      this.done.push(now)
      // A frame that was alone in flight reads its true period (done - submitted). A frame behind others would read its period plus the queue wait, which is
      // censored latency, not cost: for those the completion GAP `v` (time since the previous completion, fence path) is the cost estimate. Two completions
      // seen in one poll give gap 0, which says nothing, so it is skipped. Readings above PERIOD_LIGHT_MS are kept: they are what lets the grid count a dear frame.
      if (!this.ext && p.scale > 0 && p.scale < 1 && p.epoch === this.epoch) {
        if (p.alone) this.periods.push({ scale: p.scale, ms: now - p.submitted, ctx: p.ctx })
        else if (v > 0) this.periods.push({ scale: p.scale, ms: v, ctx: p.ctx })
      }
      if (v > 0 && p.epoch === this.epoch && p.scale > 0) {
        if (this.ext) { this.latestSample = { ms: v, scale: p.scale, at: now }; this.samples.push({ scale: p.scale, ms: v, ctx: p.ctx }); if (this.samples.length > 32) this.samples.shift() }
        if (p.scale === 1 && (this.ext || p.alone)) {
          this.fullFrame = { ms: this.ext ? v : now - p.submitted, scale: 1, at: now }
        }
      }
      if (v >= 0 && p.epoch === this.epoch) this.push(v)
      if (p.tag) { this.taggedDoneAt = now; if (v >= 0) this.taggedMs = v }
    }
    while (this.done.length && now - this.done[0] > 1000) this.done.shift()
  }

  private push(v: number): void {
    this.ms.push(v)
    if (this.ms.length > WINDOW) this.ms.shift()
    this.smoothed = this.ms.length === 1 ? v : v > this.smoothed ? this.smoothed * 0.4 + v * 0.6 : this.smoothed * 0.85 + v * 0.15
  }

  /** Forget history (a new gesture, a new grid): the old numbers belong to another resolution. */
  reset(): void { this.ms.length = 0; this.smoothed = 0; this.epoch++; this.periods = []; this.samples = [] }

  /** A frame that threw between begin() and end() left a query open and every later begin() returned early: the timer was dead for the session. */
  abort(): void {
    const p = this.open
    if (!p) return
    this.open = null
    if (this.ext && !this.suspended) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT)
    this.suspended = false
    if (p.q) this.gl.deleteQuery(p.q)
    for (const q of p.more ?? []) this.gl.deleteQuery(q)
  }

  /** Finished frames since the last reset(). */
  get fresh(): number { return this.ms.length }

  stats(): Pick<GpuPerf, 'gpuMsP50' | 'gpuMsP95' | 'latencyMs' | 'latestTiming' | 'presentedFps' | 'samples' | 'dropped' | 'invalidTimings'> {
    const s = this.ms.slice().sort((a, b) => a - b)
    return { gpuMsP50: percentile(s, 0.5), gpuMsP95: percentile(s, 0.95), latencyMs: this.lastLatency, latestTiming: this.latestTiming, presentedFps: this.done.length, samples: s.length, dropped: this.dropped, invalidTimings: this.invalidTimings }
  }
}

/** Measures the display rate from rAF timestamps: the median interval, snapped to a known refresh rate. Only call at rest. */
/**
 * A refresh interval is a FLOOR on rAF gaps: a busy frame (a patch load, a ground rest frame at full size) only makes a gap longer, never shorter.
 * The median of rest gaps therefore reads 30 Hz when half of them are slow (measured on the rig: displayHz 30 in one drag-ground run of 6, frame
 * budget doubled, 46 % of the display rate presented). A low quartile keeps the vsync cadence and still reads a true 30 Hz display as 30.
 */
export const RATE_PERCENTILE = 0.25

export class DisplayRate {
  private last = 0
  private readonly gaps: number[] = []
  hz = 0
  sample(now: number): void {
    if (this.last) {
      const g = now - this.last
      if (g > 4 && g < 40) { this.gaps.push(g); if (this.gaps.length > 60) this.gaps.shift() }
    }
    this.last = now
    if (this.gaps.length >= 20) this.hz = snapHz(1000 / percentile(this.gaps.slice().sort((a, b) => a - b), RATE_PERCENTILE))
  }
  /** A gesture or a pause broke the cadence. */
  gap(): void { this.last = 0 }
}

export function snapHz(hz: number): number {
  for (const r of [30, 48, 50, 60, 72, 90, 100, 120, 144, 165, 240]) if (Math.abs(hz - r) / r < 0.08) return r
  return Math.round(hz)
}

/**
 * GPU ms per pass (diagnostic, `?passes=1`): back-to-back TIME_ELAPSED queries, one per named segment of the frame. Only one such query can be
 * open at a time, so this replaces the whole-frame GpuTimer (which is switched off with it); use with `?motionscale=` since the ladder needs the
 * frame timer. Results arrive a few frames late from `poll()` and are summarised as the median per name over the last 90 frames.
 */
export class PassTimer {
  readonly enabled: boolean
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null
  private frames: Array<Array<{ name: string; q: WebGLQuery }>> = []
  private cur: Array<{ name: string; q: WebGLQuery }> | null = null
  private openName: string | null = null
  private readonly hist = new Map<string, number[]>()
  private readonly totals: number[] = []
  /** Every finished frame's segments (measurement hook `__moon.passFrame`), newest last; cleared by `takeFrames()`. */
  private readonly done: Array<Record<string, number>> = []

  constructor(private readonly gl: WebGL2RenderingContext, want: boolean) {
    this.ext = want ? (gl.getExtension('EXT_disjoint_timer_query_webgl2') as unknown as PassTimer['ext']) : null
    this.enabled = !!this.ext
  }

  /** Starts a frame; the first segment is named `name`. Dropped when too many frames are still unread. */
  begin(name: string): void {
    if (!this.ext || this.frames.length > 8) return
    this.cur = []
    this.open(name)
  }
  /** Closes the open segment and starts `name`. */
  mark(name: string): void { if (this.cur) { this.close(); this.open(name) } }
  /** A frame threw mid-segment: close the query so the next frame can start one. */
  abort(): void { this.close(); this.cur = null }
  end(): void { if (!this.cur) return; this.close(); this.frames.push(this.cur); this.cur = null }

  private open(name: string): void {
    const q = this.gl.createQuery()
    if (!q || !this.ext) return
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q)
    this.openName = name
    this.cur!.push({ name, q })
  }
  private close(): void { if (this.openName !== null && this.ext) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.openName = null }

  poll(): void {
    const gl = this.gl
    while (this.frames.length) {
      const f = this.frames[0]
      if (!gl.getQueryParameter(f[f.length - 1].q, gl.QUERY_RESULT_AVAILABLE)) break
      this.frames.shift()
      // One read clears the flag for every frame still queued (all were submitted before it): drop them all, not just this one.
      if (gl.getParameter(this.ext!.GPU_DISJOINT_EXT)) {
        for (const s of f) gl.deleteQuery(s.q)
        for (const g of this.frames) for (const s of g) gl.deleteQuery(s.q)
        this.frames.length = 0
        continue
      }
      let tot = 0
      const rec: Record<string, number> = {}
      for (const s of f) {
        const v = (gl.getQueryParameter(s.q, gl.QUERY_RESULT) as number) / 1e6
        rec[s.name] = (rec[s.name] ?? 0) + v
        gl.deleteQuery(s.q)
        tot += v
        const h = this.hist.get(s.name) ?? []
        h.push(v); if (h.length > 90) h.shift()
        this.hist.set(s.name, h)
      }
      this.totals.push(tot); if (this.totals.length > 90) this.totals.shift()
      rec.total = tot
      this.done.push(rec); if (this.done.length > 400) this.done.shift()
    }
  }
  pending(): number { return this.done.length }
  takeFrames(): Array<Record<string, number>> { return this.done.splice(0, this.done.length) }
  /** Forget history (a new scale or scene), so a summary describes one setting. */
  reset(): void { this.hist.clear(); this.totals.length = 0 }
  summary(): Record<string, number> | null {
    if (!this.enabled || !this.totals.length) return null
    const out: Record<string, number> = {}
    for (const [k, h] of this.hist) {
      const sorted = h.slice().sort((a, b) => a - b)
      out[k] = +percentile(sorted, 0.5).toFixed(3)
      out[`${k}.p95`] = +percentile(sorted, 0.95).toFixed(3)
      out[`${k}.mean`] = +(h.reduce((x, y) => x + y, 0) / h.length).toFixed(3)
    }
    const ts = this.totals.slice().sort((a, b) => a - b)
    out.total = +percentile(ts, 0.5).toFixed(3)
    out['total.p95'] = +percentile(ts, 0.95).toFixed(3)
    out['total.mean'] = +(this.totals.reduce((x, y) => x + y, 0) / this.totals.length).toFixed(3)
    out.n = this.totals.length
    return out
  }
}
