import { Vector3 } from 'three'
import type { ViewCamera } from './pose'

/**
 * Pure maths for the touch controls (the owner's Pixel session of 7 Oct 2026): a drag in the camera's own screen axes, the
 * twist of two fingers, and the rule that keeps the Moon in the frame while zooming out. Nothing here knows the rig.
 */

/** A world rotation: `angle` radians about the unit `axis`. */
export interface Rotation { axis: Vector3; angle: number }

/**
 * The damped sky-drag rate: altitude / sqrt(1 + altitude) times the pixel's angle (a linear altitude scale once felt like acceleration with
 * every zoom level). Since 2026-10-31 a sky drag multiplies it by skyDragGain, so it turns at a grab's rate again (linear in altitude, 3.5x this
 * at the far limit); the damped rate alone is `?skydrag=damped`. Free-flight moves (rig.moveAlong) and the arrow keys still use it as it is.
 */
export function spinRadiansPerPixel(altitude: number, fovDeg: number, shortCss: number): number {
  const height = Math.max(1, shortCss)
  const safeAltitude = Math.max(0, altitude)
  const response = safeAltitude / Math.sqrt(1 + safeAltitude)
  return fovDeg / height * response * Math.PI / 180
}

/**
 * The gain on spinRadiansPerPixel that makes a sky drag turn the Moon as fast as a grab of the disc's centre does (owner 2026-10-31:
 * "dragging the sky flies around the Moon" at the same rate as dragging the Moon). A grab at the centre turns the camera by altitude x
 * the pixel's angle (the surface point under the finger is `altitude` radii away); the sky rate is altitude / sqrt(1 + altitude) x the
 * same angle, so the gain is sqrt(1 + altitude): 1 at the ground (no change close in), 1.9 at Home (2.6 radii up).
 */
export function skyDragGain(altitude: number): number {
  return Math.sqrt(1 + Math.max(0, altitude))
}

/** Clamp a coalesced pointer delta before applying it, so one event cannot flip the view. */
export function capGestureRotation(angle: number, maxAngle: number): number {
  return Math.min(Math.max(0, angle), Math.max(0, maxAngle))
}

/**
 * The turn of the camera about the Moon's centre that follows a swipe of (dxCss, dyCss) in the camera's OWN screen axes
 * (dy down), `radPerPx` radians of arc per pixel: the Moon seems to move with the finger, whatever the pose's roll, tilt or
 * free orientation (a grabbed fly-to leaves one, and the old pose-axes drag then ran sideways). Null for no movement.
 */
export function spinRotation(cam: ViewCamera, dxCss: number, dyCss: number, radPerPx: number): Rotation | null {
  const len = Math.hypot(dxCss, dyCss)
  if (len < 1e-9) return null
  // The camera moves by -dx along its right and +dy along its up (the content follows the finger); axis x position = that move.
  // A screen axis can point partly along the camera's orbit radius when a view is tilted. That part only rolls the camera
  // around its own position and used to make the Moon's turn shrink toward the poles. Keep the tangent component and
  // normalize it so one screen pixel always turns the view direction by the same angle.
  const radial = cam.pos.clone().normalize()
  const axis = new Vector3().addScaledVector(cam.up, -dxCss).addScaledVector(cam.right, -dyCss)
  axis.addScaledVector(radial, -axis.dot(radial))
  if (axis.lengthSq() < 1e-12) {
    axis.copy(dxCss !== 0 ? cam.right : cam.up)
    axis.addScaledVector(radial, -axis.dot(radial))
  }
  axis.normalize()
  return { axis, angle: len * radPerPx }
}

/** Signed angle (degrees, counter-clockwise as seen) the line through two fingers turned from (pa, pb) to (a, b); screen y is down. */
export function twistDeg(
  pa: { x: number; y: number }, pb: { x: number; y: number },
  a: { x: number; y: number }, b: { x: number; y: number },
): number {
  const a0 = Math.atan2(-(pb.y - pa.y), pb.x - pa.x)
  const a1 = Math.atan2(-(b.y - a.y), b.x - a.x)
  let d = a1 - a0
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d * 180 / Math.PI
}

/** Fingers closer than this (CSS px) give no usable angle. */
export const TWIST_MIN_SPREAD_PX = 40
/** A twist engages only after this many degrees have accumulated (a pinching hand rotates a little), then follows the fingers to the end. */
export const TWIST_LATCH_DEG = 8
/** A step whose finger spread changes by more than this share is a clear zoom: it resets what has built up toward a twist. */
export const TWIST_ZOOM_STEP = 0.01

export interface TwistState { acc: number; latched: boolean }
export const newTwistState = (): TwistState => ({ acc: 0, latched: false })

/**
 * One step of a two-finger gesture: `deg` is the line's turn (twistDeg), `spreadRatio` the new spread over the old. Returns the
 * degrees to roll the view by now (0 until the twist has latched). Once latched it stays a twist until the fingers lift (the
 * caller makes a new state per gesture), like Google Earth.
 */
export function twistStep(st: TwistState, deg: number, spreadRatio: number): number {
  if (st.latched) return deg
  if (Math.abs(spreadRatio - 1) > TWIST_ZOOM_STEP) { st.acc = 0; return 0 }
  st.acc += deg
  if (Math.abs(st.acc) < TWIST_LATCH_DEG) return 0
  st.latched = true
  return st.acc
}

/**
 * The rotation that brings the Moon's centre back toward the middle of the frame when it sits more than `maxFrac` of the
 * half-frame of the short side (`aspect`: width over height) off the view axis, leaving it exactly on that limit; null when it is inside. Zooming out with a
 * free orientation (the camera was grabbed mid-journey) otherwise carried the Moon off the picture.
 */
export function recentreRotation(cam: ViewCamera, maxFrac: number, aspect = 1, maxAngle = Infinity): Rotation | null {
  const alpha = moonOffAxis(cam)
  const limit = Math.atan(maxFrac * cam.tanHalf * Math.min(1, aspect))
  if (alpha <= limit) return null
  const toMoon = cam.pos.clone().negate().normalize()
  const fwd = cam.back.clone().negate()
  const axis = new Vector3().crossVectors(fwd, toMoon)
  if (axis.lengthSq() < 1e-12) axis.copy(cam.up)
  return { axis: axis.normalize(), angle: Math.min(alpha - limit, maxAngle) }
}

/** Angle (rad) between the view axis and the direction to the Moon's centre. */
export function moonOffAxis(cam: ViewCamera): number {
  const toMoon = cam.pos.clone().negate().normalize()
  const fwd = cam.back.clone().negate()
  return Math.acos(Math.max(-1, Math.min(1, toMoon.dot(fwd))))
}

/** Radians of recentring allowed per ln-unit of zoom-out (1.5 rad per octave): a 2 % step turns at most ~2.5 deg. */
export const RECENTRE_RAD_PER_LN = 1.5 / Math.LN2
