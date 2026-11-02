import assert from 'node:assert/strict'
import { FailureBook, isPermanentFailure, settleJob, RETRY_BASE_MS, RETRY_CAP_MS } from '../src/moon/tiles/jobBook.ts'
import { HttpError } from '../src/net/load.ts'

// --- settleJob: a late settlement only removes its own entry
{
  interface J { id: string; abort: AbortController }
  const jobs = new Map<number, J>()
  const a: J = { id: 'A', abort: new AbortController() }
  jobs.set(7, a)
  // update() aborts the unwanted job and drops it, the key is wanted again and B takes its place
  a.abort.abort(); jobs.delete(7)
  const b: J = { id: 'B', abort: new AbortController() }
  jobs.set(7, b)
  // A's rejection arrives late
  assert.equal(settleJob(jobs, 7, a), false, 'a replaced job does not settle')
  assert.equal(jobs.get(7), b, 'the replacement stays tracked')
  assert.equal(settleJob(jobs, 7, b), true)
  assert.equal(jobs.size, 0)
  assert.equal(settleJob(jobs, 7, b), false, 'settling twice is harmless')
}

// --- the streamer's start/abort/re-request shape with an injected fetch: one fetch per live job, one entry per key
{
  interface J { key: number; abort: AbortController }
  const jobs = new Map<number, J>()
  const ready: J[] = []
  const pending: Array<{ job: J; reject: (e: Error) => void; resolve: () => void }> = []
  let fetches = 0
  const start = (key: number) => {
    const job: J = { key, abort: new AbortController() }
    jobs.set(key, job)
    fetches++
    void new Promise<void>((resolve, reject) => pending.push({ job, resolve, reject }))
      .then(() => { if (job.abort.signal.aborted || !settleJob(jobs, key, job)) return; ready.push(job) })
      .catch(() => { if (!settleJob(jobs, key, job) || job.abort.signal.aborted) return })
  }
  start(1)
  const first = jobs.get(1)!
  first.abort.abort(); jobs.delete(1)
  start(1)
  pending[0].reject(new Error('AbortError'))
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(jobs.size, 1, 'the replacement is still tracked after the stale rejection')
  assert.equal(fetches, 2, 'no third job is started for the key')
  pending[1].resolve()
  await new Promise((r) => setTimeout(r, 0))
  assert.deepEqual(ready.map((j) => j === pending[1].job), [true], 'exactly one payload is ready, from the replacement')
}

// --- isPermanentFailure
assert.equal(isPermanentFailure(new HttpError('t', 404)), true)
assert.equal(isPermanentFailure(new HttpError('t', 403)), true)
assert.equal(isPermanentFailure(new HttpError('t', 410)), true)
assert.equal(isPermanentFailure(new HttpError('t', 500)), false)
assert.equal(isPermanentFailure(new HttpError('t', 429)), false)
assert.equal(isPermanentFailure(new Error('network')), false)

// --- FailureBook: permanent failures are never retried
{
  const f = new FailureBook()
  assert.equal(f.allows(1, 0), true)
  f.fail(1, 0, true)
  for (const t of [0, RETRY_BASE_MS + 1, 1e9]) assert.equal(f.allows(1, t), false, `absent at ${t}`)
  assert.equal(f.isAbsent(1), true)
  assert.equal(f.absentCount, 1)
  f.hold(1, 5, 10)
  assert.equal(f.allows(1, 1e9), false, 'a hold never lifts an absent mark')
  assert.equal(f.allows(2, 0), true, 'other keys unaffected')
}
// --- transient failures back off exponentially up to the cap
{
  const f = new FailureBook()
  let now = 0
  const waits: number[] = []
  for (let i = 0; i < 12; i++) {
    f.fail(9, now, false)
    assert.equal(f.allows(9, now), false)
    let w = 0
    while (!f.allows(9, now + w)) w += 1000
    waits.push(w)
    now += w
  }
  assert.deepEqual(waits.slice(0, 4), [10000, 20000, 40000, 80000])
  assert.equal(waits[waits.length - 1], RETRY_CAP_MS)
  assert.ok(Math.max(...waits) <= RETRY_CAP_MS)
  f.succeed(9)
  assert.equal(f.allows(9, now), true, 'a good load forgets the history')
  f.fail(9, now, false)
  assert.equal(f.allows(9, now + RETRY_BASE_MS), true, 'back to the base wait after a success')
}
// --- a bare hold is not a failure
{
  const f = new FailureBook()
  f.hold(3, 0, 3000)
  assert.equal(f.allows(3, 2999), false)
  assert.equal(f.allows(3, 3000), true)
  f.fail(3, 3000, false)
  assert.equal(f.allows(3, 3000 + RETRY_BASE_MS), true, 'first real failure waits the base time')
}
console.log('job-book: ok')
