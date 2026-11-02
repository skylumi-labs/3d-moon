import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { PatchLayer, type PatchManifest, type PatchLevel } from '../src/moon/patch/PatchLayer.ts'
import { validateManifest } from '../src/moon/patch/manifest.ts'
import { wantsLevel, overlapWeight } from '../src/moon/patch/demand.ts'
import { fetchPatchAsset, wireLength } from '../src/moon/patch/assets.ts'
import { LoadProgress } from '../src/net/load.ts'

const demand = (altitudeKm: number, metresPerPixel: number, zoomedIn = true) => ({ altitudeKm, metresPerPixel, zoomedIn })
assert.equal(wantsLevel({ texelM: 2 }, demand(8, 4, false)), false, 'selection alone never loads fine')
assert.equal(wantsLevel({ texelM: 2 }, demand(8, 8)), true, 'tour proximity counts')
assert.equal(wantsLevel({ texelM: 2, maxAltitudeKm: 10 }, demand(11, 8)), false)
assert.equal(wantsLevel({ texelM: 2, maxAltitudeKm: 10 }, demand(11, 10), true), true, 'hysteresis')
assert.equal(wantsLevel({ texelM: 60, maxAltitudeKm: 250 }, demand(250, 240)), true)
assert.equal(wantsLevel({ texelM: 2 }, demand(NaN, 1)), false)
assert.equal(overlapWeight(0, 400), 0)
assert.equal(overlapWeight(400, 400), 1)
const e = 1e-4
assert.ok(overlapWeight(e, 400) < 1e-15, 'flat overlap boundary')

const bytes = new Map<string, Uint8Array>()
const levels: PatchLevel[] = [60, 8, 2, 0.5].map((texelM, i) => {
  const heights = `h${i}.bin`, detail = `d${i}.bin`
  if (i < 3) bytes.set(heights, new Uint8Array(32 * 32 * 2))
  bytes.set(detail, new Uint8Array(32 * 32).fill(128 + i))
  return { name: `L${i}`, w: 32, h: 32, texelM, texelEastM: texelM, texelNorthM: texelM,
    eastM: -16 * texelM, northM: 16 * texelM, heights: i < 3 ? heights : undefined, detail,
    maxAltitudeKm: i === 0 ? 250 : 10,
    provenance: { kind: 'synthetic-fixture', source: 'test generated', license: 'fixture',
      coordinateFrame: 'moon-site-east-north-metres', verticalDatum: '1737400 metre sphere', referenceRadiusM: 1737400,
      registrationErrorM: 0, heightSourceTexelM: texelM, imageSourceTexelM: texelM } }
})
const m: PatchManifest = { version: 2, levels, site: { name: 'fixture', lon: 0, lat: 0, groundM: 0 },
  h0M: 0, credit: 'synthetic fixture', light: { time: '', sunElevationDeg: 0, sunEastFromNorthDeg: 0 },
  assets: Object.fromEntries([...bytes].map(([name, b]) => [name, { bytes: b.length, sha256: createHash('sha256').update(b).digest('hex') }])) }
validateManifest(m, 7)
assert.throws(() => validateManifest({ ...m, capabilities: ['continuous-mid-v1'] }, 7), /capability/, 'fixtures cannot advertise measured data')
assert.throws(() => validateManifest({ ...m, levels: [levels[1], levels[0]] }, 7), /coarse to fine/)
assert.throws(() => validateManifest({ ...m, levels: [{ ...levels[0], heights: '../secret' }] }, 7), /asset path/)
const calls: string[] = []
let fail = false, delayed: (() => void) | null = null
const fetchImpl: typeof fetch = async (input, init) => {
  const name = String(input).split('/').at(-1)!
  init?.signal?.throwIfAborted()
  calls.push(name)
  if (name === 'manifest.json') return Response.json(m)
  if (name === 'h2.bin' && fail) return new Response('', { status: 404 })
  if (name === 'h2.bin' && delayed !== null) {
    await new Promise<void>((resolve, reject) => {
      delayed = resolve
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    })
  }
  const b = bytes.get(name)
  return b ? new Response(gzipSync(b)) : new Response('', { status: 404 })
}
const layer = await PatchLayer.create('https://fixture/', { tier: false, net: { fetchImpl, delaysMs: [] } })
assert.equal(layer.readyCoarse, true)
assert.equal(layer.levels.length, 1)
assert.deepEqual(calls, ['manifest.json', 'h0.bin', 'd0.bin'], 'cold create requests coarse only')
await layer.updateDemand(demand(200, 100, false))
assert.equal(layer.levels.length, 1)
await layer.updateDemand(demand(8, 20))
assert.equal(layer.levels.length, 2)
fail = true
await layer.updateDemand(demand(5, 4))
assert.equal(layer.levels.length, 2, '404 preserves coarse chain')
assert.match(layer.lastError!, /404/)
const failures = calls.length
await layer.updateDemand(demand(5, 4))
assert.equal(calls.length, failures, 'no animation-frame request storm')
fail = false
layer.retryRefinement()
await layer.updateDemand(demand(5, 1))
assert.equal(layer.levels.length, 4)
assert.ok(layer.residentBytes <= 192 * 1024 * 1024)
// A running tour descent holds what it loaded: its own end pose (backed off the site, lifted by the funnel) sits past
// retention for the fine levels, and evicting them mid-descent re-bases the descent and reloads them in a loop.
const resident = layer.levels.length
await layer.updateDemand({ ...demand(300, 200, false), hold: true })
assert.equal(layer.levels.length, resident, 'a running descent keeps its resident levels')
await layer.updateDemand({ ...demand(7, 4), hold: true })
assert.equal(layer.levels.length, resident, 'past retention (4 m per pixel over a 0.6 m level) the descent still holds')
const revision = layer.revision
await layer.updateDemand(demand(300, 200, false))
assert.equal(layer.levels.length, 1, 'zoom-out releases fine textures')
assert.ok(layer.revision > revision)
// Abort a fine request and prove it can be requested again, without explicit failed-data retry.
const beforeAbort = calls.length
delayed = () => undefined
const refinement = layer.updateDemand(demand(5, 4))
for (let i = 0; i < 100 && !calls.slice(beforeAbort).includes('h2.bin'); i++) await new Promise(r => setImmediate(r))
await layer.updateDemand(demand(300, 200, false))
await refinement
delayed = null
await layer.updateDemand(demand(5, 4))
assert.equal(layer.levels.length, 3, 'aborted demand is retryable')
layer.dispose()
await layer.updateDemand(demand(1, 1))
assert.equal(layer.loading, false)

const progress = new LoadProgress()
const raw = new Uint8Array([1, 2, 3, 4])
const sha256 = createHash('sha256').update(raw).digest('hex')
assert.deepEqual(await fetchPatchAsset('fixture', 4, progress, { fetchImpl: async () => new Response(gzipSync(raw)), delaysMs: [] }, { bytes: 4, sha256 }), raw)
await assert.rejects(fetchPatchAsset('fixture', 3, progress, { fetchImpl: async () => new Response(gzipSync(raw)), delaysMs: [] }), /exceeds declared size/)
await assert.rejects(fetchPatchAsset('fixture', 4, progress, { fetchImpl: async () => new Response(raw), delaysMs: [] }, { bytes: 4, sha256: '0'.repeat(64) }), /checksum/)
// The card's bar (owner walkthrough 2026-10-31: "Loading the photograph" with no bar while a 22 MB band streamed): a stored-as-is file reports its wire length.
assert.equal(wireLength(new Response('x', { headers: { 'content-length': '22428658' } })), 22428658)
assert.equal(wireLength(new Response('x', { headers: { 'content-length': '100', 'content-encoding': 'gzip' } })), null, 'a transfer encoding: the body is not the counted bytes')
assert.equal(wireLength(new Response('x', { headers: {} })), null)
{
  const gz = gzipSync(raw)
  const p = new LoadProgress()
  const seen: (number | null)[] = []
  p.onChange = (s) => seen.push(s.fraction)
  await fetchPatchAsset('sized', 4, p, { fetchImpl: async () => new Response(gz, { headers: { 'content-length': String(gz.length) } }), delaysMs: [] })
  assert.ok(seen.some((f) => f !== null && f < 1), 'a known length gives a moving fraction before the end')
  assert.equal(p.snapshot().fraction, 1)
}
await assert.rejects(PatchLayer.create('https://fixture/', { tier: false, maxSamplers: 1, net: { fetchImpl, delaysMs: [] } }), /sampler budget/)
assert.match(fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), /arrivalPatchDemand\(!!\(descent \|\| arrivalHold\), \{ altitudeKm, metresPerPixel: altitudeKm \* 1000 \* canvasTanPerPx, zoomedIn: close, hold: false \}\)/, 'main asks for every level, and holds them, while a descent or the arrival hold runs')
assert.match(fs.readFileSync(new URL('../src/descent/arrival.ts', import.meta.url), 'utf8'), /ARRIVAL_PATCH_DEMAND: PatchDemand = \{ altitudeKm: 0, metresPerPixel: 0\.01, zoomedIn: true, hold: true \}/, 'the scripted demand is every level, retained')
console.log('terrain-demand.test.mts: camera demand, provenance, bounded gzip, failures, abort/retry, budgets: ok')

// A legacy 8 m first level is high-resolution too, regardless of the word "coarse".
const legacy = { ...m, version: 1, assets: undefined, levels: m.levels.slice(1) }
const legacyFetch: typeof fetch = async (input, init) => String(input).endsWith('manifest.json') ? Response.json(legacy) : fetchImpl(input, init)
const beforeLegacy = calls.length
const distantLegacy = await PatchLayer.create('https://fixture/', { tier: false, net: { fetchImpl: legacyFetch, delaysMs: [] } })
assert.equal(distantLegacy.levels.length, 0)
assert.equal(distantLegacy.readyCoarse, false)
await distantLegacy.updateDemand(demand(500, 400, false))
assert.equal(calls.length, beforeLegacy, 'distant legacy selection makes no raster request')
await distantLegacy.updateDemand(demand(5, 10))
assert.equal(distantLegacy.readyCoarse, true, 'actual proximity admits legacy NAC without new-band deadlock')
distantLegacy.dispose()
const closeLegacy = await PatchLayer.create('https://fixture/', { tier: false, initialDemand: demand(5, 10), net: { fetchImpl: legacyFetch, delaysMs: [] } })
assert.equal(closeLegacy.levels.length, 1)
closeLegacy.dispose()
