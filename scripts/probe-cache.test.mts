/**
 * PointCache: a few probed ground heights survive other asks in between (the old one-point cache missed on every alternating ask); entries expire.
 * ProbeQueue (`?gprobe=async`): one fence read in flight, the latest height ask and the Sun ask wait for it and go out together.
 */
import assert from 'node:assert/strict'
import { PROBE_REACH_M, PointCache, ProbeQueue } from '../src/ground/probeCache.ts'
import { GroundMode } from '../src/ground/GroundMode.ts'

const c = new PointCache(3, 0.05, 1000)
assert.equal(c.get(1, 1, 0), null)
c.set(1, 1, 10, 0); c.set(50, 50, 20, 0)
// alternating asks (camera, pad disc, camera, pad disc...) all hit; a one-point cache misses every one of them
for (let i = 0; i < 6; i++) { assert.equal(c.get(1, 1, 10), 10); assert.equal(c.get(50, 50, 10), 20) }
assert.equal(c.get(1.04, 0.96, 10), 10, 'within 5 cm')
assert.equal(c.get(1.06, 1, 10), null, 'beyond 5 cm')
// capacity: the least recently used point goes
c.set(2, 2, 1, 20); c.set(3, 3, 2, 20); c.set(4, 4, 3, 20)
assert.equal(c.get(4, 4, 30), 3); assert.equal(c.get(3, 3, 30), 2); assert.equal(c.get(2, 2, 30), 1)
assert.equal(c.get(1, 1, 30), null)
// expiry
assert.equal(c.get(2, 2, 1019), 1); assert.equal(c.get(2, 2, 1020), null, 'ttl 1000 ms')
c.clear(); assert.equal(c.get(3, 3, 30), null)

// A deliberately long synchronous read starts the full cache lifetime after it returns.
{
  let now = 0
  const originalPerformance = globalThis.performance
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } })
  try {
    let reads = 0
    const mode = Object.create(GroundMode.prototype) as GroundMode
    Object.assign(mode, {
      probeCache: new PointCache(8, 0.05, 1000), asyncProbe: false,
      pass: { probe: () => { reads++; now += 1500; return [{ h: 12 }] } }, renderer: {}, frame: { h0M: 0 },
    })
    const first = mode.groundZ(1, 2)
    assert.ok(Math.abs(first - 12) < 1e-4)
    assert.equal(mode.groundZ(1, 2), first, 'read stall does not consume the cache TTL')
    assert.equal(reads, 1, 'second lookup hits the cached read instead of stalling again')
  } finally {
    Object.defineProperty(globalThis, 'performance', { configurable: true, value: originalPerformance })
  }
}
// the one-point cache (the old behaviour, ?abl=probe1) misses on every alternating ask
const one = new PointCache(1, 0.05, Infinity)
let misses = 0
one.set(1, 1, 10, 0)
for (let i = 0; i < 6; i++) { if (one.get(50, 50, 0) === null) { misses++; one.set(50, 50, 20, 0) } if (one.get(1, 1, 0) === null) { misses++; one.set(1, 1, 10, 0) } }
assert.equal(misses, 12)

// nearest: the newest point within reach, expired or not (the async path refreshes it); nothing beyond the reach.
{
  const n = new PointCache(8, 0.05, 1000)
  n.set(0, 0, 5, 0); n.set(0.1, 0, 6, 1)
  assert.equal(n.nearest(0.15, 0, PROBE_REACH_M), 6, 'the newest within reach')
  assert.equal(n.nearest(0, 0.19, PROBE_REACH_M), 5, 'straight-line distance: 19 cm north of the origin reaches it, not the point 10 cm east')
  assert.equal(n.nearest(0.35, 0, PROBE_REACH_M), null, 'nothing within 20 cm')
  assert.equal(n.nearest(0.15, 0, Infinity), 6, 'a glide reaches anything')
  assert.equal(n.get(0.1, 0, 5000), null, 'expired for get'); assert.equal(n.nearest(0.1, 0, PROBE_REACH_M), 6, 'still served by nearest')
  n.clear(); assert.equal(n.nearest(0, 0, Infinity), null)
}

// ProbeQueue: one read in flight; asks made meanwhile wait and go out together when it lands; a newer height ask replaces an older waiting one.
{
  const sent: Array<Array<readonly [number, number]>> = []
  let ok = true
  const q = new ProbeQueue((pts) => { if (ok) sent.push([...pts]); return ok })
  q.ask(1, 2)
  assert.equal(q.pending, true); assert.deepEqual(sent, [[[1, 2]]])
  q.ask(3, 4); q.ask(5, 6); q.askSun()
  assert.equal(sent.length, 1, 'nothing more while one is in flight')
  const a = q.landed()
  assert.deepEqual(a, { pts: [[1, 2]], sun: -1, gen: 0 }, 'what the landed read asked for')
  assert.deepEqual(sent[1], [[5, 6], [0, 0]], 'the latest height ask and the Sun ask, in one read')
  const b = q.landed()
  assert.deepEqual(b, { pts: [[5, 6], [0, 0]], sun: 1, gen: 0 }, 'the Sun ask is index 1')
  assert.equal(q.pending, false); assert.equal(q.landed(), null, 'nothing in flight')
  // begin refused (the pass not ready): the ask waits and goes out on the next landing or ask
  ok = false; q.ask(7, 8); assert.equal(q.pending, false)
  ok = true; q.askSun(); assert.deepEqual(sent[2], [[7, 8], [0, 0]])
  q.clear(); assert.equal(q.pending, false); assert.equal(q.landed(), null)
  // drop (with every cache clear: finer heights arrived): the read in flight is answered by the old terrain and is discarded when it lands; an ask
  // still waiting goes out under the new generation and lands normally.
  q.ask(1, 1); q.ask(2, 2)
  q.drop()
  assert.equal(q.pending, true, 'the GPU read itself is still in flight')
  assert.equal(q.landed(), null, 'its result is dropped')
  assert.deepEqual(sent[sent.length - 1], [[2, 2]], 'the waiting ask went out after the drop')
  assert.deepEqual(q.landed()?.pts, [[2, 2]], 'and lands')
  // The point already being read, asked again (the camera's follow and the HUD's tape in one frame): not a second read behind it.
  const n0 = sent.length
  q.ask(3, 3); q.ask(3.02, 2.99)
  assert.equal(q.landed()?.pts.length, 1); assert.equal(sent.length, n0 + 1, 'nothing went out for the repeat')
  assert.equal(q.pending, false)
}
console.log('probe-cache ok')
