/**
 * The tile pyramid's geometry, shared by the builder (scripts/build-tiles-m2.mts)
 * and the streamer (TileStreamer.ts). DESIGN-M2.md section 4.
 *
 * Level 0 is a 5 deg grid (72 x 36), level 1 10 deg (36 x 18), level 2 20 deg
 * (18 x 9). Every level's tile holds the same pixel counts, so a coarser tile
 * is a 2x or 4x box-filtered copy. tx counts from longitude -180 eastwards, ty
 * from latitude +90 southwards. Each stored tile carries a 1 pixel border cut
 * from its neighbours (wrapping across longitude 180, clamped at the poles),
 * so hardware bilinear filtering never reads across an edge.
 */

export const TILE_LEVELS = 3
export const L0_DEG = 5
/** Heights: 320 px per tile side (64 px/deg), colour 380 px (76 px/deg). */
export const H_PX = 320
export const C_PX = 380
export const BORDER = 1
export const H_SIZE = H_PX + 2 * BORDER
export const C_SIZE = C_PX + 2 * BORDER
/** Height quantisation, metres. Multiples of 8 m are exact in half float up to 16,384 m. */
export const H_STEP_M = 8
/** Ground size of one L0 texel at the equator, km (2 pi R / 360 / ppd). */
export const MOON_R_KM = 1737.4
export const H_TEXEL_KM = (2 * Math.PI * MOON_R_KM) / 360 / (H_PX / L0_DEG)
export const C_TEXEL_KM = (2 * Math.PI * MOON_R_KM) / 360 / (C_PX / L0_DEG)

export const levelDeg = (level: number): number => L0_DEG * 2 ** level
export const levelNx = (level: number): number => 360 / levelDeg(level)
export const levelNy = (level: number): number => 180 / levelDeg(level)
export const levelTiles = (level: number): number => levelNx(level) * levelNy(level)
/** Row offset of a level in the page table (levels stacked, 72 columns wide). */
export const pageRowOffset = (level: number): number => {
  let r = 0
  for (let l = 0; l < level; l++) r += levelNy(l)
  return r
}
export const PAGE_W = levelNx(0)
export const PAGE_H = pageRowOffset(TILE_LEVELS)

/** Tile column/row containing a longitude and latitude (deg) at a level. */
export function tileOf(level: number, lon: number, lat: number): { tx: number; ty: number } {
  const d = levelDeg(level)
  const nx = levelNx(level), ny = levelNy(level)
  const l = ((lon + 180) % 360 + 360) % 360
  return {
    tx: Math.min(nx - 1, Math.floor(l / d)),
    ty: Math.min(ny - 1, Math.max(0, Math.floor((90 - lat) / d))),
  }
}

export const tileKey = (level: number, tx: number, ty: number): number => pageRowOffset(level) * PAGE_W + ty * levelNx(level) + tx
/** Index into a level's row-major presence string and min/max arrays. */
export const tileIndex = (level: number, tx: number, ty: number): number => ty * levelNx(level) + tx

export interface TileManifest {
  version: 1
  tileDeg: number
  levels: number
  height: { px: number; border: number; stepM: number; ppd: number; texelKm: number }
  color: { px: number; border: number; ppd: number; texelKm: number }
  /** Per level: '1' where the tile exists, row-major (ty * nx + tx). */
  present: string[]
  /** Per level: each tile's lowest and highest height in units of stepM. */
  minQ: number[][]
  maxQ: number[][]
  /** Free text: what the set was built from. */
  source: string
  /** Optional preblended polar WAC detail tiles; omitted manifests keep the existing detail route unchanged. */
  polarDetail?: {
    version: 'polar-wac-detail-v1'
    path: string
    format: 'webp-u8-ratio'
    mid: number
    perOctave: number
    transitionDeg: [number, number]
    blend: 'log2-global-polar-v1'
    levels: Array<{
      level: -1 | -2
      nx: number
      ny: number
      present?: string
      presentRle?: Array<[number, number]>
    }>
  }
}

export const heightPath = (level: number, tx: number, ty: number): string => `h/${level}/${tx}_${ty}.bin.gz`
export const detailPath = (level: number, tx: number, ty: number): string => `d/${level}/${tx}_${ty}.webp`
export const colorPath = (level: number, tx: number, ty: number): string => `c/${level}/${tx}_${ty}.webp`

// ---------------------------------------------------------------------------
// Deeper levels (TILE-CONTRACT.md section 1b). The built set is levels 0 to 2 (5, 10, 20 degree tiles, 64 ppd at level 0).
// A finer global set continues the same ladder downward with NEGATIVE levels: level -k is a 5 / 2^k degree grid with the same
// pixel counts per tile, so 2^k times the pixels per degree (-3: 0.625 degree tiles, 512 ppd, SLDEM2015's 59 m). Every function
// above is already exact for k > 0 in `levelDeg`/`levelNx`/`levelNy`/`tileOf`; the functions below give the page-table geometry and
// the ground size. The streamer and the shader still draw levels 0 to 2 only: a manifest's `deeper` block is read, listed and
// ignored by them, so the three-level set stays the fallback everywhere.
// ---------------------------------------------------------------------------
/**
 * The deepest level the contract allows (512 ppd at -3 is SLDEM2015; -4 and -5 are finer than any global height set). -5 (2432 ppd colour, 12.5 m) exists for
 * the opt-in JAXA TC detail ratio (`?tc=`, tcDetail.ts). It only sizes tables and bounds loops: a manifest's own `deeper` block decides which levels the
 * height streamer, the shader and the page table actually use, so a viewer without `?tc=` is unchanged (scripts/tc-deepest.test.mts).
 */
export const DEEPEST_LEVEL = -5

/** Height pixels per degree at a level (64 at level 0). */
export const heightPpd = (level: number): number => (H_PX / L0_DEG) * 2 ** -level
/** Ground size of one height texel at the equator, km, at a level. */
export const heightTexelKm = (level: number): number => H_TEXEL_KM * 2 ** level
/** The finest level whose height texel is no coarser than `texelKm` (e.g. 0.059 km gives -3), clamped to [DEEPEST_LEVEL, 0]. A texel within 0.15 % counts as equal (manifests round it to four digits). */
export function levelForTexelKm(texelKm: number): number {
  if (!(texelKm > 0)) return DEEPEST_LEVEL
  return Math.max(DEEPEST_LEVEL, Math.min(0, Math.floor(Math.log2(texelKm / H_TEXEL_KM) + 2e-3)))
}
/**
 * The page-table row where a negative level starts, below the three built levels (row PAGE_H onward, finest last). Level -1 has
 * 144 columns and 72 rows, so deeper levels need a wider table than PAGE_W: `pageWidth(level)` says how wide.
 */
export function deeperRowOffset(level: number): number {
  let r = PAGE_H
  for (let l = -1; l > level; l--) r += levelNy(l)
  return r
}
export const pageWidth = (level: number): number => Math.max(PAGE_W, levelNx(level))
