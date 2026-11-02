/**
 * The Gazetteer table is a lazy chunk (src/labels/gazetteerTable.ts), not part of the entry. This pins: what the app sees before it
 * lands (sites and curated labels only; no crash, no feature prefetch), that after it lands every row is byte-for-byte what the static
 * import used to produce (hashes taken from origin/main's data.ts and curated.ts, 2026-10-18), and that the curated labels' own
 * subset of the table (curatedGazetteer.json) matches the full table. Runs WITHOUT loading the table first, on purpose.
 * npx tsx scripts/gazetteer-lazy.test.mts
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { FEATURES, LABELS, SITES } from '../src/labels/data.ts'
import { CURATED, FAME } from '../src/labels/curated.ts'
import { gazetteerTable, loadGazetteer } from '../src/labels/gazetteerTable.ts'
import { candidatesFor, labelById } from '../src/labels/centrePick.ts'
import { labelIndex } from '../src/labels/spatial.ts'
import { flightPrefetchTargets } from '../src/net/flightPrefetch.ts'

const h = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex')

// Before the table: the curated labels are complete (they carry their own rows), the full list is the sites alone.
assert.equal(gazetteerTable(), null, 'nothing has loaded the table yet')
assert.equal(CURATED.length, 158)
assert.equal(h([CURATED, FAME]), 'fcb878b4e8ee604983dca9ea0ae387df4f46af01737d95c84b4e25704f10ae89', 'curated labels are unchanged from the static-import build')
assert.equal(FEATURES.length, 0)
assert.deepEqual(LABELS, SITES)
assert.equal(labelIndex().units.size, SITES.length, 'the label index builds over the sites alone')
assert.deepEqual(candidatesFor([1, 0, 0], 800), [], 'the centre picker has no feature to offer before the table')
assert.equal(labelById('copernicus'), undefined)
const flight = (): ReturnType<typeof flightPrefetchTargets> =>
  flightPrefetchTargets((u) => ({ pose: { lon: -20 + u * 8, lat: 10, dist: 1.08 - 0.02 * u, pitch: 20 }, fovDeg: 40 }), 10_000, { aspect: 16 / 9, samples: 8 })
const early = flight()
assert.ok(early.length >= 8 && early.every((t) => !t.finestFirst), 'a flight planned before the table prefetches path centres only')

// After: the same rows as the static import produced.
const table = await loadGazetteer()
assert.equal(gazetteerTable(), table)
assert.equal(await loadGazetteer(), table, 'one load, shared')
assert.equal(FEATURES.length, 9080)
assert.equal(LABELS.length, 9111)
assert.equal(h(LABELS), '5cda27f95436e6e0b58153e86567f4a95fac696dccdaf6defc8e597e22cf1f86', 'every label row is unchanged from the static-import build')
assert.equal(labelIndex().units.size, 9111, 'the label index is rebuilt over the full list')
assert.ok(labelById('copernicus'), 'the centre picker sees the features')
assert.ok(flight().some((t) => t.finestFirst), 'a flight planned after the table adds feature targets')

// The curated subset is exactly rows of the full table.
const subset = JSON.parse(readFileSync(new URL('../src/labels/curatedGazetteer.json', import.meta.url), 'utf8')) as { accessed: string; features: unknown[][] }
assert.equal(subset.accessed, table.accessed)
const byId = new Map(table.features.map((r) => [r[0], r]))
for (const r of subset.features) assert.deepEqual(r, byId.get(r[0] as number), `curated row ${String(r[0])} matches the Gazetteer table`)
assert.ok(subset.features.length < 200, 'the curated subset stays small (it ships in the entry)')
console.log('gazetteer-lazy: ok')
