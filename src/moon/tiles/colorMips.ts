const srgbToLin = new Float32Array(256)
for (let i = 0; i < 256; i++) { const x = i / 255; srgbToLin[i] = x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }
const linToSrgb = new Uint8Array(4097)
for (let i = 0; i <= 4096; i++) { const x = i / 4096; linToSrgb[i] = Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)) }

/** Colour mip chain, RGBA8, averaged in linear light like the GPU's sRGB mip generation. */
export function colorMips(base: Uint8Array | Uint8ClampedArray, size: number): Uint8Array[] {
  const levels: Uint8Array[] = [new Uint8Array(base.buffer, base.byteOffset, base.length)]
  let w = size
  while (w > 1) {
    const src = levels[levels.length - 1]
    const nw = w >> 1
    const dst = new Uint8Array(nw * nw * 4)
    for (let y = 0; y < nw; y++) for (let x = 0; x < nw; x++) {
      for (let c = 0; c < 3; c++) {
        // Odd sizes drop the last row and column, as GL's mip sizes do.
        const i0 = ((2 * y) * w + 2 * x) * 4 + c
        const m = (srgbToLin[src[i0]] + srgbToLin[src[i0 + 4]] + srgbToLin[src[i0 + w * 4]] + srgbToLin[src[i0 + w * 4 + 4]]) * 0.25
        dst[(y * nw + x) * 4 + c] = linToSrgb[Math.round(m * 4096)]
      }
      dst[(y * nw + x) * 4 + 3] = 255
    }
    levels.push(dst)
    w = nw
  }
  return levels
}
