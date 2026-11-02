/**
 * Loading (src/net/load.ts): retries with backoff, honest progress, one failure not spoiling another load.
 *   npm test
 */
import assert from 'node:assert/strict'
import { HttpError, learnLengths, LoadProgress, RETRY_DELAYS_MS, fetchBytes, fetchBytesCached, fetchRetry, prefetchBytes } from '../src/net/load.ts'

const noSleep = (log: number[]) => async (ms: number) => { log.push(ms) }
const ok = (body: Uint8Array, headers: Record<string, string> = {}, pieces = 3): Response => {
  const step = Math.ceil(body.length / pieces)
  const stream = new ReadableStream<Uint8Array>({
    start(c) { for (let i = 0; i < body.length; i += step) c.enqueue(body.slice(i, i + step)); c.close() },
  })
  return new Response(stream, { status: 200, headers })
}
/** A stream that delivers `first` bytes and then errors (a connection cut half way). */
const cut = (body: Uint8Array, first: number, headers: Record<string, string> = {}): Response => new Response(new ReadableStream<Uint8Array>({
  start(c) { c.enqueue(body.slice(0, first)) },
  pull(c) { c.error(new Error('connection reset')) },
}), { status: 200, headers })
const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0x7f)

// 1. Transient failures are retried with the stated waits, then succeed.
{
  let calls = 0
  const waits: number[] = []
  const res = await fetchRetry('x', { sleep: noSleep(waits), fetchImpl: (async () => { calls++; if (calls <= 2) throw new TypeError('network error'); return ok(bytes(4)) }) as typeof fetch })
  assert.equal(res.status, 200)
  assert.equal(calls, 3)
  assert.deepEqual(waits, [500, 2000], 'backs off 0.5 s then 2 s')
  assert.deepEqual(RETRY_DELAYS_MS, [500, 2000, 6000])
}
// 2. 503 and 429 are retried; 404 and 403 are not (asking again cannot change them); the error names the tries.
{
  let calls = 0
  const waits: number[] = []
  await assert.rejects(fetchRetry('x', { sleep: noSleep(waits), fetchImpl: (async () => { calls++; return new Response('', { status: 503 }) }) as typeof fetch }), /after 4 tries/)
  assert.equal(calls, 4)
  assert.deepEqual(waits, [500, 2000, 6000])
  for (const status of [404, 403]) {
    calls = 0
    await assert.rejects(fetchRetry('x', { sleep: noSleep([]), fetchImpl: (async () => { calls++; return new Response('', { status }) }) as typeof fetch }), (e) => e instanceof HttpError && e.status === status)
    assert.equal(calls, 1, `${status} is asked once`)
  }
  calls = 0
  await fetchRetry('x', { sleep: noSleep([]), fetchImpl: (async () => { calls++; return calls === 1 ? new Response('', { status: 429 }) : ok(bytes(2)) }) as typeof fetch })
  assert.equal(calls, 2, '429 is retried')
}
// 3. Progress: monotone, unknown total stays null, never 1 until the file is done, a complete body comes back intact.
{
  const body = bytes(1000)
  const p = new LoadProgress()
  const seen: Array<number | null> = []
  p.onChange = (s) => seen.push(s.fraction)
  const out = await fetchBytes('u', p, { fetchImpl: (async () => ok(body, { 'content-length': '1000' }, 4)) as typeof fetch })
  assert.deepEqual(Array.from(out), Array.from(body))
  const fr = seen.filter((v): v is number => v !== null)
  assert.ok(fr.length >= 4, 'reports as it goes')
  for (let i = 1; i < fr.length; i++) assert.ok(fr[i] >= fr[i - 1], 'fraction never goes back')
  assert.ok(fr.slice(0, -1).every((v) => v < 1), 'not 1 before the last byte')
  assert.equal(fr[fr.length - 1], 1)
  assert.equal(p.snapshot().done, true)
}
{
  // No Content-Length: no percentage is invented.
  const p = new LoadProgress()
  const fr: Array<number | null> = []
  p.onChange = (s) => { if (!s.done) fr.push(s.fraction) }
  await fetchBytes('u', p, { fetchImpl: (async () => ok(bytes(300), {}, 3)) as typeof fetch })
  assert.ok(fr.length > 0 && fr.every((v) => v === null), 'unknown total stays unknown')
  // A compressed-in-transit response has a length that does not match what the reader yields: also unknown.
  const p2 = new LoadProgress()
  const fr2: Array<number | null> = []
  p2.onChange = (s) => { if (!s.done) fr2.push(s.fraction) }
  await fetchBytes('u', p2, { fetchImpl: (async () => ok(bytes(300), { 'content-length': '100', 'content-encoding': 'gzip' }, 3)) as typeof fetch })
  assert.ok(fr2.every((v) => v === null), 'content-encoding: no percentage')
}
// 4. Several files: the total is claimed only once every length is known, and is the sum.
{
  const p = new LoadProgress()
  p.expect('a'); p.expect('b')
  assert.equal(p.snapshot().total, null)
  p.restart('a', 100)
  assert.equal(p.snapshot().total, null, 'b has not said how long it is')
  p.restart('b', 300)
  p.add('a', 50)
  const s = p.snapshot()
  assert.equal(s.total, 400)
  assert.equal(s.fraction, 50 / 400)
  p.add('a', 50); p.finish('a'); p.add('b', 300)
  assert.ok((p.snapshot().fraction as number) <= 0.99, 'one file still open: not 100%')
  p.finish('b')
  assert.equal(p.snapshot().fraction, 1)
}
// 5. A stream cut half way restarts the file: the result is whole and the progress went back to zero, not past the total.
{
  const body = bytes(600)
  let calls = 0
  const waits: number[] = []
  const p = new LoadProgress()
  let peak = 0
  p.onChange = (s) => { peak = Math.max(peak, s.loaded) }
  const out = await fetchBytes('u', p, { sleep: noSleep(waits), fetchImpl: (async () => (++calls === 1 ? cut(body, 200, { 'content-length': '600' }) : ok(body, { 'content-length': '600' }))) as typeof fetch })
  assert.deepEqual(Array.from(out), Array.from(body))
  assert.equal(calls, 2)
  assert.deepEqual(waits, [500])
  assert.equal(p.snapshot().retries, 1)
  assert.equal(p.snapshot().loaded, 600, 'counted once, not 800')
  assert.ok(peak <= 600, 'progress restarted instead of going past the total')
}
// 6. Failure isolation: one file failing for good leaves the others' bytes and progress intact; it reports, it does not hang.
{
  const p = new LoadProgress()
  let badCalls = 0
  const fetchImpl = (async (url: string) => { if (url === 'bad') { badCalls++; return new Response('', { status: 404 }) } return ok(bytes(100), { 'content-length': '100' }) }) as typeof fetch
  const o = { fetchImpl, sleep: noSleep([]) }
  const r = await Promise.allSettled([fetchBytes('good1', p, o), fetchBytes('bad', p, o), fetchBytes('good2', p, o)])
  assert.equal(badCalls, 1, 'a 404 is not retried')
  assert.deepEqual(r.map((x) => x.status), ['fulfilled', 'rejected', 'fulfilled'])
  assert.equal(p.snapshot().filesDone, 2)
}
// 7. A prefetch is reused by the real load (one request), and a failed prefetch falls back to a real one.
{
  let calls = 0
  const fetchImpl = (async () => { calls++; return ok(bytes(50), { 'content-length': '50' }) }) as typeof fetch
  prefetchBytes('pre', { fetchImpl })
  const p = new LoadProgress()
  const out = await fetchBytesCached('pre', p, { fetchImpl })
  assert.equal(out.length, 50)
  assert.equal(calls, 1, 'one request for prefetch plus load')
  assert.equal(p.snapshot().done, true)
  let n = 0
  const flaky = (async () => { n++; if (n === 1) return new Response('', { status: 404 }); return ok(bytes(10), { 'content-length': '10' }) }) as typeof fetch
  prefetchBytes('pre2', { fetchImpl: flaky })
  const out2 = await fetchBytesCached('pre2', null, { fetchImpl: flaky })
  assert.equal(out2.length, 10)
  assert.equal(n, 2)
}
// 8. Lengths learned by HEAD make the total known before the bodies start; a file's own length still wins once it reports.
{
  const p = new LoadProgress()
  p.expect('a'); p.expect('b')
  const heads = async (url: string) => new Response(null, { status: 200, headers: { 'content-length': url === 'a' ? '100' : '300' } })
  learnLengths(['a', 'b'], p, { fetchImpl: heads as typeof fetch })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(p.snapshot().total, 400, 'total known while both files are still queued')
  p.restart('a', 120)
  assert.equal(p.snapshot().total, 420, "the file's own length replaces the HEAD's")
  const q = new LoadProgress()
  q.expect('x')
  learnLengths(['x'], q, { fetchImpl: (async () => { throw new Error('offline') }) as typeof fetch })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(q.snapshot().total, null, 'a failed HEAD claims nothing')
}

// Prefetch (src/net/prefetch.ts): manifest shared, coarse tiles of the targets PREFETCH_PARALLEL at a time, nothing on save-data, replaced by a new list.
{
  const { TilePrefetcher, forgetManifests, prefetchAllowed, tilesFor } = await import('../src/net/prefetch.ts')
  const { levelTiles } = await import('../src/moon/tiles/grid.ts')
  assert.equal(prefetchAllowed({ saveData: true }), false)
  assert.equal(prefetchAllowed({ effectiveType: '3g' }), false)
  assert.equal(prefetchAllowed({ effectiveType: 'slow-2g' }), false)
  assert.equal(prefetchAllowed({ effectiveType: '4g' }), true)
  assert.equal(prefetchAllowed(undefined, '?prefetch=off'), false)
  const present = [0, 1, 2].map((l) => '1'.repeat(levelTiles(l)))
  const man = { present }
  // Tycho (-11.4, -43.3): level 2 (20 deg) then level 1 (10 deg), coarsest first.
  assert.deepEqual(tilesFor(man, { lon: -11.4, lat: -43.3 }), [{ level: 2, tx: 8, ty: 6 }, { level: 1, tx: 16, ty: 13 }])
  const holey = { present: [present[0], present[1], '0'.repeat(levelTiles(2))] }
  assert.deepEqual(tilesFor(holey, { lon: -11.4, lat: -43.3 }).map((t) => t.level), [1], 'a tile the set lacks is skipped')

  forgetManifests()
  const log: string[] = []
  let manifestCalls = 0
  const f = (async (u: string) => {
    if (u.endsWith('manifest.json')) { manifestCalls++; return new Response(JSON.stringify({ version: 1, present })) }
    log.push(u.replace('t/', ''))
    return new Response(new Uint8Array([1, 2, 3]))
  }) as unknown as typeof fetch
  const pf = new TilePrefetcher('t/', f)
  await pf.prefetch([{ lon: -11.4, lat: -43.3 }, { lon: -20.1, lat: 9.6 }])
  await pf.prefetch([{ lon: -11.4, lat: -43.3 }])
  assert.equal(manifestCalls, 1, 'one manifest request however many prefetches')
  assert.equal(log.length, 8, 'four tiles, a height and a colour file each; the repeat fetches nothing')
  assert.equal(log[0], 'h/2/8_6.bin.gz')
  assert.equal(pf.stats.done, 8)
  const got = await pf.take('h/2/8_6.bin.gz')
  assert.equal(got?.byteLength, 3)
  assert.equal(pf.take('h/2/8_6.bin.gz'), null, 'handed over once')

  // A new list replaces the queue: the first target's tiles never start when a second call lands before them.
  forgetManifests()
  const seen: string[] = []
  const gate: (() => void)[] = []
  const slow = (async (u: string) => {
    if (u.endsWith('manifest.json')) return new Response(JSON.stringify({ version: 1, present }))
    seen.push(u)
    await new Promise<void>((r) => gate.push(r))
    return new Response(new Uint8Array([9]))
  }) as unknown as typeof fetch
  const p2 = new TilePrefetcher('t/', slow)
  const first = p2.prefetch([{ lon: -11.4, lat: -43.3 }, { lon: -20.1, lat: 9.6 }, { lon: 60, lat: 40 }])
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(seen.length, 6, 'three tiles (two files each) at a time')
  void p2.prefetch([{ lon: 100, lat: 10 }])
  const pump = setInterval(() => { while (gate.length) gate.shift()!() }, 5)
  await first
  await new Promise((r) => setTimeout(r, 40))
  clearInterval(pump)
  assert.ok(seen.some((u) => u.includes('h/2/14_4.')), 'the replacement list ran')
  assert.ok(!seen.some((u) => u.includes('h/2/12_2.')), 'the replaced list\'s third target never started')
}
console.log('load.test: ok')
