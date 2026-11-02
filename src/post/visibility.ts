/** A display look, independent of physical radiance, exposure, and Earthshine. */
export interface VisibilityCalibration {
  id: string
  bundleSha256: string
  baselineEarthshineSha256: string
  /** Encoded sRGB grey in 0..1, calibrated from native lossless frames. */
  mariaGrey: number
  highlandGrey: number
  skyGrey: number
  minContrastGrey: number
  minDetailGrey: number
  /** This accepted baseline's darkest eligible pixel must already exceed the envelope. */
  earthshineMinimumGrey: number
}
export function validateCalibration(p: VisibilityCalibration): void {
  if (!p.id || !/^[a-f0-9]{64}$/.test(p.bundleSha256) || !/^[a-f0-9]{64}$/.test(p.baselineEarthshineSha256))
    throw new Error('Visibility calibration requires exact lossless candidate/baseline identity')
  for (const v of [p.mariaGrey, p.highlandGrey, p.skyGrey, p.minContrastGrey, p.minDetailGrey, p.earthshineMinimumGrey])
    if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error('Invalid encoded-grey calibration')
  if (p.mariaGrey <= p.skyGrey + p.minContrastGrey || p.highlandGrey < p.mariaGrey + p.minDetailGrey
    || p.highlandGrey > p.earthshineMinimumGrey)
    throw new Error('Visibility envelope conflicts with contrast/detail or accepted Earthshine baseline')
}
export function visibilityGrey(template: number, p: VisibilityCalibration): number {
  const k = Math.max(0, Math.min(1, (template - 0.35) / 0.65))
  return p.mariaGrey + (p.highlandGrey - p.mariaGrey) * k
}
/** Final displayed-output lower envelope. Baseline pixels at/above the bound are bit-identical. */
export function applyVisibilityGrey(baseline: number, coverage: number, night: number, template: number,
  p: VisibilityCalibration | null): number {
  if (!p || coverage <= 0 || night <= 0) return baseline
  return Math.max(baseline, visibilityGrey(template, p) * Math.max(0, Math.min(1, coverage)) * Math.max(0, Math.min(1, night)))
}
/** Matches the final shader's premultiplied metadata contract, including every partial limb pixel. */
export function applyVisibilityMetadataGrey(baseline: number, coverage: number, nightCoverage: number,
  templateCoverage: number, p: VisibilityCalibration | null): number {
  if (!p || coverage <= 0 || nightCoverage <= 0) return baseline
  return Math.max(baseline, visibilityGrey(templateCoverage / Math.max(coverage, 1e-6), p) * nightCoverage)
}
export const VISIBILITY_GLSL = /* glsl */ `
float visibilityGrey(float templateValue, vec2 levels) {
  return mix(levels.x, levels.y, clamp((templateValue - 0.35) / 0.65, 0.0, 1.0));
}
vec3 applyVisibility(vec3 baseline, vec4 meta, vec2 levels, float enabled) {
  if (enabled < 0.5 || meta.r <= 0.0 || meta.g <= 0.0) return baseline;
  float target = visibilityGrey(meta.b / max(meta.r, 1e-6), levels) * meta.g;
  return max(baseline, vec3(target));
}
`
