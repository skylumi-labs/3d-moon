// ?deeper=0 drops the manifest's deeper block (A/B for the whole-Moon height data); anything else leaves it.
import assert from 'node:assert/strict'
import { deeperOff, forgetManifests, loadManifest } from '../src/net/prefetch'

assert.equal(deeperOff(''), false)
assert.equal(deeperOff('?deeper=1'), false)
assert.equal(deeperOff('?auto=0&deeper=0'), true)

const man = { version: 1, present: [], deeper: [{ level: -1 }] }
const fetchImpl = (async () => new Response(JSON.stringify(man))) as unknown as typeof fetch
forgetManifests()
assert.ok((await loadManifest('/a/', undefined, fetchImpl) as { deeper?: unknown }).deeper, 'kept without the switch')
;(globalThis as { location?: unknown }).location = { search: '?deeper=0' }
forgetManifests()
assert.equal((await loadManifest('/b/', undefined, fetchImpl) as { deeper?: unknown }).deeper, undefined, 'dropped with ?deeper=0')
console.log('deeper-off: ok')
