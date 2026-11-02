import type { ShadowMode } from './shadowMode'

export type ShadowPolicy = 'legacy' | 'fixed'
export type ShadowChange = 'camera' | 'live-tick' | 'date-jump' | 'turn' | 'terrain-revision' | 'context-restore'

export function parseShadowPolicy(search: string): ShadowPolicy {
  return new URLSearchParams(search).get('shadowpolicy') === 'fixed' ? 'fixed' : 'legacy'
}

/**
 * The identity of a Sun direction in Moon body coordinates. Camera position and orientation are deliberately absent.
 * Quantization suppresses floating point noise while remaining much finer than the cache's 0.01 degree tolerance.
 */
export function bodyFrameSunEpoch(sun: readonly [number, number, number], precision = 1e-7): string {
  const length = Math.hypot(...sun)
  if (!Number.isFinite(length) || length === 0) return 'invalid'
  return sun.map((v) => Math.round((v / length) / precision)).join(':')
}

/** The Sun direction expressed in the Moon's body frame; world-space Sun position alone misses a hand turn. */
export function sunDirectionInBodyFrame(sun: readonly [number, number, number], x: readonly [number, number, number], y: readonly [number, number, number], north: readonly [number, number, number]): [number, number, number] {
  return [
    sun[0] * x[0] + sun[1] * x[1] + sun[2] * x[2],
    sun[0] * y[0] + sun[1] * y[1] + sun[2] * y[2],
    sun[0] * north[0] + sun[1] * north[1] + sun[2] * north[2],
  ]
}

export interface ShadowChangeDecision { epochDelta: number; invalidate: boolean; drift: boolean; preserveEntries: boolean }
export function shadowChangeDecision(change: ShadowChange): ShadowChangeDecision {
  if (change === 'camera') return { epochDelta: 0, invalidate: false, drift: false, preserveEntries: true }
  if (change === 'live-tick') return { epochDelta: 0, invalidate: false, drift: true, preserveEntries: true }
  return { epochDelta: 1, invalidate: true, drift: false, preserveEntries: false }
}

/** A completed build may publish only into the epoch that requested it. */
export function shadowJobCanPublish(jobEpoch: number, currentEpoch: number): boolean { return jobEpoch === currentEpoch }

/** New camera coverage is demand; it does not alter the validity of already built entries. */
export function addVisibleShadowDemand<T>(pending: ReadonlySet<T>, visible: Iterable<T>): Set<T> {
  const next = new Set(pending)
  for (const tile of visible) next.add(tile)
  return next
}

export function cacheReadDuringMotion(policy: ShadowPolicy, legacyMotionRead: boolean): boolean {
  return policy === 'fixed' || legacyMotionRead
}

/**
 * Fixed policy keeps the cache scheduler eligible on motion/reduced-grid frames; its own per-frame budget still applies.
 * `sharpDefer` (`?motion=sharp`, the pacer's cut-cost stage) overrides both policies: builds of every kind stand down while it holds.
 */
export function cacheBuildMotion(policy: ShadowPolicy, legacyMotion: boolean, sharpDefer = false): boolean {
  return sharpDefer || (policy === 'legacy' && legacyMotion)
}

export type ShadowServePath = 'global-cache' | 'patch-cache' | 'baked' | 'live-march' | 'off'
export interface ShadowFrameAccountingInput {
  mode: ShadowMode
  servedPath?: ShadowServePath
  bakedDrawing: boolean
  patchCacheOn: boolean
  globalCacheOn: boolean
  globalBuilt: number
  patchBuilt: number
  globalPending: number
  patchPending: number
  bakedPending: number
}
export interface ShadowFrameAccounting {
  mode: ShadowMode
  path: ShadowServePath
  globalLayersBuilt: number
  patchLayersBuilt: number
  cacheLayersBuilt: number
  pendingDemand: number
}
export function accountShadowFrame(input: ShadowFrameAccountingInput): ShadowFrameAccounting {
  const path: ShadowServePath = input.servedPath ?? (input.mode === 'off' ? 'off'
    : input.mode === 'baked' && input.bakedDrawing ? 'baked'
    : input.patchCacheOn ? 'patch-cache'
    : input.globalCacheOn ? 'global-cache'
    : 'live-march')
  return {
    mode: input.mode,
    path,
    globalLayersBuilt: input.globalBuilt,
    patchLayersBuilt: input.patchBuilt,
    cacheLayersBuilt: input.globalBuilt + input.patchBuilt,
    pendingDemand: input.globalPending + input.patchPending + input.bakedPending,
  }
}

export function shadowCoverageStats(visibleDemand: number, exactEntries: number): { cacheCoverage: number; fallbackShare: number } {
  const demand = Math.max(0, visibleDemand)
  const exact = Math.max(0, exactEntries)
  const cacheCoverage = demand === 0 ? 1 : Math.min(1, exact / demand)
  return { cacheCoverage, fallbackShare: 1 - cacheCoverage }
}
