import { EARTH_R_KM, MOON_R_KM } from '../glsl/common'
import { SUN_R_KM } from '../lighting/solar'

/** A structural vector type so callers may pass THREE.Vector3 or plain vectors. */
export interface VectorLike { x: number; y: number; z: number }
export interface SunFrameCamera {
  right: VectorLike
  up: VectorLike
  back: VectorLike
  pos: VectorLike
  tanHalf: number
}
export interface SunInFrameInput {
  camera: SunFrameCamera
  aspect: number
  sunPosition: VectorLike
  earthPosition: VectorLike
  /** The Sun white point selected by computeExposure. */
  sunWhite: number
  wasOn: boolean
  moonSubject: boolean
  /** Whether the Moon's disc intersected the previous frame. */
  wasMoonInFrame?: boolean
  /** Keep Sun-directed scripted looks on their established exposure path. */
  sunLook?: boolean
}

const MOON_SUBJECT_EDGE = 0.9
const SUBJECT_HYSTERESIS = 0.12
const MOON_FRAME_HYSTERESIS = 0.12
const MOON_SUBJECT_ENTER_DISTANCE = 1.5
const MOON_SUBJECT_EXIT_DISTANCE = 1.4
const MOON_DISC_ENTER_DISTANCE = 1
const MOON_DISC_EXIT_DISTANCE = 0.95

function dot(a: VectorLike, b: VectorLike): number { return a.x * b.x + a.y * b.y + a.z * b.z }
function length(a: VectorLike): number { return Math.hypot(a.x, a.y, a.z) }
function sub(a: VectorLike, b: VectorLike): VectorLike { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z } }
function scale(a: VectorLike, k: number): VectorLike { return { x: a.x * k, y: a.y * k, z: a.z * k } }
function normalize(a: VectorLike): VectorLike { return scale(a, 1 / length(a)) }
function crossLength(a: VectorLike, b: VectorLike): number {
  return Math.hypot(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
}

/**
 * Moon-subject test with a small off margin. The initial off decision uses
 * the original 0.9 frame edge; a held subject releases only after it crosses
 * a further 0.12 half-field.
 */
export function moonSubjectInFrame(camera: SunFrameCamera, aspect: number, wasSubject: boolean): boolean {
  const cameraDistance = length(camera.pos)
  if (wasSubject ? cameraDistance < MOON_SUBJECT_EXIT_DISTANCE : cameraDistance <= MOON_SUBJECT_ENTER_DISTANCE) return false
  const toMoon = normalize(scale(camera.pos, -1))
  const moonBack = dot(toMoon, camera.back)
  if (moonBack >= 0) return false
  const edge = MOON_SUBJECT_EDGE + (wasSubject ? SUBJECT_HYSTERESIS : 0)
  return Math.abs(dot(toMoon, camera.right) / -moonBack) < edge * camera.tanHalf * aspect &&
    Math.abs(dot(toMoon, camera.up) / -moonBack) < edge * camera.tanHalf
}

/** True when any part of the Moon's disc overlaps the frame, with a wider release edge. */
export function moonDiscInFrame(camera: SunFrameCamera, aspect: number, wasInFrame = false): boolean {
  const cameraDistance = length(camera.pos)
  if (wasInFrame ? cameraDistance < MOON_DISC_EXIT_DISTANCE : cameraDistance <= MOON_DISC_ENTER_DISTANCE) return false
  const toMoon = normalize(scale(camera.pos, -1))
  const moonBack = dot(toMoon, camera.back)
  if (moonBack >= 0) return false
  const angularRadius = Math.asin(Math.min(1, 1 / cameraDistance))
  // Compare angular extents: adding tangent slopes underestimates a disc's
  // reach when its centre is far off axis. Keep the established release margin
  // in angle space so a grazing disc does not flicker during a drag.
  const margin = wasInFrame ? Math.atan(MOON_FRAME_HYSTERESIS * camera.tanHalf) : 0
  const x = Math.atan(Math.abs(dot(toMoon, camera.right) / -moonBack))
  const y = Math.atan(Math.abs(dot(toMoon, camera.up) / -moonBack))
  return x - angularRadius <= Math.atan(camera.tanHalf * aspect) + margin &&
    y - angularRadius <= Math.atan(camera.tanHalf) + margin
}

/** Pure Sun white point and visibility decision. Positions and camera position use Moon radii. */
export function sunInFrame(input: SunInFrameInput): { white: number; on: boolean; moonInFrame: boolean } {
  const { camera: cam, aspect, sunPosition, earthPosition, sunWhite, wasOn, moonSubject } = input
  const moonInFrame = moonDiscInFrame(cam, aspect, input.wasMoonInFrame)
  const suppressedByMoon = moonSubject || (moonInFrame && !input.sunLook)
  const rel = sub(sunPosition, cam.pos)
  const dist = length(rel)
  const dir = scale(rel, 1 / dist)
  const back = dot(dir, cam.back)
  if (back >= 0) return { white: 0, on: false, moonInFrame }
  const theta = Math.asin(SUN_R_KM / (dist * MOON_R_KM))
  const x = dot(dir, cam.right) / -back, y = dot(dir, cam.up) / -back
  // Retain the established frame edge padding while tightening the occultation
  // test below when already on, so a grazing disc does not alternate states.
  const margin = wasOn ? 0.12 * cam.tanHalf : 0
  if (Math.abs(x) > cam.tanHalf * aspect + theta + margin || Math.abs(y) > cam.tanHalf + theta + margin) return { white: 0, on: false, moonInFrame }
  if (suppressedByMoon) return { white: 0, on: false, moonInFrame }
  const hidden = (centre: VectorLike, radius: number): boolean => {
    const c = normalize(centre)
    const separation = Math.atan2(crossLength(dir, c), dot(dir, c))
    const slack = wasOn ? -0.6 * theta : 0
    return separation < radius - theta + slack
  }
  const earthRel = sub(earthPosition, cam.pos)
  const earthDist = length(earthRel)
  if (earthDist * MOON_R_KM > 1.5 * EARTH_R_KM && hidden(earthRel, Math.asin(EARTH_R_KM / (earthDist * MOON_R_KM)))) return { white: 0, on: false, moonInFrame }
  if (hidden(scale(cam.pos, -1), Math.asin(Math.min(1, 1 / length(cam.pos))))) return { white: 0, on: false, moonInFrame }
  return { white: sunWhite, on: true, moonInFrame }
}
