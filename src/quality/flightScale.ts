import { MOTION_STEPS } from '../post/motionGrid'

/** A scripted flight can return to sharp rendering when its recent frame budget permits. */
export const FLIGHT_SCALE_WINDOW = 60
export const FLIGHT_SCALE_UP_P95_MS = 20
export const FLIGHT_SCALE_DOWN_P95_MS = 28

/** Cost of a frame that actually reached the screen. Wall time includes pacing/GPU holds; GPU/fence readings catch expensive work hidden by a fast rAF. */
export function flightFrameCostMs(wallMs: number, gpuMs?: number | null, fenceMs?: number | null): number {
  const costs = [wallMs, gpuMs, fenceMs].filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)
  return costs.length ? Math.max(...costs) : 0
}

function percentile95(values: readonly number[]): number {
  if (!values.length) return Infinity
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]
}

/**
 * Motion-grid ladder for scripted flights. The gesture ladder deliberately holds a coarse grid
 * while a finger is down; a flight has no finger and can safely climb or descend one rung from
 * the last 60 frame times. `floor` is the device's lowest allowed quality rung.
 */
export class FlightScaleController {
  private readonly frames: number[] = []
  constructor(private scale: number) {}

  get current(): number { return this.scale }
  get p95(): number { return percentile95(this.frames) }

  update(frameMs: number, floor: number): number {
    if (Number.isFinite(frameMs) && frameMs > 0) {
      this.frames.push(frameMs)
      if (this.frames.length > FLIGHT_SCALE_WINDOW) this.frames.shift()
    }
    const minScale = Math.max(MOTION_STEPS[0], floor)
    const currentIndex = MOTION_STEPS.indexOf(this.scale)
    let stepped = false
    if (currentIndex < 0) this.scale = minScale
    else if (this.frames.length >= FLIGHT_SCALE_WINDOW && this.p95 < FLIGHT_SCALE_UP_P95_MS && currentIndex < MOTION_STEPS.length - 1) {
      this.scale = MOTION_STEPS[currentIndex + 1]
      stepped = true
    } else if (this.frames.length >= 6 && this.p95 > FLIGHT_SCALE_DOWN_P95_MS && this.scale > minScale) {
      this.scale = MOTION_STEPS[Math.max(0, currentIndex - 1)]
      stepped = true
    }
    if (this.scale < minScale) this.scale = minScale
    // Measure each new rung independently; old, cheap samples must not immediately climb through
    // the ladder, and old, expensive samples must not cascade several steps down in one burst.
    if (stepped) this.frames.length = 0
    return this.scale
  }

  reset(scale = this.scale): void { this.frames.length = 0; this.scale = scale }
}

/**
 * `?flightscale=hyst`: the calmer flight ladder. Today's controller reads the rAF interval as frame cost, so every JS spike (a tile recompute) looks like a GPU that is too
 * slow, steps the grid down on ONE frame (the p95 of 6 samples is their max) and climbs back a second later: 25 to 65 visible pops per cinematic flight (WP14), none of which
 * a smaller grid can fix. This one judges on GPU/fence time, steps down only when 3 of the last 8 frames are over budget, waits 1.5 s between changes and stops after 6 steps
 * per flight. The 6-frame emergency step stays for a GPU source that itself reports more than twice the budget (a phone).
 */
export type FlightScaleMode = 'hyst' | 'old'
export function parseFlightScaleMode(v: string | null): FlightScaleMode { return v === 'hyst' ? 'hyst' : 'old' }

export const FLIGHT_HYST_RING = 8
export const FLIGHT_HYST_OVER = 3
export const FLIGHT_HYST_DWELL_MS = 1500
export const FLIGHT_HYST_MAX_STEPS = 6
/** The wall interval counts only when it exceeds the GPU cost by this much for FLIGHT_HYST_WALL_RUN frames in a row: a sustained miss, not a spike. */
export const FLIGHT_HYST_WALL_MARGIN_MS = 8
export const FLIGHT_HYST_WALL_RUN = 3
/** A GPU source reporting this much, FLIGHT_HYST_EMERGENCY_RUN frames in a row, steps down at once (no dwell, no cap). */
export const FLIGHT_HYST_EMERGENCY_MS = 2 * FLIGHT_SCALE_DOWN_P95_MS
export const FLIGHT_HYST_EMERGENCY_RUN = 6

export interface FlightScaleSample {
  /** rAF interval of a frame that reached the screen (0 when none this frame). */
  wallMs: number
  /** Newest GPU timer-query reading, when a new one arrived this frame. */
  gpuMs?: number | null
  /** Fence reading of this frame, when there is one. */
  fenceMs?: number | null
  /** Does this device have a GPU timer at all (query or fence)? Without one the wall interval is all there is. */
  hasGpuSource: boolean
  /** The frame period a cap holds the flight to (?sharp=1: 33 ms); a wall interval at the cap is not a miss. Absent: no cap. */
  capMs?: number
}

const valid = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/** Pure decision of the hysteresis ladder: the next rung from the state and one sample. */
export interface FlightHystState {
  ring: boolean[]
  calm: number[]
  wallRun: number
  emergencyRun: number
  lastGpuMs: number
  steps: number
  lastStepAt: number
}
export function freshFlightHystState(): FlightHystState {
  return { ring: [], calm: [], wallRun: 0, emergencyRun: 0, lastGpuMs: 0, steps: 0, lastStepAt: -Infinity }
}

/** The cost one sample contributes, or null when it carries no usable reading (a GPU device on a frame without a new GPU reading and no GPU history). Mutates the run counters of `s`. */
export function flightHystCost(s: FlightHystState, x: FlightScaleSample): number | null {
  const gpuNow = Math.max(valid(x.gpuMs) ? x.gpuMs : 0, valid(x.fenceMs) ? x.fenceMs : 0)
  if (gpuNow > 0) s.lastGpuMs = gpuNow
  const wall = valid(x.wallMs) ? x.wallMs : 0
  if (!x.hasGpuSource && gpuNow === 0) return wall > 0 ? wall : null
  const gpu = gpuNow > 0 ? gpuNow : s.lastGpuMs
  if (gpu === 0) return null
  s.wallRun = wall > Math.max(gpu, x.capMs ?? 0) + FLIGHT_HYST_WALL_MARGIN_MS ? s.wallRun + 1 : 0
  if (s.wallRun >= FLIGHT_HYST_WALL_RUN) return Math.max(gpu, wall)
  // A frame without a fresh reading is no evidence: one slow reading must not fill several ring slots.
  return gpuNow > 0 ? gpuNow : null
}

/**
 * `hold` (?sharp=1): the flight keeps the grid it started on. No budget step down, no climb; only the emergency (6 frames over twice the budget) steps
 * down, one rung at a time, to `emergencyFloor`. Without it, the ladder as before.
 */
export interface FlightHold { emergencyFloor: number }
export function flightHystStep(s: FlightHystState, scale: number, floor: number, x: FlightScaleSample, now: number, hold?: FlightHold): number {
  const cost = flightHystCost(s, x)
  if (cost === null) return scale
  s.ring.push(cost > FLIGHT_SCALE_DOWN_P95_MS)
  if (s.ring.length > FLIGHT_HYST_RING) s.ring.shift()
  s.calm.push(cost)
  if (s.calm.length > FLIGHT_SCALE_WINDOW) s.calm.shift()
  const minScale = Math.max(MOTION_STEPS[0], floor)
  const idx = MOTION_STEPS.indexOf(scale)
  if (idx < 0) return minScale
  const gpuReading = Math.max(valid(x.gpuMs) ? x.gpuMs : 0, valid(x.fenceMs) ? x.fenceMs : 0)
  if (gpuReading > 0) s.emergencyRun = gpuReading > FLIGHT_HYST_EMERGENCY_MS ? s.emergencyRun + 1 : 0
  const change = (next: number): number => { s.steps++; s.lastStepAt = now; s.ring.length = 0; s.calm.length = 0; s.emergencyRun = 0; return next }
  const emergencyMin = hold ? Math.max(MOTION_STEPS[0], hold.emergencyFloor) : minScale
  if (s.emergencyRun >= FLIGHT_HYST_EMERGENCY_RUN && scale > emergencyMin) return change(MOTION_STEPS[Math.max(0, idx - 1)])
  if (hold) return scale
  // During the dwell the evidence is the old rung's: drop it, so the next change is judged on frames drawn after the dwell.
  if (now - s.lastStepAt < FLIGHT_HYST_DWELL_MS) { s.ring.length = 0; s.calm.length = 0; return Math.max(scale, minScale) }
  if (s.steps >= FLIGHT_HYST_MAX_STEPS) return Math.max(scale, minScale)
  const over = s.ring.filter(Boolean).length
  if (over >= FLIGHT_HYST_OVER && scale > minScale) return change(MOTION_STEPS[Math.max(0, idx - 1)])
  if (s.calm.length >= FLIGHT_SCALE_WINDOW && percentile95(s.calm) < FLIGHT_SCALE_UP_P95_MS && idx < MOTION_STEPS.length - 1) return change(MOTION_STEPS[idx + 1])
  return Math.max(scale, minScale)
}

/** The ladder as the flight uses it: the old controller, or the hysteresis one behind `?flightscale=hyst`. */
export class FlightScaleLadder {
  private readonly old: FlightScaleController
  private hyst = freshFlightHystState()
  private scale: number
  constructor(scale: number, readonly mode: FlightScaleMode = 'old') { this.scale = scale; this.old = new FlightScaleController(scale) }
  get current(): number { return this.mode === 'hyst' ? this.scale : this.old.current }
  /** Scale changes since the last reset (the current flight) and over the page's life: the numbers the A/B counts. */
  get steps(): number { return this.mode === 'hyst' ? this.hyst.steps : this.oldSteps }
  totalSteps = 0
  private oldSteps = 0
  update(x: FlightScaleSample, floor: number, now: number, hold?: FlightHold): number {
    const before = this.current
    let next: number
    if (this.mode === 'hyst') next = this.scale = flightHystStep(this.hyst, this.scale, floor, x, now, hold)
    else { next = this.old.update(flightFrameCostMs(x.wallMs, x.gpuMs, x.fenceMs), floor); if (next !== before) this.oldSteps++ }
    if (next !== before) this.totalSteps++
    return next
  }
  reset(scale = this.current): void { this.scale = scale; this.old.reset(scale); this.hyst = freshFlightHystState(); this.oldSteps = 0 }
}
