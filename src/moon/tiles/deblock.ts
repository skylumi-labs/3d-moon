/**
 * Chroma deblocking for the level-0 colour tiles.
 *
 * The WebP colour tiles are 4:2:0 with 16 x 16 macroblocks, each with its own flat chroma that is off by up to about a level and a half. At the
 * old zoom floor one block was about 40 screen pixels and the tint was invisible; over the 59 m ground the floor is 7 times closer, and each
 * block is a 100 pixel pale blue or pink rectangle on bare mare.
 *
 * Cb and Cr are replaced by their box average over one block width, which turns a field of flat blocks into a continuous one, wherever the
 * difference to that average is small enough to be codec quantisation (under NOISE, ramping to a real feature at FEATURE). Luma is untouched.
 */
export const BLOCK = 16
/** Chroma differences (0..255 scale) below this are block quantisation; above FEATURE they are colour that is really there. */
export const NOISE = 1.5
export const FEATURE = 4

/** Corrects `px` (RGBA bytes, size x size, in place). */
export function deblockChroma(px: Uint8ClampedArray | Uint8Array, size: number): void {
  const n = size * size
  const y = new Float32Array(n), cb = new Float32Array(n), cr = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const r = px[4 * i], g = px[4 * i + 1], b = px[4 * i + 2]
    y[i] = 0.299 * r + 0.587 * g + 0.114 * b
    cb[i] = -0.168736 * r - 0.331264 * g + 0.5 * b
    cr[i] = 0.5 * r - 0.418688 * g - 0.081312 * b
  }
  const tmp = new Float32Array(n)
  for (const plane of [cb, cr]) {
    const blur = boxBlur(plane, tmp, size)
    for (let i = 0; i < n; i++) {
      const d = plane[i] - blur[i]
      const t = Math.min(1, Math.max(0, (Math.abs(d) - NOISE) / (FEATURE - NOISE)))
      plane[i] = blur[i] + d * (t * t * (3 - 2 * t))
    }
  }
  for (let i = 0; i < n; i++) {
    px[4 * i] = y[i] + 1.402 * cr[i]
    px[4 * i + 1] = y[i] - 0.344136 * cb[i] - 0.714136 * cr[i]
    px[4 * i + 2] = y[i] + 1.772 * cb[i]
  }
}

/** Separable box average of width BLOCK + 1 (edges clamped); returns a new array. */
function boxBlur(src: Float32Array, tmp: Float32Array, size: number): Float32Array {
  const h = BLOCK / 2, w = BLOCK + 1
  const out = new Float32Array(src.length)
  for (let r = 0; r < size; r++) {
    const o = r * size
    let acc = 0
    for (let k = -h; k <= h; k++) acc += src[o + Math.min(size - 1, Math.max(0, k))]
    for (let x = 0; x < size; x++) {
      tmp[o + x] = acc / w
      acc += src[o + Math.min(size - 1, x + h + 1)] - src[o + Math.max(0, x - h)]
    }
  }
  for (let x = 0; x < size; x++) {
    let acc = 0
    for (let k = -h; k <= h; k++) acc += tmp[Math.min(size - 1, Math.max(0, k)) * size + x]
    for (let r = 0; r < size; r++) {
      out[r * size + x] = acc / w
      acc += tmp[Math.min(size - 1, r + h + 1) * size + x] - tmp[Math.max(0, r - h) * size + x]
    }
  }
  return out
}
