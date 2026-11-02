import { clampDist } from '../camera/pose'

/**
 * True once the camera has reached the end of a descent. The end pose is not always reachable as computed: `rig.setPose`
 * raises it to the site floor at that spot (the funnel opens with distance from the site, and the tilted end backs the
 * camera off it), so the pose that is held sits above the one the descent asks for. Comparing against the unraised pose
 * left the descent running forever.
 */
export function descentReached(poseDist: number, idealDist: number, floorAtEnd: number): boolean {
  return poseDist <= clampDist(idealDist, floorAtEnd) + 1e-6
}
