/**
 * What a memory warning frees, as pure decisions; main.ts executes them.
 *
 * The tile arrays are immutable texStorage3D allocations, so "evict to a floor" means rebuilding the streamer with fewer layers, fitted to
 * the lowered ceiling, not evicting slots (an evicted slot leaves its GPU layer allocated). The landing-site patch is dropped only when the
 * camera is away from it. Both wait for a calm frame: a rebuild shows the 4k maps until the tiles stream back in.
 */

/** Steps a warning runs at once, in order: the ceiling lowers, the baked horizon is released and rebuilt at the lowered ceiling, the chip re-reads. */
export const WARNING_STEPS = ['lowerCeiling', 'disposeBaked', 'configureBaked', 'refreshReduced'] as const

/** How long a warning's release stays pending when the view never calms down (ms). */
export const PRESSURE_PENDING_MS = 60_000

export interface TileFit {
  /** Layers of the live streamer. */
  current: number
  /** Layers the class and URL ask for (tileCapacity). */
  want: number
  /** The lowered ceiling, and what the ledger holds now, bytes. */
  ceiling: number
  ledgerTotal: number
  /** What the live streamer holds in the ledger (its 'tiles' category), bytes; it is freed by the rebuild. */
  tilesBytes: number
  reserveBytes: number
  pairBytes: number
  minLayers: number
}

/** The layer count a rebuild at the lowered ceiling would get, or null when it would not be smaller (nothing to gain, so no rebuild). */
export function tileRebuildLayers(f: TileFit): number | null {
  if (!Number.isFinite(f.ceiling)) return null
  const headroom = f.ceiling - (f.ledgerTotal - f.tilesBytes) - f.reserveBytes
  const fit = Math.max(f.minLayers, Math.min(f.want, Math.floor(Math.max(0, headroom) / f.pairBytes)))
  return fit < f.current ? fit : null
}

export interface PressureState {
  tilesReady: boolean
  /** From tileRebuildLayers: a smaller streamer is possible. */
  tilesShrinkable: boolean
  patchReady: boolean
  /** The ledger still holds more than the lowered ceiling (after the tile release is counted by the caller as not yet done). */
  overCeiling: boolean
  /** The camera is outside the patch's coverage distance and not in ground mode. */
  awayFromPatch: boolean
  /** A gesture, flight, descent, ground mode, capture or lost context: nothing is released now. */
  busy: boolean
}

export interface PressureStep { tiles: boolean; patch: boolean; done: boolean }

/** One frame's decision. `done` ends the pending release: nothing is (or can become) releasable. */
export function pressureStep(s: PressureState): PressureStep {
  const wantTiles = s.tilesReady && s.tilesShrinkable
  const wantPatch = s.patchReady && s.overCeiling
  if (!wantTiles && !wantPatch) return { tiles: false, patch: false, done: true }
  if (s.busy) return { tiles: false, patch: false, done: false }
  return { tiles: wantTiles, patch: wantPatch && s.awayFromPatch, done: !wantPatch || s.awayFromPatch }
}
