import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { Vector3 } from 'three'
import { bakedUniforms, HorizonStream } from '../src/moon/baked/HorizonStream.ts'
import { ledger } from '../src/quality/ledger.ts'
import { BAKED_GLOBAL_HASH, BAKED_SLOT_BYTES, type HorizonManifest } from '../src/moon/baked/format.ts'
const bytes = new Uint8Array(128 * 128 * 32).fill(12)
const sha256 = createHash('sha256').update(bytes).digest('hex')
const m: HorizonManifest = { version: 1, tileSize: 128, angleMax: 64, nearM: 128, biasM: .5, radiusM: 1737400, globalHash: BAKED_GLOBAL_HASH, site: null,
  sources: [{ id: 'global', kind: 'global', directions: 32, bounds: [0, 0, 1, 1], dx: 1 / 126, dy: 1 / 126 }],
  tiles: [{ id: 'tile', source: 'global', file: 'tile.rgba8.gz', rect: [0, 0, 1, 1], bytes: bytes.length, sha256 }] }
const original = globalThis.fetch
let requests = 0, notices = 0
let missing = false, corrupt = false
const until = async (fn: () => boolean) => { for (let i = 0; i < 500 && !fn(); i++) await new Promise(r => setTimeout(r, 5)); assert.ok(fn(), 'async stream settled') }
try {
  globalThis.fetch = async input => {
    const url = String(input)
    if (url.endsWith('manifest.json')) return new Response(JSON.stringify(m), { headers: { 'content-type': 'application/json' } })
    requests++
    if (missing) return new Response('', { status: 404 })
    return new Response(gzipSync(corrupt ? new Uint8Array(bytes.length) : bytes))
  }
  const uniforms = bakedUniforms()
  const stream = new HorizonStream('https://fixture/', uniforms, 'ios', 16, Infinity, () => notices++)
  await until(() => notices > 0)
  assert.equal(stream.available, false)
  stream.update(null, new Vector3(1, 0, 0), false)
  assert.equal(requests, 0, 'Full makes no table requests')
  stream.update(null, new Vector3(1, 0, 0), true)
  await until(() => stream.stats.resident === 1)
  assert.equal(stream.available, true)
  assert.equal(stream.stats.bytes, BAKED_SLOT_BYTES)
  assert.equal(ledger.byCategory().baked, BAKED_SLOT_BYTES)
  assert.equal(uniforms.uBakedInfo.value[0].y, 32)
  assert.equal(uniforms.uBaked.value.image.data[0], 12)
  stream.update(null, new Vector3(1, 0, 0), true)
  assert.equal(requests, 1, 'Sun-independent tables do not re-fetch at rest')
  stream.dispose()
  assert.equal(ledger.byCategory().baked, 0)
  assert.equal(uniforms.uBakedInfo.value[0].y, 0)
  for (const reason of ['missing', 'corrupt', 'ceiling']) {
    missing = reason === 'missing'; corrupt = reason === 'corrupt'; notices = 0
    const u = bakedUniforms(), s = new HorizonStream('https://fixture/', u, 'ios', 16, reason === 'ceiling' ? 0 : Infinity, () => notices++)
    await until(() => notices > 0)
    s.update(null, new Vector3(1, 0, 0), true)
    await until(() => reason === 'ceiling' ? s.stats.capacity === 0 : s.stats.failed === 1)
    assert.equal(s.available, false, `${reason}: Fast fallback`)
    assert.equal(s.stats.resident, 0)
    assert.equal(u.uBakedInfo.value[0].y, 0, 'failed slot is never published')
    s.dispose()
  }
  assert.equal(ledger.byCategory().baked, 0)
} finally { globalThis.fetch = original }
console.log('baked-stream: decode, checksum, bounded allocation, missing/corrupt/ceiling fallbacks and disposal passed')
