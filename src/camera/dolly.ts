import type { Vector3 } from 'three'
import { raySphere } from './pose'

/**
 * Zoom as a dolly along the view: the camera moves toward (or away from) the surface point under the middle of the screen along
 * the centre ray, so that point stays exactly where it is on screen (Google Earth style). Looking straight down this is the old
 * zoom (the distance from the centre changes and nothing else); in an oblique view the camera's latitude, longitude and altitude
 * change together instead of the camera dropping straight down while the view slides over the ground.
 *
 * Pure geometry in the world frame, Moon radii. The speed feel is the old law's: `newDist` is what the radial zoom law
 * (zoomDist) would give for this input; the ray length changes by the same ratio the nadir altitude would.
 */

/** Where the centre ray meets the ground: the sphere of radius 1 + ground, the ground read at the hit and refined once (the ground varies slowly). */
export function centreTarget(pos: Vector3, fwd: Vector3, groundOfDir: (dir: Vector3) => number): { target: Vector3; radius: number } | null {
  let radius = 1
  let hit = raySphere(pos, fwd, radius)
  if (!hit) return null
  for (let i = 0; i < 2; i++) {
    radius = 1 + groundOfDir(hit.clone().normalize())
    const next = raySphere(pos, fwd, radius)
    if (!next) break
    hit = next
  }
  return { target: hit, radius }
}

/**
 * The camera position after one zoom step along the centre ray, or null when there is no ground under the centre (sky or limb:
 * the caller uses the radial zoom). `newDist` is the radial law's new distance from the Moon's centre for the same input.
 */
export function dollyPosition(pos: Vector3, fwd: Vector3, newDist: number, groundOfDir: (dir: Vector3) => number): Vector3 | null {
  const hit = centreTarget(pos, fwd, groundOfDir)
  if (!hit) return null
  const dist = pos.length()
  const nadir = dist - hit.radius
  if (nadir <= 1e-9) return null
  const ray = hit.target.clone().sub(pos).length()
  const k = (newDist - hit.radius) / nadir
  if (!(k > 0)) return null
  return hit.target.clone().addScaledVector(fwd, -ray * k)
}

/** How fast a limit may change per unit of length moved: the distance from the centre changes by at most 1, a floor by at most this (the site cone is 2, terrain slopes are under 1). Real floors also jump (coverage steps), see SAFETY_MARGIN. */
export const FLOOR_LIPSCHITZ = 4
/** The most clearance samples one step takes. A walk that has not reached the end by then stops at the last sample known to be clear. */
export const CLAMP_MAX_STEPS = 256
/** Radii (about 35 m): a clearance that is both this small and shrinking from one sample to the next ends the walk, so a floor that jumps up ahead (which no Lipschitz bound covers) stops the camera above it, not across it. */
export const SAFETY_MARGIN = 2e-5
/** A clearance this small at the start means the camera is standing on the limit. */
export const STANDING_CLEARANCE = 1e-7

/**
 * The farthest point along the step from `from` to `to` that is known to be clear, where `clearance` (>= 0 is clear; distance to the
 * nearest limit, negative inside a forbidden region) holds. The segment is walked in clearance-sized strides ("sphere tracing"): a
 * limit that moves at most `lipschitz` per unit length cannot be crossed in a stride of clearance / (1 + lipschitz). The walk never
 * returns an endpoint it did not reach and verify: it stops at the last clear sample when
 *  - the stride budget (`maxSteps`) runs out, or the safe stride is too small to be worth taking while the clearance is shrinking;
 *  - the clearance is under SAFETY_MARGIN and shrinking (a discontinuous floor ahead);
 * and bisects to the first crossing when a sample is not clear. Every stride is the safe clearance stride. Standing on a limit
 * (clearance ~0 at the start) is handled first: a move toward the surface returns `from`; a move away leaves it in small strides while the
 * clearance does not shrink, then the walk continues normally. Returns `to` only when it was reached clear.
 */
export function clampAlong(
  from: Vector3, to: Vector3, clearance: (p: Vector3) => number,
  lipschitz = FLOOR_LIPSCHITZ, maxSteps = CLAMP_MAX_STEPS,
): Vector3 {
  const len = from.distanceTo(to)
  if (!(len > 0)) return to
  const EPS = -1e-9
  const at = (t: number): Vector3 => from.clone().lerp(to, t)
  let t = 0
  let lastOk = 0
  let prev = Infinity
  // Standing on a limit (clearance at most STANDING_CLEARANCE at the start, or already past it): no stride can be proven safe from here.
  // A move toward the surface (the distance from the centre decreases along the segment; it is convex along a line, so its slope at the
  // start says so) is blocked outright. A move away leaves the limit in small fixed strides while the clearance does not shrink; the
  // moment it does, the walk stops there; once the clearance is above STANDING_CLEARANCE the normal clearance-stride walk takes over.
  const c0 = clearance(from)
  if (c0 <= STANDING_CLEARANCE) {
    if (from.dot(to.clone().sub(from)) < 0) return from
    const s = 1 / maxSteps
    let c = c0
    for (let n = 0; n < maxSteps && c <= STANDING_CLEARANCE; n++) {
      const tn = Math.min(1, t + s)
      const cn = clearance(at(tn))
      if (cn < c - 1e-12) return at(t)
      t = tn; c = cn
      if (t >= 1) return to
    }
    if (c <= STANDING_CLEARANCE) return at(t)
    lastOk = t
    prev = c
  }
  let firstBad = -1
  for (let n = 0; n < maxSteps; n++) {
    const c = clearance(at(t))
    if (c < EPS) { firstBad = t; break }
    if (t > 0 && c < SAFETY_MARGIN && c < prev) return at(lastOk)
    lastOk = t
    if (t >= 1) return to
    let stride = c / ((1 + lipschitz) * len)
    if (stride < 1e-6 && c < prev) return at(lastOk)
    prev = c
    t = Math.min(1, t + stride)
  }
  if (firstBad < 0) return at(lastOk) // out of budget: only what was verified
  let lo = lastOk, hi = firstBad
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (clearance(at(mid)) >= EPS) lo = mid; else hi = mid
  }
  return at(lo)
}

/**
 * A CONTINUOUS floor from the finest-data floors found at sample points along a step: `floors[j]` is the floor (radii from the centre) the
 * data under `dirs[j]` allows, Infinity where none. The floor at a point is the lowest of those, each raised as a cone by `cone` per unit of arc
 * to the point (the site cone), so it is `cone`-Lipschitz exactly, with no steps. It is never LOWER than the true cone floor over all the data
 * (it takes the minimum over fewer points): a block the samples miss only raises it, so a coarse sampling is conservative, never unsafe.
 */
export function coneFloor(dirs: readonly Vector3[], floors: readonly number[], cone: number): (p: Vector3) => number {
  return (p: Vector3): number => {
    const u = p.clone().normalize()
    let best = Infinity
    for (let j = 0; j < dirs.length; j++) {
      const f = floors[j]!
      if (!Number.isFinite(f)) continue
      const arc = Math.acos(Math.max(-1, Math.min(1, u.dot(dirs[j]!))))
      const v = f + cone * arc
      if (v < best) best = v
    }
    return best
  }
}
