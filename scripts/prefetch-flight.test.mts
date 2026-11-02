/** Flight prefetch requests the destination and three points along its planned path. */
import assert from 'node:assert/strict'
import { flightPrefetchTargets } from '../src/net/prefetch.ts'

const path = [{ lon: 12, lat: 4 }, { lon: 48, lat: 7 }, { lon: 93, lat: 10 }]
const ordinary = flightPrefetchTargets({ lon: 120, lat: 15 }, path, false)
assert.equal(ordinary.length, 4, 'destination plus three path samples')
assert.deepEqual(ordinary[0], { lon: 120, lat: 15, levels: [2, 1] })
assert.deepEqual(ordinary.slice(1), path)
const detailed = flightPrefetchTargets({ lon: 120, lat: 15 }, path, true)
assert.deepEqual(detailed[0].levels, [2, 1, 0], 'a close arrival asks for one finer tile level')
console.log('prefetch-flight.test ok')
