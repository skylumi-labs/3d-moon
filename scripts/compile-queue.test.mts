import assert from 'node:assert/strict'
import * as THREE from 'three'
import { PRECOMPILE_DEFAULT, createCompileQueue, precompileSteps, type PrecompileStep } from '../src/net/compileQueue.ts'
import { groundWarmKinds } from '../src/ground/warmKinds.ts'
import { discardLanderPreload, lmMaterialLite, resetLanderPreload, startLanderPreload, takeLanderPreload, landerPreloadStarted } from '../src/ground/lmPrefetch.ts'
import { readFileSync } from 'node:fs'
import { LunarModule } from '../src/ground/LunarModule.ts'
import { MoonPass } from '../src/moon/MoonPass.ts'
import { commonUniforms } from '../src/glsl/common.ts'
import type { MoonMaps } from '../src/moon/maps.ts'

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

// 1. The switch: absent = tiles, ground, lm (never the metadata programs); 0/off = none; a list = only those; unknown names ignored.
assert.deepEqual([...precompileSteps('')].sort(), ['ground', 'lm', 'tiles'])
assert.equal(precompileSteps('?precompile=1'), PRECOMPILE_DEFAULT)
assert.equal(PRECOMPILE_DEFAULT.has('meta'), false, 'a visitor does not compile the metadata programs')
assert.equal(precompileSteps('?precompile=0').size, 0)
assert.equal(precompileSteps('?precompile=off').size, 0)
assert.deepEqual([...precompileSteps('?precompile=lm,tiles')].sort(), ['lm', 'tiles'])
assert.deepEqual([...precompileSteps('?precompile=meta,bogus')], ['meta'])
assert.equal(precompileSteps('?precompile=all').has('meta'), true)

// 2. One step per idle callback, in order of first need, whatever order they were added in.
{
  const slots: Array<() => void> = []
  const log: string[] = []
  const q = createCompileQueue((cb) => slots.push(cb), PRECOMPILE_DEFAULT)
  const step = (s: PrecompileStep) => async (): Promise<void> => { log.push(s) }
  assert.equal(q.enqueue('lm', step('lm')), true)
  assert.equal(q.enqueue('tiles', step('tiles')), true)
  assert.equal(q.enqueue('ground', step('ground')), true)
  assert.equal(q.enqueue('tiles', step('tiles')), false, 'a step is queued once')
  assert.equal(slots.length, 1, 'one idle slot is asked for, not one per step')
  assert.deepEqual(log, [])
  slots.shift()!(); await tick(); await tick()
  assert.deepEqual(log, ['tiles'], 'one compile per idle callback')
  assert.equal(slots.length, 1)
  slots.shift()!(); await tick(); await tick()
  slots.shift()!(); await tick(); await tick()
  assert.deepEqual(log, ['tiles', 'ground', 'lm'])
  assert.deepEqual(q.ran, ['tiles', 'ground', 'lm'])
  assert.equal(q.pending, 0)
}

// 3. The next slot is asked for only after the running step settles; a failure does not stop the queue; a step the switch left out is dropped.
{
  const slots: Array<() => void> = []
  let release!: () => void
  const q = createCompileQueue((cb) => slots.push(cb), new Set<PrecompileStep>(['tiles', 'ground']))
  q.enqueue('tiles', () => new Promise<void>((r) => { release = r }))
  q.enqueue('ground', async () => { throw new Error('link failed') })
  assert.equal(q.enqueue('lm', async () => undefined), false, 'lm is off in this switch')
  slots.shift()!(); await tick()
  assert.equal(slots.length, 0, 'no second slot while the first compile is running')
  release(); await tick(); await tick()
  assert.equal(slots.length, 1)
  slots.shift()!(); await tick(); await tick()
  assert.deepEqual(q.ran, ['tiles', 'ground'])
  assert.equal(q.pending, 0)
}

// 4. The ground warm list leaves the metadata program out unless it is wanted.
assert.deepEqual(groundWarmKinds(false), ['cover', 'shade', 'probe'])
assert.deepEqual(groundWarmKinds(true), ['cover', 'shade', 'probe', 'metadata'])

// 5. The lunar module preload: once, handed over once, a failure falls back to null; lmmat resolves class and switch.
{
  resetLanderPreload()
  assert.equal(takeLanderPreload(), null)
  let loads = 0, links = 0
  const lm = { id: 1 }
  const a = startLanderPreload(async () => { loads++; return lm }, async () => { links++ })
  const b = startLanderPreload(async () => { loads++; return lm }, async () => { links++ })
  assert.equal(a, b, 'started once')
  assert.equal(landerPreloadStarted(), true)
  assert.equal(await takeLanderPreload<typeof lm>(), lm)
  assert.equal(takeLanderPreload(), null, 'handed over once')
  assert.deepEqual([loads, links], [1, 1])
  resetLanderPreload()
  assert.equal(await startLanderPreload(async () => lm, async () => { throw new Error('link') }), lm, 'a failed link still hands the module over')
  resetLanderPreload()
  assert.equal(await startLanderPreload(async () => { throw new Error('parse') }, async () => undefined), null)
  resetLanderPreload()
  assert.equal(lmMaterialLite('', 'ios'), true)
  assert.equal(lmMaterialLite('', 'phone-android'), true)
  assert.equal(lmMaterialLite('', 'ipad'), true, 'an iPad was ios before the split')
  for (const c of ['tablet', 'desktop', 'software']) assert.equal(lmMaterialLite('', c), false)
  assert.equal(lmMaterialLite('?lmmat=physical', 'ios'), false)
  assert.equal(lmMaterialLite('?lmmat=standard', 'desktop'), true)
}

// 5b. An untaken preload is freed: after the timeout, on discard (also while it is still loading), never once taken.
{
  const lm = { id: 7 }
  resetLanderPreload()
  const freed: unknown[] = []
  await startLanderPreload(async () => lm, async () => undefined, (x) => freed.push(x), 20)
  assert.equal(freed.length, 0)
  await new Promise((r) => setTimeout(r, 60))
  assert.deepEqual(freed, [lm], 'freed after the timeout')
  assert.equal(takeLanderPreload(), null, 'and no longer handed out')
  freed.length = 0
  const q = startLanderPreload(async () => lm, async () => undefined, (x) => freed.push(x), 20)
  await q
  assert.ok(takeLanderPreload())
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(freed.length, 0, 'a taken module is never freed by the timer')
  resetLanderPreload()
  startLanderPreload(async () => lm, async () => undefined, (x) => freed.push(x), 100000)
  await discardLanderPreload()
  assert.deepEqual(freed, [lm], 'discard frees a preload still loading once it settles')
  assert.equal(takeLanderPreload(), null)
  resetLanderPreload()
  // LunarModule.dispose frees geometry, materials and their textures.
  const log: string[] = []
  const tex = { isTexture: true, dispose: () => log.push('tex') }
  const mesh = { isMesh: true, geometry: { dispose: () => log.push('geo') }, material: { map: tex, dispose: () => log.push('mat') } }
  const fake = { metadataOccluder: { dispose() {} }, dust: { dispose() {} }, shadowTarget: { dispose() {} }, envRT: null, sun: { shadow: { dispose() {} } }, model: { traverse: (f: (o: unknown) => void) => f(mesh) } }
  LunarModule.prototype.dispose.call(fake as never)
  assert.deepEqual(log, ['geo', 'tex', 'mat'])
}

// 5c. The ground warm-up compiles what a default frame draws: cover, shade and probe through the pass's own meshes (built from the live near setting), then the bake program.
{
  assert.deepEqual(groundWarmKinds(false), ['cover', 'shade', 'probe'])
  const src = readFileSync(new URL('../src/ground/GroundPass.ts', import.meta.url), 'utf8')
  assert.match(src, /this\.nearBake\) \{ if \(between\) await between\(\); await this\.nearBake\.warm\(renderer\)/, 'warm compiles the bake program in its own slot')
  assert.match(src, /for \(const kind of kinds\)[\s\S]*this\.meshes\[kind\]/, 'warm compiles the same meshes render draws')
}

// 6. MoonPass: the metadata variant is not compiled unless a calibration or an audit (or ?precompile=meta) asks for it; the hit pass shares the cover program.
{
  const oldLocation = globalThis.location
  Object.defineProperty(globalThis, 'location', { value: { search: '' }, configurable: true })
  try {
    const maps = { color: new THREE.DataTexture(new Uint8Array(4), 1, 1), height: { texture: new THREE.DataTexture(new Float32Array(1), 1, 1), levels: 1, lonSpan: 180, size: [4096, 2048] } } as unknown as MoonMaps
    const moon = new MoonPass(commonUniforms(), maps)
    const compiled: THREE.Material[] = []
    const renderer = { compileAsync: async (scene: THREE.Scene) => { scene.traverse((o) => { const m = (o as THREE.Mesh).material; if (m) compiled.push(m as THREE.Material) }) } } as unknown as THREE.WebGLRenderer
    const site = { availableLevels: [{ name: 'L0', texelM: 4, heights: 'h', detail: 'r' }], levels: [] } as never
    await moon.prepare(renderer, site)
    assert.equal(moon.metadataVariantCount, 0, 'a visitor builds no metadata variant')
    assert.equal(compiled.length, 2, 'the patch cover and shade programs only')
    const visitor = new MoonPass(commonUniforms(), maps)
    visitor.setMetadataWanted(true)
    compiled.length = 0
    await visitor.prepare(renderer, site)
    assert.equal(visitor.metadataVariantCount, 1, 'a calibration or audit warms it')
    assert.equal(compiled.length, 3)
    // The hit pass draws the cover's fragment and vertex source: one program under three's cache, however many materials hold it.
    const cover = (moon as unknown as { cover: THREE.ShaderMaterial }).cover
    const hit = (moon as unknown as { hitMaterialFor(c: THREE.ShaderMaterial): THREE.ShaderMaterial }).hitMaterialFor(cover)
    assert.notEqual(hit, cover)
    assert.equal(hit.fragmentShader, cover.fragmentShader)
    assert.equal(hit.vertexShader, cover.vertexShader)
    assert.deepEqual(hit.defines, cover.defines)
  } finally { Object.defineProperty(globalThis, 'location', { value: oldLocation, configurable: true }) }
}
console.log('compile-queue: ok')
