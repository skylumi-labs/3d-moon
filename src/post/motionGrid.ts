/**
 * The render grid of a moving frame (MOON-UX-REDESIGN 5.1, step 1), chosen from the GPU's own frame time.
 *
 * Everything the renderer draws at the limb and along the terminator lives on the render grid: the limb's one-pixel ramp, the sub-pixel march
 * offsets, the upsampling. A grid that changes while the Moon is turning makes the limb go soft, sharp, soft (measured: 20 to 80 % limb width 1.44 to
 * 2.13 px over one drag, 0.93 to 1.25 px at full size). So the grid changes rarely and only on evidence.
 *
 * The evidence is GPU time (post/gpuTimer.ts), not the rAF interval: with a backlog the interval stays short while the picture is 45 ms or more behind
 * (measured on an Apple M5: a 1-pixel readPixels stalled 45 ms p50 during a drag), and the old controller read that interval and could even step the
 * resolution UP while the presented rate was low. A frame's cost scales with its pixel count (the marches run per pixel), so one measurement predicts
 * every other step: cost(s') = cost(s) * (s' / s)^2.
 */

/** Steps of the motion grid, as a fraction of the canvas side. */
export const MOTION_STEPS = [0.25, 0.35, 0.5, 0.7, 1]
/** Full resolution requires evidence from actual full-quality frames, not extrapolated cheap shaders. */
export const DEFAULT_MAX_MOTION_SCALE = 0.7

/** Without a measured display rate: 60 fps. */
export const DEFAULT_DISPLAY_HZ = 60
/** The frame budget a drag aims at (ms): the display's refresh interval, 16.7 at 60 Hz, 8.3 at 120 Hz (ProMotion). */
export function frameBudgetMs(displayHz: number): number {
  const hz = displayHz >= 24 ? displayHz : DEFAULT_DISPLAY_HZ
  return Math.min(1000 / 24, Math.max(1000 / 144, 1000 / hz))
}

/** A display faster than 60 Hz drops to the steady 60 Hz tier only when even this grid is predicted over the native budget (the pre-#96 floor). */
export const PACE_FLOOR = 0.35
/** The 30 Hz tier is a last resort: only when even this grid (the coarsest step) is predicted over the budget of the tier above it. */
export const PACE_LAST_FLOOR = 0.25
/** Adaptive pacing tiers, rounded UP to whole vsyncs so frames land on a steady cadence. */
export const PACE_SLOW_HZ = 60
export const PACE_SLOWEST_HZ = 30
/** The budget for a target cadence on a display: a whole number of vsyncs, at least two. */
export function slowBudgetMs(displayHz: number, targetHz = PACE_SLOW_HZ): number {
  const native = frameBudgetMs(displayHz)
  const target = frameBudgetMs(targetHz)
  if (native >= target) return native
  // The display's own vsync, not the clamped budget: at 165 Hz a vsync is 6.1 ms though the budget floor is 6.9.
  const vsync = displayHz >= 24 ? 1000 / displayHz : native
  return vsync * Math.max(2, Math.ceil(target / vsync - 0.1))
}

/** `?pacetier=`: auto (default), `off` (always native cadence), `60` or `30` (force that tier where the display allows it). */
export type PaceMode = 'auto' | 'off' | '60' | '30'
export function parsePaceMode(v: string | null | undefined): PaceMode { return v === 'off' || v === '60' || v === '30' ? v : 'auto' }

/**
 * The tier decision as a pure function: 0 native, 1 steady 60 Hz (only where the display is faster than 60 Hz), 2 steady 30 Hz.
 * The motion grid is lowered first: native stays until even the lowest-quality floor for that tier (PACE_FLOOR on a display with a 60 Hz tier, else
 * PACE_LAST_FLOOR) is predicted over FIT * native; 30 Hz is chosen only when even PACE_LAST_FLOOR is predicted over FIT * the 60 Hz budget.
 * Moving back up needs the UNDER margin, so the choice does not flap.
 */
export function paceTier(tier: 0 | 1 | 2, displayHz: number, ms: number, from: number): 0 | 1 | 2 {
  const native = frameBudgetMs(displayHz)
  const budget60 = slowBudgetMs(displayHz, PACE_SLOW_HZ)
  const can60 = budget60 > native * 1.01
  const p = (g: number): number => predictMs(ms, from, g)
  const f0 = can60 ? PACE_FLOOR : PACE_LAST_FLOOR
  if (tier === 0) {
    if (p(f0) <= FIT * native) return 0
    return can60 && p(PACE_LAST_FLOOR) <= FIT * budget60 ? 1 : 2
  }
  if (tier === 1) {
    if (p(PACE_FLOOR) <= UNDER * native) return 0
    return p(PACE_LAST_FLOOR) > FIT * budget60 ? 2 : 1
  }
  if (p(f0) <= UNDER * native) return 0
  if (can60 && p(PACE_LAST_FLOOR) <= UNDER * budget60) return 1
  return 2
}

/**
 * The budget the ladder fits to, aware of frame pacing. It keeps the display's native cadence as long as lowering the motion grid can fit it, then
 * a steady 60 Hz cadence (faster displays only), and drops to 30 Hz only as a last resort (see paceTier). The selected tier uses hysteresis, and a
 * change of display rate starts the choice afresh.
 */
export class PacingBudget {
  private tier: 0 | 1 | 2 = 0
  private hz = 0
  private lastDrawAt = -1e9
  /** Decisions made on each tier since the page loaded (perf field: a gesture's tier is gone by the time the page is read). */
  readonly tierCalls: [number, number, number] = [0, 0, 0]
  constructor(private readonly mode: PaceMode = 'auto') {}
  get isSlow(): boolean { return this.tier !== 0 }
  get currentTier(): 0 | 1 | 2 { return this.tier }
  get cadenceHz(): number { return this.tier === 2 ? PACE_SLOWEST_HZ : this.tier === 1 ? PACE_SLOW_HZ : this.hz }
  private budgetFor(hz: number, tier: 0 | 1 | 2): number { return tier === 0 ? frameBudgetMs(hz) : slowBudgetMs(hz, tier === 1 ? PACE_SLOW_HZ : PACE_SLOWEST_HZ) }
  /** `ms` was measured at grid `from`. Without a measurement (ms <= 0) the previous choice stands. */
  get(displayHz: number, ms: number, from: number): number {
    if (displayHz !== this.hz) { this.hz = displayHz; this.tier = 0 }
    if (this.mode === 'off') { this.tier = 0; return frameBudgetMs(displayHz) }
    if (this.mode === '30') { this.tier = frameBudgetMs(displayHz) >= frameBudgetMs(PACE_SLOWEST_HZ) ? 0 : 2; return this.budgetFor(displayHz, this.tier) }
    if (this.mode === '60') { this.tier = slowBudgetMs(displayHz, PACE_SLOW_HZ) > frameBudgetMs(displayHz) * 1.01 ? 1 : 0; return this.budgetFor(displayHz, this.tier) }
    if (!(ms > 0) || !(from > 0)) return this.budgetFor(displayHz, this.tier)
    this.tier = paceTier(this.tier, displayHz, ms, from)
    this.tierCalls[this.tier]++
    return this.budgetFor(displayHz, this.tier)
  }
  /** True when this vsync should not draw: the selected tier has not elapsed since the last draw. */
  holdFrame(now: number): boolean { return this.isSlow && now - this.lastDrawAt < this.budgetFor(this.hz, this.tier) * 0.9 }
  /** Call when a frame is drawn. */
  drew(now: number): void { this.lastDrawAt = now }
  reset(): void { this.tier = 0 }
}

/** A grid is chosen to cost at most this share of the budget (the rest is headroom for the CPU side, the glare pyramid and the compositor). */
export const FIT = 0.85
/** A measured frame over this share of the budget steps the grid down at once (a few frames' evidence). */
export const OVER = 1.05
/** The next finer grid is tried only when it is predicted to cost at most this share of the budget (the hysteresis against oscillation). */
export const UNDER = 0.7
/** Fresh measurements (frames drawn on the current grid and finished by the GPU) needed before a step down, and before a step up. */
export const SAMPLES_DOWN = 2
export const SAMPLES_UP = 14

/**
 * The share of a motion frame's GPU time that does not shrink with the grid (the full-size glare and final passes, the upsample, the per-frame
 * uploads). 0 is the pure pixel-count model above, which is right for a phone. Measured on an Apple M5 at 657x773 DPR 2 (2026-10-07, n=6 per
 * step, GPU p50): grid 0.25 7.7 ms, 0.35 10.6, 0.5 9.7, 0.7 9.3, a full frame 16. The pure model predicted 0.5 from 0.35 at 20 ms, so the ladder never
 * climbed past 0.35 and every drag ran on the coarsest grid, where shadow edges sparkle. `setFixedShare` is set once from the quality class.
 */
let fixedShare = 0
export function setFixedShare(f: number): void { fixedShare = Number.isFinite(f) ? Math.min(0.95, Math.max(0, f)) : 0 }

/** Predicted GPU ms of a frame at grid `to` given `ms` measured at grid `from`. */
export function predictMs(ms: number, from: number, to: number): number {
  const r = (to / from) * (to / from)
  return ms * (fixedShare + (1 - fixedShare) * r)
}

/** The finest step predicted to fit `fit * budget` from a measurement, or the coarsest step when none does. */
export function fitScale(ms: number, from: number, budget: number, fit = FIT, maxScale = DEFAULT_MAX_MOTION_SCALE): number {
  for (let i = MOTION_STEPS.length - 1; i >= 0; i--) if (MOTION_STEPS[i] <= maxScale && predictMs(ms, from, MOTION_STEPS[i]) <= fit * budget) return MOTION_STEPS[i]
  return MOTION_STEPS[0]
}

/** The grid for a gesture that starts now, from the cost of a full-canvas frame measured in the last one (ms at scale 1), or `fallback` with none. */
export function startScale(costAt1: number, budget: number, fallback: number): number {
  return costAt1 > 0 ? fitScale(costAt1, 1, budget) : fallback
}

/**
 * The step to take mid-gesture, or null. `ms` is the smoothed GPU time of frames on the held grid `cur`, `samples` how many finished frames it rests on.
 * Down is fast (two frames over budget); up is slow (fourteen frames, and the finer grid must be predicted well inside the budget).
 */
export function ladderStep(ms: number, cur: number, samples: number, budget: number, maxScale = DEFAULT_MAX_MOTION_SCALE): number | null {
  const i = MOTION_STEPS.indexOf(cur)
  if (i < 0 || ms <= 0) return null
  if (ms > OVER * budget && i > 0 && samples >= SAMPLES_DOWN) return fitScale(ms, cur, budget, FIT, maxScale)
  if (i < MOTION_STEPS.length - 1 && MOTION_STEPS[i + 1] <= maxScale && samples >= SAMPLES_UP && predictMs(ms, cur, MOTION_STEPS[i + 1]) <= UNDER * budget) return MOTION_STEPS[i + 1]
  return null
}

/** Without a GPU timer (fence polling or none) the only evidence is the rAF interval, which is CPU time floored at one vsync: it cannot say a grid is too fine by a little or that a finer one would fit. */
export const EMERGENCY_MS = 90
/** The grid a gesture starts on when nothing has been measured by a GPU timer. */
export const DEFAULT_MOTION_SCALE = 0.5
/** The rAF-only ladder: one step down when frames take over EMERGENCY_MS, never up, so it cannot ratchet on a healthy frame. */
export function emergencyStep(rafMs: number, cur: number, frames: number): number | null {
  const i = MOTION_STEPS.indexOf(cur)
  if (i > 0 && rafMs > EMERGENCY_MS && frames >= SAMPLES_DOWN) return MOTION_STEPS[i - 1]
  return null
}

/**
 * Wall-clock backstop for the ladder (term-fix B). The GPU timer lags (about 1.7 s on the owner's M5) or reads 0 on heavy frames, so the
 * timed ladder never sees a 400 ms frame. The interval between two DRAWN gesture frames is the truth the viewer feels: when it is over
 * `WALL_OVER * budget` for `WALL_FRAMES` in a row, drop one grid step at once and switch the motion march to its lite form for the
 * rest of the gesture. Gaps over `WALL_IGNORE_MS` are a pause in the gesture, not a slow frame.
 */
export const WALL_OVER = 2
export const WALL_FRAMES = 2
export const WALL_IGNORE_MS = 1500
/** Healthy frames in a row before the grid climbs one step, and before the lite latch clears (a climb restarts the lite count, so the two never land in the same window). */
export const WALL_CLIMB_FRAMES = 30
export const WALL_LITE_FRAMES = 60
/** Hysteresis against a 60 Hz motion target, whatever the display: over WALL_SLOW_MS (under 50 fps) is slow, under WALL_HEALTHY_MS is headroom, between them changes nothing. A slower pacing tier widens both (budget * 1.2 and 0.7 of that). */
export const WALL_SLOW_MS = 20
export const WALL_HEALTHY_MS = 14
/** The predicted gap a climb or a lite clear may land on (a 60 Hz target, 16.7 ms, with a little margin); scaled with the pacing tier like the other lines. Above it the ladder holds. */
export const WALL_PREDICT_MS = 16
/** A climb or lite clear that was followed by a wall-clock step down is not retried for this long (summed drawn-frame time, so a pause does not count). */
export const WALL_BAN_MS = 4000
/** Cost of the full march relative to the lite one, assumed when clearing lite (conservative: lite was never measured against full on this display). */
export const WALL_LITE_RATIO = 2
export class WallLadder {
  private over = 0
  private healthy = 0
  private healthyLite = 0
  /** Smoothed healthy gap on the current grid and lite state; NaN until a frame has been seen since the last change. */
  private ema = NaN
  private climbBanMs = 0
  private liteBanMs = 0
  /** The grid the last climb went to, and whether lite was cleared recently: a step down while either is fresh is a failed attempt. */
  private climbedTo = 0
  private clearFresh = 0
  /** Latched once the wall clock has called a frame slow; cleared after WALL_LITE_FRAMES healthy frames in a row. */
  lite = false
  /** The grid the wall clock last stepped to: a ceiling for the next gesture's start. Back to 1 once the grid has climbed to 0.7. */
  cap = 1
  /** True for the observation that stepped or latched, so the caller can stamp its memory then and not on healthy frames. */
  fired = false
  reset(): void { this.over = 0; this.healthy = 0; this.healthyLite = 0; this.ema = NaN; this.climbBanMs = 0; this.liteBanMs = 0; this.climbedTo = 0; this.clearFresh = 0; this.lite = false; this.cap = 1; this.fired = false }
  /** One drawn gesture frame's interval; returns the grid to step to (or null). `lite` and `cap` may change as a side effect. */
  observe(gapMs: number, budgetMs: number, cur: number): number | null {
    this.fired = false
    const gap = Math.min(gapMs, WALL_IGNORE_MS)
    this.climbBanMs = Math.max(0, this.climbBanMs - gap); this.liteBanMs = Math.max(0, this.liteBanMs - gap)
    const slow = Math.max(WALL_SLOW_MS, 1.2 * budgetMs)
    const good = slow * (WALL_HEALTHY_MS / WALL_SLOW_MS)
    const fit = slow * (WALL_PREDICT_MS / WALL_SLOW_MS)
    if (gapMs < good) {
      this.over = 0
      this.healthy++; this.healthyLite++
      if (this.clearFresh > 0) this.clearFresh--
      this.ema = Number.isNaN(this.ema) ? gapMs : this.ema + 0.1 * (gapMs - this.ema)
      if (this.healthy >= WALL_CLIMB_FRAMES) {
        const i = MOTION_STEPS.indexOf(cur)
        if (i >= 0 && i < 3) {
          const next = MOTION_STEPS[i + 1]
          // Cost goes with pixels: only climb when the predicted gap on the finer grid still fits the 60 Hz target, and not onto a grid that just failed.
          if (this.climbBanMs <= 0 && this.ema * (next / cur) ** 2 < fit) {
            this.healthy = 0; this.healthyLite = 0; this.ema = NaN; this.climbedTo = next; this.cap = next
            return next
          }
          this.healthy = WALL_CLIMB_FRAMES // hold, and look again next frame
          return null
        }
        this.healthy = 0
        this.cap = 1
      }
      if (this.healthyLite >= WALL_LITE_FRAMES && this.lite && this.liteBanMs <= 0 && this.ema * WALL_LITE_RATIO < fit) {
        this.lite = false; this.clearFresh = 2 * WALL_LITE_FRAMES; this.ema = NaN
      }
      return null
    }
    if (gapMs <= slow) return null
    this.healthy = 0; this.healthyLite = 0
    if (gapMs > WALL_IGNORE_MS) { this.over = 0; return null }
    if (++this.over < WALL_FRAMES) return null
    this.over = 0
    if (this.clearFresh > 0) { this.liteBanMs = WALL_BAN_MS; this.clearFresh = 0 }
    if (this.climbedTo === cur) { this.climbBanMs = WALL_BAN_MS; this.climbedTo = 0 }
    this.ema = NaN
    this.lite = true
    this.fired = true
    const i = MOTION_STEPS.indexOf(cur)
    if (i > 0) { this.cap = MOTION_STEPS[i - 1]; return this.cap }
    return null
  }
}

/** The falling edge of `moving` hands the gesture back (refine, shader, throttles, exposure reuse) whoever moved the camera; markMoved is not the only door. */
export function needsHandBack(moving: boolean, gestureOn: boolean, needsRefine: boolean): boolean {
  return needsRefine || (!moving && gestureOn)
}

/**
 * The fence source (no timer query: every phone Chrome, every iPhone) with at most one frame in flight (post/framePacer.ts).
 *
 * A fence cannot read GPU time, but with one frame in flight `done - submitted` is GPU time plus at most one vsync, a usable frame period. The
 * period is not proportional to pixels (the vsync wait and the fixed passes are an intercept), so `ms = a + b * s^2` is fitted from the two most
 * recent grids, and carried across gestures: a gesture starts where the last one settled instead of at a constant and a hand-back's full frames
 * never count as evidence about the next gesture. The grid goes down after two frames over budget and never up mid-gesture; a gesture that ran
 * calm (eight frames well under budget, no step down) lets the NEXT one start one step finer when the model says it fits.
 */
/** 30 fps: a fence period cannot read under one vsync, so the 60 fps budget would call every healthy frame over. */
export const FENCE_BUDGET_MS = 1000 / 30
/** Intercept assumed before a second grid has been seen (about one vsync's wait). */
export const FENCE_A0 = 12
/** Frames well under budget before a gesture counts as calm, and what "well under" means. */
export const FENCE_CALM_FRAMES = 8
export const FENCE_CALM = 0.6

/** The first frames on a new grid carry the gesture's own hitches (tile uploads, a first draw): they are not evidence. */
export const FENCE_WARMUP = 2
/** Consecutive over-budget frames before a step down (three: a hitch is one or two). */
export const FENCE_DOWN = 3
/** A frame over the calm line takes this many frames off the calm count (it does not reset it). */
export const FENCE_UNDER_PENALTY = 4
/** After a step up is stepped back down (the prediction was wrong), that grid is not tried again for this many observed frames. */
export const FENCE_BAN_FRAMES = 300
const FENCE_KEEP = 7

interface Obs { v: number[]; seq: number }
const median = (v: number[]): number => { const s = v.slice().sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)] }

export class FenceGrid {
  private readonly obs = new Map<number, Obs>()
  private seq = 0
  private a = FENCE_A0
  private stable = 0
  private over = 0
  private under = 0
  private warm = 0
  private stepped = false
  /** The grid reached by a step up that has not yet proved itself, and the grid banned after a failed one. */
  private probing = 0
  private banned = 0
  private banLeft = 0
  /** The last periods seen, for __moon.perf. */
  private readonly trace: Array<[number, number]> = []

  /** Folds one measured frame period (ms) drawn on grid `s` into the model. */
  observe(s: number, ms: number, budget = FENCE_BUDGET_MS): void {
    if (!(ms > 0) || !MOTION_STEPS.includes(s)) return
    this.trace.push([s, Math.round(ms)]); if (this.trace.length > 40) this.trace.shift()
    if (this.warm < FENCE_WARMUP) { this.warm++; return }
    const o = this.obs.get(s) ?? { v: [], seq: 0 }
    o.v.push(Math.min(ms, 2 * budget)); if (o.v.length > FENCE_KEEP) o.v.shift()
    o.seq = ++this.seq
    this.obs.set(s, o)
    this.over = ms > OVER * budget ? this.over + 1 : 0
    // A tile upload in an otherwise calm gesture costs a few frames of the count, it does not restart it.
    this.under = ms < FENCE_CALM * budget ? this.under + 1 : Math.max(0, this.under - FENCE_UNDER_PENALTY)
    if (this.banLeft > 0 && --this.banLeft === 0) this.banned = 0
  }

  private ms(s: number): number { return median(this.obs.get(s)!.v) }

  /** The fitted (a, b) of `ms = a + b * s^2`, or null with nothing observed. */
  model(): { a: number; b: number } | null {
    const pts = [...this.obs.entries()].sort((x, y) => y[1].seq - x[1].seq).slice(0, 2)
    if (!pts.length) return null
    const big = pts.reduce((m, p) => (p[0] > m[0] ? p : m))
    const small = pts.length === 2 ? pts.find((p) => p !== big)! : null
    const cap = 0.8 * Math.min(...pts.map((p) => this.ms(p[0])))
    let a = this.a
    if (small && big[0] > small[0]) {
      const b = (this.ms(big[0]) - this.ms(small[0])) / (big[0] * big[0] - small[0] * small[0])
      if (b > 0) a = this.ms(small[0]) - b * small[0] * small[0]
    }
    a = Math.max(0, Math.min(a, cap))
    this.a = a
    return { a, b: Math.max(1e-6, (this.ms(big[0]) - a) / (big[0] * big[0])) }
  }

  /** For __moon.perf: the fitted model, the carried start grid and the per-grid mean periods. */
  snapshot(): { model: { a: number; b: number } | null; stable: number; obs: Record<string, number>; trace: Array<[number, number]> } {
    const obs: Record<string, number> = {}
    for (const [s] of this.obs) obs[String(s)] = +this.ms(s).toFixed(1)
    return { model: this.model(), stable: this.stable, obs, trace: this.trace.slice() }
  }

  /** Predicted period (ms) of a frame on grid `s`, or 0 with no model. */
  predict(s: number): number {
    const m = this.model()
    return m ? m.a + m.b * s * s : 0
  }

  /** The grid a gesture starts on: where the last one settled, one step finer after a calm gesture that the model says fits; `classStart` before any. */
  start(classStart: number, budget = FENCE_BUDGET_MS): number {
    let s = this.stable || classStart
    this.probing = 0
    if (this.stepped === false && this.under >= FENCE_CALM_FRAMES) {
      // A calm gesture (no step down, most frames well under budget): up to two steps finer, each only when the model predicts it inside UNDER of the budget.
      for (let k = 0; k < 2; k++) {
        const i = MOTION_STEPS.indexOf(s)
        const n = i >= 0 && i < MOTION_STEPS.length - 1 ? MOTION_STEPS[i + 1] : 0
        if (!n || n > DEFAULT_MAX_MOTION_SCALE || n === this.banned || this.predict(n) > UNDER * budget) break
        s = n; this.probing = n
      }
    }
    this.stable = s
    this.over = 0; this.under = 0; this.warm = 0; this.stepped = false
    return s
  }

  /**
   * The step DOWN to take mid-gesture, or null. A grid never goes up while the picture is moving (the limb would go soft, sharp, soft, and a third
   * target size reallocates every target on a phone); up happens at the next gesture's start (`start`), after the release hold.
   */
  step(cur: number, budget = FENCE_BUDGET_MS): number | null {
    const i = MOTION_STEPS.indexOf(cur)
    this.stable = cur
    if (i <= 0 || this.over < FENCE_DOWN) return null
    let j = i - 1
    while (j > 0 && this.predict(MOTION_STEPS[j]) > FIT * budget) j--
    // A grid that was stepped up to at the start and cost too much is not tried again for a while: no oscillation.
    // Only when the model, fitted on the probe's own frames, says the grid is over budget: three slow frames from a tile upload are not a verdict on the grid.
    if (this.probing && this.probing === cur && this.predict(cur) > OVER * budget) { this.banned = cur; this.banLeft = FENCE_BAN_FRAMES }
    this.probing = 0
    this.over = 0; this.under = 0; this.warm = 0; this.stepped = true
    this.stable = MOTION_STEPS[j]
    return MOTION_STEPS[j]
  }
}

/** While a gesture moves the camera the exposure search (and its look-ahead searches) runs at most this often; the exposure's own rate limit (3 stops/s) hides the lag. */
export const EXPOSURE_MOVING_MS = 66

/** Exposure search reuse window for scripted camera moves, sized to keep search work below roughly a fifth of wall time. */
export function exposureWindowMs(lastBlockMs: number, scripted: boolean): number {
  if (!scripted) return EXPOSURE_MOVING_MS
  return Math.min(400, Math.max(EXPOSURE_MOVING_MS, 5 * lastBlockMs))
}

/**
 * Whether this frame reuses the last exposure search instead of running one. Only inside a gesture, with a search to reuse, no exposure cut, no
 * eclipse or ridge journey (they own their exposure), and not after the clock went back; then for `windowMs` (66 ms by default), or without limit under `?abl=expfreeze`.
 * Never at rest: a rest frame always searches (the rest value must not depend on gesture timing).
 */
export function exposureReusable(o: { gestureOn: boolean; hasSearch: boolean; cutFrames: number; ownsExposure: boolean; now: number; searchAt: number; freeze?: boolean; noReuse?: boolean; windowMs?: number }): boolean {
  return o.gestureOn && o.hasSearch && o.cutFrames === 0 && !o.ownsExposure && o.now >= o.searchAt
    && (!!o.freeze || (!o.noReuse && o.now - o.searchAt < (o.windowMs ?? EXPOSURE_MOVING_MS)))
}

/** The grid the first refine step draws on (a quarter of the full frame's cost, crossfaded in), before the full-size frame. */
export const REFINE_MID_SCALE = 0.7

/**
 * The hand-back frame: from a gesture on `motionScale` the refine is two steps (a mid grid, then full size) when the motion grid is coarser than the
 * mid step, one step otherwise. `refineStep` is 0 at the start, 1 after the mid frame has been drawn. `needsRefine` says whether another frame follows.
 */
export function refinePlan(refineStep: number, motionScale: number, forced: boolean, noRefine: boolean, skipMid = false): { scale: number; refineStep: number; needsRefine: boolean } {
  const mid = refineStep === 0 && !forced && motionScale < REFINE_MID_SCALE && !noRefine && !skipMid
  return { scale: mid ? REFINE_MID_SCALE : 1, refineStep: mid ? 1 : 0, needsRefine: mid }
}

/** Rest catch-up bounds: build-only frames after a camera stop, before the full-size frame (proposed; the rig tunes them). */
export const REST_CATCHUP_MAX_FRAMES = 20
export const REST_CATCHUP_MAX_MS = 300
/** A full frame predicted over this many ms would freeze the picture: only then is the last motion picture held for a cache catch-up (`?restbudget=` overrides). */
export const REST_BUDGET_MS = 50
/**
 * What a full-size rest frame costs on this machine (ms, wall-priced estimates): `c0` after a complete-cache frame (NaN until one is seen), and the last frame drawn
 * with `holey.unmet` visible layers uncached. Model: ms = c0 + k * unmet, with k from the holey sample (c0 taken as 0 while unknown, which under-predicts: an estimate).
 */
export interface RestCostModel { c0: number; holey: { ms: number; unmet: number } | null }
export const EMPTY_REST_COST: RestCostModel = { c0: NaN, holey: null }
/** Folds one full-size frame's cost (`ms`, drawn with `unmet` layers uncached) into the model. A non-finite or non-positive cost is ignored. */
export function foldRestCost(m: RestCostModel, unmet: number, ms: number): RestCostModel {
  if (!(ms > 0) || !(unmet >= 0)) return m
  return unmet === 0 ? { ...m, c0: ms } : { ...m, holey: { ms, unmet } }
}
/** Predicted cost of the full frame with `unmet` layers uncached: NaN while no holey frame has been seen (unknown: the caller draws, as today). */
export function predictRestMs(m: RestCostModel, unmet: number): number {
  if (!m.holey || !(m.holey.unmet > 0) || !(unmet >= 0)) return NaN
  const c0 = Number.isFinite(m.c0) ? m.c0 : 0
  const k = Math.max(0, (m.holey.ms - c0) / m.holey.unmet)
  return c0 + k * unmet
}
/** A rest frame's price from its two clocks: the GPU query (-1 when absent) under-reads on Metal (5-7x), so the wall gap to the next frame, when the page is visible, is the floor. */
export function restFrameMs(queryMs: number, rafGapMs: number, hidden: boolean): number {
  const wall = hidden ? 0 : Math.min(1000, Math.max(0, rafGapMs))
  return Math.max(queryMs > 0 ? queryMs : 0, wall)
}
/**
 * The hand-back's full step with the shadow cache short of visible layers: 'build' (a frame that draws nothing and builds layers), 'draw' (the full-size frame now)
 * or 'abandon' (the camera moved: drop the catch-up). `s` is the catch-up in progress (frames spent, start time). Dynamic: the hold happens only when the full frame
 * would freeze, i.e. unmet > 0 and the predicted cost `predictedMs` is over `budgetMs` (an unknown prediction, NaN, DRAWS: the first release on a page is exactly today's, and that frame is the learning sample). A hold is bounded by frames and time.
 */
export function restCatchUpPlan(s: { frames: number; since: number }, now: number, unmet: number, moving: boolean, on: boolean, predictedMs = NaN, budgetMs = REST_BUDGET_MS, floorMs = NaN): 'draw' | 'build' | 'abandon' {
  if (moving) return 'abandon'
  if (!on || !(unmet > 0)) return 'draw'
  if (!(predictedMs > budgetMs)) return 'draw'
  // Holes must be what pushes the frame over: a frame that cannot fit even with a complete cache (c0 over budget) gains nothing from a hold (the stepped settle is the answer there).
  if (floorMs > budgetMs) return 'draw'
  if (s.frames < REST_CATCHUP_MAX_FRAMES && now - s.since < REST_CATCHUP_MAX_MS) return 'build'
  return 'draw'
}

/** Bridge short wheel/inertia gaps so stopping and restarting cannot flash the fine grid. */
export const MOTION_IDLE_MS = 100
/** A stationary press is not a motion frame; an established drag retains its grid until release. */
export function motionActive(moved: boolean, dragging: boolean, gestureOn: boolean, sinceMove: number): boolean {
  return moved || (dragging && gestureOn) || sinceMove < MOTION_IDLE_MS
}

export interface FrameCost { ms: number; scale: number; at: number }
/** Do not carry a quality decision indefinitely after the last measured scene. */
export function recentCost(sample: FrameCost | null, now: number): sample is FrameCost {
  return !!sample && sample.ms > 0 && now >= sample.at && now - sample.at < 10000
}
/** Keep the measurement at its original grid: inverting the affine cost model as s² loses its fixed work. */
export function measuredStart(sample: FrameCost | null, now: number, budget: number, fallback: number, maxScale = DEFAULT_MAX_MOTION_SCALE): number {
  return recentCost(sample, now) ? fitScale(sample.ms, sample.scale, budget, FIT, maxScale) : Math.min(fallback, maxScale)
}
/** Full-quality rendering can have a different shader cost, so require a measured full frame. */
export function fullMotionSafe(sample: FrameCost | null, now: number, budget: number): boolean {
  return recentCost(sample, now) && sample.scale === 1 && sample.ms <= UNDER * budget
}

/** Bands a frame predicted at `predictedMs` is drawn in so that no band is predicted over `budgetMs`: 1 with no prediction or one that fits; at most `max`. */
export function bandCount(predictedMs: number, budgetMs: number, max = 8): number {
  if (!(predictedMs > budgetMs) || !(budgetMs > 0)) return 1
  return Math.max(1, Math.min(max, Math.ceil(predictedMs / budgetMs)))
}

/** Cost memory for the full-size frame: a dear reading is taken at once, a cheaper one only pulls the figure down slowly (a pose may be cheap, a dear frame is a fact). */
export function foldFullCost(prev: number, measured: number): number {
  return prev === 0 || measured >= prev ? measured : prev * 0.7 + measured * 0.3
}
/** Bands for a frame at `scale`: the dearer of the measured full-frame cost and this gesture's motion model, both scaled to the grid. */
export function predictBandMs(fullCostMs: number, scale: number, modelMs: number, shaderFactor: number): number {
  return Math.max(fullCostMs * scale * scale, modelMs * shaderFactor)
}

/** The 150 ms release hold: only when banding is worth it (the full frame needs more than one band), counted from a moving release or any move. */
export function releaseHoldActive(worth: boolean, sinceReleaseMs: number, sinceMoveMs: number, holdMs: number): boolean {
  return worth && (sinceReleaseMs < holdMs || sinceMoveMs < holdMs)
}

// ---------------------------------------------------------------------------
// Rest to motion (WP-A, 2026-10-23, owner complaint 1): the press a few seconds after a release queued behind 2-3 full-size rest frames on the
// GPU (250-350 ms frozen, the OS cursor jittered) and the gesture then started too fine and had forgotten what the last one learned. Every piece
// below is a pure function behind a URL switch, default off, until the rig numbers are in.
// ---------------------------------------------------------------------------

/** The dearer reading of the full-size rest frame's cost, ms: `fullCostMs` (fence-priced, learned only while rest frames are fenced) or the hand-back's wall-priced model (learned on every desktop release). 0 with neither. */
export function restCostFloor(fullCostMs: number, m: RestCostModel): number {
  return Math.max(fullCostMs > 0 ? fullCostMs : 0, Number.isFinite(m.c0) ? m.c0 : 0, m.holey?.ms ?? 0)
}

/** `?settle=stepped`: the full-size frame of the hand-back is one submit when it is predicted inside two vsyncs; a dearer one goes in bands (`bandCount`), none of them over the band budget. */
export function settleFullAffordable(fullMs: number, vsyncMs: number): boolean {
  return fullMs > 0 && fullMs <= 2 * vsyncMs
}

/**
 * `?settle=stepped`: whether the hand-back holds the full-size frame back this frame. A dear full frame (one that would go in bands) is not started inside `quietMs` of
 * the last camera move or input: a restart in that window is the owner's case, and the mid-grid picture stands meanwhile. A cheap frame, `quietMs` 0 and the phone's
 * banded hand-back (not stepped) never wait. The wait is bounded by `quietMs` itself: the frame is drawn the moment the spell is over.
 */
export function settleWaits(stepped: boolean, dear: boolean, quietMs: number, sinceQuietMs: number): boolean {
  return stepped && dear && quietMs > 0 && sinceQuietMs < quietMs
}

/**
 * `?settle=stepped`, review item 2: a dear full frame whose band gate is shut (a declared exposure cut, a moving exposure, a scripted hand-over inside
 * BAND_HANDOVER_MS) must not fall through to one unbanded submit. It is deferred, bounded by SETTLE_DEFER_MAX_MS from the first deferral, then drawn whatever the
 * gate says. Structural exclusions (ground mode, a flight, a ridge) are not deferred: there bands never apply and the full frame goes as today (documented, L6).
 */
export const SETTLE_DEFER_MAX_MS = 1000
export function settleDefers(stepped: boolean, dear: boolean, gateShut: boolean, deferredMs: number, maxMs = SETTLE_DEFER_MAX_MS): boolean {
  return stepped && dear && gateShut && deferredMs < maxMs
}
/**
 * The hand-back's scheduling decision for one frame (main.ts frameLoopBody, the `needsHandBack` branch): the refine plan (mid frame, then full), then the
 * `?settle=stepped` hold of a dear full frame inside the quiet spell. `held` means "do not draw now": the caller keeps the last scale, leaves `needsRefine` set
 * and `refineStep` at 1 (mid done, full pending), so the next rAF does not plan the mid frame again. A cache catch-up in progress goes straight to its full step
 * and is never held (its build-only frames are the better use of the spell).
 */
export interface HandBackInput {
  refineStep: number; motionScale: number; forced: boolean; noRefine: boolean; catchUp: boolean
  /** The full frame is affordable as one submit (skips the mid frame). */
  skipMid: boolean
  stepped: boolean; quietMs: number; sinceMoveMs: number
  /** The full frame would go in bands (bandsWorth()). */
  dearFull: boolean
  capture: boolean
}
export function handBackPlan(i: HandBackInput): { scale: number; refineStep: number; needsRefine: boolean; held: boolean } {
  const plan = i.catchUp ? { scale: 1, refineStep: 0, needsRefine: false } : refinePlan(i.refineStep, i.motionScale, i.forced, i.noRefine, i.skipMid)
  if (!i.catchUp && settleWaits(i.stepped, plan.scale === 1 && i.dearFull, i.quietMs, i.sinceMoveMs) && !i.capture && !i.forced) return { scale: plan.scale, refineStep: 1, needsRefine: true, held: true }
  return { ...plan, held: false }
}
/** The band cap under `?settle=stepped`: a 613 ms frame on a 50 ms budget is 13 bands, which the phone's cap of 8 cannot hold (review item 3). */
export const BAND_MAX_STEPPED = 32

/** `?settlequiet=<ms>`: the quiet spell a dear full frame waits for under `?settle=stepped` (default SETTLE_QUIET_MS; 0 draws it at once, in bands). */
export const SETTLE_QUIET_MS = 300
export function settleQuietFromSearch(search: string, dflt = SETTLE_QUIET_MS): number {
  const raw = new URLSearchParams(search).get('settlequiet')
  if (raw === null || raw.trim() === '') return dflt
  const v = Number(raw)
  return Number.isFinite(v) && v >= 0 ? v : dflt
}

/** `?pressyield=1`: for `yieldMs` after a pointerdown the tile uploads and the shadow-cache builds stand down, so the gesture's first frames are the gesture's alone. */
export const PRESS_YIELD_MS = 300
export function pressYieldActive(on: boolean, now: number, pressAt: number, yieldMs = PRESS_YIELD_MS): boolean {
  return on && now >= pressAt && now - pressAt < yieldMs
}

/**
 * `?wallmem=<ms>`: the wall ladder's `lite` latch and `cap` are kept across rests for this long (default WALL_MEMORY_DEFAULT_MS, 4 s, which forgot them after every
 * rest the owner complained about), or until the canvas size changes (a different pixel count is a different cost). Without the switch the size is not looked at.
 */
export const WALL_MEMORY_DEFAULT_MS = 4000
export function wallMemoryFromSearch(search: string, defaultOn = false): { on: boolean; ms: number } {
  const raw = new URLSearchParams(search).get('wallmem')
  if (raw === null) return defaultOn ? { on: true, ms: 60000 } : { on: false, ms: WALL_MEMORY_DEFAULT_MS }
  const v = Number(raw)
  if (raw === '0') return { on: false, ms: WALL_MEMORY_DEFAULT_MS }
  return { on: true, ms: Number.isFinite(v) && v > 0 ? v : 60000 }
}
export function wallMemoryHolds(now: number, stampedAt: number, memoryMs: number, sizeNow: string, sizeStamped: string, bySize: boolean): boolean {
  if (!(now - stampedAt <= memoryMs)) return false
  return !bySize || sizeNow === sizeStamped
}

/**
 * The last grid a gesture settled on, per context (orbit or ground, canvas size), for `?wallmem=`: a gesture in the same context starts no finer than the last one
 * ended (the wall ladder climbs from there if the frames are healthy). Entries expire with the wall memory. A gesture that was forced or that never drew is not remembered.
 */
export class MotionMemory {
  private readonly m = new Map<string, { scale: number; at: number }>()
  static key(ground: boolean, cw: number, ch: number): string { return `${ground ? 'ground' : 'orbit'}:${cw}x${ch}` }
  remember(key: string, scale: number, now: number): void {
    if (!MOTION_STEPS.includes(scale)) return
    this.m.set(key, { scale, at: now })
    if (this.m.size > 16) this.m.delete(this.m.keys().next().value!)
  }
  /** The remembered grid, or null when none or expired. */
  recall(key: string, now: number, ttlMs: number): number | null {
    const e = this.m.get(key)
    if (!e || now - e.at > ttlMs) return null
    return e.scale
  }
  /** For __moon.perf. */
  snapshot(): Record<string, number> { const o: Record<string, number> = {}; for (const [k, v] of this.m) o[k] = v.scale; return o }
}

/**
 * `?motionstart=cost`: the grid a gesture starts on, from measured cost. The last gesture's live-march motion cost (GPU query at its grid, `motion`, no older than
 * `maxAgeMs`) is the evidence that fits best; failing that the full-size rest frame's cost scaled by `restFactor` (the rest frame is served by the shadow cache, the
 * motion frame marches live with the cheap motion shader: the ratio is an ESTIMATE, `?motionfactor=`, 1 by default); failing both, `fallback`. Cached-rest and
 * live-motion costs are never mixed into one number. The result never exceeds `maxScale`.
 */
export function startFromCost(motion: FrameCost | null, restAt1: number, restFactor: number, now: number, budget: number, fallback: number, maxScale = DEFAULT_MAX_MOTION_SCALE, maxAgeMs = 60000): number {
  if (motion && motion.ms > 0 && now >= motion.at && now - motion.at <= maxAgeMs) return fitScale(motion.ms, motion.scale, budget, FIT, maxScale)
  if (restAt1 > 0 && restFactor > 0) return fitScale(restAt1 * restFactor, 1, budget, FIT, maxScale)
  return Math.min(fallback, maxScale)
}
/** The motion-cost memory of `?motionstart=cost`, ms. */
export const MOTION_COST_MEMORY_MS = 60000
/**
 * The whole start decision of `?motionstart=cost` (review item 6): the motion cost's age is validated ONCE and the same accepted measurement feeds both the pacing
 * tier and the start grid; the cached rest fallback never touches the pacing tier (a 613 ms rest frame would otherwise put a 120 Hz display on the 30 Hz cadence
 * for a gesture whose frames cost 5 ms), it fits the base budget. `used` says which evidence decided.
 */
export function startFromCostPlan(motion: FrameCost | null, restAt1: number, restFactor: number, now: number, pacing: { get(displayHz: number, ms: number, from: number): number }, displayHz: number, baseBudget: number, fallback: number, maxScale = DEFAULT_MAX_MOTION_SCALE, maxAgeMs = MOTION_COST_MEMORY_MS): { scale: number; budget: number; used: 'motion' | 'rest' | 'none' } {
  const accepted = motion && motion.ms > 0 && now >= motion.at && now - motion.at <= maxAgeMs ? motion : null
  if (accepted) {
    const budget = pacing.get(displayHz, accepted.ms, accepted.scale)
    return { scale: fitScale(accepted.ms, accepted.scale, budget, FIT, maxScale), budget, used: 'motion' }
  }
  if (restAt1 > 0 && restFactor > 0) return { scale: fitScale(restAt1 * restFactor, 1, baseBudget, FIT, maxScale), budget: baseBudget, used: 'rest' }
  return { scale: Math.min(fallback, maxScale), budget: baseBudget, used: 'none' }
}
