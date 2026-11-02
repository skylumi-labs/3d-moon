// JAXA TC detail client (on by default from the live base, `?tc=off` / `?tc=<base>`): URL params, manifest validation, weights, mixing over WAC, patch cut-out, page geometry, credits row,
// shader variants (OFF text carries nothing of it), and that DEEPEST_LEVEL -5 changes nothing for a viewer with `?tc=off`.
import assert from 'node:assert/strict'
import { detailTexelKm } from '../src/moon/tiles/detail.ts'
import { DEEPEST_LEVEL, levelNx, levelNy } from '../src/moon/tiles/grid.ts'
import { deepestOf, ladder, finestWanted } from '../src/moon/tiles/levels.ts'
import {
  DEFAULT_TC_BASE, DEFAULT_TC_GAIN, TC_CREDIT, TC_LEVELS, TC_PAGE_H, TC_PAGE_W, TC_ROW, tcBase, tcGain, tcLog2, tcMixLog2, tcSourceAt, tcWeight, validateTcManifest,
} from '../src/moon/tiles/tcDetail.ts'
import { CREDIT_CATALOG, selectCredits, type CreditsContext } from '../src/ui/credits.ts'
import { TcStreamer } from '../src/moon/tiles/TcStreamer.ts'
import { moonFragment, type PatchLayout } from '../src/moon/moonShader.ts'

const near = (a: number, b: number, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`)

// URL params: default OFF, trailing slash, off words, gain clamp.
assert.equal(DEFAULT_TC_BASE, '', 'no VITE_MOON_TC, no layer (the publish scripts bake the live base)'); assert.equal(tcBase(''), null); assert.equal(tcBase('?tcgain=2'), null); assert.equal(tcBase('?tc='), null); assert.equal(tcBase('?tc=off'), null); assert.equal(tcBase('?tc=0'), null)
assert.equal(tcBase('?tc=http://127.0.0.1:5190/moon/tc-staging/v0'), 'http://127.0.0.1:5190/moon/tc-staging/v0/'); assert.equal(tcBase('?tc=http://localhost:5195/tc/'), 'http://localhost:5195/tc/'); assert.equal(tcBase('?tc=https://x.test/tc/'), null, 'a foreign origin is refused')
assert.equal(tcGain(''), 1.5); assert.equal(DEFAULT_TC_GAIN, 1.5); assert.equal(tcGain('?tc=off'), 1.5); assert.equal(tcGain('?tcgain=2.5'), 2.5); assert.equal(tcGain('?tcgain=99'), 8); assert.equal(tcGain('?tcgain=-1'), 0); assert.equal(tcGain('?tcgain=x'), 1.5); assert.equal(tcGain('?tcgain=1'), 1); assert.equal(tcGain('?tcgain=0'), 0)

// Page geometry: three levels stacked, each fits, rows do not overlap.
assert.equal(TC_PAGE_W, levelNx(-5)); assert.equal(TC_PAGE_H, levelNy(-3) + levelNy(-4) + levelNy(-5))
assert.equal(TC_ROW[-4], levelNy(-3)); assert.equal(TC_ROW[-5], levelNy(-3) + levelNy(-4))
assert.ok(TC_LEVELS.every((l) => levelNx(l) <= TC_PAGE_W))

// Manifest validation.
const good = { version: 1, format: 'webp-u8-ratio', mid: 128, perOctave: 100, levels: [{ level: -5, nx: 2304, ny: 1152, presentRle: [[10, 3], [20, 1]] }, { level: -3, nx: 576, ny: 288, presentRle: [[0, 1]] }] }
const ok = validateTcManifest(good)
assert.ok(ok); assert.equal(ok!.levels.length, 2); assert.equal(ok!.perOctave, 100)
for (const bad of [null, [], { ...good, version: 2 }, { ...good, format: 'png' }, { ...good, perOctave: 0 },
  { ...good, levels: [{ level: -2, nx: 288, ny: 144, presentRle: [[0, 1]] }] },
  { ...good, levels: [{ level: -5, nx: 1152, ny: 1152, presentRle: [[0, 1]] }] },
  { ...good, levels: [{ level: -5, nx: 2304, ny: 1152, presentRle: [[5, 3], [6, 1]] }] },
  { ...good, levels: [{ level: -5, nx: 2304, ny: 1152, presentRle: [[2304 * 1152 - 1, 2]] }] },
  { ...good, levels: [{ level: -5, nx: 2304, ny: 1152, presentRle: [[0, 1]] }, { level: -5, nx: 2304, ny: 1152, presentRle: [[0, 1]] }] }]) {
  assert.equal(validateTcManifest(bad), null)
}

// Decode and weights.
near(tcLog2(128, 128, 100), 0); near(tcLog2(228, 128, 100), 1); near(tcLog2(228, 128, 100, 2), 2); assert.equal(tcLog2(0, 128, 100), 0)
near(detailTexelKm(-5), detailTexelKm(0) / 32); near(detailTexelKm(-5) * 1000, 12.47, 0.05)
near(tcWeight(-5, detailTexelKm(-5), 1, 1, 0), 1); near(tcWeight(-5, 2 * detailTexelKm(-5), 1, 1, 0), 0)
near(tcWeight(-5, 0.001, 0.5, 1, 0), 0.5); near(tcWeight(-5, 0.001, 1, 0, 0), 0); near(tcWeight(-5, 0.001, 1, 1, 85), 0)
// Inside a patch the TC detail is gone, fully covered or not.
near(tcWeight(-5, 0.001, 1, 1, 0, 1), 0); near(tcWeight(-5, 0.001, 1, 1, 0, 0.25), 0.75)
// Mixing: no TC leaves WAC; a full-weight level replaces it; coarse to fine.
near(tcMixLog2(0.3, []), 0.3); near(tcMixLog2(0.3, [{ log2: -0.2, w: 0 }]), 0.3); near(tcMixLog2(0.3, [{ log2: -0.2, w: 1 }]), -0.2)
near(tcMixLog2(0.3, [{ log2: 1, w: 1 }, { log2: 2, w: 0.5 }]), 1.5)

// Credits: TC is named only when a TC tile can contribute; the line says the data was modified.
const entry = CREDIT_CATALOG.find((c) => c.id === 'jaxa-tc')
assert.ok(entry); assert.equal(entry!.credit, TC_CREDIT); assert.match(TC_CREDIT, /ISAS\/JAXA/); assert.match(TC_CREDIT, /modified/)
const ctx: CreditsContext = { moonVisible: true, lunarTilesVisible: true, polarWacVisible: false, sitePatchVisible: null, apollo17TierVisible: false, apollo17FlightVisible: false, lunarModuleVisible: false, earthVisible: false, starsVisible: false }
assert.ok(!selectCredits(ctx).has('jaxa-tc')); assert.ok(!selectCredits({ ...ctx, jaxaTcVisible: false }).has('jaxa-tc'))
assert.ok(selectCredits({ ...ctx, jaxaTcVisible: true }).has('jaxa-tc')); assert.ok(!selectCredits({ ...ctx, moonVisible: false, jaxaTcVisible: true }).has('jaxa-tc'))

// tcSourceAt reads the RGBA8 page: an absent tile is no source, a resident faded one is.
const page = new Uint8Array(TC_PAGE_W * TC_PAGE_H * 4)
assert.equal(tcSourceAt(page, 23.47, 0.67, 0.01), false)
{
  const lon = 23.47, lat = 0.67, l = -5
  const tx = Math.floor(((lon + 180) / 360) * levelNx(l)), ty = Math.floor(((90 - lat) / 180) * levelNy(l))
  const o = 4 * ((TC_ROW[l] + ty) * TC_PAGE_W + tx)
  page[o] = 3; page[o + 1] = 0
  assert.equal(tcSourceAt(page, lon, lat, 0.01), false, 'a tile still at fade 0 is no source')
  page[o + 1] = 255
  assert.equal(tcSourceAt(page, lon, lat, 0.01), true)
  assert.equal(tcSourceAt(page, lon, lat, 0.05), false, 'a pixel spanning 4 texels has no TC')
}

// Camera floor: the finest TC texel listed under a point (Infinity where none), no GL needed.
{
  const lon = 23.47, lat = 0.67
  const idx = (l: number) => Math.floor(((90 - lat) / 180) * levelNy(l)) * levelNx(l) + Math.floor(((lon + 180) / 360) * levelNx(l))
  const stub = (levels: number[]) => Object.assign(Object.create(TcStreamer.prototype), { man: { levels: levels.map((l) => ({ level: l, nx: levelNx(l), ny: levelNy(l), presentRle: [[idx(l), 1]] })) } }) as TcStreamer
  near(stub([-3, -4, -5]).texelKmAt(lon, lat), detailTexelKm(-5)); near(stub([-3, -4]).texelKmAt(lon, lat), detailTexelKm(-4)); near(stub([-3]).texelKmAt(lon, lat), detailTexelKm(-3))
  assert.equal(stub([-5]).texelKmAt(lon + 10, lat), Infinity); assert.equal(stub([]).texelKmAt(lon, lat), Infinity)
}

// Shader: OFF carries nothing of TC; ON adds it to global tiles; patch variants retain site detail within the sampler budget.
const markers = ['uTcD', 'uTcPage', 'uTcK', 'tjLevel', 'float patchCov = 0.0']
const patch: PatchLayout = [{ h: true, r: true, fadeM: 60 }, { h: true, r: true, fadeM: 30 }]
for (const p of [null, patch] as const) {
  const off = moonFragment(180, 4096, '', true, p, false, -3, true)
  for (const m of markers) assert.ok(!off.includes(m), `OFF variant must not mention ${m}`)
  assert.equal(off, moonFragment(180, 4096, '', true, p, false, -3, true, undefined, false), 'tcDetail=false is the default')
  const on = moonFragment(180, 4096, '', true, p, false, -3, true, undefined, true)
  if (p) {
    for (const m of ['uTcD', 'uTcPage', 'uTcK', 'tjLevel', 'float patchCov = 0.0']) assert.ok(!on.includes(m), `patch variant omits optional global TC sampler and cut-out ${m}`)
  } else {
    for (const m of ['uTcD', 'uTcPage', 'uTcK', 'tjLevel']) assert.ok(on.includes(m), `global tile variant lacks ${m}`)
  }
  assert.equal(on.includes('float patchCov = 0.0'), false, 'patch variants omit TC coverage when global TC sampling is omitted')
}
assert.ok(!moonFragment(180, 4096, '', true, null, false, -3, false, undefined, true).includes('uTcD'), 'TC needs the WAC detail variant')

// DEEPEST_LEVEL -5 changes nothing for a set that does not list -4/-5: the deepest level, ladder, finest level and page rows follow the manifest.
assert.equal(DEEPEST_LEVEL, -5)
const live = [{ level: -1, tileDeg: 2.5, ppd: 128, texelKm: 0.2 }, { level: -2, tileDeg: 1.25, ppd: 256, texelKm: 0.1 }, { level: -3, tileDeg: 0.625, ppd: 512, texelKm: 0.05 }]
assert.equal(deepestOf(live), -3); assert.deepEqual(ladder(-3), [2, 1, 0, -1, -2, -3])
assert.equal(finestWanted(0.001, 0.4738, 2, -3), -3, 'the height streamer never asks for -4 or -5 on a -3 manifest')
console.log('tc-client.test: ok')

// No VITE_MOON_TC, no layer: no `?tc=` asks for nothing. Graceful when the manifest is missing: a 404, a network failure and an unreadable body
// at a named base all give null (layer off), never a throw.
{
  const realFetch = globalThis.fetch
  const asked: string[] = []
  const fakeGl = { getParameter: () => 2048, MAX_ARRAY_TEXTURE_LAYERS: 1 }
  const renderer = { getContext: () => fakeGl } as never
  const at = '?tc=http://localhost:5195/moon/tc/v3/'
  try {
    globalThis.fetch = (async (u: string) => { asked.push(String(u)); return new Response('nope', { status: 404 }) }) as typeof fetch
    assert.equal(await TcStreamer.create(renderer, undefined, ''), null)
    assert.deepEqual(asked, [], 'no ?tc= and no VITE_MOON_TC asks for nothing')
    assert.equal(await TcStreamer.create(renderer, undefined, at), null)
    assert.deepEqual(asked, ['http://localhost:5195/moon/tc/v3/tc.json'], 'a named base is asked for tc.json')
    globalThis.fetch = (async () => { throw new TypeError('network') }) as typeof fetch
    assert.equal(await TcStreamer.create(renderer, undefined, at), null)
    globalThis.fetch = (async () => new Response('{"version":2}', { status: 200 })) as typeof fetch
    assert.equal(await TcStreamer.create(renderer, undefined, at), null)
    asked.length = 0
    globalThis.fetch = (async (u: string) => { asked.push(String(u)); return new Response('', { status: 404 }) }) as typeof fetch
    assert.equal(await TcStreamer.create(renderer, undefined, '?tc=off'), null)
    assert.deepEqual(asked, [], '?tc=off asks for nothing')
  } finally { globalThis.fetch = realFetch }
}
