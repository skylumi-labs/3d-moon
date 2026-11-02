// smoothDeep.ts: the upload-time smoothing that replaced the shader's nine-tap kernel.
import assert from 'node:assert/strict'
import { H_SIZE } from '../src/moon/tiles/grid.ts'
import { deepSmoothSpacing, edgeOffset, eastWestSpacing, smoothDeepHeights, tileCentreLat } from '../src/moon/tiles/smoothDeep.ts'

const N = H_SIZE
let seed = 99
const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
const noise = (): Float32Array => { const a = new Float32Array(N * N); for (let i = 0; i < a.length; i++) a[i] = Math.round((rnd() - 0.5) * 8); return a }

// Levels above -2 are untouched; spacing 1, 2, 4 texels at -2, -3, -4 (120 m on the ground at 59 m / 118 m / 30 m texels).
const h = noise()
assert.equal(smoothDeepHeights(h, -1, 40), h)
assert.equal(smoothDeepHeights(h, 0, 40), h)
assert.deepEqual([-2, -3, -4].map(deepSmoothSpacing), [1, 2, 4])
// East-west widening is 1 / cos(lat), capped at 4.
assert.ok(Math.abs(eastWestSpacing(2, 60) - 4) < 1e-9)
assert.equal(eastWestSpacing(2, 89), 8)
assert.equal(eastWestSpacing(2, 0), 2)
// Edge shrink: the shader's min(sp, distance to the tile edge + 1), symmetric about the seam.
assert.equal(edgeOffset(0, 2), 0.5)
assert.equal(edgeOffset(1, 2), 1.5)
assert.equal(edgeOffset(2, 2), 2)
assert.equal(edgeOffset(N - 1, 2), 0.5)
assert.equal(edgeOffset(N - 2, 2), 1.5)

// Interior equals the contiguous one-texel prepass followed by the 3 x 3 binomial at the stated spacing.
const lvl = -3, ty = 144 // tile row centred near the equator (90 - 144.5 * 0.625 = -0.3 deg)
assert.ok(Math.abs(tileCentreLat(lvl, ty)) < 1)
const s = smoothDeepHeights(h, lvl, ty)
const refPass = (src: Float32Array, horizontal: boolean, spacing: number): Float32Array => {
  const dst = new Float32Array(src.length)
  for (let i = 0; i < N; i++) {
    const o = edgeOffset(i, spacing)
    const xm = Math.min(N - 1, Math.max(0, i - o)), xp = Math.min(N - 1, Math.max(0, i + o))
    const m0 = Math.floor(xm), m1 = m0 < N - 1 ? m0 + 1 : N - 1, fm = xm - m0
    const p0 = Math.floor(xp), p1 = p0 < N - 1 ? p0 + 1 : N - 1, fp = xp - p0
    for (let line = 0; line < N; line++) {
      const row = line * N
      const a = horizontal ? src[row + m0] : src[m0 * N + line]
      const b = horizontal ? src[row + m1] : src[m1 * N + line]
      const c = horizontal ? src[row + p0] : src[p0 * N + line]
      const d = horizontal ? src[row + p1] : src[p1 * N + line]
      const centre = horizontal ? src[row + i] : src[i * N + line]
      if (horizontal) dst[row + i] = 0.25 * (a + (b - a) * fm) + 0.5 * centre + 0.25 * (c + (d - c) * fp)
      else dst[i * N + line] = 0.25 * (a + (b - a) * fm) + 0.5 * centre + 0.25 * (c + (d - c) * fp)
    }
  }
  return dst
}
const sp0 = deepSmoothSpacing(lvl), spx0 = eastWestSpacing(sp0, tileCentreLat(lvl, ty))
const ref = refPass(refPass(refPass(refPass(h, true, 1), false, 1), true, spx0), false, sp0)
for (const [x, y] of [[50, 60], [160, 160], [271, 100]]) {
  assert.ok(Math.abs(s[y * N + x] - ref[y * N + x]) < 1e-3, `interior ${x},${y}: ${s[y * N + x]} vs ${ref[y * N + x]}`)
}

// Near the equator, level -2's x spacing is within the 1.01 tolerance, so it
// retains the original two-pass spacing-1 kernel without a redundant prepass.
const lvl2Eq = -2, ty2Eq = 72
const s2Eq = smoothDeepHeights(h, lvl2Eq, ty2Eq)
const sp2Eq = deepSmoothSpacing(lvl2Eq), spx2Eq = eastWestSpacing(sp2Eq, tileCentreLat(lvl2Eq, ty2Eq))
const ref2Eq = refPass(refPass(h, true, spx2Eq), false, sp2Eq)
for (const [x, y] of [[50, 60], [160, 160]]) assert.ok(Math.abs(s2Eq[y * N + x] - ref2Eq[y * N + x]) < 1e-3, 'near-equator level -2 keeps its original kernel')

// The prepass removes alternating source residue that the wider ±2 taps pass at
// their Nyquist notch, while retaining low-frequency crater-like relief.
const tiltedAlternating = (kind: 'x' | 'y' | 'checker', level: number, row: number): Float32Array => {
  const a = new Float32Array(N * N)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const ripple = kind === 'x' ? ((x & 1) ? 1 : -1) : kind === 'y' ? ((y & 1) ? 1 : -1) : (((x + y) & 1) ? 1 : -1)
    a[y * N + x] = 0.3 * x + 0.1 * y + ripple
  }
  return smoothDeepHeights(a, level, row)
}
const fracA = tiltedAlternating('x', lvl2Eq, 65), fracB = tiltedAlternating('x', lvl2Eq, 66)
let fracDelta = 0
for (let y = 40; y < 280; y++) for (let x = 40; x < 280; x++) fracDelta = Math.max(fracDelta, Math.abs(fracA[y * N + x] - fracB[y * N + x]))
assert.ok(fracDelta < 0.01, `fractional latitude prepass changes continuously (${fracDelta})`)
for (const kind of ['x', 'y', 'checker'] as const) {
  const filtered = tiltedAlternating(kind, lvl, ty)
  let residual = 0, count = 0
  for (let y = 40; y < 280; y++) for (let x = 40; x < 280; x++) { residual += Math.abs(filtered[y * N + x] - (0.3 * x + 0.1 * y)); count++ }
  assert.ok(residual / count < 0.01, `${kind} Nyquist residue at equator: ${residual / count}`)
}
for (const kind of ['x', 'y', 'checker'] as const) {
  const filtered = tiltedAlternating(kind, -2, 23)
  let residual = 0, count = 0
  for (let y = 40; y < 280; y++) for (let x = 40; x < 280; x++) { residual += Math.abs(filtered[y * N + x] - (0.3 * x + 0.1 * y)); count++ }
  assert.ok(residual / count < 0.01, `${kind} high-latitude Nyquist residue: ${residual / count}`)
}
const crater = new Float32Array(N * N)
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) crater[y * N + x] = 100 * Math.sin((2 * Math.PI * x) / 32)
const craterFiltered = smoothDeepHeights(crater, lvl, ty)
let craterIn = 0, craterOut = 0
for (let y = 100; y < 220; y++) for (let x = 80; x < 240; x++) { craterIn = Math.max(craterIn, Math.abs(crater[y * N + x])); craterOut = Math.max(craterOut, Math.abs(craterFiltered[y * N + x])) }
assert.ok(craterOut / craterIn > 0.9, `low-frequency relief retained: ${craterOut / craterIn}`)

// Seams. Border texels are the neighbour's first pixels, so a tile cannot see past them: the offset shrinks to the distance to the edge, which
// keeps a SLOPE exact through the border (the failure that matters: a clamped tap would flatten a wall by tens of metres) and leaves only
// noise-sized differences between the two tiles' values for the same ground. Both are checked on a ramp crossing the seam.
const W = 2 * (N - 2)
const ramp = new Float32Array(W * N)
for (let y = 0; y < N; y++) for (let x = 0; x < W; x++) ramp[y * W + x] = 0.4 * x + 0.1 * y + 7 * Math.sin(x / 40)
const mk = (shift: number): Float32Array => { const t = new Float32Array(N * N); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) t[y * N + x] = ramp[y * W + shift + x]; return t }
const sl = smoothDeepHeights(mk(0), lvl, ty), sr = smoothDeepHeights(mk(N - 2), lvl, ty)
for (const k of [0, 1]) for (const y of [40, 150, 250]) {
  const a = sl[y * N + (N - 2 + k)], b = sr[y * N + k]
  assert.ok(Math.abs(a - b) < 0.2, `seam k=${k} y=${y}: ${a} vs ${b}`)
}
// A ramp keeps its slope at the very edge of a tile (taps shrink, not clamp).
assert.ok(Math.abs((sl[150 * N + 319] - sl[150 * N + 318]) - (mk(0)[150 * N + 319] - mk(0)[150 * N + 318])) < 0.3)

// North-south striping (a per-column offset, the SLDEM track artefact) of ground wavelength 240 m. A longitude texel at 60 N is half as wide,
// so the stripe spans 8 texels there: the texel-isotropic kernel (2 texels, 60 m of ground) passes half of it, the ground-isotropic kernel
// (4 texels, 120 m) removes it, exactly as at the equator (4 texels, 2-texel kernel).
const lat60ty = 47 // tile centre 60.3 N, cos 0.4955
const wave = (periodTexels: number): Float32Array => { const a = new Float32Array(N * N); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) a[y * N + x] = 5 * Math.cos((2 * Math.PI * x) / periodTexels); return a }
const amp = (a: Float32Array): number => { let m = 0; for (let x = 100; x < 220; x++) m = Math.max(m, Math.abs(a[150 * N + x])); return m }
const period60 = 4 / Math.cos((tileCentreLat(lvl, lat60ty) * Math.PI) / 180)
const eq = amp(smoothDeepHeights(wave(4), lvl, ty)) / 5
const aniso = amp(smoothDeepHeights(wave(period60), lvl, lat60ty)) / 5
const iso = amp(smoothDeepHeights(wave(period60), lvl, lat60ty, true)) / 5
assert.ok(eq < 0.1 && aniso < 0.1, `ground-isotropic kernel kills the 240 m stripe at the equator (${eq.toFixed(2)}) and at 60 N (${aniso.toFixed(2)})`)
assert.ok(iso > 0.4, `the old texel-isotropic kernel left ${(iso * 100).toFixed(0)} % of it at 60 N`)
const nsWave = new Float32Array(N * N)
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) nsWave[y * N + x] = 5 * Math.sin((2 * Math.PI * y) / 32)
const nsIn = amp(nsWave), nsOut = amp(smoothDeepHeights(nsWave, -2, lat60ty))
assert.ok(nsOut / nsIn > 0.9, `high-latitude level -2 preserves north-south low-frequency detail (${(nsOut / nsIn * 100).toFixed(0)} %)`)
// A plane stays a plane (the kernel is normalised and symmetric).
const plane = new Float32Array(N * N)
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) plane[y * N + x] = 0.3 * x + 0.1 * y
const sp = smoothDeepHeights(plane, lvl, lat60ty)
assert.ok(Math.abs(sp[150 * N + 150] - plane[150 * N + 150]) < 1e-3)
console.log(`smooth-deep ok (240 m stripe at 60 N: old kernel passes ${(iso * 100).toFixed(0)} %, new ${(aniso * 100).toFixed(0)} %)`)
