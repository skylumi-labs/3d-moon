/**
 * The Earth's atmosphere as one model shared by the Earth pass (scattering
 * and transmittance), the refracted ring seen from the Moon during a lunar
 * eclipse, and the umbra table in src/eclipse/ (built from it by
 * scripts/build-umbra-table.mjs). Pure TypeScript with no imports, so Node
 * can load it directly.
 *
 * It is a MODEL: a standard clear atmosphere (US Standard Atmosphere 1976
 * density, 300 DU of ozone, a background aerosol load) plus one tuned
 * parameter, the cloud screen that blocks low grazing rays (see
 * CLOUD_SCREEN). It is not the atmosphere of any particular day.
 *
 * Units: km. Colour: linear sRGB, each channel represented by one
 * wavelength, the dominant wavelength of its primary (612, 549 and 465 nm).
 * Three samples of a spectrum are an approximation; they make the Rayleigh
 * sky slightly less deep a blue than a spectral model would.
 */

export type RGB = [number, number, number]

export const R_EARTH_KM = 6371.0
/** The modelled atmosphere ends here. Above it nothing is scattered or bent. */
export const ATMOSPHERE_TOP_KM = 60
export const LAMBDA_NM: RGB = [612, 549, 465]

// ------------------------------------------------------------------ density

// US Standard Atmosphere 1976: altitude (km) and density (kg/m^3).
const USSA_Z = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 26, 28, 30, 32, 35, 40, 45, 50, 55, 60, 70, 80, 90]
const USSA_RHO = [1.225, 1.1117, 1.0066, 0.90925, 0.81935, 0.73643, 0.66011, 0.59002, 0.52579, 0.46706, 0.41351, 0.3648, 0.31194, 0.2666, 0.22786, 0.19476, 0.16647, 0.1423, 0.12165, 0.104, 0.08891, 0.06451, 0.046938, 0.034257, 0.025076, 0.01841, 0.013555, 0.0084634, 0.0039957, 0.0019663, 0.0010269, 0.0005681, 0.00030968, 0.000082829, 0.000018458, 0.00000342]
const USSA_LN = USSA_RHO.map((r) => Math.log(r / USSA_RHO[0]))

/** Air density relative to sea level (log-linear in the USSA 1976 table). */
export function airDensity(hKm: number): number {
  if (hKm <= 0) return Math.exp(USSA_LN[0] - hKm / 9.2)
  const n = USSA_Z.length
  if (hKm >= USSA_Z[n - 1]) return Math.exp(USSA_LN[n - 1] - (hKm - USSA_Z[n - 1]) / 6)
  let i = 0
  while (USSA_Z[i + 1] < hKm) i++
  const t = (hKm - USSA_Z[i]) / (USSA_Z[i + 1] - USSA_Z[i])
  return Math.exp(USSA_LN[i] + t * (USSA_LN[i + 1] - USSA_LN[i]))
}

/** d(ln density)/dh, per km. */
export function airDensityLogSlope(hKm: number): number {
  if (hKm <= 0) return -1 / 9.2
  const n = USSA_Z.length
  if (hKm >= USSA_Z[n - 1]) return -1 / 6
  let i = 0
  while (USSA_Z[i + 1] < hKm) i++
  return (USSA_LN[i + 1] - USSA_LN[i]) / (USSA_Z[i + 1] - USSA_Z[i])
}

/** Vertical column of air in km of sea-level air (p0 / (g rho0) = 8.43 km). */
export const AIR_COLUMN_KM = 101325 / (9.80665 * 1.225) / 1000

// ------------------------------------------------------------------ species

/**
 * Rayleigh optical depth of the whole atmosphere, vertical, at sea level
 * (Hansen & Travis 1974, Space Sci. Rev. 16, 527, their eq. 2.29).
 */
export function rayleighTau(lambdaNm: number): number {
  const l = lambdaNm / 1000
  return 0.008569 * l ** -4 * (1 + 0.0113 * l ** -2 + 0.00013 * l ** -4)
}
export const TAU_RAYLEIGH = LAMBDA_NM.map(rayleighTau) as RGB

/**
 * Ozone: 300 Dobson units (8.07e18 molecules/cm^2), a Gaussian layer at
 * 22 km with a 7.5 km standard deviation. Chappuis-band cross-sections
 * averaged roughly over each sRGB primary's response (cm^2/molecule): the
 * band peaks near 600 nm, where the red primary's response also peaks, and
 * is almost transparent in the blue. Approximate values.
 */
export const OZONE_DU = 300
export const OZONE_SIGMA_CM2: RGB = [4.0e-21, 2.8e-21, 0.3e-21]
export const OZONE_PEAK_KM = 22
export const OZONE_WIDTH_KM = 7.5
export const TAU_OZONE = OZONE_SIGMA_CM2.map((s) => s * OZONE_DU * 2.687e16) as RGB
function ozoneProfile(hKm: number): number {
  // Normalised to unit area over h >= 0 (the Gaussian's tail below 0 is 0.2%).
  const x = (hKm - OZONE_PEAK_KM) / OZONE_WIDTH_KM
  return Math.exp(-0.5 * x * x) / (OZONE_WIDTH_KM * Math.sqrt(2 * Math.PI))
}

/**
 * Aerosol, three layers. Boundary layer: optical depth 0.07 at 550 nm,
 * scale height 1.2 km. Free troposphere: 0.07 at 550 nm, scale height 5 km,
 * which puts ~1.5e-3 /km at 11 km, the order of the extinction lunar
 * eclipse photometry retrieves at that height (Ugolnikov et al. 2011,
 * arXiv:1106.6178, their Fig. 3). Together 0.14, near the MODIS global mean
 * (0.12-0.15). Both: Angstrom exponent 1.3, single-scattering albedo 0.93,
 * Henyey-Greenstein asymmetry 0.7. Stratospheric background (volcanically
 * quiet): 0.005 at 550 nm, Gaussian at 20 km, sigma 5 km, non-absorbing.
 */
export const AEROSOL = { tau550: 0.07, angstrom: 1.3, scaleKm: 1.2, ssa: 0.93, g: 0.7 }
export const FREE_TROP_AEROSOL = { tau550: 0.03, scaleKm: 5 }
export const STRAT_AEROSOL = { tau550: 0.005, angstrom: 1.0, peakKm: 20, widthKm: 5 }
export const TAU_AEROSOL = LAMBDA_NM.map((l) => AEROSOL.tau550 * (l / 550) ** -AEROSOL.angstrom) as RGB
export const TAU_FREE_TROP = LAMBDA_NM.map((l) => FREE_TROP_AEROSOL.tau550 * (l / 550) ** -AEROSOL.angstrom) as RGB
export const TAU_STRAT = LAMBDA_NM.map((l) => STRAT_AEROSOL.tau550 * (l / 550) ** -STRAT_AEROSOL.angstrom) as RGB
function stratProfile(hKm: number): number {
  const x = (hKm - STRAT_AEROSOL.peakKm) / STRAT_AEROSOL.widthKm
  return Math.exp(-0.5 * x * x) / (STRAT_AEROSOL.widthKm * Math.sqrt(2 * Math.PI))
}

/**
 * Extinction per km at altitude h, per channel, split into scattering by
 * molecules, scattering by aerosol, and absorption (ozone and aerosol).
 */
export function extinction(hKm: number): { ray: RGB; mie: RGB; abs: RGB } {
  const air = airDensity(hKm) / AIR_COLUMN_KM
  const hp = Math.max(hKm, 0)
  const aer = Math.exp(-hp / AEROSOL.scaleKm) / AEROSOL.scaleKm
  const ft = Math.exp(-hp / FREE_TROP_AEROSOL.scaleKm) / FREE_TROP_AEROSOL.scaleKm
  const oz = ozoneProfile(hKm)
  const st = stratProfile(hKm)
  const ray: RGB = [0, 0, 0], mie: RGB = [0, 0, 0], abs: RGB = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    ray[c] = TAU_RAYLEIGH[c] * air
    const trop = TAU_AEROSOL[c] * aer + TAU_FREE_TROP[c] * ft
    mie[c] = trop * AEROSOL.ssa + TAU_STRAT[c] * st
    abs[c] = TAU_OZONE[c] * oz + trop * (1 - AEROSOL.ssa)
  }
  return { ray, mie, abs }
}

// ------------------------------------------------------------ refraction

/**
 * Refractivity (n - 1) of standard air (15 C, 101325 Pa, density 1.225
 * kg/m^3) after Edlen (1966, Metrologia 2, 71); it scales with density.
 */
export function refractivitySeaLevel(lambdaNm: number): number {
  const s2 = (1000 / lambdaNm) ** 2
  return (8342.13 + 2406030 / (130 - s2) + 15997 / (38.9 - s2)) * 1e-8
}
export const REFRACTIVITY_0 = LAMBDA_NM.map(refractivitySeaLevel) as RGB

/**
 * Total bending of a ray that grazes the Earth with its lowest point at
 * altitude hTan (km), through the whole atmosphere and out again, radians,
 * for sea-level refractivity n0m1. Exact for a spherically symmetric
 * atmosphere (Bouguer's invariant n r sin z = b):
 *   alpha(b) = -2 b Int_{r_t}^inf (dn/dr) / (n sqrt(n^2 r^2 - b^2)) dr,
 * integrated in x = n r with x - b = w^2, which removes the square-root
 * singularity at the tangent point.
 */
export function bendingAngle(hTanKm: number, n0m1: number, steps = 400): number {
  const R = R_EARTH_KM
  const n = (h: number) => 1 + n0m1 * airDensity(h)
  const dndr = (h: number) => n0m1 * airDensity(h) * airDensityLogSlope(h)
  const rt = R + hTanKm
  const b = n(hTanKm) * rt
  const wMax = Math.sqrt((R + 120) * n(120) - b)
  let sum = 0
  for (let i = 0; i < steps; i++) {
    // midpoint rule in w; the integrand is smooth in w
    const w = ((i + 0.5) / steps) * wMax
    const x = b + w * w
    // r from x = n(r) r (n - 1 < 3e-4: two fixed-point steps suffice)
    let r = x
    for (let k = 0; k < 3; k++) r = x / n(r - R)
    const h = r - R
    const nn = n(h), dn = dndr(h)
    // dx/dr = n + r dn/dr ; dx = 2 w dw ; sqrt(x^2 - b^2) = w sqrt(2b + w^2)
    const integrand = (dn / nn) / (nn + r * dn) * 2 / Math.sqrt(2 * b + w * w)
    sum += integrand
  }
  return -2 * b * sum * (wMax / steps)
}

/**
 * Column of each species along a straight grazing line whose lowest point
 * is at hTan, both halves, as an optical depth per channel. The curvature
 * of the real (refracted) path is ignored: it dips the ray by ~1 km over
 * the densest few hundred km, a few per cent of the column.
 */
export function grazingOpticalDepth(hTanKm: number, steps = 300): { ray: RGB; mie: RGB; abs: RGB } {
  const R = R_EARTH_KM
  const rt = R + hTanKm
  const hMax = 100
  const wMax = Math.sqrt(Math.max(hMax - hTanKm, 0))
  const out = { ray: [0, 0, 0] as RGB, mie: [0, 0, 0] as RGB, abs: [0, 0, 0] as RGB }
  for (let i = 0; i < steps; i++) {
    const w = ((i + 0.5) / steps) * wMax
    const y = w * w // altitude above the tangent point
    // ds = 2 (rt + y) dw / sqrt(2 rt + y)
    const ds = (2 * (rt + y)) / Math.sqrt(2 * rt + y) * (wMax / steps)
    const e = extinction(hTanKm + y)
    for (let c = 0; c < 3; c++) {
      out.ray[c] += 2 * e.ray[c] * ds
      out.mie[c] += 2 * e.mie[c] * ds
      out.abs[c] += 2 * e.abs[c] * ds
    }
  }
  return out
}

// ------------------------------------------------------------ cloud screen

/**
 * The fraction of grazing lines of sight at tangent altitude h that clouds,
 * terrain and unresolved haze leave open. Nothing in the clear-sky model
 * above stops a ray at 2 km from crossing 800 km of lower troposphere; in
 * the real atmosphere most such rays meet a cloud. Where the air is clear
 * the screen sits at the boundary layer (clearKm); it rises with the cloud
 * cover c of the map (clouds.jpg) by perCoverKm per unit of cover, a
 * logistic edge widthKm wide. The umbra table averages it over the map's
 * distribution of cover; the ring seen from the Moon uses the cover at each
 * point of the limb, so clear stretches of the terminator shine through as
 * beads.
 *
 * perCoverKm is the one tuned parameter of the whole atmosphere model: it
 * is set (by scripts/build-umbra-table.mjs) so that the Moon, centred half
 * way between the umbra's axis and its edge, comes out 10 magnitudes (1e-4)
 * fainter than the full Moon, a Danjon L = 2-3 eclipse (see
 * src/eclipse/index.ts for the measurements behind that number). Real
 * eclipses range from ~1e-3 (L = 4) to ~1e-6 (L = 0, after large
 * eruptions): this is one state of the atmosphere, not a forecast.
 */
export const CLOUD_SCREEN = { clearKm: 2.5, perCoverKm: 11.2, widthKm: 1.0 }
export function cloudScreenOpen(hKm: number, cover: number, perCoverKm = CLOUD_SCREEN.perCoverKm): number {
  const hs = CLOUD_SCREEN.clearKm + perCoverKm * cover
  return 1 / (1 + Math.exp(-(hKm - hs) / CLOUD_SCREEN.widthKm))
}

// ------------------------------------------------------------ LUTs for the pass

/**
 * Transmittance from a point at radius r toward direction mu (cosine from
 * the local vertical) to the top of the atmosphere, stored as optical depth
 * (R, G, B, and the aerosol-only part in A is not needed: A = 1) in
 * Bruneton's (2017, "Precomputed Atmospheric Scattering: a New
 * Implementation") parametrisation, which spends texels uniformly in the
 * distance to the top and covers only rays that do not hit the ground.
 * Courtesy credit (BSD-3-Clause): public/THIRD-PARTY-NOTICES.txt.
 */
export const TRANSMITTANCE_W = 128
export const TRANSMITTANCE_H = 32
export function buildTransmittanceLut(steps = 64): Float32Array {
  const R = R_EARTH_KM, top = R + ATMOSPHERE_TOP_KM
  const H = Math.sqrt(top * top - R * R)
  const out = new Float32Array(TRANSMITTANCE_W * TRANSMITTANCE_H * 4)
  const fromUnit = (u: number, n: number) => (u - 0.5 / n) / (1 - 1 / n)
  for (let j = 0; j < TRANSMITTANCE_H; j++) {
    const xr = fromUnit((j + 0.5) / TRANSMITTANCE_H, TRANSMITTANCE_H)
    const rho = H * xr
    const r = Math.sqrt(rho * rho + R * R)
    for (let i = 0; i < TRANSMITTANCE_W; i++) {
      const xmu = fromUnit((i + 0.5) / TRANSMITTANCE_W, TRANSMITTANCE_W)
      const dMin = top - r, dMax = rho + H
      const d = dMin + xmu * (dMax - dMin)
      const mu = d === 0 ? 1 : Math.max(-1, Math.min(1, (H * H - rho * rho - d * d) / (2 * r * d)))
      const tau = [0, 0, 0]
      for (let k = 0; k < steps; k++) {
        const s = ((k + 0.5) / steps) * d
        const h = Math.sqrt(r * r + s * s + 2 * r * mu * s) - R
        const e = extinction(h)
        for (let c = 0; c < 3; c++) tau[c] += (e.ray[c] + e.mie[c] + e.abs[c]) * (d / steps)
      }
      const o = (j * TRANSMITTANCE_W + i) * 4
      out[o] = tau[0]; out[o + 1] = tau[1]; out[o + 2] = tau[2]; out[o + 3] = 1
    }
  }
  return out
}

/**
 * For the refracted ring: per tangent altitude h in [0, ATMOSPHERE_TOP_KM]
 * (uniform in sqrt(h / top), so the dense lowest kilometres get most
 * texels), RGB = grazing optical depth through the whole atmosphere
 * (clear sky, no cloud screen), A = bending angle at 549 nm, radians.
 */
export const GRAZING_N = 256
export function buildGrazingLut(): Float32Array {
  const out = new Float32Array(GRAZING_N * 4)
  for (let i = 0; i < GRAZING_N; i++) {
    const x = i / (GRAZING_N - 1)
    const h = x * x * ATMOSPHERE_TOP_KM
    const g = grazingOpticalDepth(h, 200)
    for (let c = 0; c < 3; c++) out[i * 4 + c] = g.ray[c] + g.mie[c] + g.abs[c]
    out[i * 4 + 3] = bendingAngle(h, REFRACTIVITY_0[1], 200)
  }
  return out
}
