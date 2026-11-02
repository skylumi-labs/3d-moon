/**
 * The Apollo 11 pin's drop (main.ts startSiteView / stepDescent): the pure rules for where it starts and how it waits for the patch.
 * It moves on the first frame of every visit; the part above the funnel needs no patch (the base maps and the coarse tiles are fine there),
 * and a patch that is not ready when the path reaches the funnel slows the clock smoothly to a creep (never a stop, never a step).
 */
import { MAX_STEP_MS } from './clock'

/** The highest the path goes, radii from the Moon's centre (the disc in view, the site near the middle). */
export const SITE_APEX_DIST = 2.5
/** Down to this distance the journey runs without the patch. */
export const SITE_FUNNEL_DIST = 1.4
/** The creep's gain falls as exp(-(u - (uFunnel - W)) / W), no lower than the floor, and eases with GATE_TAU_MS. */
export const FUNNEL_CREEP_W = 0.08
export const FUNNEL_CREEP_MIN = 0.05
export const GATE_TAU_MS = 500

/** The apex the path uses from a camera at `dist`: no higher than the camera needs, so a camera already in the band goes straight down. */
export function siteApexDist(dist: number): number {
  return Math.min(SITE_APEX_DIST, Math.max(dist, SITE_FUNNEL_DIST))
}

/** The clock's gain to aim for: 1 once the patch is ready, otherwise falling off from just before the funnel. */
export function funnelAim(prevU: number, uFunnel: number, ready: boolean): number {
  if (ready) return 1
  return Math.max(FUNNEL_CREEP_MIN, Math.exp(-Math.max(0, prevU - (uFunnel - FUNNEL_CREEP_W)) / FUNNEL_CREEP_W))
}

/**
 * The aim while the patch is not ready, with the floor guard applied. The guard fell to 0 at the floor, so the aim (and with it the clock) went to
 * 0 there: the journey held its pose until the patch landed, then sped up in about GATE_TAU_MS (a held run of frames, then a surge). Now the guard
 * can slow the creep but not below FUNNEL_CREEP_MIN: the camera is held above the floor by rig.floorAt, the clock keeps creeping. `legacy`: the old product.
 */
export function guardedAim(aim: number, guard: number, ready: boolean, legacy = false): number {
  if (ready) return aim
  const g = aim * guard
  return legacy ? g : Math.max(FUNNEL_CREEP_MIN, g)
}

/** The gain eases toward its aim (time-based, a long frame counts at most MAX_STEP_MS). */
export function stepGate(gate: number, aim: number, frameMs: number): number {
  return gate + (aim - gate) * (1 - Math.exp(-Math.min(frameMs, MAX_STEP_MS) / GATE_TAU_MS))
}

/** The progress after the gain: the clock's own advance (u - prevU) scaled by it. */
export function gatedU(prevU: number, u: number, gate: number): number {
  return Math.min(1, prevU + Math.max(0, u - prevU) * gate)
}

/**
 * Whether the descent's clock runs at full speed. A drop with an apex (the Apollo 11 pin) is protected by the coverage floor, not by the clock
 * (clock.ts): once the coarse patch is ready and one level is bound the clock runs at 1x, and the camera is held above what is resident by
 * rig.floorAt; the end still waits for every level (stepDescent's u >= 1 branch). Any other descent waits for every level as before.
 */
export function descentDetailResident(o: { ready: boolean; apexPath: boolean; readyCoarse: boolean; refinementPending: boolean; boundLevels: number; levels: number; failedAndIdle: boolean }): boolean {
  if (!o.ready) return false
  if (o.failedAndIdle) return true
  if (o.apexPath) return o.readyCoarse && o.boundLevels >= 1
  return o.readyCoarse && !o.refinementPending && o.boundLevels >= o.levels
}

/**
 * The gate's aim is multiplied by this: the creep slows as the camera nears the floor under it, within one floor-altitude (floor - 1 radii) of it,
 * so it approaches the floor asymptotically and never reaches it while the patch is not ready (a dead stop at 28 km otherwise, diagnosis F4).
 */
export function floorGuard(dist: number, floor: number): number {
  const window = Math.max(1e-6, floor - 1)
  const x = Math.max(0, Math.min(1, (dist - floor) / window))
  return x * x * (3 - 2 * x)
}
