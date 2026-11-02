import { H_PX, H_SIZE, levelDeg } from './grid'

/** Polar equirectangular texels shrink east-west. A dense, row-wise low-pass
 * avoids the comb response of widely separated taps. This is a rendering
 * estimate, not new terrain detail. Bounded support keeps decode cost O(N²).
 * Shared border texels remain unchanged; support tapers inside each tile. */
export const POLAR_FILTER_START = 85
export const POLAR_FILTER_FULL = 88.5
export const POLAR_FILTER_MAX_RADIUS = 64
export function polarWeight(lat: number): number {
  const t = Math.max(0, Math.min(1, (Math.abs(lat) - POLAR_FILTER_START) / (POLAR_FILTER_FULL - POLAR_FILTER_START)))
  return t * t * (3 - 2 * t)
}
export function polarPrefilter(heights: Float32Array, level: number, ty: number): Float32Array {
  const n = H_SIZE, deg = levelDeg(level)
  let out: Float32Array | null = null
  const sums = new Float64Array(n + 1)
  for (let y = 0; y < n; y++) {
    const lat = 90 - ty * deg - (y - .5) * deg / H_PX
    const weight = polarWeight(lat)
    if (weight === 0) continue
    out ??= new Float32Array(heights)
    const offset = y * n
    sums[0] = 0
    for (let x = 0; x < n; x++) sums[x + 1] = sums[x] + heights[offset + x]
    const desired = Math.min(POLAR_FILTER_MAX_RADIUS, 0.5 / Math.max(Math.cos(lat * Math.PI / 180), 1e-3))
    // Integral of the piecewise-constant samples permits a continuous radius;
    // rounded radii would introduce latitude bands when the window changes.
    const integral = (p: number): number => {
      const i = Math.min(n - 1, Math.floor(p))
      return sums[i] + (p - i) * heights[offset + i]
    }
    for (let x = 2; x < n - 2; x++) {
      const radius = Math.min(desired, x - 1, n - 2 - x)
      const mean = (integral(x + radius + 1) - integral(x - radius)) / (2 * radius + 1)
      out[offset + x] = heights[offset + x] + weight * (mean - heights[offset + x])
    }
  }
  return out ?? heights
}
