import type { TileJob, TileResult, GreyJob, GreyResult } from './tileJob'
import { decodeFlags } from './decodeFlags'

/**
 * A small pool of decode Workers. Jobs go to the least busy worker; a worker that errors at the platform level (not a bad tile: a bad
 * tile comes back as an `error` message) fails the jobs it held (the caller fetches those tiles again) and the worker is replaced, once per pool
 * (a one-off failure such as an out-of-memory tile does not cost the session its Workers). A second platform failure, or a worker that cannot
 * be created, turns the pool off, so the caller falls back to decoding on the page's thread. `create` returns null where Workers or
 * OffscreenCanvas are missing. Every job carries the page's decode switches (decodeFlags.ts): the Worker cannot read the page's URL.
 */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void
  terminate(): void
  onmessage: ((ev: { data: unknown }) => void) | null
  onerror: ((ev: { message?: string }) => void) | null
}
export class WorkerUnavailable extends Error {}
type Msg = { type: 'done'; result: TileResult | GreyResult } | { type: 'error'; id: number; message: string }
interface Pending { resolve(r: TileResult | GreyResult): void; reject(e: Error): void }

/** Worker replacements a pool allows itself before it turns off. */
export const MAX_RESTARTS = 1

interface Slot { w: WorkerLike; pending: Map<number, Pending> }

export class TilePool {
  private readonly workers: Slot[] = []
  private nextId = 1
  private dead = false
  /** Workers replaced after a platform error. */
  restarts = 0
  constructor(private readonly factory: () => WorkerLike, size: number) {
    for (let i = 0; i < size; i++) this.workers.push(this.spawn())
  }
  private spawn(): Slot {
    const entry: Slot = { w: this.factory(), pending: new Map<number, Pending>() }
    entry.w.onmessage = (ev) => {
      const m = ev.data as Msg
      const id = m.type === 'done' ? m.result.id : m.id
      const p = entry.pending.get(id)
      if (!p) return
      entry.pending.delete(id)
      if (m.type === 'done') p.resolve(m.result); else p.reject(new Error(m.message))
    }
    entry.w.onerror = (ev) => this.crashed(entry, new WorkerUnavailable(ev.message ?? 'tile worker failed'))
    return entry
  }
  /** A platform error in one worker: its jobs fail, the worker is replaced while the restart budget lasts, otherwise the pool is off. */
  private crashed(entry: Slot, err: Error): void {
    if (this.dead) return
    const i = this.workers.indexOf(entry)
    if (i < 0) return
    if (this.restarts >= MAX_RESTARTS) { this.fail(err); return }
    this.restarts++
    entry.w.onmessage = null; entry.w.onerror = null
    for (const p of entry.pending.values()) p.reject(err)
    entry.pending.clear()
    entry.w.terminate()
    try { this.workers[i] = this.spawn() } catch { this.fail(err) }
  }
  get usable(): boolean { return !this.dead }
  /** `transfer`: the job's buffers move to the worker (the page no longer has them). */
  run(job: Omit<TileJob, 'id'>): Promise<TileResult> {
    if (this.dead) return Promise.reject(new WorkerUnavailable('tile pool is off'))
    const id = this.nextId++
    let best = this.workers[0]
    for (const e of this.workers) if (e.pending.size < best.pending.size) best = e
    return new Promise((resolve, reject) => {
      best.pending.set(id, { resolve: (r) => resolve(r as TileResult), reject })
      const transfer: Transferable[] = [job.hb]
      if (job.cb) transfer.push(job.cb)
      try { best.w.postMessage({ ...job, flags: job.flags ?? decodeFlags(), id }, transfer) } catch (e) { best.pending.delete(id); reject(e as Error) } // this job's own failure (DataCloneError, a detached buffer): the worker and the restart budget are left alone
    })
  }
  /** A grey detail tile (TC / WAC): its WebP bytes move to the worker; the mip chain comes back. The caller keeps a copy if it wants a page fallback. */
  runGrey(cb: ArrayBuffer, mid: number): Promise<Uint8Array[]> {
    if (this.dead) return Promise.reject(new WorkerUnavailable('tile pool is off'))
    const id = this.nextId++
    let best = this.workers[0]
    for (const e of this.workers) if (e.pending.size < best.pending.size) best = e
    return new Promise((resolve, reject) => {
      best.pending.set(id, { resolve: (r) => resolve((r as GreyResult).mips), reject })
      const job: GreyJob = { id, kind: 'grey', cb, mid }
      try { best.w.postMessage(job, [cb]) } catch (e) { best.pending.delete(id); reject(e as Error) }
    })
  }
  dispose(): void { this.fail(new Error('disposed')) }
  private fail(err: Error): void {
    this.dead = true
    for (const e of this.workers) {
      e.w.onmessage = null; e.w.onerror = null
      for (const p of e.pending.values()) p.reject(err)
      e.pending.clear()
      e.w.terminate()
    }
  }
}

/** Page-side factory: null unless Workers and OffscreenCanvas exist (and ?tileworker=0 is absent). The decode switches travel with each job. */
export function createTilePool(search = typeof location === 'undefined' ? '' : location.search): TilePool | null {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null
  const q = new URLSearchParams(search)
  if (q.get('tileworker') === '0') return null
  return buildPool(Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 2)))
}

/**
 * The pool the TC and WAC detail streamers share (R51): one Worker, created on first use, never disposed (the streamers come and go with the GL
 * context). Null where Workers are missing, under `?tileworker=0`, or under `?greyworker=0` (the page decodes, as before).
 */
let greyShared: TilePool | null | undefined
export function greyPool(search = typeof location === 'undefined' ? '' : location.search): TilePool | null {
  if (new URLSearchParams(search).get('greyworker') === '0') return null
  if (greyShared === undefined || (greyShared !== null && !greyShared.usable)) {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || new URLSearchParams(search).get('tileworker') === '0') greyShared = null
    else greyShared = buildPool(1)
  }
  return greyShared?.usable ? greyShared : null
}

function buildPool(size: number): TilePool | null {
  try {
    return new TilePool(() => new Worker(new URL('./tileWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike, size)
  } catch { return null }
}
