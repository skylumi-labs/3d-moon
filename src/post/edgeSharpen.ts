/**
 * Return the half-width of the display-space transition, in normalized
 * luminance units. A low-resolution texel spans 1 / grid output pixels, so a
 * transition of 2k texels is capped at restPx output pixels.
 */
export function edgeK(grid: number, restPx: number, canvasPxPerTexel = 1 / grid): number {
  if (!Number.isFinite(grid) || grid <= 0 || !Number.isFinite(restPx) || restPx <= 0
    || !Number.isFinite(canvasPxPerTexel) || canvasPxPerTexel <= 0) return 0.5
  return Math.min(0.5, restPx / (2 * canvasPxPerTexel))
}

/** GLSL-mirrored smoothstep steepening; k=0.5 is plain bilinear identity. */
export function steepen(t: number, k: number): number {
  const value = Math.min(1, Math.max(0, t))
  if (!Number.isFinite(k) || k >= 0.5) return value
  if (k <= 0) return value < 0.5 ? 0 : 1
  const lo = 0.5 - Math.max(0, k)
  const hi = 0.5 + Math.max(0, k)
  const x = Math.min(1, Math.max(0, (value - lo) / (hi - lo)))
  return x * x * (3 - 2 * x)
}
