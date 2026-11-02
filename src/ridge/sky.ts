/**
 * The ridge view's air, in numbers the exposure needs (the same model RidgePass draws): Kasten-Young airmass, Rayleigh plus
 * aerosol optical depth per channel (moon-v1's values for 1500 m), Bennett's refraction, and the twilight sky's level.
 */

const DEG = Math.PI / 180

/** Kasten-Young (1989) relative airmass for a true altitude in deg. */
export function airmass(h: number): number {
  const hh = Math.max(h, -0.5)
  return 1 / (Math.sin(hh * DEG) + 0.50572 * Math.pow(hh + 6.07995, -1.6364))
}
/** Bennett (1982) refraction, arcmin, for an apparent altitude in deg. */
export function refractionArcmin(h: number): number {
  return 1 / Math.tan((h + 7.31 / (h + 4.4)) * DEG)
}
export const TAU_RAYLEIGH = [0.045, 0.080, 0.150] as const
export const TAU_AEROSOL = [0.040, 0.050, 0.060] as const

/** The air's transmission along a ray at true altitude `alt`, per channel, for `air` of the column above and aerosol scale `haze`. */
export function transmission(alt: number, air: number, haze = 1): [number, number, number] {
  const X = airmass(alt)
  return [0, 1, 2].map((c) => Math.exp(-(TAU_RAYLEIGH[c] + TAU_AEROSOL[c] * haze) * air * X)) as [number, number, number]
}

/** Zenith luminance of the twilight sky against the Sun's altitude (log10 cd m^-2, moon-v1's table). */
export function logZenith(h: number): number {
  if (h >= 0) return 3
  if (h > -3) return 3 + (1.6 - 3) * (-h / 3)
  if (h > -6) return 1.6 + (0.3 - 1.6) * ((-h - 3) / 3)
  if (h > -9) return 0.3 + (-1.2 - 0.3) * ((-h - 6) / 3)
  if (h > -12) return -1.2 + (-2.5 + 1.2) * ((-h - 9) / 3)
  if (h > -15) return -2.5 + (-3.3 + 2.5) * ((-h - 12) / 3)
  if (h > -18) return -3.3 + (-3.55 + 3.3) * ((-h - 15) / 3)
  return -3.55
}

/** The sky's level beside the Moon, I/F (luminance over 40,400 cd m^-2), brighter toward the horizon. */
export function skyLevelIF(sunAlt: number, moonAlt: number): number {
  return Math.pow(10, logZenith(sunAlt)) / 40400 * (1 + 2.2 * Math.exp(-Math.max(moonAlt, 0) / 9))
}
