import assert from 'node:assert/strict'
import { flightPrefetchTargets } from '../src/net/flightPrefetch.ts'
import { loadGazetteer } from '../src/labels/gazetteerTable.ts'
// The Gazetteer table is a lazy chunk in the app; these checks read it loaded.
await loadGazetteer()

const targets = flightPrefetchTargets((u) => ({
  pose: { lon: -20 + u * 8, lat: 10, dist: 1.08 - 0.02 * u, pitch: 20 },
  fovDeg: 40,
}), 10_000, { aspect: 16 / 9, samples: 8 })
assert.ok(targets.length >= 40, 'at least forty path samples contribute targets')
assert.ok(targets.some((t) => t.levels?.length && t.levels.length > 1), 'targets include fallback levels')
const feature = targets.find((t) => t.finestFirst)
assert.equal(feature?.levels?.[0], -5, 'default (no ?prefeat=1): features keep the full -5 ladder, as before')
assert.deepEqual(targets, flightPrefetchTargets((u) => ({ pose: { lon: -20 + u * 8, lat: 10, dist: 1.08 - 0.02 * u, pitch: 20 }, fovDeg: 40 }), 10_000, { aspect: 16 / 9, samples: 8, featureCaps: false }), 'default equals featureCaps:false')
const flight = (featureCaps: boolean) => flightPrefetchTargets((u) => ({
  pose: { lon: -20 + u * 8, lat: 10, dist: 1.08 - 0.02 * u, pitch: 20 },
  fovDeg: 40,
}), 10_000, { aspect: 16 / 9, samples: 8, featureCaps })
const legacy = flight(false)
assert.ok(legacy.find((t) => t.finestFirst)!.levels![0] === -5, 'without the caps, the full -5 feature ladder')
const count = (list: typeof targets) => list.reduce((n, t) => n + (t.levels?.length ?? 0), 0)
assert.ok(count(flight(true)) < count(legacy), `caps cut level entries (${count(flight(true))} vs ${count(legacy)})`)
// Centres are identical either way: the deepest level of every sample is still asked for.
assert.deepEqual(flight(true).filter((t) => !t.finestFirst), legacy.filter((t) => !t.finestFirst), 'centre targets are unchanged by the caps')
assert.ok(targets.some((t) => Math.abs(t.lon + 9.3) < 0.01 && Math.abs(t.lat - 51.6) < 0.01) === false, 'unrelated Plato is outside this flight swath')
const identity = targets.map((t) => `${t.lon.toFixed(3)}/${t.lat.toFixed(3)}/${t.levels?.join(',')}`)
assert.equal(new Set(identity).size, identity.length, 'targets are deduplicated')
const near = flightPrefetchTargets((u) => ({ pose: { lon: u * 30, lat: 0, dist: 1.01 }, fovDeg: 30 }), 9000, { aspect: 1, samples: 40 })
assert.ok(near.length >= 40)
const startIndex = near.findIndex((t) => Math.abs(t.lon) < 0.001 && Math.abs(t.lat) < 0.001)
const endIndex = near.findIndex((t) => Math.abs(t.lon - 30) < 0.001 && Math.abs(t.lat) < 0.001)
assert.ok(startIndex >= 0 && endIndex > startIndex, 'the first path need precedes the final path need')
const stationary = flightPrefetchTargets(() => ({ pose: { lon: 12, lat: 6, dist: 1.002, pitch: 0 }, fovDeg: 24 }), 6000, { aspect: 390 / 844 })
assert.ok(stationary.length <= 200, 'flight prefetch list is capped')
assert.ok(stationary.filter((target) => target.finestFirst).length <= 30, 'a stationary low camera has a bounded gazetteer set')
assert.equal(stationary[0]?.finestFirst, undefined, 'the centre-ground request is first')
const offSwath = flightPrefetchTargets(() => ({ pose: { lon: 54.1431, lat: 5.5562, dist: 1.002, pitch: 0 }, fovDeg: 24 }), 1000, { aspect: 1 })
assert.equal(offSwath.some((target) => Math.abs(target.lon - 54.7431) < 1e-4 && Math.abs(target.lat - 5.5562) < 1e-4 && target.finestFirst), false,
  'the geometric footprint at this low altitude excludes Abbot 0.6 degrees away')

// Features under ~40 px are dropped.
const high = (featureCaps: boolean) => flightPrefetchTargets((u) => ({ pose: { lon: u * 20, lat: 0, dist: 1.2 }, fovDeg: 30 }), 8000, { aspect: 1, samples: 8, featureCaps })
assert.ok(high(true).filter((t) => t.finestFirst).length < high(false).filter((t) => t.finestFirst).length, 'small features are dropped from a 1.2 R camera')
// The real flights, pinned. These counts move with edits to the gazetteer (src/labels/gazetteerFeatures.json) or the flight paths: re-pin then.
import { ephemerisAt } from '../src/ephemeris.ts'
import { getCinematicFlight, sampleCinematicFlight } from '../src/cinematics/flights.ts'
import { wantedFineAt } from '../src/net/flightPrefetch.ts'
const e = ephemerisAt(new Date('2026-10-17T12:00:00Z'))
const floorAt = (lon: number, lat: number) => 1.02 + Math.abs(Math.sin((lon + lat) * Math.PI / 180)) * 0.003
const groundAt = (lon: number, lat: number) => Math.abs(Math.sin((lon - lat) * Math.PI / 180)) * 0.001
const sampler = (id: string) => { const f = getCinematicFlight(id)!; return { f, at: (u: number) => sampleCinematicFlight(f, u, e, floorAt, groundAt) } }
const real = (id: string, opts: { featureCaps?: boolean; features?: boolean; heightPx?: number }) => {
  const { f, at } = sampler(id)
  return flightPrefetchTargets((u) => { const s = at(u); return { pose: s.pose, fovDeg: s.fovDeg } }, f.seconds * 1000, { aspect: 16 / 9, ...opts })
}
const PINS: Record<string, { targets: number; features: number; tiles: number }> = { 'copernicus-flyover': { targets: 42, features: 41, tiles: 235 }, 'tycho-rim': { targets: 14, features: 13, tiles: 94 } }
const LEGACY_TILES: Record<string, number> = { 'copernicus-flyover': 275, 'tycho-rim': 107 }
for (const [id, want] of Object.entries(PINS)) {
  const on = real(id, { featureCaps: true, heightPx: 1890 }), off = real(id, { featureCaps: false })
  assert.equal(on.length, want.targets, `${id}: target count`)
  assert.equal(on.filter((t) => t.finestFirst).length, want.features, `${id}: feature count`)
  assert.equal(count(on), want.tiles, `${id}: level entries with caps at 1890 px`)
  assert.equal(count(off), LEGACY_TILES[id], `${id}: level entries without caps`)
  assert.deepEqual(on.filter((t) => !t.finestFirst), off.filter((t) => !t.finestFirst), `${id}: sample centres, at every deepest level, unchanged`)
  assert.deepEqual(real(id, { featureCaps: true, features: false }), real(id, { featureCaps: false, features: false }), `${id}: centres-only lists identical`)
  assert.deepEqual(real(id, {}), off, `${id}: default (no ?prefeat=1) is the uncapped list`)
}
// A 1890 px (DPR 2) canvas: the cap follows the streamer's pixel basis, not a 1080 px one.
const finest = (id: string, h: number) => { const { at } = sampler(id); let m = 9; for (let i = 0; i <= 200; i++) { const s = at(i / 200); m = Math.min(m, wantedFineAt(s.pose, s.fovDeg, h).level) } return m }
assert.equal(finest('tycho-rim', 1890), -4, 'tycho-rim wants -4 at 1890 px')
assert.equal(finest('copernicus-flyover', 1890), -5, 'copernicus-flyover arrival wants -5 at 1890 px')
assert.equal(finest('plato-rim', 1890), -4, 'plato-rim low pass wants -4 at 1890 px')
assert.ok(finest('tycho-rim', 1080) > finest('tycho-rim', 1890), 'a shorter canvas wants a coarser level')
console.log('flight-prefetch.test ok')

// The feature scan visits only the rows of each sample's latitude band (#367 round 3d: a pick's two builds cost 33-58 ms of its frame on the
// rig): the targets are byte-for-byte what a scan of every row gave. The hash is of the pre-index implementation's output on these 80
// seeded paths (generated 2026-10-30 from flightPrefetch.ts at ccad951; poles, far views and the feature caps included). A band cut to half
// its reach on one side changes it.
{
  const { createHash } = await import('node:crypto')
  let seed = 7
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  const h = createHash('sha256')
  for (let k = 0; k < 80; k++) {
    const lon0 = rnd() * 360 - 180, lat0 = rnd() * 180 - 90, lon1 = lon0 + (rnd() - 0.5) * 120, lat1 = Math.max(-90, Math.min(90, lat0 + (rnd() - 0.5) * 80))
    const d0 = 1.001 + rnd() ** 2 * 6, d1 = 1.001 + rnd() ** 3 * 4, p0 = rnd() * 80, fov = 10 + rnd() * 50
    h.update(JSON.stringify(flightPrefetchTargets((u) => ({ pose: { lon: lon0 + (lon1 - lon0) * u, lat: lat0 + (lat1 - lat0) * u, dist: d0 + (d1 - d0) * u, pitch: p0 * u }, fovDeg: fov }), 3000,
      { aspect: k % 2 ? 412 / 915 : 16 / 10, heightPx: 2400, featureCaps: k % 3 === 0 })))
  }
  assert.equal(h.digest('hex'), '551b82e6b587ddb1b002c21f5a7720e2e6e7b1252e6003c177a9089789b0aa41', 'the latitude-band scan gives the targets of a scan of every row')
}
