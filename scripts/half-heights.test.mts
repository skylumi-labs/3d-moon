/**
 * Half-float height upload (W2-M4, `?half=0` reverts): the decode Worker hands back R16F bits and TileStreamer uploads them as HALF_FLOAT.
 * The heights array is R16F, so the GPU holds half floats whichever way the page uploads. This pins:
 *  1. the conversion itself (round to nearest, ties to even; every half value round-trips; matches Math.f16round where the runtime has it);
 *  2. exactness where the data is on the grid (multiples of 1 m inside +-2048 m of the tile mid; a built tile's 8 m steps over the whole Moon);
 *  3. on real-shaped tiles (craters, a ridge, noise, km relief, run through the real decode + smoothing): the Worker's half bits ARE the float
 *     result rounded once, the rounding error is within half the spacing, and the shadow result (a Sun-elevation horizon march over the tile)
 *     is the same within a stated tolerance of the Float32 heights, and identical to what the old float upload stored on the GPU.
 */
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { H_SIZE } from '../src/moon/tiles/grid.ts'
import { encodeHeightPlanes } from '../src/moon/tiles/codec.ts'
import { floatToHalfBits, halfBitsToFloat, toHalfArray } from '../src/moon/tiles/half.ts'
import { runTileJob } from '../src/moon/tiles/tileJob.ts'
import { decodeFlags, flagsFromSearch } from '../src/moon/tiles/decodeFlags.ts'

// 1. Conversion.
{
  for (let h = 0; h < 0x10000; h++) {
    const e = (h >>> 10) & 0x1f
    if (e === 0x1f) continue // inf / NaN
    const f = halfBitsToFloat(h)
    assert.equal(floatToHalfBits(f), f === 0 && h === 0x8000 ? 0x8000 : h, `round trip of half bits ${h.toString(16)}`)
  }
  assert.equal(floatToHalfBits(65520), 0x7c00, 'overflows to infinity')
  assert.equal(floatToHalfBits(1e-9), 0, 'underflows to zero')
  // Ties go to even: 2049 is halfway between 2048 and 2050 (spacing 2 m): 2048 has the even mantissa.
  assert.equal(halfBitsToFloat(floatToHalfBits(2049)), 2048)
  assert.equal(halfBitsToFloat(floatToHalfBits(2051)), 2052)
  // Against an independent nearest-neighbour search, and Math.f16round when present.
  let s = 99
  const rnd = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const f16 = (Math as unknown as { f16round?: (x: number) => number }).f16round
  for (let i = 0; i < 20000; i++) {
    const x = Math.fround((rnd() - 0.5) * (i % 3 === 0 ? 30000 : i % 3 === 1 ? 4000 : 20))
    const h = floatToHalfBits(x), v = halfBitsToFloat(h)
    for (const n of [h - 1, h + 1]) {
      if (n < 0 || n > 0xffff || (n & 0x7c00) === 0x7c00 || ((n ^ h) & 0x8000)) continue
      const dn = Math.abs(halfBitsToFloat(n) - x), d = Math.abs(v - x)
      assert.ok(d < dn || (d === dn && (h & 1) === 0), `${x} -> ${v} is the nearest half (tie to even)`)
    }
    if (f16) assert.equal(v, f16(x))
  }
}

// 2. Exactness.
{
  const m = new Float32Array(4097 + 2)
  for (let i = 0; i <= 4096; i++) m[i] = -2048 + i
  m[4097] = 2048.5
  const h = toHalfArray(m)
  for (let i = 0; i <= 4096; i++) assert.equal(halfBitsToFloat(h[i]), m[i], `${m[i]} m is exact in half`)
  assert.notEqual(halfBitsToFloat(h[4097]), 2048.5, 'the check is real: half-metres are not representable above 2048')
  const built = Float32Array.from({ length: 2751 }, (_, i) => -10240 + 8 * i)
  const hb = toHalfArray(built)
  for (let i = 0; i < built.length; i++) assert.equal(halfBitsToFloat(hb[i]), built[i], `${built[i]} m (8 m step) is exact in half`)
}

// 3. Real-shaped tile through the real Worker job.
let seed = 4242
const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
const q = new Int32Array(H_SIZE * H_SIZE)
const craters = Array.from({ length: 14 }, () => ({ x: rnd() * H_SIZE, y: rnd() * H_SIZE, r: 12 + rnd() * 70, d: 40 + rnd() * 400 }))
for (let y = 0; y < H_SIZE; y++) for (let x = 0; x < H_SIZE; x++) {
  let z = 1800 + 700 * Math.sin(x / 41) * Math.cos(y / 57) + (x > 200 ? (x - 200) * 6 : 0) + (rnd() - 0.5) * 3
  for (const c of craters) {
    const r = Math.hypot(x - c.x, y - c.y) / c.r
    if (r < 1) z -= c.d * (1 - r * r) // bowl
    else if (r < 1.25) z += c.d * 0.25 * (1.25 - r) / 0.25 // rim
  }
  q[y * H_SIZE + x] = Math.round(z)
}
const gz = gzipSync(Buffer.from(encodeHeightPlanes(q)))
const buf = (): ArrayBuffer => gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) as ArrayBuffer
const deps = { pixels: async () => new Uint8ClampedArray(4) }
const base = { cb: null, level: -3, ty: 5, deeper: true, stepM: 1 }
const saved = decodeFlags()
const fl = await runTileJob({ ...base, id: 1, hb: buf(), flags: { ...saved, half: false } }, deps)
const hf = await runTileJob({ ...base, id: 2, hb: buf(), flags: { ...saved, half: true } }, deps)
const noFlags = await runTileJob({ ...base, id: 3, hb: buf() }, deps)
assert.ok(fl.heights instanceof Float32Array && noFlags.heights instanceof Float32Array, '`?half=0` and a job without flags keep the Float32 result')
assert.ok(hf.heights instanceof Uint16Array, 'half: Uint16 bits')
assert.equal(hf.heights.byteLength * 2, fl.heights.byteLength, 'half the bytes to transfer')
assert.equal(hf.mid, fl.mid)
assert.deepEqual(Array.from(hf.relief), Array.from(fl.relief), 'the relief summary is unchanged')
assert.ok(flagsFromSearch('?half=0').half === false && flagsFromSearch('').half === true)

// The bits are the float result rounded once: exactly what the driver's float -> R16F conversion stored before.
const fh = fl.heights as Float32Array, hh = hf.heights as Uint16Array
let maxErr = 0
for (let i = 0; i < fh.length; i++) {
  assert.equal(hh[i], floatToHalfBits(fh[i]), `texel ${i}`)
  maxErr = Math.max(maxErr, Math.abs(halfBitsToFloat(hh[i]) - fh[i]))
}
// Heights minus mid stay inside +-2048 m here, where half spacing is at most 1 m (smoothing makes them fractional): error <= 0.5 m.
let lo = Infinity, hi = -Infinity
for (const v of fh) { if (v < lo) lo = v; if (v > hi) hi = v }
assert.ok(lo > -2048 && hi < 2048, `tile stays within +-2048 m of its mid (${lo.toFixed(0)}..${hi.toFixed(0)})`)
assert.ok(maxErr <= 0.5, `half rounding error ${maxErr} m <= 0.5 m`)

// Shadow result: a horizon march over the tile for several Sun elevations and azimuths, Float32 heights vs the half-float heights.
const SPACING_M = 59.2 // level -3 texel
const litMask = (h: (i: number) => number, elevDeg: number, azDeg: number): Uint8Array => {
  const out = new Uint8Array(H_SIZE * H_SIZE)
  const dx = Math.sin(azDeg * Math.PI / 180), dy = Math.cos(azDeg * Math.PI / 180), tan = Math.tan(elevDeg * Math.PI / 180)
  for (let y = 0; y < H_SIZE; y++) for (let x = 0; x < H_SIZE; x++) {
    const z0 = h(y * H_SIZE + x)
    let lit = 1
    for (let k = 1; k <= 160; k++) {
      const sx = Math.round(x + dx * k), sy = Math.round(y + dy * k)
      if (sx < 0 || sy < 0 || sx >= H_SIZE || sy >= H_SIZE) break
      if (h(sy * H_SIZE + sx) - z0 > tan * k * SPACING_M) { lit = 0; break }
    }
    out[y * H_SIZE + x] = lit
  }
  return out
}
let worst = 0, total = 0, differ = 0
for (const elev of [1.5, 3, 6, 12, 25]) for (const az of [0, 40, 90, 135, 200, 290]) {
  const a = litMask((i) => fh[i], elev, az), b = litMask((i) => halfBitsToFloat(hh[i]), elev, az)
  let d = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++
  worst = Math.max(worst, d / a.length); differ += d; total += a.length
}
console.log(`half heights: max texel error ${maxErr.toFixed(3)} m; lit mask differs in ${(100 * differ / total).toFixed(4)} % of texels (worst view ${(100 * worst).toFixed(4)} %) over 30 Sun directions`)
assert.ok(worst <= 0.005, `shadow mask differs in at most 0.5 % of texels in any view (${(100 * worst).toFixed(3)} %)`)
// And against the old upload (R16F rounding of the float heights, done by the driver): identical by construction, pinned above bit for bit.
console.log('half-heights: ok')
