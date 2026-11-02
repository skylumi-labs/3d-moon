/** The close-up Gazetteer names (src/labels/gazetteerPick.ts). npx tsx scripts/gazetteer-pick.test.mts */
import assert from 'node:assert/strict'
import { pickGazetteer, GAZ_CAP, GAZ_SPAN_KM, GAZ_PICK_MS, gazRepickDue } from '../src/labels/gazetteerPick.ts'
import type { MoonLabel } from '../src/labels/data.ts'

const row = (id: string, sizeKm: number, onScreen: boolean, featureType = 'Crater, craters'): MoonLabel & { onScreen: boolean } =>
  ({ id, name: id, kind: 'crater', lon: 0, lat: 0, sizeKm, featureType, source: 'test', onScreen } as MoonLabel & { onScreen: boolean })
const o = (shown: string[] = []) => ({ skip: () => false, shown: (id: string) => shown.includes(id), inFrame: (g: MoonLabel) => (g as MoonLabel & { onScreen: boolean }).onScreen })

// 93 km over Tycho: hundreds of large features in the cone around the camera but off screen, a few small ones in the frame.
// Capping by size before the frame test kept only off-screen names (no names at all on screen, 2026-10-18).
const big = Array.from({ length: 400 }, (_, i) => row(`far-${i}`, 30 + i, false))
const local = [row('tycho-a', 29, true), row('tycho-b', 13, true), row('tycho-x', 4, true, 'Satellite Feature'), row('tiny', 1, true)]
const got = pickGazetteer([...big, ...local], 93, o()).map((g) => g.id)
assert.deepEqual(got, ['tycho-a', 'tycho-b', 'tycho-x'], `on-screen names, largest first (${got})`)
// Too small for the zoom: under span/40 (2.3 km) out; a satellite crater needs 1.6 times that and a span under 450 km.
assert.ok(!got.includes('tiny'), 'too small for the zoom')
assert.deepEqual(pickGazetteer([row('sat', 20, true, 'Satellite Feature')], 500, o()).map((g) => g.id), [], 'satellite only close up')
// Hysteresis: a name on screen stays down to two thirds of the size threshold.
assert.deepEqual(pickGazetteer([row('edge', 2, true)], 93, o(['edge'])).map((g) => g.id), ['edge'], 'kept while shown')
assert.deepEqual(pickGazetteer([row('edge', 2, true)], 93, o()).map((g) => g.id), [], 'not a newcomer')
// Off above GAZ_SPAN_KM; the cap holds.
assert.deepEqual(pickGazetteer(local, GAZ_SPAN_KM, o()), [], 'none above the span')
assert.equal(pickGazetteer(Array.from({ length: 500 }, (_, i) => row(`n${i}`, 10, true)), 93, o()).length, GAZ_CAP, 'capped')
let shownCalls = 0
pickGazetteer([row('too-small', 1, true), row('between', 2, true), row('new', 3, true)], 93, { ...o(), shown: () => { shownCalls++; return false } })
assert.equal(shownCalls, 1, 'skip shown-state lookups below the keep-alive threshold')
assert.equal(GAZ_PICK_MS, 150)
assert.equal(gazRepickDue(null, 0, 100), true)
assert.equal(gazRepickDue({ at: 0, span: 100 }, 100, 100), false)
assert.equal(gazRepickDue({ at: 0, span: 100 }, 151, 100), true)
assert.equal(gazRepickDue({ at: 100, span: 100 }, 110, 116), true, 'repick on a 15% span change')
console.log('gazetteer-pick.test: ok')
