// Adaptive tile cache (W3-M5, quality/cachegrow.ts): the grow/shrink controller on injected clock and signals, the storage rules, the wiring pins.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  GROW_FIRST_MS, GROW_STEP, HEALTHY_FRAME_MS, REST_MS, SHED_HOLD_MS, SLOW_FRAME_MS, SLOW_HOLD_MS, RUNNING_KEY, SIZE_KEY,
  cachegrowOff, clearRunning, growPoll, learnSize, maxFor, newGrow, readRemembered, setRunning, startFromStorage, writeRemembered, type GrowSignals, type GrowState, type KV,
} from '../src/quality/cachegrow.ts'

const MB = 1048576
const PAIR = 1.05 * MB
/** Calm signals on a 255 MB phone: ledger 120 MB (tiles 50), a 48 MB patch cap with nothing loaded. */
const calm = (o: Partial<GrowSignals> = {}): GrowSignals => ({
  now: 200_000, visible: true, atRestMs: REST_MS + 1, busy: false, tilesReady: true, tilesBytes: 48 * PAIR, ledgerTotal: 120 * MB, ceilingBytes: 255 * MB, pairBytes: PAIR,
  patchRoomBytes: 48 * MB, contextLosses: 0, frameMs: 16, sessionMs: 200_000, shedCount: 0, ...o,
})
const fresh = (): GrowState => newGrow({ created: 48, max: 96, remembered: null, stale: false, now: 0 })
const seen = (): { n: number } => ({ n: 0 })

test('records one larger size per visit when every condition holds; the live size never changes', () => {
  const g = fresh(), sh = seen()
  const d = growPoll(g, calm(), sh)
  assert.deepEqual([d?.kind, d?.next], ['grow', 48 + GROW_STEP])
  assert.equal(g.size, 48, 'the live cache is not rebuilt')
  assert.equal(growPoll(g, calm({ now: 900_000, sessionMs: 900_000 }), sh), null, 'one record per visit')
  // The next visit starts at the recorded size and records one more, up to the cap.
  const kv = memKv()
  let size = 48
  for (let visit = 0; visit < 6; visit++) {
    const v = startFromStorage(kv, 'ios', 48, 96, 0)
    assert.equal(v.size, size)
    const r = growPoll(v, calm({ ledgerTotal: 80 * MB, tilesBytes: size * PAIR }), seen())
    if (r) { writeRemembered(kv, 'ios', r.next); size = r.next }
  }
  assert.equal(size, 96, 'grows a step per healthy visit and stops at the 2x cap')
  assert.equal(maxFor(48, 2048), 96)
  assert.equal(maxFor(48, 60), 60, 'the array-layer limit wins')
  // the ceiling stops it earlier on a fuller ledger (120 MB: 64 is the last step that leaves the headroom, as 80 would not)
  const g5 = newGrow({ created: 48, max: 96, remembered: 64, stale: false, now: 0 })
  assert.equal(growPoll(g5, calm({ tilesBytes: 64 * PAIR, ledgerTotal: 150 * MB }), seen()), null)
})

// Each blocker alone must stop the grow.
const blockers: Array<[string, Partial<GrowSignals>]> = [
  ['hidden page', { visible: false }],
  ['view busy', { busy: true }],
  ['not at rest long enough', { atRestMs: REST_MS - 1 }],
  ['tiles not ready', { tilesReady: false }],
  ['slow frames', { frameMs: HEALTHY_FRAME_MS + 1 }],
  ['no frame sample', { frameMs: 0 }],
  ['session too young', { sessionMs: GROW_FIRST_MS - 1 }],
  ['context loss seen', { contextLosses: 1 }],
  ['no room under the ceiling', { ledgerTotal: 200 * MB }],
  ['patch could still fill the ceiling', { patchRoomBytes: 140 * MB }],
  ['no ceiling (desktop)', { ceilingBytes: Infinity }],
]
for (const [name, o] of blockers) {
  test(`does not grow: ${name}`, () => {
    const g = fresh()
    const d = growPoll(g, calm(o), seen())
    assert.ok(d === null || d.kind === 'shrink', 'no larger size is recorded')
    assert.equal(g.next, 48)
    assert.equal(g.size, 48)
  })
}
test('does not record a larger size within the hold after a shed', () => {
  const g2 = fresh(), sh2 = seen()
  growPoll(g2, calm({ now: 200_000, shedCount: 1 }), sh2) // a shed arrives
  assert.equal(growPoll(g2, calm({ now: 200_000 + SHED_HOLD_MS - 1, shedCount: 1 }), sh2), null)
  assert.ok(growPoll(g2, calm({ now: 200_000 + SHED_HOLD_MS + 1, shedCount: 1, sessionMs: 600_000 }), sh2), 'records again after the hold')
})

test('shrinks at once on each pressure signal', () => {
  // context loss: back to the start size, growth off for the session
  const g = fresh(), sh = seen()
  g.size = 80; g.next = 80
  const d = growPoll(g, calm({ contextLosses: 1 }), sh)
  assert.deepEqual([d?.kind, d?.next, d?.reason], ['shrink', 48, 'context_loss'])
  assert.equal(g.size, 80, 'recorded only; no rebuild beyond the recovery that already happens')
  assert.equal(growPoll(g, calm({ now: 900_000, sessionMs: 900_000, contextLosses: 1 }), sh), null, 'no grow after a loss')
  // overrun shed: no second rebuild (the shed rebuilt already), growth held, reason recorded
  const g2 = fresh(), sh2 = seen()
  g2.size = 64; g2.next = 64
  assert.equal(growPoll(g2, calm({ shedCount: 1 }), sh2), null)
  learnSize(g2, 56, 200_000) // the shed rebuilt at 56 layers: the record follows it down
  assert.equal(g2.next, 56)
  assert.equal(g2.lastShrink, 'shed')
  assert.equal(g2.lastPressureAt, 200_000)
  // sustained slow frames: one step, never below the start
  const g3 = fresh(), sh3 = seen()
  g3.size = 64; g3.next = 64
  assert.equal(growPoll(g3, calm({ now: 1000, frameMs: SLOW_FRAME_MS + 5 }), sh3), null, 'one slow tick is not sustained')
  const d3 = growPoll(g3, calm({ now: 1000 + SLOW_HOLD_MS, frameMs: SLOW_FRAME_MS + 5 }), sh3)
  assert.deepEqual([d3?.kind, d3?.next, d3?.reason], ['shrink', 48, 'slow_frames'])
  const g4 = fresh()
  assert.equal(growPoll(g4, calm({ now: 1000, frameMs: 90 }), seen()), null)
  assert.equal(growPoll(g4, calm({ now: 1000 + SLOW_HOLD_MS, frameMs: 90 }), seen()), null, 'already at the start: nothing to shrink')
})

test('a healthy tick resets the slow clock', () => {
  const g = fresh(), sh = seen()
  g.size = 64; g.next = 64
  growPoll(g, calm({ now: 1000, frameMs: 90 }), sh)
  growPoll(g, calm({ now: 3000, frameMs: 16 }), sh)
  assert.equal(growPoll(g, calm({ now: 1000 + SLOW_HOLD_MS, frameMs: 90 }), sh), null)
})

// ---- storage

const memKv = (init: Record<string, string> = {}): KV & { m: Map<string, string> } => {
  const m = new Map(Object.entries(init))
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) }, removeItem: (k) => { m.delete(k) } }
}
const throwing: KV = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } }

test('remembers the last good size per class and starts there', () => {
  const kv = memKv()
  writeRemembered(kv, 'ios', 80)
  assert.equal(readRemembered(kv, 'ios'), 80)
  assert.equal(readRemembered(kv, 'ipad'), null, 'keyed by class')
  const g = startFromStorage(kv, 'ios', 48, 96, 0)
  assert.equal(g.size, 80)
  assert.equal(g.start, 48)
  assert.equal(startFromStorage(memKv({ [SIZE_KEY('ios')]: '9999' }), 'ios', 48, 96, 0).size, 48, 'junk is ignored')
  assert.equal(startFromStorage(memKv({ [SIZE_KEY('ios')]: '200' }), 'ios', 48, 96, 0).size, 96, 'a stored size above the cap is clamped to it')
})

test('a stale running marker starts one step below the remembered size and records it', () => {
  const kv = memKv({ [SIZE_KEY('ios')]: '80', [RUNNING_KEY('ios')]: '80' })
  const g = startFromStorage(kv, 'ios', 48, 96, 0)
  assert.equal(g.size, 80 - GROW_STEP)
  assert.equal(g.startedLower, true)
  assert.equal(g.lastShrink, 'crash_marker')
  assert.equal(readRemembered(kv, 'ios'), 64, 'recorded, so a second crash lowers again')
  // never below today's size
  assert.equal(startFromStorage(memKv({ [RUNNING_KEY('ios')]: '48' }), 'ios', 48, 96, 0).size, 48)
  // a marker bigger than the stored size (died right after a grow) is what is stepped down from
  assert.equal(startFromStorage(memKv({ [SIZE_KEY('ios')]: '48', [RUNNING_KEY('ios')]: '64' }), 'ios', 48, 96, 0).size, 48)
  clearRunning(kv, 'ios')
  assert.equal(startFromStorage(kv, 'ios', 48, 96, 0).startedLower, false, 'pagehide clears the marker')
  setRunning(kv, 'ios', 64)
  assert.equal(kv.m.get(RUNNING_KEY('ios')), '64')
})

test('storage failure and no storage are safe', () => {
  for (const kv of [throwing, null]) {
    assert.equal(readRemembered(kv, 'ios'), null)
    writeRemembered(kv, 'ios', 64); setRunning(kv, 'ios', 64); clearRunning(kv, 'ios')
    const g = startFromStorage(kv, 'ios', 48, 96, 0)
    assert.equal(g.size, 48)
    assert.ok(growPoll(g, calm(), seen()), 'still grows')
  }
})

// ---- wiring

test('?cachegrow=0 turns it off; the switch is registered; main wires the poll, the marker and the __moon state', () => {
  assert.equal(cachegrowOff('?cachegrow=0'), true)
  assert.equal(cachegrowOff(''), false)
  assert.equal(cachegrowOff('?cachegrow=1'), false)
  const sw = readFileSync(new URL('../src/debug/switches.ts', import.meta.url), 'utf8')
  assert.match(sw, /on\(Q, 'cachegrow'/)
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(main, /const cacheGrowOn = !cachegrowOff\(location\.search\)/)
  assert.match(main, /enforceMemory\(now\)\n {2}stepCacheGrow\(now\)/, 'polled from the frame loop beside the shed')
  assert.match(main, /addEventListener\('pagehide', \(\) => \{ clearRunning/)
  const fn = /function stepCacheGrow[\s\S]*?\n\}\n/.exec(main)?.[0] ?? ''
  assert.ok(fn.includes('growPoll(') && fn.includes('writeRemembered('), 'the poll records the size')
  assert.ok(!/releaseTiles|ensureTiles|TS\.create/.test(fn), 'no rebuild during a session')
  assert.match(main, /cacheGrow: \(\) => \(\{ on: cacheGrowOn/)
  assert.match(main, /layers = growLayers\(layers, maxLayers\)\n\s+if \(memShedTileCap !== null\)/, 'the shed cap still wins over the grown size')
  const boot = readFileSync(new URL('../src/telemetry/boot.ts', import.meta.url), 'utf8')
  assert.match(boot, /cacheProps\(c\.size, c\.start, c\.lastShrink\)/)
})
