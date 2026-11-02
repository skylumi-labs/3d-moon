import type { MoonLabel } from './data'

/** Below this frame span (km across the short side) the Gazetteer's other names join as minor labels. */
export const GAZ_SPAN_KM = 800
/** A Gazetteer name appears once the feature is this share of the span across. */
export const GAZ_SHARE = 1 / 40
/** At most this many Gazetteer names are offered to the layout in one frame. */
export const GAZ_CAP = 160

/**
 * The Gazetteer names offered to the layout close up: those large enough for the zoom (a newcomer from GAZ_SHARE of the span,
 * one on screen kept to two thirds of that; lettered satellite craters only very close, and larger) whose point is in the
 * frame, largest first, at most GAZ_CAP. The frame test comes before the cap: a wide cone around the camera holds thousands
 * of features, and capping it by size first kept only big ones off screen (93 km over Tycho showed no names at all, 2026-10-18).
 */
export function pickGazetteer(near: readonly MoonLabel[], spanKm: number, o: {
  skip: (g: MoonLabel) => boolean
  shown: (id: string) => boolean
  inFrame: (g: MoonLabel) => boolean
}): MoonLabel[] {
  if (spanKm >= GAZ_SPAN_KM) return []
  const out: MoonLabel[] = []
  for (const g of near) {
    if (g.kind === 'site' || !g.sizeKm || o.skip(g)) continue
    // Lettered satellite craters (Eratosthenes D) are IAU names too; they join only in close views, and need to be larger.
    const satellite = g.featureType === 'Satellite Feature'
    if (satellite && spanKm > 450) continue
    const need = spanKm * GAZ_SHARE * (satellite ? 1.6 : 1)
    if (g.sizeKm < need * 0.66 || (g.sizeKm < need && !o.shown(g.id))) continue
    if (!o.inFrame(g)) continue
    out.push(g)
  }
  out.sort((a, b) => (b.sizeKm ?? 0) - (a.sizeKm ?? 0))
  return out.slice(0, GAZ_CAP)
}

/** A Gazetteer name may fill a short grid cell once the feature is this share of the span across. */
export const GAZ_CENTRE_SHARE = 1 / 20
/**
 * Above GAZ_SPAN_KM, picks the largest named feature in each short cell, each at least GAZ_CENTRE_SHARE of the span across
 * (a sea or a large crater, never a satellite crater), at most `cap`. Shown rows are prioritized at two thirds of the size
 * threshold and kept by the caller while on frame; fresh rows fill only cells that remain short.
 */
export function pickCentreGazetteer(near: readonly MoonLabel[], spanKm: number, cap: number, o: {
  skip: (g: MoonLabel) => boolean
  shown: (id: string) => boolean
  /** Cell id for a new row, or a grown-cell/on-frame id for a shown row. */
  cellOf?: (g: MoonLabel, shown: boolean) => string | null
  shortCells?: ReadonlySet<string>
  /** Legacy adapter for callers without a grid. */
  inCentre?: (g: MoonLabel) => boolean
}): MoonLabel[] {
  const kept: MoonLabel[] = [], fresh = new Map<string, MoonLabel>()
  const need = spanKm * GAZ_CENTRE_SHARE
  for (const g of near) {
    if (g.kind === 'site' || !g.sizeKm || g.featureType === 'Satellite Feature' || o.skip(g)) continue
    const shown = o.shown(g.id)
    if (g.sizeKm < need * 0.66 || (g.sizeKm < need && !shown)) continue
    const cell = o.cellOf ? o.cellOf(g, shown) : o.inCentre?.(g) ? 'centre' : null
    if (!cell || (o.shortCells && !o.shortCells.has(cell) && !shown)) continue
    if (shown) kept.push(g)
    else {
      const key = o.cellOf ? cell : g.id
      if (!fresh.has(key) || (g.sizeKm ?? 0) > (fresh.get(key)?.sizeKm ?? 0)) fresh.set(key, g)
    }
  }
  const bySize = (a: MoonLabel, b: MoonLabel): number => (b.sizeKm ?? 0) - (a.sizeKm ?? 0)
  kept.sort(bySize)
  return [...kept, ...[...fresh.values()].sort(bySize)].slice(0, cap)
}

/** How long a Gazetteer pick is reused while the camera moves, ms. */
export const GAZ_PICK_MS = 150
/** Re-pick when the cache is old or the frame span moved enough to change size eligibility. */
export function gazRepickDue(prev: { at: number; span: number } | null, now: number, spanKm: number): boolean {
  return !prev || now - prev.at > GAZ_PICK_MS || Math.abs(spanKm - prev.span) > 0.15 * prev.span
}
