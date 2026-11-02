// eastWestAntiAlias: removes a column ripple poleward of ~40 degrees, leaves low latitudes bit-identical, keeps the relief.
import assert from 'node:assert/strict'
import { H_SIZE } from '../src/moon/tiles/grid.ts'
import { eastWestAntiAlias, tileRowLat, prepareHeights } from '../src/moon/tiles/smoothDeep.ts'

const N = H_SIZE
const mk = (f: (x: number, y: number) => number): Float32Array => { const a = new Float32Array(N * N); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) a[y * N + x] = f(x, y); return a }
// Level 0 tile row ty = 6 starts at 60 N: every row is poleward of 55 degrees.
const hi = 6, lo = 17 // lo: the tile just north of the equator (lat 5 .. 0)
assert.ok(tileRowLat(0, hi, 1) < 60 && tileRowLat(0, hi, 1) > 59.9)
let seed = 11
const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
const col = Array.from({ length: N }, () => (rnd() - 0.5) * 8)
const ripple = mk((x, y) => 20 * x + 3 * y + col[x])
const out = eastWestAntiAlias(ripple, 0, hi)
const rip = (a: Float32Array): number => { let t = 0; for (let y = 8; y < N - 8; y += 9) for (let x = 12; x < N - 12; x++) t += Math.abs(a[y * N + x - 1] + a[y * N + x + 1] - 2 * a[y * N + x] - 0); return t }
assert.ok(rip(out) < rip(ripple) * 0.75, `ripple ${rip(ripple)} -> ${rip(out)}`)
// A tilted plane (no ripple) is unchanged inside the tile (the kernel is symmetric; edges shrink their offset).
const plane = mk((x, y) => 20 * x + 3 * y)
const po = eastWestAntiAlias(plane, 0, hi)
for (const x of [30, 100, 200]) assert.ok(Math.abs(po[100 * N + x] - plane[100 * N + x]) < 1e-3, 'plane unchanged')
// Low latitudes come back as the same array, and ewaa off is the identity.
assert.ok(eastWestAntiAlias(ripple, 0, lo) === ripple, 'low latitudes: same array')
// Deep levels go through the two-way smoothing, not this filter.
assert.ok(prepareHeights(ripple, -2, hi) !== ripple)
// Seam: the rows of two vertically adjacent tiles at the same latitude get the same filter (row-based, not tile-based).
assert.ok(Math.abs(tileRowLat(0, hi, N - 2) - tileRowLat(0, hi + 1, 0)) < 0.05)
console.log('east-west anti-alias ok')
// A period-2 ripple (alternating columns) is removed too, not only the spacing-1/cos band.
{
  const alt = mk((x, y) => 20 * x + 3 * y + (x % 2 === 0 ? 4 : -4))
  const ao = eastWestAntiAlias(alt, 0, hi)
  assert.ok(rip(ao) < rip(alt) * 0.1, `alternating ripple ${rip(alt)} -> ${rip(ao)}`)
}
