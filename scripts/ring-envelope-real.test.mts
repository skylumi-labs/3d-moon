/**
 * The ring footprint envelope (src/moon/ringEnvelope.ts) on real level-2 ground: a 3 x 3 mosaic of tiles (tx 7..9, ty 3..5: lon -40..20, lat 30..-30 around the
 * equator) from MOON_TILES_DIR. Checks that no near or main sample exceeds the cell bounds (the proved part), that the crest refinement stays inside the padded bound
 * (the measured part: REFINE_PAD_*), and prints the gap distribution (hi - lo) the ring would live with.
 *   MOON_TILES_DIR=.tiles node --import tsx scripts/ring-envelope-real.test.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { reportSkip } from './test-skip.mts'
import { decodeHeightPlanes } from '../src/moon/tiles/codec.ts'
import { H_SIZE, H_STEP_M, H_TEXEL_KM, heightPath } from '../src/moon/tiles/grid.ts'
import { quantizedField, deepNearDistances, footprintEnvelope, liveHorizonDeg, liveHorizonRefinedDeg, marchDistances, sampleDeg, type RingMarch } from '../src/moon/ringEnvelope.ts'

const dir = process.env.MOON_TILES_DIR
const files: string[] = []
for (let ty = 3; ty <= 5; ty++) for (let tx = 7; tx <= 9; tx++) files.push(path.join(dir ?? '', heightPath(2, tx, ty)))
if (!dir || !files.every((f) => fs.existsSync(f))) {
  reportSkip('ring-envelope-real.test', 'data', 'MOON_TILES_DIR not set (or no level-2 tiles 7..9 x 3..5): the real-ground envelope checks did NOT run')
  process.exit(0)
}
const N = H_SIZE - 2, M = 3 * N
const g = new Float32Array(M * M)
files.forEach((f, n) => {
  const tx = n % 3, ty = Math.floor(n / 3)
  const q = decodeHeightPlanes(new Uint8Array(zlib.gunzipSync(fs.readFileSync(f))))
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) g[(ty * N + j) * M + tx * N + i] = q[(j + 1) * H_SIZE + i + 1] * H_STEP_M
})
const f = quantizedField(g, M, M)
const texelKm = H_TEXEL_KM * 4
let seed = 7
const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
const near = deepNearDistances()
const dKm = marchDistances()
const gaps: number[] = []
let probes = 0, outsideMain = 0, outsideRefined = 0, worst = -99
for (let o = 0; o < 400; o++) {
  const phi = rnd() * 2 * Math.PI
  const m: RingMarch = { texelKm, ux: Math.cos(phi), uy: Math.sin(phi), dKm, rKm: 1737.4 }
  const px = 200 + Math.floor(rnd() * (M - 400)), py = 200 + Math.floor(rnd() * (M - 400))
  const e = footprintEnvelope(f, px, py, m, false, near)
  gaps.push(e.hi - e.lo)
  for (let n = 0; n < 40; n++) {
    const dx = rnd() - 0.5, dy = rnd() - 0.5
    const main = Math.max(liveHorizonDeg(f, px, py, m, dx, dy), ...near.map((d) => { const r = d / texelKm; return sampleDeg(f(px + dx + r * m.ux, py + dy + r * m.uy), f(px + dx, py + dy), d, m.rKm) }))
    const live = liveHorizonRefinedDeg(f, px, py, m, near, dx, dy)
    probes++
    if (main > e.hiMain + 1e-9 || main < e.lo - 1e-9) outsideMain++
    if (live > e.hi + 1e-9 || live < e.lo - 1e-9) outsideRefined++
    worst = Math.max(worst, live - e.hi)
  }
}
gaps.sort((a, b) => a - b)
const q = (p: number): number => gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))]
console.log(`ring-envelope-real: ${probes} probes; gap hi-lo p50 ${q(0.5).toFixed(2)} p90 ${q(0.9).toFixed(2)} p99 ${q(0.99).toFixed(2)} deg; refined excess over hi at worst ${worst.toFixed(3)}`)
assert.equal(outsideMain, 0, 'near and main samples stay inside the cell bounds on real ground')
assert.equal(outsideRefined, 0, 'the refined horizon stays inside the padded bounds on real ground')
console.log('ring-envelope-real test ok')
