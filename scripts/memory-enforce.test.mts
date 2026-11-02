// Memory ceiling enforcement (R54, W3-M1): the ledger arithmetic per class at the A17 pose, the overrun detector and the shed order.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  CANVAS_CSS, OVERRUN_COOLDOWN_MS, OVERRUN_HOLD_MS, PATCH_DEFAULT_BYTES, PATCH_MIN_BYTES, SAFETY_BYTES, a17Estimate, earthBytes, layersToFit, newOverrunWatch,
  overrunPoll, patchCapFor, shedPlan, sum, type ShedState,
} from '../src/quality/enforce.ts'
import { CLASS_TABLE, QUALITY_CLASSES, type QualityClass } from '../src/quality/startupClass.ts'

const MB = 1048576
const estimateFor = (cls: QualityClass): number => {
  const p = CLASS_TABLE[cls]
  const [w, h] = CANVAS_CSS[cls]
  return sum(a17Estimate({ canvasW: Math.round(w * p.dprCap), canvasH: Math.round(h * p.dprCap), targetSets: p.targetSets, tiles: p.tiles, tc: p.tc, lmShadowRes: p.lmShadowRes, earthWidth: 2048 }))
}

test('the Earth maps: four 2048x1024 maps with mips (one RGBA8, three R8) plus the LUTs', () => {
  assert.equal(Math.round(earthBytes(2048) / MB), 20)
  assert.ok(earthBytes(1024) < earthBytes(2048) / 3)
})

test('every class with a ceiling: the A17 estimate plus the patch cap plus the safety margin stays under the ceiling', () => {
  for (const cls of QUALITY_CLASSES) {
    const p = CLASS_TABLE[cls]
    if (!Number.isFinite(p.ceilingBytes)) continue
    const cap = p.patchResidentBytes ?? PATCH_DEFAULT_BYTES
    assert.ok(estimateFor(cls) + cap + SAFETY_BYTES <= p.ceilingBytes, `${cls}: ${(estimateFor(cls) / MB).toFixed(0)} + ${cap / MB} + ${SAFETY_BYTES / MB} over ${p.ceilingBytes / MB} MB`)
  }
})

test('the class rows are the arithmetic: patchResidentBytes equals patchCapFor, or the layer default when that is the answer', () => {
  for (const cls of ['ios', 'ipad', 'phone-android', 'tablet', 'software'] as const) {
    const p = CLASS_TABLE[cls]
    const want = patchCapFor(p.ceilingBytes, estimateFor(cls))
    assert.equal(p.patchResidentBytes ?? PATCH_DEFAULT_BYTES, want, cls)
  }
  assert.equal(CLASS_TABLE.ios.patchResidentBytes, 48 * MB)
  assert.equal(CLASS_TABLE.ipad.patchResidentBytes, 136 * MB)
  assert.equal(CLASS_TABLE.desktop.patchResidentBytes, undefined, 'no ceiling: no cap')
})

test('patchCapFor: rounds down to 8 MB, floors at the smallest useful patch, never above the layer default', () => {
  assert.equal(patchCapFor(Infinity, 0), PATCH_DEFAULT_BYTES)
  assert.equal(patchCapFor(300 * MB, 200 * MB), 80 * MB, '300 - 200 - 16 = 84 MB, rounded down to 80')
  assert.equal(patchCapFor(300 * MB, 400 * MB), PATCH_MIN_BYTES)
  assert.equal(patchCapFor(2000 * MB, 100 * MB), PATCH_DEFAULT_BYTES)
})

test('overrun: needs the hold, resets under the ceiling, and waits out the cooldown', () => {
  const w = newOverrunWatch()
  const C = 255 * MB
  assert.equal(overrunPoll(w, 0, C + 1, C), false, 'first sight starts the clock')
  assert.equal(overrunPoll(w, OVERRUN_HOLD_MS - 1, C + 1, C), false)
  assert.equal(overrunPoll(w, 500, C, C), false, 'back at the ceiling: reset')
  assert.equal(w.since, null)
  assert.equal(overrunPoll(w, 1000, C + 1, C), false)
  assert.equal(overrunPoll(w, 1000 + OVERRUN_HOLD_MS, C + 1, C), true, 'held long enough')
  assert.equal(overrunPoll(w, 1000 + OVERRUN_HOLD_MS + 1, C + 1, C), false)
  assert.equal(overrunPoll(w, 1000 + OVERRUN_HOLD_MS + 1 + OVERRUN_HOLD_MS, C + 1, C), false, 'inside the cooldown')
  assert.equal(overrunPoll(w, 1000 + OVERRUN_HOLD_MS + OVERRUN_COOLDOWN_MS, C + 1, C), true, 'cooldown over')
  assert.equal(overrunPoll(newOverrunWatch(), 1e9, 1e12, Infinity), false, 'no ceiling, no overrun')
})

const st = (o: Partial<ShedState> = {}): ShedState => ({
  total: 300 * MB, ceiling: 255 * MB, patchBytes: 60 * MB, patchReady: true, awayFromPatch: true,
  tilesReady: true, tilesBytes: 50 * MB, tileLayers: 48, minLayers: 8, pairBytes: 1.05 * MB, busy: false, ...o,
})

test('shed order: an off-screen patch goes first, and the tiles stay when that is enough', () => {
  const p = shedPlan(st())
  assert.deepEqual(p.steps, ['patch'])
  assert.equal(p.tileLayers, null)
  assert.equal(p.projected, 240 * MB)
  assert.equal(p.fits, true)
})

test('shed order: tiles are rebuilt only to the room that is left, after the patch', () => {
  const p = shedPlan(st({ total: 330 * MB }))
  assert.deepEqual(p.steps, ['patch', 'tiles'])
  // 330 - 60 = 270 over by 15 MB: keep floor((255 - (270 - 50)) / 1.05) = 33 layers
  assert.equal(p.tileLayers, Math.floor(35 * MB / (1.05 * MB)))
  assert.ok(p.fits)
  assert.ok(p.tileLayers! >= 8 && p.tileLayers! < 48)
})

test('shed order: a patch the camera is near (on screen) is never dropped; the tiles give way instead', () => {
  const p = shedPlan(st({ awayFromPatch: false }))
  assert.deepEqual(p.steps, ['tiles'])
  assert.ok(!p.steps.includes('patch'))
  assert.equal(p.tileLayers, 8, '300 - 50 + 8 layers is still over: the floor holds')
  assert.equal(p.fits, false)
})

test('shed order: busy releases nothing; under the ceiling releases nothing; no patch and no tiles releases nothing', () => {
  assert.deepEqual(shedPlan(st({ busy: true })).steps, [])
  assert.deepEqual(shedPlan(st({ total: 255 * MB })).steps, [])
  const none = shedPlan(st({ patchReady: false, tilesReady: false }))
  assert.deepEqual(none.steps, [])
  assert.equal(none.fits, false)
})

test('the tile floor holds: the rebuild never goes under minLayers, and a cache already at the floor is left alone', () => {
  assert.equal(layersToFit(500 * MB, 50 * MB, 255 * MB, 1.05 * MB, 8), 8)
  assert.deepEqual(shedPlan(st({ awayFromPatch: false, total: 500 * MB, tileLayers: 8 })).steps, [])
})

test('deterministic: the same state gives the same plan', () => {
  assert.deepEqual(shedPlan(st({ total: 330 * MB })), shedPlan(st({ total: 330 * MB })))
})

test('main.ts wires the plan in the order the plan returns: patch dropped before the tiles are released, behind ?memcap, with a telemetry counter', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const fn = main.match(/function enforceMemory\(now: number\): void \{([\s\S]*?)\n\}\n/)
  assert.ok(fn, 'enforceMemory exists')
  assert.ok(fn[1].indexOf('dropPatch()') > 0 && fn[1].indexOf('dropPatch()') < fn[1].indexOf('releaseTiles(false)'), 'patch first')
  assert.match(fn[1], /if \(!memcapOn/, '?memcap=0 turns it off')
  assert.match(fn[1], /if \(busy\) return/, 'a busy view waits')
  assert.match(main, /memoryShed: \(\) =>/)
})

test('?memcap=0 restores the class rows: the website profile loses its patch cap', () => {
  const rt = readFileSync(new URL('../src/quality/runtime.ts', import.meta.url), 'utf8')
  assert.match(rt, /memcapOff\(init\.search\) \? \{ \.\.\.webProfile, patchResidentBytes: undefined \}/)
  assert.match(rt, /export const memcapOff = \(search: string\): boolean => new URLSearchParams\(search\)\.get\('memcap'\) === '0'/)
})
