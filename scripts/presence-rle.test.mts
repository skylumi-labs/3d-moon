// Run-length presence lists answer like the linear scan they replace.
import assert from 'node:assert/strict'
import { deeperPresent, levelRow, type DeeperEntry } from '../src/moon/tiles/levels.ts'

const runs: Array<[number, number]> = [[3, 2], [10, 1], [100, 50]]
const e = { level: -3, tileDeg: 0.625, ppd: 512, texelKm: 0.059, presentRle: runs } as unknown as DeeperEntry
const scan = (i: number): boolean => runs.some(([s, l]) => i >= s && i < s + l)
for (let i = -2; i < 200; i++) assert.equal(deeperPresent(e, i), scan(i), `index ${i}`)
assert.equal(deeperPresent({ ...e, presentRle: undefined } as DeeperEntry, 5), false)
assert.equal(deeperPresent({ ...e, presentRle: undefined, present: '0010' } as DeeperEntry, 2), true)
assert.equal(levelRow(-3), levelRow(-3))
console.log('presence-rle ok')
