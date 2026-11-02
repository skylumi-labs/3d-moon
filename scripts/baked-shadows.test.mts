import assert from 'node:assert/strict'
import { setFocusPull } from '../src/moon/tiles/focusPull.ts'
// The frozen shader text these checks guard is the switch-off one: the focus pull is on by default since 2026-10-31 and swaps the tile colour
// block (focus-pull.test.mts pins that variant and that everything after the colour block is the same text).
setFocusPull('?focuspull=0')
import { readFileSync } from 'node:fs'
import { moonFragment } from '../src/moon/moonShader.ts'
import { bakedSamplerFits, BAKED_CAP_BYTES, BAKED_SLOT_BYTES, contains, gridKey, horizonSlots, validateHorizonManifest, type HorizonManifest } from '../src/moon/baked/format.ts'
import { SHADOW_MODE_UNIFORM, getShadowMode, setShadowMode } from '../src/moon/shadowMode.ts'
import { _resetForTest, getQuality, parseSearch, parseStored, setBakedAvailability, setQuality } from '../src/quality/settings.ts'
import { applyShadowMode, shadowNeedsReload } from '../src/quality/apply.ts'
assert.equal(SHADOW_MODE_UNIFORM.baked, 3)
assert.deepEqual(parseSearch('?shadows=baked').explicit, { shadows: 'baked' }, 'Baked remains a URL-only internal benchmark mode')
assert.deepEqual(parseStored('{"shadows":"baked"}').explicit, {}, 'a retired Baked stored choice is ignored')
for (const cls of ['desktop', 'ios', 'phone-android']) {
  _resetForTest(); setBakedAvailability(cls, false)
  assert.equal(getQuality().shadows, 'full')
  setBakedAvailability(cls, true)
  assert.equal(getQuality().shadows, 'full', 'Baked is never a default in this build')
  setQuality({ preset: 'high' }); assert.equal(getQuality().shadows, 'full')
  setQuality({ preset: 'battery' }); assert.equal(getQuality().shadows, 'fast')
  setBakedAvailability(cls, false); assert.equal(getQuality().shadows, 'fast')
  setQuality({ shadows: 'baked' }); assert.equal(getQuality().shadows, 'baked', 'explicit mode survives missing data; shader falls back')
  setQuality({ shadows: 'off' }); setBakedAvailability(cls, true); assert.equal(getQuality().shadows, 'off')
}
applyShadowMode('baked'); assert.equal(getShadowMode(), 'baked'); assert.equal(shadowNeedsReload(), false)
applyShadowMode('full'); assert.equal(getShadowMode(), 'full'); setShadowMode('full')
for (const cap of Object.values(BAKED_CAP_BYTES)) {
  assert.ok(horizonSlots(cap, 2048) * BAKED_SLOT_BYTES <= cap)
  assert.ok(horizonSlots(cap, 256) * 16 <= 256)
}
assert.equal(horizonSlots(BAKED_SLOT_BYTES - 1, 256), 0)
const hash = 'a'.repeat(64)
const m: HorizonManifest = { version: 1, tileSize: 128, angleMax: 64, nearM: 128, biasM: .5, radiusM: 1737400, globalHash: hash, site: null,
  sources: [{ id: 'global', kind: 'global', directions: 32, bounds: [0, 0, 1, 1], dx: .001, dy: .001 }],
  tiles: [{ id: 'tile', source: 'global', file: 'tile.rgba8.gz', rect: [0, 0, .126, .126], bytes: 128 * 128 * 32, sha256: hash }] }
validateHorizonManifest(m)
for (const bad of [{ ...m, nearM: 64 }, { ...m, biasM: 0 }, { ...m, tiles: [{ ...m.tiles[0], bytes: 1 }] }, { ...m, tiles: [{ ...m.tiles[0], file: '../tile.rgba8.gz' }] }]) assert.throws(() => validateHorizonManifest(bad as HorizonManifest))
assert.ok(contains(m.tiles[0], .05, .05)); assert.ok(!contains(m.tiles[0], .126, .05))
const level = { name: 'L2', w: 100, h: 100, heights: 'L2.h.f16x2.gz', heightFormat: 'f16x2' as const, texelM: 8, texelEastM: 8, texelNorthM: 8, eastM: 0, northM: 0 }
assert.notEqual(gridKey(level, 0), gridKey({ ...level, w: 50, texelEastM: 16 }, 0), 'resampled ground cannot silently read original tables')
assert.notEqual(gridKey(level, 0), gridKey(level, 100), 'datum is part of source identity')
assert.notEqual(gridKey(level, 0), gridKey({ ...level, heights: 'mid-height.q16.gz', heightFormat: 'q16', heightStepM: 0.25 } as never, 0),
  'an f32 baked source does not claim compatibility with the q16 replacement')
const layout = [{ h: true, r: true, fadeM: 1596 }, { h: true, r: true, fadeM: 800, cache: true }]
for (const patch of [null, layout]) for (const depth of [0, -3]) {
  const shader = moonFragment(180, 4096, '', true, patch, false, depth, true, 'margin', true, true)
  assert.equal((shader.match(/float horizonSun\(/g) ?? []).length, 1)
  assert.equal((shader.match(/float gPshHit =/g) ?? []).length, 1)
  assert.match(shader, /j <= 32/)
  assert.match(shader, /128\.0 \* float\(j\) \/ 32\.0/)
  assert.match(shader, /\+ 0\.5;/)
  assert.match(shader, /smoothstep\(-0\.267, 0\.267, elevS - gBakedHorizon\)/)
  assert.match(shader, /horizonAt\(p, t, lod, lodT\) : -90\.0/)
  assert.doesNotMatch(shader, /uniform highp sampler2D uPSC|uniform highp sampler2DArray uTileS/)
  if (patch) assert.match(shader, /valid = patchEdge/)
}
const fixture = JSON.parse(readFileSync(new URL('./fixtures/baked-shader.json', import.meta.url), 'utf8'))
assert.equal(moonFragment(180, 4096, '', true, layout, false, -3, false, 'margin', false, true), fixture.patch)
console.log('baked-shadows: modes, defaults, cap, manifest, coverage and shader fixture passed')

const fullBudget = Array.from({ length: 5 }, () => ({ h: true, r: true, fadeM: 40 }))
assert.equal(bakedSamplerFits(fullBudget, 16), false, '16-unit full patch keeps its detail and falls back to Fast')
const spareUnit = fullBudget.map((l, i) => ({ ...l, r: i !== 4 }))
assert.equal(bakedSamplerFits(spareUnit, 16), true)
const maxShader = moonFragment(180, 4096, '', true, spareUnit, false, -3, false, 'margin', false, true)
assert.equal([...maxShader.matchAll(/uniform\s+(?:highp\s+)?sampler(?:2DArray|2D)\s+\w+/g)].length, 16)
