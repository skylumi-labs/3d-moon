import assert from 'node:assert/strict'
import { FINAL_FRAGMENT } from '../src/post/final.ts'

const srgb = (y: number): number => y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055
const short = (x: number): number => 0.02 + 0.98 * Math.pow(x, 0.9)
const oldShoulder = (y: number): number => y > 0.8 ? 0.8 + 0.2 * Math.tanh((y - 0.8) / 0.2) : y
const candidateShoulder = (y: number): number => {
  if (y <= 0.8) return y
  const d = y - 0.8
  return 0.8 + 0.2 * d / (0.2 + d)
}

// These x values cover near-black, sub-white ground, the searched white, and
// slopes whose radiance exceeds a sparse frame search's white point.
const xs = [0.0001, 0.01, 0.1, 1, 1.5, 2]
const mapped = xs.map((x) => candidateShoulder(short(x)))
assert.ok(mapped.every((y, i) => i === 0 || y >= mapped[i - 1]), 'the curve stays monotone through the shoulder')
assert.ok(Math.abs(mapped[0] - short(xs[0])) < 1e-12, 'the shoulder leaves shadow levels unchanged')
assert.ok(Math.abs(mapped[2] - short(xs[2])) < 1e-12, 'the shoulder leaves sub-white ground unchanged')
assert.ok(mapped[3] < oldShoulder(short(1)), 'the searched white keeps more headroom')
assert.ok(mapped[5] < 0.98, 'slopes at twice the searched white retain visible headroom')
assert.ok(mapped[3] > 0.85, 'the searched white remains a bright lunar surface')

for (const x of xs) console.log(`x=${x}: linear=${mapped[xs.indexOf(x)].toFixed(5)}, sRGB=${(255 * srgb(mapped[xs.indexOf(x)])).toFixed(1)}`)
assert.match(FINAL_FRAGMENT, /float d = y - 0\.8;\s*float yOrbit = 0\.8 \+ 0\.2 \* d \/ \(0\.2 \+ d\);/)
Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: '?shoulder=legacy' } })
const legacyUrl = new URL('../src/post/final.ts?shoulder-legacy', import.meta.url)
const legacy = await import(legacyUrl.href) as typeof import('../src/post/final.ts')
assert.match(legacy.FINAL_FRAGMENT, /float yOrbit = 0\.8 \+ 0\.2 \* tanh\(d \/ 0\.2\);/)
console.log('highlight-shoulder.test.mts: ok')
