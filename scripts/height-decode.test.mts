// decodeHeights (src/moon/heightDecode.ts, run in a worker by maps.ts): a small map encoded the way the 4k map is built decodes to the exact metres,
// the mip chain is the 2 x 2 box mean down to 1 x 1, and the half-float store reports its own error. The gzip is undone in the worker
// (inflateIfGzip; ?heightinflate=main keeps it on the page), and the worker given the gzip file posts the same decode as the raw one.
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { decodeHeights, heightInflateOnMain, inflateIfGzip, isGzip } from '../src/moon/heightDecode.ts'

const w = 8, h = 4, step = 4
const metres = Array.from({ length: w * h }, (_, i) => ((i * 37) % 23 - 11) * step)
metres[3] = 10004 // above 8192 m: half floats step 8 m there, so the store adds an error
const q = metres.map((m) => Math.round(m / step))
const buf = new ArrayBuffer(20 + 2 * w * h)
const dv = new DataView(buf)
;[...'MHT1'].forEach((c, i) => dv.setUint8(i, c.charCodeAt(0)))
dv.setUint32(4, w, true); dv.setUint32(8, h, true); dv.setFloat32(12, step, true); dv.setFloat32(16, 180, true)
const bytes = new Uint8Array(buf, 20)
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const i = y * w + x
  const pred = (x > 0 ? q[i - 1] : 0) + (y > 0 ? q[i - w] : 0) - (x > 0 && y > 0 ? q[i - w - 1] : 0)
  const d = q[i] - pred
  const z = d < 0 ? ((-d) << 1) - 1 : d << 1
  bytes[i] = z >> 8; bytes[w * h + i] = z & 255
}
const out = decodeHeights(buf)
assert.equal(out.w, w); assert.equal(out.h, h); assert.equal(out.lonSpan, 180)
assert.deepEqual(out.levels.map((l) => [l.width, l.height]), [[8, 4], [4, 2], [2, 1], [1, 1]])
const half = (u: number): number => { const s = (u & 0x8000) ? -1 : 1, e = (u >> 10) & 31, m = u & 1023; return s * (e === 0 ? m * 2 ** -24 : (1 + m / 1024) * 2 ** (e - 15)) }
for (let i = 0; i < w * h; i++) assert.ok(Math.abs(half(out.levels[0].data[i]) - metres[i]) <= 8, `level 0 texel ${i}`)
assert.ok(out.halfErrorM > 0 && out.halfErrorM <= 4, `halfErrorM ${out.halfErrorM}`)
const mean4 = (a: number[], aw: number, x: number, y: number): number => (a[2 * y * aw + 2 * x] + a[2 * y * aw + 2 * x + 1] + a[(2 * y + 1) * aw + 2 * x] + a[(2 * y + 1) * aw + 2 * x + 1]) / 4
for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) assert.ok(Math.abs(half(out.levels[1].data[y * 4 + x]) - mean4(metres, w, x, y)) <= 8, `level 1 ${x},${y}`)

// Inflate: gzip in, the same bytes out; a buffer that is not gzip (a server undid the Content-Encoding) is returned as is.
const gz = gzipSync(new Uint8Array(buf))
const gzBuf = gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) as ArrayBuffer
assert.equal(isGzip(gzBuf), true)
assert.equal(isGzip(buf), false)
assert.equal(isGzip(new ArrayBuffer(1)), false)
assert.deepEqual(new Uint8Array(await inflateIfGzip(gzBuf)), new Uint8Array(buf))
assert.equal(await inflateIfGzip(buf), buf, 'not gzip: the same buffer')
// The switch: the worker by default, the page with ?heightinflate=main.
assert.equal(heightInflateOnMain(''), false)
assert.equal(heightInflateOnMain('?heightinflate=worker'), false)
assert.equal(heightInflateOnMain('?x=1&heightinflate=main'), true)
// The worker: handed the gzip file it inflates and decodes it, and posts the same levels as the raw decode, with their buffers transferred.
{
  const posted: Array<{ msg: { type: string; out?: ReturnType<typeof decodeHeights>; message?: string }; transfer?: Transferable[] }> = []
  const self = { postMessage(msg: never, transfer?: Transferable[]) { posted.push({ msg, transfer }) }, onmessage: null as null | ((ev: { data: ArrayBuffer }) => unknown) }
  ;(globalThis as { self?: unknown }).self = self
  await import('../src/moon/heightWorker.ts')
  await self.onmessage!({ data: gzBuf })
  await self.onmessage!({ data: buf.slice(0) })
  await self.onmessage!({ data: new ArrayBuffer(8) })
  assert.equal(posted.length, 3)
  for (const p of posted.slice(0, 2)) {
    assert.equal(p.msg.type, 'done')
    assert.deepEqual(p.msg.out!.levels.map((l) => Array.from(l.data)), out.levels.map((l) => Array.from(l.data)))
    assert.equal(p.transfer!.length, out.levels.length)
  }
  assert.equal(posted[2].msg.type, 'error', 'a bad file posts an error (the page falls back)')
}
console.log('height-decode: ok')
