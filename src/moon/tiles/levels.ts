import { deeperRowOffset, pageRowOffset, PAGE_H, TILE_LEVELS, DEEPEST_LEVEL } from './grid'

/**
 * The tile ladder the streamer and the Moon shader share. The built set is levels 2, 1, 0 (20, 10, 5 degree tiles); a manifest's
 * `deeper` block (TILE-CONTRACT.md 1b) continues it with NEGATIVE levels -1 .. -3 (2.5, 1.25, 0.625 degree tiles, 128 to 512 ppd).
 * `deepest` is the finest level present, 0 when the manifest has no deeper block: every function here then answers exactly as the
 * three-level code did, which is the fallback.
 */
export const COARSEST_LEVEL = TILE_LEVELS - 1

/** Levels coarse to fine: [2, 1, 0, -1, ..., deepest]. */
export function ladder(deepest: number): number[] {
  const out: number[] = []
  for (let l = COARSEST_LEVEL; l >= Math.max(deepest, DEEPEST_LEVEL); l--) out.push(l)
  return out
}

/** Page-table row where a level starts (levels 0..2 stacked, deeper levels below them). */
const rowOf = new Map<number, number>()
export const levelRow = (level: number): number => {
  let r = rowOf.get(level)
  if (r === undefined) { r = level >= 0 ? pageRowOffset(level) : deeperRowOffset(level); rowOf.set(level, r) }
  return r
}

/** Page-table height for a ladder down to `deepest`. */
export function pageRows(deepest: number): number {
  return deepest >= 0 ? PAGE_H : deeperRowOffset(deepest) + 180 / (5 * 2 ** deepest)
}

/** The finest level a pixel footprint (km on the ground) wants: the first whose texel (times `texels`) holds it, `deepest` at the finest. */
export function finestWanted(fpKm: number, h0TexelKm: number, texels: number, deepest: number): number {
  for (let l = Math.max(deepest, DEEPEST_LEVEL); l <= COARSEST_LEVEL; l++) if (fpKm <= texels * h0TexelKm * 2 ** l) return l
  return COARSEST_LEVEL + 1
}

/** The deeper-level entry of a manifest and its presence test (plain string or run-length). */
export interface Presence { present?: string; presentRle?: Array<[number, number]> }
export interface DeeperEntry extends Presence {
  level: number; tileDeg: number; ppd: number; texelKm: number; stepM?: number
  /**
   * Ignored by this client: deeper levels are heights only, their colour is the level-0 map's (a baked-sun mosaic such as WAC cannot be
   * a colour source at a different scale without its Sun and albedo bands being applied twice). Deeper colour has to come from the pipeline
   * as a seamless, mosaic-wide low-pass `detail` ratio (TILE-CONTRACT.md 2) or a photometrically normalised reflectance product.
   */
  color?: Presence & { bakedSun?: boolean }
  /**
   * The WAC detail-ratio product (src/moon/tiles/detail.ts): u8 tiles `<path>/<level>/<tx>_<ty>.webp`, ratio 2^((byte-mid)/perOctave) on the level-0
   * albedo. Its presence is its own (global), not the heights'.
   */
  detail?: Presence & { path: string; format: 'webp-u8-ratio'; mid: number; perOctave: number }
}
// A run-length presence list was scanned linearly on every test, and the wanted-tile sampling tests it 4480 rays x up to seven levels x four
// neighbours a call (a large share of that call's 10 ms). Expanded once per list into a byte per tile.
const rleBits = new WeakMap<object, Uint8Array>()
function expandRle(runs: ReadonlyArray<readonly [number, number]>): Uint8Array {
  let end = 0
  for (const [start, len] of runs) end = Math.max(end, start + len)
  const bits = new Uint8Array(end)
  for (const [start, len] of runs) bits.fill(1, start, start + len)
  return bits
}
function inPresence(e: Presence, index: number): boolean {
  if (e.present !== undefined) return e.present[index] === '1'
  if (e.presentRle) {
    let bits = rleBits.get(e.presentRle)
    if (!bits) { bits = expandRle(e.presentRle); rleBits.set(e.presentRle, bits) }
    return index >= 0 && index < bits.length && bits[index] === 1
  }
  return false
}
export function presenceAt(e: Presence, index: number): boolean { return inPresence(e, index) }
export function deeperPresent(e: DeeperEntry, index: number): boolean { return presenceAt(e, index) }
/** Finest deeper level a manifest offers, 0 when none. */
export function deepestOf(deeper: readonly DeeperEntry[] | undefined): number {
  let d = 0
  for (const e of deeper ?? []) if (e.level < 0 && e.level >= DEEPEST_LEVEL && e.level < d) d = e.level
  return d
}

/** A point of a planned camera path: where on the ground it looks and how big a canvas pixel is there (km on the ground). */
export interface PathPoint { lon: number; lat: number; footprintKm: number }
/**
 * Tiles to warm for a planned flight: for each path point the finest level it wants down to the coarsest as fallback, ordered by
 * path position (the TilePrefetcher keeps this order). Levels the manifest lacks are skipped by the prefetcher itself.
 */
export function pathTargets(path: readonly PathPoint[], h0TexelKm: number, texels: number, deepest: number): Array<{ lon: number; lat: number; levels: number[] }> {
  return path.map((p) => {
    const finest = Math.min(finestWanted(p.footprintKm, h0TexelKm, texels, deepest), COARSEST_LEVEL)
    const levels: number[] = []
    for (let l = finest; l <= COARSEST_LEVEL; l++) levels.push(l)
    return { lon: p.lon, lat: p.lat, levels }
  })
}
