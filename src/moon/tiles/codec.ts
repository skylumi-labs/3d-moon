import { H_SIZE, H_STEP_M } from './grid'

/**
 * Height tile codec. A tile is H_SIZE x H_SIZE integers q (height in metres =
 * q * H_STEP_M, above the 1737.4 km sphere). Each is predicted from its left,
 * upper and upper-left neighbours (the gradient predictor, 0 outside), the
 * residual zig-zagged to an unsigned 16-bit value, and the bytes written as a
 * plane of high bytes then a plane of low bytes; the file is that, gzipped.
 * The same scheme as the 4k map's MHT1
 * without its header: the manifest carries the grid.
 */

export function encodeHeightPlanes(q: Int32Array, w = H_SIZE, h = H_SIZE): Uint8Array {
  const n = w * h
  const out = new Uint8Array(2 * n)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const pred = (x ? q[i - 1] : 0) + (y ? q[i - w] : 0) - (x && y ? q[i - w - 1] : 0)
      const d = q[i] - pred
      const z = (d << 1) ^ (d >> 31)
      if (z > 0xffff) throw new Error('height residual out of 16-bit range')
      out[i] = z >> 8
      out[n + i] = z & 255
    }
  }
  return out
}

export function decodeHeightPlanes(bytes: Uint8Array, w = H_SIZE, h = H_SIZE): Int32Array {
  const n = w * h
  if (bytes.length < 2 * n) throw new Error(`height tile is ${bytes.length} bytes, expected ${2 * n}`)
  const q = new Int32Array(n)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const z = (bytes[i] << 8) | bytes[n + i]
      const d = (z >>> 1) ^ -(z & 1)
      q[i] = d + (x ? q[i - 1] : 0) + (y ? q[i - w] : 0) - (x && y ? q[i - w - 1] : 0)
    }
  }
  return q
}

/** Quantised height to metres, as the shader's half-float holds it (exact). */
export const qToMetres = (q: number): number => q * H_STEP_M

/** Gunzip in the browser when the server did not already (Content-Encoding). */
export async function gunzipIfNeeded(buf: ArrayBuffer): Promise<Uint8Array> {
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength))
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }
  return new Uint8Array(buf)
}

/**
 * Half-float check used by tests: is v exactly representable? (11 significant
 * bits; for |v| in [2^e, 2^(e+1)) the spacing is 2^(e-10).)
 */
export function exactInHalf(v: number): boolean {
  if (v === 0) return true
  const a = Math.abs(v)
  if (a >= 65504) return false
  const e = Math.max(-14, Math.floor(Math.log2(a)))
  const spacing = 2 ** (e - 10)
  return Math.abs(a / spacing - Math.round(a / spacing)) < 1e-9
}
