import { levelNx, levelNy } from './grid'

/**
 * Where a block of finer tiles ends. A deeper level is partial by contract (only the tiles that exist are written), so a tile whose
 * neighbour is missing would end in a straight line: 59 m detail on one side, the box-filtered 474 m field on the other, and tens of
 * metres of height step on every rim across it (a false shadow or light at a low Sun). The page table carries, per deeper tile, which
 * neighbours are absent; the shader scales the tile's weight toward those sides over TILE_FEATHER_TEXELS, so the finer level fades out
 * into the coarser one inside the tile, and the march's origin and its samples (both weighted by it) stay on one smooth height field.
 */
export const TILE_FEATHER_TEXELS = 24

export const MASK_W = 1, MASK_E = 2, MASK_N = 4, MASK_S = 8, MASK_NW = 16, MASK_NE = 32, MASK_SW = 64, MASK_SE = 128

/**
 * Bits of the neighbours a tile lacks. Longitude wraps; beyond a pole there is no neighbour to miss, so it counts as present. A corner bit
 * is set only when the diagonal is absent and both edge neighbours beside it are present (otherwise the edge bits already cover it).
 */
export function neighbourMask(level: number, tx: number, ty: number, present: (tx: number, ty: number) => boolean): number {
  const nx = levelNx(level), ny = levelNy(level)
  const has = (dx: number, dy: number): boolean => {
    const y = ty + dy
    if (y < 0 || y >= ny) return true
    return present((tx + dx + nx) % nx, y)
  }
  const w = has(-1, 0), e = has(1, 0), n = has(0, -1), s = has(0, 1)
  let m = 0
  if (!w) m |= MASK_W
  if (!e) m |= MASK_E
  if (!n) m |= MASK_N
  if (!s) m |= MASK_S
  if (w && n && !has(-1, -1)) m |= MASK_NW
  if (e && n && !has(1, -1)) m |= MASK_NE
  if (w && s && !has(-1, 1)) m |= MASK_SW
  if (e && s && !has(1, 1)) m |= MASK_SE
  return m
}

const smooth = (edge: number, x: number): number => { const t = Math.min(1, Math.max(0, x / edge)); return t * t * (3 - 2 * t) }

/** The CPU twin of the shader's tileFeather: weight 0..1 at (fx, fy) inside the tile (0..1, y down), given the mask. */
export function featherWeight(fx: number, fy: number, mask: number, texels = TILE_FEATHER_TEXELS, px = 320): number {
  const W = texels / px
  let w = 1
  if (mask & MASK_W) w *= smooth(W, fx)
  if (mask & MASK_E) w *= smooth(W, 1 - fx)
  if (mask & MASK_N) w *= smooth(W, fy)
  if (mask & MASK_S) w *= smooth(W, 1 - fy)
  if (mask & MASK_NW) w *= smooth(W, Math.max(fx, fy))
  if (mask & MASK_NE) w *= smooth(W, Math.max(1 - fx, fy))
  if (mask & MASK_SW) w *= smooth(W, Math.max(fx, 1 - fy))
  if (mask & MASK_SE) w *= smooth(W, Math.max(1 - fx, 1 - fy))
  return w
}
