import { MOON_R_KM } from '../glsl/common'

/** Diameter occupies at most 75% of the narrower viewport dimension. */
export function featureViewDistance(diameterKm: number | undefined, fovDeg: number, aspect: number): number | undefined {
  if (!(diameterKm && diameterKm > 0)) return undefined
  const halfField = Math.tan(fovDeg * Math.PI / 360) * Math.min(1, Math.max(0.1, aspect))
  return 1 + diameterKm / (2 * MOON_R_KM * halfField * 0.75)
}
