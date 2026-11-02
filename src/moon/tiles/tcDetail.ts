import { resolveDataBase } from '../dataBase'
import { getQuality } from '../../quality/settings'
import { C_PX, levelNx, levelNy } from './grid'
import { detailTexelKm, neutraliseNoData, poleWeight } from './detail'
import { TILE_FEATHER_TEXELS, featherWeight } from './feather'
import { TC_CAPACITY_DEFAULT } from './capacity'

/**
 * The JAXA SELENE Terrain Camera detail ratio (scripts/terrain/tc_detail.py): u8 tiles `<base>d/<L>/<tx>_<ty>.webp`, L = -3, -4, -5 (12.5 m texel at -5),
 * `ratio = 2^((byte - mid) / perOctave)` of the TC mosaic over its own 0.8 km low-pass, multiplying the level-0 albedo like the WAC detail and replacing it
 * where it is present. On by default (owner decision 2026-10-06) from DEFAULT_TC_BASE at gain DEFAULT_TC_GAIN; `?tc=<base>` names another base holding `tc.json` and the tiles, `?tc=off` turns it off (nothing here runs, no shader variant changes), and a base without a readable `tc.json` leaves the layer off.
 * Everything the shader does with it has a CPU twin here so it is tested without a GPU.
 */
export const TC_LEVELS = [-3, -4, -5] as const
export type TcLevel = (typeof TC_LEVELS)[number]
/** Page table: level -3 (576 x 288), -4 (1152 x 576), -5 (2304 x 1152) stacked, 2304 wide. RGBA8: r = layer + 1 (0 none), g = fade 0..255, a = absent-neighbour mask. */
export const TC_PAGE_W = 2304
export const TC_PAGE_H = 288 + 576 + 1152
export const TC_ROW: Readonly<Record<number, number>> = { [-3]: 0, [-4]: 288, [-5]: 864 }
export const tcRow = (level: number): number => TC_ROW[level]
export const TC_FADE_MS = 250
/** Resident tiles the cache holds by default (each 382 x 382 R8 with mips, about 0.2 MB); a class may ask for more (capacity.ts tcCapacity). */
export const TC_CAPACITY = TC_CAPACITY_DEFAULT
export const TC_CREDIT = 'ISAS/JAXA (modified)'

export interface TcLevelEntry { level: number; nx: number; ny: number; presentRle: Array<[number, number]> }
export interface TcManifest { version: 1; format: 'webp-u8-ratio'; mid: number; perOctave: number; levels: TcLevelEntry[] }

/**
 * The Terrain Camera base (scripts/terrain/tc_global.py writes tc.json last; a base without it leaves the layer off): VITE_MOON_TC, like the
 * tiles and patch bases. Unset means no layer. The publish scripts bake the live build; the dev server sets it from MOON_REMOTE_BASE
 * (devTcBase in devRedirect.ts, read by vite.config.ts), so `npm run dev:hosted` shows it and an offline `npm run dev` does not ask for it.
 */
export const DEFAULT_TC_BASE: string = (import.meta.env?.VITE_MOON_TC as string | undefined) ?? ''
/** Owner decision 2026-10-06: gain 1.5 (the A/B verdict). */
export const DEFAULT_TC_GAIN = 1.5

/** `?tc=<base>`: that base (trailing slash added); DEFAULT_TC_BASE when absent; null for `?tc=off`, `?tc=0` or `?tc=` (empty), and when the default is empty. */
export function tcBase(search: string = (globalThis as { location?: { search?: string } }).location?.search ?? ''): string | null {
  return resolveDataBase('tc', new URLSearchParams(search).get('tc'), DEFAULT_TC_BASE)
}

/** `?tcgain=<n>` scales the log2 ratio (clamped 0..8), default DEFAULT_TC_GAIN (1.5). */
export function tcGain(search?: string): number {
  // Surface detail: Reduced also drops the JAXA terrain-camera texture. An explicit `search` is a test's and skips it.
  if (search === undefined) {
    if (getQuality().detail === 'reduced') return 0
    search = (globalThis as { location?: { search?: string } }).location?.search ?? ''
  }
  const q = new URLSearchParams(search).get('tcgain')
  if (q === null || q === '') return DEFAULT_TC_GAIN
  const n = Number(q)
  return Number.isFinite(n) ? Math.min(8, Math.max(0, n)) : DEFAULT_TC_GAIN
}

/** `?tcuv=0|1|2`: where the TC is looked up (0 the terrain-resolved hit, 1 the smoothed ground, 2 the sphere hit). Default 0 (the true terrain hit); see moonShader.ts detailApplyTc. */
export function tcUvMode(search: string = (globalThis as { location?: { search?: string } }).location?.search ?? ''): number {
  const q = new URLSearchParams(search).get('tcuv')
  return q === '1' || q === '2' ? Number(q) : 0
}

/** A manifest this client can read; anything else (wrong scale, malformed run lists, unknown levels) is rejected whole. */
export function validateTcManifest(raw: unknown): TcManifest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const m = raw as Record<string, unknown>
  if (m.version !== 1 || m.format !== 'webp-u8-ratio' || typeof m.mid !== 'number' || typeof m.perOctave !== 'number' || !(m.perOctave > 0) || !Array.isArray(m.levels)) return null
  const levels: TcLevelEntry[] = []
  const seen = new Set<number>()
  for (const v of m.levels) {
    if (!v || typeof v !== 'object') return null
    const e = v as Record<string, unknown>
    const l = e.level
    if (typeof l !== 'number' || !(TC_LEVELS as readonly number[]).includes(l) || seen.has(l)) return null
    if (e.nx !== levelNx(l) || e.ny !== levelNy(l) || !Array.isArray(e.presentRle)) return null
    const total = levelNx(l) * levelNy(l)
    let end = 0
    for (const run of e.presentRle) {
      if (!Array.isArray(run) || run.length !== 2) return null
      const [s, n] = run as [unknown, unknown]
      if (!Number.isSafeInteger(s) || !Number.isSafeInteger(n) || (s as number) < end || (n as number) <= 0 || (s as number) + (n as number) > total) return null
      end = (s as number) + (n as number)
    }
    seen.add(l)
    levels.push({ level: l, nx: levelNx(l), ny: levelNy(l), presentRle: e.presentRle as Array<[number, number]> })
  }
  return { version: 1, format: 'webp-u8-ratio', mid: m.mid, perOctave: m.perOctave, levels }
}

const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/**
 * Weight of a TC level: full while a pixel spans one texel or less, gone at two, times the tile's fade-in, the view gate, the pole cutoff and
 * (1 - the site patch's own coverage 0..1): inside a NAC patch the patch photograph is the detail and TC (lit from the other side) must not show.
 * Shader twin: tjLevel.
 */
export function tcWeight(level: number, fpKm: number, fade: number, gate: number, latDeg: number, patchCover = 0): number {
  const ramp = 1 - smooth(1, 2, fpKm / detailTexelKm(level))
  return Math.max(0, Math.min(1, fade)) * ramp * gate * poleWeight(latDeg) * (1 - Math.max(0, Math.min(1, patchCover)))
}

/** log2 of the ratio a TC byte stands for, times the gain; no-data and out-of-range bytes are neutral. */
export function tcLog2(byte: number, mid: number, perOctave: number, gain = 1): number {
  if (byte <= 0 || byte > 255) return 0
  return ((byte - mid) / perOctave) * gain
}

/**
 * The detail log2 the shader applies: the WAC value (already scaled by its own strength) mixed toward each TC level's value by that level's weight,
 * coarse to fine (-3, -4, -5). An absent TC level (weight 0) leaves the WAC value. Shader twin: TJ_APPLY.
 */
export function tcMixLog2(wacLog2: number, layers: ReadonlyArray<{ log2: number; w: number }>): number {
  let a = wacLog2
  for (const l of layers) a += (l.log2 - a) * l.w
  return a
}

/** True when a TC tile can contribute at this surface point (resident, past its first fade frame, nonzero weight): for the Credits panel. */
export function tcSourceAt(page: Uint8Array, lonDeg: number, latDeg: number, fpKm: number, gate = 1): boolean {
  const lon = ((lonDeg + 180) % 360 + 360) % 360
  const u = lon / 360
  const v = Math.min(1 - Number.EPSILON, Math.max(0, (90 - latDeg) / 180))
  for (const level of TC_LEVELS) {
    const nx = levelNx(level), ny = levelNy(level)
    const gx = u * nx, gy = v * ny
    const tx = Math.min(nx - 1, Math.floor(gx)), ty = Math.min(ny - 1, Math.floor(gy))
    const o = 4 * ((tcRow(level) + ty) * TC_PAGE_W + tx)
    const layer = page[o], fade = page[o + 1] / 255, mask = page[o + 3]
    if (layer <= 0 || fade <= 0) continue
    if (tcWeight(level, fpKm, fade, gate, latDeg) * featherWeight(gx - tx, gy - ty, mask, TILE_FEATHER_TEXELS, C_PX) > 0) return true
  }
  return false
}

export { neutraliseNoData }
