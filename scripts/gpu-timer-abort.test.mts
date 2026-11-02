// F8b: a frame that throws between begin() and end() must not kill the timer; F6: ?abl= alone does nothing (it needs ablok=1).
import assert from 'node:assert/strict'
import { GpuTimer } from '../src/post/gpuTimer.ts'

const calls: string[] = []
const gl = {
  getExtension: () => ({ TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 }),
  createQuery: () => ({}), beginQuery: () => calls.push('begin'), endQuery: () => calls.push('end'), deleteQuery: () => calls.push('del'),
  fenceSync: () => ({}), flush: () => {}, SYNC_GPU_COMMANDS_COMPLETE: 0,
} as unknown as WebGL2RenderingContext
const t = new GpuTimer(gl, true)
t.begin(0)
t.abort() // render threw
calls.length = 0
t.begin(16)
assert.deepEqual(calls, ['begin'], 'a new query starts after an aborted frame')
t.end()
assert.deepEqual(calls, ['begin', 'end'])
t.abort() // nothing open: no-op
assert.deepEqual(calls, ['begin', 'end'])

async function ablWith(search: string): Promise<number> {
  ;(globalThis as { location?: unknown }).location = { search }
  const m = await import(`../src/abl.ts?${search}`)
  return (m.ABL as Set<string>).size
}
assert.equal(await ablWith('?abl=shadow0'), 0, 'a shared ?abl= link is inert')
assert.equal(await ablWith('?abl=shadow0&ablok=1'), 1, 'the ablation harness opts in')
console.log('gpu-timer-abort ok')

// Rest-settle: a nested measurement ends the frame query and resumes it; the frame's time is the sum of its segments.
{
  const log: string[] = []
  let n = 0
  const results = new Map<object, number>()
  const gl2 = {
    getExtension: () => ({ TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 }),
    createQuery: () => { const q = { id: n++ }; results.set(q, 2e6 * (q.id + 1)); return q },
    beginQuery: () => log.push('begin'), endQuery: () => log.push('end'), deleteQuery: () => log.push('del'),
    fenceSync: () => ({}), flush: () => {}, deleteSync: () => {}, clientWaitSync: () => 0, ALREADY_SIGNALED: 0, TIMEOUT_EXPIRED: 1,
    SYNC_GPU_COMMANDS_COMPLETE: 0, QUERY_RESULT_AVAILABLE: 10, QUERY_RESULT: 11,
    getParameter: () => false,
    getQueryParameter: (q: object, p: number) => (p === 10 ? true : results.get(q)),
  } as unknown as WebGL2RenderingContext
  const t2 = new GpuTimer(gl2, true)
  t2.begin(0)
  t2.suspend(); t2.suspend() // second is a no-op
  t2.resume()
  t2.end()
  assert.deepEqual(log, ['begin', 'end', 'begin', 'end'], 'two segments, each begun and ended once')
  t2.poll(10)
  assert.equal(t2.stats().samples, 1)
  assert.equal(t2.stats().gpuMsP50, 6, 'the frame is the sum of its segments (2 + 4 ms)')
  log.length = 0
  t2.begin(20); t2.suspend(); t2.abort()
  assert.deepEqual(log.filter((x) => x === 'end').length, 1, 'abort while suspended does not end a query twice')
}
console.log('gpu-timer suspend ok')
