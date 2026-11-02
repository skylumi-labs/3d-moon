import { Quaternion, Vector3 } from 'three'
import { basisFromQuat, quatFromBasis, type ViewCamera } from '../camera/pose'
const smooth = (u: number) => { const t = Math.max(0, Math.min(1, u)); return t * t * t * (t * (t * 6 - 15) + 10) }
export const LOOK_TRANSITION_MS = 2200
export interface LookTransition {
  t0: number; from: ViewCamera; to: ViewCamera; target: Vector3; targetRadius: number
  aspect: number; subject: 'moon' | 'earth' | 'sun'; restoreAuto: boolean; generation: number
}
/** A reversible, framed look turn. Target and Moon geometry determine the temporary lens; endpoints are unchanged. */
export function lookTransitionAt(j: LookTransition, now: number): { cam: ViewCamera; progress: number; done: boolean } {
  const u = Math.max(0, Math.min(1, (now - j.t0) / LOOK_TRANSITION_MS)), k = smooth(u)
  if (u === 0) return { cam: j.from, progress: 0, done: false }
  if (u === 1) return { cam: j.to, progress: 1, done: true }
  const dir0 = j.from.pos.clone().normalize(), dir1 = j.to.pos.clone().normalize()
  const qPos = new Quaternion().setFromUnitVectors(dir0, dir1)
  const position = dir0.applyQuaternion(new Quaternion().identity().slerp(qPos, k))
    .multiplyScalar(Math.exp(Math.log(j.from.pos.length()) + (Math.log(j.to.pos.length()) - Math.log(j.from.pos.length())) * k))
  const q = new Quaternion().slerpQuaternions(quatFromBasis(j.from.right, j.from.up, j.from.back), quatFromBasis(j.to.right, j.to.up, j.to.back), k)
  const b = basisFromQuat(q), forward = b.back.clone().negate()
  const moonDir = position.clone().negate(), targetDir = j.target.clone().sub(position)
  const moonAngle = forward.angleTo(moonDir), targetAngle = forward.angleTo(targetDir)
  const moonRadius = Math.asin(Math.min(1, 1 / position.length()))
  const targetRadius = Math.asin(Math.min(1, j.targetRadius / targetDir.length()))
  // Include a real limb, rather than introducing a cut to conceal a blank turn. A near-antipodal turn may need a very wide temporary lens.
  const needed = Math.min(Math.max(0, moonAngle - moonRadius * .7), Math.max(0, targetAngle - targetRadius * .7))
  const base = Math.exp(Math.log(j.from.tanHalf) + (Math.log(j.to.tanHalf) - Math.log(j.from.tanHalf)) * k)
  const bound = Math.tan(Math.min(89 * Math.PI / 180, needed + .01)) / Math.min(1, j.aspect)
  const lnA = Math.log(base), lnB = Math.log(Math.max(1e-8, bound)), d = lnA - lnB
  const lens = Math.exp((lnA + lnB + Math.sqrt(d * d + .001 * Math.sin(Math.PI * u) ** 4)) / 2)
  return { cam: { pos: position, ...b, tanHalf: lens }, progress: u, done: false }
}
