// What a memory warning frees: the tile rebuild size, the patch drop and the order of the warning steps (quality/pressure.ts).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { pressureStep, tileRebuildLayers, WARNING_STEPS, type PressureState, type TileFit } from '../src/quality/pressure.ts'

const MB = 1048576
const fit = (o: Partial<TileFit> = {}): TileFit => ({ current: 48, want: 48, ceiling: 255 * MB, ledgerTotal: 200 * MB, tilesBytes: 50 * MB, reserveBytes: 160 * MB, pairBytes: 1.05 * MB, minLayers: 8, ...o })

test('the rebuild asks for fewer layers only when the lowered ceiling cannot hold the current ones', () => {
  assert.equal(tileRebuildLayers(fit({ ceiling: 400 * MB })), null, 'plenty of room: keep')
  const n = tileRebuildLayers(fit({ ceiling: 200 * MB }))
  // headroom = 200 - (200 - 50) - 160 < 0 -> the minimum
  assert.equal(n, 8)
  const m = tileRebuildLayers(fit({ ceiling: 320 * MB }))
  assert.equal(m, Math.floor((320 - 150 - 160) * MB / (1.05 * MB)))
  assert.ok(m !== null && m < 48 && m > 8)
})

test('the rebuild never goes under the minimum, never above want, and a missing ceiling means no rebuild', () => {
  assert.equal(tileRebuildLayers(fit({ ceiling: 0 })), 8)
  assert.equal(tileRebuildLayers(fit({ current: 8, ceiling: 0 })), null, 'already at the minimum')
  assert.equal(tileRebuildLayers(fit({ ceiling: Infinity })), null, 'desktop: no ceiling')
  assert.equal(tileRebuildLayers(fit({ current: 100, want: 48, ceiling: 1000 * MB })), 48, 'the fit is capped at want')
})

const st = (o: Partial<PressureState> = {}): PressureState => ({ tilesReady: true, tilesShrinkable: true, patchReady: false, overCeiling: true, awayFromPatch: false, busy: false, ...o })

test('a busy view releases nothing and stays pending', () => {
  assert.deepEqual(pressureStep(st({ busy: true })), { tiles: false, patch: false, done: false })
})

test('a calm view rebuilds the tiles', () => {
  assert.deepEqual(pressureStep(st()), { tiles: true, patch: false, done: true })
})

test('the patch is dropped only away from the site, and only while over the ceiling', () => {
  assert.deepEqual(pressureStep(st({ tilesShrinkable: false, patchReady: true })), { tiles: false, patch: false, done: false }, 'near the site: wait')
  assert.deepEqual(pressureStep(st({ tilesShrinkable: false, patchReady: true, awayFromPatch: true })), { tiles: false, patch: true, done: true })
  assert.deepEqual(pressureStep(st({ tilesShrinkable: false, patchReady: true, overCeiling: false })), { tiles: false, patch: false, done: true }, 'under the ceiling: keep the patch')
})

test('nothing releasable ends the pending release', () => {
  assert.deepEqual(pressureStep(st({ tilesReady: false })), { tiles: false, patch: false, done: true })
  assert.deepEqual(pressureStep(st({ tilesShrinkable: false })), { tiles: false, patch: false, done: true })
})

test('the warning steps keep their order: the baked horizon is rebuilt after it is released, at the lowered ceiling', () => {
  assert.deepEqual([...WARNING_STEPS], ['lowerCeiling', 'disposeBaked', 'configureBaked', 'refreshReduced'])
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const block = main.match(/nativeHost\?\.onMemoryWarning\(\(\) => \{([\s\S]*?)\n\}\)/)
  assert.ok(block, 'the warning handler exists')
  const at = (needle: string): number => block[1].indexOf(needle)
  const order = [at('handleMemoryWarning(quality)'), at('moon?.disposeBaked()'), at('moon?.configureBaked(renderer, quality.detected.cls, quality.ceilingBytes'), at('refreshReduced()')]
  assert.ok(order.every((i) => i >= 0), 'every step is present')
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'in order')
  assert.match(block[1], /memoryPressure = /, 'the release is armed')
})
