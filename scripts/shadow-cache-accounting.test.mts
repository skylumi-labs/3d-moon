// Fixed-policy shadow cache accounting and job ownership (stub renderer and tile streamer, no GL): the final fade step must leave an exact snapshot
// without a further frame, off-demand partial jobs give their cache layer back, a terrain change restarts a build rather than publishing a mix, and
// demand the class cap cannot hold is reported as unmet, never dropped from the count. See src/moon/tiles/ShadowCache.ts.
import assert from 'node:assert/strict'
import * as THREE from 'three'
const loc = { search: '' }
;(globalThis as { location?: unknown }).location = loc
const { ShadowCache } = await import('../src/moon/tiles/ShadowCache.ts')
const { levelDeg } = await import('../src/moon/tiles/grid.ts')

const RAD = Math.PI / 180
interface Slot { layer: number; level: number; tx: number; ty: number; gen: number; full: boolean; shade: boolean; keep: number }
function stubTiles(slots: Slot[]) {
  return {
    slots, pending: { changes: [] as Array<{ level: number; tx: number; ty: number }>, overflow: false }, trackChanges: false,
    cacheSlots() { return this.slots },
    takeChanges() { const c = this.pending; this.pending = { changes: [], overflow: false }; return c },
  }
}
function stubRenderer() {
  return {
    renders: 0, target: null as unknown, autoClear: true,
    getRenderTarget() { return null }, getActiveCubeFace() { return 0 }, getActiveMipmapLevel() { return 0 },
    setRenderTarget(t: unknown) { this.target = t },
    render() { this.renders++ },
  }
}
const passUniforms = () => ({ uPatchBlend: { value: 0 }, uPatchGround: { value: 0 }, uPSite: { value: new THREE.Vector3() } })
function centre(level: number, tx: number, ty: number): THREE.Vector3 {
  const d = levelDeg(level)
  const lon = ((tx + 0.5) * d - 180) * RAD, lat = (90 - (ty + 0.5) * d) * RAD
  return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat))
}
function sunAt(c: THREE.Vector3, elev: number): THREE.Vector3 {
  const up = new THREE.Vector3(0, 0, 1)
  const perp = new THREE.Vector3().crossVectors(up, c).normalize()
  return c.clone().multiplyScalar(Math.sin(elev * RAD)).addScaledVector(perp, Math.cos(elev * RAD)).normalize()
}
const eph = (sun: THREE.Vector3) => ({ sunDir: sun, moonX: new THREE.Vector3(1, 0, 0), moonY: new THREE.Vector3(0, 1, 0), moonZ: new THREE.Vector3(0, 0, 1) }) as never
const slot = (layer: number, tx = 36 + layer, ty = 18, extra: Partial<Slot> = {}): Slot => ({ layer, level: 0, tx, ty, gen: layer + 1, full: true, shade: true, keep: 0.5, ...extra })
const mk = (layers: number, search = '') => { loc.search = search; const r = stubRenderer(); return { r, cache: new ShadowCache(r as never, passUniforms() as never, layers, 180, 4096, 0) } }
const sun = sunAt(centre(0, 36, 18), 10)
const ONE_BLOCK = { fixedPolicy: true, fixedBudgetMs: 0.25 }
const BIG = { fixedPolicy: true, fixedBudgetMs: 100 }

/** The frame loop's contract: another frame only while update() asks for one. */
function drive(c: InstanceType<typeof ShadowCache>, t: ReturnType<typeof stubTiles>, now: number, o: object, max = 400): { now: number; frames: number } {
  let frames = 0
  for (let more = true; more && frames < max;) { now += 16; frames++; more = c.update(t as never, eph(sun), now, o) }
  return { now, frames }
}

// 1. Final-fade idle: a replacement (terrain change on an exact tile) crossfades; driven only while the cache asks for frames, the last snapshot is exact.
{
  const { cache } = mk(4)
  const tiles = stubTiles([slot(0), slot(1)])
  let { now } = drive(cache, tiles, 1000, BIG)
  assert.equal(cache.stats.visibleWanted, 2)
  assert.equal(cache.stats.visibleExact, 2, 'first builds are exact at once')
  tiles.pending.changes.push({ level: 0, tx: 38, ty: 18 }) // terrain next to tile 0 changed: it rebuilds into a spare and crossfades
  ;({ now } = drive(cache, tiles, now, BIG))
  const s = cache.stats
  assert.ok(s.buildsDirty >= 1, 'a tile was rebuilt and crossfaded')
  assert.equal(s.visibleWanted, 2)
  assert.equal(s.visibleExact, 2, 'the final idle snapshot counts the tiles whose last fade just finished')
  assert.equal(s.visibleNotExact, 0)
  assert.equal(cache.poolStats().old, 0, 'older builds released')
  assert.ok(s.settledMs >= 0, 'settled is recorded by update, keyed by revisions')
  // A read of the cache changes nothing: no clock, no latch.
  const before = JSON.stringify(cache.stats)
  cache.poolStats(); void cache.tileDiag
  assert.equal(JSON.stringify(cache.stats), before, 'reading is side-effect free')
  // A demand change starts a new settlement.
  const sig = s.demandSig
  tiles.slots.push(slot(2))
  cache.update(tiles as never, eph(sun), now + 16, BIG)
  assert.notEqual(cache.stats.demandSig, sig)
  assert.equal(cache.stats.settledMs, -1, 'new visible demand drops the latch')
}

// 2. Pan away and back: a partial job on a tile that stops being a candidate gives its layer back, and the tile rebuilds from the start.
{
  const { r, cache } = mk(4)
  const tiles = stubTiles([slot(0)])
  let now = 1000
  for (let i = 0; i < 3; i++) { now += 16; cache.update(tiles as never, eph(sun), now, ONE_BLOCK) }
  assert.equal(cache.poolStats().partial, 1)
  const freeBusy = cache.poolStats().free
  tiles.slots[0] = slot(0, 36, 18, { full: false }) // parked
  now += 16; cache.update(tiles as never, eph(sun), now, ONE_BLOCK)
  assert.equal(cache.poolStats().partial, 0, 'the partial job was reclaimed')
  assert.equal(cache.poolStats().free, freeBusy + 1)
  assert.equal(cache.stats.jobsReclaimed, 1)
  tiles.slots[0] = slot(0)
  const rendersBefore = r.renders
  const out = drive(cache, tiles, now, ONE_BLOCK)
  assert.equal(r.renders - rendersBefore, 9, 'rebuilt from block 0 (nine blocks)')
  assert.equal(cache.stats.visibleExact, 1)
  assert.ok(out.frames >= 9)
}

// 3. Capacity-blocked demand is unmet: nothing excludes it from the count (capacity 8, twelve demanded tiles).
{
  const { cache } = mk(12, '?shcap=8')
  assert.equal(cache.stats.cacheLayers, 8)
  const slots: Slot[] = []
  for (let i = 0; i < 12; i++) slots.push(slot(i, 34 + (i % 6), 17 + Math.floor(i / 6), { keep: 0.1 + i * 0.05 }))
  const tiles = stubTiles(slots)
  cache.diagnostics = true
  drive(cache, tiles, 1000, BIG)
  const s = cache.stats
  assert.equal(s.visibleWanted, 12, 'all twelve are demanded')
  assert.ok(s.visibleExact <= 8, 'no more than the cache holds')
  assert.equal(s.visibleNotExact, 12 - s.visibleExact)
  assert.ok(s.visibleNotExact >= 4)
  assert.ok(s.capacityBlockedVisible >= 4, 'capacity-blocked visible demand is reported')
  assert.ok(s.capacityFailures > 0)
  assert.equal(s.settledMs, -1, 'an incomplete set never settles')
  const pool = cache.poolStats()
  assert.equal(pool.capacity, 8)
  assert.equal(pool.free, 0)
  assert.equal(cache.tileDiag.length, s.visibleNotExact)
  assert.ok(cache.tileDiag.every((d) => d.reason.includes('capacity-blocked') && typeof d.rejected === 'string'))
}

// 4. A terrain change during a build restarts it: a build is never published as a mix of terrain states.
{
  const { r, cache } = mk(4)
  const tiles = stubTiles([slot(0)])
  let now = 1000
  for (let i = 0; i < 3; i++) { now += 16; cache.update(tiles as never, eph(sun), now, ONE_BLOCK) }
  assert.equal(r.renders, 3)
  const rev = cache.stats.terrainRev
  tiles.pending.changes.push({ level: 0, tx: 37, ty: 18 })
  const before = r.renders
  const out = drive(cache, tiles, now, ONE_BLOCK)
  assert.equal(cache.stats.jobRestarts, 1)
  assert.ok(cache.stats.terrainRev > rev)
  assert.equal(r.renders - before, 9, 'the job restarted: all nine blocks drawn again after the change')
  assert.equal(cache.stats.visibleExact, 1)
  assert.ok(out.frames >= 9)
}

// 5. Legacy policy still builds whole layers in one pass (no jobs).
{
  const { cache } = mk(4, '?shbudget=2')
  const tiles = stubTiles([slot(0), slot(1)])
  drive(cache, tiles, 1000, {})
  assert.equal(cache.poolStats().partial, 0)
  assert.equal(cache.stats.jobsReclaimed, 0)
}
console.log('shadow cache accounting passed')
