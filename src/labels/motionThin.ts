import { postCandidateRank, type PostCandidate } from './postLayout'

export const LABELS_MOTION_CAP_DESKTOP = 24
export const LABELS_MOTION_CAP_PHONE = 16
export const LABELS_MOTION_REST_MS = 250

export interface MotionThinState { lastMovingAt: number | null }

/** Keep thinning through the short rest debounce, so a brief pause during a gesture does not churn the label layout. */
export function motionThinActive(state: MotionThinState, moving: boolean, now: number, restMs = LABELS_MOTION_REST_MS): boolean {
  if (moving) {
    state.lastMovingAt = now
    return true
  }
  return state.lastMovingAt !== null && now - state.lastMovingAt < restMs
}

/** Select by the same rank used by post placement; major tier and pinned labels are mandatory even if they exceed the budget. */
export function selectMotionCandidates(candidates: PostCandidate[], cap: number, shown: ReadonlyMap<string, string>): PostCandidate[] {
  const sorted = [...candidates].sort((a, b) => postCandidateRank(a, shown) - postCandidateRank(b, shown) || (a.id < b.id ? -1 : 1))
  const keep = new Set(sorted.filter((c) => c.tier === 1 || c.pinned).map((c) => c.id))
  for (const c of sorted) {
    if (keep.size >= cap) break
    keep.add(c.id)
  }
  return sorted.filter((c) => keep.has(c.id))
}
