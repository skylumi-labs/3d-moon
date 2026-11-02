/**
 * A max-height pyramid over the site patch, in the patch's own metre frame (east, north of the site point), for the ground pass's terrain hit
 * (R4: the max-mip descent in groundShader.ts `groundHit`; `groundHit.ts` is its CPU twin).
 *
 * Level 0 is cells of SM_CELL_M metres, each holding the highest ground any patch height level can show inside it (the texels' bilinear
 * footprints, plus a one cell dilation); each coarser level is the max of 2 x 2. Where the patch's heights are not the whole truth the cell
 * holds SM_OPEN (never skipped): within the coarsest level's edge fade (`fadeM`), where the shader mixes the tiles' heights in, and in every
 * cell not yet covered. Nothing is ever lowered, so a bound that grows as finer levels arrive stays valid for the levels already drawn.
 */
export const SM_CELL_M = 32
export const SM_LEVELS = 8
/** The descent's start level, step budget (the fixed march's, so a ray the grid cannot help is no worse off), exit epsilon (cells) and the clearance (m) a skip needs. */
export const GM_START = 3
export const GM_ITER = 800
export const GM_EPS = 0.0125
export const GM_MARGIN_M = 0.5
/** After a level-0 cell the ray cannot skip, the next metres are marched without reading the grid (the cell read is wasted while the ray hugs the ground). */
export const GM_HOLD_M = 3
/** A cell the descent must never skip. */
export const SM_OPEN = 1e9

/** The part of a patch level the grid needs: its corner (metres east/north of the site), size, texel size and axes (rotated levels). */
export interface SiteLevel {
  eastM: number
  northM: number
  w: number
  h: number
  texelEastM: number
  texelNorthM: number
  axisEastPerTexelM?: [number, number]
  axisSouthPerTexelM?: [number, number]
}

export class SiteMax {
  readonly e0: number
  readonly n0: number
  readonly w: number
  readonly h: number
  readonly levels: Float32Array[] = []
  /** Bytes the grid holds on the JS heap and (as an R32F mip chain) on the GPU, for the memory ledger. */
  readonly bytes: { heap: number; gpu: number }
  private readonly raw: Float32Array
  /** Edge ring (metres) of the frame in which cells stay open. */
  private readonly fadeM: number
  private open: Uint8Array
  revision = 0

  /**
   * `frame`: the coarsest height level's rectangle (what the shader's tile fade is measured from); `fadeM`: its edge fade.
   * `extent`: the rectangle the grid covers (default the frame). With a wide band as the frame the grid is sized to the fine footprint
   * instead (a 148 km frame at 32 m is 4736 x 4736 cells, 350 MB); the descent only reads the grid inside it and marches as before outside.
   * Levels still add every texel of theirs that falls inside the extent, the band's included.
   */
  constructor(frame: SiteLevel, fadeM: number, extent: SiteLevel = frame) {
    const [ex, ey] = extent.axisEastPerTexelM ?? [extent.texelEastM, 0]
    const [sx, sy] = extent.axisSouthPerTexelM ?? [0, -extent.texelNorthM]
    const xs: number[] = [], ys: number[] = []
    for (const [i, j] of [[0, 0], [extent.w, 0], [0, extent.h], [extent.w, extent.h]]) { xs.push(extent.eastM + i * ex + j * sx); ys.push(extent.northM + i * ey + j * sy) }
    this.e0 = Math.min(...xs)
    this.n0 = Math.max(...ys)
    // Padded to a multiple of 2^(levels - 1): GL's mip chain halves by floor, so every level must be an exact half of the one below it.
    const pad = 1 << (SM_LEVELS - 1)
    this.w = Math.ceil((Math.ceil((Math.max(...xs) - this.e0) / SM_CELL_M) + 1) / pad) * pad
    this.h = Math.ceil((Math.ceil((this.n0 - Math.min(...ys)) / SM_CELL_M) + 1) / pad) * pad
    this.fadeM = fadeM
    this.raw = new Float32Array(this.w * this.h).fill(-SM_OPEN)
    this.open = new Uint8Array(this.w * this.h)
    this.markOpen(frame)
    let heap = this.raw.byteLength + this.open.byteLength, gpu = 0
    let lw = this.w, lh = this.h
    for (let l = 0; l < SM_LEVELS; l++) { this.levels.push(new Float32Array(lw * lh)); heap += lw * lh * 4; gpu += lw * lh * 4; lw = Math.ceil(lw / 2); lh = Math.ceil(lh / 2) }
    this.bytes = { heap, gpu }
    this.rebuild([0, 0, this.w - 1, this.h - 1])
  }

  /** Cells within the fade of the frame's edge, or outside the frame, stay open. */
  private markOpen(frame: SiteLevel): void {
    const [ex, ey] = frame.axisEastPerTexelM ?? [frame.texelEastM, 0]
    const [sx, sy] = frame.axisSouthPerTexelM ?? [0, -frame.texelNorthM]
    const det = ex * sy - sx * ey
    const inv = [sy / det, -sx / det, -ey / det, ex / det]
    const fe = this.fadeM, fn = this.fadeM
    for (let cy = 0; cy < this.h; cy++) for (let cx = 0; cx < this.w; cx++) {
      let ok = true
      // The four corners and the centre of the cell, with the fade as margin: every one must lie inside the frame by more than the fade.
      for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) {
        const e = this.e0 + (cx + a) * SM_CELL_M - frame.eastM, n = this.n0 - (cy + b) * SM_CELL_M - frame.northM
        const qx = inv[0] * e + inv[1] * n, qy = inv[2] * e + inv[3] * n
        if (qx * frame.texelEastM < fe || (frame.w - qx) * frame.texelEastM < fe || qy * frame.texelNorthM < fn || (frame.h - qy) * frame.texelNorthM < fn) { ok = false; break }
      }
      this.open[cy * this.w + cx] = ok ? 0 : 1
    }
  }

  /**
   * A finished height level: `at(i)` the ground height in metres (absolute: the level's offset already added) of texel i of its w x h raster.
   * Each texel counts toward every cell its bilinear footprint touches.
   */
  async addLevel(l: SiteLevel, at: (i: number) => number, tick?: () => Promise<void>): Promise<void> {
    const [ex, ey] = l.axisEastPerTexelM ?? [l.texelEastM, 0]
    const [sx, sy] = l.axisSouthPerTexelM ?? [0, -l.texelNorthM]
    const texel = Math.max(Math.hypot(ex, ey), Math.hypot(sx, sy))
    // The one-cell dilation of `rebuild` covers a texel smaller than the cell; a larger one reaches into its neighbours itself.
    const reach = Math.floor(texel / SM_CELL_M)
    let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1
    for (let j = 0; j < l.h; j++) {
      if (tick && (j & 15) === 0) await tick()
      for (let i = 0; i < l.w; i++) {
        const e = l.eastM + (i + 0.5) * ex + (j + 0.5) * sx, n = l.northM + (i + 0.5) * ey + (j + 0.5) * sy
        const cx = Math.floor((e - this.e0) / SM_CELL_M), cy = Math.floor((this.n0 - n) / SM_CELL_M)
        const v = at(j * l.w + i)
        for (let dy = -reach; dy <= reach; dy++) {
          const y = cy + dy
          if (y < 0 || y >= this.h) continue
          for (let dx = -reach; dx <= reach; dx++) {
            const x = cx + dx
            if (x < 0 || x >= this.w) continue
            const k = y * this.w + x
            if (v > this.raw[k]) { this.raw[k] = v; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
          }
        }
      }
    }
    this.rebuild([x0, y0, x1, y1])
  }

  /** Dilated level 0 (open cells and cells nobody covered read SM_OPEN) and the levels above, recomputed only over the cells that changed (`r`: x0, y0, x1, y1). */
  private rebuild(r: [number, number, number, number]): void {
    if (r[2] < r[0] || r[3] < r[1]) return
    const l0 = this.levels[0]
    // A raised raw cell changes its 3 x 3 neighbourhood.
    let x0 = Math.max(0, r[0] - 1), y0 = Math.max(0, r[1] - 1), x1 = Math.min(this.w - 1, r[2] + 1), y1 = Math.min(this.h - 1, r[3] + 1)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      let m = -SM_OPEN, blocked = false
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx
        if (yy < 0 || yy >= this.h || xx < 0 || xx >= this.w) continue
        const k = yy * this.w + xx
        if (this.open[k]) blocked = true
        if (this.raw[k] > m) m = this.raw[k]
      }
      l0[y * this.w + x] = blocked || m <= -SM_OPEN / 2 ? SM_OPEN : m
    }
    let pw = this.w, ph = this.h
    for (let l = 1; l < SM_LEVELS; l++) {
      const w = Math.ceil(pw / 2)
      const src = this.levels[l - 1], out = this.levels[l]
      x0 >>= 1; y0 >>= 1; x1 >>= 1; y1 >>= 1
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        let m = -SM_OPEN
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const yy = 2 * y + dy, xx = 2 * x + dx
          if (yy >= ph || xx >= pw) continue
          const v = src[yy * pw + xx]
          if (v > m) m = v
        }
        out[y * w + x] = m
      }
      pw = w; ph = Math.ceil(ph / 2)
    }
    this.revision++
  }

  /** The stored bound (metres) of the level-l cell holding the patch point (e, n); SM_OPEN outside the grid. */
  at(l: number, e: number, n: number): number {
    const fx = (e - this.e0) / SM_CELL_M, fy = (this.n0 - n) / SM_CELL_M
    if (fx < 0 || fy < 0 || fx >= this.w || fy >= this.h) return SM_OPEN
    const lw = Math.ceil(this.w / (1 << l)), lh = Math.ceil(this.h / (1 << l))
    return this.levels[l][Math.min(lh - 1, Math.floor(fy / (1 << l))) * lw + Math.min(lw - 1, Math.floor(fx / (1 << l)))]
  }

  /** Level sizes, for the texture's mip chain. */
  size(l: number): [number, number] { return [Math.ceil(this.w / (1 << l)), Math.ceil(this.h / (1 << l))] }
}
