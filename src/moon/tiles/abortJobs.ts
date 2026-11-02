/**
 * Aborts every tile request in flight (the pause path): an aborted fetch does not finish in the background while
 * the app is not drawing. Returns how many were aborted. The caller forgets the jobs; the next frame after a resume asks again for
 * what it still wants.
 */
export function abortAllJobs(jobs: Iterable<{ abort: AbortController }>): number {
  let n = 0
  for (const j of jobs) { j.abort.abort(); n++ }
  return n
}

/** Anything with requests in flight that can drop them. */
export interface AbortableStreamer { abortInFlight(): number }

/** Aborts the requests of every streamer given (the base, the detail and the TC streamers); null entries (not built) are skipped. Returns the total aborted. */
export function abortEverywhere(parts: ReadonlyArray<AbortableStreamer | null | undefined>): number {
  let n = 0
  for (const p of parts) if (p) n += p.abortInFlight()
  return n
}

/**
 * Forgets a job when its request ends, but only if the map still holds that same job. An aborted request's catch path runs after its key
 * may have been queued again, and the new job must not be deleted by the old promise. Returns whether it deleted.
 */
export function forgetJob<K, J>(jobs: Map<K, J>, key: K, job: J): boolean {
  if (jobs.get(key) !== job) return false
  return jobs.delete(key)
}
