import { DataUtils } from 'three'

/**
 * The 4k height map's decode: gradient-predicted residuals to metres, a box-filtered mip chain, half floats. About half a second of
 * arithmetic, so the page runs it in a worker (heightWorker.ts) and keeps this module as the one definition both paths share.
 * Pure: bytes in, typed arrays out, no DOM.
 */
export interface DecodedHeights {
  w: number
  h: number
  lonSpan: number
  halfErrorM: number
  /** R16F mip levels, 4096 x 2048 down to 1 x 1. */
  levels: { data: Uint16Array; width: number; height: number }[]
}

/** The file is still gzip (the 1f 8b magic): a server may already have undone it through Content-Encoding, then the MHT1 magic is first. */
export function isGzip(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 2) return false
  const head = new Uint8Array(buf, 0, 2)
  return head[0] === 0x1f && head[1] === 0x8b
}

/** Undoes the gzip with DecompressionStream (worker or page), or returns the buffer itself when it is not gzip. The 6.5 MB file took 82-109 ms on the
 *  L4's page thread (stall-diag #6), so the page hands it to the worker still compressed. */
export async function inflateIfGzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  if (!isGzip(buf)) return buf
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).arrayBuffer()
}

/** Where the gzip is undone: in the height worker (default), or on the page's main thread with `?heightinflate=main` (the old path, for a same-build A/B). */
export function heightInflateOnMain(search: string): boolean { return new URLSearchParams(search).get('heightinflate') === 'main' }

export function decodeHeights(buf: ArrayBuffer): DecodedHeights {
  const view = new DataView(buf)
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
  if (magic !== 'MHT1') throw new Error('Unexpected height map header')
  const w = view.getUint32(4, true)
  const h = view.getUint32(8, true)
  const step = view.getFloat32(12, true)
  const lonSpan = view.getFloat32(16, true)
  const bytes = new Uint8Array(buf, 20)
  const n = w * h
  const q = new Int32Array(n)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const z = (bytes[i] << 8) | bytes[n + i]
      const d = (z >>> 1) ^ -(z & 1)
      const left = x > 0 ? q[i - 1] : 0
      const up = y > 0 ? q[i - w] : 0
      const upLeft = x > 0 && y > 0 ? q[i - w - 1] : 0
      q[i] = d + left + up - upLeft
    }
  }
  let level = new Float32Array(n)
  for (let i = 0; i < n; i++) level[i] = q[i] * step
  const mipmaps: { data: Float32Array; width: number; height: number }[] = []
  let lw = w, lh = h
  for (;;) {
    mipmaps.push({ data: level, width: lw, height: lh })
    if (lw === 1 && lh === 1) break
    const nw = Math.max(1, lw >> 1), nh = Math.max(1, lh >> 1)
    const next = new Float32Array(nw * nh)
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let s = 0, c = 0
        for (let j = 0; j < 2; j++) {
          for (let i = 0; i < 2; i++) {
            const sx = Math.min(lw - 1, x * 2 + i), sy = Math.min(lh - 1, y * 2 + j)
            s += level[sy * lw + sx]
            c++
          }
        }
        next[y * nw + x] = s / c
      }
    }
    level = next
    lw = nw
    lh = nh
  }
  // Half float (R16F, half of R32F's 44.7 MB with mips): metres to 1 m are exact below 2,048 m, to 2 m below 4,096 m,
  // to 4 m below 8,192 m and to 8 m above; the file's own step is 4 m, so the store adds at most 4 m, and only where the
  // ground is above 8,192 m or below -8,192 m (halfErrorM is measured while decoding). The shader filters in float, so the mixed values are not rounded again.
  const half = mipmaps.map((m) => {
    const u = new Uint16Array(m.data.length)
    for (let i = 0; i < u.length; i++) u[i] = DataUtils.toHalfFloat(m.data[i])
    return { data: u, width: m.width, height: m.height }
  })
  let halfErrorM = 0
  for (let i = 0; i < n; i++) halfErrorM = Math.max(halfErrorM, Math.abs(DataUtils.fromHalfFloat(half[0].data[i]) - mipmaps[0].data[i]))
  return { w, h, lonSpan, halfErrorM, levels: half }
}
