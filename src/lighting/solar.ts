/**
 * The Sun's disc as the eclipse chunks see it. Pure TypeScript, no imports,
 * so scripts/build-umbra-table.mjs can load it too.
 */

/** Mean solar radius (IAU 2015 nominal), km. */
export const SUN_R_KM = 695700
export const AU_KM = 149597870.7

/**
 * Linear limb darkening I(r)/I(0) = 1 - u (1 - sqrt(1 - r^2)) per channel
 * (612, 549, 465 nm). u ~ 0.6 is the value usually quoted for the visible
 * Sun; it rises toward the blue. Approximate values, not a fit to a
 * particular measurement.
 */
export const SUN_LIMB_U: [number, number, number] = [0.56, 0.64, 0.75]

/**
 * The limb-darkened disc approximated by two concentric uniform discs, so a
 * covered fraction costs two circle-overlap areas: intensity A inside the
 * full radius plus C inside radius K. For each channel A is the mean of I
 * over the annulus K < r < 1 and A + C the mean inside K (which keeps the
 * total flux exact); K minimises the squared error of the profile over the
 * three channels (computed by fitTwoDiscs below).
 */
export function fitTwoDiscs(): { k: number; a: number[]; c: number[]; rmsErr: number } {
  const I = (u: number, r: number) => 1 - u * (1 - Math.sqrt(Math.max(0, 1 - r * r)))
  const mean = (u: number, r0: number, r1: number) => {
    let s = 0, w = 0
    const n = 400
    for (let i = 0; i < n; i++) {
      const r = r0 + ((i + 0.5) / n) * (r1 - r0)
      s += I(u, r) * r; w += r
    }
    return s / w
  }
  let best = { k: 0.7, a: [0, 0, 0], c: [0, 0, 0], rmsErr: Infinity }
  for (let k = 0.4; k <= 0.95; k += 0.005) {
    const a = SUN_LIMB_U.map((u) => mean(u, k, 1))
    const c = SUN_LIMB_U.map((u, i) => mean(u, 0, k) - a[i])
    let e = 0, w = 0
    for (let ch = 0; ch < 3; ch++) {
      for (let i = 0; i < 400; i++) {
        const r = (i + 0.5) / 400
        const approx = a[ch] + (r < k ? c[ch] : 0)
        e += (I(SUN_LIMB_U[ch], r) - approx) ** 2 * r; w += r
      }
    }
    const rms = Math.sqrt(e / w)
    if (rms < best.rmsErr) best = { k, a, c, rmsErr: rms }
  }
  return best
}
