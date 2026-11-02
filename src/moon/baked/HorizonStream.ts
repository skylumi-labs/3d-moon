import * as THREE from 'three'
import { fetchPatchAsset } from '../patch/assets'
import { LoadProgress } from '../../net/load'
import { ledger } from '../../quality/ledger'
import { trackGpu } from '../../quality/track'
import type { PatchLayer } from '../patch/PatchLayer'
import type { QualityClass } from '../../quality/startupClass'
import { BAKED_GLOBAL_HASH, BAKED_CAP_BYTES, BAKED_MAX_SLOTS, BAKED_SLOT_BYTES, BAKED_TILE_SIZE, contains, gridKey, horizonSlots, validateHorizonManifest, type HorizonManifest, type HorizonTile } from './format'

type Uniforms = Record<string, THREE.IUniform>
export function bakedUniforms(): Uniforms {
  return { uBaked: { value: null }, uBakedRect: { value: Array.from({ length: BAKED_MAX_SLOTS }, () => new THREE.Vector4()) }, uBakedInfo: { value: Array.from({ length: BAKED_MAX_SLOTS }, () => new THREE.Vector4(-2, 0, 0, 0)) } }
}
const NO_MATCH = { id: null as string | null, level: -1 }
/** One bounded RGBA8 array, one in-flight tile, no Sun-keyed work. Failed assets remain Fast. */
export class HorizonStream {
  private manifest: HorizonManifest | null = null
  private texture: THREE.DataArrayTexture | null = null
  private slots: Array<HorizonTile | null> = []
  private wanted: HorizonTile[] = []
  private failed = new Set<string>()
  private readySources = new Set<string>()
  private loading = false
  private active = false
  private disposed = false
  private controller = new AbortController()
  private sourceLevels = new Map<string, number>()
  private capacity: number
  private view: [number, number, string] | null = null
  private bySource = new Map<string, { tiles: HorizonTile[]; tol: number }>()
  private bySourceOf: HorizonManifest | null = null
  private globalOf: HorizonManifest | null = null
  private globalCached: HorizonManifest['sources'][number] | undefined
  private match: { p: PatchLayer; mask: number; levelCount: number; id: string | null; level: number } | null = null
  private levelsKnown = false
  private levelsMatchId: string | null = null
  private levelsMatchLevel = -1
  private rank: { id: string | undefined; capacity: number; manifestTiles: HorizonTile[]; x: number; y: number } | null = null
  constructor(private base: string, private uniforms: Uniforms, cls: QualityClass, maxLayers: number, private ceiling: number, private changed: () => void) {
    this.capacity = horizonSlots(BAKED_CAP_BYTES[cls], maxLayers)
    void this.loadManifest()
  }
  private async loadManifest(): Promise<void> {
    try {
      const res = await fetch(this.base + 'manifest.json', { signal: this.controller.signal })
      if (!res.ok) return
      const m = await res.json() as HorizonManifest
      validateHorizonManifest(m)
      if (m.globalHash !== BAKED_GLOBAL_HASH) return
      if (this.disposed) return
      this.manifest = m
      this.changed()
    } catch { /* Optional deployment: no manifest means Fast. */ }
  }
  /** The manifest's tiles grouped by source once (never filtered again per frame), with the smallest tile edge for the re-rank tolerance. */
  private tilesOf(m: HorizonManifest, id: string): { tiles: HorizonTile[]; tol: number } {
    if (this.bySourceOf !== m) {
      this.bySourceOf = m; this.bySource.clear()
      for (const t of m.tiles) {
        let e = this.bySource.get(t.source)
        if (!e) this.bySource.set(t.source, e = { tiles: [], tol: Infinity })
        e.tiles.push(t); e.tol = Math.min(e.tol, t.rect[2], t.rect[3])
      }
      for (const e of this.bySource.values()) e.tol /= 64
    }
    return this.bySource.get(id) ?? { tiles: [], tol: 0 }
  }
  /**
   * Which patch source (if any) matches the layer's resident height levels. The answer only changes with the layer or its set of levels
   * that hold heights, so it is remembered on both; the stack key strings are built when that changes, never per frame.
   */
  private matchFor(m: HorizonManifest, p: PatchLayer | null): { id: string | null; level: number } {
    const sameSite = p && m.site && Math.abs(m.site.lat - p.manifest.site.lat) < 1e-6 && Math.abs(m.site.lon - p.manifest.site.lon) < 1e-6
    if (!sameSite || !p) return NO_MATCH
    let mask = 0
    for (let i = 0; i < p.levels.length && i < 30; i++) if (p.levels[i].heights) mask |= 1 << i
    const c = this.match
    if (c && c.p === p && c.mask === mask && c.levelCount === p.levels.length) return c
    const i = p.levels.map((l, i) => l.heights ? i : -1).filter(i => i >= 0).pop() ?? -1
    const l = p.levels[i]
    const hit = l && m.sources.find(s => s.kind === 'patch' && s.key === gridKey(l, p.manifest.h0M) && JSON.stringify(s.stack) === JSON.stringify(p.levels.filter(l => l.heights).map(l => gridKey(l, p.manifest.h0M))))
    const integrity = l && (p.manifest.assets?.[l.heights!] ?? p.manifest.heightBand?.assets?.[l.heights!])
    const ok = hit && (!integrity || integrity.sha256 === hit.hash)
    this.match = { p, mask, levelCount: p.levels.length, id: ok ? hit.id : null, level: ok ? i : -1 }
    return this.match
  }
  /** Source identity and actual resident levels are checked before publishing any slot. At rest this allocates and sorts nothing. */
  update(p: PatchLayer | null, body: THREE.Vector3, active: boolean): void {
    this.active = active
    const m = this.manifest
    if (!m || this.disposed || !this.capacity) return
    const global = this.globalSource(m)
    const match = this.matchFor(m, p)
    let levelsChanged = false
    if (!this.levelsKnown || match.id !== this.levelsMatchId || match.level !== this.levelsMatchLevel) {
      levelsChanged = true; this.levelsKnown = true; this.levelsMatchId = match.id; this.levelsMatchLevel = match.level
      this.sourceLevels.clear()
      if (global) this.sourceLevels.set(global.id, -1)
      if (match.id) this.sourceLevels.set(match.id, match.level)
    }
    const useMatch = active && match.id !== null && p !== null
    const source = useMatch ? m.sources.find(s => s.id === match.id) : global
    let x: number, y: number
    if (useMatch && p) { x = body.dot(p.east) * 1737400; y = body.dot(p.north) * 1737400 }
    else { x = Math.atan2(body.y, body.x) / (2 * Math.PI) + .5; y = .5 - Math.asin(Math.max(-1, Math.min(1, body.z))) / Math.PI }
    if (source) { const v = this.view ?? (this.view = [0, 0, '']); v[0] = x; v[1] = y; v[2] = source.id } else this.view = null
    // The nearest-first order only matters once the point has moved a good fraction of a tile; a settled or slowly drifting view keeps it.
    const r = this.rank
    const set = source ? this.tilesOf(m, source.id) : null
    if (!r || r.id !== source?.id || r.capacity !== this.capacity || r.manifestTiles !== m.tiles || !set || Math.abs(x - r.x) > set.tol || Math.abs(y - r.y) > set.tol) {
      const global2 = source?.kind === 'global'
      const distance = (t: HorizonTile): number => {
        const rc = t.rect
        let dx = Math.abs(x - rc[0] - rc[2] / 2)
        if (global2) dx = Math.min(dx, 1 - dx)
        return (dx / rc[2]) ** 2 + ((y - rc[1] - rc[3] / 2) / rc[3]) ** 2
      }
      this.wanted = set ? set.tiles.slice().sort((a, b) => distance(a) - distance(b)).slice(0, this.capacity) : []
      this.rank = { id: source?.id, capacity: this.capacity, manifestTiles: m.tiles, x, y }
    }
    if (levelsChanged) this.publish()
    if (active && !this.loading) void this.pump()
  }
  private globalSource(m: HorizonManifest): HorizonManifest['sources'][number] | undefined {
    if (this.globalOf !== m) { this.globalOf = m; this.globalCached = m.sources.find(s => s.kind === 'global') }
    return this.globalCached
  }
  get available(): boolean {
    const v = this.view
    return !!v && this.readySources.has(v[2]) && (this.manifest && this.tilesOf(this.manifest, v[2]).tiles.some(t => contains(t, v[0], v[1]) && this.sourceLevels.has(t.source) && !this.failed.has(t.id)) || false)
  }
  get stats(): { resident: number; bytes: number; capacity: number; failed: number; available: boolean; pending: number } {
    const pending = this.active ? this.wanted.filter(t => !this.failed.has(t.id) && !this.slots.some(s => s?.id === t.id)).length : 0
    return { resident: this.slots.filter(Boolean).length, bytes: this.texture ? this.capacity * BAKED_SLOT_BYTES : 0, capacity: this.capacity, failed: this.failed.size, available: this.available, pending }
  }
  private publish(): void {
    const info = this.uniforms.uBakedInfo.value as THREE.Vector4[], rect = this.uniforms.uBakedRect.value as THREE.Vector4[]
    for (let i = 0; i < BAKED_MAX_SLOTS; i++) {
      const t = this.slots[i], s = t && this.manifest!.sources.find(s => s.id === t.source), level = t && this.sourceLevels.get(t.source)
      if (!s || level == null) { info[i].set(-2, 0, 0, 0); continue }
      rect[i].set(...t!.rect); info[i].set(level, s.directions, s.dx, s.dy)
    }
  }
  private async pump(): Promise<void> {
    if (this.loading || this.disposed || !this.active) return
    const tile = this.wanted.find(t => !this.failed.has(t.id) && !this.slots.some(s => s?.id === t.id))
    if (!tile) return
    this.loading = true
    let fetched = false
    try {
      // Reserve the complete array before decoding, constrained by both class and page ceilings.
      if (!this.texture) {
        this.capacity = Math.min(this.capacity, horizonSlots(Math.max(0, this.ceiling - ledger.total()), Infinity))
        if (!this.capacity) return
        const data = new Uint8Array(this.capacity * BAKED_SLOT_BYTES)
        const tex = new THREE.DataArrayTexture(data, BAKED_TILE_SIZE, BAKED_TILE_SIZE, this.capacity * 16)
        tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType; tex.internalFormat = 'RGBA8'
        tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.unpackAlignment = 1; tex.needsUpdate = true
        trackGpu('baked', 'horizon-array', data.byteLength, tex)
        this.texture = tex; this.uniforms.uBaked.value = tex
        this.slots = Array.from({ length: this.capacity }, () => null)
      }
      fetched = true
      const bytes = await fetchPatchAsset(this.base + tile.file, tile.bytes, new LoadProgress(), { init: { signal: this.controller.signal }, delaysMs: [] }, { bytes: tile.bytes, sha256: tile.sha256 })
      if (this.disposed || !this.wanted.some(t => t.id === tile.id)) return
      const slot = this.slots.findIndex(t => !t || !this.wanted.some(w => w.id === t.id))
      if (slot < 0) return
      this.slots[slot] = tile
      this.readySources.add(tile.source)
      const data = this.texture.image.data as Uint8Array
      data.set(bytes, slot * BAKED_SLOT_BYTES)
      for (let layer = 0; layer < 16; layer++) this.texture.addLayerUpdate(slot * 16 + layer)
      this.texture.needsUpdate = true
      this.publish(); this.changed()
    } catch { if (!this.disposed) { this.failed.add(tile.id); this.changed() } }
    finally { this.loading = false }
    // Re-pump after every fetch, including one whose tile left `wanted` mid-download, so an idle view still requests its new tile.
    if (fetched && !this.disposed && this.active) void this.pump()
  }
  dispose(): void {
    this.disposed = true; this.controller.abort(); this.texture?.dispose(); this.texture = null
    this.slots = []; this.uniforms.uBaked.value = null
    for (const v of this.uniforms.uBakedInfo.value as THREE.Vector4[]) v.set(-2, 0, 0, 0)
  }
}
