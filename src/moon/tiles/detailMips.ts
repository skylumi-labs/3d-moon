/** Mip chain of a one-channel byte tile (box filter, rounded). The bytes are log2 ratios, so a box average is the geometric mean of the ratios. */
export function colorMipsGrey(base: Uint8Array, size: number): Uint8Array[] {
  const levels: Uint8Array[] = [base]
  let w = size
  while (w > 1) {
    const src = levels[levels.length - 1]
    const nw = w >> 1
    const dst = new Uint8Array(nw * nw)
    for (let y = 0; y < nw; y++) for (let x = 0; x < nw; x++) {
      const i = 2 * y * w + 2 * x
      dst[y * nw + x] = (src[i] + src[i + 1] + src[i + w] + src[i + w + 1] + 2) >> 2
    }
    levels.push(dst)
    w = nw
  }
  return levels
}
