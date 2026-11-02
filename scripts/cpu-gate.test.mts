import assert from 'node:assert/strict'
import { CpuGate } from '../src/moon/tiles/CpuGate.ts'
let wakes = 0
const g = new CpuGate(() => wakes++, 1000)
const a = new AbortController(), b = new AbortController(), c = new AbortController()
const completed: number[] = []
const jobs = [a, b, c].map((s, i) => g.wait(s.signal).then(() => completed.push(i)))
assert.equal(wakes, 3)
g.tick(); await Promise.resolve()
assert.deepEqual(completed, [0], 'one frame admits only one tile')
b.abort(); await Promise.resolve()
assert.deepEqual(completed, [0, 1], 'abort releases a queued caller without consuming the next frame')
assert.equal(g.pending, true)
g.dispose(); await Promise.all(jobs)
assert.equal(g.pending, false)
assert.deepEqual(completed, [0, 1, 2])
await g.wait(new AbortController().signal)
assert.equal(g.pending, false, 'disposed gate cannot retain new work')
const timerGate = new CpuGate(() => {}, 15)
const order: number[] = []
const x = timerGate.wait(new AbortController().signal).then(() => order.push(1))
const y = timerGate.wait(new AbortController().signal).then(() => order.push(2))
await x
assert.deepEqual(order, [1], 'fallback admits one tile, not every queued timeout')
assert.equal(timerGate.pending, true)
await y
assert.deepEqual(order, [1, 2])
timerGate.dispose()
console.log('cpu-gate: ok')
