// Fixed-policy shadows at the frame edges: (1) shade demand covers the tile the shader's horizonSun actually samples for every pixel ray, with
// legacy demand unchanged; (2) the cache's coverage counts frame-edge tiles; (3) a fresh build waits for terrain to stop arriving instead of
// being restarted by it. See wanted.ts WantContext.shaderShade and ShadowCache.ts FRESH_QUIET_MAX_MS.
import assert from 'node:assert/strict'
import * as THREE from 'three'
const loc = { search: '' }
;(globalThis as { location?: unknown }).location = loc
const { computeWanted, raySamples, shaderShadowLevel } = await import('../src/moon/tiles/wanted.ts')
const { MOON_R_KM, levelDeg, levelNx, levelNy, pageWidth } = await import('../src/moon/tiles/grid.ts')
const { COARSEST_LEVEL, levelRow } = await import('../src/moon/tiles/levels.ts')
const { ShadowCache } = await import('../src/moon/tiles/ShadowCache.ts')
type StreamView = import('../src/moon/tiles/wanted.ts').StreamView

// ---- 1. Demand covers the sampled level.
function view(dist: number, lon: number, lat: number, pitchDeg: number, w: number, h: number): StreamView {
  const d = Math.PI / 180
  const dir = new THREE.Vector3(Math.cos(lat * d) * Math.cos(lon * d), Math.cos(lat * d) * Math.sin(lon * d), Math.sin(lat * d))
  const nadir = dir.clone().negate()
  const right = new THREE.Vector3().crossVectors(nadir, new THREE.Vector3(0, 0, 1)).normalize()
  const up = new THREE.Vector3().crossVectors(right, nadir).normalize()
  const q = new THREE.Quaternion().setFromAxisAngle(right, pitchDeg * d)
  const fwd = nadir.clone().applyQuaternion(q)
  const tanH = Math.tan(20 * d)
  return { pos: dir.clone().multiplyScalar(dist), right, up: up.applyQuaternion(q), back: fwd.clone().negate(), tanHalf: tanH, aspect: w / h, tanPerPx: 2 * tanH / h, moonX: new THREE.Vector3(1, 0, 0), moonY: new THREE.Vector3(0, 1, 0), moonZ: new THREE.Vector3(0, 0, 1) }
}
const pw = pageWidth(-4)
const ctxOf = (deepest: number, shaderShade?: boolean) => ({ deepest, isPresent: () => true, keyOf: (l: number, tx: number, ty: number) => (levelRow(l) + ty) * pw + tx, ...(shaderShade === undefined ? {} : { shaderShade }) })
let missesOff = 0, missesOn = 0, rays = 0
for (const deepest of [0, -2]) {
  for (const [dist, pitch] of [[60, 0], [60, 60], [400, 30], [30, 75], [900, 0]]) {
    for (const [lon, lat] of [[-20, 9.7], [100, -45], [5, 80]]) {
      const v = view(1 + dist / MOON_R_KM, lon, lat, pitch, 443, 864)
      const off = computeWanted(v, ctxOf(deepest)), on = computeWanted(v, ctxOf(deepest, true)), dflt = computeWanted(v, ctxOf(deepest, false))
      // Legacy is untouched: the flag changes nothing but `shade`, and shade only ever grows.
      assert.equal(on.size, off.size)
      assert.equal(dflt.size, off.size)
      for (const [k, w] of off) {
        const x = on.get(k)!, y = dflt.get(k)!
        assert.deepEqual([x.level, x.tx, x.ty, x.priority, x.keep], [w.level, w.tx, w.ty, w.priority, w.keep])
        assert.deepEqual([y.shade, y.priority, y.keep], [w.shade, w.priority, w.keep], 'shaderShade:false equals the default')
        if (w.shade) assert.ok(x.shade, 'fixed demand is a superset of the legacy demand')
      }
      // For every pixel ray, the tile at the level the shader rounds to is demanded for shading.
      const rs = raySamples(v, undefined)
      const key = (l: number, lonW: number, lat2: number): number => {
        const d = levelDeg(l)
        const tx = Math.min(levelNx(l) - 1, Math.floor(lonW / d)), ty = Math.min(levelNy(l) - 1, Math.max(0, Math.floor((90 - lat2) / d)))
        return ctxOf(deepest).keyOf(l, tx, ty)
      }
      for (let i = 0; i < rs.n; i++) {
        const l = shaderShadowLevel(rs.shLod[i], deepest)
        assert.ok(l >= deepest && l <= COARSEST_LEVEL)
        const k = key(l, rs.lonW[i], rs.lat[i])
        rays++
        if (!off.get(k)?.shade) missesOff++
        if (!on.get(k)?.shade) missesOn++
      }
    }
  }
}
assert.ok(rays > 5000)
assert.ok(missesOff > 0, `the legacy rule misses sampled tiles at frame edges (${missesOff} of ${rays} rays)`)
assert.equal(missesOn, 0, 'every ray\'s sampled tile is demanded under shaderShade')

// ---- 2. Coverage counts frame-edge tiles (fixed); legacy keeps its centre-only count.
const RAD = Math.PI / 180
interface Slot { layer: number; level: number; tx: number; ty: number; gen: number; full: boolean; shade: boolean; keep: number }
function stubTiles(slots: Slot[]) {
  return { slots, pending: { changes: [] as Array<{ level: number; tx: number; ty: number }>, overflow: false }, trackChanges: false,
    cacheSlots() { return this.slots }, takeChanges() { const c = this.pending; this.pending = { changes: [], overflow: false }; return c } }
}
const stubRenderer = () => ({ renders: 0, getRenderTarget() { return null }, getActiveCubeFace() { return 0 }, getActiveMipmapLevel() { return 0 }, setRenderTarget() {}, render() { this.renders++ }, autoClear: true })
const passUniforms = () => ({ uPatchBlend: { value: 0 }, uPatchGround: { value: 0 }, uPSite: { value: new THREE.Vector3() } })
function centre(level: number, tx: number, ty: number): THREE.Vector3 {
  const d = levelDeg(level)
  const lon = ((tx + 0.5) * d - 180) * RAD, lat = (90 - (ty + 0.5) * d) * RAD
  return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat))
}
const up = new THREE.Vector3(0, 0, 1)
const c0 = centre(0, 36, 18)
const sun = c0.clone().multiplyScalar(Math.sin(10 * RAD)).addScaledVector(new THREE.Vector3().crossVectors(up, c0).normalize(), Math.cos(10 * RAD)).normalize()
const eph = { sunDir: sun, moonX: new THREE.Vector3(1, 0, 0), moonY: new THREE.Vector3(0, 1, 0), moonZ: new THREE.Vector3(0, 0, 1) } as never
const slot = (layer: number, keep: number): Slot => ({ layer, level: 0, tx: 36 + layer, ty: 18, gen: layer + 1, full: true, shade: true, keep })
const mk = (layers: number) => { const r = stubRenderer(); return { r, cache: new ShadowCache(r as never, passUniforms() as never, layers, 180, 4096, 0) } }
const BIG = { fixedPolicy: true, fixedBudgetMs: 100 }
function drive(c: InstanceType<typeof ShadowCache>, t: ReturnType<typeof stubTiles>, now: number, o: object, max = 400): number {
  for (let more = true, f = 0; more && f < max; f++) { now += 16; more = c.update(t as never, eph, now, o) }
  return now
}
{
  const corner = 1.4 // beyond the old 1.25 centre cut, inside the frame (a corner is ~1.41)
  const { cache } = mk(6)
  const tiles = stubTiles([slot(0, 0.2), slot(1, corner), slot(2, corner)])
  // Fixed: before any build the edge tiles count as demanded and NOT exact.
  cache.update(tiles as never, eph, 1000, { fixedPolicy: true, fixedBudgetMs: 0.25, motion: true })
  assert.equal(cache.stats.visibleWanted, 3, 'edge tiles are in the demand')
  assert.equal(cache.stats.visibleExact, 0)
  assert.equal(cache.stats.visibleNotExact, 3)
  assert.equal(cache.stats.visibleUnmetBand, 3, 'edge tiles are unmet until built')
  drive(cache, tiles, 1000, BIG)
  assert.equal(cache.stats.visibleWanted, 3)
  assert.equal(cache.stats.visibleExact, 3, 'edge tiles are cached exactly')
  assert.ok(cache.stats.settledMs >= 0)
  // Legacy: unchanged centre-only count.
  const leg = mk(6).cache
  const lt = stubTiles([slot(0, 0.2), slot(1, corner), slot(2, corner)])
  drive(leg, lt, 1000, {})
  assert.equal(leg.stats.visibleWanted, 1, 'legacy still counts only the centre tile')
}

// ---- 3. A fresh job does not start while terrain is arriving; it is not restarted by arrivals.
{
  const { r, cache } = mk(4)
  const tiles = stubTiles([slot(0, 0.2)])
  let now = 1000
  const ONE = { fixedPolicy: true, fixedBudgetMs: 0.25 }
  for (let i = 0; i < 6; i++) { // neighbours keep arriving for ~100 ms
    tiles.pending.changes.push({ level: 0, tx: 38, ty: 18 })
    now += 16; cache.update(tiles as never, eph, now, ONE)
  }
  assert.equal(r.renders, 0, 'no block drawn while the ground is still changing')
  drive(cache, tiles, now, ONE)
  assert.equal(cache.stats.jobRestarts, 0, 'no restart: the job started after the arrivals')
  assert.equal(r.renders, 9, 'nine blocks, drawn once')
  assert.equal(cache.stats.visibleExact, 1)
  // A change during a started job still restarts it (correctness).
  const { r: r2, cache: c2 } = mk(4)
  const t2 = stubTiles([slot(0, 0.2)])
  now = 1000
  for (let i = 0; i < 4; i++) { now += 16; c2.update(t2 as never, eph, now, ONE) }
  const started = r2.renders
  assert.ok(started > 0 && started < 9)
  t2.pending.changes.push({ level: 0, tx: 37, ty: 18 })
  drive(c2, t2, now, ONE)
  assert.equal(c2.stats.jobRestarts, 1, 'a change within reach of a started job restarts it')
  // Bounded wait: arrivals every frame cannot starve a build forever.
  const { r: r3, cache: c3 } = mk(4)
  const t3 = stubTiles([slot(0, 0.2)])
  now = 1000
  for (let i = 0; i < 120; i++) { t3.pending.changes.push({ level: 2, tx: 5, ty: 3 }); now += 16; c3.update(t3 as never, eph, now, ONE) }
  assert.ok(r3.renders > 0, 'after the bounded wait a build starts even with arrivals every frame')
}
console.log('fixed-shadow-edges: ok')
