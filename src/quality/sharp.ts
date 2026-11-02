/**
 * "Sharp first" on touch classes (owner option A, WP-G): trade frame rate for resolution. Owner on an Android phone at default settings:
 * "way too blurry ... I'm okay with slightly lower frame rates if that gives a much less grainy experience".
 *
 * Why the default picture is soft: the canvas is already sized at the rest ratio (2 on phone-android), but a motion frame renders at
 * `scale x motionDpr / restDpr` (main.ts render), and a flight's grid lets `scale` fall to 0.25 with motionDpr 1.25 close in: 0.625 x 0.35 of the canvas
 * width, 128 to 180 px on a 411 CSS px phone. Sharp makes the grid the only scale in a flight (the ratio factor is skipped), HOLDS one grid for the whole
 * flight (0.5, 0.7 or 1, from the class and the flight; only an emergency step-down remains), draws flights at 30 fps (33 ms budget), reconstructs the
 * magnified frame with Catmull-Rom (post/upscale.ts) and keeps a larger, non-aborting flight prefetch. Gestures keep their 60 fps and their ladder.
 *
 * OFF by default: the smoothness rule wants a real-phone A/B against V1.1 before a motion default moves. `?sharp=1` turns it
 * on, `?sharp=0` off; flipping the default later is the one constant SHARP_DEFAULT. Pure functions and one holder; main.ts and the prefetcher read the holder.
 * Not done by design: the 8 GB phone is NOT given the Best preset (desktop motion knobs recreate the V1 close-up collapse in drags).
 */
import type { QualityClass } from './startupClass'

/** The one line to change once the owner's phone A/B (n >= 8 vs V1.1) accepts the trade. */
export const SHARP_DEFAULT = false

/** Touch classes only. Desktop and software are untouched whatever the flag says. */
export const SHARP_CLASSES: readonly QualityClass[] = ['ios', 'ipad', 'phone-android', 'tablet']

/** Frames a second for a scripted flight, and the budget that implies. */
export const SHARP_FLIGHT_FPS = 30
export const SHARP_FLIGHT_BUDGET_MS = 1000 / SHARP_FLIGHT_FPS
/** A grid is chosen when its predicted frame cost is at most this share of the budget. */
export const SHARP_FIT = 0.85
/** The grids a flight may hold. */
export const SHARP_GRIDS: readonly number[] = [0.5, 0.7, 1]
/** A gesture's first grid is at least this (the class default 0.35 reads as mush while the finger is down). */
export const SHARP_GESTURE_START_MIN = 0.5
/** Raw tile files the flight prefetcher holds (default 160, prefetch.ts). */
export const SHARP_PREFETCH_HELD_MAX = 320
/** Tiles fetched at once for the flight owner (default 3). */
export const SHARP_PREFETCH_PARALLEL = 6
/** The lowest grid an emergency step-down may reach. */
export const SHARP_EMERGENCY_FLOOR = 0.35

/**
 * The grid a flight holds before any measurement: a CLASS ESTIMATE, not a measurement. Phones 0.7 (about 60 % of the canvas side after the ratio factor
 * is gone, against 0.22 to 0.35 of it today); tablets and iPads have the GPU for the full grid.
 * The warm-up (quality/sharpPrep.ts SharpWarm, driven from main.ts during the "Preparing the flight" beat) replaces it per flight with `pickFlightGrid` fed by
 * timed off-screen draws; `setMeasuredGrid` stores the answer and `sharpFlightGrid` prefers it. The table stays the fallback when timing is unavailable.
 */
export const SHARP_CLASS_GRID: Record<QualityClass, number> = { 'phone-android': 0.7, ios: 0.7, ipad: 1, tablet: 1, desktop: 1, software: 1 }
/** Per-flight ceilings: the terminator run is about 10x dearer per pixel (long shadow marches on every pixel). */
export const SHARP_FLIGHT_MAX: Record<string, number> = { 'terminator-run': 0.5 }

/** Grids the warm-up measured on this device, by flight id (sharpPrep.ts SharpWarm). Wins over the class table; the per-flight ceiling still caps it. */
const measuredGrids = new Map<string, number>()
export function setMeasuredGrid(flightId: string, grid: number | null): void { if (grid === null) measuredGrids.delete(flightId); else measuredGrids.set(flightId, grid) }
export function measuredGridFor(flightId?: string): number | undefined { return flightId === undefined ? undefined : measuredGrids.get(flightId) }
/** Where the held grid of a flight came from: the warm-up's timing, or the class table. */
export const sharpGridSource = (flightId?: string): 'measured' | 'table' => measuredGridFor(flightId) !== undefined ? 'measured' : 'table'

/** The held grid for a class and a flight (`flightId` is a cinematic flight's id; a fly-to or the intro has none). */
export function sharpFlightGrid(cls: QualityClass, flightId?: string): number {
  const base = measuredGridFor(flightId) ?? SHARP_CLASS_GRID[cls]
  const max = flightId !== undefined ? SHARP_FLIGHT_MAX[flightId] : undefined
  return max === undefined ? base : Math.min(base, max)
}

/**
 * The finest candidate grid whose measured cost fits `SHARP_FIT` of the budget, never above `max`; `measured` is [grid, ms] pairs from the warm-up
 * (the worst of the sample poses per grid). The coarsest candidate when none fits. Fed by the warm-up (sharpPrep.ts); tested.
 */
export function pickFlightGrid(measured: ReadonlyArray<readonly [number, number]>, budgetMs = SHARP_FLIGHT_BUDGET_MS, max = 1): number {
  let pick = SHARP_GRIDS[0]
  for (const g of SHARP_GRIDS) {
    if (g > max) continue
    const m = measured.find(([s]) => s === g)
    if (m && Number.isFinite(m[1]) && m[1] <= SHARP_FIT * budgetMs) pick = g
  }
  return pick
}

export interface SharpConfig {
  on: boolean
  /** 0: no flight cap. */
  flightFps: number
  gestureStartMin: number
  heldMax: number
  parallel: number
}

export const SHARP_OFF: SharpConfig = { on: false, flightFps: 0, gestureStartMin: 0, heldMax: 0, parallel: 0 }

/** `?sharp=1` / `?sharp=0`; null when absent or anything else. */
export function sharpFromSearch(search: string): boolean | null {
  const v = new URLSearchParams(search).get('sharp')
  return v === '1' ? true : v === '0' ? false : null
}

/** `?sharpfps=0` removes the flight cap, `?sharpfps=N` (15..60) sets it; else SHARP_FLIGHT_FPS. For an A/B of 30 against 45. */
export function sharpFpsFromSearch(search: string): number {
  const raw = new URLSearchParams(search).get('sharpfps')
  if (raw === null || raw.trim() === '') return SHARP_FLIGHT_FPS
  const v = Number(raw)
  if (v === 0) return 0
  return Number.isFinite(v) && v >= 15 && v <= 60 ? v : SHARP_FLIGHT_FPS
}

/** The knobs for this device. Web only: the native shell has its own cap and class overrides. */
export function resolveSharp(cls: QualityClass, search: string, nativeShell = false, dflt = SHARP_DEFAULT): SharpConfig {
  const asked = sharpFromSearch(search) ?? dflt
  if (!asked || nativeShell || !SHARP_CLASSES.includes(cls)) return SHARP_OFF
  return { on: true, flightFps: sharpFpsFromSearch(search), gestureStartMin: SHARP_GESTURE_START_MIN, heldMax: SHARP_PREFETCH_HELD_MAX, parallel: SHARP_PREFETCH_PARALLEL }
}

let active: SharpConfig = SHARP_OFF
/** Set once at start-up (quality/runtime.ts initQuality). */
export function setSharp(c: SharpConfig): void { active = c }
export function currentSharp(): SharpConfig { return active }

/** The grid a flight holds (and its ladder is reset to): `motionScale` when sharp is off. */
export const sharpFlightStart = (c: SharpConfig, cls: QualityClass, motionScale: number, flightId?: string): number => c.on ? sharpFlightGrid(cls, flightId) : motionScale
/** The first grid of a gesture. */
export const sharpGestureStart = (c: SharpConfig, start: number): number => c.on ? Math.max(start, c.gestureStartMin) : start
/** Sharp judges flights with the hysteresis ladder (GPU time, emergency only while holding); otherwise `?flightscale=`. */
export const flightScaleModeFor = (c: SharpConfig, param: string | null): 'hyst' | 'old' => c.on || param === 'hyst' ? 'hyst' : 'old'
/** Whether a scripted-flight frame skips the motion/rest ratio factor (the grid is then the only scale). */
export const flightGridIsOnlyScale = (c: SharpConfig, inFlight: boolean): boolean => c.on && inFlight
