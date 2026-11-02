import { planFly, ease, type FlyEnd, type FlyPlan } from '../journey/path'
import type { Pose } from './pose'

/**
 * A scripted fly-to as main.ts holds it: the planner's plan (journey/path.ts) and when it started. One ease, one duration law;
 * the pose, the lens, both aim shifts and the look all move together.
 */
export interface FlyTween {
  t0: number
  plan: FlyPlan
}

export const smoothstep = (x: number): number => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t) }

/** Smoothly adopts a changed tile floor, including a lowered floor. */
export function blendFloorDistance(plannedDist: number, floorDist: number, progress: number): number {
  const k = ease(progress)
  return plannedDist + (floorDist - plannedDist) * k
}

/** A destination initially limited by the loaded floor follows later floor changes in either direction. */
export function floorBoundEndDistance(endWasFloorBound: boolean, requestedDist: number, floorDist: number): number {
  return endWasFloorBound ? floorDist : Math.max(requestedDist, floorDist)
}

/** A floor change in flight is measured from the frame it was observed, in either direction. */
export interface FloorBlend { from: number; to: number; t0: number; base?: number }
export const FLOOR_BLEND_MS = 400
export const FLOOR_BLEND_RATE = 0.06
export function floorBlendDuration(blend: Pick<FloorBlend, 'from' | 'to'>): number {
  return Math.max(FLOOR_BLEND_MS, Math.abs(blend.to - blend.from) / FLOOR_BLEND_RATE * 1000)
}
export function sampleFloorBlend(blend: FloorBlend, now: number): number {
  const progress = Math.max(0, Math.min(1, (now - blend.t0) / floorBlendDuration(blend)))
  return blend.from + (blend.to - blend.from) * progress
}

/** Apply a changing endpoint to each sampled tween pose without replacing its in-flight descent. */
export function sampleFloorCorrection(plannedDist: number, blend: FloorBlend | null, now: number): number {
  return blend ? plannedDist + sampleFloorBlend(blend, now) - (blend.base ?? blend.from) : plannedDist
}

/** One blended floor constrains the sampled path without shifting its already floor-clamped endpoint. */
export function sampleEffectiveFloorState(plannedDist: number, trueFloor: number, blend: FloorBlend | null, now: number, _endWasFloorBound: boolean, _endBaseDist: number): { floor: number; dist: number } {
  const floor = blend ? sampleFloorBlend(blend, now) : trueFloor
  return { floor, dist: Math.max(plannedDist, floor) }
}

/** Everything the tween sets at `now`. */
export function tweenAt(tw: FlyTween, now: number): { pose: Pose; fov: number; aim: number; aimX: number; look: number; done: boolean } {
  const u = (now - tw.t0) / tw.plan.ms
  // A move that has not started yet (it waits for a date change's crossfade to finish) holds its first pose.
  const s = tw.plan.at(Math.max(0, u))
  return { pose: s.pose, fov: s.fovDeg, aim: s.aimShift, aimX: s.aimShiftX, look: s.look, done: u >= 1 }
}

/** Progress 0 to 1 of the tween at `now`, by the clock (not eased). */
export const tweenProgress = (tw: FlyTween, now: number): number => Math.max(0, Math.min(1, (now - tw.t0) / tw.plan.ms))

export { planFly, ease }
export type { FlyEnd }
