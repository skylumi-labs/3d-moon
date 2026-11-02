import assert from 'node:assert/strict'
import { GpuTimer } from '../src/post/gpuTimer.ts'

function timer(resultsMs: number[], statuses: number[] = []) {
  let queryId = 0, syncId = 0
  const deletedQueries: number[] = []
  const gl = {
    TIMEOUT_EXPIRED: 1,
    ALREADY_SIGNALED: 2,
    CONDITION_SATISFIED: 3,
    WAIT_FAILED: 4,
    SYNC_GPU_COMMANDS_COMPLETE: 0,
    QUERY_RESULT_AVAILABLE: 10,
    QUERY_RESULT: 11,
    getExtension: () => ({ TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 }),
    createQuery: () => ({ id: queryId++ }),
    beginQuery: () => {}, endQuery: () => {}, deleteQuery: (q: {id:number}) => deletedQueries.push(q.id),
    fenceSync: () => ({ id: syncId++ }), deleteSync: () => {}, flush: () => {},
    clientWaitSync: (s: {id:number}) => statuses[s.id] ?? 2,
    getParameter: () => false,
    getQueryParameter: (q: {id:number}, what: number) => what === 10 ? true : resultsMs[q.id] * 1e6,
  } as unknown as WebGL2RenderingContext
  return { timer: new GpuTimer(gl, true), deletedQueries }
}

// A suspicious raw query remains visible for diagnosis. With no older fence
// pending, use the successful fence latency as a conservative upper bound for
// adaptation rather than letting an impossible elapsed value soften the grid.
{
  const { timer: t } = timer([233])
  t.begin(10, true, 1)
  t.end()
  t.poll(122.6)
  assert.deepEqual(t.stats().latestTiming, { queryMs: 233, latencyMs: 112.6, scale: 1, at: 122.6 })
  assert.equal(t.stats().invalidTimings, 1)
  assert.equal(t.latestSample?.ms, 112.6, 'an alone impossible query is bounded by fence latency')
  assert.equal(t.fullFrame?.ms, 112.6, 'the bounded sample remains eligible for full-frame cost')
  assert.equal(t.taggedDoneAt, 122.6)
  assert.equal(t.taggedMs, 112.6)
  t.reset()
  assert.equal(t.fresh, 0, 'reset still clears adaptation samples')
  assert.equal(t.stats().invalidTimings, 1, 'invalid diagnostic count survives measurement resets')
  assert.equal(t.fullFrame?.ms, 112.6, 'full-frame recovery evidence is retained across reset')
}

// Normal query results under the successful fence latency are used unchanged.
{
  const { timer: t } = timer([100])
  t.begin(10, false, 0.7)
  t.end()
  t.poll(122.6)
  assert.deepEqual(t.stats().latestTiming, { queryMs: 100, latencyMs: 112.6, scale: 0.7, at: 122.6 })
  assert.equal(t.latestSample?.ms, 100)
  assert.equal(t.stats().invalidTimings, 0)
}

// With a queue ahead, fence latency contains unrelated work. Preserve the raw
// pair for diagnosis, but exclude the impossible query from adaptation.
{
  const { timer: t } = timer([100, 233])
  t.begin(0, false, 0.5)
  t.end()
  t.begin(50, false, 0.7)
  t.end()
  t.poll(150)
  assert.deepEqual(t.stats().latestTiming, { queryMs: 233, latencyMs: 100, scale: 0.7, at: 150 })
  assert.equal(t.stats().invalidTimings, 1)
  assert.equal(t.fresh, 1, 'only the first, plausible queued-frame sample reaches adaptation')
  assert.equal(t.latestSample?.ms, 100)
  assert.equal(t.smoothed, 100)
}

// WAIT_FAILED is not a completion and must never become a short fence latency.
{
  const { timer: t, deletedQueries } = timer([10], [4])
  t.begin(10, true, 1)
  t.end()
  t.poll(20)
  assert.equal(t.stats().invalidTimings, 1)
  assert.equal(t.stats().samples, 0)
  assert.equal(t.latestSample, null)
  assert.equal(t.taggedDoneAt, 0, 'a failed fence is not reported as a completed tagged frame')
  assert.deepEqual(deletedQueries, [0], 'failed-fence query is released')
}

console.log('gpu-query-pair: query/fence validation and adaptation ok')
