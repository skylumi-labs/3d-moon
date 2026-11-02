import { Vector3 } from 'three'

/** Suppress the eclipse haze only when the visible lunar disc is almost completely unlit. */
export function moonGlareScale(cameraPosition: Vector3, sunDirection: Vector3): number {
  const illumination = cameraPosition.clone().normalize().dot(sunDirection.clone().normalize())
  // This gates the shared scene bloom pyramid, so keep it at full strength for every ordinary
  // lunar phase. Fade only across the final 1% of visible illumination around new Moon.
  const litFraction = (1 + illumination) * 0.5
  const t = Math.max(0, Math.min(1, litFraction / 0.01))
  return t * t * (3 - 2 * t)
}
