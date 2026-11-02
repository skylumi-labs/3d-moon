/**
 * Fetching tiles ahead of need (MOON-UX-REDESIGN section 4.5), with no DOM and no three so Node can test it.
 *
 * `loadManifest` fetches the tiles manifest once per base and shares the promise: the boot calls it, the
 * TileStreamer's `create` reuses it, so the manifest costs one request. `TilePrefetcher` takes the files of the
 * coarse tiles covering a list of targets (a pin's destination), one request pair at a time, and holds the raw
 * bytes until the streamer asks for the same path (`take`), so a fly-to to that pin finds its first tiles resident
 * without a network round trip. Nothing is fetched on a save-data or 2g/3g connection, and a new list replaces
 * the old queue (a tap supersedes the wait).
 */
import { fetchRetry } from './load'
import { currentSharp } from '../quality/sharp'
import { colorPath, heightPath, tileIndex, tileOf, type TileManifest } from '../moon/tiles/grid'
import { type DeeperEntry, deeperPresent } from '../moon/tiles/levels'

/** A place to have ready: selenographic degrees. `levels` overrides the default two coarsest (2 then 1). */
export interface PrefetchTarget { lon: number; lat: number; levels?: number[]; /** Gazetteer hits can warm fine relief before fallback levels. */ finestFirst?: boolean }

/** The two coarsest levels: what a fly-to needs first. */
export const PREFETCH_LEVELS = [2, 1]

/** Destination plus the sampled great-circle points for one camera flight. */
export function flightPrefetchTargets(target: PrefetchTarget, path: PrefetchTarget[], detailedEnd: boolean): PrefetchTarget[] {
  return [{ ...target, levels: detailedEnd ? [...PREFETCH_LEVELS, 0] : [...PREFETCH_LEVELS] }, ...path]
}

interface Conn { saveData?: boolean; effectiveType?: string }
/** False on save-data or a 2g/3g connection, and with ?prefetch=off. */
export function prefetchAllowed(conn: Conn | undefined, search = ''): boolean {
  if (new URLSearchParams(search).get('prefetch') === 'off') return false
  if (!conn) return true
  if (conn.saveData) return false
  return !(conn.effectiveType && /(^|-)(2g|3g)$/.test(conn.effectiveType))
}

/** True with ?prefeat=1: flight-prefetch feature caps (level and size) are on. Off by default until the rig run. */
export const prefeatOn = (search: string = (globalThis as { location?: { search?: string } }).location?.search ?? ''): boolean => new URLSearchParams(search).get('prefeat') === '1'
/** False with ?prefetchlru=0: held files are evicted in first-insertion order again (today's behaviour before this fix). */
export const prefetchLru = (search: string = (globalThis as { location?: { search?: string } }).location?.search ?? ''): boolean => new URLSearchParams(search).get('prefetchlru') !== '0'

/** True with ?deeper=0 in the page address (false outside a page, so Node tests are unaffected). */
export const deeperOff = (search: string = (globalThis as { location?: { search?: string } }).location?.search ?? ''): boolean => new URLSearchParams(search).get('deeper') === '0'

const manifests = new Map<string, Promise<TileManifest>>()
const resolved = new Map<string, TileManifest>()
/** The manifest for `base` if its load has already finished (the boot starts it on the first frames), else null. Never starts a load. */
export function resolvedManifest(base: string): TileManifest | null { return resolved.get(base) ?? null }
/** The finest height texel the manifest lists, km: its deepest `deeper` level, else the built height texel (same rule as TileStreamer.deepestTexelKm). */
export function finestHeightTexelKm(man: TileManifest & { deeper?: Array<{ level: number; texelKm: number }> }): number {
  let best: { level: number; texelKm: number } | null = null
  for (const e of man.deeper ?? []) if (!best || e.level < best.level) best = e
  return best ? best.texelKm : man.height.texelKm
}
export function loadManifest(base: string, signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<TileManifest> {
  const hit = manifests.get(base)
  if (hit) return hit
  const p = (async () => {
    const res = await fetchRetry(`${base}manifest.json`, { init: { signal }, delaysMs: [500, 2000, 6000], fetchImpl })
    const man = (await res.json()) as TileManifest & { deeper?: unknown }
    // ?deeper=0 drops the manifest's deeper block, so the same page shows the built levels alone (A/B for the whole-Moon height data).
    if (deeperOff()) delete man.deeper
    return man
  })()
  manifests.set(base, p)
  void p.then((m) => { resolved.set(base, m) }, () => undefined)
  p.catch(() => manifests.delete(base))
  return p
}
/** For tests: forget the cached manifests. */
export function forgetManifests(): void { manifests.clear(); resolved.clear() }

/** The tiles (that exist) holding a target at its levels, coarsest first. */
export function tilesFor(man: Pick<TileManifest, 'present'> & { deeper?: DeeperEntry[] }, t: PrefetchTarget): { level: number; tx: number; ty: number }[] {
  const out: { level: number; tx: number; ty: number }[] = []
  const levels = t.finestFirst ? [...(t.levels ?? PREFETCH_LEVELS)] : [...(t.levels ?? PREFETCH_LEVELS)].sort((a, b) => b - a)
  for (const level of levels) {
    const { tx, ty } = tileOf(level, t.lon, t.lat)
    const index = tileIndex(level, tx, ty)
    // Levels below 0 are the manifest's `deeper` block (TILE-CONTRACT.md 1b).
    const there = level >= 0 ? man.present[level]?.[index] === '1' : (() => { const e = man.deeper?.find((d) => d.level === level); return !!e && deeperPresent(e, index) })()
    if (there) out.push({ level, tx, ty })
  }
  return out
}

/** Tiles fetched at once (a planned flight of 150 tiles is not 150 sequential round trips). */
export const PREFETCH_PARALLEL = 3
/** Raw tile files held for the streamer. A long path's tiles are tens of MB of gzip; the oldest are dropped past this many. */
export const PREFETCH_HELD_MAX = 160
/** The cap in force: PREFETCH_HELD_MAX, or the larger one under ?sharp=1 (quality/sharp.ts) so a long flight's whole path fits. */
export const heldMax = (): number => Math.max(PREFETCH_HELD_MAX, currentSharp().heldMax)

export class TilePrefetcher {
  readonly stats = { requested: 0, done: 0, failed: 0, bytes: 0, dropped: 0 }
  private readonly held = new Map<string, Promise<ArrayBuffer>>()
  private readonly ready = new Set<string>()
  private readonly owners = new Map<string, { controller: AbortController; promise: Promise<void>; /** Soft stop: no new tile is started, the ones in flight finish. */ stopped: boolean }>()

  constructor(private readonly base: string, private readonly fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  /**
   * Replaces the queue with the tiles of `targets`, in order, skipping what is already held and what `resident` says the streamer already
   * has. Resolves when the queue has drained (or was replaced).
   */
  async prefetch(targets: PrefetchTarget[], signal?: AbortSignal, resident?: (level: number, tx: number, ty: number) => boolean, owner = 'default', priority?: 'low' | 'high' | 'auto'): Promise<void> {
    const controller = new AbortController()
    // Sharp: a re-plan (the flight's 500 ms tick) or an abort of `signal` stops the queue but lets the fetches in flight finish and be kept, so a tile
    // still on the path is not cancelled and asked for again (the default aborts them: nothing is held until a request completes). cancel() stays hard.
    const soft = currentSharp().on
    const mine = { controller, promise: Promise.resolve(), stopped: false }
    const forwardAbort = (): void => { if (soft) mine.stopped = true; else controller.abort() }
    if (signal?.aborted) controller.abort()
    else signal?.addEventListener('abort', forwardAbort, { once: true })
    const previous = this.owners.get(owner)
    if (previous) {
      if (soft) previous.stopped = true
      else {
        previous.controller.abort()
        await previous.promise
        if (this.owners.get(owner) === previous) this.owners.delete(owner)
      }
    }
    if (controller.signal.aborted) {
      signal?.removeEventListener('abort', forwardAbort)
      return
    }
    this.owners.set(owner, mine)
    const work = async (): Promise<void> => {
    const man = await loadManifest(this.base, undefined, this.fetchImpl)
    if (controller.signal.aborted) return
    const lru = prefetchLru()
    const seen = new Set<string>()
    const queue: { level: number; tx: number; ty: number }[] = []
    for (const t of targets) for (const k of tilesFor(man, t)) {
      const id = `${k.level}/${k.tx}_${k.ty}`
      // Soft: a file still downloading counts as requested (the earlier run's fetch is not cancelled and started again).
      const have = soft ? (p: string): boolean => this.held.has(p) : (p: string): boolean => this.ready.has(p)
      const heightReady = have(heightPath(k.level, k.tx, k.ty))
      const colorReady = k.level < 0 || have(colorPath(k.level, k.tx, k.ty))
      if (seen.has(id) || (heightReady && colorReady) || resident?.(k.level, k.tx, k.ty)) {
        // Re-queued and still held: it is the newest need, not the oldest (least recently queued goes first).
        if (heightReady && colorReady && lru) this.touch(heightPath(k.level, k.tx, k.ty), colorPath(k.level, k.tx, k.ty))
        continue
      }
      seen.add(id)
      queue.push(k)
    }
      const worker = async (): Promise<void> => {
        while (queue.length && !controller.signal.aborted && !mine.stopped) {
          const k = queue.shift()!
          const ctl = new AbortController()
          const sub = (): void => ctl.abort()
          controller.signal.addEventListener('abort', sub, { once: true })
          const get = (path: string): Promise<ArrayBuffer> => {
            this.stats.requested++
            const p = this.fetchImpl(this.base + path, priority ? { signal: ctl.signal, priority } as RequestInit : { signal: ctl.signal })
              .then((r) => { if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.arrayBuffer() })
            p.then((b) => { this.stats.done++; this.stats.bytes += b.byteLength; if (this.held.get(path) === p) this.ready.add(path) }, () => { this.stats.failed++; if (this.held.get(path) === p) { this.held.delete(path); this.ready.delete(path) } })
            this.held.set(path, p)
            // Bounded: the oldest unclaimed file goes first.
            while (this.held.size > heldMax()) { const old = this.held.keys().next().value as string; this.held.delete(old); this.ready.delete(old); this.stats.dropped++ }
            return p
          }
          // Deeper levels (level < 0) are heights only: colour is the level-0 map's (TileStreamer).
          try { await Promise.all(k.level < 0 ? [get(heightPath(k.level, k.tx, k.ty))] : [get(heightPath(k.level, k.tx, k.ty)), get(colorPath(k.level, k.tx, k.ty))]) } catch { /* the real load retries and reports */ }
          controller.signal.removeEventListener('abort', sub)
        }
      }
      await Promise.all(Array.from({ length: owner === 'flight' && soft ? Math.max(PREFETCH_PARALLEL, currentSharp().parallel) : PREFETCH_PARALLEL }, worker))
    }
    mine.promise = work().finally(() => {
      signal?.removeEventListener('abort', forwardAbort)
      if (this.owners.get(owner) === mine) this.owners.delete(owner)
    })
    await mine.promise
  }

  /** Stops what is in flight and forgets the queue (held bytes stay). */
  cancel(owner?: string): void {
    if (owner !== undefined) { this.owners.get(owner)?.controller.abort(); return }
    for (const run of this.owners.values()) run.controller.abort()
  }

  /** Moves held files to the newest end of the eviction order. */
  private touch(...paths: string[]): void {
    for (const path of paths) { const p = this.held.get(path); if (p) { this.held.delete(path); this.held.set(path, p) } }
  }

  /** The bytes of a prefetched path, handed over once; null when there is none (or it failed). */
  take(path: string): Promise<ArrayBuffer> | null {
    const p = this.held.get(path)
    if (!p) return null
    this.held.delete(path)
    this.ready.delete(path)
    return p
  }
  has(path: string): boolean { return this.held.has(path) }
  get heldCount(): number { return this.held.size }
}

const prefetchers = new Map<string, TilePrefetcher>()
/** The one prefetcher of a base, shared by main.ts and the TileStreamer. */
export function prefetcherFor(base: string): TilePrefetcher {
  let p = prefetchers.get(base)
  if (!p) prefetchers.set(base, (p = new TilePrefetcher(base)))
  return p
}
