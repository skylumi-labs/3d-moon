// The deep (SLDEM 59 m) ground is read through a smoothing kernel by the shadow march and the slope (moonShader.ts tileHs). The shader text is
// checked here, and the kernel's effect on the data's own failure (noise at the texel scale reads as a 1 to 3 degree horizon, so a Sun a degree
// over the horizon shadows flat mare as speckle) on a synthetic plane, with the same 3 x 3 binomial taps the shader uses.
import assert from 'node:assert/strict'
import { DEEP_PENUMBRA_DEG, moonCoverFragment, moonFragment } from '../src/moon/moonShader.ts'

for (const deepest of [-1, -2, -3]) {
  for (const patch of [null, [{ h: true, r: false, fadeM: 10 }] as const]) {
    const f = moonFragment(180, 4096, '', true, patch as never, false, deepest)
    assert.ok(f.includes('float tileHs(Tile t, int l, vec2 df)'), `tileHs at ${deepest}`)
    assert.ok(f.includes('acc += rem * t.a * tileHs(t, l, vec2(0.0));'), 'the march reads the smoothed height')
    assert.ok(f.includes('float hE = tileHs(t, l,') && f.includes('float hN = tileHs(t, l,'), 'the slope reads the smoothed height')
    assert.ok(f.includes('float marchAng(') && f.includes('hw *= 0.5;'), 'the horizon is refined around the winning sample')
    assert.ok(f.includes(`wSun = max(wSun, ${DEEP_PENUMBRA_DEG.toFixed(3)} * gDeepK);`), 'penumbra floor over deep ground')
  }
  assert.ok(moonCoverFragment(180, 4096, null, deepest).includes('tileHs'), 'pass 1 and pass 2 read one ground')
}
// Depth 0 carries none of it (scripts/fixtures/moon-shader-depth0.json is the frozen text; tile-levels.test.mts compares).
const f0 = moonFragment(180, 4096, '', true)
for (const w of ['tileHs', 'marchAng', 'gDeepK']) assert.ok(!f0.includes(w), `${w} absent at depth 0`)

// Kernel twin on a noisy plane. Sun at 1.3 degrees over the horizon, heights 2 m of white noise (rms) at a 59 m spacing, 1 m quantised.
const N = 160, TEX = 0.0592, R = 1737.4
let seed = 12345
const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
const gauss = (): number => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd())
const raw = new Float32Array(N * N)
for (let i = 0; i < raw.length; i++) raw[i] = Math.round(2 * gauss())
const at = (h: Float32Array, x: number, y: number): number => h[Math.min(N - 1, Math.max(0, Math.round(y))) * N + Math.min(N - 1, Math.max(0, Math.round(x)))]
const bil = (h: Float32Array, x: number, y: number): number => {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0
  return (at(h, x0, y0) * (1 - fx) + at(h, x0 + 1, y0) * fx) * (1 - fy) + (at(h, x0, y0 + 1) * (1 - fx) + at(h, x0 + 1, y0 + 1) * fx) * fy
}
const smooth = (h: Float32Array, o: number): Float32Array => {
  const out = new Float32Array(N * N), w = [0.25, 0.5, 0.25]
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let a = 0
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) a += w[i + 1] * w[j + 1] * bil(h, x + i * o, y + j * o)
    out[y * N + x] = a
  }
  return out
}
const litShare = (h: Float32Array, elDeg: number): number => {
  let sum = 0, n = 0
  for (let y = 30; y < 130; y++) for (let x = 20; x < 60; x++) {
    const h0 = bil(h, x, y)
    let best = -9
    for (let k = 0; k < 40; k++) {
      const d = 0.06 * Math.pow(0.25 / 0.06, k / 6)
      const dd = k < 6 ? d : 0.25 * (k - 5)
      best = Math.max(best, Math.atan2((bil(h, x + dd / TEX, y) - h0) * 1e-3 - dd * dd / (2 * R), dd))
    }
    sum += best < (elDeg * Math.PI) / 180 ? 1 : 0
    n++
  }
  return sum / n
}
const shadowRaw = 1 - litShare(raw, 1.3), shadowSmooth = 1 - litShare(smooth(raw, 2), 1.3)
assert.ok(shadowRaw > 0.2, `noise alone shadows ${(shadowRaw * 100).toFixed(0)} % of a flat plane at 1.3 degrees`)
assert.ok(shadowSmooth < 0.4 * shadowRaw, `the smoothed ground shadows ${(shadowSmooth * 100).toFixed(0)} %, under 0.4 of the raw ${(shadowRaw * 100).toFixed(0)} %`)
// The penumbra floor is the angle of 1 m over the 120 m kernel.
assert.ok(Math.abs(DEEP_PENUMBRA_DEG - 0.477) < 0.01)
console.log(`deep-smooth ok (flat plane shadowed: raw ${(shadowRaw * 100).toFixed(0)} %, smoothed ${(shadowSmooth * 100).toFixed(0)} %)`)
// Shadow fill: slope-shaded over deep ground, unchanged elsewhere.
assert.ok(moonFragment(180, 4096, '', true, null, false, -3).includes('fillShade'), 'deep fill follows the slope')
assert.ok(!moonFragment(180, 4096, '', true).includes('fillShade'), 'depth 0 fill unchanged')
