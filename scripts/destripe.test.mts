// destripeHeights: noisy north-south scratch columns are replaced; smooth relief, wide rough areas and coarse levels are left alone.
import assert from 'node:assert/strict'
import { H_SIZE } from '../src/moon/tiles/grid.ts'
import { destripeHeights, stripeColumns } from '../src/moon/tiles/smoothDeep.ts'

const N = H_SIZE
let seed = 7
const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
// A tilted plane with 0.4 m noise: slope 10 m per texel east-west.
const plane = (): Float32Array => { const a = new Float32Array(N * N); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) a[y * N + x] = 10 * x + 2 * y + (rnd() - 0.5) * 0.8; return a }
const base = plane()
const h = new Float32Array(base)
const bad = [100, 101, 102]
for (let y = 0; y < N; y++) for (const x of bad) h[y * N + x] += (rnd() - 0.5) * 12

const flags = stripeColumns(h, 0, 64)
const flagged = Array.from(flags).flatMap((v, i) => (v ? [i] : []))
for (const x of bad) assert.ok(flagged.includes(x), `column ${x} flagged`)
assert.ok(flagged.every((i) => i >= 99 && i <= 103), `nothing else flagged: ${flagged}`) // the neighbours pick up half the roughness

const out = destripeHeights(h, -3)
let before = 0, after = 0
for (let y = 0; y < N; y++) for (const x of bad) { before += Math.abs(h[y * N + x] - base[y * N + x]); after += Math.abs(out[y * N + x] - base[y * N + x]) }
assert.ok(after < before / 8, `scratch error ${before} -> ${after}`)
// Untouched columns are bit-identical.
for (let y = 0; y < N; y++) for (const x of [10, 50, 200, 300]) assert.equal(out[y * N + x], h[y * N + x])
// Coarse levels and clean tiles come back as the same array.
assert.equal(destripeHeights(h, 0), h)
assert.equal(destripeHeights(base, -3), base)
// A wide rough patch (a crater rim, 40 columns) is not a scratch: no column is replaced.
const rough = new Float32Array(base)
for (let y = 0; y < N; y++) for (let x = 120; x < 160; x++) rough[y * N + x] += (rnd() - 0.5) * 12
const rr = destripeHeights(rough, -3)
let worst = 0
for (let i = 0; i < rr.length; i++) worst = Math.max(worst, Math.abs(rr[i] - rough[i]))
assert.ok(worst < 1, `a rough patch moves by column offsets at most (${worst} m), it is not replaced`)
console.log('destripe ok')

// Column offsets: a faint stripe pattern (0.6 m on every 5th column, the whole tile) is found and removed; terrain-sized curvature is not.
const striped = new Float32Array(base)
for (let y = 0; y < N; y++) for (let x = 20; x < N - 20; x += 5) striped[y * N + x] += 0.6
const cleaned = destripeHeights(striped, -2)
const stripeErr = (a: Float32Array): number => { let t = 0; for (let y = 0; y < N; y++) for (let x = 20; x < N - 20; x += 5) t += Math.abs(a[y * N + x] - base[y * N + x]); return t }
assert.ok(stripeErr(cleaned) < stripeErr(striped) * 0.6, `stripe ${stripeErr(striped)} -> ${stripeErr(cleaned)}`)
const bowl = new Float32Array(N * N)
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) bowl[y * N + x] = 0.02 * ((x - 160) ** 2) + 0.01 * ((y - 160) ** 2)
assert.equal(destripeHeights(bowl, -2), bowl, 'a smooth bowl has no stripes')
console.log('destripe offsets ok')
