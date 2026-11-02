/**
 * The Home frame's distance follow (main.ts stepLayout): at Home the camera distance eases toward the distance that frames the disc in the
 * free rectangle. The frame is dropped the moment anything else moves the distance:
 *  - a zoom INPUT (rig.lastZoomInputAt changed: a wheel notch, a pinch step, + or -, a button), however small its per-frame step. A button
 *    or a smooth wheel eases in from rest, so its first frames move the distance by well under the 2 % below, and the follow (7 per second)
 *    would eat them and the visitor's zoom would never land;
 *  - a frame that moved the distance by more than 2 % on its own (a pose set from outside).
 */
export const HOME_DROP_LOG = 0.02
export interface HomeFollowState { homeFrame: boolean; applied: number }
export function homeFollowStep(s: HomeFollowState, dist: number, targetDist: number, dt: number, zoomInput: boolean): { homeFrame: boolean; applied: number; dist: number } {
  if (!s.homeFrame || zoomInput) return { homeFrame: false, applied: s.applied, dist }
  const applied = Number.isNaN(s.applied) ? dist : s.applied
  if (Math.abs(Math.log(dist / applied)) > HOME_DROP_LOG) return { homeFrame: false, applied, dist }
  const d = Math.abs(Math.log(targetDist / dist)) < 1e-3 ? targetDist : dist * Math.exp(Math.log(targetDist / dist) * (1 - Math.exp(-7 * dt)))
  return { homeFrame: true, applied: d, dist: d }
}
