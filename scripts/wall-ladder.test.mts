/** WallLadder (term-fix B): the wall-clock backstop for a GPU timer that lags or reads 0, with hysteresis against a 60 Hz motion target. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WallLadder, MOTION_STEPS, MotionMemory, WALL_MEMORY_DEFAULT_MS, wallMemoryFromSearch, wallMemoryHolds } from '../src/post/motionGrid'

test('two slow drawn frames in a row step down one grid and latch lite', () => {
  const w = new WallLadder()
  assert.equal(w.observe(400, 16.7, 0.7), null)
  assert.equal(w.lite, false)
  assert.equal(w.observe(350, 16.7, 0.7), 0.5)
  assert.equal(w.lite, true); assert.equal(w.cap, 0.5)
})
test('a healthy frame between slow ones resets the count', () => {
  const w = new WallLadder()
  w.observe(400, 16.7, 0.7); w.observe(10, 16.7, 0.7)
  assert.equal(w.observe(400, 16.7, 0.7), null)
  assert.equal(w.lite, false)
})
test('at the coarsest grid it still latches lite and returns null', () => {
  const w = new WallLadder()
  w.observe(400, 16.7, MOTION_STEPS[0])
  assert.equal(w.observe(400, 16.7, MOTION_STEPS[0]), null)
  assert.equal(w.lite, true)
})
test('a pause in the gesture is not a slow frame', () => {
  const w = new WallLadder()
  w.observe(3000, 16.7, 0.7); w.observe(3000, 16.7, 0.7)
  assert.equal(w.lite, false)
})
test('reset clears the latch', () => {
  const w = new WallLadder()
  w.observe(400, 16.7, 0.7); w.observe(400, 16.7, 0.7); w.reset()
  assert.equal(w.lite, false); assert.equal(w.cap, 1)
})
test('a 120 Hz display with 25 ms frames never climbs and never clears', () => {
  const w = new WallLadder()
  w.observe(400, 8.3, 0.7); const stepped = w.observe(400, 8.3, 0.7)
  assert.equal(stepped, 0.5)
  let cur = 0.5
  for (let i = 0; i < 300; i++) { const n = w.observe(25, 8.3, cur); if (n !== null) cur = n; assert.equal(w.lite, true) }
  assert.ok(cur <= 0.5 && w.cap <= 0.5, 'no climb: ' + cur)
})
test('5 ms frames climb 0.5 to 0.7 (cap back to 1) and clear lite, never in the same window', () => {
  const w = new WallLadder()
  w.observe(400, 8.3, 0.7); w.observe(400, 8.3, 0.7)
  let cur = 0.5; const climbs: number[] = []; let clearedAt = -1
  for (let i = 1; i <= 200; i++) {
    const n = w.observe(5, 8.3, cur)
    if (n !== null) { cur = n; climbs.push(i) }
    if (!w.lite && clearedAt < 0) clearedAt = i
  }
  assert.deepEqual(climbs, [30]); assert.equal(cur, 0.7)
  assert.ok(clearedAt > 0 && !climbs.includes(clearedAt), 'cleared on a frame that did not climb')
  assert.equal(w.lite, false); assert.equal(w.cap, 1)
})
test('9-10 ms frames at 0.5 hold the grid and the latch for 300 frames (no re-latch cycle)', () => {
  const w = new WallLadder()
  w.observe(400, 8.3, 0.7); w.observe(400, 8.3, 0.7)
  let cur = 0.5
  for (let i = 0; i < 300; i++) {
    const n = w.observe(i % 2 ? 9 : 10, 8.3, cur); if (n !== null) cur = n
    assert.equal(w.lite, true); assert.equal(cur, 0.5)
  }
})
test('a climb that costs a slow streak steps down and is not retried for 4 s, then may be', () => {
  const w = new WallLadder()
  w.observe(400, 8.3, 0.7); w.observe(400, 8.3, 0.7)
  let cur = 0.5
  const cost = (s: number) => 5 * (s / 0.5) ** 6 // misjudged: finer grid is much costlier than squared
  let steps: number[] = []
  for (let i = 0; i < 40; i++) { const n = w.observe(cost(cur), 8.3, cur); if (n !== null) { cur = n; steps.push(n) } }
  assert.deepEqual(steps, [0.7, 0.5]) // climbed, failed, back down
  // 4 s of 5 ms healthy frames = 800 frames: no climb inside the ban
  steps = []
  for (let i = 0; i < 700; i++) { const n = w.observe(5, 8.3, cur); if (n !== null) { cur = n; steps.push(n) } }
  assert.deepEqual(steps, [])
  for (let i = 0; i < 200; i++) { const n = w.observe(5, 8.3, cur); if (n !== null) { cur = n; steps.push(n) } }
  assert.ok(steps.length > 0 && steps[0] === 0.7, 'retried after the ban: ' + steps)
})
test('8 ms frames at 0.25 climb to 0.35 (spend the headroom on detail)', () => {
  const w = new WallLadder()
  w.observe(400, 8.3, 0.35); assert.equal(w.observe(400, 8.3, 0.35), 0.25)
  let n: number | null = null, i = 0
  while (n === null && i < 100) { n = w.observe(7.9, 8.3, 0.25); i++ }
  assert.equal(n, 0.35); assert.equal(i, 30)
})
test('a real slow streak at a fine grid steps down', () => {
  const w = new WallLadder()
  assert.equal(w.observe(30, 8.3, 1), null)
  assert.equal(w.observe(30, 8.3, 1), 0.7)
  assert.equal(w.lite, true)
})
test('frames between 14 and 20 ms change nothing', () => {
  const w = new WallLadder()
  w.observe(400, 8.3, 0.7); w.observe(400, 8.3, 0.7)
  for (let i = 0; i < 200; i++) assert.equal(w.observe(17, 8.3, 0.5), null)
  assert.equal(w.lite, true); assert.equal(w.cap, 0.5)
})
test('a slower pacing tier widens the limits', () => {
  const w = new WallLadder()
  for (let i = 0; i < 20; i++) assert.equal(w.observe(30, 33.3, 0.5), null)
  assert.equal(w.lite, false)
})

// Rest to motion (WP-A, 2026-10-23): `?wallmem=` keeps what the ladder learned across a rest, where the 4 s default forgot it after every rest the owner complained about.
test('wall memory: 4 s by time alone without the switch; the switch keeps it 60 s (or the given ms) and drops it when the canvas size changes', () => {
  assert.deepEqual(wallMemoryFromSearch(''), { on: false, ms: WALL_MEMORY_DEFAULT_MS })
  assert.deepEqual(wallMemoryFromSearch('?wallmem'), { on: true, ms: 60000 })
  assert.deepEqual(wallMemoryFromSearch('?wallmem=20000'), { on: true, ms: 20000 })
  assert.deepEqual(wallMemoryFromSearch('?wallmem=x'), { on: true, ms: 60000 }, 'a bad value is the 60 s default, not off')
  // Desktop-class default (2026-10-23): on with the 60 s memory when the param is absent; ?wallmem=0 opts out; an explicit value still wins.
  assert.deepEqual(wallMemoryFromSearch('', true), { on: true, ms: 60000 })
  assert.deepEqual(wallMemoryFromSearch('?wallmem=0', true), { on: false, ms: WALL_MEMORY_DEFAULT_MS })
  assert.deepEqual(wallMemoryFromSearch('?wallmem=20000', true), { on: true, ms: 20000 })
  assert.deepEqual(wallMemoryFromSearch('?wallmem=0', false), { on: false, ms: WALL_MEMORY_DEFAULT_MS })
  // Today's rule: time only, the size is not looked at.
  assert.equal(wallMemoryHolds(5000, 2000, 4000, '3160x1448', '', false), true)
  assert.equal(wallMemoryHolds(6001, 2000, 4000, '3160x1448', '', false), false, 'forgotten after 4 s: the gesture starts fine and jitters again')
  // With the switch: 60 s, same canvas.
  assert.equal(wallMemoryHolds(50000, 2000, 60000, '3160x1448', '3160x1448', true), true)
  assert.equal(wallMemoryHolds(62001, 2000, 60000, '3160x1448', '3160x1448', true), false)
  assert.equal(wallMemoryHolds(5000, 2000, 60000, '2880x1800', '3160x1448', true), false, 'a resized canvas is a different cost')
  assert.equal(wallMemoryHolds(5000, -1e9, 60000, '3160x1448', '', true), false, 'nothing stamped yet')
})
test('motion memory: the grid a gesture ended on comes back for the same context until it expires', () => {
  const m = new MotionMemory()
  const orbit = MotionMemory.key(false, 3160, 1448), ground = MotionMemory.key(true, 3160, 1448), small = MotionMemory.key(false, 1440, 900)
  assert.equal(m.recall(orbit, 1000, 60000), null, 'nothing remembered')
  m.remember(orbit, 0.5, 1000)
  assert.equal(m.recall(orbit, 30000, 60000), 0.5)
  assert.equal(m.recall(ground, 30000, 60000), null, 'ground mode is another context')
  assert.equal(m.recall(small, 30000, 60000), null, 'another canvas size is another context')
  assert.equal(m.recall(orbit, 61001, 60000), null, 'expired with the wall memory')
  m.remember(orbit, 0.42, 2000)
  assert.equal(m.recall(orbit, 3000, 60000), 0.5, 'a grid off the ladder is not remembered')
  m.remember(orbit, 0.7, 4000)
  assert.deepEqual(m.snapshot(), { [orbit]: 0.7 })
})
