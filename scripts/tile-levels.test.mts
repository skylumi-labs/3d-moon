// The tile ladder is not hard-wired to three levels (TILE-CONTRACT.md 1b): geometry, want choice, and the generated GLSL.
import assert from 'node:assert/strict'
import { setFocusPull } from '../src/moon/tiles/focusPull.ts'
// The frozen shader text these checks guard is the switch-off one: the focus pull is on by default since 2026-10-31 and swaps the tile colour
// block (focus-pull.test.mts pins that variant and that everything after the colour block is the same text).
setFocusPull('?focuspull=0')
import { PAGE_H } from '../src/moon/tiles/grid.ts'
import { deeperPresent, deepestOf, finestWanted, ladder, levelRow, pageRows } from '../src/moon/tiles/levels.ts'
import { moonCoverFragment, moonFragment, tileDecls, tileMarchFn } from '../src/moon/moonShader.ts'

// The three-level path is the fallback: nothing changes without a deeper block.
assert.deepEqual(ladder(0), [2, 1, 0])
assert.equal(pageRows(0), PAGE_H)
assert.equal(deepestOf(undefined), 0)
assert.equal(finestWanted(10, 0.4738, 2, 0), 3, 'a coarse footprint wants no tile')
assert.equal(finestWanted(0.5, 0.4738, 2, 0), 0)
assert.equal(finestWanted(0.4, 0.4738, 2, -3), -1, 'with deeper levels a 0.4 km footprint is served by -1')
assert.equal(finestWanted(0.001, 0.4738, 2, -3), -3, 'never finer than the deepest level present')
// Deeper ladder and page-table rows (grid.ts deeperRowOffset: -1 at 63, -2 at 135, -3 at 279).
assert.deepEqual(ladder(-3), [2, 1, 0, -1, -2, -3])
assert.deepEqual([0, 1, 2, -1, -2, -3].map(levelRow), [0, 36, 54, 63, 135, 279])
assert.equal(pageRows(-3), 279 + 288)
// Presence: plain string and run-length.
const e = { level: -3, tileDeg: 0.625, ppd: 512, texelKm: 0.0592 }
assert.equal(deeperPresent({ ...e, present: '0101' }, 1), true)
assert.equal(deeperPresent({ ...e, present: '0101' }, 2), false)
assert.equal(deeperPresent({ ...e, presentRle: [[10, 5]] }, 12), true)
assert.equal(deeperPresent({ ...e, presentRle: [[10, 5]] }, 15), false)
assert.equal(deepestOf([{ ...e, level: -1 }, e, { ...e, level: -9 }]), -3)

// GLSL: every level of the ladder is sampled, weighted, mixed into the slope and read by the shadow march; 0 deeper = the old three.
const frag0 = moonFragment(180, 4096, '', true, null, false, 0)
const frag3 = moonFragment(180, 4096, '', true, null, false, -3)
for (const n of ['tn1', 'tn2', 'tn3', 'wn3']) { assert.ok(frag3.includes(n), `${n} missing at depth -3`); assert.ok(!frag0.includes(`${n} `) && !frag0.includes(`${n},`), `${n} present at depth 0`) }
assert.ok(frag3.includes('tileAt(uv, -3)') && frag3.includes('tileSlopeFiltered(tn3, -3, cosLatT, uv, normalSpan, normalRatio)'))
assert.ok(!frag0.includes('tileAt(uv, -1)'))
assert.ok(frag3.includes('const int TL_MIN = -3;') && !frag0.includes('TL_MIN'))
assert.ok(tileMarchFn(-3).includes('for (int l = max(TL_MIN, lmin); l < 3; l++)'), 'the march starts at the first level that can matter, not at the deepest')
// The tileDecls argument is real: a depth-0 shader carries no deeper rows, a depth -3 one carries all of them (-3 was checked by name before; the argument was ignored).
assert.ok(!tileDecls(0).includes('l == -3') && !tileDecls(-1).includes('l == -2') && tileDecls(-3).includes('l == -3 ? 279'), 'tileDecls takes the depth')
assert.ok(!frag0.includes('l == -1'), 'the depth-0 fragment has no deeper page rows')
// The page rows in the shader are the JS ones, for every level.
for (const [l, r] of [[1, 36], [-1, 63], [-2, 135], [-3, 279]]) assert.ok(tileDecls(-3).includes(`l == ${l} ? ${r}`), `row of level ${l}`)
assert.ok(tileDecls(-3).includes('int row = l == -3 ? 279 : (l == -2 ? 135 : (l == -1 ? 63 : (l == 0 ? 0 : (l == 1 ? 36 : (54)))))') || /int row = l == -3 \? 279/.test(tileDecls(-3)), 'row chain')
// Deeper tiles are heights only: colour is the three built levels' at every depth (no deeper colour, no baked-sun ratio).
assert.ok(!/tileColor\(tn/.test(frag3) && !/tileColorBaked/.test(frag3) && !/\.col\b/.test(frag3), 'no deeper colour in the shader')
assert.ok(/tileColor\(t0, 0, gx, gy\)/.test(frag3), 'the built levels still carry colour')
// Per-tile mid height and feather (page table .z, .w): applied in tileAt/tileH of the deep variant only.
assert.ok(tileDecls(-3).includes('+ t.off;') && tileDecls(-3).includes('tileFeather(fr, m)') && !tileDecls(0).includes('t.off'))
// The cover pass is the same depth as the shade pass (P1-1): the two cannot disagree on the skyline.
const cover3 = moonCoverFragment(180, 4096, null, -3), cover3p = moonCoverFragment(180, 4096, [{ h: true, r: false, fadeM: 10 }], -3)
for (const [name, g] of [['frag', frag3], ['cover', cover3], ['coverPatch', cover3p], ['fragPatch', moonFragment(180, 4096, '', true, [{ h: true, r: false, fadeM: 10 }], false, -3)]] as const) {
  assert.deepEqual(g.match(/const int TL_MIN = -?\d+;/g), ['const int TL_MIN = -3;'], `${name}: one TL_MIN, at the set's depth`)
  assert.ok(g.includes('l == -3 ? 279'), `${name}: carries the -3 page row`)
}
assert.ok(moonCoverFragment(180, 4096).includes('const int TL_MIN') === false, 'depth 0 cover has no TL_MIN (the base text)')
// The depth-0 production shaders are byte for byte the three-level ones:
// scripts/fixtures/moon-shader-depth0.json tracks the current default output.
import fs from 'node:fs'
{
  const gold = JSON.parse(fs.readFileSync(new URL('./fixtures/moon-shader-depth0.json', import.meta.url), 'utf8')) as Record<string, string>
  const layout = [{ h: true, r: true, fadeM: 40, shade: true }, { h: true, r: false, fadeM: 10 }]
  const now: Record<string, string> = {
    frag: moonFragment(180, 4096, '', true),
    fragPatch: moonFragment(180, 4096, '', true, layout),
    cover: moonCoverFragment(180, 4096),
    coverPatch: moonCoverFragment(180, 4096, layout),
    fragNoTiles: moonFragment(180, 4096, '', false),
  }
  for (const k of Object.keys(gold)) assert.ok(now[k] === gold[k], `${k}: the depth-0 shader changed from the three-level text (first difference at ${[...gold[k]].findIndex((c, i) => c !== now[k][i])})`)
  // Implicit and explicit production margin modes are identical at depth 0.
  assert.equal(moonFragment(180, 4096, '', true, null, false, 0), gold.frag)
  assert.equal(moonFragment(180, 4096, '', true, null, false, 0, false, 'margin'), gold.frag)
}
console.log('tile-levels ok')

// Prefetch along a planned path: path order kept, deepest wanted level first per point, coarse fallbacks after it.
import { pathTargets } from '../src/moon/tiles/levels.ts'
import { tilesFor } from '../src/net/prefetch.ts'
{
  const t = pathTargets([{ lon: 0, lat: 0, footprintKm: 5 }, { lon: 1, lat: 0, footprintKm: 0.4 }, { lon: 2, lat: 0, footprintKm: 0.001 }], 0.4738, 2, -3)
  assert.deepEqual(t.map((x) => x.lon), [0, 1, 2])
  assert.deepEqual(t[0].levels, [2], 'a far point warms only the coarsest tile')
  assert.deepEqual(t[1].levels, [-1, 0, 1, 2])
  assert.deepEqual(t[2].levels, [-3, -2, -1, 0, 1, 2])
  assert.deepEqual(pathTargets([{ lon: 0, lat: 0, footprintKm: 0.001 }], 0.4738, 2, 0)[0].levels, [0, 1, 2], 'no deeper block: the built levels')
  const man = { present: ['1'.repeat(2592), '1'.repeat(648), '1'.repeat(162)], deeper: [{ level: -1, tileDeg: 2.5, ppd: 128, texelKm: 0.237, present: '1'.repeat(144 * 72) }] }
  const ks = tilesFor(man, { lon: 10, lat: 10, levels: [-1, -2, 0] })
  assert.deepEqual(ks.map((k) => k.level), [0, -1], 'a level the manifest lacks (-2) is skipped, order coarse to fine')
}
console.log('tile-levels prefetch ok')


// prefetchAlong's prefetcher: skips tiles the streamer holds, fetches in parallel, and bounds what it keeps.
import { PREFETCH_HELD_MAX, PREFETCH_PARALLEL, TilePrefetcher, forgetManifests } from '../src/net/prefetch.ts'
{
  forgetManifests()
  const present = '1'.repeat(576 * 288)
  const man = { present: ['1'.repeat(2592), '1'.repeat(648), '1'.repeat(162)], deeper: [{ level: -3, tileDeg: 0.625, ppd: 512, texelKm: 0.0592, present }] }
  let active = 0, peak = 0
  const asked: string[] = []
  const fetchImpl = (async (url: string) => {
    if (url.endsWith('manifest.json')) return { ok: true, json: async () => man }
    asked.push(url); active++; peak = Math.max(peak, active)
    await new Promise((r) => setTimeout(r, 5))
    active--
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }
  }) as unknown as typeof fetch
  const pf = new TilePrefetcher('/pf/', fetchImpl)
  const path = Array.from({ length: 400 }, (_, i) => ({ lon: 20 + i * 0.3, lat: 0.5, footprintKm: 0.001 }))
  const resident = (l: number, tx: number, ty: number): boolean => l === -3 && tx === 320 && ty === 143   // the tile under the first point
  await pf.prefetch(pathTargets(path, 0.4738, 2, -3), undefined, resident)
  assert.ok(!asked.some((u) => u.includes('h/-3/320_143')), 'a tile the streamer already holds is not fetched again')
  assert.ok(!asked.some((u) => u.includes('/c/-')), 'deeper levels are heights only')
  assert.ok(peak > 2 && peak <= 2 * PREFETCH_PARALLEL, `fetches overlapped (${peak} files at once, ${PREFETCH_PARALLEL} tiles)`)
  assert.ok(pf.heldCount <= PREFETCH_HELD_MAX && pf.stats.dropped > 0, `held ${pf.heldCount} of at most ${PREFETCH_HELD_MAX}, dropped ${pf.stats.dropped}`)
}
console.log('tile-levels prefetcher ok')

// The relief store's key is unique over every level the grid allows, -4 included (it was hard-wired to the -3 page width, so (ty, tx >= 576)
// at -4 collided with (ty + 1, tx - 576) and a remove deleted another tile's summary).
import { ReliefStore } from '../src/moon/tiles/relief.ts'
{
  const r = new ReliefStore()
  r.add(-4, 576, 5, new Float32Array(1)); r.add(-4, 0, 6, new Float32Array(1))
  assert.equal(r.size, 2, 'two tiles, two keys')
  r.remove(-4, 0, 6)
  assert.equal(r.size, 1, 'removing one leaves the other')
  r.add(-3, 575, 100, new Float32Array(1)); r.add(-4, 1150, 200, new Float32Array(1)); r.add(0, 71, 35, new Float32Array(1))
  assert.equal(r.size, 4)
}
console.log('tile-levels relief key ok')
