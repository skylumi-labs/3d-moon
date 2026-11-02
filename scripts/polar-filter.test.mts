import assert from 'node:assert/strict'
import { H_SIZE, levelNy } from '../src/moon/tiles/grid.ts'
import { polarPrefilter, polarWeight } from '../src/moon/tiles/polarFilter.ts'
const n = H_SIZE
const make = (f: (x: number, y: number) => number): Float32Array => Float32Array.from({ length: n * n }, (_, i) => f(i % n, Math.floor(i / n)))
assert.equal(polarWeight(85), 0)
assert.equal(polarWeight(88.5), 1)
assert.equal(polarWeight(-89), polarWeight(89))
const a = make((x, y) => 2 * x + 3 * y)
assert.equal(polarPrefilter(a, -3, 20), a, 'nonpolar terrain is untouched')
assert.equal(polarPrefilter(a, 0, 10), a, 'nonpolar built terrain is untouched')
for (const level of [-3, -1, 0, 2]) for (const ty of [0, levelNy(level) - 1]) {
  const plane = polarPrefilter(a, level, ty)
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(plane[i] - a[i]) < .001, 'linear terrain preserved')
  const ripple = make((x, y) => 2 * x + 3 * y + 5 * Math.sin(x * 1.3))
  const filtered = polarPrefilter(ripple, level, ty)
  let before = 0, after = 0
  // Use a row within 1 degree of either pole even in a 20-degree fallback.
  const y = ty === 0 ? 10 : n - 11
  for (let x = 80; x < n - 80; x++) {
    before += Math.abs(ripple[y * n + x] - a[y * n + x])
    after += Math.abs(filtered[y * n + x] - a[y * n + x])
  }
  assert.ok(after < before * .08, `dense polar filter suppresses ripple: ${before} -> ${after}`)
  for (let y = 0; y < n; y++) for (const x of [0, 1, n - 2, n - 1]) assert.equal(filtered[y * n + x], ripple[y * n + x], 'shared borders preserved')
  assert.ok(filtered.every(Number.isFinite), 'no singularity at either pole')
}
console.log('polar-filter: ok')
