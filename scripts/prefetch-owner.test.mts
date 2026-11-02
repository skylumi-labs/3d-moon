import assert from 'node:assert/strict'
import { TilePrefetcher } from '../src/net/prefetch.ts'

const manifest = {
  version: 1, tileDeg: 5, levels: 3,
  height: { px: 320, border: 1, stepM: 8, ppd: 64, texelKm: 1 },
  color: { px: 380, border: 1, ppd: 76, texelKm: 1 },
  present: ['1'.repeat(72 * 36), '1'.repeat(36 * 18), '1'.repeat(18 * 9)],
  minQ: [], maxQ: [], source: 'test',
}
let requests = 0
const fetchImpl: typeof fetch = async (input, init) => {
  requests++
  const url = String(input)
  if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifest } as Response
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 12)
    init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')) }, { once: true })
  })
  return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) } as Response
}
const prefetcher = new TilePrefetcher(`https://owner-test-${Date.now()}/`, fetchImpl)
const targets = [{ lon: 0, lat: 0 }]
const idle = prefetcher.prefetch(targets, undefined, undefined, 'idle')
const oldFlight = prefetcher.prefetch(targets, undefined, undefined, 'flight')
await new Promise((resolve) => setTimeout(resolve, 2))
const replacement = prefetcher.prefetch(targets, undefined, undefined, 'flight')
prefetcher.cancel('idle')
await Promise.all([idle, oldFlight, replacement])
assert.ok(requests > 2, 'the replacement waits for its own aborted workers before issuing the new flight list')
assert.ok(prefetcher.stats.done > 0, 'cancelling idle work does not cancel the independently owned flight queue')

const abortRace = new TilePrefetcher(`https://owner-abort-${Date.now()}/`, fetchImpl)
const active = abortRace.prefetch(targets, undefined, undefined, 'race')
await new Promise((resolve) => setTimeout(resolve, 4))
const beforeCancelledReplace = requests
const abort = new AbortController()
const cancelledReplace = abortRace.prefetch(targets, abort.signal, undefined, 'race')
abort.abort()
await Promise.all([active, cancelledReplace])
assert.equal(requests, beforeCancelledReplace, 'abort while waiting for the previous queue prevents replacement workers from starting')
console.log('prefetch-owner.test ok')

// Held files are evicted least-recently-queued first: a tile asked for again survives newer unrelated ones.
{
  const { tileOf, heightPath } = await import('../src/moon/tiles/grid.ts')
  const { prefetchLru, prefeatOn } = await import('../src/net/prefetch.ts')
  assert.equal(prefetchLru(''), true); assert.equal(prefetchLru('?prefetchlru=0'), false)
  assert.equal(prefeatOn(''), false); assert.equal(prefeatOn('?prefeat=1'), true)
  const quick: typeof fetch = async (input) => {
    if (String(input).endsWith('manifest.json')) return { ok: true, json: async () => manifest } as Response
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) } as Response
  }
  const keep = [{ lon: 2.5, lat: 2.5, levels: [2] }]
  const { tx, ty } = tileOf(2, 2.5, 2.5)
  const fillers = Array.from({ length: 90 }, (_, i) => ({ lon: -177.5 + (i % 72) * 5, lat: -87.5 + Math.floor(i / 72) * 5, levels: [0] }))
  const run = async (): Promise<TilePrefetcher> => {
    const p = new TilePrefetcher(`https://owner-lru-${Date.now()}-${Math.random()}/`, quick)
    await p.prefetch(keep, undefined, undefined, 'a')
    await p.prefetch(fillers.slice(0, 40), undefined, undefined, 'a')
    await p.prefetch(keep, undefined, undefined, 'a') // asked again: now the newest
    await p.prefetch(fillers.slice(40), undefined, undefined, 'a')
    return p
  }
  const p = await run()
  assert.ok(p.stats.dropped > 0, 'the held cap was reached')
  assert.ok(p.has(heightPath(2, tx, ty)), 'a tile queued again survives newer files')
}
