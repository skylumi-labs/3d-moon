// Pins scripts/terrain/verify-a17-mid.mts on synthetic rasters: a good 59 m package passes, each way of getting it wrong fails,
// and the live-copy comparison sees an offset. Nothing here touches the network.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { N59, EXTENT_M, HEIGHTS_FILE, checkMid, compareToLive, type MidManifest } from './terrain/verify-a17-mid.mts'
import { encodeHeightPlanes } from '../src/moon/tiles/codec.ts'

const h0M = -2628, raw0 = (x: number, y: number) => 20 * Math.sin(x / 300) + 15 * Math.cos(y / 250), field = (x: number, y: number) => raw0(x, y) - raw0(N59 / 2, N59 / 2) + 0.2
const f = new Float32Array(N59 * N59); for (let y = 0; y < N59; y++) for (let x = 0; x < N59; x++) f[y * N59 + x] = field(x, y)
const q = Int32Array.from(f, v => Math.round(v / 0.25)), raw = Buffer.from(encodeHeightPlanes(q, N59, N59)), decoded = Float32Array.from(q, v => v * 0.25)
let lo = Infinity, hi = -Infinity; for (const v of decoded) { lo = Math.min(lo, v + h0M); hi = Math.max(hi, v + h0M) }
const texel = EXTENT_M / N59
const good = (): MidManifest => ({ version: 2, capabilities: ['continuous-height-mid-v1'], site: { lat: 20.1911, lon: 30.7723, groundM: f[(N59 / 2) * N59 + N59 / 2] + h0M }, h0M,
  levels: [{ name: 'MID-a17', w: N59, h: N59, texelM: texel, texelEastM: texel, texelNorthM: texel, eastM: -EXTENT_M / 2, northM: EXTENT_M / 2, heights: HEIGHTS_FILE, heightFormat: 'q16', heightStepM: 0.25, maxAltitudeKm: 250,
    provenance: { source: 'SLDEM2015 V2.0; native60m source; quantised 0.25 m', heightSourceTexelM: 59.2253 } }],
  assets: { [HEIGHTS_FILE]: { bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') } }, heightRangeM: [lo, hi] })

assert.deepEqual(checkMid(good(), raw), [])
const mutate = (fn: (m: MidManifest) => void, r = raw) => { const m = good(); fn(m); return checkMid(m, r) }
assert.ok(mutate(m => { delete m.levels[0].heightStepM }).length > 0, 'missing q16 step')
assert.ok(mutate(m => { m.levels[0].heightStepM = 0 }).length > 0, 'zero q16 step')
assert.ok(mutate(m => { m.levels[0].provenance.source += '; effective120m' }).length > 0, 'old provenance text')
assert.ok(mutate(m => { m.h0M = -2000 }).length > 0, 'h0M datum')
assert.ok(mutate(m => { m.assets[HEIGHTS_FILE].sha256 = '0' }).length > 0, 'sha256')
assert.ok(mutate(m => { m.levels[0].w = 1248 }).length > 0, 'width')
assert.ok(mutate(m => { m.levels[0].heights = 'x.f32.gz' }).length > 0, 'file name')
assert.ok(mutate(m => { m.heightRangeM = [lo, hi + 5] }).length > 0, 'range')
const nan = Buffer.from(raw); nan.writeFloatLE(NaN, 400); assert.ok(checkMid(good(), nan).length > 0, 'NaN sample')
assert.ok(checkMid(good(), raw.subarray(0, raw.length - 4)).length > 0, 'truncated')

// comparison: the live 118 m copy is the 2x2 mean of the same field shifted by 3 m
const n = N59 / 2, live = new Float32Array(n * n)
for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) live[y * n + x] = (f[2 * y * N59 + 2 * x] + f[2 * y * N59 + 2 * x + 1] + f[(2 * y + 1) * N59 + 2 * x] + f[(2 * y + 1) * N59 + 2 * x + 1]) / 4 + 3
const c = compareToLive(Buffer.from(f.buffer), h0M, Buffer.from(live.buffer), h0M)
assert.ok(Math.abs(c.rmsM - 3) < 1e-3 && Math.abs(c.meanDiffM + 3) < 1e-3 && Math.abs(c.centreDiffM + 3) < 1e-3, 'comparison sees the 3 m offset')
assert.throws(() => compareToLive(raw, h0M, raw, h0M), /2x apart/)
console.log('verify-a17-mid.test.mts: good package passes, 8 failure modes caught, live comparison reads a planted offset: ok')
