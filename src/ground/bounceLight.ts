/**
 * How the lunar module's ground bounce is lit. A desktop or web session keeps the PMREM environment
 * (a two-tone sphere, lit regolith below): the environment's cube-UV chain is a GPU allocation the phone ceiling cannot spare. A phone
 * class lights the same bounce with one ambient term instead: no environment, no chain.
 */

export type BounceLighting = 'pmrem' | 'ambient'

/** The phone classes (ios, phone-android) use the ambient term; every other class keeps the environment. */
export function bounceLighting(phone: boolean): BounceLighting {
  return phone ? 'ambient' : 'pmrem'
}

/**
 * The ambient intensity that stands in for the environment on a phone: the lit lower half of the bounce sphere at `groundRadiance`
 * (a lambert surface sees about half of it), times the same pre-exposure the environment is scaled by. An estimate, not a fit to the
 * PMREM render; the owner's device pass checks it against the environment look.
 */
export function ambientForBounce(groundRadiance: number, preExpose: number): number {
  return Math.max(0, groundRadiance) * 0.5 * Math.PI * Math.max(0, preExpose)
}

/**
 * The ambient light's intensity for a module: the bounce estimate only where the PMREM environment was dropped (the phone path). Everywhere else
 * the environment already carries the bounce, so the ambient is 0 (a non-zero value there would light the module twice).
 */
export function bounceAmbientIntensity(phone: boolean, groundRadiance: number, preExpose: number): number {
  return bounceLighting(phone) === 'ambient' ? ambientForBounce(groundRadiance, preExpose) : 0
}
