import { getQuality } from '../../quality/settings'
import { C_TEXEL_KM, C_PX, levelDeg, levelNx, levelNy } from './grid'
import { featherWeight, TILE_FEATHER_TEXELS } from './feather'

/**
 * The WAC detail-ratio product (WAC-DETAIL-WIRING.md, TILE-CONTRACT.md 1b): tiles `d/<L>/<tx>_<ty>.webp`, L = -1, -2, lossless greyscale,
 * `ratio = 2^((byte - mid) / perOctave)` multiplying the level-0 albedo, `mid` = 1.0, byte 0 = no data. Everything the shader does with it has a
 * CPU twin here so it is tested without a GPU.
 */
export const DETAIL_MID = 128
export const DETAIL_PER_OCTAVE = 40
/** Fully applied up to this latitude (deg), gone by DETAIL_POLE_END: the equirectangular source is streaks toward the poles. */
export const DETAIL_POLE_START = 76
export const DETAIL_POLE_END = 80
/**
 * The product is WAC / lowpass(WAC), so on sloping ground it also carries WAC's own relief shading (its Sun, not the viewer's), which the
 * viewer already draws from the heights. The ratio is therefore applied on gentle ground only (albedo texture, rays, small craters): full below
 * DETAIL_SLOPE_START degrees of slope, gone from DETAIL_SLOPE_END. Measured on the rig 2026-10-04: without it Tycho's rim wears contour ripples.
 */
export const DETAIL_SLOPE_START = 2
export const DETAIL_SLOPE_END = 6
/** Fade-in of a freshly arrived detail tile, ms (same as the height tiles). */
export const DETAIL_FADE_MS = 250
/** Levels carrying detail, coarse to fine. */
export const DETAIL_LEVELS = [-1, -2] as const

/** log2 of the ratio a byte stands for; byte 0 (no data) and anything outside 1..255 is neutral. */
export function detailLog2(byte: number, mid = DETAIL_MID, perOctave = DETAIL_PER_OCTAVE): number {
  if (byte <= 0 || byte > 255) return 0
  return (byte - mid) / perOctave
}
export const detailRatio = (byte: number, mid = DETAIL_MID, perOctave = DETAIL_PER_OCTAVE): number => 2 ** detailLog2(byte, mid, perOctave)

/** Decoded pixels to the bytes uploaded: no-data (0) becomes the neutral mid so bilinear filtering never pulls a tile toward black. */
export function neutraliseNoData(bytes: Uint8Array, mid = DETAIL_MID): void {
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0) bytes[i] = mid
}

const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/** 1 at and below DETAIL_POLE_START degrees of latitude, 0 at and beyond DETAIL_POLE_END (shader twin: poleK). */
export const poleWeight = (latDeg: number): number => 1 - smooth(DETAIL_POLE_START, DETAIL_POLE_END, Math.abs(latDeg))

/** 1 on flat ground, 0 on slopes steeper than DETAIL_SLOPE_END degrees (shader twin: slopeK). */
export const slopeWeight = (slopeDeg: number): number => 1 - smooth(DETAIL_SLOPE_START, DETAIL_SLOPE_END, slopeDeg)

/** Ground size of one detail texel at a level, km (the colour grid: 76 ppd at level 0, doubling per level down). */
export const detailTexelKm = (level: number): number => C_TEXEL_KM * 2 ** level

/**
 * Weight of a detail level for a pixel footprint (km): full while a pixel spans one texel or less, gone at two (the base map holds the rest),
 * times the tile's fade-in (0..1), the view gate and the pole cutoff. Shader twin: detailWeight.
 */
export function detailWeight(level: number, fpKm: number, fade: number, gate: number, latDeg: number, preblendedPolar = false): number {
  const ramp = 1 - smooth(1, 2, fpKm / detailTexelKm(level))
  return Math.max(0, Math.min(1, fade)) * ramp * gate * (preblendedPolar ? 1 : poleWeight(latDeg))
}

/** Sources at one surface sample, read from the same RGBA page table the shader binds. */
export interface DetailSources { global: boolean; polar: boolean }

/**
 * CPU twin of the detail page lookup/weight gates for a single surface point.
 * It is deliberately read-only and lets UI attribution distinguish a resident
 * cache from a source that can contribute at the visible ray.
 */
export function detailSourcesAt(pageData: Float32Array, lonDeg: number, latDeg: number, fpKm: number, gate = 1, slopeDeg = 0): DetailSources {
  const lon = ((lonDeg + 180) % 360 + 360) % 360
  const u = lon / 360
  const v = Math.min(1 - Number.EPSILON, Math.max(0, (90 - latDeg) / 180))
  const out: DetailSources = { global: false, polar: false }
  for (const level of DETAIL_LEVELS) {
    const nx = levelNx(level), ny = levelNy(level)
    const gx = u * nx, gy = v * ny
    const tx = Math.min(nx - 1, Math.floor(gx)), ty = Math.min(ny - 1, Math.floor(gy))
    const px = tx, py = detailRow(level) + ty
    const offset = 4 * (py * DETAIL_PAGE_W + px)
    const layer = pageData[offset], fade = pageData[offset + 1], isPolar = pageData[offset + 2] > 0.5, mask = Math.round(pageData[offset + 3])
    if (layer <= 0 || fade <= 0) continue
    const sourceWeight = detailWeight(level, fpKm, fade, gate, latDeg, isPolar)
      * slopeWeight(slopeDeg)
      * featherWeight(gx - tx, gy - ty, mask, TILE_FEATHER_TEXELS, C_PX)
    if (sourceWeight <= 0) continue
    if (isPolar) {
      // Polar-marked tiles are already preblended with global detail through 76–80°.
      // Attribute the two contributors according to the same latitude transition.
      const polarShare = 1 - poleWeight(latDeg)
      if (polarShare > 0) out.polar = true
      if (polarShare < 1) out.global = true
    } else out.global = true
  }
  return out
}

/** Total log2 ratio applied: the levels mix coarse to fine, each toward its own value by its weight (an absent level has weight 0). */
export function detailLog2Mixed(layers: ReadonlyArray<{ log2: number; w: number }>, k = 1): number {
  let a = 0
  for (const l of layers) a += (l.log2 - a) * l.w
  return a * k
}

/** `?detail=0` off, `?detail=<x>` scales the log-ratio (clamped 0..2), default 1. */
export function detailStrength(search?: string): number {
  // The Quality sheet's Surface detail: Reduced drops the fine-grain texture (and with it its streaming). An explicit `search` is a test's and skips it.
  if (search === undefined) {
    if (getQuality().detail === 'reduced') return 0
    search = (globalThis as { location?: { search?: string } }).location?.search ?? ''
  }
  const q = new URLSearchParams(search).get('detail')
  if (q === null || q === '') return 1
  const n = Number(q)
  return Number.isFinite(n) ? Math.min(2, Math.max(0, n)) : 1
}

/** Page-table geometry of the detail cache: level -1 (144 x 72) stacked above level -2 (288 x 144), 288 wide. */
export const DETAIL_PAGE_W = 288
export const DETAIL_PAGE_H = 72 + 144
export const detailRow = (level: number): number => (level === -1 ? 0 : 72)

/** Whether any part of a detail tile (including its one-texel border) can
 * contribute below the shader's polar cutoff. Do not download invisible polar
 * WAC tiles merely because their height tiles are useful. */
export function detailTileVisible(level: number, ty: number): boolean {
  const deg = levelDeg(level)
  const north = 90 - ty * deg, south = north - deg
  const nearest = south >= 0 ? south : north <= 0 ? -north : 0
  return nearest < DETAIL_POLE_END + deg / C_PX
}
