import { Vector3 } from 'three'
import type { ViewCamera } from './pose'

/**
 * The maths of the free-flying camera controls (the on-screen column and the W A S D Q E keys): which way "forward" is over the
 * ground, the compass heading, and how far the view may tilt at each distance. Pure functions of vectors and numbers.
 */

const DEG = Math.PI / 180

/** The unit tangent at the camera that "forward" means: the way the top of the screen points over the ground (the way the view looks, projected onto the surface). */
export function forwardTangent(cam: ViewCamera): Vector3 {
  const radial = cam.pos.clone().normalize()
  const f = cam.up.clone().addScaledVector(radial, -cam.up.dot(radial))
  if (f.lengthSq() < 1e-12) f.copy(cam.back).negate().addScaledVector(radial, cam.back.dot(radial))
  return f.normalize()
}

/** The unit tangent to the right of forward (over the ground, looking from above). */
export function rightTangent(cam: ViewCamera): Vector3 {
  const radial = cam.pos.clone().normalize()
  return new Vector3().crossVectors(forwardTangent(cam), radial).normalize()
}

/**
 * The turn of the camera about the Moon's centre that moves it `arcRad` along the surface toward the unit tangent `dir`
 * (negative arcs go the other way). The camera keeps its distance from the centre, and turned rigidly, its heading.
 */
export function surfaceMove(pos: Vector3, dir: Vector3, arcRad: number): { axis: Vector3; angle: number } {
  const radial = pos.clone().normalize()
  const axis = new Vector3().crossVectors(radial, dir)
  if (axis.lengthSq() < 1e-18) return { axis: new Vector3(0, 0, 1), angle: 0 }
  return { axis: axis.normalize(), angle: arcRad }
}

/** Compass heading of the view, deg clockwise from lunar north (0: north is at the top of the screen, 90: east is). `north` is the world direction of the pole. */
export function viewHeadingDeg(cam: ViewCamera, north: Vector3): number {
  const radial = cam.pos.clone().normalize()
  const n = north.clone().addScaledVector(radial, -north.dot(radial))
  if (n.lengthSq() < 1e-12) return 0
  n.normalize()
  const east = new Vector3().crossVectors(n, radial).normalize()
  const f = forwardTangent(cam)
  return Math.atan2(f.dot(east), f.dot(n)) / DEG
}

/** Wraps a heading to (-180, 180]. */
export const wrapHeading = (deg: number): number => { const w = ((deg + 540) % 360) - 180; return w === -180 ? 180 : w }

/**
 * The most the view may tilt from straight down at `dist` Moon radii: `near` close to the surface (all of it below 1.8 radii), and
 * in orbit the Moon's apparent radius (its limb reaches the middle of the frame and no further), but between 0.4 and 0.8 of the
 * field's half-width (`fovDeg` spans the short side), so the Moon's centre always stays inside the frame. `relief` is the
 * 1.8 to 2.4 blend (reliefShare, pose.ts).
 */
export function tiltLimitDeg(dist: number, near: number, fovDeg: number, relief: number): number {
  const radius = Math.asin(Math.min(1, 1 / Math.max(1, dist))) / DEG
  const half = fovDeg / 2
  const orbit = Math.min(near, Math.max(0.4 * half, Math.min(radius, 0.8 * half)))
  return relief * near + (1 - relief) * orbit
}
