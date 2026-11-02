/**
 * The star boost, 0..1: 0 is the physical sky, 1 the old lifted look; the default is 1.0 (0.6 until the owner's 2026-10-14 review: "make sure the stars are properly visible"). It is a look setting, not a measurement,
 * and every step of the slider is a continuous change of flux, never a switch.
 * Beside a sunlit Moon the boost alone still leaves a V5 star near 2e-4 of white (black): `sky/skyStars.ts` adds a display-space lift in the final pass on top of it,
 * measured against whatever flux gain the boost gives, so this slider changes the scene's star flux and the sky lift keeps the displayed result steady.
 */
/** Flux gain at full boost: about 4.8 magnitudes (the owner asked for twice the earlier 40x top end), so a fifth-magnitude star shows beside a sunlit Moon. */
export const STAR_BOOST_MAX_GAIN = 80
/** A boosted star levels off at this share of the frame's white (0.18 before: the extra gain was clipped away, stars stayed dim). */
export const STAR_BOOST_CAP_SHARE = 0.45
/** v2 (2026-10-14): the default moved 0.6 -> 1.0, and a value saved under the old key (the old default, or any slider position from before) must not pin the old look. Values set from now on are saved here and win. */
export const STAR_BOOST_KEY = 'moonsite.starBoost.v2'

/** The boost a visitor gets who never moved the slider. A saved value (even 0) wins. */
export const DEFAULT_STAR_BOOST = 1.0

export const clampBoost = (b: number): number => (Number.isFinite(b) ? Math.min(1, Math.max(0, b)) : 0)
/** Flux multiplier for a boost: exactly 1 at 0, geometric in between (equal slider steps are equal brightness steps). */
export const boostGain = (b: number): number => Math.pow(STAR_BOOST_MAX_GAIN, clampBoost(b))

export function loadBoost(search: string, storage: Pick<Storage, 'getItem'> | null): number {
  const q = new URLSearchParams(search).get('starboost')
  if (q !== null && q !== '') return clampBoost(Number(q))
  try { const v = storage?.getItem(STAR_BOOST_KEY); if (v) return clampBoost(Number(v)) } catch { /* private window: the default */ }
  return DEFAULT_STAR_BOOST
}
export function saveBoost(b: number, storage: Pick<Storage, 'setItem'> | null): void {
  try { storage?.setItem(STAR_BOOST_KEY, String(clampBoost(b))) } catch { /* nothing to keep it in */ }
}

/**
 * `?starlift=<0..1>`: a minimum for the exposure's starLift (post/exposure.ts), so the GPU rig can A/B whether stars may rise above the sky cap beside a lit Moon.
 * Absent or invalid: 0, which leaves the exposure byte-identical to before. A rig switch, not a setting.
 */
export function loadStarLiftFloor(search: string): number {
  const q = new URLSearchParams(search).get('starlift')
  if (q === null || q === '') return 0
  return clampBoost(Number(q))
}
