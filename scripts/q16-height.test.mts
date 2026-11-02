import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { PatchLayer, type PatchManifest } from '../src/moon/patch/PatchLayer.ts'
import { validateManifest } from '../src/moon/patch/manifest.ts'
import { decodeHeightPlanes, encodeHeightPlanes } from '../src/moon/tiles/codec.ts'
import { fetchPatchQ16 } from '../src/moon/patch/assets.ts'
import { LoadProgress } from '../src/net/load.ts'

const sourceF32 = new Float32Array([-0.96, 0.11, 1.77, 3.03]), stepM = 0.25
const values = Int32Array.from(sourceF32, v => Math.round(v / stepM))
const qRaw = Buffer.from(encodeHeightPlanes(values, 2, 2)), fRaw = Buffer.from(sourceF32.buffer)
const base = (format: 'q16' | 'f32', raw: Buffer): PatchManifest => {
  const filename = format === 'q16' ? 'height.q16.gz' : 'height.f32.gz'
  return { version: 2, site: { name: 'fixture', lat: 0, lon: 0, groundM: 0 }, h0M: 0,
    light: { time: '', sunElevationDeg: 0, sunEastFromNorthDeg: 0 }, credit: 'fixture',
    levels: [{ name: 'MID', w: 2, h: 2, texelM: 60, texelEastM: 60, texelNorthM: 60, eastM: -60, northM: 60,
      heights: filename, heightFormat: format, ...(format === 'q16' ? { heightStepM: stepM } : {}),
      provenance: { kind: 'measured', source: 'fixture', license: 'fixture', coordinateFrame: 'moon-site-east-north-metres',
        verticalDatum: '1737400 metre sphere', referenceRadiusM: 1737400, registrationErrorM: 0, heightSourceTexelM: 60 } }],
    assets: { [filename]: { bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') } } }
}
const qManifest = base('q16', qRaw)
validateManifest(qManifest, 7)
assert.equal(qManifest.assets!['height.q16.gz'].bytes, 2 * 2 * 2)
assert.throws(() => validateManifest({ ...qManifest, assets: { 'height.q16.gz': { ...qManifest.assets!['height.q16.gz'], bytes: 4 } } }, 7), /declared byte size/)
assert.throws(() => validateManifest({ ...qManifest, levels: [{ ...qManifest.levels[0], heightStepM: undefined }] }, 7), /q16 height step/)
assert.throws(() => validateManifest({ ...qManifest, levels: [{ ...qManifest.levels[0], heightStepM: 0 }] }, 7), /q16 height step/)
const decoded = decodeHeightPlanes(qRaw, 2, 2)
const qF32 = Float32Array.from(decoded, q => q * stepM)
for (let i = 0; i < decoded.length; i++) assert.ok(Math.abs(qF32[i] - sourceF32[i]) <= stepM / 2)

const oldLocation = globalThis.location
Object.defineProperty(globalThis, 'location', { value: { search: '' }, configurable: true })
try {
  const makeLayer = async (manifest: PatchManifest, raw: Buffer) => PatchLayer.create('https://fixture/', { tier: false, floatLinear: true,
    net: { delaysMs: [], fetchImpl: async (input) => String(input).endsWith('manifest.json') ? Response.json(manifest) : new Response(gzipSync(raw)) } })
  const qLayer = await makeLayer(qManifest, qRaw)
  const qImage = qLayer.heights.MID.image.data as Float32Array
  assert.deepEqual([...qImage], [...qF32], 'q16 loader reconstructs quantised source values')
  const fLayer = await makeLayer(base('f32', fRaw), fRaw)
  const fImage = fLayer.heights.MID.image.data as Float32Array
  assert.deepEqual([...fImage], [...sourceF32], 'f32 loader path remains unchanged')
  qLayer.dispose(); fLayer.dispose()

  // The browser worker bridge must receive decode parameters and return the transferred float buffer.
  const originalWorker = globalThis.Worker
  let workerJob: { q16?: { w: number; h: number; stepM: number } } | undefined
  class WorkerFixture {
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    postMessage(job: typeof workerJob): void {
      workerJob = job
      queueMicrotask(() => this.onmessage?.({ data: { type: 'done', buffer: qF32.buffer } } as MessageEvent))
    }
    terminate(): void {}
  }
  Object.defineProperty(globalThis, 'Worker', { value: WorkerFixture, configurable: true })
  try {
    const loaded = await fetchPatchQ16('https://fixture/worker.q16.gz', 2, 2, stepM, new LoadProgress(),
      { delaysMs: [], fetchImpl: async () => new Response(gzipSync(qRaw)) })
    assert.deepEqual([...loaded], [...qF32], 'worker result is the decoded/scaled float height raster')
    assert.deepEqual(workerJob?.q16, { w: 2, h: 2, stepM }, 'worker receives q16 dimensions and quantisation step')
  } finally { Object.defineProperty(globalThis, 'Worker', { value: originalWorker, configurable: true }) }

  // No-worker fallback must give the event loop time to run during large predictor and scale passes.
  Object.defineProperty(globalThis, 'Worker', { value: undefined, configurable: true })
  try {
    const largeQ = new Int32Array(256 * 256).fill(12), largeRaw = encodeHeightPlanes(largeQ, 256, 256)
    let timerRan = false
    setTimeout(() => { timerRan = true }, 0)
    const large = await fetchPatchQ16('https://fixture/large.q16.gz', 256, 256, stepM, new LoadProgress(),
      { delaysMs: [], fetchImpl: async () => new Response(gzipSync(largeRaw)) })
    assert.ok(timerRan, 'timer runs while fallback predictor/scale chunks yield')
    assert.equal(large[large.length - 1], 3)
  } finally { Object.defineProperty(globalThis, 'Worker', { value: originalWorker, configurable: true }) }
} finally { Object.defineProperty(globalThis, 'location', { value: oldLocation, configurable: true }) }
console.log('q16-height.test.mts: manifest validation, encoded round trip, yielding fallback loader, worker dispatch/transfer, unchanged f32 loader: ok')
