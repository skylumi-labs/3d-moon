import type { Pose } from '../camera/pose'
import { MAX_STEP_MS } from './clock'

/** How fast the descent camera follows a lowered floor. */
export const DIST_LAG_MS = 400

/** Camera pose after the descent's altitude lag and the floor clamp used by CameraRig.setPose. */
export function descentRenderPose(
  target: Pose,
  lagDist: number | undefined,
  frameMs: number,
  ground: number,
  floor: number,
): { pose: Pose; lagDist: number } {
  const pose = { ...target }
  if (lagDist !== undefined && pose.dist < lagDist && frameMs > 0) {
    const k = Math.exp(-Math.min(frameMs, MAX_STEP_MS) / DIST_LAG_MS)
    const la = Math.log(Math.max(1e-9, lagDist - 1 - ground))
    const lt = Math.log(Math.max(1e-9, pose.dist - 1 - ground))
    pose.dist = Math.max(pose.dist, 1 + ground + Math.exp(lt + (la - lt) * k))
  }
  // CameraRig.setPose clamps to floorAt at the rendered longitude and latitude.
  pose.dist = Math.max(pose.dist, floor)
  return { pose, lagDist: pose.dist }
}
