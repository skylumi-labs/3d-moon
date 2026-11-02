/**
 * Idle prefetch of the viewpoint list's neighbours (owner, 11 Oct 2026: "folks want to see things more quickly"). While the visitor rests on a
 * viewpoint, the tiles of the first view of the NEXT and the PREVIOUS viewpoint are fetched at low priority, so a press of Next or Back finds its
 * first frame resident. Pure parts only (no DOM): main.ts supplies the poses, the timing and the cancel on any interaction.
 */
import type { NavEntry, NavPos } from '../viewpointList'
import type { PrefetchTarget } from './prefetch'

/** The prefetcher owner of this idle fetch (a tap on a pin or a flight's own prefetch is a different owner and is not replaced by it). */
export const NEXT_VIEW_OWNER = 'nextview'
/** The viewpoint at rest this long (ms, with no input and nothing loading) before anything is fetched. */
export const NEXT_VIEW_IDLE_MS = 1500
/** At most this many targets per neighbour (the centre-ground set first, then the gazetteer features in view), and so a bounded request count. */
export const NEXT_VIEW_MAX_TARGETS = 10

/** The positions Next and Back lead to; the list wraps at both ends. Empty when there is only one step. */
export function neighbourPositions(entries: readonly NavEntry[], pos: NavPos | null): NavPos[] {
  if (!pos || !entries[pos.entry]) return []
  const flat: NavPos[] = []
  for (let entry = 0; entry < entries.length; entry++) for (let step = 0; step < entries[entry].steps.length; step++) flat.push({ entry, step })
  const at = flat.findIndex((p) => p.entry === pos.entry && p.step === pos.step)
  if (at < 0 || flat.length < 2) return []
  const next = flat[(at + 1) % flat.length], prev = flat[(at - 1 + flat.length) % flat.length]
  return next.entry === prev.entry && next.step === prev.step ? [next] : [next, prev]
}

/** The targets of one first view, capped: tiles for a standing camera at that pose. */
export function capTargets(targets: readonly PrefetchTarget[], max = NEXT_VIEW_MAX_TARGETS): PrefetchTarget[] {
  return targets.slice(0, Math.max(0, max))
}

/** The idle gate: a viewpoint is on screen, the camera and the visitor are still, and the tiles of the view itself have arrived. */
export function nextViewReady(s: { msSinceInput: number; moving: boolean; inflight: number; armedForMs: number }): boolean {
  return !s.moving && s.msSinceInput >= NEXT_VIEW_IDLE_MS && s.armedForMs >= NEXT_VIEW_IDLE_MS && s.inflight === 0
}
