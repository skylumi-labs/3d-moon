import type { PatchLevel } from './PatchLayer'

/** The global colour picture's texel, metres (tiles/manifest.json): what the coarsest patch level fades into. */
export const GLOBAL_TEXEL_M = 399
/** The outermost patch level fades into the global picture over this many of the GLOBAL picture's texels (a fixed 400 m left a hard edge: 8 m against 399 m). */
export const OUTER_FADE_GLOBAL_TEXELS = 4
/**
 * Metres over which a level fades out toward its rectangle's edge, by its texel: the outermost photograph level (4 to 30 m, next to the
 * global picture) over four global texels, 1.6 km, so the step in sharpness is spread over several of the coarse picture's own pixels;
 * 800 m for 2 m, 300 m for 0.6 m to 1.5 m, 150 m below. The finer levels share their outer edge with the coarser ones (Apollo 11's 2 m and 8 m strips end on one line), where the coarser level is itself fading, so their ramp has to be long enough to read as a ramp.
 */
export function fadeFor(texelM: number): number {
  return texelM >= 30 ? Math.max(400, texelM * 16) : texelM >= 4 ? OUTER_FADE_GLOBAL_TEXELS * GLOBAL_TEXEL_M : texelM >= 1.9 ? 800 : texelM >= 0.5 ? 300 : 150
}

/** The matrix (a.x, a.y, a.z, a.w) the shader turns metres east/north of the level's corner into (column, row) with. */
export function levelMatrix(l: PatchLevel): [number, number, number, number] {
  if (l.axisEastPerTexelM && l.axisSouthPerTexelM) {
    const [a, c] = l.axisEastPerTexelM, [b, d] = l.axisSouthPerTexelM
    const det = a * d - b * c
    return [d / det, -b / det, -c / det, a / det]
  }
  return [1 / l.texelEastM, 0, 0, -1 / l.texelNorthM]
}

const smooth01 = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** CPU twin of the patch imagery edge and footprint weight at one surface point. */
export function patchEdgeWeightAt(l: PatchLevel, eastM: number, northM: number): number {
  const [a, b, c, d] = levelMatrix(l)
  const de = eastM - l.eastM, dn = northM - l.northM
  const qx = a * de + b * dn, qy = c * de + d * dn
  if (qx < 0 || qy < 0 || qx >= l.w || qy >= l.h) return 0
  const edgeM = Math.min(qx, l.w - qx) * l.texelEastM
  const edgeN = Math.min(qy, l.h - qy) * l.texelNorthM
  const t = Math.max(0, Math.min(1, Math.min(edgeM, edgeN) / Math.max(1e-6, fadeFor(l.texelM))))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export function patchDetailWeightAt(l: PatchLevel, eastM: number, northM: number, fpM: number, resident: boolean): number {
  if (!resident || !l.detail) return 0
  return patchEdgeWeightAt(l, eastM, northM) * (1 - smooth01(8, 32, fpM / l.texelM))
}

export function patchHeightWeightAt(l: PatchLevel, eastM: number, northM: number, fpM: number, resident: boolean, shade = true): number {
  if (!resident || !l.heights || !shade) return 0
  return patchEdgeWeightAt(l, eastM, northM) * (1 - smooth01(1, 3, fpM / l.texelM))
}
