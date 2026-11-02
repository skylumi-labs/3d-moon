/**
 * Adaptive tile-cache size for the phone classes (roadmap W3-M5 / TM-10, owner decision 2026-10-18: "make it dynamic so it adjusts to the phone"),
 * as pure decisions on injected signals; main.ts executes them.
 *
 * The tile arrays are immutable texStorage3D allocations, so a change of size is a streamer REBUILD, which flashes the 4k maps. Therefore the
 * cache is never rebuilt mid-session for a grow: during a visit the controller only decides "this device handled size N healthily" and RECORDS the
 * next size (one step larger); the page applies it at the next load, at streamer creation (`growLayers` in main.ts). A shrink mid-session is only
 * #240's overrun shed (its own rebuild, which this follows); a slow-frame or context-loss shrink is recorded and applies at the next load too.
 *
 * Start: the size the page allocated at creation (today's class size, so a first visit does not change), or the size remembered for the class.
 * Record a larger size: one GROW_STEP per visit, up to `max` (a CHOICE: 2x the class row, not a measured number; the roadmap names none), only
 * after the view has been healthy for GROW_FIRST_MS and while the ledger would stay under the class ceiling with headroom (including the room the
 * site patch may still take), no context loss this session, frame time healthy, no overrun shed in the last SHED_HOLD_MS, the page visible, at rest.
 * Record a lower size: an overrun shed (the size it rebuilt at), a context loss (the start size, growth off for the session), sustained slow frames
 * (one step, never below the start size).
 * Learn: the remembered size is kept per class in localStorage. CRASH HEURISTIC (not a measurement): a "running" marker with the live size is set
 * while the page lives and cleared on pagehide; a stale marker on the next load means the page probably died (a kill leaves no pagehide), so the
 * next start is one step below the size remembered. A normal tab discard or force-quit looks the same, which only costs a smaller start.
 * iOS reports no deviceMemory and none is invented here: the ledger estimate and the pressure signals above are the only inputs.
 * `?cachegrow=0` restores the fixed class sizes.
 */
import { PATCH_DEFAULT_BYTES, SAFETY_BYTES } from './enforce'

const MB = 1048576

/** Layers added per grow. A CHOICE: 16 gives 48, 64, 80, 96 so a rebuild is spent on a visible step. */
export const GROW_STEP = 16
/** Cap multiple of the class row. A CHOICE (no per-class maximum in the roadmap). */
export const GROW_MAX_FACTOR = 2
/** No size is recorded larger before the session has run this long (one record per visit). */
export const GROW_FIRST_MS = 60_000
/** The view must have been at rest (no input, no motion) this long. */
export const REST_MS = 8_000
/** Ledger headroom kept under the ceiling after a grow, on top of SAFETY_BYTES. A CHOICE. */
export const GROW_HEADROOM_BYTES = 32 * MB
/** No grow this long after an overrun shed or a shrink. */
export const SHED_HOLD_MS = 300_000
/** Smoothed frame interval (ms): at or under HEALTHY the cache may grow; over SLOW for SLOW_HOLD_MS of ticks shrinks one step. CHOICES. */
export const HEALTHY_FRAME_MS = 20
export const SLOW_FRAME_MS = 40
export const SLOW_HOLD_MS = 6_000

export type ShrinkReason = 'shed' | 'context_loss' | 'slow_frames' | 'crash_marker'
export const SHRINK_REASONS: readonly ShrinkReason[] = ['shed', 'context_loss', 'slow_frames', 'crash_marker']

/** Classes that grow: the ones with a finite, estimated ceiling and the 48-layer phone/tablet row. Desktop and software keep their fixed sizes. */
export const GROW_CLASSES: readonly string[] = ['phone-android', 'ios', 'ipad', 'tablet']

export interface GrowState {
  /** Layers of the live cache (what this page built; it does not change mid-session except by following #240's shed). */
  size: number
  /** The size to apply at the next load: what the controller has recorded as healthy. */
  next: number
  /** The size at creation (today's class size): the floor of every shrink here. */
  start: number
  /** The largest size it may grow to. */
  max: number
  lastChangeAt: number
  lastPressureAt: number
  slowSince: number | null
  lostContext: boolean
  shrinks: number
  grows: number
  lastShrink: ShrinkReason | null
  /** The start size came from a stale marker: one step below the remembered size. */
  startedLower: boolean
}

export const maxFor = (classTiles: number, maxArrayLayers: number): number => Math.max(classTiles, Math.min(classTiles * GROW_MAX_FACTOR, maxArrayLayers))

/** What a start looks like: `created` layers were allocated (today's size); `remembered` is the stored good size; `stale` the crash marker found. */
export function newGrow(o: { created: number; max: number; remembered: number | null; stale: boolean; now: number }): GrowState {
  let size = o.created
  let startedLower = false
  if (o.remembered !== null && Number.isFinite(o.remembered)) {
    const r = Math.max(o.created, Math.min(o.max, Math.round(o.remembered)))
    size = o.stale ? Math.max(o.created, r - GROW_STEP) : r
    startedLower = o.stale && size < r
  }
  // Never start above what the caller could actually allocate: the creation fit (ceiling) is the caller's to apply; this is the wanted size.
  return { size, next: size, start: o.created, max: o.max, lastChangeAt: o.now, lastPressureAt: -Infinity, slowSince: null, lostContext: false, shrinks: 0, grows: 0, lastShrink: null, startedLower }
}

export interface GrowSignals {
  now: number
  visible: boolean
  /** The view is at rest: no gesture, flight, ground mode, load, capture; and `restSince` ms of nothing. */
  atRestMs: number
  busy: boolean
  /** The tile cache is built and idle (ready, nothing in flight). */
  tilesReady: boolean
  /** The tile streamer's current layers, bytes the ledger holds for it, the whole ledger, the class ceiling (Infinity: never grows). */
  tilesBytes: number
  ledgerTotal: number
  ceilingBytes: number
  pairBytes: number
  /** Bytes the site patch may still add (its cap minus what it holds now). */
  patchRoomBytes: number
  contextLosses: number
  frameMs: number
  /** The session's age in ms. */
  sessionMs: number
  /** Memory-shed count so far (monotonic). */
  shedCount: number
}

export const patchRoom = (capBytes: number | undefined, heldBytes: number): number => Math.max(0, (capBytes ?? PATCH_DEFAULT_BYTES) - heldBytes)

/** The ledger a rebuild at `layers` would hold, plus what the patch may still take. */
export const projectedBytes = (s: GrowSignals, layers: number): number => s.ledgerTotal - s.tilesBytes + layers * s.pairBytes + s.patchRoomBytes

/** True when the cache may take one more step now. Pure; every condition is a separate line so a test can neuter one. */
export function mayGrow(g: GrowState, s: GrowSignals): boolean {
  const next = g.size + GROW_STEP
  if (next > g.max) return false
  if (!Number.isFinite(s.ceilingBytes)) return false
  if (g.lostContext || s.contextLosses > 0) return false
  if (!s.visible) return false
  if (s.busy || !s.tilesReady) return false
  if (s.atRestMs < REST_MS) return false
  if (!(s.frameMs > 0 && s.frameMs <= HEALTHY_FRAME_MS)) return false
  if (s.now - g.lastPressureAt < SHED_HOLD_MS) return false
  if (g.next > g.size || s.sessionMs < GROW_FIRST_MS) return false // one record per visit
  if (projectedBytes(s, next) + SAFETY_BYTES + GROW_HEADROOM_BYTES > s.ceilingBytes) return false
  return true
}

/** What a poll decided: record a larger size for the next load, or record a lower one. Neither rebuilds the live cache. */
export interface GrowDecision { kind: 'grow' | 'shrink'; next: number; reason: ShrinkReason | null }

/** One poll. Returns a size to RECORD for the next load, or null; updates the state (including the sustained-slow clock and a shed seen). */
export function growPoll(g: GrowState, s: GrowSignals, lastShedSeen: { n: number }): GrowDecision | null {
  // Pressure first, in order of severity. A shed rebuilt the cache itself (#240): main reports the size it chose through `learnSize`.
  if (s.contextLosses > 0 && !g.lostContext) {
    g.lostContext = true
    return shrinkTo(g, s.now, g.start, 'context_loss')
  }
  if (s.shedCount > lastShedSeen.n) {
    lastShedSeen.n = s.shedCount
    g.lastPressureAt = s.now
    g.shrinks++
    g.lastShrink = 'shed'
    g.slowSince = null
    return null
  }
  if (s.visible && s.frameMs > SLOW_FRAME_MS) {
    if (g.slowSince === null) g.slowSince = s.now
    if (s.now - g.slowSince >= SLOW_HOLD_MS && g.next > g.start) {
      g.slowSince = null
      return shrinkTo(g, s.now, Math.max(g.start, Math.min(g.next, g.size) - GROW_STEP), 'slow_frames')
    }
  } else g.slowSince = null
  if (mayGrow(g, s)) {
    g.next = g.size + GROW_STEP
    g.lastChangeAt = s.now
    g.grows++
    return { kind: 'grow', next: g.next, reason: null }
  }
  return null
}

function shrinkTo(g: GrowState, now: number, layers: number, reason: ShrinkReason): GrowDecision {
  g.lastPressureAt = now
  g.lastShrink = reason
  g.shrinks++
  g.next = Math.min(g.next, layers)
  g.lastChangeAt = now
  return { kind: 'shrink', next: g.next, reason }
}

/** The cache was built or rebuilt at `layers` by something else (the creation fit or the overrun shed): follow it. A smaller build lowers the record. */
export function learnSize(g: GrowState, layers: number, now: number): void {
  if (layers !== g.size) { g.size = Math.max(8, layers); g.lastChangeAt = now }
  if (layers < g.next) g.next = layers
}

// ---- storage: the last good size per class, and the crash marker. Every access is guarded; without storage the controller still runs.

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export const SIZE_KEY = (cls: string): string => `moon.cachegrow.size.${cls}`
export const RUNNING_KEY = (cls: string): string => `moon.cachegrow.running.${cls}`

const safe = <T>(f: () => T, d: T): T => { try { return f() } catch { return d } }

export function readRemembered(kv: KV | null, cls: string): number | null {
  if (!kv) return null
  const v = safe(() => kv.getItem(SIZE_KEY(cls)), null)
  const n = v === null ? NaN : Number(v)
  return Number.isInteger(n) && n >= 8 && n <= 1024 ? n : null
}
/** The size in a marker left by a page that never reached pagehide, or null. */
export function readStaleMarker(kv: KV | null, cls: string): number | null {
  if (!kv) return null
  const v = safe(() => kv.getItem(RUNNING_KEY(cls)), null)
  const n = v === null ? NaN : Number(v)
  return Number.isInteger(n) && n >= 8 && n <= 1024 ? n : null
}
export function writeRemembered(kv: KV | null, cls: string, layers: number): void { if (kv) safe(() => kv.setItem(SIZE_KEY(cls), String(Math.round(layers))), undefined) }
export function setRunning(kv: KV | null, cls: string, layers: number): void { if (kv) safe(() => kv.setItem(RUNNING_KEY(cls), String(Math.round(layers))), undefined) }
export function clearRunning(kv: KV | null, cls: string): void { if (kv) safe(() => kv.removeItem(RUNNING_KEY(cls)), undefined) }

/**
 * The start for this load: the remembered good size, lowered one step when a stale marker is found (the lowered value is recorded at once so a second
 * crash lowers again). A marker bigger than the remembered size (the page died right after a grow) is what is stepped down from.
 */
export function startFromStorage(kv: KV | null, cls: string, created: number, max: number, now: number): GrowState {
  const marker = readStaleMarker(kv, cls)
  const stored = readRemembered(kv, cls)
  const stale = marker !== null
  const remembered = marker !== null ? Math.max(marker, stored ?? 0) : stored
  const g = newGrow({ created, max, remembered, stale, now })
  if (stale) { g.lastShrink = 'crash_marker'; g.shrinks++; writeRemembered(kv, cls, g.size) }
  return g
}

/** `?cachegrow=0` restores today's fixed sizes. Default on. */
export const cachegrowOff = (search: string): boolean => new URLSearchParams(search).get('cachegrow') === '0'
