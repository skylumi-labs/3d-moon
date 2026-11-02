/**
 * Ablation switches for the smoothness matrix: `?abl=a,b,c`. Debug and measurement only: each
 * one removes a cost so the rig can say what it is. A page without `abl` is unchanged.
 *
 *   shadow0    no shadow march          shadow1  one sample at rest quality (no sub-pixel four)     noviewhz  no viewer-horizon march
 *   glare0     no glare chain           glare3   glare pyramid of 3 levels                          expfreeze reuse the last exposure search in a gesture
 *   dom0       no HUD / labels / pins / routes per frame                                            tilefreeze no tile streaming during a gesture
 *   norefine   no mid step and no crossfade on release                                              nomotion  rest shader on moving frames
 *   probe1     ground height cache of one point (the pre-#65 behaviour) instead of eight
 */
// A shared link must not be able to switch shadows or the HUD off: `abl` is honoured only together with `ablok=1`, which the ablation variants add.
const q = typeof location === 'undefined' ? null : new URLSearchParams(location.search)
const raw = q && q.get('ablok') === '1' ? q.get('abl') ?? '' : ''
export const ABL: ReadonlySet<string> = new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))

/**
 * `?ablate=shadows,viewhz,glare,detail,coverage,shading` (DEV builds only, the rig's incremental-cost switch).
 * Each name removes exactly one piece of the frame, camera and geometry unchanged, so `__moon.perf.passes` (per-pass GPU ms) differences give that piece's cost:
 *   shadows  no Sun-visibility march (as abl=shadow0)      viewhz   no viewer-horizon visibility march     glare    no glare chain
 *   detail   no tile-detail layers in the Moon program     coverage no terrain/coverage tile march (the 4k map alone)
 *   shading  the Moon's lighting replaced by albedo x lit (no phase function, fill, Earth shadow, earthshine)
 * Nothing is read in a production build or without the switch, and the shader text is then byte-identical to the one without this feature.
 */
export const ABLATE_NAMES = ['shadows', 'viewhz', 'glare', 'detail', 'coverage', 'shading'] as const
export type AblateName = (typeof ABLATE_NAMES)[number]
export function parseAblate(search: string, dev: boolean): ReadonlySet<AblateName> {
  if (!dev) return new Set()
  const raw = new URLSearchParams(search).get('ablate') ?? ''
  return new Set(raw.split(',').map((x) => x.trim()).filter((x): x is AblateName => (ABLATE_NAMES as readonly string[]).includes(x)))
}
export const ABLATE: ReadonlySet<AblateName> = parseAblate(typeof location === 'undefined' ? '' : location.search, !!import.meta.env?.DEV)

/** Glare levels to run (7 = all, 0 = none). */
export const ABL_GLARE_LEVELS = ABL.has('glare0') || ABLATE.has('glare') ? 0 : ABL.has('glare3') ? 3 : 7
