import { resolveDataBase } from '../dataBase'
import type { PatchLevel } from '../patch/PatchLayer'
import type { QualityClass } from '../../quality/startupClass'
/** SHA-256 of the decompressed MHT1 asset shipped by maps.ts; guarded by the bake test. */
export const BAKED_GLOBAL_HASH = 'd1ee76ea4d79958472ab14d37fcbbd8ab4379a23d665106e52ba8d2208c27c19'
export const BAKED_TILE_SIZE = 128
export const BAKED_NEAR_M = 128
export const BAKED_NEAR_SAMPLES = 32
// The live march that sharpens the edge: it runs to BAKED_LIVE_M (farther than the table's NEAR_M, the table covers everything beyond NEAR_M
// and max() keeps the larger horizon), with BAKED_LIVE_SAMPLES samples spaced d = LIVE * (j/N)^POW. ?bk_far= ?bk_n= ?bk_pow= override for A/B tests.
const tune = (k: string, d: number, lo: number, hi: number): number => {
  const v = Number(typeof location === 'undefined' ? NaN : new URLSearchParams(location.search).get(k))
  return Number.isFinite(v) && v >= lo && v <= hi ? v : d
}
export const BAKED_LIVE_M = tune('bk_far', BAKED_NEAR_M, 16, 4096)
export const BAKED_LIVE_SAMPLES = Math.round(tune('bk_n', BAKED_NEAR_SAMPLES, 4, 192))
export const BAKED_LIVE_POW = tune('bk_pow', 1, 1, 3)
export const BAKED_BIAS_M = 0.5
export const BAKED_MAX_SLOTS = 24
export const BAKED_SLOT_BYTES = BAKED_TILE_SIZE ** 2 * 64
export const BAKED_CAP_BYTES: Record<QualityClass, number> = { ios: 24 * 1048576, ipad: 24 * 1048576, 'phone-android': 24 * 1048576, tablet: 24 * 1048576, desktop: 24 * 1048576, software: 24 * 1048576 }
export interface HorizonSource { id: string; kind: 'global' | 'patch'; key?: string; stack?: string[]; hash?: string; directions: number; bounds: [number, number, number, number]; dx: number; dy: number }
export interface HorizonTile { id: string; source: string; file: string; rect: [number, number, number, number]; bytes: number; sha256: string }
export interface HorizonManifest { version: 1; tileSize: number; angleMax: number; nearM: number; biasM: number; radiusM: number; globalHash: string; site: { lat: number; lon: number } | null; sources: HorizonSource[]; tiles: HorizonTile[] }
/** Must match the baker; a resampled runtime level intentionally fails this match. */
export function gridKey(l: PatchLevel, datum: number): string {
  return JSON.stringify([l.name, l.heights, l.heightFormat ?? 'f16', l.w, l.h, l.eastM, l.northM, l.texelEastM, l.texelNorthM, l.h0M ?? datum, l.axisEastPerTexelM ?? null, l.axisSouthPerTexelM ?? null,
    ...(l.heightStepM === undefined ? [] : [l.heightStepM])])
}
export function validateHorizonManifest(m: HorizonManifest): void {
  const check = (v: unknown): void => { if (!v) throw new Error('Invalid baked horizon manifest') }
  check(m && m.version === 1 && m.tileSize === BAKED_TILE_SIZE && m.angleMax === 64 && m.nearM === BAKED_NEAR_M && m.biasM === BAKED_BIAS_M && m.radiusM === 1737400)
  check(/^[a-f0-9]{64}$/.test(m.globalHash))
  check(m.site === null || (Number.isFinite(m.site.lat) && Math.abs(m.site.lat) <= 90 && Number.isFinite(m.site.lon)))
  check(Array.isArray(m.sources) && m.sources.length <= 32 && Array.isArray(m.tiles) && m.tiles.length <= 100000)
  const sources = new Map<string, HorizonSource>()
  for (const s of m.sources) {
    check(s && typeof s.id === 'string' && !sources.has(s.id) && ['global', 'patch'].includes(s.kind) && Number.isInteger(s.directions) && s.directions >= 4 && s.directions <= 64 && s.directions % 4 === 0)
    check(Number.isFinite(s.dx) && s.dx > 0 && Number.isFinite(s.dy) && s.dy > 0 && s.bounds.length === 4 && s.bounds.every(Number.isFinite))
    check(s.kind === 'global' || (typeof s.key === 'string' && Array.isArray(s.stack) && s.stack.length > 0 && s.stack.every(k => typeof k === 'string') && /^[a-f0-9]{64}$/.test(s.hash ?? '')))
    sources.set(s.id, s)
  }
  const ids = new Set<string>()
  for (const t of m.tiles) {
    const s = sources.get(t.source)
    check(s && !ids.has(t.id) && typeof t.id === 'string' && /^[a-zA-Z0-9_.-]+\.rgba8\.gz$/.test(t.file))
    check(t.bytes === BAKED_TILE_SIZE ** 2 * s!.directions && /^[a-f0-9]{64}$/.test(t.sha256))
    check(t.rect.length === 4 && t.rect.every(Number.isFinite) && t.rect[2] > 0 && t.rect[3] > 0 && t.rect[2] <= 126 * s!.dx * 1.000001 && t.rect[3] <= 126 * s!.dy * 1.000001)
    ids.add(t.id)
  }
}
export function horizonSlots(cap: number, maxLayers: number): number { return Math.max(0, Math.min(BAKED_MAX_SLOTS, Math.floor(cap / BAKED_SLOT_BYTES), Math.floor(maxLayers / 16))) }
export function contains(t: HorizonTile, x: number, y: number): boolean { const r = t.rect; return x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3] }
export function horizonBase(search = typeof location === 'undefined' ? '' : location.search): string | null {
  return resolveDataBase('horizons', new URLSearchParams(search).get('horizons'), (import.meta.env?.VITE_MOON_HORIZONS as string | undefined) ?? '')
}

/** Preserve every photo/height sampler; if the spare unit is absent the view stays Fast. */
export function bakedSamplerFits(layout: readonly { h: boolean; r: boolean }[], maxUnits: number): boolean {
  return 7 + layout.reduce((n, l) => n + Number(l.h) + Number(l.r), 0) <= maxUnits
}
