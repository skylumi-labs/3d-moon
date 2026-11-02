// Centre-out upload order (R59): takeReady picks the lowest current wanted priority; ?reveal=0 is arrival order.
import assert from 'node:assert/strict'
import { revealOf, setReveal, takeReady } from '../src/moon/tiles/wanted.ts'

assert.equal(revealOf(''), true)
assert.equal(revealOf('?reveal=1'), true)
assert.equal(revealOf('?reveal=0'), false)

const mk = (key: number) => ({ job: { key, priority: 99 } })
const wanted = new Map([[1, { priority: 30 }], [2, { priority: 5 }], [3, { priority: 12 }], [4, { priority: 5 }]])

setReveal('')
const q = [mk(1), mk(9), mk(3), mk(2), mk(4)]
const order: number[] = []
while (q.length) order.push(takeReady(q, wanted)!.job.key)
assert.deepEqual(order, [2, 4, 3, 1, 9], 'lowest priority first, ties in arrival order, unwanted last')

// Uses the wanted priority of now, not the one the job was queued with.
const q2 = [mk(1), mk(3)]
assert.equal(takeReady(q2, new Map([[1, { priority: 1 }], [3, { priority: 50 }]]))!.job.key, 1)
assert.equal(takeReady([] as ReturnType<typeof mk>[], wanted), undefined)

setReveal('?reveal=0')
const q3 = [mk(1), mk(9), mk(3), mk(2)]
const arr: number[] = []
while (q3.length) arr.push(takeReady(q3, wanted)!.job.key)
assert.deepEqual(arr, [1, 9, 3, 2], '?reveal=0: arrival order')
setReveal('')
console.log('reveal-order ok')

// Wiring: every streamer uploads through takeReady (no raw ready.shift() left), so the switch reaches all three layers.
import { readFileSync } from 'node:fs'
for (const f of ['TileStreamer', 'DetailStreamer', 'TcStreamer']) {
  const src = readFileSync(new URL(`../src/moon/tiles/${f}.ts`, import.meta.url), 'utf8')
  assert.ok(src.includes('takeReady(this.ready, wanted)'), `${f} takes uploads through takeReady`)
  assert.ok(!/this\.ready\.shift\(\)/.test(src), `${f} has no arrival-order upload left`)
}
const stars = readFileSync(new URL('../src/sky/stars.ts', import.meta.url), 'utf8')
assert.ok(stars.includes('setDrawRange(0, this.drawn)') && stars.includes('drawCount('), 'StarPass applies the cull as a draw range')
assert.ok(/sort\(\(a, b\) => a\[2\] - b\[2\]\)/.test(stars), 'the catalogue is sorted brightest first (the draw range depends on it)')
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
assert.ok(/stars\.update\([^\n]*exposure\.white, skyCullGain\([^\n]*\)\)\s*$/m.test(main), 'main passes the exposure white and the sky lift gain to the star cull')
console.log('wiring ok')
