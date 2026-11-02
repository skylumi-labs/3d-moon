import assert from 'node:assert/strict'
import { MOMENTS, ARCHIVED_MOMENTS } from '../src/moments.ts'
import { LM_DRACO_DIR, LM_DRACO_FILES, LM_MODEL_FILE, momentNeedsLander, prefetchLander, resetLanderPrefetch } from '../src/ground/lmPrefetch.ts'

const all = [...MOMENTS, ...ARCHIVED_MOMENTS]
const wanted = all.filter(momentNeedsLander).map((m) => m.id)
assert.ok(wanted.includes('apollo17'), 'selecting the Apollo 17 moment prefetches the lander')
for (const m of all.filter((x) => x.groundEnd)) assert.ok(wanted.includes(m.id), `${m.id} lands beside the module`)
for (const id of ['first-light', 'earthrise', 'apollo11', 'apollo17-25cm']) {
  if (all.some((m) => m.id === id)) assert.equal(wanted.includes(id), false, `${id} does not need the lander`)
}
assert.ok(wanted.length < all.length / 2, 'unrelated moments do not prefetch')

// The driver: fetches the glTF and the decoder at low priority, imports the chunk, and only once per base.
resetLanderPrefetch()
const urls: string[] = []
const priorities: unknown[] = []
let chunks = 0
const deps = {
  base: '/moon/',
  fetchImpl: async (u: string, init?: { priority?: string }) => { urls.push(u); priorities.push(init?.priority) },
  importChunk: async () => { chunks++ },
}
await prefetchLander(deps)
assert.deepEqual([...urls].sort(), [`/moon/${LM_MODEL_FILE}`, ...LM_DRACO_FILES.map((f) => `/moon/${LM_DRACO_DIR}${f}`)].sort())
assert.ok(priorities.every((p) => p === 'low'), 'low priority so the opening is not slowed')
assert.equal(chunks, 1)
await prefetchLander(deps)
assert.equal(urls.length, 1 + LM_DRACO_FILES.length, 'a second call is a no-op')
assert.equal(chunks, 1)

// A failing network or chunk never rejects.
resetLanderPrefetch()
await prefetchLander({ base: '/x/', fetchImpl: async () => { throw new Error('offline') }, importChunk: async () => { throw new Error('chunk') } })
console.log('lander-prefetch: ok')
