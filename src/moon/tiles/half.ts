/**
 * IEEE 754 binary16 for the height tiles. The heights array is R16F, so the GPU stores half floats whatever the page uploads; a Float32Array upload
 * makes the driver convert (and the Worker's result carries twice the bytes). Converting in the decode Worker uploads the same values as HALF_FLOAT.
 *
 * Round to nearest, ties to even, the conversion every GL driver and `Math.f16round` use. A value is exact when it is a multiple of 1 m inside
 * +-2048 m (a built tile's 8 m steps are exact over the whole Moon), so the conversion changes nothing for the data that is already on the grid
 * and rounds the smoothed copy by at most half the spacing (0.5 m below 2048 m).
 */
const f32 = new Float32Array(1)
const u32 = new Uint32Array(f32.buffer)

export function floatToHalfBits(v: number): number {
  f32[0] = v
  const x = u32[0]
  const sign = (x >>> 16) & 0x8000
  const e = (x >>> 23) & 0xff
  let m = x & 0x7fffff
  if (e === 0xff) return sign | 0x7c00 | (m ? 0x200 : 0) // inf, NaN
  let he = e - 112 // rebias 127 -> 15
  if (he >= 0x1f) return sign | 0x7c00 // overflow to infinity
  if (he <= 0) {
    // Subnormal half (or zero): shift the implicit one in and round.
    if (he < -10) return sign
    m |= 0x800000
    const shift = 14 - he
    let h = m >>> shift
    const rem = m & ((1 << shift) - 1), halfway = 1 << (shift - 1)
    if (rem > halfway || (rem === halfway && (h & 1))) h++
    return sign | h
  }
  let h = (he << 10) | (m >>> 13)
  const rem = m & 0x1fff
  if (rem > 0x1000 || (rem === 0x1000 && (h & 1))) h++ // a carry into the exponent is the correct result
  return sign | h
}

export function halfBitsToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1
  const e = (h >>> 10) & 0x1f, m = h & 0x3ff
  if (e === 0) return sign * m * 2 ** -24
  if (e === 0x1f) return m ? NaN : sign * Infinity
  return sign * (1 + m / 1024) * 2 ** (e - 15)
}

/** A tile's heights as half floats (R16F bits), the buffer a Worker transfers and TileStreamer uploads with HALF_FLOAT. */
export function toHalfArray(src: Float32Array): Uint16Array {
  const out = new Uint16Array(src.length)
  for (let i = 0; i < src.length; i++) out[i] = floatToHalfBits(src[i])
  return out
}
