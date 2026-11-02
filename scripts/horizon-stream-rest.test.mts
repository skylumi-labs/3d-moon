import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Vector3 } from 'three'
import { bakedUniforms, HorizonStream } from '../src/moon/baked/HorizonStream.ts'
import { BAKED_GLOBAL_HASH, gridKey, type HorizonManifest } from '../src/moon/baked/format.ts'

// #195: with Shadows: Baked selected the stream is updated every frame. At rest (same camera, same resident levels) an update must not
// sort the manifest's tiles, filter them, or build the level-stack key strings.
const level = { name: 'L0', heights: 'h.bin', w: 8, h: 8, eastM: 100, northM: 100, texelEastM: 10, texelNorthM: 10 }
const key = gridKey(level as never, 0)
const tiles = Array.from({ length: 400 }, (_, i) => ({ id: `t${i}`, source: 'global', file: `t${i}.rgba8.gz`, rect: [(i % 20) / 20, Math.floor(i / 20) / 20, 1 / 20, 1 / 20] as [number, number, number, number], bytes: 128 * 128 * 32, sha256: 'a'.repeat(64) }))
const m: HorizonManifest = { version: 1, tileSize: 128, angleMax: 64, nearM: 128, biasM: .5, radiusM: 1737400, globalHash: BAKED_GLOBAL_HASH, site: { lat: 20, lon: 30 },
  sources: [
    { id: 'global', kind: 'global', directions: 32, bounds: [0, 0, 1, 1], dx: 1 / 126, dy: 1 / 126 },
    { id: 'patch', kind: 'patch', key, stack: [key], hash: "b".repeat(64), directions: 32, bounds: [0, 0, 100, 100], dx: 1, dy: 1 } as never,
  ],
  tiles }
const original = globalThis.fetch
try {
  globalThis.fetch = async () => new Response(JSON.stringify(m), { headers: { 'content-type': 'application/json' } })
  let notices = 0
  const stream = new HorizonStream('https://fixture/', bakedUniforms(), 'ios', 16, Infinity, () => notices++)
  for (let i = 0; i < 500 && !notices; i++) await new Promise((r) => setTimeout(r, 5))
  assert.ok(notices > 0, 'manifest loaded')
  const patch = { manifest: { site: { lat: 20, lon: 30 }, h0M: 0 }, levels: [level], east: new Vector3(0, 1, 0), north: new Vector3(0, 0, 1) } as never
  const body = new Vector3(1, 0.2, 0.1).normalize()
  stream.update(patch, body, false) // first call builds the caches
  const sort = Array.prototype.sort, filter = Array.prototype.filter, stringify = JSON.stringify
  let sorts = 0, filters = 0, strs = 0
  Array.prototype.sort = function (this: unknown[], ...a: never[]) { sorts++; return sort.apply(this, a) }
  Array.prototype.filter = function (this: unknown[], ...a: never[]) { filters++; return filter.apply(this, a) } as never
  JSON.stringify = ((...a: never[]) => { strs++; return (stringify as (...x: unknown[]) => string)(...a) }) as never
  try { for (let i = 0; i < 100; i++) stream.update(patch, body, false) } finally { Array.prototype.sort = sort; Array.prototype.filter = filter; JSON.stringify = stringify }
  assert.equal(sorts, 0, 'no tile sort at rest')
  assert.equal(filters, 0, 'no tile filter at rest')
  assert.equal(strs, 0, 'no level-stack stringify at rest')
  // A real move still re-ranks.
  let sorts2 = 0
  Array.prototype.sort = function (this: unknown[], ...a: never[]) { sorts2++; return sort.apply(this, a) }
  try { stream.update(patch, new Vector3(-1, 0.5, 0.1).normalize(), false) } finally { Array.prototype.sort = sort }
  assert.ok(sorts2 > 0, 'a moved view re-ranks')
  stream.dispose()

  // The internal forced-Baked mode must activate the stream, request a tile, and expose it as available to the baked shader path.
  const payload = new Uint8Array(128 * 128 * 32)
  payload.fill(127)
  const tileHash = createHash('sha256').update(payload).digest('hex')
  const servingManifest: HorizonManifest = { ...m, tiles: [{ ...tiles[0], file: 'served.rgba8.gz', bytes: payload.byteLength, sha256: tileHash, rect: [0, 0, 1, 1] }] }
  const requested: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input); requested.push(url)
    return url.endsWith('manifest.json')
      ? new Response(JSON.stringify(servingManifest), { headers: { 'content-type': 'application/json' } })
      : new Response(payload)
  }) as typeof fetch
  let servedNotices = 0
  const serving = new HorizonStream('https://fixture/', bakedUniforms(), 'ios', 16, Infinity, () => servedNotices++)
  for (let i = 0; i < 500 && !servedNotices; i++) await new Promise((r) => setTimeout(r, 5))
  assert.ok(servedNotices > 0, 'forced Baked manifest loaded')
  const bodyForGlobal = new Vector3(1, 0.2, 0.1).normalize()
  serving.update(null, bodyForGlobal, true)
  for (let i = 0; i < 500 && !serving.available; i++) await new Promise((r) => setTimeout(r, 5))
  assert.ok(requested.some((url) => url.endsWith('served.rgba8.gz')), 'forced Baked requested the selected data tile')
  assert.equal(serving.available, true, 'the requested baked data is resident and serves the current body location')
  assert.equal(serving.stats.pending, 0)
  serving.dispose()
} finally { globalThis.fetch = original }
console.log('horizon-stream-rest: ok')
