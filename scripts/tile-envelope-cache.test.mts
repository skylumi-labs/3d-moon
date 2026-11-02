import assert from 'node:assert/strict'
import * as THREE from 'three'
import { TileEnvelope, TENV_BYTES_CAP, TENV_QUIET_MS, type EnvelopeTiles } from '../src/moon/tiles/TileEnvelope.ts'
import { moonFragment, tileEnvelopeFragment } from '../src/moon/moonShader.ts'
import { ENV_OFF_DEG, ENV_Q_DEG, TENV_BLOCKS, TENV_DEFAULT, TENV_N, TENV_STOP_DEG, envDecode, envEncode, tenvBytes } from '../src/moon/globalHorizon.ts'
import { classifyServePixel, SERVE_CATEGORIES, serveShares } from '../src/moon/shadowServe.ts'

// The lifecycle of the per-tile envelope against a recording renderer (there is no headless WebGL here): what is drawn, into which layer, when; what an arrival, a departure and a reused layer
// do to it; the memory cap. The shader's constants are checked against the CPU twin's below.
interface Draw { layer: number; clear: boolean; level: number; tile: [number, number]; scissor: [number, number, number, number]; scissorTest: boolean }
interface Slot { layer: number; level: number; tx: number; ty: number; gen: number; full: boolean; shade: boolean; keep: number }
function rig(low = false, tileLayers = 12) {
  let target: THREE.WebGLRenderTarget | null = null
  let layer = 0
  const draws: Draw[] = []
  const gl = { DRAW_FRAMEBUFFER: 36009, FRAMEBUFFER_COMPLETE: 36053, checkFramebufferStatus: () => 36053 }
  const renderer = {
    autoClear: true,
    getRenderTarget: () => target, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
    setRenderTarget: (t: THREE.WebGLRenderTarget | null, face = 0) => { target = t; layer = face },
    getContext: () => gl,
    render: (scene: THREE.Scene) => {
      const m = (scene.children[0] as THREE.Mesh).material as THREE.ShaderMaterial
      const sc = target!.scissor
      draws.push({ layer, clear: m.uniforms.uTenvClear.value === 1, level: m.uniforms.uTenvLevel.value, tile: [(m.uniforms.uTenvTile.value as THREE.Vector2).x, (m.uniforms.uTenvTile.value as THREE.Vector2).y], scissor: [sc.x, sc.y, sc.z, sc.w], scissorTest: target!.scissorTest })
    },
  } as unknown as THREE.WebGLRenderer
  const pass: Record<string, THREE.IUniform> = {
    uK: { value: new THREE.Vector3(0, 0, 1) }, uX: { value: new THREE.Vector3(1, 0, 0) }, uY: { value: new THREE.Vector3(0, 1, 0) }, uHeight: { value: null }, uHeightLevels: { value: 8 }, uHeightMix: { value: 1 },
    uTileH: { value: null }, uTilePage: { value: null }, uTileBlend: { value: 1 },
  }
  const slots: Slot[] = []
  let changes: Array<{ level: number; tx: number; ty: number }> = []
  let overflow = false
  const tiles: EnvelopeTiles = { cacheSlots: () => slots, takeEnvChanges: () => { const o = { changes, overflow }; changes = []; overflow = false; return o }, trackEnvChanges: false }
  const env = new TileEnvelope(renderer, pass, tileLayers, 180, 4096, 0, low)
  let now = 1000
  const step = (n = 1, allowed = true): void => { for (let i = 0; i < n; i++) env.update(tiles, { now: (now += 16), frameMs: 16, allowed }) }
  /** Frames until nothing more is drawn for a few frames in a row. */
  const settle = (): void => { for (let quiet = 0, i = 0; quiet < 6 && i < 4000; i++) { const before = draws.length; step(); quiet = draws.length === before ? quiet + 1 : 0 } }
  const quietGap = (): void => { now += TENV_QUIET_MS + 50 }
  const add = (layer: number, level: number, tx: number, ty: number, gen: number, full = true, shade = true, keep = 0.5): Slot => { const s = { layer, level, tx, ty, gen, full, shade, keep }; slots.push(s); return s }
  return { env, tiles, draws, slots, add, step, settle, quietGap, change: (level: number, tx: number, ty: number) => { changes.push({ level, tx, ty }) }, overflowNext: () => { overflow = true }, now: () => now }
}
const builds = (d: Draw[]): Draw[] => d.filter((x) => !x.clear)
const clears = (d: Draw[]): Draw[] => d.filter((x) => x.clear)

// ---- Build: nothing before the ground is quiet; then TENV_BLOCKS scissored row blocks per layer, the whole layer covered once, the most on-screen tile first.
{
  const r = rig()
  r.add(0, 0, 36, 18, 1, true, true, 2)
  r.add(1, 0, 37, 18, 1, true, true, 0.1)
  r.add(2, 0, 38, 18, 1, false, true, 0.0)   // still fading in: not built
  r.add(3, 0, 39, 18, 1, true, false, 0.0)   // not shaded: not built
  r.change(0, 36, 18)
  r.step(3)
  assert.equal(builds(r.draws).length, 0, 'no build while the ground is still changing')
  r.quietGap(); r.settle()
  const b = builds(r.draws)
  assert.equal(b.length, 2 * TENV_BLOCKS, 'TENV_BLOCKS draws per eligible layer')
  assert.deepEqual([...new Set(b.map((d) => d.layer))], [1, 0], 'the more on-screen layer (lower keep) first')
  for (const layer of [0, 1]) {
    const mine = b.filter((d) => d.layer === layer)
    assert.ok(mine.every((d) => d.scissorTest && d.scissor[0] === 0 && d.scissor[2] === r.env.n))
    assert.equal(mine.reduce((a, d) => a + d.scissor[3], 0), r.env.n, 'the row blocks cover the layer once')
    assert.deepEqual(mine.map((d) => d.scissor[1]), mine.map((_, i) => i * Math.ceil(r.env.n / TENV_BLOCKS)))
    assert.ok(mine.every((d) => d.level === 0 && d.tile[0] === 36 + layer && d.tile[1] === 18))
  }
  assert.equal(r.env.stats.built, 2); assert.equal(r.env.stats.eligible, 2)
  assert.equal(r.tiles.trackEnvChanges, true, 'the streamer is asked to record changes')
  // Once built it does nothing more, whatever the frame.
  const n = r.draws.length
  r.step(30)
  assert.equal(r.draws.length, n, 'a built layer is not rebuilt (the envelope does not depend on the Sun)')
  // A motion frame and a disallowed frame draw nothing and turn the read off.
  r.step(1, false)
  assert.equal(r.env.readOn, false)
}

// ---- A change within the march's reach clears the layer at once (it is never readable stale) and rebuilds it after the quiet period; a far one, a finer-level one and the tile's own do not.
{
  const r = rig()
  r.add(0, 0, 36, 18, 1)       // level 0, lon 5..10, lat 0..-5 (row 18 is 0..-5 deg)
  r.add(1, 1, 18, 9, 1)        // level 1 tile covering it
  r.quietGap(); r.settle()
  const first = r.draws.length
  assert.equal(builds(r.draws).length, 2 * TENV_BLOCKS)
  // A finer tile (level -1) arriving does not touch layers at level 0 and 1 (they read level >= their own only).
  r.change(-1, 72, 36); r.step(2); r.quietGap(); r.settle()
  assert.equal(r.draws.length, first, 'a change at a finer level leaves the layers alone')
  // The layer's own arrival or fade completion does not change its own ground.
  r.change(0, 36, 18); r.step(2); r.quietGap(); r.settle()
  const afterOwn = r.draws.length
  assert.equal(afterOwn, first, "a tile's own change does not clear its own layer")
  // A same-level neighbour (touching) arriving: level-0 layer 0 is cleared this very frame and rebuilt later; the level-1 layer (coarser than the change) is not affected by a level-0 change within its own tile? It reads level 0 not at all.
  r.change(0, 37, 18)
  r.step(1)
  const cl = clears(r.draws.slice(afterOwn))
  assert.deepEqual(cl.map((d) => d.layer), [0], 'the layer within reach is cleared in the frame of the change')
  assert.equal(cl[0].scissor[3], r.env.n, 'the whole layer')
  assert.ok(builds(r.draws.slice(afterOwn)).length === 0, 'and not rebuilt until the ground is quiet')
  r.quietGap(); r.settle()
  assert.equal(builds(r.draws.slice(afterOwn)).length, TENV_BLOCKS, 'rebuilt once quiet')
  // A coarser tile changing within 300 km of a level-0 tile does reach it; a far one does not.
  const mark = r.draws.length
  r.change(2, 0, 0)   // far side of the Moon
  r.step(2); r.quietGap(); r.settle()
  assert.equal(r.draws.length, mark, 'a change on the far side clears nothing')
  r.change(2, 1, 0)   // level 2 tile covering lon -160..-140? row 0: north pole: still far
  r.step(2); r.quietGap(); r.settle()
  assert.equal(r.draws.length, mark)
  r.change(2, 3, 0 + 0) // another far one
  r.step(1); r.quietGap(); r.settle()
  const near = r.draws.length
  r.change(2, 1, 0)
  r.overflowNext(); r.step(1)
  assert.ok(clears(r.draws.slice(near)).length >= 2, 'an overflow of the change list clears every built layer')
  assert.equal(r.env.stats.overflows, 1)
  r.quietGap(); r.settle()
  assert.equal(r.env.stats.built, 2, 'and they are rebuilt')
}

// ---- Release: a layer the streamer reuses for another tile (new gen) or drops is written as "no bound" before anything reads it, then built for the new tile.
{
  const r = rig()
  const s = r.add(0, 0, 36, 18, 1)
  r.quietGap(); r.settle()
  assert.equal(r.env.stats.built, 1)
  const n = r.draws.length
  s.gen = 2; s.tx = 40
  r.step(1)
  assert.deepEqual(clears(r.draws.slice(n)).map((d) => d.layer), [0], 'a reused layer is cleared at once')
  r.quietGap(); r.settle()
  const rebuilt = builds(r.draws.slice(n))
  assert.equal(rebuilt.length, TENV_BLOCKS)
  assert.ok(rebuilt.every((d) => d.tile[0] === 40), 'built for the new tile')
  const m = r.draws.length
  r.slots.length = 0
  r.step(1)
  assert.deepEqual(clears(r.draws.slice(m)).map((d) => d.layer), [0], 'a layer whose tile left is cleared')
  r.quietGap(); r.settle()
  assert.equal(builds(r.draws.slice(m)).length, 0, 'and nothing is built for it')
}

// ---- Memory: R8, one byte a cell, reported; the class cap bounds the layer count (a layer past it is never drawn into).
{
  const r = rig(false, 12)
  assert.equal(r.env.n, TENV_N.desktop)
  assert.equal(r.env.stats.gpuBytes, tenvBytes(12, TENV_N.desktop))
  assert.equal(r.env.stats.gpuBytes, 12 * 80 * 80 * 8, 'eight sector bytes a cell')
  const low = rig(true, 12)
  assert.equal(low.env.n, TENV_N.low); assert.equal(low.env.stats.gpuBytes, 12 * 30 * 30 * 8)
  for (const cls of ['desktop', 'low'] as const) {
    const big = rig(cls === 'low', 2000)
    assert.ok(big.env.stats.gpuBytes <= TENV_BYTES_CAP[cls], `${cls}: ${big.env.stats.gpuBytes} bytes within the cap`)
    assert.equal(big.env.layers, Math.floor(TENV_BYTES_CAP[cls] / (big.env.n * big.env.n * 8)))
  }
  // 250 resident layers (a desktop streamer) and 111 (a phone's) fit under the caps; a phone's tiles plus its 4k envelope stay near 2 MiB.
  assert.ok(tenvBytes(250, TENV_N.desktop) <= TENV_BYTES_CAP.desktop && tenvBytes(111, TENV_N.low) <= TENV_BYTES_CAP.low)
  const capped = rig(false, 2000)
  capped.add(1999, 0, 36, 18, 1)
  capped.quietGap(); capped.settle()
  assert.equal(builds(capped.draws).length, 0, 'a layer past the cap is never built')
}

// ---- The shader: the build pass runs the Moon pass's tile march with the CPU twin's constants; the read decodes the same; legacy and the 4k-only variants carry none of it.
{
  const src = tileEnvelopeFragment(180, 4096, 0)
  assert.ok(src.includes(`for (int a = 0; a < ${TENV_DEFAULT.az}; a++)`) && src.includes(`for (int k = 0; k < ${TENV_DEFAULT.points.length}; k++)`))
  assert.ok(src.includes('gTileMarch = 1.0;') && src.includes('horizonDegT(p, cos(ang) * e + sin(ang) * nn, h0, uTenvLevel, lodG)') && src.includes('out uvec4 fragColor;'))
  assert.ok(!/\buS\b/.test(src), 'the tile envelope does not depend on the Sun')
  const m = /codes\[s\] = uint\(m > gHzStopDeg \? 255\.0 : clamp\(ceil\(\(m \+ ([\d.]+) - \((-?[\d.]+)\)\) \/ ([\d.]+)\) \+ 1\.0, 1\.0, 255\.0\)\);/.exec(src)
  assert.ok(m, 'code formula present')
  assert.equal(Number(m![1]), TENV_DEFAULT.margin); assert.equal(Number(m![2]), ENV_OFF_DEG); assert.equal(Number(m![3]), ENV_Q_DEG)
  assert.ok(src.includes(`float gHzStopDeg = ${TENV_STOP_DEG.toFixed(1)};`))
  for (let best = -3; best < 35; best += 0.137) assert.ok(envDecode(envEncode(best + TENV_DEFAULT.margin)) >= best + TENV_DEFAULT.margin - 1e-9)
  assert.ok(tileEnvelopeFragment(180, 4096, -3).includes('lvScale(uTenvLevel)'), 'deeper sets use the deeper level scale')
  const fixed = moonFragment(180, 4096, '', true, null, false, 0, false, undefined, false, false, true)
  assert.ok(fixed.includes('uniform highp usampler2DArray uTileEnv;') && fixed.includes('float tileEnvMax(vec2 uvp, int lm, vec3 p, vec3 t) {') && fixed.includes('float horizonBound(vec3 p, vec3 t, float lod, float lodT) {'))
  assert.ok(fixed.includes('float hb = horizonBound(p, t, lod, lodT);') && fixed.includes('if (ghSunElev(p) - hb > ghCert() + 2.0) { return hb; }'), 'the Sun march is skipped when the Sun clears the combined bound')
  assert.ok(fixed.includes('tc.a < 0.999') && fixed.includes('>= sz.z'), 'only a fully faded tile with a layer inside the array is read')
  assert.ok(fixed.includes('return mix(em, te, w)') || fixed.includes('mix(em, te, w)'), 'between, the mix horizonAt forms')
  const noTiles = moonFragment(180, 4096, '', false, null, false, 0, false, undefined, false, false, true)
  assert.ok(!noTiles.includes('uTileEnv') && !noTiles.includes('horizonBound'), 'no tile envelope without tiles')
  const legacy = moonFragment(180, 4096, '', true, null, false, 0, false)
  assert.ok(!legacy.includes('uTileEnv') && !legacy.includes('horizonBound') && !legacy.includes('uTenvOn'))
  // The serve view knows the new categories.
  const keys = SERVE_CATEGORIES.map((c) => c.key)
  for (const k of ['tileEnvNone', 'tileEnvGated', 'tileEnvelopeLit']) assert.ok(keys.includes(k), k)
  assert.equal(new Set(SERVE_CATEGORIES.map((c) => c.code)).size, SERVE_CATEGORIES.length)
  for (const c of SERVE_CATEGORIES) assert.equal(SERVE_CATEGORIES[classifyServePixel(...[0, 1, 2].map((i) => Math.round(255 * Math.pow(c.rgb[i], 1 / 2.2))) as [number, number, number])]?.key, c.key, `palette entry ${c.key} classifies as itself`)
  const sh = serveShares({ tileEnvelopeLit: 6, tileEnvNone: 1, tileEnvGated: 1, liveGate: 2 })
  assert.equal(sh.marchedShare, 0.4); assert.equal(sh.exactShare, 0.6)
}
console.log('tile envelope cache passed')
