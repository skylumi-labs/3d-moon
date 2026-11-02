// PatchShadowCache.update's invariants, against a stub renderer (no GL): nothing stale is served while the Sun is moved interactively, the live clock's
// drift keeps serving while blocks are rebuilt in place (within its tolerance only), a gesture or a patch out of view builds nothing, and a new level
// set drops every block. See src/moon/patch/PatchShadowCache.ts.
import assert from 'node:assert/strict'
import * as THREE from 'three'
;(globalThis as { location?: unknown }).location = { search: '?pshbudget=2' }
const { PatchShadowCache, PSH_SUN_TOL_RAD, PSH_DRIFT_TOL_RAD, PSH_SETTLE_MS } = await import('../src/moon/patch/PatchShadowCache.ts')

const RAD = Math.PI / 180
function stubRenderer() {
  return {
    renders: 0, autoClear: true, capabilities: { maxTextureSize: 8192 },
    getRenderTarget() { return null }, setRenderTarget() { /* no GL */ }, render() { this.renders++ },
    compileAsync() { return Promise.resolve() }, getContext: undefined,
  }
}
const uniforms = () => ({
  uPatchBlend: { value: 1 }, uPatchGround: { value: 1 }, uPSite: { value: new THREE.Vector3(1, 0, 0) }, uPEast: { value: new THREE.Vector3(0, 1, 0) }, uPNorth: { value: new THREE.Vector3(0, 0, 1) },
  uPSC: { value: null }, uPShOn: { value: 0 }, uPCoB: { value: new THREE.Vector4() }, uPCkB: { value: 1 },
  ...Object.fromEntries(Array.from({ length: 7 }, (_, i) => [[`uPCo${i}`, { value: new THREE.Vector4() }], [`uPCk${i}`, { value: 1 }]]).flat()),
})
const level = (w = 512) => ({ name: 'L2', w, h: w, texelM: 8, eastM: -w * 4, northM: w * 4, texelEastM: 8, texelNorthM: 8, heights: 'h' }) as never
const layout = [{ h: true, r: false, fadeM: 400, cache: true }] as never
const sunAt = (elev: number, azRot = 0) => new THREE.Vector3(Math.sin(elev * RAD), Math.cos(elev * RAD), 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), azRot * RAD).normalize()
const eph = (sun: THREE.Vector3) => ({ sunDir: sun, moonX: new THREE.Vector3(1, 0, 0), moonY: new THREE.Vector3(0, 1, 0), moonZ: new THREE.Vector3(0, 0, 1) }) as never
const cam = { camPos: new THREE.Vector3(1.01, 0, 0), camBack: new THREE.Vector3(1, 0, 0) }
async function mk() {
  const r = stubRenderer(), u = uniforms()
  const c = new PatchShadowCache(r as never, u as never, 180, 4096, 0)
  c.bind([level()], layout, true)
  await new Promise((res) => setTimeout(res, 0)) // compileAsync resolves
  return { r, u, c }
}
type C = Awaited<ReturnType<typeof mk>>['c']
function run(c: C, sun: THREE.Vector3, t0: number, ms: number, o: Record<string, unknown> = {}): number {
  let now = t0
  while (now < t0 + ms) { now += 16; c.update(null, eph(sun), now, { active: true, ...cam, ...o } as never) }
  return now
}

// 1. Builds when the Sun is still, `?pshbudget=2` blocks a frame; serving starts with the first block.
{
  const { r, u, c } = await mk()
  const s0 = sunAt(10)
  c.update(null, eph(s0), 1000, { active: true, ...cam } as never)
  assert.equal(c.stats.blocks, 4 + 64, 'a 512 texel level at 2 per cache texel is 2x2 blocks of 128, plus the 1000 x 1000 base layer: 8 x 8')
  assert.equal(r.renders, 1 + 2, 'one clear, then the budget of 2 blocks')
  assert.equal(c.shaderOn, true, 'serving as soon as a block is built')
  assert.equal(u.uPShOn.value, 1)
  run(c, s0, 1000, 1500)
  assert.equal(c.stats.pending, 0)
  assert.equal(c.stats.serving, c.stats.blocks - c.stats.skipped, 'every needed block built')
  assert.ok((u.uPCo0.value as THREE.Vector4).z === 256, 'the layer is 256 cache texels wide')
  assert.ok((u.uPCoB.value as THREE.Vector4).z === 1000, 'the base layer is 1000 cache texels wide')
}

// Fixed-policy measured allowance bounds patch construction to one block after the atlas clear.
{
  const { r, c } = await mk()
  c.update(null, eph(sunAt(10)), 1000, { active: true, fixedPolicy: true, fixedBudgetMs: 0.25, ...cam } as never)
  assert.equal(r.renders, 2, 'one clear and one build block fit the fixed per-frame cap')
  assert.equal(c.stats.buildsLastFrame, 1)
}

// 2. An interactive Sun move drops everything in the SAME call, before any draw; rebuilt after it settles.
{
  const { r, u, c } = await mk()
  let now = run(c, sunAt(10), 0, 1500)
  const need = c.stats.serving
  assert.ok(need >= 68 - 4)
  const rendersBefore = r.renders
  c.update(null, eph(sunAt(10.5)), now + 16, { active: true, ...cam } as never)
  now += 16
  assert.equal(c.shaderOn, false, 'not served this frame')
  assert.equal(u.uPShOn.value, 0)
  assert.equal(c.stats.serving, 0)
  assert.equal(r.renders, rendersBefore, 'nothing built in the frame the Sun moved')
  now = run(c, sunAt(10.5), now, PSH_SETTLE_MS - 40)
  assert.equal(c.stats.serving, 0, 'nothing built before the Sun has been still for the settle time')
  run(c, sunAt(10.5), now, 1600)
  assert.equal(c.stats.serving, need, 'rebuilt once settled')
}

// 3. Clock drift (a small step flagged `drift`) keeps serving while blocks rebuild in place; beyond the tolerance it drops.
{
  const { c } = await mk()
  const s0 = sunAt(10)
  let now = run(c, s0, 0, 1500)
  const step = 0.02 * RAD * 0.5 // total 0.02 deg: past SUN_TOL (0.01), inside DRIFT_TOL (0.05)
  assert.ok(0.02 * RAD > PSH_SUN_TOL_RAD && 0.02 * RAD < PSH_DRIFT_TOL_RAD)
  const s1 = sunAt(10 + 0.02)
  c.update(null, eph(s1), now + 16, { active: true, drift: true, ...cam } as never)
  now += 16
  void step
  assert.equal(c.shaderOn, true, 'drift keeps serving the older blocks')
  assert.equal(c.stats.rebuilds, 1)
  run(c, s1, now, 100, { drift: true })
  run(c, s1, now + 100, 1600)
  assert.equal(c.stats.pending, 0, 'rebuilt in place for the new Sun')
  // A drift that adds up past the tolerance from the OLDEST block's Sun drops everything.
  const { c: d } = await mk()
  const t = run(d, s0, 0, 1500)
  d.update(null, eph(sunAt(10.02)), t + 16, { active: true, drift: true, ...cam } as never)
  d.update(null, eph(sunAt(10.06)), t + 32, { active: true, drift: true, ...cam } as never)
  assert.equal(d.shaderOn, false, 'past the drift tolerance of the oldest block')
}

// 4. A gesture or a patch out of view or not fully blended builds nothing; a fresh level set drops everything.
{
  const { r, u, c } = await mk()
  const s0 = sunAt(10)
  const base = r.renders
  run(c, s0, 0, 300, { motion: true })
  assert.equal(r.renders, base, 'no builds in a gesture frame')
  run(c, s0, 300, 300, { active: false })
  assert.equal(r.renders, base, 'no builds while the patch variant is not drawn')
  u.uPatchBlend.value = 0.5
  run(c, s0, 600, 300)
  assert.equal(r.renders, base, 'no builds while the patch is still fading in')
  u.uPatchBlend.value = 1
  run(c, s0, 900, 1600)
  assert.ok(c.stats.serving >= 64)
  c.bind([level(1024)], layout, true)
  assert.equal(c.shaderOn, false, 'a new level set drops every block')
  assert.equal(c.stats.serving, 0)
  assert.equal(u.uPShOn.value, 0)
  c.bind([level()], layout, false)
  run(c, s0, 1300, 300)
  assert.equal(c.stats.on, false, 'a site whose heights do not make the ground (not fused) builds nothing')
}

// 5. Per-level reach (R45, ?shreach): a far tile that the march reads only near its origin (level -3 about 1.4 km, level 0 about 11 km, plus the base square)
// does not dirty the cache from 10 deg away, a level 2 tile does, and `?shreach=300` restores the flat 300 km for every level.
{
  const loc = (globalThis as { location: { search: string } }).location
  const saved = loc.search
  const dirtied = async (search: string, level: number, tx: number, ty: number): Promise<number> => {
    loc.search = search
    const { c } = await mk()
    const slots: Array<{ layer: number; level: number; tx: number; ty: number; gen: number; full: boolean; shade: boolean; keep: number }> = []
    const tiles = { cacheSlots: () => slots, takeChanges: () => ({ changes: [], overflow: false }), trackChanges: false }
    const s0 = sunAt(10)
    let now = 0
    const go = (ms: number): void => { const t0 = now; while (now < t0 + ms) { now += 16; c.update(tiles as never, eph(s0), now, { active: true, ...cam } as never) } }
    go(1500)
    const base = c.stats.rebuilds
    slots.push({ layer: 0, level, tx, ty, gen: 1, full: true, shade: true, keep: 1 })
    go(1500)
    return c.stats.rebuilds - base
  }
  try {
    // Site at lon 0, lat 0. Level -3: tx 304 is 10 deg east. Level 0: tx 38 is 12.5 deg east. Level 2: tx 9 is 10 deg east, 14 deg half-diagonal.
    assert.equal(await dirtied('?pshbudget=2', -3, 304, 144), 0, 'a level -3 tile 10 deg away is outside its reach')
    assert.equal(await dirtied('?pshbudget=2&shreach=300', -3, 304, 144), 1, '?shreach=300: the same tile rebuilds the cache (today)')
    assert.equal(await dirtied('?pshbudget=2', 0, 38, 18), 0, 'a level 0 tile 12 deg away is outside its reach')
    assert.equal(await dirtied('?pshbudget=2&shreach=300', 0, 38, 18), 1)
    assert.equal(await dirtied('?pshbudget=2', -3, 288, 144), 1, 'a level -3 tile at the site still counts')
    assert.equal(await dirtied('?pshbudget=2', 2, 9, 4), 1, 'a level 2 tile within 300 km counts')
    assert.equal(await dirtied('?pshbudget=2&shreach=300', 2, 9, 4), 1)
  } finally { loc.search = saved }
}
// 6. Pre-arrival catch-up (W3-M2, R55): a scripted arrival (motion frames, patch not yet in view) builds at half the rest rate, the Sun still; the rest
// frames at the site then finish the atlas sooner. Not on a dear frame, not while the Sun moves, not with `?pshcatchup=0`.
{
  const loc = (globalThis as { location: { search: string } }).location
  const approach = { active: false, motion: true, catchUp: true }
  const { r, c } = await mk()
  const s0 = sunAt(10)
  const base = r.renders
  c.update(null, eph(s0), 1000, { ...approach, ...cam } as never)
  assert.equal(r.renders - base, 1 + 1, 'one clear, then the catch-up rate: half of ?pshbudget=2')
  assert.equal(c.stats.catchUpBuilds, 1)
  run(c, s0, 1000, 800, approach)
  const during = c.stats.serving
  assert.ok(during > 10, 'blocks accumulate during the approach')
  assert.equal(c.stats.catchUpFrames, c.stats.catchUpBuilds, 'one block a catch-up frame at this budget')
  // Arrival: a rest frame in view takes the normal rate and finishes; nothing was lost or rebuilt.
  const t = run(c, s0, 1800, 400, { active: true, ...cam })
  assert.equal(c.stats.pending, 0, 'atlas complete soon after arrival')
  assert.equal(c.stats.rebuilds, 0)
  void t
  // A dear frame (CPU over budget before the update) builds nothing in catch-up and the starved override does not apply.
  const d = await mk()
  const b1 = d.r.renders
  let now = 0
  for (let i = 0; i < 12; i++) { now += 16; d.c.update(null, eph(s0), now, { ...approach, ...cam, frameStart: now - 40 } as never) }
  assert.equal(d.r.renders, b1, 'no catch-up builds on an over-budget frame')
  // The Sun moving: nothing is built until it has been still for the settle time.
  const m = await mk()
  const b2 = m.r.renders
  m.c.update(null, eph(sunAt(10)), 16, { ...approach, ...cam } as never)
  const afterFirst = m.r.renders
  m.c.update(null, eph(sunAt(11)), 32, { ...approach, ...cam } as never)
  assert.equal(m.r.renders, afterFirst, 'no build in the frame the Sun moved')
  assert.ok(afterFirst > b2)
  assert.equal(m.c.shaderOn, false, 'nothing served in the frame the Sun moved')
  // Off: ?pshcatchup=0 keeps the old rule (no builds in motion frames).
  const saved = loc.search
  loc.search = '?pshbudget=2&pshcatchup=0'
  try {
    const o = await mk()
    const b3 = o.r.renders
    run(o.c, s0, 0, 600, approach)
    assert.equal(o.r.renders, b3, '?pshcatchup=0: no builds in a motion frame')
    assert.equal(o.c.stats.catchUpBuilds, 0)
  } finally { loc.search = saved }
}
console.log('patch shadow cache state ok')
