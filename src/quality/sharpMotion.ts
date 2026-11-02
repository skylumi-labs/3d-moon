/**
 * Constant-resolution motion policy (`?motion=sharp`, default OFF; the coordinator flips MOTION_POLICY_DEFAULT after the rig and phone A/B).
 *
 * Owner rule: never blur while the Moon moves. Today the picture goes soft in a gesture or flight because the frame renders at `grid x motionDpr / restDpr`
 * of the canvas (grid 0.25 to 0.7, a motion DPR under the rest DPR). Under this policy the motion render target has the REST dimensions at every moment:
 * the grid is 1, motionDpr equals restDpr, and the ladders that lower the grid (the timed ladder, the remembered coarse grids, the cost-based start, the
 * emergency and wall steps, the flight controller's steps) have no effect on the frame. When a frame is over budget the cost is cut elsewhere:
 * stage 1 `cutCost` defers background work (tile uploads, shadow-cache builds: the `yield` of the press-yield path) and turns on the gesture-keyed cheaper
 * shader variant (motion caps); stage 2 falls back explicitly to a sharp 30 fps cadence (`SharpPacer.tier === 30`). Resolution is never the lever.
 * Not temporal accumulation: the rejected TAA (#117) is not revived; every motion frame is a plain full-size render.
 *
 * Pure functions, one pacer class and one holder; main.ts reads the holder. The default path (policy 'default') goes through the same `renderDims` and
 * returns exactly what main.ts computed before this module existed (scripts/sharpMotion.test.mts pins it).
 */

/** 'phone': quality/phoneSharp.ts (touch classes): one render fraction f for every moving frame, chosen by PhonePacer; set at start-up, never from the URL here. */
export type MotionPolicy = 'default' | 'sharp' | 'phone'

/** The one line to change once the rig and phone measurements accept the trade. */
export const MOTION_POLICY_DEFAULT: MotionPolicy = 'default'
/** localStorage key for the quality-knob form of the switch (`sharp` or `default`). The URL wins over it. */
export const MOTION_POLICY_KEY = 'moon.motionPolicy'

/** `?motion=sharp` / `?motion=default`; null when absent or anything else. */
export function motionPolicyFromSearch(search: string): MotionPolicy | null {
  const v = new URLSearchParams(search).get('motion')
  return v === 'sharp' || v === 'default' ? v : null
}

/** URL over the stored knob over the build default. `stored` is whatever localStorage returned (already guarded by the caller). */
export function resolveMotionPolicy(search: string, stored: string | null | undefined, dflt: MotionPolicy = MOTION_POLICY_DEFAULT): MotionPolicy {
  return motionPolicyFromSearch(search) ?? (stored === 'sharp' || stored === 'default' ? stored : dflt)
}

let policy: MotionPolicy = 'default'
export function setMotionPolicy(p: MotionPolicy): void { policy = p }
export function motionPolicy(): MotionPolicy { return policy }
export const sharpMotionOn = (): boolean => policy === 'sharp'
export const phoneMotionOn = (): boolean => policy === 'phone'
/** A policy that owns the motion resolution itself (the timed, wall, memory and start ladders are void). */
export const constResMotionOn = (): boolean => policy !== 'default'

/** The DPR a motion frame uses: the rest DPR under the policy, `motionDpr` otherwise. */
export const effectiveMotionDpr = (p: MotionPolicy, motionDpr: number, restDpr: number): number => p === 'sharp' ? restDpr : motionDpr

/** The grid a gesture or flight frame uses: always 1 under the policy; the ladder's choice otherwise. */
export const effectiveGrid = (p: MotionPolicy, grid: number): number => p === 'sharp' ? 1 : grid

export interface RenderDimsInput {
  /** Canvas size in device pixels (the rest dimensions). */
  cw: number
  ch: number
  /** The frame's grid (1 at rest). */
  scale: number
  gestureOn: boolean
  motionDpr: number
  /** The rest DPR (cw = clientWidth x restDpr). */
  restDpr: number
  /** ?sharp=1 in a scripted flight: the grid is the only scale (no motionDpr / restDpr factor). */
  gridIsOnlyScale: boolean
}
export interface RenderDims { w: number; h: number; scale: number; rscale: number }

/**
 * The size of the frame's render target. Exactly the expression main.ts used before (default policy); under 'sharp' the grid is 1 and motionDpr is restDpr,
 * so w x h equals cw x ch (rounded identically) whatever the ladders asked for.
 */
export function renderDims(p: MotionPolicy, i: RenderDimsInput): RenderDims {
  const scale = effectiveGrid(p, i.scale)
  const motionDpr = effectiveMotionDpr(p, i.motionDpr, i.restDpr)
  // 'phone': `scale` is already f, the fraction of the canvas (no motion/rest ratio factor on top).
  const only = i.gridIsOnlyScale || p === 'phone'
  const rscale = i.gestureOn && scale < 1 ? scale * (only ? 1 : motionDpr / i.restDpr) : scale
  return { w: Math.max(64, Math.round(i.cw * rscale)), h: Math.max(64, Math.round(i.ch * rscale)), scale, rscale }
}

/** A gesture or flight frame drawn smaller than the canvas. The count that must stay 0 under the policy. */
export const isDownscaled = (d: RenderDims, cw: number, ch: number): boolean => d.w < Math.max(64, cw) || d.h < Math.max(64, ch)

// --- Pacing: 60 fps target, cut cost first, 30 fps as the explicit fallback ---

/**
 * Gaps are judged against the measured display interval (`displayMs`, 1000 / displayRate.hz; 16.7 when unknown), never below the 60 fps target period:
 * over SLOW_TOL x the period is slow (a 60 Hz display presents at ~16.7 ms, so 20 ms and up is under 50 fps); within HEALTHY_TOL x the period is healthy;
 * between the two is neither (it breaks both streaks). A 30 Hz or 120 Hz panel judges against 60 fps too, since the policy's target is 60.
 */
export const SHARP_TARGET_MS = 1000 / 60
export const SHARP_SLOW_TOL = 1.2
export const SHARP_HEALTHY_TOL = 1.1
export const sharpPeriodMs = (displayMs?: number): number => Math.max(SHARP_TARGET_MS, displayMs && displayMs > 0 && Number.isFinite(displayMs) ? displayMs : 0)
export const sharpIsSlow = (gapMs: number, displayMs?: number): boolean => gapMs > sharpPeriodMs(displayMs) * SHARP_SLOW_TOL
export const sharpIsHealthy = (gapMs: number, displayMs?: number): boolean => gapMs <= sharpPeriodMs(displayMs) * SHARP_HEALTHY_TOL
/** Gaps over this are a pause in the gesture, not a slow frame. */
export const SHARP_IGNORE_MS = 1500
/** Consecutive slow frames that start stage 1 (cut cost), and consecutive slow frames in stage 1 that start stage 2 (30 fps). */
export const SHARP_CUT_FRAMES = 3
export const SHARP_TIER30_FRAMES = 12
/** Healthy frames in a row that end stage 1. */
export const SHARP_RELAX_FRAMES = 60
/** Frames drawn at the 30 fps tier before 60 is tried again (stage 1 stays on for the probe; two slow frames send it back). */
export const SHARP_PROBE_FRAMES = 180
export const SHARP_PROBE_SLOW = 2

export type SharpTier = 60 | 30

export class SharpPacer {
  tier: SharpTier = 60
  /** Stage 1: defer background work, cheaper shader variant. */
  cutCost = false
  private slow = 0
  private slowInCut = 0
  private healthy = 0
  private atTier30 = 0
  private probing = false
  private probeSlow = 0
  /** Times the pacer entered each stage since the page loaded (perf). */
  cutEntries = 0
  tier30Entries = 0
  probes = 0

  /** A gesture or flight begins: start from 60 fps with nothing cut (a new gesture earns its tier afresh). */
  reset(): void {
    this.tier = 60; this.cutCost = false
    this.slow = 0; this.slowInCut = 0; this.healthy = 0; this.atTier30 = 0; this.probing = false; this.probeSlow = 0
  }

  /** `gapMs`: the wall time between two drawn motion frames. Ignored when 0 or a pause. `displayMs`: the measured display interval. */
  observe(gapMs: number, displayMs?: number): void {
    if (!(gapMs > 0) || gapMs > SHARP_IGNORE_MS) return
    if (this.tier === 30) {
      this.atTier30++
      if (this.atTier30 >= SHARP_PROBE_FRAMES) { this.tier = 60; this.probing = true; this.probeSlow = 0; this.healthy = 0; this.probes++; this.atTier30 = 0; this.slow = 0; this.slowInCut = 0 }
      return
    }
    const isSlow = sharpIsSlow(gapMs, displayMs)
    const isHealthy = sharpIsHealthy(gapMs, displayMs)
    if (this.probing) {
      if (isSlow) { this.healthy = 0; if (++this.probeSlow >= SHARP_PROBE_SLOW) { this.tier = 30; this.tier30Entries++; this.probing = false } }
      else if (isHealthy) { if (++this.healthy >= SHARP_RELAX_FRAMES) { this.probing = false; this.cutCost = false; this.healthy = 0; this.slowInCut = 0 } }
      else this.healthy = 0
      return
    }
    if (isSlow) {
      this.healthy = 0
      this.slow++
      if (!this.cutCost) {
        if (this.slow >= SHARP_CUT_FRAMES) { this.cutCost = true; this.cutEntries++; this.slowInCut = 0 }
      } else if (++this.slowInCut >= SHARP_TIER30_FRAMES) {
        this.tier = 30; this.tier30Entries++; this.slow = 0; this.slowInCut = 0; this.atTier30 = 0
      }
    } else {
      // Any frame that is not slow ends both slow streaks (they are consecutive counts).
      this.slow = 0; this.slowInCut = 0
      if (!isHealthy) this.healthy = 0
      else if (this.cutCost && ++this.healthy >= SHARP_RELAX_FRAMES) { this.cutCost = false; this.healthy = 0 }
    }
  }

  get cadenceHz(): number { return this.tier }
}
