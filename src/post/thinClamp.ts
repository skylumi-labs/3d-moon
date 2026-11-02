/**
 * A10: the thin-feature clamp of the tone-map pass (final.ts). On a coarse motion grid a lit crest one render texel thin is drawn 4-8 canvas px high, a
 * dashed line of bright specks on dark ground that a rest frame draws at 1 px and far dimmer. The clamp pulls such a texel towards its neighbours.
 */

/** Where the clamp starts to act: canvas px per render texel (1.5 like the anti-sparkle kernel: a scale-1 frame under a larger rest canvas stays clear) and full strength. */
export const THIN_MAG_START = 1.5
export const THIN_MAG_FULL = 2
/** Brightness ratio (texel over the brighter neighbour across the dimmer axis) where the clamp starts; smaller values would hit ordinary texture. */
export const THIN_RATIO_DEFAULT = 1.8
export const THIN_RATIO_MIN = 1.05

/** 0 at and below THIN_MAG_START, 1 from THIN_MAG_FULL; 0 for a bad value. */
export function thinStrength(magnification: number): number {
  if (!Number.isFinite(magnification)) return 0
  return Math.min(1, Math.max(0, (magnification - THIN_MAG_START) / (THIN_MAG_FULL - THIN_MAG_START)))
}

export interface ThinSwitches { on: boolean; wide: boolean; ratio: number; peaks: boolean }

/** `?a10peak=0` also clamps isolated lit peaks (the pre-fix behaviour); `?a10thin=0` off, `=2` also two-texel-thin features; `?a10ratio=` the start ratio (>= THIN_RATIO_MIN, else the default). */
export function thinSwitches(search: string): ThinSwitches {
  const q = new URLSearchParams(search)
  const mode = q.get('a10thin')
  const r = Number(q.get('a10ratio'))
  return { on: mode !== '0', wide: mode === '2', ratio: Number.isFinite(r) && r >= THIN_RATIO_MIN ? r : THIN_RATIO_DEFAULT, peaks: q.get('a10peak') !== '0' }
}

/** The luminance a clamped texel is pulled to: the neighbours' plus the excess over them shared out over the magnification (`keep` 0 pulls to the neighbours). */
export function thinTarget(yc: number, lim: number, magnification: number, keep: number): number {
  if (!(yc > lim)) return yc
  const k = Math.min(1, Math.max(0, keep))
  return lim + (yc - lim) * k / Math.max(1, magnification)
}

/** Ring-brightness ratio (brightest texel 2-3 away, over the texel) below which a texel counts as wholly isolated; above the upper bound it has company (a dash of a line). */
export const ISOLATED_LO = 0.25
export const ISOLATED_HI = 0.5

/**
 * 0..1: how much a bright texel is a lone peak rather than one dash of a dashed crest line. The stray specks A10 removes are dashes: a texel 2-3 away along the
 * line is lit too. A real lit peak past the terminator stands alone in every direction, and clamping it dims it for as long as the camera moves.
 */
export function thinIsolation(yc: number, ringMax: number): number {
  if (!(yc > 0) || !Number.isFinite(ringMax)) return 0
  const r = Math.max(0, ringMax) / yc
  const x = Math.min(1, Math.max(0, (r - ISOLATED_LO) / (ISOLATED_HI - ISOLATED_LO)))
  return 1 - x * x * (3 - 2 * x)
}

/** The clamp strength after the isolated-peak exemption (`peaks` false: unchanged). */
export function thinClampAmount(t: number, isolation: number, peaks: boolean): number {
  return peaks ? t * (1 - Math.min(1, Math.max(0, isolation))) : t
}
