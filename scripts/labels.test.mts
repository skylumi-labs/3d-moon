/** The Labels layer: rows carry sources, zoom declutters, collisions drop the lesser label. npm test */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { FEATURES, LABELS, MISSING, SITES, type MoonLabel } from '../src/labels/data.ts'
import { loadGazetteer } from '../src/labels/gazetteerTable.ts'
// The Gazetteer table is a lazy chunk in the app; these checks read it loaded.
await loadGazetteer()
import { placeLabelCandidates, placeLabels, priority, spanKm, zoomAllows } from '../src/labels/declutter.ts'
import { pinBoxes } from '../src/ui/pinLayout.ts'
import { angularDistance } from '../src/camera/pose.ts'
import { PATCH_SITES } from '../src/moon/patch/sites.ts'
import { TYCHO } from '../src/labels/gazetteer.ts'
import { candidatesInSphericalCone, makeSphericalBins, unitVector } from '../src/labels/spatial.ts'
import { CURATED, isCuratedName, normaliseName } from '../src/labels/curated.ts'
import { GAZ_CENTRE_SHARE, pickCentreGazetteer, pickGazetteer } from '../src/labels/gazetteerPick.ts'
import { labelCardLines } from '../src/ui/labelCard.ts'

// Hover cards add only unseen label details. Years and context already shown on a major mission label stay out.
assert.deepEqual(labelCardLines({ kind: 'mission', tier: 1, agency: 'NASA', status: 'crewed', fact: 'First crewed landing, 20 July 1969' }), [
  { kind: 'detail', text: 'NASA · crewed landing' }, { kind: 'action', text: 'Fly there' },
])
assert.deepEqual(labelCardLines({ kind: 'mission', tier: 1, agency: 'NASA', status: 'crewed', fact: 'First crewed landing' }, true), [
  { kind: 'detail', text: 'NASA · crewed landing' }, { kind: 'detail', text: 'First crewed landing' }, { kind: 'action', text: 'Fly there' },
])
assert.deepEqual(labelCardLines({ kind: 'crater', tier: 1 }), [{ kind: 'action', text: 'Fly there' }], 'nothing new means action only')
assert.deepEqual(labelCardLines({ kind: 'crater', tier: 1, sizeKm: 85.2, fact: 'Shown on the label' }), [{ kind: 'detail', text: 'Crater, about 85 km across' }, { kind: 'action', text: 'Fly there' }], 'the size is never on the label, so the card keeps it')
assert.deepEqual(labelCardLines({ kind: 'mare', tier: 1, sub: 'Sea of Tranquility', fact: 'Visible context' }), [
  { kind: 'detail', text: 'Sea of Tranquility' }, { kind: 'action', text: 'Fly there' },
])
const labelCss = readFileSync(new URL('../src/ui/labels.css', import.meta.url), 'utf8')
assert.doesNotMatch(labelCss, /\.ml:hover, \.ml\.hover, \.ml:focus-visible \{[^}]*background/, 'hover has no second bubble behind the label')
assert.match(labelCss, /\.ml:focus-visible \{ outline:/, 'keyboard focus keeps its outline')

// The curated-name skip is apostrophe-safe (the ghost "Chang'e 6", 2026-10-22): a Gazetteer row named with a straight apostrophe
// is the same name as the curated row's curly one, so one place never carries two names. (The bundled Gazetteer holds no
// apostrophe at all and no Chang'e row: the duplicate seen in the recording is not this table's.)
assert.equal(normaliseName('Chang’e  6 '), "Chang'e 6")
assert.equal(normaliseName('Changʼe 6'), "Chang'e 6")
assert.ok(isCuratedName('Chang’e 5') && isCuratedName("Chang'e 5") && isCuratedName('Tycho') && isCuratedName('Mare Crisium'), 'curated names, either apostrophe')
assert.ok(!isCuratedName('Tycho B') && !isCuratedName('Chang-Ngo'), 'other names pass')
// The two tables spell the apostrophe differently (the Gazetteer straight, 82 rows such as "Bel'kovich"; the curated rows curly), so the
// normalisation above is what lets a name match across them. No Chang’e row in the Gazetteer: the pale duplicate is not from here.
assert.ok(FEATURES.filter((f) => f.name.includes("'")).length >= 80 && FEATURES.every((f) => !f.name.includes('’')), 'the Gazetteer writes straight apostrophes')
assert.ok(CURATED.every((l) => !l.name.includes("'")) && CURATED.some((l) => l.name.includes('’')), 'the curated rows write curly ones')
assert.equal(FEATURES.filter((f) => /Chang.e/.test(f.name)).length, 0, 'no Chang’e row in the Gazetteer')
{
  const skip = (g: MoonLabel) => isCuratedName(g.name)
  const rows: MoonLabel[] = [
    { id: 'curated-twin', name: "Chang'e 5", kind: 'crater', lat: 43, lon: -52, sizeKm: 300, source: 'test' },
    { id: 'big', name: 'Big', kind: 'mare', lat: 0, lon: 0, sizeKm: 300, source: 'test' },
  ]
  assert.deepEqual(pickGazetteer(rows, 700, { skip, shown: () => false, inFrame: () => true }).map((g) => g.id), ['big'], 'the twin of a curated name is skipped by the ordinary pick')
  assert.deepEqual(pickCentreGazetteer(rows, 1400, 4, { skip, shown: () => false, inCentre: () => true }).map((g) => g.id), ['big'], 'and by the region fill')
}
// Gazetteer fill eligibility: at least span/20 across, no satellite craters, shown rows kept at two thirds of that, bounded by `cap`.
{
  const row = (id: string, sizeKm: number, extra: Partial<MoonLabel> = {}): MoonLabel => ({ id, name: id, kind: 'crater', lat: 0, lon: 0, sizeKm, source: 'test', ...extra })
  const span = 1400, need = span * GAZ_CENTRE_SHARE
  const rows = [row('small', need * 0.5), row('kept', need * 0.8), row('new-small', need * 0.8), row('mid', need * 1.1), row('large', need * 3), row('sat', need * 4, { featureType: 'Satellite Feature' }), row('site', need * 4, { kind: 'site' }), row('edge', need * 5), row('nosize', 0)]
  const picked = pickCentreGazetteer(rows, span, 4, { skip: () => false, shown: (id) => id === 'kept', inCentre: (g) => g.id !== 'edge' })
  assert.deepEqual(picked.map((g) => g.id), ['kept', 'large', 'mid'], 'a shown row stays (at two thirds) ahead of the newcomers, largest first; satellites, sites, the edge and sizeless rows stay out')
  assert.equal(pickCentreGazetteer(rows, span, 2, { skip: () => false, shown: () => false, inCentre: () => true }).length, 2, 'bounded by the cap')
  // A larger newcomer never evicts a shown row from a full pick (review 2026-10-23: a pick at a size boundary swapped rows every 150 ms).
  const full = pickCentreGazetteer([row('huge', need * 9), ...rows], span, 2, { skip: () => false, shown: (id) => id === 'kept' || id === 'mid', inCentre: () => true })
  assert.deepEqual(full.map((g) => g.id), ['mid', 'kept'], 'the two shown rows keep the whole capacity')
  assert.ok(need > span / 40, 'the fill asks for a bigger feature than the ordinary pick')
}
// The high-span Gazetteer fill selects the largest eligible feature independently in each short grid cell and retains shown rows.
{
  const row = (id: string, sizeKm: number): MoonLabel => ({ id, name: id, kind: 'crater', lat: 0, lon: 0, sizeKm, source: 'test' })
  const shortCells = new Set(['center', 'left-middle'])
  const rows = [row('center-small', 100), row('center-big', 300), row('left-big', 250), row('left-larger', 280), row('not-short', 500), row('sticky', 50), row('satellite', 600)]
  rows[6].featureType = 'Satellite Feature'
  const picked = pickCentreGazetteer(rows, 1400, 4, {
    skip: () => false,
    shown: (id) => id === 'sticky',
    shortCells,
    cellOf: (g, shown) => shown && g.id === 'sticky' ? 'shown:sticky' : g.id.startsWith('center') ? 'center' : g.id.startsWith('left') ? 'left-middle' : g.id === 'not-short' ? 'not-short' : null,
  })
  assert.deepEqual(picked.map((g) => g.id), ['sticky', 'center-big', 'left-larger'], 'largest per short cell plus a shown row; other cells and satellites excluded')
}

// Every row has a source, a finite coordinate and a unique id; a missing value is omitted, not zero-filled.
const ids = new Set<string>()
for (const l of LABELS) {
  assert.ok(l.source.length > 10, `${l.id} source`)
  assert.ok(Number.isFinite(l.lon) && Number.isFinite(l.lat) && Math.abs(l.lat) <= 90 && Math.abs(l.lon) <= 180, `${l.id} coordinate`)
  assert.ok(!ids.has(l.id), `${l.id} duplicate`); ids.add(l.id)
}
for (const name of MISSING) assert.ok(!LABELS.some((l) => l.name === name), `${name} is listed missing but present`)
for (const [id, lon, lat] of [['kepler', -38.0087, 8.121], ['eratosthenes', -11.3162, 14.4737], ['vallis-alpes', 3.6314, 49.2088], ['rupes-recta', -7.7019, -21.6748]] as const) {
  const feature = FEATURES.find((f) => f.id === id)!
  assert.ok(Math.abs(feature.lon - lon) < 1e-5); assert.ok(Math.abs(feature.lat - lat) < 1e-5)
  assert.match(feature.source, /USGS Astrogeology \/ IAU Gazetteer/)
}
// Every crewed Apollo landing is there, six of them, and the crashes are marked.
assert.equal(SITES.filter((s) => s.status === 'crewed').length, 6)
assert.ok(SITES.filter((s) => s.status === 'crashed').length >= 4)
assert.ok(new Set(SITES.map((s) => s.agency)).size >= 8)
// Apollo 11 matches the patch site's own coordinates to a hundred metres.
const a11 = SITES.find((s) => s.id === 'apollo-11')!
assert.ok(Math.abs(a11.lat - 0.6741) < 0.002 && Math.abs(a11.lon - 23.473) < 0.002)

// Declutter by zoom: far out only the crewed sites and the big maria; nearer the robotic ones; on the spot nothing.
const far = (d: number) => LABELS.filter((l) => zoomAllows(l, d, 30)).map((l) => l.id)
const home = far(6)
assert.ok(home.includes('apollo-11') && home.includes('mare-imbrium') && !home.includes('luna-9') && !home.includes('messier'), 'home view')
const mid = far(2.2)
assert.ok(mid.includes('luna-9') && mid.includes('tycho'), 'mid view')
assert.ok(!far(1.002).length, 'no labels on the surface')
assert.ok(spanKm(2, 30) < spanKm(6, 30))
// The bundled official Gazetteer includes every named crater and surface landform except Station features and the single albedo feature.
assert.equal(FEATURES.length, 9080)
assert.equal(FEATURES.filter((l) => l.kind === 'crater').length, 8679)
assert.equal(FEATURES.filter((l) => l.kind === 'range').length, 341)
assert.equal(FEATURES.filter((l) => l.kind === 'mare').length, 60)
assert.equal(LABELS.length, 9111)
assert.equal(LABELS.find((l) => l.id === 'tycho')?.source.includes('Feature/6163'), true)
assert.equal(FEATURES.find((l) => l.id === 'mons-hadley')?.featureType, 'Mons, montes')

// Collisions: the more important label keeps its anchor; the lesser label tries a nearby clear position.
const placed = placeLabelCandidates([
  { id: 'a', x: 100, y: 100, w: 80, h: 20, rank: priority(a11) },
  { id: 'b', x: 110, y: 105, w: 80, h: 20, rank: priority(FEATURES.find((f) => f.id === 'messier')!) },
  { id: 'c', x: 300, y: 100, w: 80, h: 20, rank: 5 },
])
assert.deepEqual([...placed.keys()].sort(), ['a', 'b', 'c'])
assert.equal(placed.get('a')?.offsetX, 0)
assert.ok(placed.get('b')?.offsetX !== 0 || placed.get('b')?.offsetY !== 0)
const aBox = placed.get('a')!, bBox = placed.get('b')!
assert.ok(Math.abs(aBox.x - bBox.x) >= 80 || Math.abs(aBox.y - bBox.y) >= 20)
assert.ok(!placeLabels([{ id: 'z', x: 5, y: 5, w: 40, h: 20, rank: 0 }], [[0, 0, 100, 100]]).size, 'blocked area')
assert.equal(placeLabelCandidates(Array.from({ length: 400 }, (_, i) => ({ id: `c${i}`, x: i * 100, y: 100, w: 20, h: 20, rank: i })), [], undefined, 7, 20).size, 7, 'placement has a hard visible cap')

// Spherical candidate bins must include points whose longitudes diverge near a pole or across the date line.
{
  const nearPole: MoonLabel = { id: 'pole', name: 'Pole', kind: 'crater', lat: 89, lon: 170, source: 'test' }
  const acrossDateLine: MoonLabel = { id: 'idl', name: 'IDL', kind: 'crater', lat: 0, lon: -179, source: 'test' }
  const far: MoonLabel = { id: 'far', name: 'Far', kind: 'crater', lat: 0, lon: 0, source: 'test' }
  const bins = makeSphericalBins([nearPole, acrossDateLine, far])
  const cone = (lat: number, lon: number, radius: number) => candidatesInSphericalCone(bins, ...unitVector(lat, lon), radius).map((l) => l.id)
  assert.ok(cone(89, -10, 2).includes('pole'), 'polar point is not culled by longitude')
  assert.ok(cone(0, 179, 3).includes('idl'), 'date-line neighbor is not culled')
}

// Proximity: rows that must sit near one another or near the app's own positions (review P1-5). Each of these failed on the first branch.
const m = (a: string, b: string) => { const x = LABELS.find((l) => l.id === a)!, y = LABELS.find((l) => l.id === b)!; return angularDistance(x.lon, x.lat, y.lon, y.lat) * 1737400 }
assert.ok(m('apollo-12', 'surveyor-3') < 300, `Surveyor 3 is about 160 m from the Apollo 12 lander, got ${m('apollo-12', 'surveyor-3')} m`)
assert.ok(m('apollo-12', 'surveyor-3') > 50)
for (const [id, site] of [['apollo-11', 'a11'], ['apollo-17', 'a17']] as const) {
  const l = LABELS.find((x) => x.id === id)!, p = PATCH_SITES[site]
  assert.ok(angularDistance(l.lon, l.lat, p.lon, p.lat) * 1737400 < 100, `${id} within 100 m of the patch site point`)
}
assert.equal(LABELS.find((l) => l.id === 'tycho')!.lat, TYCHO.lat); assert.equal(LABELS.find((l) => l.id === 'tycho')!.lon, TYCHO.lon)
import { HOTSPOTS } from '../src/hotspots.ts'
{
  const h = HOTSPOTS.find((x) => x.id === 'pin-tycho')!, p = h.pin(null as never)
  assert.equal(p.lat, TYCHO.lat); assert.equal(p.lon, TYCHO.lon)
}
// Lander rows at the NSSDCA values (a few of them, read from the table on 2026-10-04): IM-2 is east and near the pole, Luna 16 half a degree south.
const at = (id: string) => LABELS.find((l) => l.id === id)!
assert.ok(Math.abs(at('im-2').lat + 84.7906) < 1e-4 && Math.abs(at('im-2').lon - 29.1957) < 1e-4, 'IM-2')
assert.ok(Math.abs(at('luna-16').lat + 0.5137) < 1e-4 && Math.abs(at('surveyor-7').lon + 11.5127) < 1e-4)
// A lander and the Surveyors never sit on a row of another mission by accident (no two rows within 50 m except a deliberate pair).
for (const a of SITES) for (const b of SITES) if (a.id < b.id && angularDistance(a.lon, a.lat, b.lon, b.lat) * 1737400 < 50) assert.fail(`${a.id} and ${b.id} are on top of each other`)
// A pin's dot and label box blocks a label under it (the doubled "Copernicus" of the first branch): the label centred on the pin's dot is dropped, a far one stays.
{
  const [pin] = pinBoxes(400, 300, 110, 1280)
  const kept2 = placeLabels([{ id: 'under', x: 400, y: 300, w: 80, h: 22, rank: 0 }, { id: 'clear', x: 700, y: 300, w: 80, h: 22, rank: 1 }], [pin.box])
  assert.deepEqual([...kept2], ['clear'])
}
console.log('labels.test ok')
