/** Relative elevation colour ramp, in sRGB hex for the legend and in linear RGB for the shader. */
export const ELEVATION_RAMP = [
  { at: 0, hex: '#2455e8' },
  { at: 0.25, hex: '#00cce8' },
  { at: 0.5, hex: '#ffe45c' },
  { at: 0.75, hex: '#ff713d' },
  { at: 1, hex: '#e941a5' },
] as const

export function rangeMetersForAltitude(altitudeKm: number): number {
  if (!Number.isFinite(altitudeKm)) return 250
  return Math.max(25, Math.min(18_000, 55 * Math.sqrt(Math.max(0.2, altitudeKm))))
}

export function elevationRangeLabels(rangeM: number): readonly [string, string] {
  const safe = Number.isFinite(rangeM) ? Math.max(1, rangeM) : 250
  const label = Math.round(safe).toLocaleString('en')
  return [`−${label} m`, `+${label} m`]
}

export function relativeElevationFraction(heightM: number, referenceM: number, rangeM: number): number {
  if (![heightM, referenceM, rangeM].every(Number.isFinite)) return 0.5
  return 0.5 + 0.5 * Math.max(-1, Math.min(1, (heightM - referenceM) / Math.max(1, rangeM)))
}

function linearChannel(hex: string, offset: number): number {
  const c = parseInt(hex.slice(offset, offset + 2), 16) / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

const linearRamp = ELEVATION_RAMP.map(({ at, hex }) => ({ at, rgb: [linearChannel(hex, 1), linearChannel(hex, 3), linearChannel(hex, 5)] }))

/** GLSL ramp interpolation. Kept here so its stop colours match the UI legend exactly. */
export function elevationRampGlsl(): string {
  const colors = linearRamp.map(({ rgb }) => `vec3(${rgb.map((v) => v.toFixed(6)).join(', ')})`)
  return `vec3 elevationColor(float t) {
  float x = clamp(t, 0.0, 0.999999) * 4.0;
  int i = min(int(floor(x)), 3);
  float f = smoothstep(0.0, 1.0, fract(x));
  if (i == 0) return mix(${colors[0]}, ${colors[1]}, f);
  if (i == 1) return mix(${colors[1]}, ${colors[2]}, f);
  if (i == 2) return mix(${colors[2]}, ${colors[3]}, f);
  return mix(${colors[3]}, ${colors[4]}, f);
}`
}
