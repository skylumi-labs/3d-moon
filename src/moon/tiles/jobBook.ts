import { HttpError } from '../../net/load'

/**
 * Bookkeeping the three tile streamers share, kept free of three and the DOM so scripts/job-book.test.mts runs it in Node.
 *
 * Jobs: a job's late settlement (an aborted fetch rejecting a task later) must only touch the entry it owns. Without the identity
 * check an aborted job A deleted the job B that had replaced it under the same key (duplicate fetch, a leaked array layer).
 *
 * Failures: a 404/403/410 will not change within a session, so the tile is marked absent and never asked for again; any other failure
 * waits an exponentially growing time (capped) before the key is admitted back.
 */

/** Identity-safe removal: true when `job` was the current entry (and is now removed), false when it was already replaced or gone. */
export function settleJob<J>(jobs: Map<number, J>, key: number, job: J): boolean {
  if (jobs.get(key) !== job) return false
  jobs.delete(key)
  return true
}

/** True when asking again cannot give another answer. */
export function isPermanentFailure(e: unknown): boolean {
  return e instanceof HttpError && (e.status === 404 || e.status === 403 || e.status === 410)
}

export const RETRY_BASE_MS = 10_000
export const RETRY_CAP_MS = 5 * 60_000

interface Entry { until: number; fails: number; absent: boolean }

export class FailureBook {
  private readonly m = new Map<number, Entry>()
  constructor(private readonly baseMs = RETRY_BASE_MS, private readonly capMs = RETRY_CAP_MS) {}

  /** May the key be fetched at `now`? */
  allows(key: number, now: number): boolean {
    const e = this.m.get(key)
    return !e || (!e.absent && now >= e.until)
  }
  /** Record a failed attempt. Permanent failures mark the key absent for the session; others back off 10 s, 20 s, 40 s ... up to the cap. */
  fail(key: number, now: number, permanent: boolean): void {
    const prev = this.m.get(key)
    const fails = (prev?.fails ?? 0) + 1
    const wait = Math.min(this.capMs, this.baseMs * 2 ** (fails - 1))
    this.m.set(key, { until: now + wait, fails, absent: permanent || !!prev?.absent })
  }
  /** Hold the key off for `ms` without counting a failure (a tile that arrived with no layer to take). Never lifts an absent mark. */
  hold(key: number, now: number, ms: number): void {
    const prev = this.m.get(key)
    this.m.set(key, { until: now + ms, fails: prev?.fails ?? 0, absent: prev?.absent ?? false })
  }
  /** A good load forgets the key's history. */
  succeed(key: number): void { this.m.delete(key) }
  isAbsent(key: number): boolean { return this.m.get(key)?.absent === true }
  get absentCount(): number { let n = 0; for (const e of this.m.values()) if (e.absent) n++; return n }
}
