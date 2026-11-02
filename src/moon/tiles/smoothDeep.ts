import { H_PX, H_SIZE, H_STEP_M, levelDeg } from './grid'
import { polarPrefilter } from './polarFilter'
import { decodeFlags } from './decodeFlags'

/**
 * The deep (SLDEM 59 m and finer) ground is read smoothed: the heights carry 1 to 3 m of noise per texel, a 1 to 3 degree facet at the
 * texel scale, which a Sun a degree or two over the horizon shades or shadows. The shader used to take nine
 * bilinear taps per height read; every shadow-march and terrain-march sample paid for them (about 1900 taps a pixel). The same 3 x 3
 * binomial is now applied ONCE, when the tile is uploaded, and the shader reads the result with one tap.
 *
 * Spacing: about 120 m on the ground in BOTH directions. A longitude texel is cos(lat) as wide as a latitude texel, so the east-west offset is
 * 1 / cos(lat) texels wider (capped at 4): at 59.5 N the old texel-isotropic kernel smoothed 60 m east-west but 120 m north-south and left
 * the source's north-south striping to the slope and the shadow march.
 *
 * Edges: the offset shrinks toward the tile edge by the same amount on both sides of the seam (the 1 px border supplies the taps), so the
 * smoothed field is continuous across tiles. Separable: the offsets are one per column and one per row. When an axis spacing exceeds one texel,
 * that axis gets a contiguous one-texel prepass with strength clamp(spacing - 1, 0, 1) to remove the wider kernel's Nyquist notch; this adds
 * one modest support radius but no shader work and changes continuously with latitude.
 */
export const DEEP_SMOOTH_MIN_LEVEL = -2
export const DEEP_SMOOTH_MAX_ASPECT = 4

/** Tap spacing in texels along the north-south axis (the shader's old `sp`): 1 at level -2, 2 at -3, 4 at -4. */
export function deepSmoothSpacing(level: number): number {
  return level <= -3 ? 2 * 2 ** (-3 - level) : 1
}
/** Latitude (deg) of a tile row's centre. */
export const tileCentreLat = (level: number, ty: number): number => 90 - (ty + 0.5) * levelDeg(level)
/** East-west spacing in texels for a latitude: the north-south spacing over cos(lat), capped. */
export function eastWestSpacing(sp: number, latDeg: number): number {
  const c = Math.cos((latDeg * Math.PI) / 180)
  return sp * Math.min(DEEP_SMOOTH_MAX_ASPECT, 1 / Math.max(c, 1e-3))
}
/** Offset (texels) at texel index i of a H_SIZE texture: the spacing, shrunk to the distance to the nearest tile edge plus one. */
export function edgeOffset(i: number, sp: number): number {
  return Math.min(sp, Math.min(i - 0.5, H_SIZE - 1.5 - i) + 1)
}

function pass(src: Float32Array, dst: Float32Array, horizontal: boolean, sp: number, strength = 1): void {
  const n = H_SIZE
  const last = n - 1
  // Along the pass axis the taps are the same for every line: i - o, i and i + o with their bilinear weights, worked out once per index.
  // (This ran as a closure per tap and cost 20 ms or more of main thread per tile; tiles arrive many to a second when a view is first drawn.)
  const stepL = horizontal ? 1 : n // distance between neighbours along the axis
  const lineStride = horizontal ? n : 1 // distance between lines
  for (let i = 0; i < n; i++) {
    const o = edgeOffset(i, sp)
    const xm = Math.min(last, Math.max(0, i - o)), xp = Math.min(last, Math.max(0, i + o))
    const m0 = Math.floor(xm), m1 = m0 < last ? m0 + 1 : last, fm = xm - m0
    const p0 = Math.floor(xp), p1 = p0 < last ? p0 + 1 : last, fp = xp - p0
    const baseM0 = m0 * stepL, baseM1 = m1 * stepL, baseP0 = p0 * stepL, baseP1 = p1 * stepL, baseC = i * stepL
    for (let line = 0; line < n; line++) {
      const l = line * lineStride
      const a = src[l + baseM0], b = src[l + baseM1], c = src[l + baseP0], d = src[l + baseP1]
      const filtered = 0.25 * (a + (b - a) * fm) + 0.5 * src[l + baseC] + 0.25 * (c + (d - c) * fp)
      dst[l + baseC] = src[l + baseC] + strength * (filtered - src[l + baseC])
    }
  }
}

/** `texelIsotropic` is the old kernel (the same offset in texels both ways), kept for comparisons. */
/** The smoothed copy of a deep tile's heights (H_SIZE x H_SIZE, metres or metres minus the mid). Levels above -2 are returned as they are. */
export function smoothDeepHeights(heights: Float32Array, level: number, ty: number, texelIsotropic = false): Float32Array {
  if (level > DEEP_SMOOTH_MIN_LEVEL) return heights
  const sp = deepSmoothSpacing(level)
  const spx = texelIsotropic ? sp : eastWestSpacing(sp, tileCentreLat(level, ty))
  const tmp = new Float32Array(heights.length)
  const out = new Float32Array(heights.length)
  const preX = Math.min(1, Math.max(0, spx - 1))
  const preY = Math.min(1, Math.max(0, sp - 1))
  if (preX > 0 && preY > 0) {
    // Reuse the two working buffers; no third peak allocation.
    pass(heights, tmp, true, 1, preX)
    pass(tmp, out, false, 1, preY)
    pass(out, tmp, true, spx)
    pass(tmp, out, false, sp)
    return out
  }
  if (preX > 0) {
    pass(heights, tmp, true, 1, preX)
    pass(tmp, out, true, spx)
    pass(out, tmp, false, sp)
    return tmp
  }
  if (preY > 0) {
    pass(heights, out, false, 1, preY)
    pass(out, tmp, true, spx)
    pass(tmp, out, false, sp)
    return out
  }
  pass(heights, tmp, true, spx)
  pass(tmp, out, false, sp)
  return out
}


/**
 * East-west anti-alias for the levels that are not smoothed (-1 and coarser). The tiles are gridded in longitude and latitude, so poleward of
 * about 40 degrees a longitude texel is cos(lat) as wide as a latitude texel and the source carries less east-west detail than the grid can
 * hold. What it does carry there is column-to-column ripple, a north-south stripe pattern on every steep slope (59.5 N 40 E, levels 0 and -1:
 * east-west slope alternating by column, measured on the tile; the 4k map, being a box-filtered mip chain, has none). A low Sun turns it into the
 * vertical streaks across shadowed walls. A binomial of 1 / cos(lat) texels east-west, which is the same distance on the ground as one latitude
 * texel, removes it (an offset of one texel leaves a ripple, three blurs the relief): the same rule the deep levels' kernel already follows
 * (eastWestSpacing). Rows below about 36 N/S are not touched; between 36 and 46 the filter is blended in.
 */
const EW_AA_BLEND_LO = 1.15
const EW_AA_BLEND_HI = 1.45
/** Latitude (deg) of tile row r (row 0 is the 1 px border above the first texel). */
export const tileRowLat = (level: number, ty: number, r: number): number => 90 - ty * levelDeg(level) - (r - 0.5) * (levelDeg(level) / H_PX)
export function eastWestAntiAlias(heights: Float32Array, level: number, ty: number): Float32Array {
  const n = H_SIZE
  const last = n - 1
  let out: Float32Array | null = null
  let tmp: Float32Array | null = null
  // One 1-2-1 pass at tap spacing sp (texels), blended by k: its response is cos^2(pi f sp), zero at the period of 2 sp texels.
  const blurRow = (src: Float32Array, dst: Float32Array, row: number, sp: number, k: number): void => {
    for (let i = 0; i < n; i++) {
      const o = edgeOffset(i, sp)
      const xm = Math.max(0, i - o), xp = Math.min(last, i + o)
      const m0 = Math.floor(xm), m1 = m0 < last ? m0 + 1 : last, fm = xm - m0
      const p0 = Math.floor(xp), p1 = p0 < last ? p0 + 1 : last, fp = xp - p0
      const a = src[row + m0], b = src[row + m1], cc = src[row + p0], d = src[row + p1]
      const blur = 0.25 * (a + (b - a) * fm) + 0.5 * src[row + i] + 0.25 * (cc + (d - cc) * fp)
      dst[row + i] = src[row + i] + k * (blur - src[row + i])
    }
  }
  for (let r = 0; r < n; r++) {
    const c = Math.cos((tileRowLat(level, ty, r) * Math.PI) / 180)
    const inv = Math.min(DEEP_SMOOTH_MAX_ASPECT, 1 / Math.max(c, 1e-3))
    const k = Math.min(1, Math.max(0, (inv - EW_AA_BLEND_LO) / (EW_AA_BLEND_HI - EW_AA_BLEND_LO)))
    if (k <= 0) continue
    if (!out) { out = new Float32Array(heights); tmp = new Float32Array(heights) }
    const row = r * n
    // The first pass (spacing 1 / cos(lat), the same ground distance as a latitude texel) has a zero at the period of 2 / cos(lat) texels but passes
    // the period-2 ripple of a grid whose columns alternate; the second pass at one texel has its zero there.
    blurRow(heights, tmp!, row, inv, k)
    blurRow(tmp!, out, row, 1, k)
  }
  return out ?? heights
}

/**
 * De-contour. The built levels (0 and coarser) store heights in 8 m steps. On a gentle slope that is a staircase: runs of equal height with a
 * one-step riser every few texels, and east-west the texel is only cos(lat) as wide, so at 60 N a 8 m riser is a 2 degree facet. Lit from a low Sun
 * every riser is a thin line along the contour, and on ground that falls east or west the contours run north-south: the vertical streaks of
 * the Edge60 view (59.5 N 40 E; 41 per cent of east-west neighbours in the level-0 tile are equal, 33 per cent differ by exactly one step).
 * The true height is anywhere inside the quantisation cell (+-step / 2 of the stored value), so the smoothest surface that stays in every cell is
 * the honest reading: repeated binomial smoothing, each pass clamped back into the cell. Relief steeper than the step is untouched (it already
 * leaves the cell, so the clamp holds it); no height moves by more than step / 2.
 */
export const DECONTOUR_PASSES = 12
export function decontourHeights(heights: Float32Array, stepM: number, passes = DECONTOUR_PASSES): Float32Array {
  const n = H_SIZE
  const lo = new Float32Array(heights.length), hi = new Float32Array(heights.length)
  const half = stepM / 2
  for (let i = 0; i < heights.length; i++) { lo[i] = heights[i] - half; hi[i] = heights[i] + half }
  let cur = new Float32Array(heights)
  let nxt = new Float32Array(heights.length)
  const tmp = new Float32Array(heights.length)
  for (let k = 0; k < passes; k++) {
    // 1-2-1 east-west into tmp, then 1-2-1 north-south into nxt, edges clamped.
    for (let y = 0; y < n; y++) {
      const r = y * n
      for (let x = 0; x < n; x++) tmp[r + x] = 0.25 * cur[r + (x > 0 ? x - 1 : 0)] + 0.5 * cur[r + x] + 0.25 * cur[r + (x < n - 1 ? x + 1 : x)]
    }
    for (let y = 0; y < n; y++) {
      const r = y * n, a = (y > 0 ? y - 1 : 0) * n, b = (y < n - 1 ? y + 1 : y) * n
      for (let x = 0; x < n; x++) {
        const v = 0.25 * tmp[a + x] + 0.5 * tmp[r + x] + 0.25 * tmp[b + x]
        nxt[r + x] = v < lo[r + x] ? lo[r + x] : v > hi[r + x] ? hi[r + x] : v
      }
    }
    const t = cur; cur = nxt; nxt = t
  }
  return cur
}

/** The heights as they are uploaded: levels -2 and finer smoothed both ways, the rest anti-aliased east-west. */
export function prepareHeights(heights: Float32Array, level: number, ty: number): Float32Array {
  let filtered: Float32Array
  if (level <= DEEP_SMOOTH_MIN_LEVEL) filtered = smoothDeepHeights(heights, level, ty)
  else {
    const dc = level >= 0 && decodeFlags().decontour ? decontourHeights(heights, H_STEP_M) : heights
    filtered = decodeFlags().ewaa ? eastWestAntiAlias(dc, level, ty) : dc
  }
  // Coarse fallbacks also converge at the pole, and dominate where the finite
  // deep cache cannot cover every longitude. Filter after de-contouring so its
  // quantisation bounds still refer to the original source samples.
  return decodeFlags().polarfilter ? polarPrefilter(filtered, level, ty) : filtered
}

/**
 * Column destripe. The SLDEM source carries thin north-south scratch lines: a run of one to a few columns whose heights jitter by 3 to 5 m
 * from row to row (the tile at 59.5 N, 40 E, levels -3 and finer; measured: those columns' mean |h - mean of the two neighbours| is 2.5 to
 * 4.5 m against 0.45 m for the rest of the tile). A low Sun turns them into streaks. They are not a constant offset, so an offset
 * estimate (running mean, median of the east-west step) leaves them in; the columns are replaced instead, by interpolation between the
 * nearest good columns. A column is bad when, over a window of rows, that roughness is several times the window's median AND the bad run
 * is narrow (a crater rim or a ridge is rough over many columns, a scratch over a few). Windows blend linearly down the tile.
 * Applied before the smoothing, to levels -1 and finer.
 */
export const DESTRIPE_MIN_LEVEL = -1
const DESTRIPE_WINDOW = 64
const DESTRIPE_RATIO = 3.5
const DESTRIPE_MIN_ROUGH = 1.2
const DESTRIPE_MAX_RUN = 12
const DESTRIPE_EDGE = 3
const REPLACE_MAX_M = 12
/** The jitter columns exist at the 59 m level (-3) and finer; coarser levels only carry the faint offsets. */
const REPLACE_MAX_LEVEL = -3

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b)
  return s[s.length >> 1]
}

/** Columns flagged as scratches for a window of rows [row0, row1): 1 where bad, 0 elsewhere. Exported for tests. */
export function stripeColumns(heights: Float32Array, row0: number, row1: number): Uint8Array {
  const n = H_SIZE
  const q = new Float32Array(n)
  for (let j = 1; j < n - 1; j++) {
    let t = 0
    for (let y = row0; y < row1; y++) t += Math.abs(heights[y * n + j] - 0.5 * (heights[y * n + j - 1] + heights[y * n + j + 1]))
    q[j] = t / (row1 - row0)
  }
  const thr = Math.max(DESTRIPE_MIN_ROUGH, DESTRIPE_RATIO * median(Array.from(q.subarray(1, n - 1))))
  const flag = new Uint8Array(n)
  let j = DESTRIPE_EDGE
  while (j < n - DESTRIPE_EDGE) {
    if (q[j] <= thr) { j++; continue }
    let e = j
    while (e < n - 1 && q[e + 1] > thr) e++
    // The run must be narrow and have good columns on both sides inside the tile's interior.
    if (e - j + 1 <= DESTRIPE_MAX_RUN && j - 1 >= DESTRIPE_EDGE - 1 && e + 1 <= n - DESTRIPE_EDGE) for (let k = j; k <= e; k++) flag[k] = 1
    j = e + 1
  }
  return flag
}

/** The heights with scratch columns replaced. Returns the input when nothing is flagged. */
function replaceScratchColumns(heights: Float32Array): Float32Array {
  const n = H_SIZE
  const step = DESTRIPE_WINDOW / 2
  const centres: number[] = []
  const flags: Uint8Array[] = []
  for (let r0 = 0; ; r0 += step) {
    const a = Math.min(r0, n - DESTRIPE_WINDOW)
    centres.push(a + DESTRIPE_WINDOW / 2)
    flags.push(stripeColumns(heights, a, a + DESTRIPE_WINDOW))
    if (a === n - DESTRIPE_WINDOW) break
  }
  let any = false
  for (const f of flags) if (f.some((v) => v)) any = true
  if (!any) return heights
  const out = new Float32Array(heights)
  const w = new Float32Array(n)
  for (let y = 0; y < n; y++) {
    let k = 0
    while (k < centres.length - 2 && y >= centres[k + 1]) k++
    const t = Math.min(1, Math.max(0, (y - centres[k]) / (centres[k + 1] - centres[k])))
    let hit = false
    for (let j = 0; j < n; j++) { w[j] = flags[k][j] * (1 - t) + flags[k + 1][j] * t; if (w[j] > 0) hit = true }
    if (!hit) continue
    const row = y * n
    for (let j = 1; j < n - 1; j++) {
      if (w[j] <= 0) continue
      // The nearest columns that are not flagged in this row's blend (w == 0 on both sides is not required: use any column with w < 1).
      let l = j - 1
      while (l > 0 && w[l] >= 1) l--
      let r = j + 1
      while (r < n - 1 && w[r] >= 1) r++
      if (flags[k][l] || flags[k + 1][l] || flags[k][r] || flags[k + 1][r]) { l = Math.max(0, l - 1); r = Math.min(n - 1, r + 1) }
      const f = (j - l) / (r - l)
      const v = heights[row + l] + (heights[row + r] - heights[row + l]) * f
      // The source's jitter is a few metres; a larger departure from the interpolation is relief (a wall), left alone.
      if (Math.abs(v - heights[row + j]) > REPLACE_MAX_M) continue
      out[row + j] = heights[row + j] + (v - heights[row + j]) * Math.min(1, w[j])
    }
  }
  return out
}

/**
 * Column offsets. Past the noisy columns the source still carries a faint stripe pattern (level -2 and -1, where a low Sun lays a texel-wide
 * line along it): each column sits 0.2 to 1 m above or below its neighbours along the whole tile, against 0.1 m of expected noise. A column
 * offset c turns up in the mean, over the rows, of how far a column sits above the average of its two neighbours, as m[j] = c[j] - (c[j-1] +
 * c[j+1]) / 2. The offsets are the ridge-regularised least-squares solution of that (coordinate descent: five-diagonal and well conditioned
 * at the stripe frequencies), dead-banded at 0.1 m so terrain is never fitted, per half tile and blended down it. Rows enter clipped to 3 m so
 * a crater rim does not move the mean.
 */
const OFFSET_ROWS = 161
const OFFSET_RIDGE = 0.1
const OFFSET_DEADBAND = 0.1
const OFFSET_CLIP = 3

export function columnOffsets(heights: Float32Array, row0: number, row1: number): Float32Array {
  const n = H_SIZE
  const m = new Float64Array(n)
  for (let j = 1; j < n - 1; j++) {
    let t = 0
    for (let y = row0; y < row1; y++) {
      const r = heights[y * n + j] - 0.5 * (heights[y * n + j - 1] + heights[y * n + j + 1])
      t += r > OFFSET_CLIP ? OFFSET_CLIP : r < -OFFSET_CLIP ? -OFFSET_CLIP : r
    }
    m[j] = t / (row1 - row0)
  }
  const c = new Float64Array(n)
  for (let it = 0; it < 120; it++) {
    for (let j = 1; j < n - 1; j++) {
      let num = m[j] + 0.5 * (c[j - 1] + c[j + 1])
      let den = OFFSET_RIDGE + 1
      if (j - 1 >= 1) { num -= 0.5 * (m[j - 1] - (c[j - 1] - 0.5 * c[j - 2])); den += 0.25 }
      if (j + 1 <= n - 2) { num -= 0.5 * (m[j + 1] - (c[j + 1] - 0.5 * c[j + 2])); den += 0.25 }
      c[j] = num / den
    }
  }
  const out = new Float32Array(n)
  for (let j = 3; j < n - 3; j++) { const a = Math.abs(c[j]) - OFFSET_DEADBAND; out[j] = a > 0 ? Math.sign(c[j]) * a : 0 }
  return out
}

function removeColumnOffsets(heights: Float32Array): Float32Array {
  const n = H_SIZE
  const top = columnOffsets(heights, 0, OFFSET_ROWS), bottom = columnOffsets(heights, n - OFFSET_ROWS, n)
  const c0 = OFFSET_ROWS / 2, c1 = n - OFFSET_ROWS / 2
  const out = new Float32Array(heights)
  let any = false
  for (let y = 0; y < n; y++) {
    const t = Math.min(1, Math.max(0, (y - c0) / (c1 - c0)))
    for (let j = 3; j < n - 3; j++) {
      const o = top[j] * (1 - t) + bottom[j] * t
      if (o !== 0) { out[y * n + j] -= o; any = true }
    }
  }
  return any ? out : heights
}

/** The deep tile's heights with the source's north-south striping removed (scratch columns replaced, then column offsets). Coarser levels come back as they are. */
export function destripeHeights(heights: Float32Array, level: number): Float32Array {
  if (level > DESTRIPE_MIN_LEVEL) return heights
  if (!decodeFlags().destripe) return heights
  return removeColumnOffsets(level <= REPLACE_MAX_LEVEL ? replaceScratchColumns(heights) : heights)
}
