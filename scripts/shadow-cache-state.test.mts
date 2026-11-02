// ShadowCache.update's invariants, against a stub renderer and a stub tile streamer (no GL): the cache must never draw a stale horizon while the
// Sun is moved interactively, must crossfade old cache -> new cache (never through the live march) when only the clock drifts, resets a layer
// whose tile changed or left, respects the tile level when a neighbour changes, builds nothing in motion frames, and turns itself off on an
// incomplete framebuffer. Also the background compile (shprecompile): builds wait for it with a bounded fallback, a rejected compile or an
// incomplete framebuffer at construction fails the cache and the frame loop detaches it. See src/moon/tiles/ShadowCache.ts.
import assert from 'node:assert/strict'
import * as THREE from 'three'
;(globalThis as { location?: unknown }).location = { search: '?shbudget=2' }
const { ShadowCache, SUN_TOL_RAD, DRIFT_TOL_RAD, STALE_MAX_MS, SETTLE_MS, FADE_MS, SPARE_LAYERS, COMPILE_WAIT_MS, shPrecompileOn, shWarmOn } = await import('../src/moon/tiles/ShadowCache.ts')
const { levelDeg, MOON_R_KM } = await import('../src/moon/tiles/grid.ts')
const { reachDeg } = await import('../src/moon/tiles/ShadowCache.ts')
const { marchReachKm, marchLevel, MARCH_MAX_KM, shReachOn } = await import('../src/moon/march.ts')
const { H_TEXEL_KM } = await import('../src/moon/tiles/grid.ts')

const RAD = Math.PI / 180
interface Slot { layer: number; level: number; tx: number; ty: number; gen: number; full: boolean; shade: boolean; keep: number }
function stubTiles(slots: Slot[]) {
  return {
    slots, pending: { changes: [] as Array<{ level: number; tx: number; ty: number }>, overflow: false }, trackChanges: false,
    cacheSlots() { return this.slots },
    takeChanges() { const c = this.pending; this.pending = { changes: [], overflow: false }; return c },
  }
}
function stubRenderer(opts: { complete?: boolean } = {}) {
  const r = {
    renders: 0, rects: [] as Array<[number, number, number, number]>, target: null as unknown, autoClear: true,
    getRenderTarget() { return null }, getActiveCubeFace() { return 0 }, getActiveMipmapLevel() { return 0 },
    setRenderTarget(t: unknown) { this.target = t }, render() {
      this.renders++
      const scissor = (this.target as { scissor?: { x: number; y: number; z: number; w: number } } | null)?.scissor
      if (scissor) this.rects.push([scissor.x, scissor.y, scissor.z, scissor.w])
    },
    getContext: opts.complete === undefined ? undefined : () => ({
      getExtension: () => null, checkFramebufferStatus: () => (opts.complete ? 36053 : 36054), DRAW_FRAMEBUFFER: 36009, FRAMEBUFFER_COMPLETE: 36053,
    }),
  }
  return r
}
const passUniforms = () => ({ uPatchBlend: { value: 0 }, uPatchGround: { value: 0 }, uPSite: { value: new THREE.Vector3() } })
function centre(level: number, tx: number, ty: number): THREE.Vector3 {
  const d = levelDeg(level)
  const lon = ((tx + 0.5) * d - 180) * RAD, lat = (90 - (ty + 0.5) * d) * RAD
  return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat))
}
/** A Sun `elev` degrees above the tile centre's horizon, `rot` degrees round the pole from there (the azimuth shift the cache is keyed on). */
function sunAt(c: THREE.Vector3, elev: number, rot = 0): THREE.Vector3 {
  const up = new THREE.Vector3(0, 0, 1)
  const perp = new THREE.Vector3().crossVectors(up, c).normalize()
  const s = c.clone().multiplyScalar(Math.sin(elev * RAD)).addScaledVector(perp, Math.cos(elev * RAD))
  return s.applyAxisAngle(up, rot * RAD).normalize()
}
const eph = (sun: THREE.Vector3) => ({ sunDir: sun, moonX: new THREE.Vector3(1, 0, 0), moonY: new THREE.Vector3(0, 1, 0), moonZ: new THREE.Vector3(0, 0, 1) }) as never
const mk = (layers: number, r = stubRenderer(), u = passUniforms()) => ({ r, u, cache: new ShadowCache(r as never, u as never, layers, 180, 4096, 0) })
const fadeOf = (c: InstanceType<typeof ShadowCache>, layer: number) => Array.from((c.fade.image.data as Float32Array).slice(4 * layer, 4 * layer + 4))
const slot = (layer: number, tx = 36 + layer, ty = 18, level = 0, extra: Partial<Slot> = {}): Slot => ({ layer, level, tx, ty, gen: layer + 1, full: true, shade: true, keep: 0.5, ...extra })
/** Runs frames at 16 ms until `n` ms have passed since `t0`; returns the last time. */
function run(c: InstanceType<typeof ShadowCache>, t: ReturnType<typeof stubTiles>, sun: THREE.Vector3, t0: number, ms: number, o = {}): number {
  let now = t0
  while (now < t0 + ms) { now += 16; c.update(t as never, eph(sun), now, o) }
  return now
}

// 1. Settle, budget, fade-in from the live march.
{
  const { r, cache } = mk(8)
  const tiles = stubTiles([slot(0), slot(1), slot(2)])
  const sun = sunAt(centre(0, 36, 18), 10)
  cache.update(tiles as never, eph(sun), 1000) // the Sun has never moved: still, so it builds at once
  assert.ok(tiles.trackChanges, 'attaches to the change feed')
  assert.equal(r.renders, 2, 'budget 2 per frame')
  assert.equal(fadeOf(cache, 0)[1], 1, 'a first build over the live march shows at once (no live+cache fade)')
  const now = run(cache, tiles, sun, 1000, 80)
  assert.equal(cache.stats.built, 3, 'all three built')
  assert.equal(fadeOf(cache, 0)[0] >= 0, true)
  run(cache, tiles, sun, now, FADE_MS + 100)
  const f = fadeOf(cache, 0)
  assert.equal(f[1], 1, 'faded in')
  assert.equal(f[3], 0)
  assert.ok(cache.stats.timeToCachedMs >= 0 || cache.stats.cachedEvents >= 0)
}

// Fixed policy submits bounded blocks and never publishes a partially valid cache layer.
{
  const r = stubRenderer()
  const cache = new ShadowCache(r as never, passUniforms() as never, 4, 180, 4096, 0)
  const tiles = stubTiles([slot(0)])
  const sun = sunAt(centre(0, 36, 18), 10)
  cache.update(tiles as never, eph(sun), 1000, { fixedPolicy: true, fixedBudgetMs: 0.25 })
  assert.equal(r.renders, 1, 'one fixed-policy block fits the allowance')
  assert.equal(cache.stats.built, 0, 'a partial layer is not counted as built')
  assert.deepEqual(fadeOf(cache, 0), [-1, 0, -1, 0], 'a partial layer is not published to the shader')
  for (let i = 1; i < 9; i++) cache.update(tiles as never, eph(sun), 1000 + i * 16, { fixedPolicy: true, fixedBudgetMs: 0.25 })
  assert.equal(r.renders, 9, 'all nine scissored blocks complete')
  assert.deepEqual(r.rects.slice(0, 2), [[0, 0, 128, 128], [128, 0, 128, 128]], 'the block grid starts at the tile edge')
  assert.ok(r.rects.some(([x, y, w, h]) => x + w === 322 || y + h === 322), 'edge blocks include the one-texel gutters')
  assert.equal(cache.stats.built, 1)
  assert.ok(fadeOf(cache, 0)[0] >= 0, 'the whole layer publishes atomically')
}

// Round-robin block scheduling gives each visible tile progress even while camera priority changes every frame.
{
  const r = stubRenderer()
  const cache = new ShadowCache(r as never, passUniforms() as never, 8, 180, 4096, 0)
  const tiles = stubTiles([slot(0, 36), slot(1, 37), slot(2, 38)])
  const sun = sunAt(centre(0, 37, 18), 10)
  for (let i = 0; i < 40; i++) {
    tiles.slots.forEach((s, j) => { s.keep = ((i + j) % 3) / 10 })
    cache.update(tiles as never, eph(sun), 1000 + i * 16, { fixedPolicy: true, fixedBudgetMs: 0.25 })
  }
  assert.equal(cache.stats.built, 3, 'all visible layers complete despite moving priority')
}

// A Sun epoch change cancels unfinished fixed-policy blocks before they can publish.
{
  const r = stubRenderer()
  const cache = new ShadowCache(r as never, passUniforms() as never, 4, 180, 4096, 0)
  const tiles = stubTiles([slot(0)])
  const sun = sunAt(centre(0, 36, 18), 10)
  cache.update(tiles as never, eph(sun), 1000, { fixedPolicy: true, fixedBudgetMs: 0.25 })
  cache.update(tiles as never, eph(sunAt(centre(0, 36, 18), 10, 1)), 1016, { fixedPolicy: true, fixedBudgetMs: 0.25 })
  assert.equal(r.renders, 1, 'the changed Sun cancels the old epoch without drawing its remaining blocks')
  assert.equal(cache.stats.built, 0)
  assert.deepEqual(fadeOf(cache, 0), [-1, 0, -1, 0])
}

// 2. Interactive Sun motion: stale within the tolerance only; beyond it the layer is dropped in the SAME call (fade 0 before any draw).
{
  const { cache } = mk(8)
  const tiles = stubTiles([slot(0)])
  const c = centre(0, 36, 18)
  const s0 = sunAt(c, 10)
  let now = run(cache, tiles, s0, 0, 600)
  assert.equal(fadeOf(cache, 0)[1], 1)
  const inTol = sunAt(c, 10, 0.5 * SUN_TOL_RAD / RAD / Math.cos(10 * RAD) * 0.2)
  assert.ok(inTol.angleTo(s0) <= SUN_TOL_RAD)
  cache.update(tiles as never, eph(inTol), now += 16)
  assert.equal(fadeOf(cache, 0)[1], 1, 'within SUN_TOL the layer is current')
  const moved = sunAt(c, 10, 0.02)
  assert.ok(moved.angleTo(s0) > SUN_TOL_RAD)
  cache.update(tiles as never, eph(moved), now + 16)
  assert.deepEqual(fadeOf(cache, 0), [-1, 0, -1, 0], 'dropped before the draw, no builds in the same frame (the Sun just moved)')
  // Even a small step (below the "moving" heuristic of old) invalidates once the tolerance is crossed, and an interactive step never keeps a stale layer.
  const t2 = stubTiles([slot(0)])
  const { cache: c2 } = mk(8)
  const n2 = run(c2, t2, s0, 0, 600)
  const small = sunAt(c, 10, 0.015)
  c2.update(t2 as never, eph(small), n2 + 16, { drift: false })
  assert.equal(fadeOf(c2, 0)[1], 0, 'not drift: not shown stale')
}

// 3. A tile layer reused for another tile (gen), or evicted, is reset at once.
{
  const { cache } = mk(8)
  const tiles = stubTiles([slot(0), slot(1)])
  const sun = sunAt(centre(0, 36, 18), 10)
  let now = run(cache, tiles, sun, 0, 600)
  assert.equal(fadeOf(cache, 0)[1], 1)
  tiles.slots[0] = { ...tiles.slots[0], gen: 99, full: false }
  cache.update(tiles as never, eph(sun), now += 16)
  assert.deepEqual(fadeOf(cache, 0), [-1, 0, -1, 0], 'gen change resets')
  tiles.slots.pop()
  cache.update(tiles as never, eph(sun), now + 16)
  assert.deepEqual(fadeOf(cache, 1), [-1, 0, -1, 0], 'evicted tile resets')
}

// 4. Clock drift: the layer built stays drawn, the replacement is built into a spare, and the swap is a crossfade whose shares sum to 1
//    (cache -> new cache, never through the live march). Beyond DRIFT_TOL, or after STALE_MAX_MS, the layer is dropped.
{
  const { cache } = mk(8)
  const tiles = stubTiles([slot(0)])
  const c = centre(0, 36, 18)
  const s0 = sunAt(c, 10)
  let now = run(cache, tiles, s0, 0, 600)
  const idx0 = fadeOf(cache, 0)[0]
  const tick = sunAt(c, 10, 0.012)
  assert.ok(tick.angleTo(s0) > SUN_TOL_RAD && tick.angleTo(s0) < DRIFT_TOL_RAD)
  const shares: number[] = []
  for (let i = 0; i < 60; i++) {
    cache.update(tiles as never, eph(tick), now += 16, { drift: true })
    const f = fadeOf(cache, 0)
    shares.push(f[1] + f[3])
  }
  assert.ok(shares.every((x) => x >= 0.999), `the shown share never dips (cache -> live): min ${Math.min(...shares)}`)
  const f = fadeOf(cache, 0)
  assert.equal(f[1], 1)
  assert.notEqual(f[0], idx0, 'the new build lives in another cache layer')
  assert.equal(f[2], -1, 'old layer returned')
  assert.ok(cache.stats.staleServedFrames > 0, 'the old layer was shown stale while the replacement was built')
  assert.ok(cache.stats.buildsSun === 1)
  // Past the drift tolerance: dropped immediately.
  const far = sunAt(c, 10, 0.012 + 0.2)
  cache.update(tiles as never, eph(far), now + 16, { drift: true })
  assert.equal(fadeOf(cache, 0)[1], 0, 'beyond DRIFT_TOL it is not shown')
  assert.ok(DRIFT_TOL_RAD / RAD <= 0.05 + 1e-9)
}
{
  // Stale for longer than one rebuild cycle (builds starved by motion): dropped.
  const { cache } = mk(8)
  const tiles = stubTiles([slot(0)])
  const c = centre(0, 36, 18)
  let now = run(cache, tiles, sunAt(c, 10), 0, 600)
  const tick = sunAt(c, 10, 0.012)
  const t0 = now
  while (now < t0 + STALE_MAX_MS + 200) cache.update(tiles as never, eph(tick), now += 16, { drift: true, motion: true })
  assert.equal(fadeOf(cache, 0)[1], 0, 'stale past STALE_MAX_MS is dropped')
}

// 5. No builds in motion frames or before the Sun has settled.
{
  const { r, cache } = mk(8)
  const tiles = stubTiles([slot(0)])
  const c = centre(0, 36, 18)
  cache.update(tiles as never, eph(sunAt(c, 10)), 1000, { motion: true })
  let now = 1000
  for (let i = 0; i < 20; i++) cache.update(tiles as never, eph(sunAt(c, 10, 0.3 * (i + 1))), now += 16, { motion: true })
  assert.equal(r.renders, 0, 'no builds in motion frames or while the Sun moves')
  const s = sunAt(c, 10, 9)
  cache.update(tiles as never, eph(s), now += 16)
  cache.update(tiles as never, eph(s), now += SETTLE_MS - 20)
  assert.equal(r.renders, 0, 'not before SETTLE_MS')
  cache.update(tiles as never, eph(s), now += 40, { motion: true })
  assert.equal(r.renders, 0, 'not in a motion frame')
  cache.update(tiles as never, eph(s), now + 16)
  assert.equal(r.renders, 1, 'built once still and at rest')
}

// 6. Neighbour changes respect the level: a change at a FINER level cannot touch a coarser layer; same or coarser level dirties it.
{
  const { cache } = mk(8)
  const tiles = stubTiles([slot(0, 36, 18, 1, { tx: 18, ty: 9 })])
  const c = centre(1, 18, 9)
  let now = run(cache, tiles, sunAt(c, 10), 0, 700)
  const base = cache.stats.buildsTotal
  tiles.pending.changes.push({ level: -3, tx: 296, ty: 152 })
  now = run(cache, tiles, sunAt(c, 10), now, 600)
  assert.equal(cache.stats.buildsDirty, 0, 'a finer tile arriving does not rebuild a level-1 layer')
  tiles.pending.changes.push({ level: 1, tx: 19, ty: 9 })
  const shares: number[] = []
  const t0 = now
  while (now < t0 + 900) { cache.update(tiles as never, eph(sunAt(c, 10)), now += 16); const f = fadeOf(cache, 0); shares.push(f[1] + f[3]) }
  assert.equal(cache.stats.buildsDirty, 1, 'a same-level neighbour rebuilds it, once')
  assert.ok(shares.every((x) => x >= 0.999), 'the rebuild swaps by crossfade, no dip')
  assert.equal(cache.stats.buildsTotal, base + 1)
  // Overflow of the change feed dirties everything.
  tiles.pending.overflow = true
  run(cache, tiles, sunAt(c, 10), now, 900)
  assert.equal(cache.stats.buildsDirty, 2)
}

// 7. Tiles wholly under an active fused-ground patch are never built; the same tile with no patch is.
{
  const lvl = -3
  const tx = 150, ty = 70
  const c = centre(lvl, tx, ty)
  const sun = sunAt(c, 10)
  const a = mk(8)
  a.u.uPatchBlend.value = 1; a.u.uPatchGround.value = 1; a.u.uPSite.value.copy(c)
  const t1 = stubTiles([slot(0, tx, ty, lvl)])
  run(a.cache, t1, sun, 0, 600)
  assert.equal(a.cache.stats.buildsTotal, 0, 'under a patch: nothing built')
  const b = mk(8)
  run(b.cache, stubTiles([slot(0, tx, ty, lvl)]), sun, 0, 600)
  assert.equal(b.cache.stats.buildsTotal, 1)
}

// 8. An unrenderable framebuffer turns the cache off for good (the shader then marches live).
{
  const { r, cache } = mk(8, stubRenderer({ complete: false }))
  const tiles = stubTiles([slot(0)])
  run(cache, tiles, sunAt(centre(0, 36, 18), 10), 0, 600)
  assert.equal(cache.failed, true)
  assert.equal(r.renders, 0)
  assert.equal(cache.update(tiles as never, eph(sunAt(centre(0, 36, 18), 10)), 99999), false)
  const ok = mk(8, stubRenderer({ complete: true }))
  run(ok.cache, stubTiles([slot(0)]), sunAt(centre(0, 36, 18), 10), 0, 600)
  assert.equal(ok.cache.failed, false)
  assert.ok(ok.r.renders >= 1)
}

// 9. A build never starts in a frame already over budget (a stalled previous frame, or a CPU part that ran long); it is deferred, not lost.
//    The shader reads the cache only while a layer is shown (shaderOn).
{
  const { r, cache } = mk(8)
  const tiles = stubTiles([slot(0)])
  const sun = sunAt(centre(0, 36, 18), 10)
  cache.update(tiles as never, eph(sun), 1000) // builds at once (Sun never moved)
  const rendersAfterFirst = r.renders
  assert.ok(rendersAfterFirst >= 1)
  cache.update(tiles as never, eph(sun), 1016)
  assert.equal(cache.shaderOn, true, 'a layer is shown (fading in): the shader takes the cache path')
  const { r: r2, cache: c2 } = mk(8)
  const t2 = stubTiles([slot(0)])
  c2.update(t2 as never, eph(sun), 1000, { frameStart: 900 }) // 100 ms of this frame already spent
  assert.equal(r2.renders, 0, 'over budget by CPU: no build')
  assert.equal(c2.shaderOn, false, 'nothing shown: plain live march')
  assert.ok(c2.stats.deferredOver >= 1)
  c2.update(t2 as never, eph(sun), 1016, { frameStart: 1016 })
  assert.ok(r2.renders >= 1, 'next frame builds')
  const { r: r3, cache: c3 } = mk(8)
  const t3 = stubTiles([slot(0)])
  c3.update(t3 as never, eph(sunAt(centre(0, 36, 18), 80)), 100) // outside the band: nothing to build, frameMs settles at ~16
  let n3 = 100
  n3 = run(c3, t3, sun, n3, 400) // builds, settles
  const before = r3.renders
  const moved = sunAt(centre(0, 36, 18), 10, 0.5)
  n3 = run(c3, t3, moved, n3, SETTLE_MS - 16) // Sun moving frames... then it stops
  c3.update(t3 as never, eph(moved), n3 + 400) // a 400 ms stall frame, long since still: over budget
  assert.equal(r3.renders, before, 'a stalled previous frame defers the build')
  c3.update(t3 as never, eph(moved), n3 + 416)
  assert.ok(r3.renders > before, 'and the next frame builds')
}

// 10. Class memory cap: the array never exceeds the class cap, and layers past it are not built.
{
  const { cache } = mk(100000)
  assert.ok(cache.stats.gpuBytes < 70 * 1024 * 1024, 'desktop cap')
  assert.ok(cache.stats.cacheLayers < 100000)
}

// 10b. The array is sized from the streamer's want (heightWant + spare), not its layer count: a 256-layer heights array with a 142 want gets
//      158 cache layers (desktop spare 16), while state and the fade table stay indexed by tile layer (256).
{
  const r = stubRenderer()
  const cache = new ShadowCache(r as never, passUniforms() as never, 256, 180, 4096, 0, 142)
  assert.equal(cache.stats.layers, 256, 'state is per tile layer')
  assert.equal(cache.stats.cacheLayers, 142 + 16, 'array = want + SPARE_LAYERS')
  const old = new ShadowCache(stubRenderer() as never, passUniforms() as never, 256, 180, 4096, 0)
  assert.equal(old.stats.cacheLayers, 256 + 16, 'no cacheWant: the old sizing')
  assert.ok(cache.stats.gpuBytes < old.stats.gpuBytes - 20 * 1024 * 1024, 'about 22 MiB smaller')
}

// 10c. Parked builds (TileStreamer.park: listed not full, not shaded) keep their cache layers but must not starve rebuilds: with every layer held, a Sun-drift (kind 1)
//      and a changed-neighbour (kind 2) rebuild take a parked layer (never a full one), nothing is skipped, and parked builds are not counted as serving.
{
  const loc = (globalThis as { location?: { search: string } }).location!
  const setup = () => {
    loc.search = '?shbudget=8&shcap=8'
    const { r, cache } = mk(8)
    loc.search = '?shbudget=2'
    const tiles = stubTiles(Array.from({ length: 8 }, (_, i) => slot(i, 36 + i, 18, 0)))
    const c = centre(0, 36, 18)
    const now = run(cache, tiles, sunAt(c, 10), 0, 1500)
    assert.equal(cache.stats.built, 8, 'every layer holds a build'); assert.equal(cache.stats.cacheLayers, 8)
    for (let i = 4; i < 8; i++) { tiles.slots[i].full = false; tiles.slots[i].shade = false; tiles.slots[i].keep = 9 } // parked
    return { r, cache, tiles, c, now }
  }
  {
    const { cache, tiles, c, now: n0 } = setup()
    cache.update(tiles as never, eph(sunAt(c, 10)), n0 + 16)
    assert.equal(cache.stats.serving, 4, 'parked builds are not counted as serving')
    let now = n0 + 16
    const tick = sunAt(c, 10, 0.012)
    for (let i = 0; i < 120; i++) cache.update(tiles as never, eph(tick), now += 16, { drift: true })
    assert.ok(cache.stats.buildsSun >= 4, `kind-1 rebuilds ran with every spare held by parked builds (${cache.stats.buildsSun})`)
    assert.equal(cache.stats.cappedOut, 0, 'nothing skipped')
    assert.ok(cache.stats.evictedForCap >= 1, 'a parked layer was given up')
    for (let i = 0; i < 4; i++) assert.equal(fadeOf(cache, i)[1], 1, `full layer ${i} still shown`)
  }
  {
    const { cache, tiles, c, now: n0 } = setup()
    const now = n0
    const before = cache.stats.buildsDirty
    tiles.pending.changes.push({ level: 0, tx: 39, ty: 18 }) // a same-level change beside the full layers
    run(cache, tiles, sunAt(c, 10), now, 1500)
    assert.ok(cache.stats.buildsDirty - before >= 1, `kind-2 rebuilds ran by taking parked layers (${cache.stats.buildsDirty - before})`)
    assert.equal(cache.stats.cappedOut, 0, 'nothing skipped')
    assert.ok(cache.stats.evictedForCap >= 1)
  }
  {
    // an unparked slot's own fade completion (a change at its own tile) does not dirty its own kept build
    const { cache } = mk(8)
    const tiles = stubTiles([slot(0, 36, 18, 1, { tx: 18, ty: 9 })])
    const c = centre(1, 18, 9)
    let now = run(cache, tiles, sunAt(c, 10), 0, 700)
    tiles.pending.changes.push({ level: 1, tx: 18, ty: 9 })
    now = run(cache, tiles, sunAt(c, 10), now, 1200)
    assert.equal(cache.stats.buildsDirty, 0, 'own arrival does not rebuild the tile')
    tiles.pending.changes.push({ level: 1, tx: 19, ty: 9 })
    run(cache, tiles, sunAt(c, 10), now, 1200)
    assert.equal(cache.stats.buildsDirty, 1, 'a neighbour still does')
  }
}

// 10d. Parking reports its tile as a change: under a FIXED Sun a visible neighbour's build is rebuilt after the quiet period (crossfaded, not at once),
//      because its horizon was computed with the now-absent fine tile.
{
  const { cache } = mk(8)
  const tiles = stubTiles([slot(0, 36, 18, 0), slot(1, 37, 18, 0)])
  const c = centre(0, 36, 18)
  let now = run(cache, tiles, sunAt(c, 10), 0, 1500)
  assert.equal(cache.stats.built, 2)
  tiles.slots[1].full = false; tiles.slots[1].shade = false // slot 1 parks and stays absent
  tiles.pending.changes.push({ level: 0, tx: 37, ty: 18 })
  now = run(cache, tiles, sunAt(c, 10), now, 100)
  assert.equal(cache.stats.buildsDirty, 0, 'not rebuilt at once')
  run(cache, tiles, sunAt(c, 10), now, 1500)
  assert.equal(cache.stats.buildsDirty, 1, 'the neighbour is rebuilt once after the quiet period')
}

// 10e. Successive change batches extend the quiet period: a neighbour's rebuild waits until QUIET_MS (150) after the LAST change, however many arrive.
{
  const { cache } = mk(8)
  const tiles = stubTiles([slot(0, 36, 18, 0), slot(1, 37, 18, 0)])
  const c = centre(0, 36, 18)
  let now = run(cache, tiles, sunAt(c, 10), 0, 1500)
  for (let k = 0; k < 10; k++) {
    tiles.pending.changes.push({ level: 0, tx: 37, ty: 18 })
    for (let f = 0; f < 6; f++) cache.update(tiles as never, eph(sunAt(c, 10)), now += 16) // ~96 ms between batches, under the 150 ms quiet period
    assert.equal(cache.stats.buildsDirty, 0, `batch ${k}: still inside the quiet period`)
  }
  run(cache, tiles, sunAt(c, 10), now, 400)
  assert.equal(cache.stats.buildsDirty, 1, 'rebuilt once after the last batch')
}

// 10f. The rest catch-up's visibleUnmet ignores parked slots (not full, not shaded): only the full, shaded, unbuilt tile is unmet.
{
  const { cache } = mk(8)
  const tiles = stubTiles([slot(0, 36, 18, 0, { keep: 0.1 }), slot(1, 37, 18, 0, { keep: 0.1, full: false, shade: false })])
  const c = centre(0, 36, 18)
  cache.update(tiles as never, eph(sunAt(c, 10)), 1000, { motion: true }) // motion frame: nothing built yet
  assert.equal(cache.visibleUnmet(), 1, 'the parked slot is not counted')
}

// 11a. The phone class holds about 22 MB of layers (111), not every height tile.
{
  ;(globalThis as { location?: { search: string } }).location!.search = '?class=phone-android'
  const { cache } = mk(142)
  ;(globalThis as { location?: { search: string } }).location!.search = '?shbudget=2'
  assert.ok(cache.stats.cacheLayers >= 100 && cache.stats.cacheLayers <= 111 && cache.stats.gpuBytes < 23 * 1024 * 1024, 'phone class cap')
}
// 11. Under the phone class cap (60 cache layers) the on-screen tiles are cached first; a more on-screen tile takes the layer of a less on-screen one,
//     and tiles with no layer left do not keep the cache asking for frames (pending 0).
{
  ;(globalThis as { location?: { search: string } }).location!.search = '?shbudget=8&class=phone-android&shcap=60'
  const { r, cache } = mk(70)
  ;(globalThis as { location?: { search: string } }).location!.search = '?shbudget=2'
  assert.ok(cache.stats.cacheLayers <= 60, 'cap')
  const sl: Slot[] = []
  for (let i = 0; i < 70; i++) sl.push(slot(i, 30 + (i % 12), 16 + Math.floor(i / 12), 0, { keep: i < 62 ? 2 + i * 0.01 : 0.1 }))
  // the first 62 are off screen (keep 2+), the last 8 are on screen (keep 0.1) and resident from the start
  const tiles = stubTiles(sl.slice(0, 62)) // only the off-screen tiles exist first: they fill the cache
  const sun = sunAt(centre(0, 36, 18), 10)
  let now = run(cache, tiles, sun, 0, 4000)
  assert.ok(cache.stats.built >= 50, 'the cap is filled by off-screen tiles first')
  tiles.slots.push(...sl.slice(62)) // then the on-screen ones arrive
  now = run(cache, tiles, sun, now, 4000)
  const onScreenBuilt = sl.slice(62).filter((s) => fadeOf(cache, s.layer)[0] >= 0).length // those inside the Sun band
  assert.ok(onScreenBuilt === 8 && cache.stats.evictedForCap >= 1, 'on-screen tiles hold a cache layer under the cap ' + onScreenBuilt + ' ' + cache.stats.evictedForCap)
  assert.ok(cache.stats.built <= 60)
  assert.ok(cache.stats.evictedForCap >= 1, 'off-screen layers gave way ' + JSON.stringify(cache.stats))
  assert.equal(cache.stats.pendingBuild, 0, 'tiles beyond the cap do not count as pending')
  assert.ok(now > 0 && r.renders > 0)
}

// 12. Catch-up (issue #64): after a Sun stop on the desktop class a big visible set (~90 layers, the terminator) is cached in about N / MAX_BUILDS_DESKTOP
//     frames, no frame builds more than that cap, and a frame already over the 33 ms budget gets no catch-up (it falls back to the rest budget).
{
  const search = (globalThis as { location?: { search: string } }).location!.search
  ;(globalThis as { location?: { search: string } }).location!.search = ''
  const make = () => {
    const { r, cache } = mk(100)
    const sl: Slot[] = []
    for (let i = 0; i < 90; i++) sl.push(slot(i, 30 + (i % 12), 16 + Math.floor(i / 12)))
    return { r, cache, tiles: stubTiles(sl) }
  }
  const catchUp = (frameMs: number) => {
    const { cache, tiles } = make()
    const away = sunAt(centre(0, 36, 18), 80)
    const sun = sunAt(centre(0, 36, 18), 10)
    let now = run(cache, tiles, away, 0, 600) // settled, frameMs ~16
    cache.update(tiles as never, eph(sun), now += 16) // the Sun jumps
    let frames = 0, maxBuilds = 0, buildFrames = 0
    while (frames < 200 && cache.stats.cachedEvents < 1) {
      cache.update(tiles as never, eph(sun), now += frameMs)
      frames++
      maxBuilds = Math.max(maxBuilds, cache.stats.buildsLastFrame)
      if (cache.stats.buildsLastFrame > 0) buildFrames++
    }
    return { frames, maxBuilds, buildFrames, wanted: cache.stats.visibleWanted, built: cache.stats.visibleBuilt }
  }
  const fast = catchUp(10)
  assert.ok(fast.wanted >= 80, 'a terminator-sized visible set ' + fast.wanted)
  assert.ok(fast.maxBuilds <= 8, 'no frame builds more than the desktop cap ' + fast.maxBuilds)
  assert.ok(fast.buildFrames <= Math.ceil(fast.built / 8) + 2, 'cached in about wanted / 8 frames ' + JSON.stringify(fast))
  const slow = catchUp(50) // the frame loop is over budget (frameMs > 33): no catch-up
  assert.ok(slow.buildFrames > fast.buildFrames, 'an over-budget frame loop gets no catch-up ' + JSON.stringify({ fast, slow }))
  ;(globalThis as { location?: { search: string } }).location!.search = search
}

// 12. Rest catch-up (?restcache): a `catchUp` frame is a frame that draws nothing. It builds even when CPU already ran long (no deferral), never in a motion frame,
//     and visibleUnmet() falls to 0 as the visible layers build. Without `catchUp` the same over-budget frame still defers (today's behaviour).
{
  const c0 = centre(0, 36, 18)
  const sun = sunAt(c0, 10)
  const slots = () => [slot(0), slot(1), slot(2), slot(3)]
  // Settled Sun, no layers yet: the visible set is wanted and unbuilt.
  const warm = (cache: InstanceType<typeof ShadowCache>, tiles: ReturnType<typeof stubTiles>): number => {
    cache.update(tiles as never, eph(sunAt(c0, 80)), 100, { motion: true }) // outside the band: nothing to build yet; motion frame
    return 100
  }
  const { r, cache } = mk(8)
  const tiles = stubTiles(slots())
  let now = warm(cache, tiles)
  cache.update(tiles as never, eph(sun), now += 16, { motion: true })
  now += 400
  cache.update(tiles as never, eph(sun), now, { motion: true, catchUp: true })
  assert.equal(r.renders, 0, 'a motion frame builds nothing even with catchUp')
  assert.equal(cache.visibleUnmet(), 4, 'four visible layers wanted and unbuilt')
  // An over-budget frame (100 ms of CPU already spent): without catchUp it defers, with catchUp it builds.
  cache.update(tiles as never, eph(sun), now += 16, { frameStart: now - 100 })
  assert.equal(r.renders, 0, 'over budget by CPU: the ordinary frame defers')
  assert.equal(cache.stats.catchUpFrames, 0)
  cache.update(tiles as never, eph(sun), now += 16, { frameStart: now - 100, catchUp: true })
  assert.equal(r.renders, 2, 'a catch-up frame builds at the budget despite the over-budget frame (?shbudget=2 here)')
  assert.equal(cache.stats.catchUpFrames, 1)
  assert.equal(cache.stats.catchUpLayers, 2)
  assert.equal(cache.visibleUnmet(), 2)
  cache.update(tiles as never, eph(sun), now += 16, { catchUp: true })
  assert.equal(cache.visibleUnmet(), 0, 'the visible set is built')
  assert.equal(cache.stats.catchUpLayers, 4)
  assert.equal(cache.stats.catchUpFrames, 2)
  const before = r.renders
  cache.update(tiles as never, eph(sun), now + 16, { catchUp: true })
  assert.equal(r.renders, before, 'nothing left to build')
}

// 12b. visibleUnmet() counts only what a build can supply: a visible slot outside the Sun band, and class-capped tiles, are not unmet.
{
  const { cache } = mk(8)
  const lit = centre(0, 36, 18)
  const sun = sunAt(lit, 10)
  // slot 0 is lit; slot 1 sits on the far side of the Moon (tile centre ~180 degrees away: the Sun is far below its horizon).
  const far = slot(1, 36 + 18, 18, 0)
  const tiles = stubTiles([slot(0), far])
  cache.update(tiles as never, eph(sun), 1000, { motion: true })
  assert.equal(cache.stats.visibleWanted >= 1, true)
  assert.equal(cache.visibleUnmet(), 1, 'only the lit slot can be built')
  cache.update(tiles as never, eph(sun), 1100, { catchUp: true })
  cache.update(tiles as never, eph(sun), 1116, { catchUp: true })
  assert.equal(cache.visibleUnmet(), 0, 'the out-of-band visible slot never counts')
  // The Sun moving (fast path, no layers held): nothing is unmet to wait for.
  const m = mk(8)
  const t2 = stubTiles([slot(0)])
  m.cache.update(t2 as never, eph(sun), 1000, { motion: true })
  m.cache.update(t2 as never, eph(sunAt(lit, 10, 5)), 1010, { motion: true })
  assert.equal(m.cache.visibleUnmet(), 0, 'Sun moving: 0')
  // Class cap: 62 visible tiles on a 60-layer array; the two with no layer to take stay on the live march and are not unmet.
  ;(globalThis as { location?: { search: string } }).location!.search = '?shbudget=8&class=phone-android&shcap=40'
  const cp = mk(70)
  ;(globalThis as { location?: { search: string } }).location!.search = '?shbudget=2'
  const sl: Slot[] = []
  for (let i = 0; i < 62; i++) sl.push(slot(i, 30 + (i % 12), 16 + Math.floor(i / 12), 0, { keep: 0.1 }))
  const tc = stubTiles(sl)
  run(cp.cache, tc, sunAt(centre(0, 36, 18), 10), 0, 4000)
  assert.ok(cp.cache.stats.cappedOut >= 1, 'some visible tiles are capped out: ' + JSON.stringify(cp.cache.stats))
  assert.equal(cp.cache.visibleUnmet(), 0, 'capped-out tiles are excluded')
}

// 12c. catchUp when the budget is NOT fixed (the burst-budget branch of layersThisFrame) and in the starved state.
{
  const search = (globalThis as { location?: { search: string } }).location!.search
  ;(globalThis as { location?: { search: string } }).location!.search = ''
  const sl: Slot[] = []
  for (let i = 0; i < 30; i++) sl.push(slot(i, 30 + (i % 12), 16 + Math.floor(i / 12), 0))
  const sun = sunAt(centre(0, 36, 18), 10)
  const mkU = () => { const x = mk(40); ;(x.cache as unknown as { msPerLayer: number }).msPerLayer = 1; return x }
  const a = mkU(), b = mkU()
  const ta = stubTiles(sl), tb = stubTiles(sl)
  a.cache.update(ta as never, eph(sunAt(centre(0, 36, 18), 80)), 100, { motion: true })
  b.cache.update(tb as never, eph(sunAt(centre(0, 36, 18), 80)), 100, { motion: true })
  a.cache.update(ta as never, eph(sun), 600, { motion: true })
  b.cache.update(tb as never, eph(sun), 600, { motion: true })
  a.cache.update(ta as never, eph(sun), 600 + SETTLE_MS + 50, {})
  b.cache.update(tb as never, eph(sun), 600 + SETTLE_MS + 50, { catchUp: true })
  assert.ok(b.r.renders >= a.r.renders && b.r.renders > 0, 'unset budget: catchUp builds at least the rest budget ' + a.r.renders + ' ' + b.r.renders)
  assert.ok(b.r.renders <= 8, 'and never more than MAX_BUILDS_DESKTOP')
  ;(globalThis as { location?: { search: string } }).location!.search = search
  // Starved: ordinary frames over budget defer until one small build goes ahead; a catch-up frame in that state still builds its full budget.
  const { r, cache } = mk(8)
  const tiles = stubTiles([slot(0), slot(1), slot(2), slot(3), slot(4), slot(5)])
  let now = 100
  cache.update(tiles as never, eph(sunAt(centre(0, 36, 18), 80)), now, { motion: true })
  now += 500
  cache.update(tiles as never, eph(sun), now, { motion: true })
  now += SETTLE_MS + 50
  for (let i = 0; i < 5; i++) { now += 16; cache.update(tiles as never, eph(sun), now, { frameStart: now - 100 }) }
  assert.ok(cache.stats.deferredOver >= 2, 'ordinary over-budget frames deferred')
  const before = r.renders
  cache.update(tiles as never, eph(sun), now += 16, { frameStart: now - 100, catchUp: true })
  assert.ok(r.renders > before, 'a catch-up frame builds although the ordinary frames were deferred or starved')
}

// 13. Background compile (shprecompile, default on). A renderer whose compileAsync is controlled by the test.
{
  const loc = (globalThis as { location?: { search: string } }).location!
  const search = loc.search
  assert.equal(shPrecompileOn(''), true)
  assert.equal(shPrecompileOn('?shprecompile=1'), true)
  assert.equal(shPrecompileOn('?shprecompile=0'), false)
  const ctl = (complete = true) => {
    let resolve!: () => void, reject!: (e: Error) => void
    const p = new Promise<void>((res, rej) => { resolve = res; reject = rej })
    const r = Object.assign(stubRenderer({ complete }), { compiles: 0, compileTarget: null as unknown, fbChecks: 0,
      extensions: { has: (n: string) => n === 'KHR_parallel_shader_compile' },
      compileAsync(this: { compiles: number; compileTarget: unknown; target: unknown }) { this.compiles++; this.compileTarget = this.target; return p } })
    const ctx = r.getContext!()
    const check = ctx.checkFramebufferStatus
    r.getContext = () => Object.assign(ctx, { checkFramebufferStatus: () => { r.fbChecks++; return check() } })
    return { r, resolve, reject }
  }
  const sun = sunAt(centre(0, 36, 18), 10)
  const flush = () => new Promise((res) => setTimeout(res, 0))
  // (a) Compiled with the cache array bound, the framebuffer checked once at construction (never again in a build), builds wait for the compile.
  {
    const { r, resolve } = ctl()
    const cache = new ShadowCache(r as never, passUniforms() as never, 8, 180, 4096, 0)
    assert.equal(r.compiles, 1, 'compileAsync at construction')
    assert.ok(r.compileTarget && r.compileTarget === (cache as unknown as { rt: unknown }).rt, 'compiled against the cache array target')
    assert.equal(r.target, null, 'previous target restored')
    assert.equal(r.fbChecks, 1, 'framebuffer checked at construction')
    assert.equal(cache.stats.precompile, true)
    assert.equal(cache.stats.parallelCompile, true)
    const tiles = stubTiles([slot(0)])
    assert.equal(cache.update(tiles as never, eph(sun), 1000), true, 'pending builds keep asking for frames')
    assert.equal(r.renders, 0, 'no build before the compile settles')
    resolve(); await flush()
    assert.ok(cache.stats.compileMs >= 0)
    cache.update(tiles as never, eph(sun), 1016)
    assert.equal(r.renders, 1, 'builds once compiled')
    run(cache, tiles, sun, 1016, 600)
    assert.equal(r.fbChecks, 1, 'no framebuffer check inside a build')
    assert.equal(cache.failed, false)
    assert.equal(cache.stats.compileFallback, false)
  }
  // (b) A compile that never settles: builds go ahead after COMPILE_WAIT_MS of frames.
  {
    const { r } = ctl()
    const cache = new ShadowCache(r as never, passUniforms() as never, 8, 180, 4096, 0)
    const tiles = stubTiles([slot(0)])
    const now = run(cache, tiles, sun, 0, COMPILE_WAIT_MS - 100)
    assert.equal(r.renders, 0, 'still waiting')
    run(cache, tiles, sun, now, 200)
    assert.ok(r.renders >= 1, 'fallback builds')
    assert.equal(cache.stats.compileFallback, true)
    assert.equal(cache.failed, false)
  }
  // (c) A rejected compile fails the cache; the frame loop detaches it (the shader marches live) and stops the change feed.
  {
    const { r, reject } = ctl()
    const cache = new ShadowCache(r as never, passUniforms() as never, 8, 180, 4096, 0)
    const tiles = stubTiles([slot(0)])
    cache.update(tiles as never, eph(sun), 1000)
    const moon = { attached: cache as unknown, setShadowCache(c: null) { this.attached = c } }
    assert.equal(cache.detachIfFailed(moon, tiles), false, 'not failed yet: stays attached')
    reject(new Error('link failed')); await flush()
    assert.equal(cache.failed, true)
    assert.equal(cache.update(tiles as never, eph(sun), 1016), false)
    assert.equal(cache.stats.failed, true)
    assert.equal(r.renders, 0)
    assert.equal(cache.detachIfFailed(moon, tiles), true)
    assert.equal(moon.attached, null, 'detached from the Moon pass')
    assert.equal(tiles.trackChanges, false, 'change feed off')
  }
  // (d) An incomplete framebuffer at construction: failed before any frame, no compile started, detached on the first frame.
  {
    const { r } = ctl(false)
    const cache = new ShadowCache(r as never, passUniforms() as never, 8, 180, 4096, 0)
    assert.equal(cache.failed, true)
    assert.equal(cache.stats.failed, true)
    assert.equal(r.compiles, 0)
    const tiles = stubTiles([slot(0)])
    assert.equal(cache.update(tiles as never, eph(sun), 1000), false)
    const moon = { attached: cache as unknown, setShadowCache(c: null) { this.attached = c } }
    assert.equal(cache.detachIfFailed(moon, tiles), true)
    assert.equal(moon.attached, null)
  }
  // (f) Warm: once the compile settles, three's first-use step (getUniforms) runs for the build program, before any build; a program that did not
  //     link fails the cache. ?shwarm=0 leaves it to the first build.
  {
    assert.equal(shWarmOn(''), true)
    assert.equal(shWarmOn('?shwarm=0'), false)
    const warmCase = (link: boolean, extra = '') => {
      loc.search = search + extra
      const c = ctl()
      const prog = { program: {}, uses: 0, getUniforms() { this.uses++ } }
      const ctx = c.r.getContext!()
      c.r.getContext = () => Object.assign(ctx, { LINK_STATUS: 35714, getProgramParameter: () => link })
      Object.assign(c.r, { properties: { get: () => ({ currentProgram: prog }) } })
      const cache = new ShadowCache(c.r as never, passUniforms() as never, 8, 180, 4096, 0)
      loc.search = search
      return { ...c, prog, cache }
    }
    const a = warmCase(true)
    assert.equal(a.prog.uses, 0, 'not before the compile settles')
    a.resolve(); await flush()
    assert.equal(a.prog.uses, 1, 'first use runs when the compile settles')
    assert.equal(a.cache.failed, false)
    const b = warmCase(false)
    b.resolve(); await flush()
    assert.equal(b.cache.failed, true, 'a program that did not link fails the cache')
    const off = warmCase(true, '&shwarm=0')
    off.resolve(); await flush()
    assert.equal(off.prog.uses, 0, 'shwarm=0: left to the first build')
    assert.equal(off.cache.failed, false)
  }
  // (e) ?shprecompile=0: the old path, no compile at construction, the framebuffer checked in the first build; builds at once.
  {
    loc.search = search + '&shprecompile=0'
    const { r } = ctl()
    const cache = new ShadowCache(r as never, passUniforms() as never, 8, 180, 4096, 0)
    assert.equal(cache.stats.precompile, false)
    assert.equal(r.compiles, 0)
    assert.equal(r.fbChecks, 0)
    cache.update(stubTiles([slot(0)]) as never, eph(sun), 1000)
    assert.equal(r.renders, 1, 'builds without waiting')
    assert.equal(r.fbChecks, 1, 'checked in the first build')
    const bad = ctl(false)
    const c2 = new ShadowCache(bad.r as never, passUniforms() as never, 8, 180, 4096, 0)
    assert.equal(c2.failed, false, 'off: not checked before the first build')
    c2.update(stubTiles([slot(0)]) as never, eph(sun), 1000)
    assert.equal(c2.failed, true, 'off: fails in the first build')
    loc.search = search
  }
}

// 14. Per-level reach (R45, ?shreach): a finer tile is read by the march only near its origin, so a change at a fine level 20 km away dirties nothing, and
// a coarse one does. Level 2 and `?shreach=300` keep the flat 300 km.
{
  // The formula bounds the march: a sample at distance d reads level marchLevel(d) and coarser, so a level-L tile is read only for d < marchReachKm(L).
  for (const L of [-4, -3, -2, -1, 0, 1]) {
    const reach = marchReachKm(L)
    for (let d = 0.01; d < MARCH_MAX_KM; d *= 1.003) {
      if (marchLevel(d, H_TEXEL_KM, 3, -4) <= L) assert.ok(d <= reach, `level ${L} is read at ${d.toFixed(3)} km, inside its reach ${reach.toFixed(3)}`)
    }
    assert.ok(reach < MARCH_MAX_KM)
  }
  assert.equal(marchReachKm(2), 300)
  assert.ok(Math.abs(marchReachKm(-3) - 1.4) < 0.1 && Math.abs(marchReachKm(0) - 11.4) < 0.4 && Math.abs(marchReachKm(1) - 22.8) < 0.8)
  assert.equal(reachDeg(2), 300 / MOON_R_KM * 180 / Math.PI, 'level 2 is exactly the old constant')
  assert.equal(reachDeg(-3, true), reachDeg(2), 'flat reach for every level')
  assert.equal(shReachOn('?shreach=300'), false)
  assert.equal(shReachOn(''), true)
  const loc = (globalThis as { location: { search: string } }).location
  const saved = loc.search
  const dirtyAfter = (search: string, change: { level: number; tx: number; ty: number }): number => {
    loc.search = search
    const cache = new ShadowCache(stubRenderer() as never, passUniforms() as never, 8, 180, 4096, 0)
    const tiles = stubTiles([slot(0, 288, 144, -3)])
    const c = centre(-3, 288, 144)
    const now = run(cache, tiles, sunAt(c, 10), 0, 700)
    assert.equal(cache.stats.buildsTotal >= 1, true, 'the layer is built first')
    tiles.pending.changes.push(change)
    run(cache, tiles, sunAt(c, 10), now, 900)
    return cache.stats.buildsDirty
  }
  try {
    const near3 = { level: -3, tx: 291, ty: 144 } // 3 tiles = 1.9 deg = 20 km east
    assert.equal(dirtyAfter('?shbudget=2', near3), 0, 'a level -3 change 20 km away dirties nothing')
    assert.equal(dirtyAfter('?shbudget=2&shreach=300', near3), 1, '?shreach=300: the same change dirties it (today)')
    const adj3 = { level: -3, tx: 289, ty: 144 }
    assert.equal(dirtyAfter('?shbudget=2', adj3), 1, 'an adjacent level -3 tile still dirties it')
    const l0 = { level: 0, tx: 38, ty: 18 } // a level 0 tile ~12 deg east
    assert.equal(dirtyAfter('?shbudget=2', l0), 0, 'a level 0 change beyond its ~11 km reach dirties nothing')
    assert.equal(dirtyAfter('?shbudget=2&shreach=300', l0), 1)
    const l2 = { level: 2, tx: 9, ty: 4 } // a coarse tile 200 km away or so
    assert.equal(dirtyAfter('?shbudget=2', l2), 1, 'a level 2 change dirties it')
    assert.equal(dirtyAfter('?shbudget=2&shreach=300', l2), 1)
    const l2far = { level: 2, tx: 12, ty: 4 } // 60 deg east: past 300 km plus both radii, both ways
    assert.equal(dirtyAfter('?shbudget=2', l2far), 0)
    assert.equal(dirtyAfter('?shbudget=2&shreach=300', l2far), 0)
  } finally { loc.search = saved }
}
assert.ok(SPARE_LAYERS.desktop >= 8 && SPARE_LAYERS.low >= 4)
console.log('shadow-cache state ok')
