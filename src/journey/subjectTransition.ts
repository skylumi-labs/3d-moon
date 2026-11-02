import { Quaternion, Vector3 } from 'three'
import { basisFromQuat, quatFromBasis, sizeRatio, type ViewCamera } from '../camera/pose'
import { EARTH_R_KM, MOON_R_KM } from '../glsl/common'
const ease = (x: number) => { const u = Math.max(0, Math.min(1, x)); return u * u * u * (u * (u * 6 - 15) + 10) }
export const EARTH_TRANSITION_MS = 9000
/**
 * Where the journey's phases end, as shares of its length. The earthrise hold used to run to 0.8 (3.2 s of a held frame): an eclipsed
 * Moon and a dark Earth left nothing in it that moved, and the audit read a 3.4 s freeze. It now ends at 0.63 (2.1 s of a 9 s journey) and keeps drifting in
 * (HOLD_PUSH) so the held frame is never a still; the turn and the approach take the time it gave back: the approach is 2 s because the Moon leaves the frame by parallax during it, and a faster exit read as a pump in the frame mean.
 */
const U_HOLD_END = 0.63, U_TURN_END = 0.78
/** The share of the hold's field of view the slow push-in takes off over the hold. A look choice. */
const HOLD_PUSH = 0.14
/** The earthrise waypoint's default distance from the Moon's centre, radii. A moment may ask for a farther one (`earthWaypointR`): the Moon is then a smaller disc beside the Earth, so its exit from the frame during the lens' tightening moves the frame mean less (the solar eclipse of 2027 pumped past the audit's floor with 5). */
const WAYPOINT_MIN_R = 5
export interface SubjectTransition {
  t0: number; durationMs: number; from: ViewCamera; to: ViewCamera; earth: Vector3; north: Vector3
  aspect: number; waypoint: Vector3; direct: boolean
}
const qOf = (c: ViewCamera) => quatFromBasis(c.right, c.up, c.back)
const basisAt = (pos: Vector3, forward: Vector3, north: Vector3, tanHalf: number): ViewCamera => {
  const back = forward.clone().normalize().negate()
  let up = north.clone().addScaledVector(back, -north.dot(back))
  if (up.length() < 1e-8) up = new Vector3(0, 1, 0).addScaledVector(back, -back.y)
  up.normalize()
  return { pos, back, up, right: new Vector3().crossVectors(up, back).normalize(), tanHalf }
}
function position(a: Vector3, b: Vector3, u: number, north: Vector3): Vector3 {
  const k = ease(u), da = a.clone().normalize(), db = b.clone().normalize()
  const axis = new Vector3().crossVectors(da, db)
  if (axis.length() < 1e-8) axis.copy(north).addScaledVector(da, -north.dot(da))
  axis.normalize()
  return da.applyAxisAngle(axis, da.angleTo(db) * k).multiplyScalar(Math.exp(Math.log(a.length()) + (Math.log(b.length()) - Math.log(a.length())) * k))
}
export function earthTransition(from: ViewCamera, to: ViewCamera, earth: Vector3, north: Vector3, aspect: number, now: number, waypointR = WAYPOINT_MIN_R): SubjectTransition {
  const e = earth.clone().normalize(), side = new Vector3().crossVectors(north, e).normalize()
  // About 14 degrees off the far-side axis: Earth clears the real lunar limb, with both bodies in a 40-degree composition.
  const delta = 14 * Math.PI / 180
  const waypoint = e.multiplyScalar(-Math.cos(delta)).addScaledVector(side, Math.sin(delta)).multiplyScalar(Math.max(waypointR, to.pos.length()))
  const earthDir = earth.clone().sub(from.pos).normalize()
  const direct = from.back.clone().negate().dot(earthDir) > Math.cos(Math.atan(from.tanHalf) * 1.2)
  return { t0: now, durationMs: EARTH_TRANSITION_MS, from, to, earth, north, aspect, waypoint, direct }
}
export function subjectTransitionAt(j: SubjectTransition, now: number): { cam: ViewCamera; phase: string; progress: number; done: boolean } {
  const u = Math.max(0, Math.min(1, (now - j.t0) / j.durationMs))
  if (u === 0) return { cam: j.from, phase: 'departure', progress: u, done: false }
  if (u === 1) return { cam: j.to, phase: 'arrival', progress: u, done: true }
  if (j.direct) {
    const p = position(j.from.pos, j.to.pos, u, j.north), b = basisFromQuat(new Quaternion().slerpQuaternions(qOf(j.from), qOf(j.to), ease(u)))
    return { cam: { pos: p, ...b, tanHalf: Math.exp(Math.log(j.from.tanHalf) + (Math.log(j.to.tanHalf) - Math.log(j.from.tanHalf)) * ease(u)) }, phase: 'earth-anchored', progress: u, done: false }
  }
  const moon = j.waypoint.clone().negate().normalize(), earth = j.earth.clone().sub(j.waypoint).normalize()
  const shared = moon.clone().multiplyScalar(.7).addScaledVector(earth, .3).normalize()
  const wide = Math.tan(20 * Math.PI / 180) / Math.min(1, j.aspect)
  const hold = basisAt(j.waypoint.clone(), shared, j.north, wide)
  if (u < .4) {
    const k = ease(u / .4), p = position(j.from.pos, j.waypoint, u / .4, j.north)
    const q = basisFromQuat(new Quaternion().slerpQuaternions(qOf(j.from), qOf(hold), k))
    const r0 = sizeRatio(j.from.pos.length(), j.from.tanHalf), r1 = sizeRatio(j.waypoint.length(), wide)
    const ratio = Math.exp(Math.log(r0) + (Math.log(r1) - Math.log(r0)) * k)
    return { cam: { pos: p, ...q, tanHalf: Math.tan(Math.asin(1 / p.length())) / ratio }, phase: 'moon-to-earthrise', progress: u, done: false }
  }
  const pushed = { ...hold, tanHalf: wide * (1 - HOLD_PUSH) }
  if (u < U_HOLD_END) return { cam: { ...hold, tanHalf: wide * (1 - HOLD_PUSH * ease((u - .4) / (U_HOLD_END - .4))) }, phase: 'earthrise-hold', progress: u, done: false }
  if (u < U_TURN_END) {
    const kk = (u - U_HOLD_END) / (U_TURN_END - U_HOLD_END), k = ease(Math.min(1, kk / 0.55)), kl = ease(Math.max(0, (kk - 0.4) / 0.6)), earthCam = basisAt(j.waypoint.clone(), earth, j.north, j.to.tanHalf)
    const b = basisFromQuat(new Quaternion().slerpQuaternions(qOf(pushed), qOf(earthCam), k))
    const offset = Math.acos(Math.max(-1, Math.min(1, b.back.clone().negate().dot(earth))))
    const radius = Math.asin(EARTH_R_KM / MOON_R_KM / j.earth.distanceTo(j.waypoint))
    // The camera turns first (done by 55% of the turn) and the lens follows (from 40%): tightening the lens while the Moon was still crossing the
    // frame grew the Moon to fill it for half a second (mean grey 38 to 85 to 16 on the solar-eclipse chip). The offset term keeps the Earth framed.
    const lens = Math.exp(Math.log(pushed.tanHalf) + (Math.log(j.to.tanHalf) - Math.log(pushed.tanHalf)) * kl)
    return { cam: { pos: j.waypoint.clone(), ...b, tanHalf: Math.max(lens, Math.tan(offset + radius * 1.3)) }, phase: 'turn-to-earth', progress: u, done: false }
  }
  const p = position(j.waypoint, j.to.pos, (u - U_TURN_END) / (1 - U_TURN_END), j.north)
  const anchored = basisAt(p, j.earth.clone().sub(p), j.north, j.to.tanHalf)
  const endAnchor = basisAt(j.to.pos.clone(), j.earth.clone().sub(j.to.pos), j.north, j.to.tanHalf)
  const correction = qOf(endAnchor).invert().multiply(qOf(j.to))
  const q = qOf(anchored).multiply(new Quaternion().identity().slerp(correction, ease((u - U_TURN_END) / (1 - U_TURN_END))))
  const b = basisFromQuat(q)
  return { cam: { ...anchored, ...b }, phase: 'earth-approach', progress: u, done: false }
}
